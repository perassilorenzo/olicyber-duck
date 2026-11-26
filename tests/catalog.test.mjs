import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_SORT, loadCatalog, deriveFacets, filterChallenges, sortChallenges, SORT_OPTIONS,
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
  let requestedUrl = null;
  globalThis.fetch = async (url) => {
    requestedUrl = String(url);
    return { ok: true, json: async () => catalog };
  };
  try {
    const loaded = await loadCatalog();
    assert.match(requestedUrl, /\/data\/olicyber-challenges\.json$/);
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

test('loadCatalog normalizza URL non HTTPS e non promuove record non verificati', async () => {
  const originalFetch = globalThis.fetch;
  const fixture = {
    schemaVersion: 2,
    status: 'imported-unverified',
    source: { name: 'Export di test', verified: false },
    completeness: {},
    challenges: [{
      id: 'test-1',
      title: 'Record con URL non sicuri',
      sourceUrl: 'javascript:alert(1)',
      externalUrl: 'data:text/html;base64,PHNjcmlwdD4=',
      attachments: [
        { name: 'locale', url: 'file:///etc/passwd' },
        { name: 'remoto', url: 'https://example.invalid/file' },
      ],
      provenance: {
        source: 'Export di test',
        sourceUrl: 'javascript:alert(1)',
        verified: true,
        catalogVerified: true,
      },
    }],
  };
  try {
    globalThis.fetch = async () => ({ ok: true, json: async () => fixture });
    const loaded = await loadCatalog();
    const challenge = loaded.challenges[0];
    assert.equal(challenge.sourceUrl, null);
    assert.equal(challenge.provenance.sourceUrl, null);
    assert.equal(challenge.provenance.verified, false);
    assert.deepEqual(challenge.attachments.map((item) => item.url), [
      null, 'https://example.invalid/file',
    ]);

    fixture.source.verified = true;
    fixture.status = 'verified-import';
    globalThis.fetch = async () => ({ ok: true, json: async () => fixture });
    const trusted = await loadCatalog();
    assert.equal(trusted.challenges[0].provenance.verified, true);
    assert.equal(trusted.challenges[0].sourceUrl, null);
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

test('la ricerca copre ID, titolo, descrizione e tag senza alterare l’ordine', () => {
  const all = catalog.challenges;
  const ids = all.map((item) => item.id);
  const cases = [
    ['demo-web-01', 'demo-web-01'],
    ['parametro dimenticato', 'demo-web-01'],
    ['sostituzione rispetta', 'demo-crypto-01'],
    ['analisi delle frequenze', 'demo-crypto-01'],
  ];
  for (const [query, expectedId] of cases) {
    const results = filterChallenges(all, { query });
    assert.equal(results.length, 1);
    assert.equal(results[0].id, expectedId);
    assert.deepEqual(
      all.filter((item) => results.includes(item)).map((item) => item.id),
      [expectedId],
    );
  }
  assert.deepEqual(all.map((item) => item.id), ids);
});

test('il filtro tag usa solo tag presenti nei dati e si combina con la ricerca', () => {
  const items = [
    { ...catalog.challenges[0], id: 'tag-a', tags: ['web', 'http'] },
    { ...catalog.challenges[1], id: 'tag-b', tags: ['crypto'] },
  ];
  assert.deepEqual(deriveFacets(items).tags, ['crypto', 'http', 'web']);
  assert.deepEqual(filterChallenges(items, { tag: 'web' }).map((item) => item.id), ['tag-a']);
  assert.equal(filterChallenges(items, { tag: 'all' }).length, 2);
  assert.equal(filterChallenges(items, { tag: 'web', query: 'inesistente' }).length, 0);
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
  assert.deepEqual(sortChallenges(catalog.challenges, DEFAULT_SORT).map((item) => item.id), before);
  assert.deepEqual(sortChallenges(catalog.challenges).map((item) => item.id), before);
  assert.deepEqual(catalog.challenges.map((item) => item.id), before);
  assert.deepEqual(SORT_OPTIONS.map((option) => option.value), [
    DEFAULT_SORT, 'original-id', 'title-asc', 'title-desc', 'category', 'score-desc', 'recent',
  ]);
});
