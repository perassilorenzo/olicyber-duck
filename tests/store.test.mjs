import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalStore, normalizeState, STORAGE_KEY, SCHEMA_VERSION } from '../public/src/store.js';

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
    size: () => data.size,
    raw: data,
  };
}

test('normalizza stati e conversazioni non validi', () => {
  const state = normalizeState({
    version: SCHEMA_VERSION,
    statuses: { a: 'completed', b: 'bogus' },
    conversations: { a: [{ role: 'user', content: 'ciao' }, { role: 'x', content: 'no' }] },
    selectedChallengeId: 42,
  });
  assert.deepEqual(state.statuses, { a: 'completed' });
  assert.equal(state.conversations.a.length, 1);
  assert.equal(state.conversations.a[0].role, 'user');
  assert.equal(state.selectedChallengeId, null);
});

test('salva e rilegge stato, conversazioni separate e preferenze', () => {
  const storage = memoryStorage();
  const store = new LocalStore(storage);
  assert.equal(store.available, true);
  assert.equal(store.getStatus('demo-web-01'), 'todo');

  store.setStatus('demo-web-01', 'in-progress');
  store.appendMessage('demo-web-01', { role: 'user', content: 'Prima domanda' });
  store.appendMessage('demo-crypto-01', { role: 'user', content: 'Altra chat' });
  store.setPreference('theme', 'dark');
  store.selectChallenge('demo-web-01');

  const reloaded = new LocalStore(storage);
  assert.equal(reloaded.getStatus('demo-web-01'), 'in-progress');
  assert.equal(reloaded.getConversation('demo-web-01')[0].content, 'Prima domanda');
  assert.equal(reloaded.getConversation('demo-crypto-01')[0].content, 'Altra chat');
  assert.equal(reloaded.state.preferences.theme, 'dark');
  assert.equal(reloaded.state.selectedChallengeId, 'demo-web-01');
  assert.ok(storage.raw.has(STORAGE_KEY));

  reloaded.clearConversation('demo-web-01');
  assert.equal(reloaded.getConversation('demo-web-01').length, 0);
  assert.equal(reloaded.getConversation('demo-crypto-01').length, 1);
});

test('clearAll rimuove la chiave e ripristina lo schema', () => {
  const storage = memoryStorage();
  const store = new LocalStore(storage);
  store.setStatus('x', 'completed');
  store.clearAll();
  assert.equal(storage.raw.has(STORAGE_KEY), false);
  assert.equal(store.state.version, SCHEMA_VERSION);
  assert.deepEqual(store.state.statuses, {});
});

test('funziona anche senza localStorage', () => {
  const store = new LocalStore(null);
  assert.equal(store.available, false);
  store.setStatus('x', 'completed');
  assert.equal(store.getStatus('x'), 'completed');
  assert.match(store.lastError, /localStorage non disponibile/);
});
