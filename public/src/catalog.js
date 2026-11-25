/** Caricamento e filtro del catalogo statico delle challenge. */

export const CATEGORIES = [
  'Web', 'Crypto', 'Binary Exploitation', 'Reverse Engineering',
  'Forensics', 'Network', 'Miscellaneous',
];

export const DIFFICULTIES = ['Facile', 'Media', 'Difficile'];

export async function loadCatalog(url = '/data/challenges.json') {
  const response = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(`Catalogo non disponibile (HTTP ${response.status}).`);
  const data = await response.json();
  if (!data || !Array.isArray(data.challenges)) throw new Error('Formato del catalogo non valido.');
  const challenges = data.challenges.filter((challenge) =>
    challenge && typeof challenge.id === 'string' && typeof challenge.title === 'string',
  );
  return { version: data.version ?? 1, note: data.note || '', challenges };
}

export function filterChallenges(challenges, { query = '', category = 'all', difficulty = 'all' } = {}) {
  const needle = query.trim().toLocaleLowerCase('it');
  return challenges.filter((challenge) => {
    if (category !== 'all' && challenge.category !== category) return false;
    if (difficulty !== 'all' && challenge.difficulty !== difficulty) return false;
    if (!needle) return true;
    const haystack = [
      challenge.title, challenge.category, challenge.difficulty, challenge.description,
      ...(Array.isArray(challenge.tags) ? challenge.tags : []),
    ].join(' ').toLocaleLowerCase('it');
    return haystack.includes(needle);
  });
}
