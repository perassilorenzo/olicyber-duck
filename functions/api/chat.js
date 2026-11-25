import { parseChatRequest, MAX_BODY_BYTES } from '../lib/validate.js';
import { buildMessages } from '../lib/system-prompt.js';
import { demoReply } from '../lib/demo.js';
import { createRateLimiter } from '../lib/rate-limit.js';

export const DEFAULT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8';

const limiter = createRateLimiter({ limit: 12, windowMs: 60_000 });

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  });
}

async function clientKey(request) {
  const ip = request.headers.get('cf-connecting-ip')
    || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    || 'unknown';
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(bytes)).slice(0, 8).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function extractText(result) {
  if (typeof result === 'string') return result.trim();
  const candidates = [
    result?.response,
    result?.result?.response,
    result?.choices?.[0]?.message?.content,
    result?.choices?.[0]?.text,
  ];
  const text = candidates.find((item) => typeof item === 'string' && item.trim());
  return text ? text.trim() : '';
}

export async function onRequestPost({ request, env }) {
  // Protezione di base contro richieste cross-site: la UI chiama sempre la stessa origine.
  const origin = request.headers.get('origin');
  if (origin) {
    try {
      if (new URL(origin).host !== new URL(request.url).host) {
        return json({ error: 'Origine della richiesta non consentita.' }, 403);
      }
    } catch {
      return json({ error: 'Origine della richiesta non valida.' }, 403);
    }
  }

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > MAX_BODY_BYTES) {
    return json({ error: `Richiesta troppo grande (massimo ${MAX_BODY_BYTES} byte).` }, 413);
  }

  const key = await clientKey(request);
  const rate = limiter.check(key);
  if (!rate.allowed) {
    return json({ error: 'Troppe richieste in poco tempo. Attendi qualche secondo e riprova.' }, 429, {
      'Retry-After': String(rate.retryAfter),
    });
  }

  let rawBody;
  try {
    rawBody = await request.text();
  } catch {
    return json({ error: 'Impossibile leggere la richiesta.' }, 400);
  }

  const parsed = parseChatRequest(rawBody);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const { message, challenge, history } = parsed.value;

  if (!env.AI) {
    return json({ reply: demoReply({ challenge, history, message }), mode: 'demo' });
  }

  const model = typeof env.AI_MODEL === 'string' && env.AI_MODEL.trim()
    ? env.AI_MODEL.trim()
    : DEFAULT_MODEL;

  try {
    const result = await env.AI.run(model, {
      messages: buildMessages({ challenge, history, message }),
      max_tokens: 700,
      temperature: 0.35,
    });
    const reply = extractText(result);
    if (!reply) return json({ error: 'Il modello non ha restituito una risposta utilizzabile.' }, 502);
    return json({ reply, mode: 'ai', model });
  } catch (error) {
    console.error('[OliDuck] Errore Workers AI:', error?.message || error);
    return json({ error: 'Il servizio AI non è disponibile in questo momento. Riprova più tardi.' }, 502);
  }
}
