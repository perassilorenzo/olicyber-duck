/**
 * Persistenza locale di OliDuck.
 * Schema versionato: ogni dato personale (stati, conversazioni, preferenze)
 * resta in localStorage e non viene mai inviato al server oltre alla cronologia
 * necessaria per la richiesta AI.
 */

export const STORAGE_KEY = 'oliduck:state';
export const SCHEMA_VERSION = 1;
export const STATUSES = ['todo', 'in-progress', 'completed'];

const MAX_MESSAGES_PER_CHALLENGE = 100;

export function defaultState() {
  return {
    version: SCHEMA_VERSION,
    statuses: {},
    conversations: {},
    selectedChallengeId: null,
    preferences: {
      theme: 'light',
      assistantCollapsed: false,
      mobileView: 'workspace',
      filters: { query: '', category: 'all', difficulty: 'all' },
    },
  };
}

/** Migrazioni: applicare qui le trasformazioni per versioni future. */
function migrate(state) {
  if (state.version === SCHEMA_VERSION) return state;
  if (state.version === undefined || state.version === null) {
    return { ...defaultState(), ...state, version: SCHEMA_VERSION };
  }
  console.warn('[OliDuck] Versione dati sconosciuta, ripristino schema predefinito.');
  return defaultState();
}

function normalizeMessage(message) {
  if (!message || typeof message !== 'object') return null;
  if (message.role !== 'user' && message.role !== 'assistant') return null;
  if (typeof message.content !== 'string') return null;
  return {
    id: typeof message.id === 'string' ? message.id : (globalThis.crypto?.randomUUID?.() || `m-${Date.now()}-${Math.random().toString(36).slice(2)}`),
    role: message.role,
    content: message.content.slice(0, 20000),
    createdAt: typeof message.createdAt === 'string' ? message.createdAt : new Date().toISOString(),
  };
}

export function normalizeState(raw) {
  const base = defaultState();
  if (!raw || typeof raw !== 'object') return base;
  const state = migrate(raw);

  const statuses = {};
  if (state.statuses && typeof state.statuses === 'object') {
    for (const [id, status] of Object.entries(state.statuses)) {
      if (typeof id === 'string' && STATUSES.includes(status)) statuses[id] = status;
    }
  }

  const conversations = {};
  if (state.conversations && typeof state.conversations === 'object') {
    for (const [id, list] of Object.entries(state.conversations)) {
      if (!Array.isArray(list)) continue;
      const messages = list.map(normalizeMessage).filter(Boolean).slice(-MAX_MESSAGES_PER_CHALLENGE);
      if (messages.length) conversations[id] = messages;
    }
  }

  const prefs = state.preferences && typeof state.preferences === 'object' ? state.preferences : {};
  const filters = prefs.filters && typeof prefs.filters === 'object' ? prefs.filters : {};

  return {
    version: SCHEMA_VERSION,
    statuses,
    conversations,
    selectedChallengeId: typeof state.selectedChallengeId === 'string' ? state.selectedChallengeId : null,
    preferences: {
      theme: prefs.theme === 'dark' ? 'dark' : 'light',
      assistantCollapsed: Boolean(prefs.assistantCollapsed),
      mobileView: ['library', 'workspace', 'assistant'].includes(prefs.mobileView) ? prefs.mobileView : 'workspace',
      filters: {
        query: typeof filters.query === 'string' ? filters.query.slice(0, 200) : '',
        category: typeof filters.category === 'string' ? filters.category : 'all',
        difficulty: ['all', 'Facile', 'Media', 'Difficile'].includes(filters.difficulty) ? filters.difficulty : 'all',
      },
    },
  };
}

function defaultStorage() {
  try {
    const storage = globalThis.localStorage;
    if (!storage) return null;
    const probe = '__oliduck_probe__';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

export class LocalStore {
  constructor(storage = defaultStorage()) {
    this.storage = storage;
    this.available = Boolean(storage);
    this.listeners = new Set();
    this.lastError = null;
    this.state = this.available ? normalizeState(this._readRaw()) : defaultState();
    if (!this.available) this.lastError = 'localStorage non disponibile: i dati non saranno salvati.';
  }

  _readRaw() {
    try {
      const text = this.storage.getItem(STORAGE_KEY);
      return text ? JSON.parse(text) : null;
    } catch {
      this.lastError = 'Impossibile leggere i dati locali.';
      return null;
    }
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  _commit(next, { persist = true } = {}) {
    this.state = normalizeState(next);
    if (this.available && persist) {
      try {
        this.storage.setItem(STORAGE_KEY, JSON.stringify(this.state));
        this.lastError = null;
      } catch {
        this.lastError = 'Spazio locale insufficiente: alcune modifiche potrebbero non essere salvate.';
      }
    }
    this.listeners.forEach((listener) => listener(this.state));
  }

  update(mutator) {
    const draft = structuredClone(this.state);
    mutator(draft);
    this._commit(draft);
    return this.state;
  }

  getStatus(id) { return this.state.statuses[id] || 'todo'; }

  setStatus(id, status) {
    if (!STATUSES.includes(status)) return;
    this.update((draft) => { draft.statuses[id] = status; });
  }

  getConversation(id) { return [...(this.state.conversations[id] || [])]; }

  appendMessage(id, message) {
    this.update((draft) => {
      const list = draft.conversations[id] || [];
      const clean = normalizeMessage(message);
      if (clean) list.push(clean);
      draft.conversations[id] = list.slice(-MAX_MESSAGES_PER_CHALLENGE);
    });
  }

  clearConversation(id) {
    this.update((draft) => { delete draft.conversations[id]; });
  }

  clearConversations() {
    this.update((draft) => { draft.conversations = {}; });
  }

  clearAll() {
    if (this.available) {
      try { this.storage.removeItem(STORAGE_KEY); } catch { /* gestito dallo stato in memoria */ }
    }
    this._commit(defaultState(), { persist: false });
  }

  setPreference(key, value) {
    this.update((draft) => { draft.preferences[key] = value; });
  }

  setFilter(key, value) {
    this.update((draft) => { draft.preferences.filters[key] = value; });
  }

  selectChallenge(id) {
    this.update((draft) => { draft.selectedChallengeId = id; });
  }
}
