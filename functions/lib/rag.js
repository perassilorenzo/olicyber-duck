/**
 * Retrieval deterministico e locale sull'indice sanificato generato dall'export
 * browser autorizzato. Nessuna rete, nessun binding aggiuntivo, nessun testo
 * proveniente da writeup o Solution Archive.
 */

import ragIndex from '../data/rag-data.cjs';
import { redactOutput } from './system-prompt.js';

export const RAG_META = Object.freeze({
  connected: true,
  schemaVersion: ragIndex.schemaVersion,
  source: ragIndex.source,
  generatedAt: ragIndex.generatedAt,
  documents: ragIndex.documents,
  chunks: ragIndex.chunks,
  settings: ragIndex.settings,
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

/** Difesa in più: l'indice è già sanificato, ma lo snippet non può contenere URL o flag. */
function safeSnippet(text, queryTokens, maxChars) {
  const clean = String(text || '')
    .replace(/https?:\/\/\S+/gi, '[URL OMESSA]')
    .replace(/\b(?:token|cookie|authorization|api[-_]?key|password|session)\s*[:=]\s*\S+/gi, '[DATO SENSIBILE RIMOSSO]')
    .replace(/[A-Za-z0-9+/]{120,}={0,2}/g, '[CONTENUTO BINARIO OMESSO]');
  const normalized = normalize(clean);
  let start = 0;
  for (const token of queryTokens) {
    const hit = normalized.indexOf(token);
    if (hit >= 0) {
      start = Math.max(0, hit - Math.floor(maxChars / 4));
      break;
    }
  }
  if (start > 0 && start + maxChars < clean.length) {
    const space = clean.lastIndexOf(' ', start);
    if (space >= 0 && start - space < 20) start = space + 1;
  }
  const sliced = clean.slice(start, start + maxChars).trim();
  const prefix = start > 0 ? '… ' : '';
  const suffix = start + maxChars < clean.length ? ' …' : '';
  return redactOutput(`${prefix}${sliced}${suffix}`);
}

/**
 * Restituisce chunk pertinenti con punteggio deterministico. Se non emerge
 * alcun riscontro ma è selezionata una challenge, vengono usati i chunk di
 * quella challenge come contesto; in modalità generale senza riscontri il
 * risultato è vuoto e il tutor segnala informazioni insufficienti.
 */
export function retrieveRag({
  message = '', challenge = null, history = [], limit = 3, snippetChars = 520,
} = {}) {
  const queryTokens = unique(tokensOf(message));
  const normalizedQuery = normalize(message).trim();
  // In modalità generale il contesto sintetico non deve generare riscontri
  // artificiali: restano pertinenti solo i termini scritti dallo studente.
  const contextText = challenge?.general === true ? '' : [
    challenge?.title,
    challenge?.description,
    challenge?.statement,
    ...(Array.isArray(challenge?.tags) ? challenge.tags : []),
    ...(Array.isArray(challenge?.hintTopics) ? challenge.hintTopics : []),
    ...history.filter((item) => item?.role === 'user').slice(-3).map((item) => item.content),
  ].filter(Boolean).join(' ');
  const contextTokens = unique(tokensOf(contextText)).slice(0, 16);
  const maxResults = Math.max(1, Math.min(Number(limit) || 3, 5));
  const scored = [];

  for (const chunk of ragIndex.items || []) {
    const text = normalize(chunk.text);
    const keywords = Array.isArray(chunk.keywords) ? chunk.keywords : [];
    let score = 0;
    for (const token of queryTokens) {
      if (text.includes(token)) score += 5;
      if (keywords.includes(token)) score += 4;
    }
    if (normalizedQuery.length >= 4 && text.includes(normalizedQuery)) score += 16;
    for (const token of contextTokens) {
      if (text.includes(token)) score += 1;
    }
    if (challenge?.id && challenge.id !== 'general' && chunk.challengeId === challenge.id) {
      score += 8;
    }
    if (score > 0) scored.push({ chunk, score });
  }

  scored.sort((a, b) => b.score - a.score || String(a.chunk.id).localeCompare(String(b.chunk.id)));
  let picked = scored.slice(0, maxResults);
  if (!picked.length && challenge?.id && challenge.id !== 'general') {
    picked = (ragIndex.items || [])
      .filter((chunk) => chunk.challengeId === challenge.id)
      .slice(0, maxResults)
      .map((chunk) => ({ chunk, score: 0 }));
  }

  return picked.map(({ chunk, score }) => ({
    id: chunk.id,
    title: chunk.title,
    originalId: chunk.originalId ?? null,
    challengeId: chunk.challengeId ?? null,
    index: chunk.index ?? 0,
    score,
    snippet: safeSnippet(chunk.text, queryTokens, snippetChars),
  }));
}

/** Testo inserito in un blocco delimitato: resta dato non attendibile per il modello. */
export function ragContext(sources = []) {
  if (!sources.length) return null;
  return sources.map((source, position) => [
    `[${position + 1}] ${source.title} (ID originale ${source.originalId ?? 'non indicato'})`,
    source.snippet,
  ].join('\n')).join('\n\n');
}

/** Metadati pubblici: mai testi degli chunk. */
export function publicSources(sources = []) {
  return sources.map(({ title, originalId, challengeId, index, score }) => ({
    title, originalId, challengeId, index, score,
  }));
}
