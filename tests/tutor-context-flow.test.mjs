import test from 'node:test';
import assert from 'node:assert/strict';

import { onRequestPost } from '../functions/api/chat.js';
import {
  buildMessages, buildDeliveryStatus, DELIVERY_STATUS, SYSTEM_PROMPT,
} from '../functions/lib/system-prompt.js';
import { findChallengeById, toPromptContext } from '../functions/lib/catalog.js';
import { sendChat } from '../public/src/api.js';

const A = 'olicyber-1';
const B = 'olicyber-22';
const encoder = new TextEncoder();
let ip = 1800;

function request(message, { challengeIds = [A], history = [], statementExcerpt } = {}) {
  ip += 1;
  const payload = { message, challengeIds, history };
  if (statementExcerpt) payload.statementExcerpt = statementExcerpt;
  return new Request('https://oliduck.pages.dev/api/chat', {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: {
      'Content-Type': 'application/json',
      'cf-connecting-ip': `127.8.4.${ip % 250}`,
    },
  });
}

function fakeAi(reply = 'Spiegazione didattica.') {
  const state = { calls: 0, inputs: [] };
  return {
    state,
    env: {
      AI: {
        run: async (_model, input) => {
          state.calls += 1;
          state.inputs.push(input);
          return { response: reply };
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

test('lo stato della consegna è strutturato, non verificato e distinto dal testo', () => {
  assert.deepEqual(buildDeliveryStatus({}), {
    status: DELIVERY_STATUS.UNAVAILABLE,
    verified: false,
    source: 'none',
    catalogVerified: false,
  });
  assert.equal(buildDeliveryStatus({ statementExcerpt: 'Breve' }).status, DELIVERY_STATUS.PARTIAL);
  const provided = buildDeliveryStatus({ statementExcerpt: 'x'.repeat(120), catalogVerified: false });
  assert.equal(provided.status, DELIVERY_STATUS.USER_PROVIDED);
  assert.equal(provided.verified, false);
  assert.equal(provided.source, 'user-excerpt');

  const messages = buildMessages({
    challenges: [toPromptContext(findChallengeById(A))],
    message: 'Spiegami la consegna',
    statementExcerpt: 'Prima riga\nSeconda riga',
    delivery: provided,
  });
  const deliveryBlock = messages.find((item) => item.content.includes('Stato della consegna calcolato dal server'));
  assert.ok(deliveryBlock);
  assert.equal(deliveryBlock.role, 'user');
  assert.match(deliveryBlock.content, /user-provided/);
  assert.match(deliveryBlock.content, /"verified":\s*false/);
  assert.equal(deliveryBlock.content.includes('Prima riga\nSeconda riga'), false);
  assert.match(SYSTEM_PROMPT, /'user-provided'/);
  assert.doesNotMatch(SYSTEM_PROMPT, /descrizione della challenge|statement completo/);
});

test('backend: JSON e SSE espongono gli stessi metadati di contesto e consegna', async () => {
  const excerpt = 'Il messaggio ricevuto è suddiviso in gruppi di caratteri e devo capire come raggrupparli senza conoscere il formato in anticipo.';
  const jsonFake = fakeAi();
  const jsonResponse = await onRequestPost({
    request: request('Non ho capito la consegna', { statementExcerpt: excerpt }),
    env: jsonFake.env,
  });
  const data = await jsonResponse.json();
  assert.equal(jsonResponse.status, 200);
  assert.equal(data.statementStatus, DELIVERY_STATUS.USER_PROVIDED);
  assert.equal(data.catalogVerified, false);
  assert.equal(data.contextMode, 'single');
  assert.equal(data.challengeCount, 1);
  assert.deepEqual(data.challengeIds, [A]);
  assert.equal(data.statementProvided, true);

  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Risposta ' } }] })}\n\n`));
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: 'in streaming.' } }] })}\n\n`));
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    },
  });
  const sseFake = fakeAi();
  sseFake.env.AI.run = async (_model, input) => {
    sseFake.state.calls += 1;
    sseFake.state.inputs.push(input);
    assert.equal(input.stream, true);
    return stream;
  };
  const sseResponse = await onRequestPost({
    request: request('Non ho capito la consegna', { statementExcerpt: excerpt }),
    env: sseFake.env,
  });
  assert.match(sseResponse.headers.get('content-type'), /text\/event-stream/);
  const events = await readEvents(sseResponse);
  const last = events.at(-1);
  assert.equal(last.reply, 'Risposta in streaming.');
  assert.equal(last.statementStatus, DELIVERY_STATUS.USER_PROVIDED);
  assert.equal(last.catalogVerified, false);
  assert.equal(last.contextMode, 'single');
  assert.equal(last.challengeCount, 1);
});

test('backend: cambio challenge esplicito conserva la history ma cambia il contesto primario', async () => {
  const fake = fakeAi();
  const history = [
    { role: 'user', content: 'Domanda su Dashed' },
    { role: 'assistant', content: 'Risposta su Dashed' },
  ];
  await onRequestPost({
    request: request('Puoi spiegarmi un concetto di cyber sicurezza?', { challengeIds: [A], history }),
    env: fake.env,
  });
  const multi = await onRequestPost({
    request: request('Puoi spiegarmi come funziona una rete?', { challengeIds: [B, A], history }),
    env: fake.env,
  });
  const multiData = await multi.json();
  assert.equal(multiData.contextMode, 'multi');
  assert.equal(multiData.challengeCount, 2);
  assert.equal(multiData.challengeId, B);

  const contextBlock = fake.state.inputs[1].messages.find((item) => item.content.includes('Contesto delle challenge selezionate'));
  assert.match(contextBlock.content, /C-H-A-O-S/);
  assert.match(contextBlock.content, /Dashed/);
  const historyBlock = fake.state.inputs[1].messages.find((item) => item.content.includes('Domanda su Dashed'));
  assert.ok(historyBlock);
  assert.equal(historyBlock.role, 'user');
  for (const message of fake.state.inputs[1].messages) {
    assert.equal(message.content.includes('"description"'), false);
    assert.equal(message.content.includes('"statement"'), false);
    assert.equal(message.content.includes('"hintTopics"'), false);
  }
});

test('client: JSON e SSE propagano i nuovi metadati senza alterare la risposta cumulativa', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({
      reply: 'Risposta JSON', challengeIds: [A], challengeCount: 1,
      statementStatus: DELIVERY_STATUS.PARTIAL, catalogVerified: false, contextMode: 'single',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const json = await sendChat({ challengeIds: [A], message: 'ciao', history: [] });
    assert.equal(json.reply, 'Risposta JSON');
    assert.equal(json.statementStatus, DELIVERY_STATUS.PARTIAL);
    assert.equal(json.catalogVerified, false);
    assert.equal(json.contextMode, 'single');
    assert.equal(json.challengeCount, 1);

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ reply: 'Parziale' })}\n\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({
          reply: 'Risposta SSE', statementStatus: DELIVERY_STATUS.USER_PROVIDED,
          catalogVerified: false, contextMode: 'multi', challengeCount: 2,
        })}\n\n`));
        controller.close();
      },
    });
    globalThis.fetch = async () => new Response(stream, {
      status: 200, headers: { 'Content-Type': 'text/event-stream' },
    });
    const sse = await sendChat({ challengeIds: [A, B], message: 'ciao', history: [] });
    assert.equal(sse.reply, 'Risposta SSE');
    assert.equal(sse.statementStatus, DELIVERY_STATUS.USER_PROVIDED);
    assert.equal(sse.contextMode, 'multi');
    assert.equal(sse.challengeCount, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
