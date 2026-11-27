/**
 * Persistenza locale di OliDuck (schema v2).
 *
 * I dati ufficiali delle challenge NON sono qui: il catalogo è un file statico.
 * Qui restano solo stati personali, conversazioni, challenge incluse nel
 * contesto della chat e preferenze dell'interfaccia. Un aggiornamento del
 * catalogo non cancella nessuna di queste chiavi.
 */

export const STORAGE_KEY = 'oliduck:state';
export const SCHEMA_VERSION = 2;
export const STATUSES = ['todo', 'in-progress', 'completed'];
export const GENERAL_CONVERSATION_ID = 'general';
/** Dashboard CTF a sinistra: default 60/40, limiti 35–75% / 25–65%. */
export const DEFAULT_PANEL_WIDTH = 60;
export const MIN_PANEL_WIDTH = 35;
export const MAX_PANEL_WIDTH = 75;
export const MAX_SELECTED_CHALLENGES = 6;
export const SELECTED_CHALLENGE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
export const CHAT_CONVERSATION_PREFIX = 'chat:';

const MAX_MESSAGES_PER_CHALLENGE = 100;
const MAX_TITLE_CHARS = 120;

/** ID validi, deduplicati e in ordine di inclusione (max 6). */
export function normalizeSelectedIds(value) {
  const candidates = Array.isArray(value)
    ? value
    : (typeof value === 'string' ? [value] : []);
  const ids = [];
  for (const id of candidates) {
    if (typeof id !== 'string' || !SELECTED_CHALLENGE_ID_PATTERN.test(id) || ids.includes(id)) continue;
    ids.push(id);
    if (ids.length === MAX_SELECTED_CHALLENGES) break;
  }
  return ids;
}

export function defaultState() {
  return {
    version: SCHEMA_VERSION,
    statuses: {},
    conversations: {},
    // Metadati opzionali: chiavi di conversazione, titoli e riferimenti challenge.
    // Lo schema resta v2: i dati storici senza questi campi continuano a funzionare.
    conversationMeta: {},
    activeConversation: GENERAL_CONVERSATION_ID,
    favorites: [],
    selectedChallengeIds: [],
    preferences: {
      theme: 'light',
      panelWidth: DEFAULT_PANEL_WIDTH,
      activePanel: 'assistant',
      assistantCollapsed: false,
      filters: {
        query: '', category: 'all', difficulty: 'all', edition: 'all',
        path: 'all', tag: 'all', status: 'all', favorite: 'all', sort: 'catalog',
      },
    },
  };
}

/** Migrazione v1 → v2: conserva stati, conversazioni e challenge selezionata. */
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
          edition: 'all', path: 'all', tag: 'all', status: 'all', favorite: 'all', sort: 'catalog',
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

/** Titolo leggibile derivato dal primo messaggio: nessun contenuto inventato. */
function titleFromContent(content) {
  const text = String(content || '').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const short = text.slice(0, MAX_TITLE_CHARS).trim();
  return short.length < text.length ? `${short}…` : short;
}

/** Le vecchie chiavi `ctx:` restano valide anche senza metadati salvati. */
function challengeIdsFromKey(key) {
  return typeof key === 'string' && key.startsWith('ctx:')
    ? key.slice(4).split('|').filter((id) => SELECTED_CHALLENGE_ID_PATTERN.test(id))
    : [];
}

function normalizeConversationMeta(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const title = typeof raw.title === 'string' ? raw.title.trim().slice(0, MAX_TITLE_CHARS) : '';
  const challengeIds = normalizeSelectedIds(raw.challengeIds);
  const createdAt = typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString();
  const updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : createdAt;
  // Estratto incollato dallo studente: testo NON verificato, mai una fonte
  // autorevole. Viene conservato solo per i follow-up della stessa chat.
  const statementExcerpt = typeof raw.statementExcerpt === 'string'
    ? raw.statementExcerpt.slice(0, 2000)
    : '';
  return {
    title,
    challengeIds,
    kind: challengeIds.length ? 'challenge' : 'general',
    createdAt,
    updatedAt,
    statementExcerpt,
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

  const conversationMeta = {};
  if (state.conversationMeta && typeof state.conversationMeta === 'object') {
    for (const [id, meta] of Object.entries(state.conversationMeta)) {
      const clean = normalizeConversationMeta(meta);
      if (clean) conversationMeta[id] = clean;
    }
  }

  const conversations = {};
  if (state.conversations && typeof state.conversations === 'object') {
    for (const [id, list] of Object.entries(state.conversations)) {
      if (!Array.isArray(list) || typeof id !== 'string') continue;
      const messages = list.map(normalizeMessage).filter(Boolean).slice(-MAX_MESSAGES_PER_CHALLENGE);
      // Una chat appena creata è vuota ma deve restare nella cronologia.
      if (messages.length || conversationMeta[id]) conversations[id] = messages;
    }
  }
  // Metadati senza messaggi (per esempio dopo una cancellazione selettiva) non
  // devono generare voci fantasma.
  for (const id of Object.keys(conversationMeta)) {
    if (!conversations[id]) delete conversationMeta[id];
  }

  const favorites = Array.isArray(state.favorites)
    ? state.favorites.filter((id) => typeof id === 'string' && SELECTED_CHALLENGE_ID_PATTERN.test(id))
    : [];
  const activeConversation = typeof state.activeConversation === 'string'
    && (conversations[state.activeConversation]
      || state.activeConversation === GENERAL_CONVERSATION_ID
      || state.activeConversation.startsWith('ctx:'))
    ? state.activeConversation
    : GENERAL_CONVERSATION_ID;

  const prefs = state.preferences && typeof state.preferences === 'object' ? state.preferences : {};
  const filters = prefs.filters && typeof prefs.filters === 'object' ? prefs.filters : {};
  const width = Number(prefs.panelWidth);
  const allowedSorts = ['catalog', 'original-id', 'title-asc', 'title-desc', 'category', 'score-desc', 'recent'];

  return {
    version: SCHEMA_VERSION,
    statuses,
    conversations,
    conversationMeta,
    activeConversation,
    favorites: [...new Set(favorites)].slice(0, MAX_SELECTED_CHALLENGES * 4),
    // Uno stato v2 storico può avere solo `selectedChallengeId`: diventa un array di uno.
    selectedChallengeIds: normalizeSelectedIds(state.selectedChallengeIds ?? state.selectedChallengeId),
    preferences: {
      theme: prefs.theme === 'dark' ? 'dark' : 'light',
      panelWidth: Number.isFinite(width)
        ? Math.min(MAX_PANEL_WIDTH, Math.max(MIN_PANEL_WIDTH, Math.round(width)))
        : DEFAULT_PANEL_WIDTH,
      activePanel: prefs.activePanel === 'library' ? 'library' : 'assistant',
      assistantCollapsed: prefs.assistantCollapsed === true,
      filters: {
        query: typeof filters.query === 'string' ? filters.query.slice(0, 200) : '',
        category: typeof filters.category === 'string' ? filters.category : 'all',
        difficulty: typeof filters.difficulty === 'string' ? filters.difficulty : 'all',
        edition: typeof filters.edition === 'string' ? filters.edition : 'all',
        path: typeof filters.path === 'string' ? filters.path : 'all',
        tag: typeof filters.tag === 'string' ? filters.tag : 'all',
        status: STATUSES.includes(filters.status) ? filters.status : 'all',
        favorite: filters.favorite === 'favorites' ? 'favorites' : 'all',
        sort: allowedSorts.includes(filters.sort) ? filters.sort : 'catalog',
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
    const clean = normalizeMessage(message);
    if (!clean) return;
    this.update((draft) => {
      const list = draft.conversations[id] || [];
      list.push(clean);
      draft.conversations[id] = list.slice(-MAX_MESSAGES_PER_CHALLENGE);
      const meta = draft.conversationMeta[id]
        || normalizeConversationMeta({ challengeIds: challengeIdsFromKey(id) });
      meta.updatedAt = clean.createdAt;
      if (!meta.title && clean.role === 'user') {
        meta.title = titleFromContent(clean.content);
      }
      draft.conversationMeta[id] = meta;
    });
  }

  /**
   * Sostituisce il testo di un messaggio esistente. Usato dalla modifica di un
   * messaggio utente: l'ID resta stabile, gli altri messaggi non vengono toccati.
   */
  replaceMessage(id, messageId, content) {
    if (typeof id !== 'string' || typeof messageId !== 'string' || typeof content !== 'string') return false;
    const clean = content.trim().slice(0, 20000);
    if (!clean) return false;
    let replaced = false;
    this.update((draft) => {
      const list = draft.conversations[id] || [];
      const message = list.find((item) => item.id === messageId);
      if (!message || message.role !== 'user') return;
      message.content = clean;
      replaced = true;
      draft.conversationMeta[id] = draft.conversationMeta[id]
        || normalizeConversationMeta({ challengeIds: challengeIdsFromKey(id) });
      draft.conversationMeta[id].updatedAt = new Date().toISOString();
    });
    return replaced;
  }

  /** Metadati completi: quelli salvati, con fallback per le chiavi storiche. */
  getConversationMeta(id) {
    const key = typeof id === 'string' ? id : GENERAL_CONVERSATION_ID;
    const messages = this.state.conversations[key] || [];
    const stored = this.state.conversationMeta[key] || {};
    const challengeIds = stored.challengeIds || challengeIdsFromKey(key);
    const firstUser = messages.find((item) => item.role === 'user');
    return {
      id: key,
      title: stored.title || titleFromContent(firstUser?.content) || (key === GENERAL_CONVERSATION_ID ? 'Chat generale' : 'Nuova chat'),
      challengeIds: [...challengeIds],
      kind: challengeIds.length ? 'challenge' : 'general',
      createdAt: stored.createdAt || firstUser?.createdAt || null,
      updatedAt: stored.updatedAt || messages.at(-1)?.createdAt || null,
      statementExcerpt: stored.statementExcerpt || '',
      messageCount: messages.length,
    };
  }

  listConversations() {
    const ids = new Set([
      ...Object.keys(this.state.conversations),
      ...Object.keys(this.state.conversationMeta),
      GENERAL_CONVERSATION_ID,
    ]);
    return [...ids]
      .map((id) => this.getConversationMeta(id))
      .sort((a, b) => String(b.updatedAt || b.createdAt || '').localeCompare(String(a.updatedAt || a.createdAt || '')));
  }

  /** Crea una conversazione vuota e la imposta come attiva. */
  createConversation({ title = 'Nuova chat', challengeIds = [] } = {}) {
    const random = globalThis.crypto?.randomUUID?.()
      || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const id = `${CHAT_CONVERSATION_PREFIX}${random}`;
    const now = new Date().toISOString();
    this.update((draft) => {
      draft.conversations[id] = [];
      const clean = normalizeConversationMeta({ title, challengeIds, createdAt: now, updatedAt: now });
      draft.conversationMeta[id] = clean;
      draft.activeConversation = id;
    });
    return id;
  }

  setConversationMeta(id, patch = {}) {
    if (typeof id !== 'string' || !id) return;
    this.update((draft) => {
      const current = draft.conversationMeta[id]
        || normalizeConversationMeta({ challengeIds: challengeIdsFromKey(id) });
      draft.conversationMeta[id] = normalizeConversationMeta({ ...current, ...patch });
    });
  }

  renameConversation(id, title) {
    const clean = typeof title === 'string' ? title.trim().slice(0, MAX_TITLE_CHARS) : '';
    if (!clean) return false;
    this.setConversationMeta(id, { title: clean });
    return true;
  }

  truncateConversation(id, length) {
    if (typeof id !== 'string') return;
    this.update((draft) => {
      const list = draft.conversations[id] || [];
      draft.conversations[id] = list.slice(0, Math.max(0, Math.min(Number(length) || 0, list.length)));
    });
  }

  deleteConversation(id) {
    if (typeof id !== 'string') return;
    this.update((draft) => {
      delete draft.conversations[id];
      delete draft.conversationMeta[id];
      if (draft.activeConversation === id) {
        const remaining = Object.keys(draft.conversations);
        draft.activeConversation = remaining.length ? remaining[0] : GENERAL_CONVERSATION_ID;
      }
    });
  }

  setActiveConversation(id) {
    if (typeof id !== 'string') return;
    // Le chat contestuali automatiche possono essere attive anche prima del
    // primo messaggio: la conversazione verrà creata al primo invio.
    if (id !== GENERAL_CONVERSATION_ID && !this.state.conversations[id] && !id.startsWith('ctx:')) return;
    if (this.state.activeConversation === id) return;
    this.update((draft) => { draft.activeConversation = id; });
  }

  getActiveConversation() {
    return this.state.activeConversation || GENERAL_CONVERSATION_ID;
  }

  isFavorite(id) {
    return typeof id === 'string' && this.state.favorites.includes(id);
  }

  toggleFavorite(id) {
    if (typeof id !== 'string' || !SELECTED_CHALLENGE_ID_PATTERN.test(id)) return false;
    let favorite = false;
    this.update((draft) => {
      const index = draft.favorites.indexOf(id);
      if (index === -1) {
        draft.favorites.push(id);
        favorite = true;
      } else {
        draft.favorites.splice(index, 1);
      }
    });
    return favorite;
  }

  clearConversation(id) {
    this.update((draft) => {
      delete draft.conversations[id];
      delete draft.conversationMeta[id];
      if (draft.activeConversation === id) draft.activeConversation = GENERAL_CONVERSATION_ID;
    });
  }

  clearConversations() {
    this.update((draft) => {
      draft.conversations = {};
      draft.conversationMeta = {};
      draft.activeConversation = GENERAL_CONVERSATION_ID;
    });
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

  getSelectedChallengeIds() {
    return [...(this.state.selectedChallengeIds || [])];
  }

  setSelectedChallengeIds(ids) {
    const next = normalizeSelectedIds(ids);
    if (next.join('|') === this.getSelectedChallengeIds().join('|')) return next;
    this.update((draft) => { draft.selectedChallengeIds = next; });
    return next;
  }

  /** Compatibilità con il vecchio singolo ID: imposta [id] oppure []. */
  selectChallenge(id) {
    this.setSelectedChallengeIds(typeof id === 'string' ? [id] : []);
  }

  /** Aggiunge/rimuove un ID e ritorna il nuovo stato di selezione. */
  toggleChallengeSelection(id) {
    if (typeof id !== 'string' || !SELECTED_CHALLENGE_ID_PATTERN.test(id)) return false;
    const ids = this.getSelectedChallengeIds();
    const index = ids.indexOf(id);
    if (index !== -1) {
      this.setSelectedChallengeIds(ids.filter((item) => item !== id));
      return false;
    }
    if (ids.length >= MAX_SELECTED_CHALLENGES) return false;
    this.setSelectedChallengeIds([...ids, id]);
    return true;
  }

  clearSelectedChallenges() {
    this.setSelectedChallengeIds([]);
  }
}
