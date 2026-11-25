/** Validazione lato server per POST /api/chat. Nessuna dipendenza dal browser. */

export const MAX_BODY_BYTES = 16_000;
export const MAX_MESSAGE_CHARS = 4_000;
export const MAX_HISTORY_MESSAGES = 12;
export const MAX_HISTORY_CHARS = 8_000;
export const ALLOWED_ROLES = new Set(['user', 'assistant']);
export const GENERAL_CHALLENGE_ID = 'general';

const encoder = new TextEncoder();
const bytes = (value) => encoder.encode(value).length;

function clean(value, maxChars) {
  return typeof value === 'string' ? value.trim().slice(0, maxChars) : '';
}

/**
 * Il contesto della challenge NON è accettato dal client: viene ricostruito
 * lato server da challengeId. Il campo `challenge` viene ignorato.
 *
 * @returns {{ok: true, value: object} | {ok: false, error: string}}
 */
export function parseChatRequest(rawBody) {
  if (typeof rawBody !== 'string') return { ok: false, error: 'Corpo della richiesta non valido.' };
  if (bytes(rawBody) > MAX_BODY_BYTES) {
    return { ok: false, error: `Richiesta troppo grande (massimo ${MAX_BODY_BYTES} byte).` };
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return { ok: false, error: 'JSON non valido.' };
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'Formato della richiesta non valido.' };
  }

  if (typeof body.message !== 'string' || body.message.trim().length === 0) {
    return { ok: false, error: 'Inserisci un messaggio.' };
  }
  if (body.message.length > MAX_MESSAGE_CHARS || bytes(body.message) > MAX_MESSAGE_CHARS * 2) {
    return { ok: false, error: `Messaggio troppo lungo (massimo ${MAX_MESSAGE_CHARS} caratteri).` };
  }
  const message = body.message.trim();

  const challengeId = clean(body.challengeId, 64);
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(challengeId)) {
    return { ok: false, error: 'Identificativo della challenge non valido.' };
  }

  const rawHistory = body.history === undefined ? [] : body.history;
  if (!Array.isArray(rawHistory)) return { ok: false, error: 'Cronologia non valida.' };
  if (rawHistory.length > MAX_HISTORY_MESSAGES) {
    return { ok: false, error: `Cronologia troppo lunga (massimo ${MAX_HISTORY_MESSAGES} messaggi).` };
  }

  const history = [];
  let historyBytes = 0;
  for (const item of rawHistory) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, error: 'Cronologia non valida.' };
    }
    if (!ALLOWED_ROLES.has(item.role)) return { ok: false, error: 'Ruolo non valido nella cronologia.' };
    const content = clean(item.content, MAX_MESSAGE_CHARS);
    if (!content) continue;
    historyBytes += bytes(content);
    if (historyBytes > MAX_HISTORY_CHARS * 2) return { ok: false, error: 'Cronologia troppo estesa.' };
    history.push({ role: item.role, content });
  }

  return { ok: true, value: { message, challengeId, history } };
}
