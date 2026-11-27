import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

const catalog = JSON.parse(readFileSync(new URL('../public/data/challenges.json', import.meta.url), 'utf8'));
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));
const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
});

function setupDom() {
  const consoleErrors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => consoleErrors.push(error));
  virtualConsole.on('error', (...args) => consoleErrors.push(new Error(args.join(' '))));
  const dom = new JSDOM(html, {
    url: 'http://localhost:8788/', pretendToBeVisual: true, virtualConsole,
  });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  dom.window.localStorage.clear();
  dom.window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
  dom.window.HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function close() { this.open = false; };
  return { dom, consoleErrors };
}

function bubbles(doc) {
  return [...doc.querySelectorAll('.chat-message__bubble')].map((node) => node.textContent);
}

test('chat: copia codice, modifica messaggio, rigenerazione, stato e challenge nell’header', async () => {
  const { dom, consoleErrors } = setupDom();
  const { window } = dom;
  const doc = window.document;
  const copied = [];
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { clipboard: { writeText: async (text) => { copied.push(text); } } },
  });

  const payloads = [];
  let replies = [
    'Ecco un esempio:\n\n```py\nprint("ciao")\n```',
    'Risposta rigenerata senza codice.',
  ];
  let replyIndex = 0;
  globalThis.fetch = async (url, options) => {
    const target = String(url);
    if (target.endsWith('/data/olicyber-challenges.json') || target.endsWith('/data/challenges.json')) {
      return jsonResponse(catalog);
    }
    if (target.endsWith('/api/status')) return jsonResponse({ mode: 'demo', model: null });
    if (target.endsWith('/api/chat')) {
      const payload = JSON.parse(options.body);
      payloads.push(payload);
      return jsonResponse({ reply: replies[Math.min(replyIndex, replies.length - 1)], mode: 'demo' });
    }
    throw new Error(`URL non previsto: ${target}`);
  };

  await import('../public/src/main.js');
  await wait(100);

  // Selezione contestuale: l'header compatto riporta la challenge attiva.
  doc.querySelector('#challenge-list .challenge-item[data-id="demo-web-01"] .challenge-item__chat').click();
  await wait();
  assert.match(doc.getElementById('assistant-challenge-label').textContent, /Challenge: Il parametro dimenticato/);
  assert.equal(doc.getElementById('cancel-chat').textContent.trim(), 'Ferma');
  assert.equal(doc.getElementById('cancel-chat').hidden, true);

  doc.getElementById('chat-input').value = 'Prima domanda';
  doc.getElementById('chat-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(80);
  assert.ok(bubbles(doc).some((text) => text.includes('Prima domanda')));
  assert.equal(payloads.at(-1).challengeIds[0], 'demo-web-01');

  // Copia del blocco codice: il pulsante usa il testo del <code>, non HTML.
  const copy = doc.querySelector('.chat-message--assistant .code-copy');
  assert.ok(copy);
  assert.equal(copy.getAttribute('aria-label'), 'Copia il blocco di codice');
  copy.click();
  await wait();
  assert.deepEqual(copied, ['print("ciao")']);
  assert.equal(copy.textContent, 'Copiato');
  assert.equal(doc.querySelector('.chat-message--assistant pre code').textContent, 'print("ciao")');

  // Modifica: il messaggio utente viene sostituito, non duplicato.
  const userAction = doc.querySelector('.chat-message--user .chat-message__action');
  assert.equal(userAction.textContent, 'Modifica');
  userAction.click();
  assert.equal(doc.getElementById('chat-input').value, 'Prima domanda');
  assert.match(doc.getElementById('chat-status').textContent, /Modifica in corso/);
  doc.getElementById('chat-input').value = 'Domanda modificata';
  doc.getElementById('chat-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(80);
  const state = JSON.parse(window.localStorage.getItem('oliduck:state'));
  const key = state.activeConversation;
  assert.equal(key, 'ctx:demo-web-01');
  assert.equal(state.conversations[key].length, 2);
  assert.equal(state.conversations[key][0].content, 'Domanda modificata');
  assert.equal(state.conversations[key].filter((item) => item.role === 'user').length, 1);
  assert.ok(bubbles(doc).some((text) => text.includes('Domanda modificata')));
  assert.equal(bubbles(doc).some((text) => text === 'Prima domanda'), false);
  assert.equal(payloads.at(-1).history.map((item) => item.content).includes('Domanda modificata'), true);

  // Rigenerazione: la vecchia risposta viene rimpiazzata dalla nuova.
  replyIndex = 1;
  const regenerate = doc.querySelector('.chat-message--assistant .chat-message__action');
  assert.equal(regenerate.textContent, 'Rigenera');
  regenerate.click();
  await wait(80);
  const after = JSON.parse(window.localStorage.getItem('oliduck:state'));
  assert.equal(after.conversations[key].length, 2);
  assert.equal(after.conversations[key][1].content, 'Risposta rigenerata senza codice.');
  assert.ok(bubbles(doc).some((text) => text.includes('Risposta rigenerata senza codice.')));
  assert.equal(doc.querySelector('.code-copy'), null);

  assert.deepEqual(consoleErrors.map((error) => error.message), []);
  dom.window.close();
});
