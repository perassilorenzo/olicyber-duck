import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

function setupDom() {
  const dom = new JSDOM(html, { url: 'http://localhost:8788/', pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  dom.window.localStorage.clear();
  return dom;
}

function press(element, key, options = {}) {
  element.dispatchEvent(new window.KeyboardEvent('keydown', {
    key, bubbles: true, cancelable: true, ...options,
  }));
}

function activeIndex(doc) {
  return doc.activeElement?.closest?.('.challenge-item')?.dataset.index ?? null;
}

test('dashboard completa: categorie reali, scroll conservato e navigazione da tastiera', async () => {
  const dom = setupDom();
  const { LocalStore } = await import('../public/src/store.js');
  const { createLibrary, ROW_HEIGHT } = await import('../public/src/library.js');

  const challenges = Array.from({ length: 30 }, (_, index) => ({
    id: `test-${index}`,
    title: `Challenge ${String(index).padStart(2, '0')}`,
    category: index < 18 ? 'Web' : 'Crypto',
    difficulty: 'Facile',
    demo: false,
    provenance: { verified: false },
    tags: [],
    attachments: [],
  }));
  const store = new LocalStore();
  const library = createLibrary({ store, challenges, onSelect() {}, onOpenDetails() {} });
  const doc = dom.window.document;
  const list = doc.getElementById('challenge-list');
  Object.defineProperty(list, 'clientHeight', { configurable: true, value: ROW_HEIGHT * 2 });

  let rows = [...doc.querySelectorAll('#challenge-items .challenge-item')];
  assert.equal(rows.length, 30, 'nessuna virtualizzazione: tutte le card sono presenti');
  assert.equal(rows[0].getAttribute('role'), 'listitem');
  assert.equal(rows[0].getAttribute('aria-posinset'), '1');
  assert.equal(rows[0].getAttribute('aria-setsize'), '30');
  const groups = [...doc.querySelectorAll('.ctf-category')];
  assert.equal(groups.length, 2);
  assert.match(groups[0].querySelector('.ctf-category__header').textContent, /18 challenge · 0 risolte/);
  assert.match(groups[1].querySelector('.ctf-category__header').textContent, /12 challenge · 0 risolte/);
  assert.equal(groups[0].querySelectorAll('.challenge-item').length, 18);
  assert.match(doc.getElementById('dashboard-title-numbers').textContent, /30 challenge · 2 categorie/);
  assert.match(doc.getElementById('dashboard-summary').textContent, /30 challenge · 0 risolte · 0 in corso · 30 da fare/);

  list.scrollTop = ROW_HEIGHT * 10;
  rows[0].querySelector('.challenge-item__main').focus();
  press(doc.activeElement, 'ArrowDown');
  assert.equal(activeIndex(doc), '1');
  press(doc.activeElement, 'End');
  assert.equal(activeIndex(doc), '29');
  assert.equal(list.scrollTop > 0, true);
  press(doc.activeElement, 'Home');
  assert.equal(activeIndex(doc), '0');
  assert.equal(list.scrollTop, 0);

  // Aggiornamenti non strutturali: selezione e stato non azzerano lo scroll.
  list.scrollTop = ROW_HEIGHT * 5;
  store.selectChallenge('test-10');
  library.render();
  assert.equal(list.scrollTop, ROW_HEIGHT * 5);
  store.setStatus('test-10', 'completed');
  library.render();
  assert.equal(list.scrollTop, ROW_HEIGHT * 5);
  assert.equal(doc.querySelector('.challenge-item[data-id="test-10"] .ctf-status').dataset.status, 'solved');
  assert.match(doc.getElementById('dashboard-summary').textContent, /1 risolte/);

  // Il cambio filtro è strutturale: lo scroll torna all'inizio.
  store.setFilter('query', 'Challenge 07');
  library.syncFilters();
  assert.equal(list.scrollTop, 0);
  assert.equal(doc.querySelectorAll('#challenge-items .challenge-item').length, 1);
  assert.match(doc.getElementById('challenge-count').textContent, /^1 challenge/);

  dom.window.close();
});

test('card CTF: numeri reali, badge punti e risoluzioni, preferiti e dettaglio separato dalla chat', async () => {
  const dom = setupDom();
  const { LocalStore } = await import('../public/src/store.js');
  const { createLibrary } = await import('../public/src/library.js');
  const challenges = [
    {
      id: 'olicyber-9', originalId: '9', title: 'Challenge completa', category: 'Web',
      difficulty: 'Facile', score: 120, state: 'online', available: true,
      tags: ['HTTP', 'header'], description: 'Descrizione breve', statement: 'Testo completo',
      metadata: { solves: 42 }, attachments: [{ name: 'a.txt' }], author: 'Ada',
      edition: null, path: null, demo: false, provenance: { verified: false },
    },
    {
      id: 'olicyber-10', originalId: '10', title: 'Solo titolo', category: null,
      difficulty: null, score: null, state: null, available: true, tags: [],
      description: '', statement: '', metadata: {}, attachments: [], demo: false,
      provenance: { verified: false },
    },
  ];
  const selected = [];
  const opened = [];
  const store = new LocalStore();
  const library = createLibrary({
    store,
    challenges,
    onSelect: (challenge, nowSelected) => selected.push([challenge.id, nowSelected]),
    onOpenDetails: (challenge) => opened.push(challenge.id),
  });
  const doc = dom.window.document;
  const rows = [...doc.querySelectorAll('#challenge-items .challenge-item')];

  assert.equal(rows.length, 2);
  const fullRow = doc.querySelector('#challenge-items .challenge-item[data-id="olicyber-9"]');
  const minimalRow = doc.querySelector('#challenge-items .challenge-item[data-id="olicyber-10"]');
  const full = fullRow.querySelector('.challenge-item__main');
  for (const text of [
    '#9', 'Challenge completa', 'NON VERIFICATA', 'Web',
    '120 pt', '42 risoluzioni', 'HTTP', 'Descrizione breve', 'Ada', 'Allegati',
  ]) {
    assert.equal(full.textContent.includes(text), true, `manca "${text}" dalla card`);
  }
  assert.equal(full.querySelector('.ctf-badge--points').textContent, '120 pt');
  assert.equal(full.querySelector('.ctf-badge--solves').textContent, '42 risoluzioni');
  assert.equal(full.querySelector('.ctf-card__description').textContent, 'Descrizione breve');
  assert.equal(fullRow.querySelector('.ctf-status').dataset.status, 'unsolved');

  const minimal = minimalRow.querySelector('.challenge-item__main');
  assert.equal(minimal.querySelector('.ctf-card__description'), null);
  assert.equal(minimal.querySelector('.challenge-item__extras'), null);
  assert.equal(minimal.querySelector('.ctf-badge--points'), null);
  assert.equal(minimal.querySelector('.ctf-badge--solves'), null);

  assert.equal(doc.getElementById('edition-filter').closest('.field').hidden, true);
  assert.equal(doc.getElementById('path-filter').closest('.field').hidden, true);
  assert.equal(doc.getElementById('difficulty-filter').closest('.field').hidden, false);
  assert.equal(doc.getElementById('category-filter').closest('.field').hidden, false);

  store.setFilter('edition', '2026');
  library.correctFilters();
  assert.equal(store.state.preferences.filters.edition, 'all');

  // Preferiti: la card e il filtro derivato usano lo stesso stato reale.
  fullRow.querySelector('.ctf-card__favorite').click();
  assert.equal(store.isFavorite('olicyber-9'), true);
  const favoriteRow = doc.querySelector('#challenge-items .challenge-item[data-id="olicyber-9"]');
  assert.equal(favoriteRow.querySelector('.ctf-card__favorite').getAttribute('aria-pressed'), 'true');
  const favoriteFilter = doc.getElementById('favorite-filter');
  favoriteFilter.value = 'favorites';
  favoriteFilter.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  library.syncFilters();
  assert.deepEqual(library.visible.map((item) => item.id), ['olicyber-9']);
  favoriteFilter.value = 'all';
  favoriteFilter.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
  library.syncFilters();

  doc.querySelector('#challenge-items .challenge-item[data-id="olicyber-9"] .challenge-item__chat').click();
  library.render();
  assert.deepEqual(selected, [['olicyber-9', true]]);
  assert.deepEqual(store.getSelectedChallengeIds(), ['olicyber-9']);
  assert.deepEqual(opened, []);
  let first = doc.querySelector('#challenge-items .challenge-item[data-id="olicyber-9"]');
  assert.equal(first.classList.contains('is-selected'), true);
  assert.equal(first.querySelector('.challenge-item__chat').getAttribute('aria-pressed'), 'true');
  assert.match(first.querySelector('.challenge-item__chat').getAttribute('aria-label'), /^Rimuovi .+ dal contesto della chat$/);

  first.querySelector('.challenge-item__main').click();
  assert.deepEqual(opened, ['olicyber-9']);
  assert.deepEqual(store.getSelectedChallengeIds(), ['olicyber-9']);

  first.querySelector('.challenge-item__chat').click();
  library.render();
  assert.deepEqual(store.getSelectedChallengeIds(), []);
  assert.equal(selected.at(-1)[1], false);
  first = doc.querySelector('#challenge-items .challenge-item[data-id="olicyber-9"]');
  assert.equal(first.classList.contains('is-selected'), false);
  assert.match(first.querySelector('.challenge-item__chat').getAttribute('aria-label'), /^Aggiungi .+ al contesto della chat$/);

  const search = doc.getElementById('search-input');
  search.value = 'inesistente';
  search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  library.syncFilters();
  assert.equal(library.visible.length, 0);
  assert.match(doc.getElementById('challenge-count').textContent, /^0 challenge/);
  assert.ok(doc.querySelector('.empty-list'));
  doc.querySelector('.empty-list button').click();
  library.syncFilters();
  assert.equal(library.visible.length, 2);
  assert.equal(doc.querySelector('.empty-list'), null);

  dom.window.close();
});

test('selezione multipla: due challenge attive e limite massimo di 6 con toast', async () => {
  const dom = setupDom();
  const { LocalStore } = await import('../public/src/store.js');
  const { createLibrary } = await import('../public/src/library.js');
  const challenges = Array.from({ length: 7 }, (_, index) => ({
    id: `multi-${index}`,
    title: `Challenge ${index}`,
    tags: [], attachments: [], metadata: {}, provenance: { verified: false },
  }));
  const store = new LocalStore();
  const opened = [];
  const library = createLibrary({
    store,
    challenges,
    onSelect() {},
    onOpenDetails: (challenge) => opened.push(challenge.id),
  });
  const doc = dom.window.document;

  function chatButton(id) {
    return doc.querySelector(`.challenge-item[data-id="${id}"] .challenge-item__chat`);
  }

  chatButton('multi-0').click();
  chatButton('multi-1').click();
  library.render();
  assert.deepEqual(store.getSelectedChallengeIds(), ['multi-0', 'multi-1']);
  assert.equal(doc.querySelectorAll('.challenge-item.is-selected').length, 2);
  assert.equal(chatButton('multi-0').getAttribute('aria-pressed'), 'true');
  assert.equal(chatButton('multi-1').getAttribute('aria-pressed'), 'true');
  assert.equal(chatButton('multi-2').getAttribute('aria-pressed'), 'false');

  for (let index = 2; index < 6; index += 1) chatButton(`multi-${index}`).click();
  library.render();
  assert.deepEqual(store.getSelectedChallengeIds(), challenges.slice(0, 6).map((item) => item.id));
  assert.equal(doc.querySelectorAll('.challenge-item.is-selected').length, 6);

  doc.getElementById('toast').textContent = '';
  chatButton('multi-6').click();
  assert.deepEqual(store.getSelectedChallengeIds(), challenges.slice(0, 6).map((item) => item.id));
  assert.match(doc.getElementById('toast').textContent, /al massimo 6 challenge/);
  assert.equal(doc.getElementById('toast').hidden, false);

  // L'altro pulsante della card continua ad aprire solo i dettagli.
  doc.querySelector('.challenge-item[data-id="multi-2"] .challenge-item__main').click();
  assert.deepEqual(opened, ['multi-2']);
  assert.equal(store.getSelectedChallengeIds().includes('multi-2'), true);

  dom.window.close();
});

test('carica tutte le 735 challenge reali mantenendo ordine, ricerca e filtri', async () => {
  const dom = setupDom();
  const raw = readFileSync(new URL('../public/data/olicyber-challenges.json', import.meta.url), 'utf8');
  const realCatalog = JSON.parse(raw);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => realCatalog });

  try {
    const { loadCatalog, filterChallenges } = await import('../public/src/catalog.js');
    const { LocalStore } = await import('../public/src/store.js');
    const { createLibrary } = await import('../public/src/library.js');
    const { challenges } = await loadCatalog();
    assert.equal(challenges.length, 735);

    const store = new LocalStore();
    const library = createLibrary({ store, challenges, onSelect() {}, onOpenDetails() {} });
    const doc = dom.window.document;
    assert.equal(library.visible.length, 735);
    assert.equal(doc.querySelectorAll('#challenge-items .challenge-item').length, 735);
    assert.deepEqual(library.visible.map((item) => item.id), challenges.map((item) => item.id));
    assert.equal(doc.getElementById('challenge-count').textContent, '735 challenges · ordine del catalogo');
    assert.equal(doc.querySelectorAll('.provenance-badge--unverified').length, 735);
    assert.equal(doc.getElementById('difficulty-filter').closest('.field').hidden, true);
    assert.equal(doc.getElementById('edition-filter').closest('.field').hidden, true);
    assert.equal(doc.getElementById('path-filter').closest('.field').hidden, true);
    assert.equal(doc.getElementById('category-filter').closest('.field').hidden, false);
    assert.equal(doc.getElementById('tag-filter').closest('.field').hidden, false);

    const search = doc.getElementById('search-input');
    search.value = 'olicyber-775';
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    library.syncFilters();
    assert.deepEqual(library.visible.map((item) => item.id), ['olicyber-775']);

    search.value = 'non riesco a capire';
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    library.syncFilters();
    assert.equal(library.visible.some((item) => item.id === 'olicyber-1'), true);

    search.value = '';
    search.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    library.syncFilters();
    const category = doc.getElementById('category-filter');
    category.value = 'Web';
    category.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    library.syncFilters();
    assert.equal(library.visible.length, filterChallenges(challenges, { category: 'Web' }).length);
    assert.equal(library.visible.every((item) => item.category === 'Web'), true);

    doc.getElementById('clear-filters').click();
    library.syncFilters();
    assert.equal(library.visible.length, 735);

    const sort = doc.getElementById('sort-filter');
    sort.value = 'original-id';
    sort.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    library.syncFilters();
    assert.equal(library.visible[0].originalId, '1');
    assert.equal(library.visible.at(-1).originalId, '775');
  } finally {
    globalThis.fetch = originalFetch;
    dom.window.close();
  }
});
