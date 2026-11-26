import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  deriveFacets, filterChallenges, loadCatalog,
} from '../public/src/catalog.js';
import { KNOWLEDGE_META, retrieveKnowledge } from '../functions/lib/knowledge.js';

const catalogRaw = readFileSync(new URL('../public/data/olicyber-challenges.json', import.meta.url), 'utf8');
const ragRaw = readFileSync(new URL('../functions/data/rag-index.json', import.meta.url), 'utf8');
const catalog = JSON.parse(catalogRaw);
const ragIndex = JSON.parse(ragRaw);
const failures = JSON.parse(
  readFileSync(new URL('../dataset-input/derived/browser-import/import-failures.json', import.meta.url), 'utf8'),
);
const report = JSON.parse(
  readFileSync(new URL('../public/data/olicyber-import-report.json', import.meta.url), 'utf8'),
);

function hasEncodedFlag(raw) {
  const tokens = raw.match(/\b[A-Za-z0-9+/]{12,}={0,2}\b/g) || [];
  return tokens.some((token) => {
    try {
      return /flag\s*[{\[]/i.test(Buffer.from(token, 'base64').toString('utf8'));
    } catch {
      return false;
    }
  });
}

function hasBraceFlag(raw) {
  const snake = /\b[A-Za-z][A-Za-z0-9_]*\s*\{\s*[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)+[!?]?\s*\}/i.test(raw);
  const known = /\b(?:ITASEC|OBUDMW|ptm|cnvlbd|cixd|xcqv|fzau|synt|cyvz)\s*\{\s*[^\}\s][^\}]{0,120}\}/i.test(raw);
  return snake || known;
}

test('il catalogo reale è importato in modo parziale e non pubblica dati sensibili', () => {
  assert.equal(catalog.schemaVersion, 2);
  assert.equal(catalog.status, 'imported-partial');
  assert.equal(catalog.completeness.discovered, 738);
  assert.equal(catalog.completeness.imported, 735);
  assert.equal(catalog.completeness.failed, 3);
  assert.equal(catalog.source.verified, false);
  assert.equal(catalog.completeness.verifiedAgainstSource, false);
  assert.equal(catalogRaw.includes('flag{'), false);
  assert.equal(catalogRaw.includes('/api/file/'), false);
  assert.equal(hasEncodedFlag(catalogRaw), false);
  assert.equal(hasBraceFlag(catalogRaw), false);

  const ids = catalog.challenges.map((challenge) => challenge.id);
  assert.equal(ids.length, 735);
  assert.equal(new Set(ids).size, ids.length);
  for (const challenge of catalog.challenges) {
    assert.match(challenge.id, /^olicyber-\d+$/);
    assert.ok(challenge.title && challenge.description);
    assert.equal(challenge.importError, undefined);
    assert.equal(challenge.sourceUrl, null);
    assert.ok(Array.isArray(challenge.tags) && challenge.tags.length > 0);
    for (const item of challenge.attachments) {
      assert.ok(['text', 'binary', 'error', 'unknown'].includes(item.kind));
      assert.equal('base64' in item, false);
      assert.equal(item.url, undefined);
      if (item.preview) assert.ok(item.preview.length <= 260);
    }
  }
});

test('report e failure non bloccano il catalogo e restano fuori dalla UI', () => {
  assert.deepEqual(report.failedIds, ['olicyber-21', 'olicyber-45', 'olicyber-743']);
  assert.equal(report.counters.imported, 735);
  assert.equal(report.counters.failed, 3);
  assert.equal(report.rules.attachmentsBase64Published, false);
  assert.equal(report.rules.internalUrlsPublished, false);
  assert.equal(report.rules.failedChallengesPublished, false);
  assert.equal(report.rules.ragRuntimeConnected, true);
  assert.deepEqual(failures.failed.map((item) => item.id), report.failedIds);

  const ids = new Set(catalog.challenges.map((challenge) => challenge.id));
  for (const id of report.failedIds) assert.equal(ids.has(id), false);
});

test('l’indice dell’export browser resta locale e non è più usato dal tutor', () => {
  assert.ok(ragIndex.documents > 0);
  assert.ok(ragIndex.chunks > 0);
  assert.equal(ragIndex.items.length, ragIndex.chunks);
  assert.equal(ragRaw.includes('flag{'), false);
  assert.equal(ragRaw.includes('/api/file/'), false);
  assert.equal(hasEncodedFlag(ragRaw), false);
  assert.equal(hasBraceFlag(ragRaw), false);

  // Il retrieval del tutor usa solo la knowledge base didattica separata.
  assert.equal(KNOWLEDGE_META.chunks, 20);
  assert.equal(KNOWLEDGE_META.policy.derivedFromChallengeExport, false);
  const sources = retrieveKnowledge({ message: 'Dashed decifrare messaggio' });
  assert.ok(sources.every((source) => !('challengeId' in source)));
  assert.ok(sources.every((source) => !source.snippet.includes('Dashed')));
});

test('il catalogo reale caricato nell’UI espone il tag come filtro derivato', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, json: async () => catalog });
    const loaded = await loadCatalog('/data/olicyber-challenges.json');
    assert.equal(loaded.meta.status, 'imported-partial');
    assert.equal(loaded.challenges.length, 735);
    const facets = deriveFacets(loaded.challenges);
    assert.ok(facets.tags.includes('misc'));
    const filtered = filterChallenges(loaded.challenges, { tag: 'misc' });
    assert.ok(filtered.length > 0);
    assert.ok(filtered.every((challenge) => challenge.tags.includes('misc')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
