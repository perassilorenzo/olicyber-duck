/** Validazione lato server per POST /api/chat. Nessuna dipendenza dal browser. */

export const MAX_BODY_BYTES = 16_000;
export const MAX_MESSAGE_CHARS = 4_000;
/** Cronologia più ampia: il server conserva ancore e scambi recenti. */
export const MAX_HISTORY_MESSAGES = 24;
export const MAX_HISTORY_CHARS = 8_000;
export const MAX_CONTEXT_CHALLENGES = 6;
/** Estratto incollato dallo studente: non è una fonte verificata. */
export const MAX_STATEMENT_CHARS = 2000;
export const ALLOWED_ROLES = new Set(['user', 'assistant']);
export const GENERAL_CHALLENGE_ID = 'general';

const ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const encoder = new TextEncoder();
const bytes = (value) => encoder.encode(value).length;

function clean(value, maxChars) {
  return typeof value === 'string' ? value.trim().slice(0, maxChars) : '';
}

/**
 * L'estratto della consegna è input non attendibile: può contenere flag o
 * istruzioni. Viene limitato, ripulito dai caratteri di controllo e privato dei
 * flag evidenti prima di entrare nel contesto del modello. Non viene mai
 * confrontato con il catalogo né salvato come fonte verificata.
 */
export function cleanStatementExcerpt(value) {
  let text = clean(value, MAX_STATEMENT_CHARS);
  // Le interruzioni di riga sono parte della consegna: vengono conservate,
  // mentre gli spazi orizzontali e i caratteri di controllo vengono normalizzati.
  text = text.replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  text = text
    .replace(/\b(?:flag|olicyber|ctf|ITASEC|OBUDMW|ptm|cnvlbd|cixd|xcqv|fzau|synt|cyvz)\s*[{\[][^\]}]{0,240}[\]}]/gis, '[TESTO RIMOSSO]')
    .replace(/\b[A-Za-z][A-Za-z0-9_]*\s*\{\s*[A-Za-z0-9]{8,}[!?]?\s*\}/gi, '[TESTO RIMOSSO]')
    .replace(/\bflag\s*[:=]\s*[^\s`"']{6,}/gi, '[TESTO RIMOSSO]')
    // Flag troncata dal limite di lunghezza: il valore va rimosso anche senza
    // parentesi di chiusura. Il prefisso nudo «flag{» resta, perché può essere
    // parte della spiegazione del formato richiesto dalla consegna.
    .replace(/\bflag\s*[{\[]\s*(?=[A-Za-z0-9_])[^\s}\]]{1,240}/gi, '[TESTO RIMOSSO]');
  return text.slice(0, MAX_STATEMENT_CHARS);
}

/**
 * Il contesto delle challenge NON è accettato dal client: vengono accettati
 * solo ID, che il server risolve nel catalogo authoritative. Qualsiasi campo
 * `challenge` inviato dal browser viene ignorato. L'eventuale `statementExcerpt`
 * è un estratto incollato dallo studente: trattato come dato non attendibile e
 * ripulito, mai come fonte verificata.
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

  // Compatibilità: i client storici inviavano un singolo `challengeId`.
  const rawIds = body.challengeIds !== undefined
    ? body.challengeIds
    : (body.challengeId ? [body.challengeId] : []);
  if (!Array.isArray(rawIds) || rawIds.length > MAX_CONTEXT_CHALLENGES) {
    return { ok: false, error: `Puoi selezionare al massimo ${MAX_CONTEXT_CHALLENGES} challenge.` };
  }

  const challengeIds = [];
  for (const rawId of rawIds) {
    const id = clean(rawId, 64);
    if (!ID_PATTERN.test(id)) {
      return { ok: false, error: 'Identificativo della challenge non valido.' };
    }
    if (id === GENERAL_CHALLENGE_ID) continue;
    if (!challengeIds.includes(id)) challengeIds.push(id);
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

  return {
    ok: true,
    value: {
      message,
      challengeIds,
      history,
      statementExcerpt: cleanStatementExcerpt(body.statementExcerpt),
    },
  };
}
