import test from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost } from '../functions/api/chat.js';
import { INTENTS } from '../functions/lib/system-prompt.js';

const CHALLENGE_ID = 'olicyber-1';
const encoder = new TextEncoder();
let ip = 6100;

const FIRST_MESSAGE = 'Non ho capito che cosa devo fare e come';
const STATEMENT_PASTE = "In questa challenge le lettere evidenziate nella pagina web accessibile all'URL http://web-13.challs.olicyber.it/ formano la flag. L'obiettivo è isolarle dal resto della pagina e concatenarle. Si consiglia di utilizzare il metodo find_all della libreria BeautifulSoup con un filtro adeguato, e di iterare sul risultato. La flag viene presentata senza la sua tipica cornice flag{.";
const CONFUSION = 'Non ho capito che cosa devo fare, non ho capito la consegna';
const CONTINUATION = 'Adesso spiega';

const DIDACTIC_REPLY = `In parole semplici: la pagina contiene lettere evidenziate da distinguere dal resto del testo.

Obiettivo: ricostruire il risultato richiesto senza inventarlo.

Cosa hai a disposizione: l’URL indicato nella consegna e il documento HTML.

Tecnologie: BeautifulSoup permette di leggere l’HTML; find_all cerca elementi secondo una condizione.

Come ragionare: osserva prima la struttura, poi formula un’ipotesi sul criterio che distingue gli elementi.

Da dove iniziare: apri la pagina e descrivi il criterio con parole tue.

Cosa impari: a trasformare una descrizione in una domanda precisa sui dati.`;

function request(message, history) {
  ip += 1;
  return new Request('https://oliduck.pages.dev/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message, challengeIds: [CHALLENGE_ID], history }),
    headers: {
      'Content-Type': 'application/json',
      'cf-connecting-ip': `127.20.6.${ip % 250}`,
    },
  });
}

function providerStream(text) {
  const parts = String(text).match(/[\s\S]{1,18}/g) || [''];
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

function fakeAi(replies, { stream = false } = {}) {
  const list = Array.isArray(replies) ? replies : [replies];
  const state = { calls: 0, inputs: [] };
  return {
    state,
    env: {
      AI: {
        run: async (_model, input) => {
          state.calls += 1;
          state.inputs.push(input);
          const reply = list[Math.min(state.calls - 1, list.length - 1)];
          return stream ? providerStream(reply) : { response: reply };
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

async function post(message, history, options = {}) {
  const ai = options.fake || fakeAi(options.reply || DIDACTIC_REPLY, { stream: options.stream });
  const response = await onRequestPost({ request: request(message, history), env: ai.env });
  if (options.stream) {
    const events = await readEvents(response);
    return { data: events.at(-1), events, fake: ai };
  }
  return { data: await response.json(), fake: ai };
}

function messagesFrom(fake, callIndex = 0) {
  const input = fake.state.inputs[callIndex];
  assert.ok(input, 'il modello non è stato chiamato');
  assert.ok(Array.isArray(input.messages));
  assert.equal(input.messages[0].role, 'system');
  return input.messages;
}

function block(messages, label) {
  const found = messages.find((item) => item.content.includes(label));
  assert.ok(found, `blocco mancante: ${label}`);
  return found.content;
}

/** Riproduce la sequenza reale: ogni risposta torna nella cronologia successiva. */
async function runSequence({ stream = false } = {}) {
  const history = [];
  const steps = {};
  for (const [name, message] of [
    ['initial', FIRST_MESSAGE],
    ['paste', STATEMENT_PASTE],
    ['confusion', CONFUSION],
    ['continuation', CONTINUATION],
  ]) {
    const ai = fakeAi(DIDACTIC_REPLY, { stream });
    const response = await onRequestPost({
      request: request(message, history),
      env: ai.env,
    });
    const isJson = (response.headers.get('content-type') || '').includes('application/json');
    const events = stream && !isJson ? await readEvents(response) : null;
    const data = events ? events.at(-1) : await response.json();
    steps[name] = { data, events, fake: ai, message };
    history.push({ role: 'user', content: message });
    history.push({ role: 'assistant', content: data.reply });
  }
  return { steps, history };
}

function assertExplanationStep(result, { source, systemMarker }) {
  assert.equal(result.data.blocked, undefined);
  assert.equal(result.data.needsClarification, undefined);
  assert.equal(result.data.statementMissing, undefined);
  assert.equal(result.data.statementProvided, true);
  assert.equal(result.data.statementSource, source);
  assert.equal(result.data.intent, INTENTS.EXPLAIN_STATEMENT);
  assert.equal(result.fake.state.calls, 1);

  const messages = messagesFrom(result.fake);
  assert.match(messages[0].content, systemMarker);
  assert.match(messages[0].content, /da dove iniziare/i);
  assert.match(messages[0].content, /cosa impari/i);
  const excerpt = block(messages, 'Estratto della consegna incollato');
  assert.match(excerpt, /lettere evidenziate/);
  assert.match(excerpt, /BeautifulSoup/);
  assert.match(excerpt, /find_all/);
  assert.match(excerpt, /cornice flag\{/);
  const state = block(messages, 'Stato della conversazione calcolato dal server');
  assert.match(state, /"statementAvailable": true/);
  const delivery = block(messages, 'Stato della consegna calcolato dal server');
  assert.match(delivery, /"status": "user-provided"/);
  assert.doesNotMatch(result.data.reply, /Non ho il testo della consegna/);
  assert.doesNotMatch(result.data.reply, /dimmi cosa hai capito/i);
}

test('sequenza BeautifulSoup in JSON: la consegna incollata diventa contesto persistente', async () => {
  const { steps } = await runSequence();

  assert.equal(steps.initial.data.intent, INTENTS.EXPLAIN_STATEMENT);
  assert.equal(steps.initial.data.statementMissing, true);
  assert.equal(steps.initial.fake.state.calls, 0);
  assert.match(steps.initial.data.reply, /Non ho il testo della consegna/);

  assert.equal(steps.paste.data.intent, INTENTS.STATEMENT_PROVIDED);
  assert.equal(steps.paste.data.statementSource, 'chat-message');
  assert.equal(steps.paste.data.statementFromCurrentMessage, true);
  assert.equal(steps.paste.data.statementStatus, 'user-provided');
  assert.equal(steps.paste.data.blocked, undefined);
  assert.equal(steps.paste.fake.state.calls, 1);
  assert.match(messagesFrom(steps.paste.fake)[0].content, /Accettala come contesto/);

  assertExplanationStep(steps.confusion, {
    source: 'chat-history', systemMarker: /Riassumi in Linguaggio semplice|Riassumi in linguaggio semplice/,
  });
  assert.equal(steps.confusion.data.followUpKind, 'confusion');

  assertExplanationStep(steps.continuation, {
    source: 'chat-history', systemMarker: /Riassumi in linguaggio semplice/,
  });
  assert.equal(steps.continuation.data.followUpKind, 'statement-explanation');
});

test('follow-up brevi dopo la consegna: nessuno chiede di reincollare il testo', async () => {
  const history = [
    { role: 'user', content: FIRST_MESSAGE },
    { role: 'assistant', content: 'Non ho il testo della consegna.' },
    { role: 'user', content: STATEMENT_PASTE },
    { role: 'assistant', content: DIDACTIC_REPLY },
  ];
  for (const message of [
    'Spiega', 'Adesso spiegami', 'Non ho capito',
    'Che cosa devo fare?', 'Come si fa?', 'Continua',
  ]) {
    const { data, fake } = await post(message, history);
    assert.equal(data.intent, INTENTS.EXPLAIN_STATEMENT, message);
    assert.equal(data.statementProvided, true, message);
    assert.equal(data.blocked, undefined, message);
    assert.equal(data.needsClarification, undefined, message);
    const messages = messagesFrom(fake);
    assert.match(block(messages, 'Estratto della consegna incollato'), /BeautifulSoup/, message);
  }
});

test('spiegazione e soluzione restano distinte: la richiesta vietata è ancora bloccata', async () => {
  const history = [
    { role: 'user', content: STATEMENT_PASTE },
    { role: 'assistant', content: DIDACTIC_REPLY },
  ];
  const { data, fake } = await post('Dammi la flag esatta e lo script completo per risolvere', history);
  assert.equal(data.blocked, true);
  assert.equal(data.statementProvided, true);
  assert.match(data.reply, /Non posso fornire flag/);
  assert.equal(fake.state.calls, 0);
});

test('sequenza BeautifulSoup in streaming SSE: stessi intent, contesto e nessun elenco vuoto', async () => {
  const { steps } = await runSequence({ stream: true });

  assert.equal(steps.initial.data.statementMissing, true);
  assert.equal(steps.paste.data.intent, INTENTS.STATEMENT_PROVIDED);
  assert.equal(steps.confusion.data.intent, INTENTS.EXPLAIN_STATEMENT);
  assert.equal(steps.continuation.data.intent, INTENTS.EXPLAIN_STATEMENT);
  assert.equal(steps.continuation.data.statementSource, 'chat-history');

  for (const { events, fake } of Object.values(steps)) {
    if (events) {
      assert.ok(events.length > 0);
      for (const event of events) {
        assert.equal(event.blocked, undefined);
        assert.doesNotMatch(String(event.reply || ''), /^\s*\d+[.)]\s*$/m);
        assert.doesNotMatch(String(event.reply || ''), /^\s*[-*]\s*$/m);
      }
    }
    for (const input of fake.state.inputs) {
      for (const message of input.messages) {
        assert.doesNotMatch(message.content, /^\s*\d+[.)]\s*$/m);
      }
    }
  }
});
