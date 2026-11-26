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
