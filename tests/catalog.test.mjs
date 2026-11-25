import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  loadCatalog, deriveFacets, filterChallenges, sortChallenges, SORT_OPTIONS,
} from '../public/src/catalog.js';

const raw = readFileSync(new URL('../public/data/challenges.json', import.meta.url), 'utf8');
const catalog = JSON.parse(raw);

test('catalogo v2 dichiara provenienza non verificata e nessun dato sensibile', () => {
  assert.equal(catalog.schemaVersion, 2);
  assert.equal(catalog.status, 'unverified-demo');
  assert.equal(catalog.source.authorizedExportUsed, false);
  assert.equal(catalog.source.verified, false);
  assert.equal(catalog.completeness.verifiedAgainstSource, false);
  assert.equal(catalog.completeness.discovered, catalog.challenges.length);
  assert.equal(catalog.completeness.imported, catalog.challenges.length);
  assert.equal(raw.includes('flag{'), false);

  const ids = catalog.challenges.map((challenge) => challenge.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const challenge of catalog.challenges) {
    assert.equal(challenge.demo, true);
    assert.equal(challenge.available, true);
    assert.equal(challenge.sourceUrl, null);
    assert.equal(challenge.externalUrl, null);
    assert.match(challenge.source, /^DEMO/);
    assert.ok(challenge.statement.length > 80);
  }
});

test('loadCatalog richiede schema v2 e normalizza i record', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => catalog });
  try {
    const loaded = await loadCatalog();
    assert.equal(loaded.meta.status, 'unverified-demo');
    assert.equal(loaded.challenges.length, 7);
    assert.equal(loaded.challenges[0].attachments.length, 0);
    assert.equal(loaded.challenges[0].score, null);

    globalThis.fetch = async () => ({ ok: true, json: async () => ({ schemaVersion: 1, challenges: [] }) });
    await assert.rejects(() => loadCatalog(), /Schema del catalogo non supportato/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('le facet sono derivate dai soli valori presenti nei dati', () => {
  const facets = deriveFacets(catalog.challenges);
  assert.deepEqual(facets.difficulties, ['Difficile', 'Facile', 'Media']);
  assert.equal(facets.categories.includes('Web'), true);
  assert.equal(facets.categories.length, new Set(catalog.challenges.map((item) => item.category)).size);
  assert.deepEqual(facets.editions, []);
  assert.deepEqual(facets.paths, []);
});

test('ricerca, filtri derivati e stati personali funzionano insieme', () => {
  const all = catalog.challenges;
  assert.equal(filterChallenges(all).length, all.length);
  assert.equal(filterChallenges(all, { category: 'Web' })[0].id, 'demo-web-01');
  assert.equal(filterChallenges(all, { difficulty: 'Difficile' })[0].id, 'demo-misc-01');
  assert.equal(filterChallenges(all, { query: 'query string' })[0].id, 'demo-web-01');
  assert.equal(filterChallenges(all, { query: 'inesistente' }).length, 0);
  assert.equal(filterChallenges(all, { status: 'completed' }, () => 'completed').length, all.length);
  assert.equal(filterChallenges(all, { status: 'completed' }).length, 0);

  const statusOf = (id) => (id === 'demo-crypto-01' ? 'todo' : 'completed');
  const selected = filterChallenges(all, { category: 'Crypto', status: 'todo' }, statusOf);
  assert.equal(selected.length, 1);
  assert.equal(filterChallenges(all, { category: 'Crypto', status: 'completed' }, statusOf).length, 0);
});

test('ordinamenti sono stabili e non mutano il catalogo', () => {
  const before = catalog.challenges.map((item) => item.id);
  const titles = sortChallenges(catalog.challenges, 'title-asc').map((item) => item.title);
  assert.deepEqual(titles, [...titles].sort((a, b) => a.localeCompare(b, 'it', { sensitivity: 'base' })));
  assert.equal(sortChallenges(catalog.challenges, 'title-desc')[0].title, titles.at(-1));
  assert.equal(sortChallenges(catalog.challenges, 'score-desc').length, 7);
  assert.equal(sortChallenges(catalog.challenges, 'recent').length, 7);
  assert.equal(sortChallenges(catalog.challenges, 'original-id').length, 7);
  assert.equal(sortChallenges(catalog.challenges, 'category').length, 7);
  assert.deepEqual(catalog.challenges.map((item) => item.id), before);
  assert.deepEqual(SORT_OPTIONS.map((option) => option.value), [
    'title-asc', 'title-desc', 'category', 'score-desc', 'recent', 'original-id',
  ]);
});
