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
 * @param {string[]} [options.categories] categorie autorizzate delle challenge selezionate
 * @param {string[]} [options.tags] tag autorizzati delle challenge selezionate
 */
export function retrieveKnowledge({
  message = '', categories = [], tags = [], limit = 3, snippetChars = 520,
} = {}) {
  const queryTokens = unique(tokensOf(message));
  const normalizedQuery = normalize(message).trim();
  const contextTokens = unique(tokensOf([...categories, ...tags].join(' '))).slice(0, 12);
  const maxResults = Math.max(1, Math.min(Number(limit) || 3, 5));
  const scored = [];

  for (const item of teachingKb.items || []) {
    const title = normalize(item.title);
    const body = normalize(item.text);
    const tagText = normalize((item.tags || []).join(' '));
    let score = 0;
    for (const token of queryTokens) {
      if (title.includes(token)) score += 6;
      if (tagText.includes(token)) score += 4;
      if (body.includes(token)) score += 3;
    }
    if (normalizedQuery.length >= 5 && body.includes(normalizedQuery)) score += 12;
    for (const token of contextTokens) {
      if (tagText.includes(token) || title.includes(token)) score += 2;
    }
    if (score >= 3) scored.push({ item, score });
  }

  scored.sort((a, b) => b.score - a.score || String(a.item.id).localeCompare(String(b.item.id)));
  return scored.slice(0, maxResults).map(({ item, score }) => ({
    id: item.id,
    title: item.title,
    category: item.category || null,
    tags: Array.isArray(item.tags) ? item.tags : [],
    snippet: snippetOf(item.text, queryTokens, snippetChars),
    score,
  }));
}

/** Testo inserito in un blocco delimitato: resta dato non attendibile per il modello. */
export function knowledgeContext(sources = []) {
  if (!sources.length) return null;
  return sources.map((source, position) => [
    `[${position + 1}] ${source.title} — categoria: ${source.category || 'generale'}`,
    source.snippet,
  ].join('\n')).join('\n\n');
}

/** Metadati pubblici: mai testi dei documenti. */
export function publicKnowledgeSources(sources = []) {
  return sources.map(({ id, title, category, tags, score }) => ({ id, title, category, tags, score }));
}
