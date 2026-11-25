import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const ROW_HEIGHT = 96;

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

test('lista virtualizzata conserva lo scroll e gestisce focus e navigazione da tastiera', async () => {
  const dom = setupDom();
  const { LocalStore } = await import('../public/src/store.js');
  const { createLibrary } = await import('../public/src/library.js');

  const challenges = Array.from({ length: 30 }, (_, index) => ({
    id: `test-${index}`,
    title: `Challenge ${String(index).padStart(2, '0')}`,
    category: 'Web',
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

  list.scrollTop = ROW_HEIGHT * 10;
  library.render();
  let rows = [...doc.querySelectorAll('#challenge-items .challenge-item')];
  assert.equal(rows.length, 10);
  assert.equal(rows[0].dataset.index, '6');
  assert.equal(rows.at(-1).dataset.index, '15');
  assert.equal(rows[0].getAttribute('role'), 'listitem');
  assert.equal(rows[0].getAttribute('aria-posinset'), '7');
  assert.equal(rows[0].getAttribute('aria-setsize'), '30');

  rows[0].querySelector('.challenge-item__main').focus();
  press(doc.activeElement, 'ArrowDown');
  assert.equal(activeIndex(doc), '7');
  assert.equal(list.scrollTop, ROW_HEIGHT * 7);
  rows = [...doc.querySelectorAll('#challenge-items .challenge-item')];
  assert.equal(rows.some((row) => row.dataset.index === '7'), true);

  press(doc.activeElement, 'Home');
  assert.equal(activeIndex(doc), '0');
  assert.equal(list.scrollTop, 0);

  press(doc.activeElement, 'End');
  assert.equal(activeIndex(doc), '29');
  assert.equal(list.scrollTop, ROW_HEIGHT * 28);
  rows = [...doc.querySelectorAll('#challenge-items .challenge-item')];
  assert.equal(rows.some((row) => row.dataset.index === '29'), true);
  assert.equal(rows.length < challenges.length, true);

  // Aggiornamenti non strutturali: selezione e stato non azzerano lo scroll.
  list.scrollTop = ROW_HEIGHT * 5;
  store.selectChallenge('test-10');
  library.render();
  assert.equal(list.scrollTop, ROW_HEIGHT * 5);
  store.setStatus('test-10', 'completed');
  library.render();
  assert.equal(list.scrollTop, ROW_HEIGHT * 5);

  // Il cambio filtro è strutturale: lo scroll torna all'inizio.
  store.setFilter('query', 'Challenge 07');
  library.syncFilters();
  assert.equal(list.scrollTop, 0);
  assert.equal(doc.querySelectorAll('#challenge-items .challenge-item').length, 1);
  assert.match(doc.getElementById('challenge-count').textContent, /^1 challenge/);

  dom.window.close();
});
