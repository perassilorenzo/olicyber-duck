/**
 * Client del backend AI. Il contesto delle challenge NON viene inviato:
 * il server lo ricostruisce in modo autorevole da `challengeIds` leggendo il
 * catalogo authoritative. Il client invia solo ID (massimo 6), messaggio e
 * cronologia: descrizioni, hint e allegati restano fuori dal payload. L'eventuale
 * `statementExcerpt` è un estratto incollato dallo studente, non una fonte
 * verificata: il server lo limita e lo tratta come dato non attendibile.
 *
 * `onProgress` (o il suo alias storico `onToken`) riceve sempre la risposta
 * CUMULATIVA, non il delta del singolo token, sia con JSON sia con SSE.
 * Negli eventi SSE il campo `reply` è autorevole e sostituisce il testo
 * precedente: serve per annullare un rifiuto sopraggiunto dopo un prefisso
 * già trasmesso. Il campo storico `token` resta supportato come delta.
 */

export class ApiError extends Error {
  constructor(message, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function readError(response) {
  try {
    const data = await response.json();
    if (data?.error) return new ApiError(data.error, response.status);
  } catch { /* risposta non JSON */ }
  return new ApiError(`Richiesta non riuscita (HTTP ${response.status}).`, response.status);
}

export async function fetchAssistantStatus(signal) {
  const response = await fetch('/api/status', { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) throw await readError(response);
  return response.json();
}

async function readEventStream(response, onProgress) {
  const reader = response.body?.getReader();
  if (!reader) throw new ApiError('Streaming non disponibile.', response.status);
  const decoder = new TextDecoder();
  let buffer = '';
  let reply = '';
  let result = {
    mode: 'ai', model: undefined, challengeIds: [], followUp: false,
    followUpKind: null, conversationTopic: null, technologies: [],
    previousIntent: null, regenerated: false, incomplete: false,
  };
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.startsWith('data:')) continue;
      try {
        const event = JSON.parse(line.slice(5).trim());
        if (typeof event.reply === 'string') {
          reply = event.reply;
          onProgress?.(reply);
        } else if (event.token) {
          reply += event.token;
          onProgress?.(reply);
        }
        if (event.mode) result.mode = event.mode;
        if (event.model) result.model = event.model;
        if (Array.isArray(event.challengeIds)) result.challengeIds = event.challengeIds;
        if (event.challengeId) result.challengeId = event.challengeId;
        if (Array.isArray(event.sources)) result.sources = event.sources;
        if (typeof event.blocked === 'boolean') result.blocked = event.blocked;
        if (typeof event.intent === 'string') result.intent = event.intent;
        if (typeof event.needsClarification === 'boolean') result.needsClarification = event.needsClarification;
        if (typeof event.statementProvided === 'boolean') result.statementProvided = event.statementProvided;
        if (typeof event.statementStatus === 'string') result.statementStatus = event.statementStatus;
        if (typeof event.catalogVerified === 'boolean') result.catalogVerified = event.catalogVerified;
        if (typeof event.contextMode === 'string') result.contextMode = event.contextMode;
        if (typeof event.challengeCount === 'number') result.challengeCount = event.challengeCount;
        if (typeof event.statementMissing === 'boolean') result.statementMissing = event.statementMissing;
        if (typeof event.personalContext === 'boolean') result.personalContext = event.personalContext;
        if (typeof event.support === 'boolean') result.support = event.support;
        if (typeof event.hintStage === 'number') result.hintStage = event.hintStage;
        if (typeof event.followUp === 'boolean') result.followUp = event.followUp;
        if (typeof event.followUpKind === 'string') result.followUpKind = event.followUpKind;
        if (typeof event.conversationTopic === 'string') result.conversationTopic = event.conversationTopic;
        if (Array.isArray(event.technologies)) result.technologies = event.technologies;
        if (typeof event.previousIntent === 'string') result.previousIntent = event.previousIntent;
        if (typeof event.challengeLinkRequested === 'boolean') result.challengeLinkRequested = event.challengeLinkRequested;
        if (typeof event.regenerated === 'boolean') result.regenerated = event.regenerated;
        if (typeof event.incomplete === 'boolean') result.incomplete = event.incomplete;
        if (event.error) throw new ApiError(event.error, Number(event.status) || response.status);
      } catch (error) {
        if (error instanceof ApiError) throw error;
      }
    }
  }
  return { ...result, reply };
}

export async function sendChat({ challengeIds, message, history, statementExcerpt = '' }, { onProgress, onToken, signal } = {}) {
  const report = onProgress || onToken;
  const payload = { challengeIds, message, history };
  if (statementExcerpt) payload.statementExcerpt = statementExcerpt;
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    signal,
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw await readError(response);

  const type = response.headers.get('content-type') || '';
  if (type.includes('text/event-stream')) return readEventStream(response, report);

  const data = await response.json();
  if (typeof data?.reply !== 'string') throw new ApiError('Risposta del backend non valida.', response.status);
  report?.(data.reply);
  return {
    reply: data.reply,
    mode: data.mode || 'ai',
    model: data.model,
    challengeIds: Array.isArray(data.challengeIds) ? data.challengeIds : [],
    challengeId: data.challengeId,
    sources: Array.isArray(data.sources) ? data.sources : [],
    blocked: Boolean(data.blocked),
    intent: typeof data.intent === 'string' ? data.intent : null,
    needsClarification: Boolean(data.needsClarification),
    statementProvided: Boolean(data.statementProvided),
    statementStatus: typeof data.statementStatus === 'string' ? data.statementStatus : null,
    catalogVerified: Boolean(data.catalogVerified),
    contextMode: typeof data.contextMode === 'string' ? data.contextMode : null,
    challengeCount: typeof data.challengeCount === 'number' ? data.challengeCount : null,
    statementMissing: Boolean(data.statementMissing),
    personalContext: Boolean(data.personalContext),
    support: Boolean(data.support),
    hintStage: typeof data.hintStage === 'number' ? data.hintStage : null,
    followUp: Boolean(data.followUp),
    followUpKind: typeof data.followUpKind === 'string' ? data.followUpKind : null,
    conversationTopic: typeof data.conversationTopic === 'string' ? data.conversationTopic : null,
    technologies: Array.isArray(data.technologies) ? data.technologies : [],
    previousIntent: typeof data.previousIntent === 'string' ? data.previousIntent : null,
    challengeLinkRequested: Boolean(data.challengeLinkRequested),
    regenerated: Boolean(data.regenerated),
    incomplete: Boolean(data.incomplete),
  };
}
