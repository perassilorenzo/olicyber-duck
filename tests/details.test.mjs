import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

function baseChallenge() {
  return {
    id: 'test-1',
    title: 'Challenge di test',
    description: 'Descrizione di test',
    statement: 'Testo di test',
    category: 'Web',
    difficulty: 'Facile',
    edition: null,
    path: null,
    score: null,
    author: null,
    originalId: '1',
    publishedAt: null,
    state: null,
    available: true,
    tags: [],
    attachments: [],
    metadata: {},
    demo: false,
    source: 'Export di test',
  };
}

test('il drawer non rende cliccabili URL non HTTPS e mostra provenienza reale', async () => {
  const dom = new JSDOM(html, { url: 'http://localhost:8788/', pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  dom.window.localStorage.clear();

  const { LocalStore } = await import('../public/src/store.js');
  const { createDetails } = await import('../public/src/details.js');
  const doc = dom.window.document;
  let current = {
    ...baseChallenge(),
    sourceUrl: 'javascript:alert(1)',
    attachments: [{ name: 'pagina', url: 'data:text/html;base64,PHNjcmlwdD4=' }],
    provenance: { source: 'Export di test', sourceUrl: 'file:///etc/passwd', verified: false },
  };
  const details = createDetails({
    store: new LocalStore(),
    getChallenge: () => current,
    onAsk() {},
  });
  details.open();
  const body = doc.getElementById('details-body');
  assert.equal(body.querySelector('.provenance-badge').textContent, 'NON VERIFICATA');
  assert.equal(body.querySelectorAll('a[href]').length, 0);
  assert.equal(body.textContent.includes('URL non disponibile'), true);
  assert.equal(doc.getElementById('main-content').hasAttribute('inert'), true);

  current = {
    ...baseChallenge(),
    sourceUrl: 'https://example.invalid/source',
    attachments: [{ name: 'allegato', url: 'https://example.invalid/file' }],
    provenance: {
      source: 'Export autorizzato',
      sourceUrl: 'https://example.invalid/record',
      verified: true,
      catalogVerified: true,
    },
  };
  details.render();
  assert.equal(body.querySelector('.provenance-badge').textContent, 'VERIFICATA');
  const hrefs = [...body.querySelectorAll('a[href]')].map((anchor) => anchor.getAttribute('href'));
  assert.deepEqual(hrefs, [
    'https://example.invalid/source',
    'https://example.invalid/file',
    'https://example.invalid/record',
  ]);

  details.close();
  assert.equal(doc.getElementById('main-content').hasAttribute('inert'), false);
  dom.window.close();
});

test('il drawer mostra hint, tipi di allegato e anteprime senza link per URL non sicuri', async () => {
  const dom = new JSDOM(html, { url: 'http://localhost:8788/', pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  dom.window.localStorage.clear();

  const { LocalStore } = await import('../public/src/store.js');
  const { createDetails } = await import('../public/src/details.js');
  const current = {
    ...baseChallenge(),
    metadata: { hints: ['Osserva il formato del messaggio'] },
    attachments: [
      { name: 'dashed.txt', kind: 'text', preview: '- --..--', url: null },
      { name: 'payload.bin', kind: 'binary' },
      { name: 'broken.zip', kind: 'error', error: 'HTTP 500' },
      { name: 'interno', kind: 'unknown', url: '/api/file/123' },
    ],
  };
  createDetails({ store: new LocalStore(), getChallenge: () => current, onAsk() {} });
  const body = dom.window.document.getElementById('details-body');

  assert.match(body.textContent, /Hint disponibili/);
  assert.match(body.textContent, /Osserva il formato del messaggio/);
  assert.deepEqual(
    [...body.querySelectorAll('.attachment-kind')].map((node) => node.textContent),
    ['Testo', 'Binario', 'Errore', 'Sconosciuto'],
  );
  assert.equal(body.querySelectorAll('a[href]').length, 0);
  assert.match(body.textContent, /URL non disponibile/);
  assert.match(body.querySelector('.attachment-preview').textContent, /--\.\.--/);
  assert.match(body.textContent, /Errore durante l'importazione: HTTP 500/);

  dom.window.close();
});

test('il drawer omette le sezioni vuote e formatta codice e link senza innerHTML', async () => {
  const dom = new JSDOM(html, { url: 'http://localhost:8788/', pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  dom.window.localStorage.clear();

  const { LocalStore } = await import('../public/src/store.js');
  const { createDetails } = await import('../public/src/details.js');
  const current = {
    ...baseChallenge(),
    description: 'Usa `codice` e leggi [guida](https://example.invalid/guida).',
    statement: '',
    score: null,
    author: null,
    originalId: null,
    tags: [],
    metadata: {},
    attachments: [],
    sourceUrl: null,
    provenance: { verified: false },
  };
  const details = createDetails({ store: new LocalStore(), getChallenge: () => current, onAsk() {} });
  details.open();
  const body = dom.window.document.getElementById('details-body');

  assert.equal(body.querySelectorAll('code').length, 1);
  assert.equal(body.querySelector('code').textContent, 'codice');
  assert.equal(body.querySelectorAll('a[href]').length, 1);
  assert.equal(body.querySelector('a[href]').getAttribute('href'), 'https://example.invalid/guida');
  assert.equal(body.textContent.includes('Testo completo della challenge'), false);
  assert.equal(body.textContent.includes('Hint disponibili'), false);
  assert.equal(body.textContent.includes('Fonti e allegati'), false);
  assert.equal(body.textContent.includes('Tag'), false);
  assert.equal(body.textContent.includes('undefined'), false);
  assert.equal(body.textContent.includes('null'), false);
  for (const row of body.querySelectorAll('.resource-row')) {
    assert.equal(row.textContent.trim().length > 0, true);
  }
  details.close();
  dom.window.close();
});

test('il drawer non ripete la descrizione quando lo statement la contiene già', async () => {
  const dom = new JSDOM(html, { url: 'http://localhost:8788/', pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  dom.window.localStorage.clear();

  const { LocalStore } = await import('../public/src/store.js');
  const { createDetails } = await import('../public/src/details.js');
  let current = {
    ...baseChallenge(),
    description: 'Descrizione essenziale',
    statement: 'Descrizione essenziale\n\nAllegati: file.txt',
  };
  const details = createDetails({ store: new LocalStore(), getChallenge: () => current, onAsk() {} });
  details.open();
  const body = dom.window.document.getElementById('details-body');
  assert.equal(body.textContent.split('Descrizione essenziale').length - 1, 1);
  assert.equal(body.textContent.includes('Testo completo della challenge'), false);

  current = { ...current, statement: 'Descrizione essenziale\nSpiegazione aggiuntiva' };
  details.render();
  assert.equal(body.textContent.includes('Testo completo della challenge'), true);
  assert.equal(body.textContent.includes('Spiegazione aggiuntiva'), true);

  details.close();
  dom.window.close();
});

test('il dettaglio di una challenge reale mostra metadati e allegati senza duplicazioni', async () => {
  const dom = new JSDOM(html, { url: 'http://localhost:8788/', pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  dom.window.localStorage.clear();

  const raw = readFileSync(new URL('../public/data/olicyber-challenges.json', import.meta.url), 'utf8');
  const realCatalog = JSON.parse(raw);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, json: async () => realCatalog });

  try {
    const { loadCatalog } = await import('../public/src/catalog.js');
    const { LocalStore } = await import('../public/src/store.js');
    const { createDetails } = await import('../public/src/details.js');
    const { challenges } = await loadCatalog();
    const details = createDetails({
      store: new LocalStore(),
      getChallenge: () => challenges[0],
      onAsk() {},
    });
    details.open();
    const doc = dom.window.document;
    const body = doc.getElementById('details-body');
    assert.equal(doc.getElementById('details-title').textContent, 'Dashed');
    for (const text of [
      '#1', 'olicyber-1', 'Misc', '489 pt', 'NON VERIFICATA', 'Risoluzioni',
      'Argomenti hint', 'Allegati registrati', 'dashed.txt',
    ]) {
      assert.equal(body.textContent.includes(text), true, `manca "${text}" dal dettaglio`);
    }
    assert.equal(body.textContent.includes('Testo completo della challenge'), false);
    assert.equal(body.textContent.includes('undefined'), false);
    assert.equal(body.textContent.includes('null'), false);
    assert.equal(body.querySelectorAll('a[href]').length, 0);

    doc.getElementById('details-backdrop').click();
    assert.equal(doc.getElementById('drawer-layer').hidden, true);
    assert.equal(doc.getElementById('details-drawer').getAttribute('aria-hidden'), 'true');
  } finally {
    globalThis.fetch = originalFetch;
    dom.window.close();
  }
});

test('apertura e chiusura del drawer non toccano la selezione; Chiedi passa la challenge', async () => {
  const dom = new JSDOM(html, { url: 'http://localhost:8788/', pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  dom.window.localStorage.clear();

  const { LocalStore } = await import('../public/src/store.js');
  const { createDetails } = await import('../public/src/details.js');
  const doc = dom.window.document;
  const store = new LocalStore();
  store.setSelectedChallengeIds(['gia-selezionata']);
  const current = baseChallenge();
  const asked = [];
  const details = createDetails({
    store,
    getChallenge: () => current,
    onAsk: (challenge) => asked.push(challenge.id),
  });

  details.open();
  assert.deepEqual(store.getSelectedChallengeIds(), ['gia-selezionata']);
  assert.equal(doc.getElementById('details-drawer').getAttribute('aria-hidden'), 'false');
  details.close();
  assert.deepEqual(store.getSelectedChallengeIds(), ['gia-selezionata']);

  details.open();
  doc.getElementById('ask-from-details').click();
  assert.deepEqual(asked, ['test-1']);
  assert.deepEqual(store.getSelectedChallengeIds(), ['gia-selezionata']);
  assert.equal(doc.getElementById('drawer-layer').hidden, true);
  assert.equal(doc.getElementById('details-drawer').getAttribute('aria-hidden'), 'true');

  dom.window.close();
});
