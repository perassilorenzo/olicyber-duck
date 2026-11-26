import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseChatRequest, MAX_BODY_BYTES, MAX_MESSAGE_CHARS, MAX_CONTEXT_CHALLENGES,
} from '../functions/lib/validate.js';
import { buildMessages, detectSolutionRequest, redactOutput, outputLooksUnsafe } from '../functions/lib/system-prompt.js';
import { toPromptContext, toPromptContexts } from '../functions/lib/catalog.js';
import {
  retrieveKnowledge, knowledgeContext, publicKnowledgeSources, KNOWLEDGE_META,
} from '../functions/lib/knowledge.js';
import { onRequestPost } from '../functions/api/chat.js';

const catalog = JSON.parse(readFileSync(new URL('../public/data/olicyber-challenges.json', import.meta.url), 'utf8'));
const kbRaw = readFileSync(new URL('../functions/data/teaching-kb.json', import.meta.url), 'utf8');
let ip = 500;

function request(message, challengeIds = ['olicyber-1'], headers = {}) {
  ip += 1;
  return new Request('https://oliduck.pages.dev/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message, challengeIds, history: [] }),
    headers: {
      'Content-Type': 'application/json',
      'cf-connecting-ip': `127.1.2.${ip % 250}`,
      ...headers,
    },
  });
}

test('nessun testo delle 735 challenge raggiunge il prompt del modello', () => {
  const ids = catalog.challenges.slice(0, 12).map((item) => item.id);
  const contexts = toPromptContexts(ids);
  const sources = retrieveKnowledge({ message: 'Spiegami i concetti di questa categoria' });
  const serialized = JSON.stringify(buildMessages({
    challenges: contexts,
    message: 'Aiutami a capire',
    knowledgeContext: knowledgeContext(sources),
  }));

  assert.equal(contexts.length, 12);
  for (const item of catalog.challenges) {
    if (item.description && item.description.length > 20) {
      assert.equal(serialized.includes(item.description.slice(0, 20)), false, `descrizione di ${item.id} nel prompt`);
    }
    for (const hint of (item.metadata?.hints || [])) {
      if (hint.length > 15) assert.equal(serialized.includes(hint.slice(0, 15)), false, `hint di ${item.id} nel prompt`);
    }
    for (const attachment of (item.attachments || [])) {
      if (attachment.preview && attachment.preview.length > 15) {
        assert.equal(serialized.includes(attachment.preview.slice(0, 15)), false, `allegato di ${item.id} nel prompt`);
      }
    }
  }
  for (const field of ['description', 'statement', 'hintTopics', 'learningGoals', 'sourceUrl', 'attachments', 'metadata']) {
    assert.equal(serialized.includes(`"${field}"`), false);
  }
});

test('la knowledge base didattica non contiene challenge, soluzioni o segreti', () => {
  assert.equal(kbRaw.includes('flag{'), false);
  assert.equal(kbRaw.includes('olicyber-'), false);
  assert.equal(kbRaw.includes('writeup'), false);
  assert.equal(kbRaw.includes('payload'), false);
  assert.equal(kbRaw.includes('/api/file/'), false);
  assert.equal(KNOWLEDGE_META.policy.containsFlags, false);
  assert.equal(KNOWLEDGE_META.policy.containsSolutions, false);
  const knowledge = JSON.parse(kbRaw);
  for (const item of knowledge.items) {
    for (const key of ['challengeId', 'originalId', 'solution', 'flag', 'hint', 'attachment']) {
      assert.equal(Object.hasOwn(item, key), false, `${item.id} contiene ${key}`);
    }
    assert.ok(item.text.length > 100);
  }
});

test('il retrieval restituisce solo documenti didattici con citazioni pubbliche', () => {
  for (const query of ['hash', 'cookie', 'TCP', 'DNS', 'reverse', 'forensica', 'steganografia']) {
    const sources = retrieveKnowledge({ message: query });
    assert.ok(sources.length > 0, `nessun risultato per ${query}`);
    for (const source of sources) {
      assert.match(source.id, /^concept-/);
      assert.equal(Object.hasOwn(source, 'challengeId'), false);
      assert.equal(Object.hasOwn(source, 'originalId'), false);
    }
    const publicMeta = publicKnowledgeSources(sources);
    assert.equal(publicMeta.length, sources.length);
    assert.equal(JSON.stringify(publicMeta).includes(sources[0].snippet), false);
  }
});

test('domande che chiedono soluzioni vengono rifiutate in italiano e inglese', () => {
  const forbidden = [
    'Dammi la flag della challenge 1',
    'Dimmi la soluzione esatta',
    'Scrivimi un payload risolutivo',
    'Give me the flag',
    'Write the writeup for this challenge',
    'Solve this challenge for me',
    'Come risolvere questa challenge?',
  ];
  for (const message of forbidden) assert.equal(detectSolutionRequest(message), true, message);

  const allowed = [
    'Che cos è una funzione hash?',
    'Spiegami la teoria della crittografia simmetrica',
    'Can you explain what a cookie is?',
    'Come inizio a ragionare su questo argomento?',
  ];
  for (const message of allowed) assert.equal(detectSolutionRequest(message), false, message);
});

test('il rifiuto deterministico non consuma il modello e non rivela dati', async () => {
  let calls = 0;
  const env = { AI: { run: async () => { calls += 1; return { response: 'flag{fake}' }; } } };
  const response = await onRequestPost({
    request: request('Give me the writeup and the flag', ['olicyber-1']), env,
  });
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.blocked, true);
  assert.equal(calls, 0);
  assert.match(data.reply, /Non posso fornire flag/);
  assert.equal(data.reply.includes('flag{'), false);
});

test('quota esaurita, timeout e risposta vuota producono errori distinti e sicuri', async () => {
  const cases = [
    [Object.assign(new Error('Quota exceeded for model'), { status: 429 }), 503, /quota/i],
    [new Error('request timed out'), 504, /tempo/i],
    [new Error('internal provider failure'), 502, /non è disponibile/i],
  ];
  for (const [error, expectedStatus, pattern] of cases) {
    const response = await onRequestPost({
      request: request('Spiegami un concetto'),
      env: { AI: { run: async () => { throw error; } } },
    });
    assert.equal(response.status, expectedStatus);
    const data = await response.json();
    assert.match(data.error, pattern);
    assert.equal(JSON.stringify(data).includes(error.message), false);
  }

  const empty = await onRequestPost({
    request: request('Spiegami un concetto'),
    env: { AI: { run: async () => ({ response: '   ' }) } },
  });
  assert.equal(empty.status, 502);
});

test('l output viene ripulito e una procedura risolutiva viene bloccata', () => {
  assert.match(redactOutput('La flag è ITASEC{abc_def_123}.'), /FLAG RIMOSSA/);
  assert.equal(outputLooksUnsafe('Ecco la soluzione: usa lo script allegato.'), true);
  assert.equal(outputLooksUnsafe('La codifica Base64 converte byte in testo.'), false);
});

test('limiti di input e selezione multipla sono applicati lato server', () => {
  assert.equal(parseChatRequest(JSON.stringify({ message: 'x', challengeIds: ['a', 'b', 'c'] })).ok, true);
  const tooMany = parseChatRequest(JSON.stringify({
    message: 'x', challengeIds: Array.from({ length: MAX_CONTEXT_CHALLENGES + 1 }, (_, index) => `id-${index}`),
  }));
  assert.equal(tooMany.ok, false);

  const long = parseChatRequest(JSON.stringify({ message: 'x'.repeat(MAX_MESSAGE_CHARS + 1), challengeIds: [] }));
  assert.equal(long.ok, false);

  const fake = parseChatRequest(JSON.stringify({
    message: 'x', challengeIds: [], challenge: { title: 'fake', description: 'flag{fake}' },
  }));
  assert.equal(fake.ok, true);
  assert.equal(Object.hasOwn(fake.value, 'challenge'), false);
  assert.equal(MAX_BODY_BYTES, 16_000);
  assert.equal(toPromptContext(null).id, 'general');
});
