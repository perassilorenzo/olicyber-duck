/**
 * Riconoscimento locale della consegna incollata in chat.
 * Il server applica la stessa logica in `functions/lib/statement.js` e
 * `functions/lib/validate.js`: qui serve solo a salvare subito l'estratto nello
 * stato della conversazione, prima che il messaggio lasci il browser.
 */

export const MAX_STATEMENT_CHARS = 2000;

const TASK_MARKERS = [
  /\b(?:obiettivo|consegna|challenge|esercizio|devi|bisogna|si consiglia|si richiede|formano|isolare|ricavare|leggere|trova|trovare|presentata|ottenere|restituisce|pagina web|testo della)\b/i,
  /\b(?:what is required|objective|goal|you must|you should|recommended|the page|hidden|extract)\b/i,
];

const TECH_MARKERS = [
  /\b(?:url|http|html|file|codice|codici|libreria|metodo|funzione|script|flag|writeup|payload|input|output|dati|parametro|selettore|find_all|beautifulsoup|iterare|concatenare|evidenziat\w*|caratter\w*|cookie|query|database|header|richiesta|risposta)\b/i,
  /\b(?:python|javascript|bash|regex|json|css|dom|byte|hash|tls|http)\b/i,
];

/** True quando un messaggio dell'utente sembra essere una consegna incollata. */
export function looksLikeStatementPaste(value) {
  const text = String(value || '').trim();
  if (text.length < 70) return false;
  if (text.length < 100 && !text.includes('\n')) return false;
  return TASK_MARKERS.some((pattern) => pattern.test(text))
    && TECH_MARKERS.some((pattern) => pattern.test(text));
}

/** Copia di `cleanStatementExcerpt` lato server: rimuove i flag evidenti. */
export function cleanStatementExcerpt(value) {
  let text = typeof value === 'string' ? value.trim().slice(0, MAX_STATEMENT_CHARS) : '';
  text = text.replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
    .replace(/[^\S\n]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  text = text
    .replace(/\b(?:flag|olicyber|ctf|ITASEC|OBUDMW|ptm|cnvlbd|cixd|xcqv|fzau|synt|cyvz)\s*[{\[][^\]}]{0,240}[\]}]/gis, '[TESTO RIMOSSO]')
    .replace(/\b[A-Za-z][A-Za-z0-9_]*\s*\{\s*[A-Za-z0-9]{8,}[!?]?\s*\}/gi, '[TESTO RIMOSSO]')
    .replace(/\bflag\s*[:=]\s*[^\s`"']{6,}/gi, '[TESTO RIMOSSO]')
    .replace(/\bflag\s*[{\[]\s*(?=[A-Za-z0-9_])[^\s}\]]{1,240}/gi, '[TESTO RIMOSSO]');
  return text.slice(0, MAX_STATEMENT_CHARS);
}
