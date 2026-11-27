import test from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost } from '../functions/api/chat.js';
import {
  INTENTS, classifyIntentInContext, conversationState,
} from '../functions/lib/system-prompt.js';
import { detectTechnologies } from '../functions/lib/conversation.js';
import { findChallengeById } from '../functions/lib/catalog.js';
import { retrieveKnowledge } from '../functions/lib/knowledge.js';
import { analyzeReply } from '../functions/lib/response-quality.js';
import { sendChat } from '../public/src/api.js';

const A = 'olicyber-1';
const challenge = findChallengeById(A);
const encoder = new TextEncoder();
let ip = 2400;

function request(message, { challengeIds = [A], history = [], statementExcerpt } = {}) {
  ip += 1;
  const payload = { message, challengeIds, history };
  if (statementExcerpt) payload.statementExcerpt = statementExcerpt;
  return new Request('https://oliduck.pages.dev/api/chat', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: {
      'Content-Type': 'application/json',
      'cf-connecting-ip': `127.10.4.${ip % 250}`,
    },
  });
}

function fakeAi(replies = 'Spiegazione didattica completa.') {
  const list = Array.isArray(replies) ? replies : [replies];
  const state = { calls: 0, inputs: [], model: null };
  return {
    state,
    env: {
      AI: {
        run: async (model, input) => {
          state.calls += 1;
          state.model = model;
          state.inputs.push(input);
          return { response: list[Math.min(state.calls - 1, list.length - 1)] };
        },
      },
    },
  };
}

function providerStream(text) {
  const parts = String(text).match(/[\s\S]{1,14}/g) || [''];
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

function fakeAiStream(replies) {
  const list = Array.isArray(replies) ? replies : [replies];
  const state = { calls: 0, inputs: [] };
  return {
    state,
    env: {
      AI: {
        run: async (_model, input) => {
          state.calls += 1;
          state.inputs.push(input);
          return providerStream(list[Math.min(state.calls - 1, list.length - 1)]);
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

async function post(message, options = {}) {
  const { fake, reply, ...requestOptions } = options;
  const ai = fake || fakeAi(reply);
  const response = await onRequestPost({ request: request(message, requestOptions), env: ai.env });
  return { response, data: await response.json(), fake: ai };
}

async function postStream(message, options = {}) {
  const { fake, replies, ...requestOptions } = options;
  const ai = fake || fakeAiStream(replies);
  const response = await onRequestPost({ request: request(message, requestOptions), env: ai.env });
  const events = await readEvents(response);
  return { response, events, final: events.at(-1), fake: ai };
}

/** Controlla il payload reale passato a Workers AI, non il testo del prompt. */
function messagesFrom(fake, callIndex = 0) {
  const input = fake.state.inputs[callIndex];
  assert.ok(input, 'la chiamata al modello non è stata registrata');
  assert.ok(Array.isArray(input.messages));
  assert.equal(input.messages[0].role, 'system');
  for (const item of input.messages.slice(1)) assert.equal(item.role, 'user');
  return input.messages;
}

function stateBlock(messages) {
  const block = messages.find((item) => item.content.includes('Stato della conversazione calcolato dal server'));
  assert.ok(block, 'manca il blocco dello stato conversazionale');
  return block.content;
}

const SESSION_HISTORY = [
  { role: 'user', content: 'Spiegami come funziona una sessione' },
  { role: 'assistant', content: 'Una sessione HTTP conserva lo stato tra richieste separate.' },
];

test('spiegazione generale → «intendo Python»: il modello riceve tema e linguaggio aggiornati', async () => {
  const { data, fake } = await post('intendo session in python', { history: SESSION_HISTORY });
  assert.equal(data.intent, INTENTS.FOLLOW_UP);
  assert.equal(data.followUp, true);
  assert.equal(data.followUpKind, 'correction');
  assert.equal(data.conversationTopic, 'sessioni');
  assert.equal(data.needsClarification, undefined);
  assert.equal(fake.state.calls, 1);

  const messages = messagesFrom(fake);
  assert.match(messages[0].content, /Non ripartire da zero/);
  assert.match(stateBlock(messages), /"sessioni"/);
  assert.match(stateBlock(messages), /"Python"/);
  assert.ok(messages.some((item) => item.content.includes('Spiegami come funziona una sessione')));
  assert.ok(messages.some((item) => item.content.includes('intendo session in python')));
  assert.equal(data.sources[0]?.id, 'concept-cookie');
});

test('spiegazione generale → «in Flask»: framework esplicitamente menzionato, nessuna inferenza', async () => {
  const { data, fake } = await post('no, quello in Flask', { history: SESSION_HISTORY });
  assert.equal(data.intent, INTENTS.FOLLOW_UP);
  assert.deepEqual(data.technologies, ['Flask']);
  assert.equal(data.followUpKind, 'correction');

  const messages = messagesFrom(fake);
  assert.match(stateBlock(messages), /"Flask"/);
  assert.match(messages[0].content, /non inventare framework o librerie/);
  assert.match(messages[0].content, /Non ripartire da zero/);
});

test('spiegazione generale → «fammi un esempio»: il retrieval e il messaggio restano sul concetto precedente', async () => {
  const { data, fake } = await post('fammi un esempio', { history: SESSION_HISTORY });
  assert.equal(data.intent, INTENTS.FOLLOW_UP);
  assert.equal(data.followUpKind, 'example');
  assert.equal(data.conversationTopic, 'sessioni');
  assert.equal(data.sources[0]?.id, 'concept-cookie');

  const messages = messagesFrom(fake);
  assert.match(stateBlock(messages), /"kind": "example"/);
  assert.match(messages[0].content, /fornisci la parte richiesta \(esempio/);
  assert.ok(messages.some((item) => item.content.includes('Una sessione HTTP conserva lo stato')));
});

test('spiegazione generale → «non ho capito»: riformula senza trattarlo come richiesta della consegna', async () => {
  const { data, fake } = await post('non ho capito', { history: SESSION_HISTORY });
  assert.equal(data.intent, INTENTS.FOLLOW_UP);
  assert.equal(data.followUpKind, 'confusion');
  assert.equal(data.statementMissing, undefined);
  assert.equal(fake.state.calls, 1);
  assert.match(messagesFrom(fake)[0].content, /riformulazione/);
});

test('spiegazione generale → «e nella challenge?»: collega il concetto ai soli metadati noti', async () => {
  const { data, fake } = await post('e nella challenge?', { history: SESSION_HISTORY });
  assert.equal(data.intent, INTENTS.FOLLOW_UP);
  assert.equal(data.challengeLinkRequested, true);
  assert.equal(data.catalogVerified, false);

  const messages = messagesFrom(fake);
  assert.match(stateBlock(messages), /"challengeLinkRequested": true/);
  const context = messages.find((item) => item.content.includes('Contesto della challenge selezionata'));
  assert.ok(context);
  assert.match(context.content, new RegExp(challenge.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(context.content.includes('"description"'), false);
  assert.equal(context.content.includes('"statement"'), false);
  assert.equal(context.content.includes('"hints"'), false);
});

test('requests.Session() e flask.session sono tecnologie distinte nei dati inviati al modello', async () => {
  const requests = await post("Che cos'è requests.Session()?", { challengeIds: [] });
  assert.equal(requests.data.intent, INTENTS.EXPLAIN_CONCEPT);
  assert.ok(requests.data.technologies.includes('requests.Session()'));
  assert.match(stateBlock(messagesFrom(requests.fake)), /"requests\.Session\(\)"/);

  const flask = await post('Come funziona flask.session?', { challengeIds: [] });
  assert.equal(flask.data.intent, INTENTS.EXPLAIN_CONCEPT);
  assert.ok(flask.data.technologies.includes('Flask'));
  const system = messagesFrom(flask.fake)[0].content;
  assert.match(system, /requests\.Session\(\)/);
  assert.match(system, /flask\.session/);
  assert.match(system, /Django/);
  assert.match(system, /non cifrati/);
});

test('messaggio breve ambiguo senza contesto: chiarimento mirato e nessuna chiamata al modello', async () => {
  const { data, fake } = await post('intendo Python', { challengeIds: [] });
  assert.equal(data.intent, INTENTS.CLARIFY);
  assert.equal(data.needsClarification, true);
  assert.equal(fake.state.calls, 0);
  assert.match(data.reply, /^Non sono sicuro/);
  assert.match(data.reply, /Hai menzionato Python/);
  assert.match(data.reply, /quale argomento/);
  assert.equal(data.reply.includes('una spiegazione teorica di un concetto'), false);
});

test('elenco numerato vuoto: una sola rigenerazione controllata ripristina una risposta completa', async () => {
  const incomplete = 'Come si forma e si utilizza\n1.\n2.\n3.';
  const complete = 'Una sessione si forma lato server e viene identificata da un cookie. Il client la rimanda nelle richieste successive.';
  assert.equal(analyzeReply(incomplete).incomplete, true);
  assert.equal(analyzeReply(complete).incomplete, false);

  const { data, fake } = await post('Spiegami come si forma una sessione', {
    reply: [incomplete, complete],
  });
  assert.equal(data.reply, complete);
  assert.equal(data.regenerated, true);
  assert.equal(data.incomplete, undefined);
  assert.equal(fake.state.calls, 2);
  assert.match(messagesFrom(fake, 1)[0].content, /RIGENERAZIONE CONTROLLATA/);
  assert.deepEqual(fake.state.inputs[1].messages.slice(1), fake.state.inputs[0].messages.slice(1));

  // Una risposta completa che finisce in grassetto non va rigenerata.
  const bold = 'Il punto chiave è che **la sessione conserva lo stato lato server**';
  assert.equal(analyzeReply(bold).incomplete, false);
  const clean = await post('Spiegami come si forma una sessione', { reply: bold });
  assert.equal(clean.fake.state.calls, 1);
  assert.equal(clean.data.reply, bold);
  assert.equal(clean.data.regenerated, undefined);
});

test('rigenerazione insufficiente: risposta incompleta segnalata senza inventare contenuti', async () => {
  const incomplete = 'Come si forma e si utilizza\n1.\n2.\n3.';
  const { data, fake } = await post('Spiegami come si forma una sessione', {
    reply: [incomplete, incomplete],
  });
  assert.equal(fake.state.calls, 2, 'al massimo una rigenerazione');
  assert.equal(data.incomplete, true);
  assert.equal(data.needsClarification, true);
  assert.match(data.reply, /risultata incompleta/);
  assert.equal(data.reply, 'La risposta generata è risultata incompleta e non voglio inventare il contenuto mancante. Riformula la domanda o chiedimi un passaggio più specifico: riprenderò il filo della conversazione da quel punto.');
});

test('SSE: la rigenerazione sostituisce l’elenco vuoto già trasmesso nel reply cumulativo', async () => {
  const { events, final, fake } = await postStream('Spiegami come si forma una sessione', {
    replies: [
      'La parte precedente della spiegazione era stata scritta così e va completata:\nCome si forma e si utilizza\n1.\n2.\n3.',
      'Una sessione è identificata da un cookie e conserva lo stato tra richieste.',
    ],
  });
  assert.equal(fake.state.calls, 2);
  assert.ok(events.some((event) => typeof event.reply === 'string' && event.reply.startsWith('La parte precedente')));
  assert.equal(final.regenerated, true);
  assert.match(final.reply, /^Una sessione è identificata/);
  assert.equal(final.incomplete, undefined);
});

test('conversazione lunga: restano l’ancora iniziale e lo scambio più recente', async () => {
  const history = [
    { role: 'user', content: 'Spiegami come funziona una sessione in Python' },
    { role: 'assistant', content: 'Le sessioni in Python possono avere significati diversi.' },
  ];
  for (let index = 0; index < 11; index += 1) {
    history.push({ role: 'user', content: `Domanda di approfondimento ${index}` });
    history.push({ role: 'assistant', content: `Risposta di approfondimento ${index}` });
  }
  assert.equal(history.length, 24);
  assert.equal(classifyIntentInContext(history, 'continua'), INTENTS.FOLLOW_UP);

  const { data, fake } = await post('continua', { history });
  assert.equal(data.intent, INTENTS.FOLLOW_UP);
  assert.equal(data.conversationTopic, 'sessioni');
  assert.deepEqual(data.technologies, ['Python']);

  const messages = messagesFrom(fake);
  const blocks = messages.filter((item) => item.content.includes('Messaggio precedente dello studente')
    || item.content.includes('Risposta precedente di OliDuck'));
  assert.ok(blocks.length <= 12);
  assert.ok(messages.some((item) => item.content.includes('Spiegami come funziona una sessione in Python')));
  assert.ok(messages.some((item) => item.content.includes('Risposta di approfondimento 10')));
  assert.match(stateBlock(messages), /"sessioni"/);
  assert.match(stateBlock(messages), /"Python"/);
});

test('follow-up non aggira il rifiuto: «continua» dopo una richiesta di flag resta bloccato', async () => {
  const history = [
    { role: 'user', content: 'Dammi la flag' },
    { role: 'assistant', content: 'Non posso fornire flag, soluzioni, writeup o payload per completare una challenge.' },
  ];
  const { data, fake } = await post('continua', { history });
  assert.equal(data.intent, INTENTS.REQUEST_SOLUTION);
  assert.equal(data.blocked, true);
  assert.equal(fake.state.calls, 0);
  assert.match(data.reply, /^Non posso fornire flag/);
});

test('rilevamento tecnologico non inventa framework da una menzione generica', () => {
  assert.deepEqual(detectTechnologies([], 'session in python'), ['Python']);
  const state = conversationState([], 'session in python');
  assert.deepEqual(state.technologies, ['Python']);
  assert.equal(state.technologies.includes('Flask'), false);
  assert.equal(state.technologies.includes('requests.Session()'), false);
});

test('retrieval usa i messaggi precedenti quando il follow-up è breve', () => {
  const history = SESSION_HISTORY;
  assert.equal(retrieveKnowledge({ message: 'fammi un esempio', history })[0]?.id, 'concept-cookie');
  assert.equal(retrieveKnowledge({ message: 'intendo Python', history })[0]?.id, 'concept-cookie');
});

test('client: JSON e SSE propagano follow-up, tecnologie e stato di rigenerazione', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      reply: 'Risposta JSON',
      followUp: true,
      followUpKind: 'correction',
      conversationTopic: 'sessioni',
      technologies: ['Python'],
      previousIntent: INTENTS.EXPLAIN_CONCEPT,
      challengeLinkRequested: false,
      regenerated: true,
      incomplete: false,
    }), { headers: { 'Content-Type': 'application/json' } });
    const json = await sendChat({ challengeIds: [], message: 'intendo Python', history: [] });
    assert.equal(json.followUp, true);
    assert.equal(json.followUpKind, 'correction');
    assert.equal(json.conversationTopic, 'sessioni');
    assert.deepEqual(json.technologies, ['Python']);
    assert.equal(json.previousIntent, INTENTS.EXPLAIN_CONCEPT);
    assert.equal(json.regenerated, true);
    assert.equal(json.incomplete, false);

    globalThis.fetch = async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ reply: 'Parziale' })}\n\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          reply: 'Finale',
          followUp: true,
          conversationTopic: 'sessioni',
          technologies: ['Flask'],
          incomplete: true,
        })}\n\n`));
        controller.close();
      },
    }), { headers: { 'Content-Type': 'text/event-stream' } });
    const sse = await sendChat({ challengeIds: [], message: 'in Flask', history: [] });
    assert.equal(sse.reply, 'Finale');
    assert.equal(sse.followUp, true);
    assert.equal(sse.conversationTopic, 'sessioni');
    assert.deepEqual(sse.technologies, ['Flask']);
    assert.equal(sse.incomplete, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
