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

function historyItem(doc, kind, title) {
  return [...doc.querySelectorAll(`#chat-history-${kind} .history-item`)]
    .find((item) => item.querySelector('.history-item__title')?.textContent === title);
}

test('cronologia chat: nuova chat, titoli, contesto, consegna persistente e collaborazione delle aree', async () => {
  const consoleErrors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => consoleErrors.push(error));
  virtualConsole.on('error', (...args) => consoleErrors.push(new Error(args.join(' '))));
  const dom = new JSDOM(html, {
    url: 'http://localhost:8788/', pretendToBeVisual: true, virtualConsole,
  });
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.localStorage = window.localStorage;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  window.localStorage.clear();
  window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
  window.HTMLDialogElement.prototype.showModal = function showModal() {};
  window.HTMLDialogElement.prototype.close = function close() {};

  const payloads = [];
  globalThis.fetch = async (url, options) => {
    const target = String(url);
    if (target.endsWith('/data/olicyber-challenges.json') || target.endsWith('/data/challenges.json')) {
      return jsonResponse(catalog);
    }
    if (target.endsWith('/api/status')) return jsonResponse({ mode: 'demo', model: null });
    if (target.endsWith('/api/chat')) {
      const payload = JSON.parse(options.body);
      payloads.push(payload);
      return jsonResponse({
        reply: `Risposta a: ${payload.message}`,
        mode: 'demo',
        challengeIds: payload.challengeIds,
        statementStatus: payload.statementExcerpt ? 'user-provided' : 'unavailable',
      });
    }
    throw new Error(`URL non previsto: ${target}`);
  };

  await import('../public/src/main.js');
  await wait(100);
  const doc = window.document;
  const saved = () => JSON.parse(window.localStorage.getItem('oliduck:state'));

  // La dashboard mostra dati reali del catalogo e la vista Training è richiamabile.
  assert.match(doc.getElementById('training-body').textContent, /7/);
  doc.querySelector('[data-sidebar-view="training"]').click();
  assert.equal(doc.getElementById('main-content').dataset.trainingOpen, 'true');
  doc.getElementById('close-training').click();
  assert.equal(doc.getElementById('main-content').dataset.trainingOpen, 'false');

  // Chat contestuale automatica.
  doc.querySelector('#challenge-list .challenge-item[data-id="demo-web-01"] .challenge-item__chat').click();
  await wait();
  doc.getElementById('chat-input').value = 'Come inizio?';
  doc.getElementById('chat-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(60);
  assert.deepEqual(payloads.at(-1).challengeIds, ['demo-web-01']);
  assert.ok(historyItem(doc, 'challenge', 'Come inizio?'));

  // Nuova chat generica: non eredita le challenge selezionate e riceve un titolo automatico.
  doc.getElementById('new-chat').click();
  await wait();
  assert.equal(doc.getElementById('mode-general').getAttribute('aria-checked'), 'true');
  const genericId = saved().activeConversation;
  assert.match(genericId, /^chat:/);
  doc.getElementById('chat-input').value = 'Spiegami il boxing';
  doc.getElementById('chat-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(60);
  assert.deepEqual(payloads.at(-1).challengeIds, []);
  assert.equal(payloads.at(-1).history.length, 0);
  assert.ok(historyItem(doc, 'general', 'Spiegami il boxing'));
  assert.equal(saved().conversationMeta[genericId].title, 'Spiegami il boxing');

  // Rinomina e persistenza del titolo.
  const rename = historyItem(doc, 'general', 'Spiegami il boxing').querySelector('.history-item__action');
  rename.click();
  const renameInput = doc.querySelector('#chat-history-general .history-item__rename');
  renameInput.value = 'Hashing basics';
  renameInput.dispatchEvent(new window.KeyboardEvent('keydown', {
    key: 'Enter', bubbles: true, cancelable: true,
  }));
  await wait();
  assert.ok(historyItem(doc, 'general', 'Hashing basics'));
  assert.equal(saved().conversationMeta[genericId].title, 'Hashing basics');

  // Riapertura della chat challenge: contesto e messaggi vengono ripristinati.
  historyItem(doc, 'challenge', 'Come inizio?').querySelector('.history-item__open').click();
  await wait();
  assert.equal(doc.getElementById('mode-challenge').getAttribute('aria-checked'), 'true');
  assert.deepEqual(saved().selectedChallengeIds, ['demo-web-01']);
  assert.ok([...doc.querySelectorAll('.chat-message__bubble')]
    .some((node) => node.textContent.includes('Come inizio?')));

  // L'estratto incollato resta associato alla chat anche nei follow-up.
  const excerpt = 'Prima riga della consegna\nSeconda riga della consegna con足够的 dettagli per essere spiegata.';
  doc.getElementById('statement-input').value = excerpt;
  doc.getElementById('chat-input').value = 'Spiegami la consegna';
  doc.getElementById('chat-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(60);
  assert.equal(payloads.at(-1).statementExcerpt, excerpt);
  assert.match(payloads.at(-1).statementExcerpt, /\n/);
  doc.getElementById('chat-input').value = 'Cosa significa?';
  doc.getElementById('chat-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(60);
  assert.equal(payloads.at(-1).statementExcerpt, excerpt);
  assert.equal(doc.getElementById('statement-input').value, '');

  // Eliminazione con conferma: la chat esplicita sparisce dalla cronologia e dallo store.
  const targetId = genericId;
  historyItem(doc, 'general', 'Hashing basics').querySelector('.history-item__action--delete').click();
  await wait();
  doc.getElementById('confirm-accept').click();
  await wait();
  assert.equal(historyItem(doc, 'general', 'Hashing basics'), undefined);
  assert.equal(saved().conversations[targetId], undefined);
  assert.equal(saved().conversationMeta[targetId], undefined);

  // Il tutor è collassabile e ripristinabile senza perdere la conversazione.
  doc.getElementById('toggle-assistant').click();
  assert.equal(doc.getElementById('main-content').dataset.assistantCollapsed, 'true');
  assert.equal(doc.getElementById('restore-assistant').hidden, false);
  doc.getElementById('restore-assistant').click();
  assert.equal(doc.getElementById('main-content').dataset.assistantCollapsed, 'false');

  assert.deepEqual(consoleErrors.map((error) => error.message), []);
  dom.window.close();
});
