import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { filterChallenges, CATEGORIES } from '../public/src/catalog.js';

const catalog = JSON.parse(readFileSync(new URL('../public/data/challenges.json', import.meta.url), 'utf8'));

test('il catalogo dimostrativo è completo e non contiene flag o link inventati', () => {
  assert.equal(catalog.version, 1);
  const ids = catalog.challenges.map((challenge) => challenge.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const challenge of catalog.challenges) {
    assert.equal(challenge.demo, true, `${challenge.id} deve essere DEMO`);
    assert.equal(challenge.externalUrl, null, `${challenge.id} non deve avere link esterni`);
    assert.ok(CATEGORIES.includes(challenge.category));
    assert.match(challenge.source, /^DEMO/);
    assert.ok(challenge.statement.length > 80);
    assert.ok(!/flag\{/i.test(JSON.stringify(challenge)));
  }
  const categories = new Set(catalog.challenges.map((challenge) => challenge.category));
  assert.deepEqual(categories, new Set(CATEGORIES));
});

test('ricerca e filtri funzionano insieme', () => {
  const all = catalog.challenges;
  assert.equal(filterChallenges(all).length, all.length);
  const web = filterChallenges(all, { category: 'Web' });
  assert.equal(web.length, 1);
  assert.equal(web[0].category, 'Web');
  const hard = filterChallenges(all, { difficulty: 'Difficile' });
  assert.equal(hard[0].category, 'Miscellaneous');
  const search = filterChallenges(all, { query: 'query string' });
  assert.equal(search[0].id, 'demo-web-01');
  assert.equal(filterChallenges(all, { query: 'inesistente' }).length, 0);
});
