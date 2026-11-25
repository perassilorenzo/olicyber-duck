import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const catalog = JSON.parse(readFileSync(new URL('../public/data/challenges.json', import.meta.url), 'utf8'));
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const encoder = new TextEncoder();
const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function sseResponse(tokens) {
  const stream = new ReadableStream({
    start(controller) {
      for (const token of tokens) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token })}\n\n`));
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } });
}

test('la shell contiene esattamente due pannelli, splitter e drawer in overlay', () => {
  const dom = new JSDOM(html);
  const { document: doc } = dom.window;
  assert.equal(doc.querySelectorAll('main > .panel').length, 2);
  assert.ok(doc.getElementById('library-panel'));
  assert.ok(doc.getElementById('assistant-panel'));
  assert.equal(doc.getElementById('workspace-panel'), null);
  assert.ok(doc.getElementById('splitter'));
  assert.equal(doc.querySelectorAll('[data-panel-tab]').length, 2);
  assert.ok(doc.getElementById('details-drawer'));
  assert.equal(doc.getElementById('details-drawer').getAttribute('role'), 'dialog');
  assert.ok(doc.getElementById('chat-input'));
  assert.ok(doc.getElementById('mode-general'));
  assert.ok(doc.getElementById('mode-challenge'));
  dom.window.close();
});

test('workspace completo: libreria, dettagli, chat contestuale, generale, errori e annullamento', async () => {
  const dom = new JSDOM(html, { url: 'http://localhost:8788/', pretendToBeVisual: true });
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.localStorage = window.localStorage;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  window.localStorage.clear();

  let compact = false;
  window.matchMedia = () => ({ matches: compact, addListener() {}, removeListener() {} });

  const payloads = [];
  let chatHandler = async (payload) => jsonResponse({
    reply: `[DEMO] Prima ipotesi per ${payload.challengeId}: osserva i dati in ingresso.`,
    mode: 'demo',
    challengeId: payload.challengeId,
  });

  globalThis.fetch = async (url, options) => {
    const target = String(url);
    if (target.endsWith('/data/challenges.json')) return jsonResponse(catalog);
    if (target.endsWith('/api/status')) return jsonResponse({ mode: 'demo', model: null });
    if (target.endsWith('/api/chat')) {
      const payload = JSON.parse(options.body);
      payloads.push(payload);
      return chatHandler(payload, options);
    }
    throw new Error(`URL non previsto: ${target}`);
  };

  await import('../public/src/main.js');
  await wait(100);

  const doc = window.document;
  assert.equal(doc.querySelectorAll('#challenge-list .challenge-item').length, catalog.challenges.length);
  assert.match(doc.getElementById('challenge-count').textContent, /^7 challenge/);
  assert.equal(doc.getElementById('ai-status-label').textContent, 'Assistente: modalità DEMO');
  assert.equal(doc.getElementById('mode-general').getAttribute('aria-checked'), 'true');
  assert.equal(doc.getElementById('chat-input').disabled, false);
  assert.match(doc.getElementById('chat-input').placeholder, /hint/);

  // Larghezza persistita.
  const slider = doc.getElementById('panel-width-setting');
  slider.value = '55';
  slider.dispatchEvent(new window.Event('input', { bubbles: true }));
  slider.dispatchEvent(new window.Event('change', { bubbles: true }));
  await wait();
  assert.match(doc.getElementById('main-content').style.getPropertyValue('--library-width'), /^55%/);
  assert.equal(doc.getElementById('assistant-width-value').textContent, '45%');
  const saved = JSON.parse(window.localStorage.getItem('oliduck:state'));
  assert.equal(saved.preferences.panelWidth, 55);

  // Filtri derivati dai dati e ordinamento.
  doc.getElementById('search-input').value = 'query string';
  doc.getElementById('search-input').dispatchEvent(new window.Event('input', { bubbles: true }));
  await wait();
  assert.equal(doc.querySelectorAll('#challenge-list .challenge-item').length, 1);
  doc.getElementById('clear-filters').click();
  await wait();
  assert.equal(doc.querySelectorAll('#challenge-list .challenge-item').length, 7);

  // Selezione e conversazione contestuale.
  doc.querySelector('#challenge-list .challenge-item[data-id="demo-web-01"] .challenge-item__main').click();
  await wait();
  assert.equal(doc.getElementById('mode-challenge').getAttribute('aria-checked'), 'true');
  assert.match(doc.getElementById('assistant-context-label').textContent, /Il parametro dimenticato/);
  assert.equal(doc.getElementById('chat-input').disabled, false);

  doc.getElementById('chat-input').value = 'Come inizio?';
  doc.getElementById('chat-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(80);
  let bubbles = [...doc.querySelectorAll('.chat-message__bubble')].map((node) => node.textContent);
  assert.ok(bubbles.some((text) => text.includes('Come inizio?')));
  assert.ok(bubbles.some((text) => text.includes('Prima ipotesi')));
  assert.equal(doc.getElementById('chat-error').hidden, true);
  assert.equal(payloads.at(-1).challengeId, 'demo-web-01');
  assert.equal('challenge' in payloads.at(-1), false);
  assert.equal(payloads.at(-1).history.length, 0);

  // Dettagli in overlay: la chat resta nel secondo pannello.
  doc.querySelector('#challenge-list .challenge-item[data-id="demo-web-01"] .challenge-item__details').click();
  await wait();
  assert.equal(doc.getElementById('drawer-layer').hidden, false);
  assert.equal(doc.getElementById('details-drawer').getAttribute('aria-hidden'), 'false');
  assert.equal(doc.getElementById('details-title').textContent, 'Il parametro dimenticato');
  doc.getElementById('close-details').click();
  await wait();
  assert.equal(doc.getElementById('drawer-layer').hidden, true);

  // Modalità generale: conversazione separata e streaming SSE cumulativo.
  chatHandler = async () => sseResponse(['Principio ', 'generale.']);
  doc.getElementById('mode-general').click();
  await wait();
  assert.equal(doc.getElementById('mode-general').getAttribute('aria-checked'), 'true');
  assert.equal(doc.getElementById('chat-input').disabled, false);
  doc.getElementById('chat-input').value = 'Spiegami il boxing';
  doc.getElementById('chat-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(100);
  bubbles = [...doc.querySelectorAll('.chat-message__bubble')].map((node) => node.textContent);
  assert.ok(bubbles.includes('Principio generale.'));
  assert.equal(payloads.at(-1).challengeId, 'general');
  assert.equal(payloads.at(-1).history.length, 0);

  // Tornando alla challenge ritroviamo la conversazione dedicata.
  doc.getElementById('mode-challenge').click();
  await wait();
  bubbles = [...doc.querySelectorAll('.chat-message__bubble')].map((node) => node.textContent);
  assert.ok(bubbles.some((text) => text.includes('Come inizio?')));
  assert.equal(bubbles.includes('Spiegami il boxing'), false);

  // Errore del backend con retry.
  chatHandler = async () => jsonResponse({ error: 'Errore simulato dal server' }, 503);
  doc.getElementById('chat-input').value = 'Prova errore';
  doc.getElementById('chat-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(80);
  assert.equal(doc.getElementById('chat-error').hidden, false);
  assert.match(doc.getElementById('chat-error-message').textContent, /Errore simulato dal server/);
  assert.equal(doc.getElementById('retry-chat').hidden, false);

  // Cambio modalità durante una richiesta lenta: la risposta vecchia non entra nella chat nuova.
  chatHandler = async (payload, options) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(jsonResponse({ reply: 'RISPOSTA_VECCHIA', mode: 'demo' })), 250);
    options.signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    });
  });
  doc.getElementById('chat-input').value = 'Richiesta lenta';
  doc.getElementById('chat-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(20);
  assert.equal(doc.getElementById('cancel-chat').hidden, false);
  doc.getElementById('mode-general').click();
  await wait(320);
  bubbles = [...doc.querySelectorAll('.chat-message__bubble')].map((node) => node.textContent);
  assert.equal(bubbles.includes('RISPOSTA_VECCHIA'), false);
  assert.equal(doc.getElementById('chat-input').disabled, false);
  assert.equal(doc.getElementById('cancel-chat').hidden, true);

  // Tab mobile: solo due pannelli selezionabili.
  compact = true;
  doc.querySelector('[data-panel-tab="library"]').click();
  await wait();
  assert.equal(doc.getElementById('main-content').dataset.view, 'library');
  assert.equal(doc.querySelector('[data-panel-tab="library"]').getAttribute('aria-selected'), 'true');
  compact = false;

  const generalSaved = JSON.parse(window.localStorage.getItem('oliduck:state'));
  assert.ok(generalSaved.conversations.general.length >= 1);
  assert.ok(generalSaved.conversations['demo-web-01'].length >= 2);
  assert.equal(generalSaved.conversations.general.some((item) => item.content === 'RISPOSTA_VECCHIA'), false);

  dom.window.close();
});
