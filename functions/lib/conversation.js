/**
 * Stato conversazionale e follow-up contestuali del tutor.
 *
 * Il classificatoro di `intent.js` resta il controllo deterministico sul
 * messaggio corrente; qui si ricostruisce il filo del dialogo senza usare il
 * modello. I dati estratti sono descrittori grezzi (argomento, tecnologie
 * esplicitamente menzionate, intento precedente), non istruzioni per il
 * modello e non contenuto verificato delle challenge.
 */

import { INTENTS, classifyIntent, isSolutionRequest } from './intent.js';
import { looksLikeStatementPaste, resolveStatement } from './statement.js';

const CORRECTION = /\b(?:intendo|intendevo|voglio dire|cioe|cioè|no[, ]|non quello|piuttosto|esattamente|in realta|in realtà|nel mio caso|nel codice|nella mia challenge|in python|in flask|in django|con requests)\b/i;
const CONTINUATION = /\b(?:continua|vai avanti|prosegui|ancora|approfondisci|e come funziona|e perche|e perché|perche|perché|questo|quello|la parte|quel punto|e nella challenge|nella challenge|e il resto|il resto|e allora)\b/i;
const EXAMPLE = /\b(?:fammi|mostrami|scrivimi|un esempio|esempio|per esempio|mostra un)\b/i;
const CONFUSION = /\b(?:non ho capito|non capisco|non e chiaro|non è chiaro|non mi e chiaro|non mi è chiaro|riformula|spiegami meglio|piu semplice|più semplice)\b/i;

const FOLLOW_UP_CUES = Object.freeze([
  { type: 'correction', pattern: CORRECTION },
  { type: 'continuation', pattern: CONTINUATION },
  { type: 'example', pattern: EXAMPLE },
  { type: 'confusion', pattern: CONFUSION },
]);

const STATEMENT_OBJECT = /\b(?:consegna|statement|testo (?:della|del|dell)|obiettivo dell|cosa mi viene chiesto|cosa devo fare|cosa chiede|requirements?|what am i asked)\b/i;

/**
 * Richieste brevi che, in presenza di una consegna già incollata, continuano
 * la sua spiegazione: «adesso spiega», «non ho capito», «come si fa».
 */
const STATEMENT_EXPLANATION = /\b(?:spiega|spiegami|spiegare|consegna|cosa devo fare|che cosa devo fare|come si fa|come faccio|come si procede|non ho capito|non capisco|obiettivo|adesso|ora|continua|vai avanti|approfondisci|e ora|e adesso|questo|quello)\b/i;
// Una domanda su un concetto specifico resta una spiegazione teorica, anche
// quando una consegna è disponibile.
const CONCEPT_EXPLANATION = /\b(?:cos[' ]?e|che cos[' ]?e|cosa significa|definizione|definisci|teoria|concetto di|differenza tra|come funziona|significato di)\b/i;

const TOPIC_PATTERNS = Object.freeze([
  { label: 'sessioni', pattern: /\bsession(?:e|i)?\b|\bsession\b/i },
  { label: 'cookie', pattern: /\bcookie\b/i },
  { label: 'CSRF', pattern: /\bcsrf\b|\bcross[-\s]?site request forgery\b/i },
  { label: 'funzioni hash', pattern: /\bhash\b|\bargon2\b|\bsha-\d\b/i },
  { label: 'TLS/HTTPS', pattern: /\btls\b|\bhttps\b|\bssl\b/i },
  { label: 'XSS', pattern: /\bxss\b|\bcross[-\s]?site scripting\b/i },
  { label: 'SQL', pattern: /\bsql\b|\bquery\b/i },
  { label: 'rete e TCP/IP', pattern: /\btcp\b|\bip\b|\bporte?\b|\brete\b/i },
  { label: 'forensica digitale', pattern: /\bforensic\w*\b/i },
  { label: 'autenticazione', pattern: /\bautenticazion\w*\b|\blogin\b/i },
]);

/** Tecnologie e framework solo se esplicitamente menzionati: mai dedotti. */
const TECHNOLOGY_PATTERNS = Object.freeze([
  { label: 'Python', pattern: /\bpython\b/i },
  { label: 'requests.Session()', pattern: /\brequests(?:\.session)?\b|\brequests session\b/i },
  { label: 'Flask', pattern: /\bflask\b/i },
  { label: 'Django', pattern: /\bdjango\b/i },
  { label: 'JavaScript', pattern: /\bjava\s?script\b|\bjs\b/i },
  { label: 'DOM', pattern: /\bdom\b/i },
  { label: 'fetch', pattern: /\bfetch\b/i },
  { label: 'Promise', pattern: /\bpromise\b/i },
  { label: 'sessionStorage', pattern: /\bsessionstorage\b/i },
  { label: 'localStorage', pattern: /\blocalstorage\b/i },
  { label: 'C', pattern: /\b(?:in|linguaggio|programmazione in)\s+c\b|\bc\+\+\b/i },
  { label: 'C#', pattern: /\bc#\b|\bcsharp\b|\.net\b/i },
  { label: 'HTML', pattern: /\bhtml\b/i },
  { label: 'CSS', pattern: /\bcss\b/i },
  { label: 'SQL', pattern: /\bsql\b/i },
]);

const EDUCATIONAL_INTENTS = new Set([
  INTENTS.EXPLAIN_CONCEPT,
  INTENTS.EXPLAIN_STATEMENT,
  INTENTS.REQUEST_HINT,
  INTENTS.REVIEW_REASONING,
]);

function userTexts(history, message) {
  const previous = Array.isArray(history)
    ? history.filter((item) => item?.role === 'user' && typeof item.content === 'string')
      .map((item) => item.content.trim())
      .filter(Boolean)
    : [];
  return [...previous, String(message || '').trim()].filter(Boolean);
}

function detectFromTexts(texts, patterns, limit) {
  const found = [];
  for (const text of [...texts].reverse()) {
    for (const { label, pattern } of patterns) {
      if (pattern.test(text) && !found.includes(label)) found.push(label);
    }
  }
  return found.slice(0, limit);
}

/** Argomenti già discussi, dal più recente al meno recente. */
export function detectTopics(history, message) {
  return detectFromTexts(userTexts(history, message), TOPIC_PATTERNS, 3);
}

/** Tecnologie menzionate esplicitamente, dal messaggio corrente alla cronologia. */
export function detectTechnologies(history, message) {
  return detectFromTexts(userTexts(history, message), TECHNOLOGY_PATTERNS, 6);
}

/** Tipo di riferimento contestuale nel messaggio corrente, se presente. */
export function followUpKind(message) {
  const text = String(message || '').trim();
  for (const { type, pattern } of FOLLOW_UP_CUES) {
    if (pattern.test(text)) return type;
  }
  return null;
}

function lastEducationalExchange(history) {
  if (!Array.isArray(history)) return null;
  let previousUser = null;
  let previousAssistant = null;
  let intent = null;
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index];
    if (!item || typeof item.content !== 'string') continue;
    if (item.role === 'assistant' && !previousAssistant) {
      previousAssistant = item.content;
    } else if (item.role === 'user' && !previousUser) {
      previousUser = item.content;
      const candidate = classifyIntent(item.content);
      intent = EDUCATIONAL_INTENTS.has(candidate) ? candidate : null;
    }
    if (previousUser && previousAssistant) break;
  }
  return previousUser ? { previousUser, previousAssistant, intent } : null;
}

function hasSolutionRequestInHistory(history) {
  return Array.isArray(history) && history.some((item) => item?.role === 'user'
    && typeof item.content === 'string'
    // Una consegna incollata può contenere la parola «flag» senza essere una
    // richiesta di rivelarla: non deve innescare il blocco dei follow-up.
    && !looksLikeStatementPaste(item.content)
    && isSolutionRequest(item.content));
}

/**
 * Classificazione che tiene conto del dialogo precedente.
 *
 * Non può essere usata per aggirare un rifiuto: una richiesta esplicita di
 * soluzione nel messaggio corrente o un «continua» dopo un rifiuto resta
 * bloccata. I messaggi didattici espliciti e privi di riferimenti contestuali
 * mantengono il loro intento originale.
 */
export function classifyIntentInContext(history = [], message = '', options = {}) {
  const current = classifyIntent(message);
  if (current === INTENTS.REQUEST_SOLUTION) return current;
  if (current === INTENTS.CLARIFY && /\b(?:stressat|ansia|depress|trist|esaust|stanch|sopraffatt|non ce la faccio|disperat)/i.test(String(message))) {
    return current;
  }

  const cue = followUpKind(message);
  const isPaste = looksLikeStatementPaste(message);
  // Dopo un rifiuto, un riferimento come «continua» non riapre la soluzione.
  if (cue === 'continuation' && hasSolutionRequestInHistory(history) && !isPaste) {
    return INTENTS.REQUEST_SOLUTION;
  }
  // Un blocco incollato è una nuova consegna: va spiegata, non chiesta di nuovo
  // e non trattata come richiesta di soluzione solo perché contiene «flag».
  if (isPaste) return INTENTS.STATEMENT_PROVIDED;

  const statement = resolveStatement({ ...options, history, message });
  if (statement.text) {
    if (current === INTENTS.REQUEST_HINT || current === INTENTS.REVIEW_REASONING) return current;
    if (cue === 'example' && String(message).trim().length < 60) return INTENTS.FOLLOW_UP;
    const asksAboutStatement = STATEMENT_EXPLANATION.test(String(message))
      && !CONCEPT_EXPLANATION.test(String(message));
    if (asksAboutStatement || current === INTENTS.EXPLAIN_STATEMENT) {
      return INTENTS.EXPLAIN_STATEMENT;
    }
    // Un messaggio breve come «e ora?» o «ok» con una consegna disponibile
    // riprende la spiegazione invece di aprire un menu generico.
    if (current === INTENTS.CLARIFY && (cue || String(message).trim().length < 40)) {
      return INTENTS.EXPLAIN_STATEMENT;
    }
    if (cue) return INTENTS.FOLLOW_UP;
    return current;
  }

  const prior = lastEducationalExchange(history);
  const hasPriorTopic = Boolean(prior?.previousUser) || detectTopics(history, message).length > 0;
  if (!hasPriorTopic) {
    // «Non ho capito» senza argomento precedente non può significare
    // automaticamente «spiegami la consegna».
    if (cue === 'confusion' && current === INTENTS.EXPLAIN_STATEMENT
      && !STATEMENT_OBJECT.test(String(message))) return INTENTS.CLARIFY;
    return current;
  }

  const isConfusionAboutPrevious = cue === 'confusion'
    && current === INTENTS.EXPLAIN_STATEMENT
    && !STATEMENT_OBJECT.test(String(message));
  const shouldFollowUp = Boolean(cue) && (
    current === INTENTS.CLARIFY
    || isConfusionAboutPrevious
    || (current === INTENTS.EXPLAIN_CONCEPT && ['continuation', 'example', 'confusion'].includes(cue))
    || (current === INTENTS.REVIEW_REASONING && cue === 'continuation' && String(message).length < 80)
  );

  if (!shouldFollowUp) return current;
  if (hasSolutionRequestInHistory(history) && !currentIsFreshRequest(message, cue)) {
    return INTENTS.REQUEST_SOLUTION;
  }
  return INTENTS.FOLLOW_UP;
}

function currentIsFreshRequest(message, cue) {
  return !cue && classifyIntent(message) !== INTENTS.CLARIFY
    && String(message || '').trim().length > 20;
}

/**
 * Descrittori strutturati del dialogo, inviati al modello in un blocco
 * separato e usati per scegliere retrieval e metadati di risposta.
 */
export function conversationState(history = [], message = '', options = {}) {
  const prior = lastEducationalExchange(history);
  const cue = followUpKind(message);
  const technologies = detectTechnologies(history, message);
  const statement = resolveStatement({ ...options, history, message });
  const isPaste = looksLikeStatementPaste(message);
  const followUp = !isPaste && Boolean(cue
    || (technologies.length && classifyIntent(message) === INTENTS.CLARIFY && Boolean(prior)));
  return {
    followUp,
    kind: cue
      || (statement.text && STATEMENT_EXPLANATION.test(String(message))
        ? 'statement-explanation'
        : (followUp ? 'technical-detail' : null)),
    topics: detectTopics(history, message),
    technologies,
    previousIntent: prior?.intent || null,
    statementAvailable: Boolean(statement.text),
    statementSource: statement.source,
    statementChallengeMismatch: Boolean(statement.challengeMismatch),
    statementMessageIsPaste: isPaste,
    challengeLinkRequested: /\b(?:challenge|esercizio|nel mio caso)\b/i.test(String(message || '')),
    solutionRequestInHistory: hasSolutionRequestInHistory(history),
  };
}

/**
 * Seleziona i messaggi essenziali per conversazioni lunghe: le prime domande
 * che stabiliscono l'argomento e gli scambi più recenti, sempre in ordine.
 */
export function selectRelevantHistory(history = [], maxMessages = 12, anchorCount = 2) {
  if (!Array.isArray(history) || history.length <= maxMessages) return history;
  const anchors = history.filter((item) => item?.role === 'user').slice(0, anchorCount);
  const recent = history.slice(Math.max(0, history.length - (maxMessages - anchors.length)));
  const kept = new Set([...anchors, ...recent]);
  return history.filter((item) => kept.has(item));
}
