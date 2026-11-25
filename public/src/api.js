/**
 * Client del backend AI. `sendChat` espone già un callback per token:
 * oggi il backend risponde con JSON, ma se in futuro risponderà in SSE
 * l'UI continuerà a funzionare senza modifiche.
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

async function readEventStream(response, onToken) {
  const reader = response.body?.getReader();
  if (!reader) throw new ApiError('Streaming non disponibile.', response.status);
  const decoder = new TextDecoder();
  let buffer = '';
  let reply = '';
  let mode = 'ai';
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
        if (event.token) { reply += event.token; onToken?.(reply); }
        if (event.mode) mode = event.mode;
        if (event.error) throw new ApiError(event.error, response.status);
      } catch (error) {
        if (error instanceof ApiError) throw error;
      }
    }
  }
  return { reply, mode };
}

export async function sendChat({ challengeId, challenge, message, history }, { onToken, signal } = {}) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    signal,
    body: JSON.stringify({ challengeId, challenge, message, history }),
  });
  if (!response.ok) throw await readError(response);

  const type = response.headers.get('content-type') || '';
  if (type.includes('text/event-stream')) return readEventStream(response, onToken);

  const data = await response.json();
  if (typeof data?.reply !== 'string') throw new ApiError('Risposta del backend non valida.', response.status);
  onToken?.(data.reply);
  return { reply: data.reply, mode: data.mode || 'ai', model: data.model };
}
