/**
 * Normalizzazione del testo destinato alla Knowledge Base.
 *
 * Regole:
 * - i placeholder di redaction sono protetti prima di rimuovere il Markdown;
 * - la redaction copre flag con parentesi graffe, quadre, tonde, con o senza
 *   underscore, in maiuscolo e in minuscolo;
 * - i percorsi sorgente vengono protetti: non sono mai trasformati in token;
 * - le righe `Fonte:` non finiscono nel testo destinato al modello.
 */

export const PLACEHOLDERS = Object.freeze({
  flag: '[FLAG_RIMOSSA]',
  secret: '[SEGRETO_RIMOSSO]',
  token: '[TOKEN_RIMOSSO]',
});

const PLACEHOLDER_RE = /\[(?:FLAG_RIMOSSA|SEGRETO_RIMOSSO|TOKEN_RIMOSSO)\]/g;
const DEFORMED_PLACEHOLDER_RE = /\[(?:FLAG|SEGRETO|TOKEN)RIMOSS[OA]\]/g;
const CANONICAL_PLACEHOLDER = Object.freeze({
  FLAG: PLACEHOLDERS.flag,
  SEGRETO: PLACEHOLDERS.secret,
  TOKEN: PLACEHOLDERS.token,
});

const BRACKET_OPEN = '[{\\[(]';
const BRACKET_CLOSE = '[}\\])]';
const FLAG_PREFIX = '(?:flag|itasec|ita|ctf|oliduck)';
const FLAG_SHAPE = `${FLAG_PREFIX}[_\\s-]*(?:[A-Za-z0-9]+[_\\s-]*)?${BRACKET_OPEN}\\s*[^\\]})\\n]{1,240}\\s*${BRACKET_CLOSE}`;

/** Pattern non globale, condiviso con il gate di pubblicazione. */
export const FLAG_LIKE_PATTERN = new RegExp(FLAG_SHAPE, 'i');
const FLAG_LIKE_GLOBAL = new RegExp(FLAG_SHAPE, 'gi');

const SOURCE_PATH_PATTERN = /(?:official-writeups|community-solutions|\.git)\/[^\s,;]+/gi;
const SOURCE_LINE_PATTERN = /^\s*(?:fonte|source|provenienza)\s*:/im;

/** Ripristina eventuali placeholder deformati (es. `[FLAGRIMOSSA]`). */
export function restorePlaceholders(value) {
  return String(value ?? '').replace(DEFORMED_PLACEHOLDER_RE, (match) => (
    CANONICAL_PLACEHOLDER[match.slice(1, -1).replace(/RIMOSS[OA]$/, '')] ?? match
  ));
}

/** Rimuove segreti e formati flag-like dal testo libero. */
export function redactSecrets(value) {
  const sourcePaths = [];
  let text = restorePlaceholders(value)
    .replace(SOURCE_PATH_PATTERN, (match) => {
      const token = `\u0001P${sourcePaths.length}\u0001`;
      sourcePaths.push(match);
      return token;
    });

  text = text
    .replace(FLAG_LIKE_GLOBAL, PLACEHOLDERS.flag)
    // Base64 senza '/': non può confondere percorsi come community-solutions/... .
    .replace(/\b[A-Za-z0-9+]{48,}={0,2}\b/g, PLACEHOLDERS.token)
    // Base64 con '/' viene riconosciuto solo quando ha padding finale.
    .replace(/\b[A-Za-z0-9+/]{48,}={1,2}\b/g, PLACEHOLDERS.token);

  return text.replace(/\u0001P(\d+)\u0001/g, (_, index) => sourcePaths[Number(index)]);
}

/** Pulisce il Markdown preservando intatti i placeholder già presenti. */
export function cleanMarkdown(value) {
  const placeholders = [];
  let text = restorePlaceholders(value);

  text = text.replace(PLACEHOLDER_RE, (match) => {
    const token = `\u0000PH${placeholders.length}\u0000`;
    placeholders.push(match);
    return token;
  });

  text = text
    .replace(/!\[[^\]]*\]\([^)]+\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return text.replace(/\u0000PH(\d+)\u0000/g, (_, index) => placeholders[Number(index)]);
}

/** Rimuove righe che dichiarano la fonte: la provenienza va nei campi strutturati. */
export function stripSourceLines(value) {
  return String(value ?? '')
    .split(/\r?\n/)
    .filter((line) => !SOURCE_LINE_PATTERN.test(line))
    .join('\n');
}

/** Pipeline completa per un testo che può entrare in un documento KB. */
export function normalizeForTutor(value) {
  return cleanMarkdown(redactSecrets(stripSourceLines(value)));
}
