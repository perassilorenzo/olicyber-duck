/**
 * Retrieval deterministico sulla knowledge base didattica separata.
 *
 * Questa libreria NON legge il catalogo delle challenge e NON legge alcun
 * indice derivato dall'export delle challenge: al tutor arrivano soltanto
 * definizioni generali di concetti informatici e di cybersecurity.
 */

import teachingKb from '../data/teaching-kb-data.cjs';

export const KNOWLEDGE_META = Object.freeze({
  connected: true,
  source: teachingKb.source,
  status: teachingKb.status,
  documents: teachingKb.documents,
  chunks: teachingKb.chunks,
  reviewedAt: teachingKb.reviewedAt || null,
  policy: teachingKb.policy,
});

const STOPWORDS = new Set([
  'che', 'chi', 'come', 'con', 'cosa', 'della', 'delle', 'dello', 'di', 'e', 'ed',
  'essere', 'fa', 'finche', 'gli', 'ha', 'hanno', 'hai', 'ho', 'il', 'in', 'io',
  'la', 'le', 'lo', 'loro', 'lui', 'ma', 'me', 'mi', 'nel', 'nella', 'nessun',
  'noi', 'non', 'nostro', 'o', 'per', 'perche', 'piu', 'quale', 'quali', 'quando',
  'quanto', 'quello', 'questa', 'queste', 'questi', 'questo', 'se', 'senza', 'si',
  'sia', 'siamo', 'sono', 'sta', 'stato', 'su', 'sul', 'sulla', 'suo', 'suoi',
  'te', 'ti', 'tra', 'tu', 'tuo', 'un', 'una', 'uno', 'vi', 'voi', 'vostro',
]);

function normalize(value) {
  return String(value ?? '')
    .toLocaleLowerCase('it')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function tokensOf(value) {
  return normalize(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token) && !/^\d+$/.test(token));
}

/** Frase di confronto senza punteggiatura: "CSRF?" deve trovare "CSRF". */
function phraseOf(value) {
  return tokensOf(value).join(' ');
}

/** Sinonimi didattici: non aggiungono documenti, migliorano solo il matching. */
const QUERY_SYNONYMS = Object.freeze({
  boxing: 'csrf',
  csrftoken: 'csrf token',
  xss: 'cross site scripting',
  sqlinjection: 'sql injection',
  hashfunction: 'funzione hash',
  funzionehash: 'funzione hash',
  tls13: 'tls 1.3',
});

function expandedTokens(tokens) {
  const expanded = [...tokens];
  for (const token of tokens) {
    const synonym = QUERY_SYNONYMS[token];
    if (synonym) expanded.push(...tokensOf(synonym));
  }
  return unique(expanded);
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function snippetOf(text, queryTokens, maxChars) {
  const clean = String(text || '').trim();
  if (clean.length <= maxChars) return clean;
  const normalized = normalize(clean);
  let start = 0;
  for (const token of queryTokens) {
    const hit = normalized.indexOf(token);
    if (hit >= 0) {
      start = Math.max(0, hit - Math.floor(maxChars / 4));
      break;
    }
  }
  if (start > 0) {
    const space = clean.lastIndexOf(' ', start);
    if (space >= 0 && start - space < 20) start = space + 1;
  }
  const sliced = clean.slice(start, start + maxChars).trim();
  return `${start > 0 ? '… ' : ''}${sliced}${start + maxChars < clean.length ? ' …' : ''}`;
}

/**
 * @param {object} options
 * @param {string} options.message testo scritto dallo studente
 * @param {Array<{role: string, content: string}>} [options.history] cronologia: solo i messaggi dello studente influenzano il retrieval
 * @param {string} [options.statement] consegna già incollata: contribuisce al recupero del concetto
 * @param {string[]} [options.categories] categorie autorizzate delle challenge selezionate
 * @param {string[]} [options.tags] tag autorizzati delle challenge selezionate
 */
export function retrieveKnowledge({
  message = '', history = [], statement = '', categories = [], tags = [], limit = 3, snippetChars = 520,
} = {}) {
  // I follow-up brevi («fammi un esempio», «intendo Python») non contengono il
  // concetto da recuperare: il tema viene dai messaggi precedenti rilevanti.
  const previousQuestions = Array.isArray(history)
    ? history.filter((item) => item?.role === 'user' && typeof item.content === 'string')
      .slice(-4).reverse().map((item) => item.content)
    : [];
  const queryText = [message, statement, ...previousQuestions].join(' ');
  const queryTokens = expandedTokens(tokensOf(queryText));
  const queryPhrase = phraseOf(message);
  const contextTokens = unique(tokensOf([...categories, ...tags].join(' '))).slice(0, 12);
  const maxResults = Math.max(1, Math.min(Number(limit) || 3, 5));
  const scored = [];

  for (const item of teachingKb.items || []) {
    const title = normalize(item.title);
    const body = normalize(item.text);
    const tagText = normalize((item.tags || []).join(' '));
    const topicText = normalize([...(item.topics || []), ...(item.keywords || [])].join(' '));
    const titlePhrase = phraseOf(item.title);
    const topicPhrase = phraseOf([...(item.topics || []), ...(item.keywords || [])].join(' '));
    const bodyPhrase = phraseOf(item.text);
    let score = 0;
    const matchedTokens = [];
    for (const token of queryTokens) {
      const hit = title.includes(token) || topicText.includes(token)
        || tagText.includes(token) || body.includes(token);
      if (hit && !matchedTokens.includes(token)) matchedTokens.push(token);
      if (title.includes(token)) score += 8;
      if (topicText.includes(token)) score += 6;
      if (tagText.includes(token)) score += 4;
      if (body.includes(token)) score += 2;
    }
    // La frase esatta pesa più dei singoli token: "funzione hash" deve
    // privilegiare il documento dedicato rispetto a menzioni incidentali.
    if (queryPhrase.length >= 5) {
      if (titlePhrase.includes(queryPhrase)) score += 15;
      else if (topicPhrase.includes(queryPhrase)) score += 10;
      else if (bodyPhrase.includes(queryPhrase)) score += 6;
    }
    // Più concetti distinti della domanda sono coperti dallo stesso documento,
    // più è probabile che sia il documento utile.
    if (matchedTokens.length > 1) score += Math.min(6, matchedTokens.length - 1);
    for (const token of contextTokens) {
      if (tagText.includes(token) || topicText.includes(token) || title.includes(token)) score += 2;
    }
    if (score >= 3) scored.push({ item, score, matchedTokens });
  }

  scored.sort((a, b) => b.score - a.score || String(a.item.id).localeCompare(String(b.item.id)));
  const deduped = [];
  const seen = new Set();
  for (const entry of scored) {
    if (seen.has(entry.item.id)) continue;
    seen.add(entry.item.id);
    deduped.push(entry);
    if (deduped.length === maxResults) break;
  }
  return deduped.map(({ item, score, matchedTokens }) => ({
    id: item.id,
    title: item.title,
    category: item.category || null,
    tags: Array.isArray(item.tags) ? item.tags : [],
    topics: Array.isArray(item.topics) ? item.topics : [],
    keywords: Array.isArray(item.keywords) ? item.keywords : [],
    source: item.source || null,
    url: item.url || null,
    verifiedAt: item.verifiedAt || null,
    snippet: snippetOf(item.text, queryTokens, snippetChars),
    score,
    matchedTokens,
  }));
}

/** Testo inserito in un blocco delimitato: resta dato non attendibile per il modello. */
export function knowledgeContext(sources = []) {
  if (!sources.length) return null;
  return sources.map((source, position) => [
    `[${position + 1}] ${source.title} — categoria: ${source.category || 'generale'}`,
    `Fonte: ${source.source || 'sintesi didattica originale'} | URL: ${source.url || 'non disponibile'} | verificato il: ${source.verifiedAt || 'data non indicata'}`,
    source.snippet,
  ].join('\n')).join('\n\n');
}

/** Metadati pubblici e verificabili: mai testi dei documenti. */
export function publicKnowledgeSources(sources = []) {
  return sources.map(({
    id, title, category, tags, topics, keywords, source, url, verifiedAt, score, matchedTokens,
  }) => ({
    id, title, category, tags, topics, keywords, source, url, verifiedAt, score,
    matchedTokens: Array.isArray(matchedTokens) ? [...matchedTokens] : [],
  }));
}
