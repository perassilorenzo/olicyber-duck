/**
 * Controllo best-effort di completezza strutturale dell'output del modello.
 *
 * Non giudica la correttezza tecnica e non riscrive il contenuto: intercetta
 * solo risposte palesemente incomplete, così l'handler può tentare una sola
 * rigenerazione controllata invece di mostrarle allo studente.
 */

const EMPTY_LIST_ITEM = /(?:^|\n)\s*\d+[.)]\s*(?=\n|$)/m;
const GENERIC_PREFIXES = [
  'Non sono sicuro di cosa ti serva',
  'Non ho il testo della consegna',
  'Non posso fornire flag',
];

function headingWithoutContent(text) {
  const lines = String(text || '').split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (!/^(?:#{1,6}\s+[^\n]{2,80}|[A-Z][^:\n]{2,70}:)$/.test(line)) continue;
    const next = lines.slice(index + 1).find((value) => value.trim());
    if (!next || /^\d+[.)]\s*$/.test(next.trim())) return true;
  }
  return false;
}

function truncatedTail(text) {
  const lines = String(text || '').split('\n').map((line) => line.trim()).filter(Boolean);
  const last = lines.at(-1) || '';
  if (!last) return true;
  if (/[,;:]$/.test(last)) return true;
  if (/\b(?:e|che|di|per|perché|perche|come|il|la|lo|gli|le|un|una|con|da|su|questa|questo|quale|quali|dove|quando)\s*$/i.test(last)) {
    return true;
  }
  // `*` e `~` chiudono Markdown in grassetto/corsivo: non sono troncamenti.
  return last.length >= 28 && !/[.!?…:)\]}`»"*~]$/.test(last);
}

function repeatedFallback(text, history) {
  const normalize = (value) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 90);
  const prefix = normalize(text);
  if (!GENERIC_PREFIXES.some((item) => prefix.startsWith(item))) return false;
  return Array.isArray(history) && history.some((item) => item?.role === 'assistant'
    && normalize(item.content) === prefix);
}

/**
 * @returns {{incomplete: boolean, reasons: string[]}}
 */
export function analyzeReply(reply, { history = [] } = {}) {
  const text = String(reply || '').trim();
  const reasons = [];
  if (!text) reasons.push('empty');
  if (EMPTY_LIST_ITEM.test(text)) reasons.push('empty-list-item');
  if (headingWithoutContent(text)) reasons.push('heading-without-content');
  if ((text.match(/```/g) || []).length % 2 === 1) reasons.push('unclosed-code-block');
  if (truncatedTail(text)) reasons.push('truncated-sentence');
  if (repeatedFallback(text, history)) reasons.push('repeated-fallback');
  return { incomplete: reasons.length > 0, reasons };
}
