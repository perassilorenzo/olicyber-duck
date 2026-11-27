import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM, VirtualConsole } from 'jsdom';

import { onRequestPost } from '../functions/api/chat.js';
import { INTENTS } from '../functions/lib/system-prompt.js';
import { parseChatRequest } from '../functions/lib/validate.js';
import { createAssistant } from '../public/src/assistant.js';
import { LocalStore } from '../public/src/store.js';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const OTHER_CHALLENGE = 'olicyber-2';
const CHALLENGE = 'olicyber-1';

const STATEMENT = "In questa challenge le lettere evidenziate nella pagina web accessibile all'URL http://web-13.challs.olicyber.it/ formano la flag. L'obiettivo è isolarle dal resto della pagina e concatenarle. Si consiglia di utilizzare il metodo find_all della libreria BeautifulSoup con un filtro adeguato, e di iterare sul risultato. N.B. flag presentata senza cornice flag{...}, bisogna aggiungerla a mano.";

const DIDACTIC_REPLY = `In parole semplici: devi distinguere le lettere evidenziate dal resto della pagina.
Obiettivo: concatenare le lettere.
Cosa hai a disposizione: l'URL indicato.
Tecnologie: BeautifulSoup legge l'HTML e find_all cerca elementi.
Come ragionare: osserva la struttura prima di scrivere codice.
Da dove iniziare: apri la pagina e descrivi il criterio.
Cosa impari: trasformare una descrizione in una domanda sui dati.`;

let ip = 7300;
const wait = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));

function request(message, {
  challengeIds = [CHALLENGE], history = [], statementExcerpt, statementChallengeIds,
} = {}) {
  ip += 1;
  const payload = { message, challengeIds, history };
  if (statementExcerpt) payload.statementExcerpt = statementExcerpt;
  if (statementChallengeIds) payload.statementChallengeIds = statementChallengeIds;
  return new Request('https://oliduck.pages.dev/api/chat', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: {
      'Content-Type': 'application/json',
      'cf-connecting-ip': `127.31.5.${ip % 250}`,
    },
  });
}

function fakeAi() {
  const state = { calls: 0, inputs: [] };
  return {
    state,
    env: {
      AI: {
        run: async (_model, input) => {
          state.calls += 1;
          state.inputs.push(input);
          return { response: DIDACTIC_REPLY };
        },
      },
    },
  };
}

function providerStream(text) {
  const encoder = new TextEncoder();
  const parts = String(text).match(/[\s\S]{1,20}/g) || [''];
  return new ReadableStream({
    start(controller) {
      for (const part of parts) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ response: part })}\n\n`));
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
}

function fakeAiStream() {
  const state = { calls: 0, inputs: [] };
  return {
    state,
    env: {
      AI: {
        run: async (_model, input) => {
          state.calls += 1;
          state.inputs.push(input);
          return providerStream(DIDACTIC_REPLY);
        },
      },
    },
  };
}

async function readEvents(response) {
  const text = await response.text();
  return text.split('\n').filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice(6).trim()));
}

async function post(message, options = {}, { stream = false } = {}) {
  const ai = stream ? fakeAiStream() : fakeAi();
  const response = await onRequestPost({ request: request(message, options), env: ai.env });
  if (stream && (response.headers.get('content-type') || '').includes('text/event-stream')) {
    const events = await readEvents(response);
    return { data: events.at(-1), events, fake: ai };
  }
  return { data: await response.json(), fake: ai };
}

function excerptBlock(messages) {
  assert.ok(Array.isArray(messages) && messages.length > 1, 'il modello non ha ricevuto messaggi');
  const found = messages.find((item) => item.content.includes('Estratto della consegna incollato'));
  assert.ok(found, 'il modello non ha ricevuto l’estratto della consegna');
  return found.content;
}

const PASTE_HISTORY = [
  { role: 'user', content: STATEMENT },
  { role: 'assistant', content: DIDACTIC_REPLY },
];

function assertUsesStatement(result, message) {
  assert.equal(result.data.statementMissing, undefined, message);
  assert.equal(result.data.blocked, undefined, message);
  assert.equal(result.data.statementProvided, true, message);
  assert.equal(result.fake.state.calls, 1, message);
  assert.doesNotMatch(result.data.reply, /Non ho il testo della consegna/, message);
  const messages = result.fake.state.inputs[0].messages;
  const excerpt = excerptBlock(messages);
  assert.match(excerpt, /lettere evidenziate/, message);
  assert.match(excerpt, /find_all/, message);
  assert.match(excerpt, /BeautifulSoup/, message);
}

for (const stream of [false, true]) {
  const label = stream ? 'SSE' : 'JSON';

  test(`BUGFIX ${label}: la consegna BeautifulSoup resta disponibile per ogni follow-up didattico`, async () => {
    for (const message of [
      'Non ho capito che cosa devo fare.',
      'Mi spieghi meglio?',
      'Da dove comincio?',
      'Come funziona find_all?',
      'Mi fai un esempio didattico?',
      'Qual è il risultato che devo ottenere?',
    ]) {
      const result = await post(message, { history: PASTE_HISTORY }, { stream });
      assertUsesStatement(result, message);
      assert.equal(result.data.statementSource, 'chat-history', message);
    }
  });

  test(`BUGFIX ${label}: la consegna non fornita viene ancora richiesta`, async () => {
    const result = await post('Non ho capito che cosa devo fare.', {}, { stream });
    assert.equal(result.data.statementMissing, true);
    assert.equal(result.data.statementProvided, false);
    assert.match(result.data.reply, /Incolla|incolla/);
    assert.equal(result.fake.state.calls, 0);
  });

  test(`BUGFIX ${label}: una consegna incollata all'inizio di una chat lunga resta reperibile`, async () => {
    const history = [...PASTE_HISTORY];
    for (let index = 1; index <= 10; index += 1) {
      history.push({ role: 'user', content: `Domanda ${index} sulla pagina web?` });
      history.push({ role: 'assistant', content: 'Risposta didattica senza soluzione.' });
    }
    assert.equal(history.length <= 24, true);
    const result = await post('Non ho capito che cosa devo fare.', { history }, { stream });
    assertUsesStatement(result);
    assert.equal(result.data.statementSource, 'chat-history');
  });
}

test('una consegna associata a un’altra challenge non viene usata come mia', async () => {
  const result = await post('Spiegami la consegna', {
    statementExcerpt: STATEMENT,
    statementChallengeIds: [OTHER_CHALLENGE],
    challengeIds: [CHALLENGE],
  });
  assert.equal(result.data.statementProvided, false);
  assert.equal(result.data.statementChallengeMismatch, true);
  assert.match(result.data.reply, /challenge|consegna/i);
  assert.equal(result.fake.state.calls, 0);

  const same = await post('Spiegami la consegna', {
    statementExcerpt: STATEMENT,
    statementChallengeIds: [CHALLENGE],
    challengeIds: [CHALLENGE],
  });
  assertUsesStatement(same);
});

test('il server accetta e limita le challenge associate all’estratto', () => {
  const parsed = parseChatRequest(JSON.stringify({
    message: 'Spiegami', challengeIds: [CHALLENGE],
    statementChallengeIds: [CHALLENGE, CHALLENGE],
  }));
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.value.statementChallengeIds, [CHALLENGE]);
  const invalid = parseChatRequest(JSON.stringify({
    message: 'Spiegami', statementChallengeIds: ['../../etc/passwd'],
  }));
  assert.equal(invalid.ok, false);
});

function setupDom(savedState) {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => { throw error; });
  const dom = new JSDOM(html, { url: 'http://localhost:8788/', pretendToBeVisual: true, virtualConsole });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  dom.window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
  if (savedState) dom.window.localStorage.setItem('oliduck:state', savedState);
  return dom;
}

test('continuità UI: consegna incollata in chat salvata, rinviata e conservata dopo refresh', async () => {
  const dom = setupDom();
  const payloads = [];
  globalThis.fetch = async (url, options) => {
    const payload = JSON.parse(options.body);
    payloads.push(payload);
    const response = await onRequestPost({
      request: new Request('https://oliduck.pages.dev/api/chat', {
        method: 'POST', body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '127.44.5.5' },
      }),
      env: fakeAi().env,
    });
    return response;
  };

  const store = new LocalStore();
  createAssistant({ store, getSelectedChallenges: () => [], getChallenge: () => null });
  const doc = dom.window.document;

  async function send(text) {
    doc.getElementById('chat-input').value = text;
    doc.getElementById('chat-form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    await wait(120);
    const bubbles = [...doc.querySelectorAll('.chat-message--assistant:not(.chat-message--greeting) .chat-message__bubble')];
    return bubbles.at(-1)?.textContent || '';
  }

  const firstReply = await send(STATEMENT);
  assert.doesNotMatch(firstReply, /Non ho il testo della consegna/);
  const saved = dom.window.localStorage.getItem('oliduck:state');
  const state = JSON.parse(saved);
  const key = state.activeConversation;
  assert.match(state.conversationMeta[key].statementExcerpt, /lettere evidenziate/);
  assert.match(state.conversationMeta[key].statementExcerpt, /find_all/);
  dom.window.close();

  // Refresh: nuova pagina, nuovo store, stessa memoria locale.
  const reloaded = setupDom(saved);
  const reloadedStore = new LocalStore();
  createAssistant({ store: reloadedStore, getSelectedChallenges: () => [], getChallenge: () => null });
  const reloadedDoc = reloaded.window.document;
  reloadedDoc.getElementById('chat-input').value = 'Non ho capito che cosa devo fare.';
  reloadedDoc.getElementById('chat-form').dispatchEvent(new reloaded.window.Event('submit', { bubbles: true, cancelable: true }));
  await wait(120);
  const followUp = payloads.at(-1);
  assert.match(followUp.statementExcerpt, /lettere evidenziate/);
  assert.match(followUp.statementExcerpt, /find_all/);
  assert.equal(followUp.history.some((item) => item.content === STATEMENT), true);
  const bubbles = [...reloadedDoc.querySelectorAll('.chat-message--assistant:not(.chat-message--greeting) .chat-message__bubble')];
  assert.doesNotMatch(bubbles.at(-1).textContent, /Non ho il testo della consegna/);
  reloaded.window.close();
});
