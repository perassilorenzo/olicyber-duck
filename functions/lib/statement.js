/**
 * Riconoscimento e recupero della consegna incollata dallo studente.
 *
 * La consegna NON è una fonte verificata: può essere incollata nel campo
 * dedicato oppure direttamente nella chat. In quest'ultimo caso il testo
 * resta nei messaggi della conversazione e deve poter essere ritrovato dai
 * messaggi successivi, anche quando il client non rinvia più l'estratto.
 */

import { cleanStatementExcerpt } from './validate.js';
import { isSolutionRequest } from './intent.js';

const TASK_MARKERS = Object.freeze([
  /\b(?:obiettivo|consegna|challenge|esercizio|devi|bisogna|si consiglia|si richiede|formano|isolare|ricavare|leggere|trova|trovare|presentata|ottenere|restituisce|pagina web|testo della)\b/i,
  /\b(?:what is required|objective|goal|you must|you should|recommended|the page|hidden|extract)\b/i,
]);

const TECH_MARKERS = Object.freeze([
  /\b(?:url|http|html|file|codice|codici|libreria|metodo|funzione|script|flag|writeup|payload|input|output|dati|parametro|selettore|find_all|beautifulsoup|iterare|concatenare|evidenziat\w*|caratter\w*|cookie|query|database|header|richiesta|risposta)\b/i,
  /\b(?:python|javascript|bash|regex|json|css|dom|byte|hash|tls|http)\b/i,
]);

/** True quando un messaggio dell'utente sembra essere una consegna incollata. */
export function looksLikeStatementPaste(value) {
  const text = String(value || '').trim();
  if (text.length < 70) return false;
  if (text.length < 100 && !text.includes('\n')) return false;
  if (isSolutionRequest(text)) return false;
  const hasTask = TASK_MARKERS.some((pattern) => pattern.test(text));
  const hasTech = TECH_MARKERS.some((pattern) => pattern.test(text));
  return hasTask && hasTech;
}

function idList(value) {
  return Array.isArray(value) ? value.filter((id) => typeof id === 'string') : [];
}

/**
 * Risolve la consegna effettiva per la richiesta corrente.
 * La priorità è: campo dedicato/estratto persistente, testo incollato nel
 * messaggio corrente, consegna incollata nella cronologia (anche quella vecchia:
 * una chat lunga non può fare perdere il contesto).
 *
 * `statementChallengeIds` è l'associazione dichiarata dal client: quando non
 * coincide con le challenge della richiesta, la consegna NON viene usata come
 * se appartenesse alla challenge sbagliata.
 */
export function resolveStatement({
  statementExcerpt = '', statementChallengeIds = [], challengeIds = [],
  history = [], message = '',
} = {}) {
  const associated = idList(statementChallengeIds);
  const selected = idList(challengeIds);
  const challengeMismatch = associated.length > 0
    && selected.length > 0
    && !associated.some((id) => selected.includes(id));

  const explicit = cleanStatementExcerpt(statementExcerpt);
  if (explicit && !challengeMismatch) {
    return {
      text: explicit, source: 'user-excerpt', fromCurrentMessage: false, challengeMismatch: false,
    };
  }

  const current = String(message || '').trim();
  if (looksLikeStatementPaste(current)) {
    const text = cleanStatementExcerpt(current);
    if (text) {
      return {
        text, source: 'chat-message', fromCurrentMessage: true, challengeMismatch: false,
      };
    }
  }

  // Non limitare agli ultimi messaggi: il testo incollato all'inizio di una
  // conversazione lunga deve restare recuperabile. L'ordine è dal più recente.
  const previous = Array.isArray(history)
    ? history.filter((item) => item?.role === 'user' && typeof item.content === 'string').reverse()
    : [];
  if (!challengeMismatch) {
    for (const item of previous) {
      if (!looksLikeStatementPaste(item.content)) continue;
      const text = cleanStatementExcerpt(item.content);
      if (text) {
        return {
          text, source: 'chat-history', fromCurrentMessage: false, challengeMismatch: false,
        };
      }
    }
  }
  return {
    text: '', source: 'none', fromCurrentMessage: false, challengeMismatch,
  };
}
