import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LocalStore, normalizeState, STORAGE_KEY, SCHEMA_VERSION,
  DEFAULT_PANEL_WIDTH, MIN_PANEL_WIDTH, MAX_PANEL_WIDTH,
  GENERAL_CONVERSATION_ID,
} from '../public/src/store.js';

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

test('migra lo schema v1 senza perdere progressi e preferenze', () => {
  const state = normalizeState({
    version: 1,
    statuses: { old: 'in-progress' },
    conversations: { old: [{ role: 'user', content: 'domanda storica' }] },
    selectedChallengeId: 'old',
    preferences: { theme: 'dark', mobileView: 'library', filters: { query: 'vecchia', category: 'Web' } },
  });
  assert.equal(state.version, 2);
  assert.equal(state.statuses.old, 'in-progress');
  assert.equal(state.conversations.old[0].content, 'domanda storica');
  assert.equal(state.selectedChallengeId, 'old');
  assert.equal(state.preferences.theme, 'dark');
  assert.equal(state.preferences.activePanel, 'library');
  assert.equal(state.preferences.panelWidth, DEFAULT_PANEL_WIDTH);
  assert.equal(state.preferences.filters.query, 'vecchia');
  assert.equal(state.preferences.filters.edition, 'all');
});

test('ripristina filtri e larghezza non validi', () => {
  const state = normalizeState({
    version: 2,
    preferences: {
      panelWidth: 999,
      activePanel: 'workspace',
      filters: { status: 'bogus', sort: 'bogus', query: 12, edition: '2026' },
    },
  });
  assert.equal(state.preferences.panelWidth, MAX_PANEL_WIDTH);
  assert.equal(normalizeState({ version: 2, preferences: { panelWidth: -5 } }).preferences.panelWidth, MIN_PANEL_WIDTH);
  assert.equal(state.preferences.activePanel, 'assistant');
  assert.equal(state.preferences.filters.status, 'all');
  assert.equal(state.preferences.filters.sort, 'title-asc');
  assert.equal(state.preferences.filters.query, '');
  assert.equal(state.preferences.filters.edition, '2026');
});

test('salva conversazioni separate per challenge e per modalità generale', () => {
  const storage = memoryStorage();
  const store = new LocalStore(storage);
  assert.equal(store.available, true);
  assert.equal(store.getStatus('demo-web-01'), 'todo');

  store.setStatus('demo-web-01', 'in-progress');
  store.appendMessage('demo-web-01', { role: 'user', content: 'Prima domanda' });
  store.appendMessage(GENERAL_CONVERSATION_ID, { role: 'user', content: 'Domanda generale' });
  store.setPreference('theme', 'dark');
  store.setPreference('panelWidth', 55);
  store.setFilter('category', 'Web');
  store.selectChallenge('demo-web-01');

  const reloaded = new LocalStore(storage);
  assert.equal(reloaded.getStatus('demo-web-01'), 'in-progress');
  assert.equal(reloaded.getConversation('demo-web-01')[0].content, 'Prima domanda');
  assert.equal(reloaded.getConversation(GENERAL_CONVERSATION_ID)[0].content, 'Domanda generale');
  assert.equal(reloaded.state.preferences.theme, 'dark');
  assert.equal(reloaded.state.preferences.panelWidth, 55);
  assert.equal(reloaded.state.preferences.filters.category, 'Web');
  assert.equal(reloaded.state.selectedChallengeId, 'demo-web-01');

  reloaded.clearConversation('demo-web-01');
  assert.equal(reloaded.getConversation('demo-web-01').length, 0);
  assert.equal(reloaded.getConversation(GENERAL_CONVERSATION_ID).length, 1);
});

test('aggiornare il catalogo non cancella i dati personali', () => {
  const storage = memoryStorage();
  const store = new LocalStore(storage);
  store.setStatus('demo-web-01', 'completed');
  store.appendMessage('demo-web-01', { role: 'assistant', content: 'Risposta salvata' });
  const before = storage.getItem(STORAGE_KEY);

  const catalogUpdated = JSON.parse(storage.getItem(STORAGE_KEY));
  catalogUpdated.version = 2;
  storage.setItem(STORAGE_KEY, JSON.stringify(catalogUpdated));
  assert.equal(storage.getItem(STORAGE_KEY), before);

  const reloaded = new LocalStore(storage);
  assert.equal(reloaded.getStatus('demo-web-01'), 'completed');
  assert.equal(reloaded.getConversation('demo-web-01')[0].content, 'Risposta salvata');
});

test('clearAll rimuove la chiave e clearConversations conserva gli stati', () => {
  const storage = memoryStorage();
  const store = new LocalStore(storage);
  store.setStatus('x', 'completed');
  store.appendMessage('x', { role: 'user', content: 'ciao' });
  store.clearConversations();
  assert.deepEqual(store.state.conversations, {});
  assert.equal(store.getStatus('x'), 'completed');

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
