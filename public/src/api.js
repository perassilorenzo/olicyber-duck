/**
 * Client del backend AI. Il contesto della challenge NON viene inviato:
 * il server lo ricostruisce da `challengeId` leggendo il catalogo authoritative.
 *
 * `onProgress` (o il suo alias storico `onToken`) riceve sempre la risposta
 * CUMULATIVA, non il delta del singolo token, sia con JSON sia con SSE.
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
  let result = { mode: 'ai', model: undefined, challengeId: undefined };
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
        if (event.token) { reply += event.token; onProgress?.(reply); }
        if (event.mode) result.mode = event.mode;
        if (event.model) result.model = event.model;
        if (event.challengeId) result.challengeId = event.challengeId;
        if (event.error) throw new ApiError(event.error, response.status);
      } catch (error) {
        if (error instanceof ApiError) throw error;
      }
    }
  }
  return { ...result, reply };
}

export async function sendChat({ challengeId, message, history }, { onProgress, onToken, signal } = {}) {
  const report = onProgress || onToken;
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    signal,
    body: JSON.stringify({ challengeId, message, history }),
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
    challengeId: data.challengeId,
  };
}
