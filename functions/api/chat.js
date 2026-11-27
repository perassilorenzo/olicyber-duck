import { parseChatRequest, MAX_BODY_BYTES } from '../lib/validate.js';
import {
  buildMessages, redactOutput, detectSolutionRequest, outputLooksUnsafe,
  INTENTS, isSolutionRequest, hintStageFor, isPersonalContext,
  buildDeliveryStatus, classifyIntentInContext, conversationState,
} from '../lib/system-prompt.js';
import { analyzeReply } from '../lib/response-quality.js';
import { resolveStatement } from '../lib/statement.js';
import { demoReply } from '../lib/demo.js';
import { createRateLimiter } from '../lib/rate-limit.js';
import { CATALOG_META, toPromptContexts } from '../lib/catalog.js';
import { DEFAULT_MODEL } from '../lib/model.js';
import {
  retrieveKnowledge, knowledgeContext, publicKnowledgeSources,
} from '../lib/knowledge.js';

// Nota: il limite in memoria è per isolato; in produzione va affiancato da
// Cloudflare Rate Limiting Rules / WAF (vedi docs/CLOUDFLARE.md).
const limiter = createRateLimiter({ limit: 12, windowMs: 60_000 });
const AI_TIMEOUT_MS = 20_000;
const MAX_COMPLETION_TOKENS = 700;
// I caratteri finali restano in buffer finché il blocco non è completo: così
// un flag diviso tra due chunk non viene mai inviato prima della redaction.
const SAFETY_TAIL_CHARS = 64;

const SOLUTION_REFUSAL = 'Non posso fornire flag, soluzioni, writeup o payload per completare una challenge. '
  + 'Posso aiutarti a capire i concetti coinvolti, a formulare una prima ipotesi e a verificare il tuo ragionamento: '
  + 'dimmi cosa hai capito finora oppure chiedimi una spiegazione teorica dell’argomento.';

/** Chiarimento mirato: evita il menu generico quando manca solo il contesto. */
function clarificationReply(message = '', state = {}) {
  const technology = state.technologies?.[0];
  const detail = technology
    ? `Hai menzionato ${technology}, ma non ho ancora il concetto a cui si riferisce.`
    : 'Manca il concetto a cui ti riferisci.';
  return `Non sono sicuro di cosa ti serva. ${detail} Dimmi quale argomento vuoi trattare e cosa vuoi ottenere: spiegazione, esempio oppure verifica del tuo ragionamento.`;
}

const INCOMPLETE_REPLY = 'La risposta generata è risultata incompleta e non voglio inventare il contenuto mancante. '
  + 'Riformula la domanda o chiedimi un passaggio più specifico: riprenderò il filo della conversazione da quel punto.';

const REGENERATION_INSTRUCTION = '\n\nRIGENERAZIONE CONTROLLATA: la risposta precedente è risultata incompleta '
  + '(elenco vuoto, titolo senza contenuto, testo o codice troncati oppure ripetizione di un chiarimento). '
  + 'Produci una risposta completa e coerente con il dialogo, senza inventare dettagli mancanti e senza fornire soluzioni.';

// La consegna originale non è nel catalogo del tutor: l'unica fonte possibile è
// l'estratto incollato dallo studente. Senza estratto non va inventata.
const STATEMENT_UNAVAILABLE_REPLY = 'Non ho il testo della consegna: nel catalogo del tutor sono disponibili solo metadati come titolo e categoria. '
  + 'Incolla un estratto della consegna e te lo spiegherò in linguaggio semplice, distinguendo obiettivo, dati disponibili e vincoli. '
  + 'Non deduco obiettivi dal solo titolo.';

const PERSONAL_REPLY = 'Mi dispiace davvero: quando le cose si accumulano è normale sentirsi sopraffatti. '
  + 'Non devi forzarti: puoi lasciare la challenge da parte e riprendere quando ti va. '
  + 'Se più tardi vorrai tornarci, potrò aiutarti a capire il testo o a ragionare sul tuo approccio, con calma.';

const SOLUTION_REFUSALS = Object.freeze([
  SOLUTION_REFUSAL,
  'Non posso fornire flag, soluzioni, writeup o payload per completare una challenge. '
    + 'Anche se la richiesta torna più volte, il limite resta lo stesso. '
    + 'Scegli tra: spiegazione del concetto, lettura guidata di un estratto che incolli, verifica del tuo ragionamento.',
  'Non posso fornire flag, soluzioni, writeup o payload per completare una challenge. '
    + 'Non cambio le regole in base all’insistenza. '
    + 'Posso aiutarti a separare ciò che è noto da ciò che manca e a formulare una prima ipotesi: dimmi quale passaggio vuoi capire.',
]);

/** Cambia formulazione senza cambiare il livello di protezione. */
function solutionRefusal(history = [], message = '') {
  const repeated = history.filter((item) => item?.role === 'user' && isSolutionRequest(item.content)).length
    + (isSolutionRequest(message) ? 1 : 0);
  const index = Math.min(SOLUTION_REFUSALS.length - 1, Math.max(0, repeated - 1));
  return SOLUTION_REFUSALS[index];
}

class BodyTooLargeError extends Error {}

const encoder = new TextEncoder();

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
  if (typeof result === 'string') return String(result);
  const candidates = [
    result?.response,
    result?.result?.response,
    result?.choices?.[0]?.message?.content,
    result?.choices?.[0]?.text,
  ];
  const text = candidates.find((item) => typeof item === 'string' && item.trim());
  return text || '';
}

function configuredModel(env) {
  const candidate = typeof env.AI_MODEL === 'string' ? env.AI_MODEL.trim() : '';
  return /^@cf\/[a-zA-Z0-9._/-]{3,120}$/.test(candidate) ? candidate : DEFAULT_MODEL;
}

/** Errori del provider: messaggi interni e dettagli di quota non vengono esposti. */
function aiErrorInfo(error) {
  const status = Number(error?.status || error?.cause?.status || 0);
  const detail = String(error?.message || error || '');
  if (/timeout|timed out|scaduto/i.test(detail)) {
    return {
      status: 504,
      message: 'Il tutor ha impiegato troppo tempo per rispondere. Prova con una domanda più breve.',
    };
  }
  if (status === 429 || /quota|rate.?limit|exceeded|limit reached|esaurit/i.test(detail)) {
    return {
      status: 503,
      message: 'La quota AI giornaliera è momentaneamente esaurita (si azzera alle 00:00 UTC). Riprova più tardi oppure usa la modalità DEMO.',
    };
  }
  console.error('[OliDuck] Errore Workers AI:', detail);
  return {
    status: 502,
    message: 'Il servizio AI non è disponibile in questo momento. Riprova più tardi.',
  };
}

function aiErrorResponse(error) {
  const info = aiErrorInfo(error);
  return json({ error: info.message }, info.status, info.status === 503 ? { 'Retry-After': '60' } : {});
}

/** Unica via di chiamata al modello: vale per prima risposta e rigenerazione. */
function runModel(env, model, input) {
  return withTimeout(
    Promise.resolve().then(() => env.AI.run(model, input)),
    AI_TIMEOUT_MS,
  );
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

function cancelReader(reader) {
  try {
    return Promise.resolve(reader?.cancel?.()).catch(() => {});
  } catch {
    return Promise.resolve();
  }
}

/** Timeout assoluto sull'intera generazione, non solo sul primo chunk. */
async function readWithDeadline(reader, deadline) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    await cancelReader(reader);
    throw new Error('timeout');
  }
  let timer;
  try {
    return await Promise.race([
      reader.read(),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          cancelReader(reader);
          reject(new Error('timeout'));
        }, remaining);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function isReadableStream(value) {
  return Boolean(value && typeof value.getReader === 'function');
}

/** Estrae solo il testo visibile: mai `reasoning_content` o campi di pensiero. */
function deltaFromChunk(chunk) {
  if (typeof chunk === 'string') return chunk === '[DONE]' ? '' : chunk;
  const choice = Array.isArray(chunk?.choices) ? chunk.choices[0] : null;
  const candidates = [
    choice?.delta?.content,
    choice?.message?.content,
    choice?.text,
    chunk?.response,
    chunk?.result?.response,
    chunk?.text,
  ];
  return candidates.find((value) => typeof value === 'string' && value.length > 0) || '';
}

function sseResponse(stream) {
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
      'X-Content-Type-Options': 'nosniff',
      'Vary': 'Origin',
    },
  });
}

/**
 * Trasforma lo SSE di Workers AI in eventi del tutor. Il campo `reply` è
 * cumulativo e autorevole: il client lo sostituisce, quindi un rifiuto
 * sopraggiunto può annullare il testo parziale già inviato.
 */
function createAiEventStream(source, meta, deadline, refusal = SOLUTION_REFUSAL, history = [], regenerate = null) {
  let reader;
  try {
    reader = source.getReader();
  } catch {
    throw new Error('Streaming non disponibile.');
  }
  const decoder = new TextDecoder();
  let providerBuffer = '';
  let rawReply = '';
  let lastVisible = '';
  let stopped = false;

  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const emit = (event) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const close = () => {
        if (closed) return;
        closed = true;
        try { controller.close(); } catch { /* già chiuso */ }
      };

      const processLine = (line) => {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) return;
        const payload = trimmed.slice(5).trim();
        if (!payload || payload === '[DONE]') return;
        let chunk;
        try {
          chunk = JSON.parse(payload);
        } catch {
          return; // keepalive o evento non JSON: ignorato
        }
        const delta = deltaFromChunk(chunk);
        if (!delta) return;
        rawReply += delta;
        if (outputLooksUnsafe(rawReply)) {
          stopped = true;
          return;
        }
        const cleaned = redactOutput(rawReply);
        const visible = cleaned.slice(0, Math.max(0, cleaned.length - SAFETY_TAIL_CHARS));
        if (visible !== lastVisible) {
          lastVisible = visible;
          emit({ reply: visible });
        }
      };

      try {
        while (!stopped) {
          const { value, done } = await readWithDeadline(reader, deadline);
          if (done) break;
          providerBuffer += decoder.decode(value, { stream: true });
          const lines = providerBuffer.split('\n');
          providerBuffer = lines.pop() || '';
          for (const line of lines) {
            processLine(line);
            if (stopped) break;
          }
        }
        if (!stopped) {
          providerBuffer += decoder.decode();
          if (providerBuffer.trim()) processLine(providerBuffer);
        }
        if (stopped || outputLooksUnsafe(rawReply)) {
          emit({ ...meta, reply: refusal, blocked: true });
        } else {
          const cleaned = redactOutput(rawReply);
          if (!cleaned) {
            emit({ ...meta, error: 'Il modello non ha restituito una risposta utilizzabile.', status: 502 });
          } else if (!analyzeReply(cleaned, { history }).incomplete) {
            emit({ ...meta, reply: cleaned });
          } else {
            // Il campo `reply` è cumulativo e autorevole: sostituisce il testo
            // parziale già inviato senza cicli di rigenerazione.
            const recovered = regenerate ? await regenerate() : null;
            if (recovered?.error) {
              emit({
                ...meta,
                error: recovered.error,
                status: recovered.status,
                retryAfter: recovered.status === 503 ? 60 : undefined,
              });
            } else if (recovered?.blocked || (recovered?.reply && outputLooksUnsafe(recovered.reply))) {
              emit({ ...meta, reply: refusal, blocked: true });
            } else if (recovered?.reply && !analyzeReply(recovered.reply, { history }).incomplete) {
              emit({ ...meta, reply: recovered.reply, regenerated: true });
            } else {
              emit({ ...meta, reply: INCOMPLETE_REPLY, incomplete: true, needsClarification: true });
            }
          }
        }
      } catch (error) {
        const info = aiErrorInfo(error);
        emit({
          ...meta,
          error: info.message,
          status: info.status,
          retryAfter: info.status === 503 ? 60 : undefined,
        });
      } finally {
        await cancelReader(reader);
        close();
      }
    },
    cancel() {
      stopped = true;
      cancelReader(reader);
    },
  });

  return sseResponse(stream);
}

/** Legge uno SSE del provider senza emettere progress: usato nella rigenerazione. */
async function readProviderText(source, deadline) {
  let reader;
  try {
    reader = source.getReader();
  } catch {
    return { error: 'Streaming non disponibile.', status: 502 };
  }
  const decoder = new TextDecoder();
  let providerBuffer = '';
  let rawReply = '';
  let blocked = false;
  const processLine = (line) => {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) return;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') return;
    let chunk;
    try {
      chunk = JSON.parse(payload);
    } catch {
      return;
    }
    const delta = deltaFromChunk(chunk);
    if (!delta) return;
    rawReply += delta;
    if (outputLooksUnsafe(rawReply)) blocked = true;
  };
  try {
    while (!blocked) {
      const { value, done } = await readWithDeadline(reader, deadline);
      if (done) break;
      providerBuffer += decoder.decode(value, { stream: true });
      const lines = providerBuffer.split('\n');
      providerBuffer = lines.pop() || '';
      for (const line of lines) {
        processLine(line);
        if (blocked) break;
      }
    }
    if (!blocked) {
      providerBuffer += decoder.decode();
      if (providerBuffer.trim()) processLine(providerBuffer);
    }
  } catch (error) {
    const info = aiErrorInfo(error);
    return { error: info.message, status: info.status, retryAfter: info.status === 503 ? 60 : undefined };
  } finally {
    await cancelReader(reader);
  }
  return blocked ? { blocked: true } : { text: rawReply };
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
  const { message, challengeIds, history, statementExcerpt: postedExcerpt } = parsed.value;
  // La consegna può essere stata incollata nel campo dedicato oppure direttamente
  // in chat: in entrambi i casi diventa contesto persistente della richiesta.
  const statement = resolveStatement({ statementExcerpt: postedExcerpt, history, message });
  const statementExcerpt = statement.text;

  // Il client invia solo ID: tutti i metadati arrivano dal catalogo server.
  const challenges = toPromptContexts(challengeIds);
  if (!challenges) return json({ error: 'Challenge non presente nel catalogo del tutor.' }, 400);

  const model = configuredModel(env);
  const mode = env.AI ? 'ai' : 'demo';
  const primaryId = challengeIds[0] || 'general';
  const statementOptions = { statementExcerpt };
  const state = conversationState(history, message, statementOptions);
  // Il contesto può reinterpretare un messaggio breve, ma non aggira il
  // rifiuto deterministico: la richiesta corrente viene sempre classificata.
  const intent = classifyIntentInContext(history, message, statementOptions);
  const personalContext = isPersonalContext(message);
  const hintStage = intent === INTENTS.REQUEST_HINT ? hintStageFor(history, message) : null;
  const refusal = solutionRefusal(history, message);
  // Il timeout copre anche l'avvio dello stream, non solo la lettura dei chunk.
  const deadline = Date.now() + AI_TIMEOUT_MS;
  const catalogVerified = Boolean(CATALOG_META.source?.verified);
  const delivery = buildDeliveryStatus({
    statementExcerpt, catalogVerified, source: statement.source,
  });
  const contextMode = challengeIds.length === 0
    ? 'general'
    : (challengeIds.length === 1 ? 'single' : 'multi');
  const meta = {
    mode,
    model: env.AI ? model : null,
    challengeIds,
    challengeId: primaryId,
    intent,
    statementProvided: Boolean(statementExcerpt),
    statementSource: statement.source,
    statementStatus: delivery.status,
    statementFromCurrentMessage: statement.fromCurrentMessage,
    catalogVerified,
    contextMode,
    challengeCount: challengeIds.length,
    personalContext,
    followUp: state.followUp,
    followUpKind: state.kind,
    conversationTopic: state.topics[0] || null,
    technologies: state.technologies,
    challengeLinkRequested: state.challengeLinkRequested,
    ...(state.previousIntent ? { previousIntent: state.previousIntent } : {}),
    ...(hintStage ? { hintStage } : {}),
  };

  // Controllo deterministico sull'input: nessuna chiamata al modello.
  // La manipolazione emotiva non può superare questo livello di protezione.
  if (intent === INTENTS.REQUEST_SOLUTION || detectSolutionRequest(message)) {
    return json({ reply: refusal, ...meta, blocked: true, sources: [] });
  }
  // Consegna richiesta senza testo disponibile: non inventare requisiti.
  if (intent === INTENTS.EXPLAIN_STATEMENT && !statementExcerpt) {
    return json({
      reply: STATEMENT_UNAVAILABLE_REPLY, ...meta, needsClarification: true,
      statementMissing: true, sources: [],
    });
  }
  // Difficoltà personale senza richiesta didattica: risposta empatica, niente modello.
  if (intent === INTENTS.CLARIFY && personalContext) {
    return json({ reply: PERSONAL_REPLY, ...meta, support: true, sources: [] });
  }
  // Ambiguità: chiarire invece di bloccare una domanda didattica innocua.
  if (intent === INTENTS.CLARIFY) {
    return json({
      reply: clarificationReply(message, state), ...meta, needsClarification: true, sources: [],
    });
  }

  // Retrieval sempre lato server e solo sulla knowledge base didattica.
  const realContexts = challenges.filter((item) => item.general !== true);
  const sources = retrieveKnowledge({
    message,
    history,
    statement: statementExcerpt,
    categories: realContexts.map((item) => item.category).filter(Boolean),
    tags: realContexts.flatMap((item) => Array.isArray(item.tags) ? item.tags : []),
  });
  const sourceMeta = publicKnowledgeSources(sources);
  meta.sources = sourceMeta;

  if (!env.AI) {
    return json({
      ...meta,
      reply: demoReply({
        challenges, history, message, sources,
        statement: statementExcerpt, intent, delivery,
      }),
    });
  }

  const input = {
    messages: buildMessages({
      challenges,
      history,
      message,
      intent,
      statementExcerpt,
      hintStage,
      personalContext,
      delivery,
      conversationState: state,
      knowledgeContext: knowledgeContext(sources),
    }),
    max_completion_tokens: MAX_COMPLETION_TOKENS,
    temperature: 0.35,
    // GLM-4.7-Flash supporta SSE (`choices[0].delta.content`, fine con [DONE]).
    stream: true,
    // Il tutor non deve consumare token di ragionamento né esporli allo studente.
    chat_template_kwargs: { enable_thinking: false },
  };

  // Al massimo una rigenerazione, con lo stesso contesto e un'istruzione
  // aggiuntiva nel solo messaggio di sistema.
  const retryInput = {
    ...input,
    messages: input.messages.map((item, index) => (index === 0
      ? { ...item, content: `${item.content}${REGENERATION_INSTRUCTION}` }
      : item)),
  };
  const regenerate = async () => {
    try {
      const retryResult = await runModel(env, model, retryInput);
      const retrySource = isReadableStream(retryResult)
        ? retryResult
        : (isReadableStream(retryResult?.body) ? retryResult.body : null);
      if (retrySource) {
        const collected = await readProviderText(retrySource, Date.now() + AI_TIMEOUT_MS);
        if (collected.error || collected.blocked) return collected;
        const cleaned = redactOutput(collected.text);
        return cleaned ? { reply: cleaned } : {};
      }
      const raw = redactOutput(extractText(retryResult));
      return raw ? { reply: raw } : {};
    } catch (error) {
      const info = aiErrorInfo(error);
      return { error: info.message, status: info.status, retryAfter: info.status === 503 ? 60 : undefined };
    }
  };

  let result;
  try {
    result = await runModel(env, model, input);
  } catch (error) {
    return aiErrorResponse(error);
  }

  const source = isReadableStream(result) ? result : (isReadableStream(result?.body) ? result.body : null);
  if (source) return createAiEventStream(source, meta, deadline, refusal, history, regenerate);

  // Fallback per binding/override che restituiscono comunque JSON sincrono.
  const rawReply = extractText(result);
  if (!rawReply) return json({ error: 'Il modello non ha restituito una risposta utilizzabile.' }, 502);
  if (outputLooksUnsafe(rawReply)) {
    return json({ ...meta, reply: refusal, blocked: true });
  }
  const reply = redactOutput(rawReply);
  if (!reply) return json({ error: 'Il modello non ha restituito una risposta utilizzabile.' }, 502);
  if (!analyzeReply(reply, { history }).incomplete) return json({ ...meta, reply });

  const recovered = await regenerate();
  if (recovered.error) {
    return json(
      { error: recovered.error },
      recovered.status,
      recovered.status === 503 ? { 'Retry-After': '60' } : {},
    );
  }
  if (recovered.blocked || (recovered.reply && outputLooksUnsafe(recovered.reply))) {
    return json({ ...meta, reply: refusal, blocked: true });
  }
  if (recovered.reply && !analyzeReply(recovered.reply, { history }).incomplete) {
    return json({ ...meta, reply: recovered.reply, regenerated: true });
  }
  return json({ ...meta, reply: INCOMPLETE_REPLY, incomplete: true, needsClarification: true });
}
