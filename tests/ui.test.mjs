import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const catalog = JSON.parse(readFileSync(new URL('../public/data/challenges.json', import.meta.url), 'utf8'));
const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');

const wait = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

function jsonResponse(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => name.toLowerCase() === 'content-type' ? 'application/json' : null },
    json: async () => data,
  };
}

test('UI completa: catalogo, selezione, workspace e chat contestuale', async () => {
  const dom = new JSDOM(html, { url: 'http://localhost:8788/', pretendToBeVisual: true });
  const { window } = dom;
  globalThis.window = window;
  globalThis.document = window.document;
  window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });

  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url).endsWith('/data/challenges.json')) return jsonResponse(catalog);
    if (String(url).endsWith('/api/status')) return jsonResponse({ mode: 'demo', model: null });
    if (String(url).endsWith('/api/chat')) {
      const payload = JSON.parse(options.body);
      assert.equal(payload.challengeId, 'demo-web-01');
      return jsonResponse({ reply: '[DEMO] Prima ipotesi: osserva la query string.', mode: 'demo' });
    }
    throw new Error(`URL non previsto: ${url}`);
  };

  await import('../public/src/main.js');
  await wait(60);

  const doc = window.document;
  assert.equal(doc.querySelectorAll('#challenge-list .challenge-item').length, catalog.challenges.length);
  assert.match(doc.getElementById('challenge-count').textContent, /^7 challenge/);
  assert.equal(doc.getElementById('challenge-empty').hidden, false);
  assert.equal(doc.getElementById('detail-title').textContent, '');
  assert.equal(doc.getElementById('ai-status-label').textContent, 'Assistente: modalità DEMO');

  doc.querySelector('#challenge-list .challenge-item').click();
  await wait();
  assert.equal(doc.getElementById('challenge-empty').hidden, true);
  assert.equal(doc.getElementById('detail-title').textContent, 'Il parametro dimenticato');
  assert.match(doc.getElementById('detail-statement').textContent, /DEMO/);
  assert.equal(doc.getElementById('cycle-status').textContent, 'Segna in corso');
  assert.match(doc.getElementById('assistant-context-label').textContent, /Il parametro dimenticato/);
  assert.equal(doc.getElementById('chat-input').disabled, false);

  doc.getElementById('cycle-status').click();
  await wait();
  assert.equal(doc.getElementById('detail-status-label').textContent, 'In corso');
  assert.equal(doc.querySelector('#challenge-list .challenge-item .status-dot').dataset.status, 'in-progress');

  doc.getElementById('chat-input').value = 'Come inizio?';
  doc.getElementById('chat-form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(60);

  const bubbles = [...doc.querySelectorAll('.chat-message__bubble')].map((node) => node.textContent);
  assert.ok(bubbles.some((text) => text.includes('Contesto pronto')));
  assert.ok(bubbles.includes('Come inizio?'));
  assert.ok(bubbles.some((text) => text.includes('Prima ipotesi')));
  assert.equal(doc.getElementById('chat-error').hidden, true);
  assert.equal(doc.getElementById('clear-chat').disabled, false);

  const chatRequest = requests.find((entry) => entry.url.endsWith('/api/chat'));
  assert.ok(chatRequest);
  assert.equal(JSON.parse(chatRequest.options.body).challenge.title, 'Il parametro dimenticato');
  assert.equal(JSON.parse(chatRequest.options.body).history.length, 0);

  window.close();
});
