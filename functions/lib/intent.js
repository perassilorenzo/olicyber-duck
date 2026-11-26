/**
 * Classificazione deterministica dell'intento didattico.
 *
 * Il classificatore è lato server e NON sostituisce il system prompt: decide
 * solo se una richiesta può procedere, se va rifiutata oppure se conviene
 * chiedere un chiarimento. Non usa il modello e non può essere influenzato da
 * testi diversi dal messaggio corrente.
 *
 * Regola principale: una parola come "flag", "exploit", "payload", "challenge"
 * o "risolvere" NON basta a bloccare. Serve una richiesta esplicita di
 * produrre una soluzione. Nei casi ambigui si chiede un chiarimento.
 */

export const INTENTS = Object.freeze({
  EXPLAIN_STATEMENT: 'explain_statement',
  EXPLAIN_CONCEPT: 'explain_concept',
  REQUEST_HINT: 'request_hint',
  REVIEW_REASONING: 'review_reasoning',
  REQUEST_SOLUTION: 'request_solution',
  CLARIFY: 'clarify',
});

/** Livelli di progressione degli hint: 1 concetto, 2 osservazione, 3 ipotesi. */
export const MAX_HINT_STAGE = 3;

function normalize(message) {
  return String(message || '')
    .toLocaleLowerCase('it')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[’`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

const SOLUTION_NOUN = '(?:flag|writeup|soluzione|solution|payload|exploit|risoluzione|script risolutivo|walkthrough)';

// "Dammi la flag", "Write the writeup", "Scrivimi un payload": oggetto diretto.
const DIRECT_OBJECT = new RegExp(
  `\\b(?:dammi|darmi|dimmi|dirmi|scrivimi|scrivermi|generami|genera|forniscimi|fornisci|passami|mandami|mostrami|mostra|give me|send me|write me|write the|show me|provide me)\\s+`
  + `(?:mi\\s+)?(?:la\\s+|il\\s+|lo\\s+|un\\s+|uno\\s+|the\\s+|a\\s+)?${SOLUTION_NOUN}\\b`,
  'i',
);

// Domande teoriche in cui compaiono termini "sensibili" come oggetto di studio.
const THEORETICAL_OBJECT = new RegExp(
  `\\b(?:definizione di|definisci|cos[' ]?e|che cos[' ]?e|cosa significa|significato di|what is|spiegazione di|teoria di)\\b[^.?!]{0,50}\\b${SOLUTION_NOUN}\\b`,
  'i',
);

// Richieste indirette ma ancora esplicite di risoluzione.
const INDIRECT_SOLUTION = [
  new RegExp(`\\b(?:come|modo per|maniera di)\\s+(?:ottenere|conseguire|trovare|recuperare|calcolare|generare|estrarre|risolvere|bypassare|aggirare)\\b[^.?!]{0,60}\\b(?:${SOLUTION_NOUN}|questa challenge|this challenge|la sfida)\\b`, 'i'),
  /\b(?:solve|risolvi|risolvere)\b[^.?!]{0,60}\b(?:for me|per me|questa challenge|this challenge|la sfida|this exercise)\b/i,
  /^\s*(?:come|come si)\s+risolvere\b[^.?!]{0,60}\b(?:questa|la|the|this)\s+(?:challenge|sfida|esercizio)\b/i,
  /\b(?:scrivi|scrivimi|write|write me)\b[^.?!]{0,40}\bwriteup\b/i,
  new RegExp(`\\b(?:${SOLUTION_NOUN})\\s+(?:complet[ao]|esatta|exact|definitiva|finale|full|complete)\\b`, 'i'),
];

const HAS_SOLUTION_NOUN = new RegExp(`\\b${SOLUTION_NOUN}\\b`, 'i');
const THEORY = /\b(?:spiega|spiegami|spiegare|spiegarmi|cos[' ]?e|cosa significa|che cos[' ]?e|definizione|definisci|teoria|teorico|teorica|concetto|concetti|come funziona|funzionamento|perche|differenza|significa|termine|termini|capire|comprendere|what is|explain|how does|theory|difference|understanding)\b/;
const HINT = /\b(?:hint|suggerimento|indizio|primo passo|un aiuto|aiutami a iniziare|come inizio|da dove inizio|suggestion|nudge|inizio)\b/;
const HINT_SECOND = /\b(?:secondo|un altro|ancora un|prossimo|piu (?:specifico|dettagliato))\s+(?:hint|suggerimento|indizio)\b/;
const HINT_THIRD = /\b(?:terzo|ultimo|ancora piu specifico)\s+(?:hint|suggerimento|indizio)\b/;
// "Volevo fare una query con Bash..." è un'idea sottoposta a verifica, non una
// richiesta di soluzione: va analizzata, non etichettata come non pertinente.
const REASONING = new RegExp(
  '\\b(?:ragionamento|ragionare|ho provato|ho pensato|pensavo|stavo pensando|'
  + 'volevo fare|voglio fare|stavo per|la mia idea|il mio piano|mi era venuto in mente|'
  + 'e corretto|corretto|giusto|verifica|verificare|check my|review my|sono sulla strada|'
  + 'il mio approccio|la mia ipotesi|fare una query|query con|automatizz(?:are|o|i)|'
  + 'powershell)\\b',
  'i',
);
const STATEMENT = /\b(?:consegna|testo dell'esercizio|testo della challenge|testo del problema|cosa mi viene chiesto|cosa devo fare|cosa chiede|non ho capito|non capisco|obiettivo dell'esercizio|statement|requirements?|what am i asked|i don't understand)\b/;
// Rilevamento separato: la difficoltà personale NON modifica le regole di
// sicurezza e NON sostituisce un intento didattico esplicito.
const PERSONAL_DISTRESS = new RegExp(
  '\\b(?:stressat[aoie]|ansios[aoie]|ansia|depress[aoie]|trist[aoie]|esaust[aoie]|'
  + 'stanch[aoie]|sopraffatt[aoie]|non ce la faccio|non sto bene|mi sento (?:male|giu|solo|perso)|'
  + 'giornata terribile|problemi personali|difficolta personale|crisi emotiva|'
  + 'ho bisogno di aiuto|mi dispiace|disperat[aoie])\\b',
  'i',
);

/**
 * @returns {'explain_statement'|'explain_concept'|'request_hint'|'review_reasoning'|'request_solution'|'clarify'}
 */
export function classifyIntent(message) {
  const text = normalize(message);
  if (!text) return INTENTS.CLARIFY;

  // L'oggetto diretto prevale sempre sulle eccezioni teoriche.
  if (DIRECT_OBJECT.test(text)) return INTENTS.REQUEST_SOLUTION;

  // "Che cos'è una flag?" è teoria, non una richiesta di rivelazione.
  if (THEORETICAL_OBJECT.test(text)) return INTENTS.EXPLAIN_CONCEPT;

  if (INDIRECT_SOLUTION.some((pattern) => pattern.test(text))) {
    return INTENTS.REQUEST_SOLUTION;
  }

  const hasSolutionNoun = HAS_SOLUTION_NOUN.test(text);
  const hasTheory = THEORY.test(text);
  const hasHint = HINT.test(text);
  const hasReasoning = REASONING.test(text);
  const hasStatement = STATEMENT.test(text);

  if (hasTheory) {
    if (hasStatement) return INTENTS.EXPLAIN_STATEMENT;
    if (hasReasoning) return INTENTS.REVIEW_REASONING;
    if (hasHint) return INTENTS.REQUEST_HINT;
    return INTENTS.EXPLAIN_CONCEPT;
  }
  if (hasReasoning) return INTENTS.REVIEW_REASONING;
  if (hasHint && !hasSolutionNoun) return INTENTS.REQUEST_HINT;
  if (hasStatement) return INTENTS.EXPLAIN_STATEMENT;

  // Oggetto soluzione senza verbo di produzione: non bloccare, chiarire.
  return INTENTS.CLARIFY;
}

/** Compatibilità con i chiamanti storici: solo il rifiuto esplicito è bloccato. */
export function isSolutionRequest(message) {
  return classifyIntent(message) === INTENTS.REQUEST_SOLUTION;
}

/**
 * Stage deterministica degli hint, calcolata dalla cronologia e dal messaggio
 * corrente. Non usa il modello e non dipende da testi non verificati diversi
 * dai messaggi già presenti nella conversazione.
 */
export function hintStageFor(history = [], message = '') {
  const previous = Array.isArray(history)
    ? history.filter((item) => item?.role === 'user' && HINT.test(normalize(item.content))).length
    : 0;
  const text = normalize(message);
  let stage = previous + (HINT.test(text) ? 1 : 0);
  if (HINT_THIRD.test(text)) stage = Math.max(stage, 3);
  else if (HINT_SECOND.test(text)) stage = Math.max(stage, 2);
  return Math.min(MAX_HINT_STAGE, Math.max(1, stage || 1));
}

/** True quando lo studente segnala una difficoltà personale, non una didattica. */
export function isPersonalContext(message) {
  return PERSONAL_DISTRESS.test(normalize(message));
}
