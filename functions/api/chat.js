import { parseChatRequest, MAX_BODY_BYTES, GENERAL_CHALLENGE_ID } from '../lib/validate.js';
import { buildMessages, redactOutput } from '../lib/system-prompt.js';
import { demoReply } from '../lib/demo.js';
import { createRateLimiter } from '../lib/rate-limit.js';
import { findChallengeById, toPromptContext } from '../lib/catalog.js';
import { DEFAULT_MODEL } from '../lib/model.js';

// Nota: il limite in memoria è per isolato; in produzione va affiancato da
// Cloudflare Rate Limiting Rules / WAF (vedi docs/CLOUDFLARE.md).
const limiter = createRateLimiter({ limit: 12, windowMs: 60_000 });

class BodyTooLargeError extends Error {}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Vary': 'Origin',
      ...extraHeaders,
    },
  });
}

/** Legge il body contando i byte reali, senza fidarsi di Content-Length. */
async function readLimitedText(request, maxBytes) {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let total = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new BodyTooLargeError('Body oltre il limite.');
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock?.();
  }
}

/** Solo cf-connecting-ip è attendibile. In assenza si usa un bucket comune. */
async function clientKey(request) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(digest)).slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function extractText(result) {
  if (typeof result === 'string') return redactOutput(result);
  const candidates = [
    result?.response,
    result?.result?.response,
    result?.choices?.[0]?.message?.content,
    result?.choices?.[0]?.text,
  ];
  const text = candidates.find((item) => typeof item === 'string' && item.trim());
  return redactOutput(text || '');
}

/** Il client invia solo challengeId: il contesto viene sempre dal catalogo server. */
function serverContextFor(challengeId) {
  if (challengeId === GENERAL_CHALLENGE_ID) return toPromptContext(null);
  const challenge = findChallengeById(challengeId);
  return challenge ? toPromptContext(challenge) : null;
}

function configuredModel(env) {
  const candidate = typeof env.AI_MODEL === 'string' ? env.AI_MODEL.trim() : '';
  return /^@cf\/[a-zA-Z0-9._/-]{3,120}$/.test(candidate) ? candidate : DEFAULT_MODEL;
}

export async function onRequestPost({ request, env }) {
  // Difesa di base: i browser cross-origin inviano Origin. Non è anti-abuso.
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

  const contentType = (request.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (contentType !== 'application/json') {
    return json({ error: 'È richiesto Content-Type: application/json.' }, 415);
  }

  const rate = limiter.check(await clientKey(request));
  if (!rate.allowed) {
    return json({ error: 'Troppe richieste in poco tempo. Attendi qualche secondo e riprova.' }, 429, {
      'Retry-After': String(rate.retryAfter),
    });
  }

  let rawBody;
  try {
    rawBody = await readLimitedText(request, MAX_BODY_BYTES);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return json({ error: `Richiesta troppo grande (massimo ${MAX_BODY_BYTES} byte).` }, 413);
    }
    return json({ error: 'Impossibile leggere la richiesta.' }, 400);
  }

  const parsed = parseChatRequest(rawBody);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  const { message, challengeId, history } = parsed.value;

  const challenge = serverContextFor(challengeId);
  if (!challenge) return json({ error: 'Challenge non presente nel catalogo del tutor.' }, 400);

  if (!env.AI) {
    return json({
      reply: demoReply({ challenge, history, message }),
      mode: 'demo',
      challengeId,
    });
  }

  const model = configuredModel(env);
  try {
    const result = await env.AI.run(model, {
      messages: buildMessages({ challenge, history, message }),
      max_tokens: 700,
      temperature: 0.35,
    });
    const reply = extractText(result);
    if (!reply) return json({ error: 'Il modello non ha restituito una risposta utilizzabile.' }, 502);
    return json({ reply, mode: 'ai', model, challengeId });
  } catch (error) {
    // Non esporre messaggi interni del provider AI al client.
    console.error('[OliDuck] Errore Workers AI:', error?.message || error);
    return json({ error: 'Il servizio AI non è disponibile in questo momento. Riprova più tardi.' }, 502);
  }
}
