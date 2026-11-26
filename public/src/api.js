/**
 * Client del backend AI. Il contesto delle challenge NON viene inviato:
 * il server lo ricostruisce in modo autorevole da `challengeIds` leggendo il
 * catalogo authoritative. Il client invia solo ID (massimo 6), messaggio e
 * cronologia: descrizioni, hint e allegati restano fuori dal payload.
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
  let result = { mode: 'ai', model: undefined, challengeIds: [] };
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
        if (event.error) throw new ApiError(event.error, Number(event.status) || response.status);
      } catch (error) {
        if (error instanceof ApiError) throw error;
      }
    }
  }
  return { ...result, reply };
}

export async function sendChat({ challengeIds, message, history }, { onProgress, onToken, signal } = {}) {
  const report = onProgress || onToken;
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    signal,
    body: JSON.stringify({ challengeIds, message, history }),
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
  };
}
