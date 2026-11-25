/**
 * Persistenza locale di OliDuck (schema v2).
 *
 * I dati ufficiali delle challenge NON sono qui: il catalogo è un file statico.
 * Qui restano solo stati personali, conversazioni, ultima challenge selezionata
 * e preferenze dell'interfaccia. Un aggiornamento del catalogo non cancella
 * nessuna di queste chiavi.
 */

export const STORAGE_KEY = 'oliduck:state';
export const SCHEMA_VERSION = 2;
export const STATUSES = ['todo', 'in-progress', 'completed'];
export const GENERAL_CONVERSATION_ID = 'general';
export const DEFAULT_PANEL_WIDTH = 40;
export const MIN_PANEL_WIDTH = 22;
export const MAX_PANEL_WIDTH = 72;

const MAX_MESSAGES_PER_CHALLENGE = 100;

export function defaultState() {
  return {
    version: SCHEMA_VERSION,
    statuses: {},
    conversations: {},
    selectedChallengeId: null,
    preferences: {
      theme: 'light',
      panelWidth: DEFAULT_PANEL_WIDTH,
      activePanel: 'assistant',
      filters: {
        query: '', category: 'all', difficulty: 'all', edition: 'all',
        path: 'all', status: 'all', sort: 'title-asc',
      },
    },
  };
}

/** Migrazione v1 → v2: conserva stati, conversazioni e ultima challenge. */
function migrate(state) {
  if (state.version === SCHEMA_VERSION) return state;
  if (state.version === 1 || state.version === undefined || state.version === null) {
    const oldPrefs = state.preferences && typeof state.preferences === 'object' ? state.preferences : {};
    const oldFilters = oldPrefs.filters && typeof oldPrefs.filters === 'object' ? oldPrefs.filters : {};
    const oldView = oldPrefs.mobileView;
    return {
      ...state,
      version: SCHEMA_VERSION,
      preferences: {
        ...oldPrefs,
        panelWidth: DEFAULT_PANEL_WIDTH,
        activePanel: oldView === 'library' ? 'library' : 'assistant',
        filters: {
          query: typeof oldFilters.query === 'string' ? oldFilters.query : '',
          category: typeof oldFilters.category === 'string' ? oldFilters.category : 'all',
          difficulty: typeof oldFilters.difficulty === 'string' ? oldFilters.difficulty : 'all',
          edition: 'all', path: 'all', status: 'all', sort: 'title-asc',
        },
      },
    };
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
      if (!Array.isArray(list) || typeof id !== 'string') continue;
      const messages = list.map(normalizeMessage).filter(Boolean).slice(-MAX_MESSAGES_PER_CHALLENGE);
      if (messages.length) conversations[id] = messages;
    }
  }

  const prefs = state.preferences && typeof state.preferences === 'object' ? state.preferences : {};
  const filters = prefs.filters && typeof prefs.filters === 'object' ? prefs.filters : {};
  const width = Number(prefs.panelWidth);
  const allowedSorts = ['title-asc', 'title-desc', 'category', 'score-desc', 'recent', 'original-id'];

  return {
    version: SCHEMA_VERSION,
    statuses,
    conversations,
    selectedChallengeId: typeof state.selectedChallengeId === 'string' ? state.selectedChallengeId : null,
    preferences: {
      theme: prefs.theme === 'dark' ? 'dark' : 'light',
      panelWidth: Number.isFinite(width)
        ? Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, Math.round(width)))
        : DEFAULT_PANEL_WIDTH,
      activePanel: prefs.activePanel === 'library' ? 'library' : 'assistant',
      filters: {
        query: typeof filters.query === 'string' ? filters.query.slice(0, 200) : '',
        category: typeof filters.category === 'string' ? filters.category : 'all',
        difficulty: typeof filters.difficulty === 'string' ? filters.difficulty : 'all',
        edition: typeof filters.edition === 'string' ? filters.edition : 'all',
        path: typeof filters.path === 'string' ? filters.path : 'all',
        status: STATUSES.includes(filters.status) ? filters.status : 'all',
        sort: allowedSorts.includes(filters.sort) ? filters.sort : 'title-asc',
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
    this.update((draft) => { draft.selectedChallengeId = typeof id === 'string' ? id : null; });
  }
}
