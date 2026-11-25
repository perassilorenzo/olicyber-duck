/**
 * Caricamento, normalizzazione e interrogazione del catalogo v2.
 * I dati ufficiali restano separati da quelli personali (store.js): qui non
 * viene letto né scritto alcun dato locale.
 */

export const SORT_OPTIONS = [
  { value: 'title-asc', label: 'Titolo (A-Z)' },
  { value: 'title-desc', label: 'Titolo (Z-A)' },
  { value: 'category', label: 'Categoria' },
  { value: 'score-desc', label: 'Punteggio' },
  { value: 'recent', label: 'Più recenti' },
  { value: 'original-id', label: 'ID originale' },
];

const asText = (value) => {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text : null;
};

function normalizeChallenge(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const originalId = raw.originalId === null || raw.originalId === undefined
    ? null : String(raw.originalId);
  const id = asText(raw.id) || (originalId ? `olicyber-${originalId}` : null);
  const title = asText(raw.title);
  if (!id || !title) return null;

  return {
    id,
    originalId,
    title,
    description: asText(raw.description) || '',
    statement: asText(raw.statement) || '',
    category: asText(raw.category),
    difficulty: asText(raw.difficulty),
    score: Number.isFinite(Number(raw.score)) && raw.score !== null && raw.score !== '' ? Number(raw.score) : null,
    author: asText(raw.author),
    edition: asText(raw.edition),
    path: asText(raw.path),
    publishedAt: asText(raw.publishedAt),
    state: asText(raw.state),
    available: raw.available !== false,
    sourceUrl: asText(raw.sourceUrl) || asText(raw.externalUrl),
    attachments: Array.isArray(raw.attachments) ? raw.attachments.filter((item) => item && typeof item === 'object') : [],
    tags: Array.isArray(raw.tags) ? raw.tags.filter((tag) => typeof tag === 'string' && tag.trim()) : [],
    metadata: raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata) ? raw.metadata : {},
    provenance: raw.provenance && typeof raw.provenance === 'object' ? raw.provenance : {},
    demo: raw.demo === true,
    source: asText(raw.source) || '',
  };
}

export async function loadCatalog(url = '/data/challenges.json') {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Catalogo non disponibile (HTTP ${response.status}).`);
  const data = await response.json();
  if (!data || typeof data !== 'object' || !Array.isArray(data.challenges)) {
    throw new Error('Formato del catalogo non valido.');
  }
  if (data.schemaVersion !== 2) {
    throw new Error(`Schema del catalogo non supportato (${data.schemaVersion ?? 'sconosciuto'}).`);
  }
  const challenges = data.challenges.map(normalizeChallenge).filter(Boolean);
  const meta = {
    schemaVersion: 2,
    status: asText(data.status) || 'unknown',
    source: data.source && typeof data.source === 'object' ? data.source : {},
    completeness: data.completeness && typeof data.completeness === 'object' ? data.completeness : {},
  };
  return { meta, challenges };
}

/** Facet derivate esclusivamente dai valori presenti nei dati. */
export function deriveFacets(challenges) {
  const values = (key) => [...new Set(challenges.map((item) => item[key]).filter((value) => typeof value === 'string' && value))]
    .sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' }));
  return {
    categories: values('category'),
    difficulties: values('difficulty'),
    editions: values('edition'),
    paths: values('path'),
  };
}

function searchable(challenge) {
  return [
    challenge.title, challenge.description, challenge.statement, challenge.category,
    challenge.difficulty, challenge.edition, challenge.path, challenge.author,
    challenge.originalId,
    ...challenge.tags,
  ].filter(Boolean).join(' ').toLocaleLowerCase('it');
}

export function filterChallenges(challenges, filters = {}, statusOf = () => 'todo') {
  const {
    query = '', category = 'all', difficulty = 'all', edition = 'all',
    path = 'all', status = 'all',
  } = filters;
  const needle = String(query).trim().toLocaleLowerCase('it');
  return challenges.filter((challenge) => {
    if (category !== 'all' && challenge.category !== category) return false;
    if (difficulty !== 'all' && challenge.difficulty !== difficulty) return false;
    if (edition !== 'all' && challenge.edition !== edition) return false;
    if (path !== 'all' && challenge.path !== path) return false;
    if (status !== 'all' && statusOf(challenge.id) !== status) return false;
    return !needle || searchable(challenge).includes(needle);
  });
}

function compareText(a, b) {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  return String(a).localeCompare(String(b), 'it', { sensitivity: 'base' });
}

export function sortChallenges(challenges, sort = 'title-asc') {
  const copy = [...challenges];
  switch (sort) {
    case 'title-desc':
      return copy.sort((a, b) => compareText(b.title, a.title));
    case 'category':
      return copy.sort((a, b) => compareText(a.category, b.category) || compareText(a.title, b.title));
    case 'score-desc':
      return copy.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity) || compareText(a.title, b.title));
    case 'recent':
      return copy.sort((a, b) => compareText(b.publishedAt, a.publishedAt) || compareText(a.title, b.title));
    case 'original-id':
      return copy.sort((a, b) => {
        const left = a.originalId === null ? null : Number(a.originalId);
        const right = b.originalId === null ? null : Number(b.originalId);
        if (Number.isFinite(left) && Number.isFinite(right)) return left - right;
        return compareText(a.originalId, b.originalId);
      });
    default:
      return copy.sort((a, b) => compareText(a.title, b.title));
  }
}
