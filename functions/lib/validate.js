/** Validazione lato server per POST /api/chat. Nessuna dipendenza dal browser. */

export const MAX_BODY_BYTES = 16_000;
export const MAX_MESSAGE_CHARS = 4_000;
export const MAX_HISTORY_MESSAGES = 12;
export const MAX_HISTORY_CHARS = 8_000;
export const MAX_CONTEXT_CHARS = 6_000;
export const ALLOWED_ROLES = new Set(['user', 'assistant']);

const encoder = new TextEncoder();

function clean(value, max) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * @returns {{ok: true, value: object} | {ok: false, error: string}}
 */
export function parseChatRequest(rawBody, { now = Date.now() } = {}) {
  if (typeof rawBody !== 'string') return { ok: false, error: 'Corpo della richiesta non valido.' };
  if (encoder.encode(rawBody).length > MAX_BODY_BYTES) {
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
  if (body.message.length > MAX_MESSAGE_CHARS) {
    return { ok: false, error: `Messaggio troppo lungo (massimo ${MAX_MESSAGE_CHARS} caratteri).` };
  }
  const message = body.message.trim();

  const challengeId = clean(body.challengeId, 64);
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(challengeId)) {
    return { ok: false, error: 'Identificativo della challenge non valido.' };
  }

  const rawChallenge = body.challenge;
  if (!rawChallenge || typeof rawChallenge !== 'object' || Array.isArray(rawChallenge)) {
    return { ok: false, error: 'Contesto della challenge mancante.' };
  }

  const challenge = {
    id: challengeId,
    title: clean(rawChallenge.title, 160) || 'Challenge senza titolo',
    category: clean(rawChallenge.category, 80) || 'Non specificata',
    difficulty: clean(rawChallenge.difficulty, 40) || 'Non specificata',
    description: clean(rawChallenge.description, 800),
    statement: clean(rawChallenge.statement, 3000),
    tags: Array.isArray(rawChallenge.tags)
      ? rawChallenge.tags.filter((tag) => typeof tag === 'string').slice(0, 12).map((tag) => clean(tag, 60))
      : [],
    learningGoals: Array.isArray(rawChallenge.learningGoals)
      ? rawChallenge.learningGoals.filter((goal) => typeof goal === 'string').slice(0, 8).map((goal) => clean(goal, 160))
      : [],
    hintTopics: Array.isArray(rawChallenge.hintTopics)
      ? rawChallenge.hintTopics.filter((topic) => typeof topic === 'string').slice(0, 8).map((topic) => clean(topic, 120))
      : [],
    demo: rawChallenge.demo === true,
  };

  const rawHistory = body.history === undefined ? [] : body.history;
  if (!Array.isArray(rawHistory)) return { ok: false, error: 'Cronologia non valida.' };
  if (rawHistory.length > MAX_HISTORY_MESSAGES) {
    return { ok: false, error: `Cronologia troppo lunga (massimo ${MAX_HISTORY_MESSAGES} messaggi).` };
  }

  const history = [];
  let totalChars = 0;
  for (const item of rawHistory) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return { ok: false, error: 'Cronologia non valida.' };
    }
    if (!ALLOWED_ROLES.has(item.role)) return { ok: false, error: 'Ruolo non valido nella cronologia.' };
    const content = clean(item.content, MAX_MESSAGE_CHARS);
    if (!content) continue;
    totalChars += content.length;
    if (totalChars > MAX_HISTORY_CHARS) {
      return { ok: false, error: 'Cronologia troppo estesa.' };
    }
    history.push({ role: item.role, content });
  }

  const size = encoder.encode(JSON.stringify(challenge)).length;
  if (size > MAX_CONTEXT_CHARS) return { ok: false, error: 'Contesto della challenge troppo esteso.' };

  return { ok: true, value: { message, challengeId, challenge, history, receivedAt: now } };
}
