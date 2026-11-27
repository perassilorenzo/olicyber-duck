/** Bootstrap: collega catalogo, store, pannelli, dettagli e assistente. */

import { byId, confirmDialog, toast } from './utils.js';
import { loadCatalog } from './catalog.js';
import { LocalStore, MAX_SELECTED_CHALLENGES } from './store.js';
import { createLibrary } from './library.js';
import { createDetails } from './details.js';
import { createAssistant } from './assistant.js';
import { createPanels } from './panels.js';
import { createHistory } from './history.js';
import { createTraining } from './training.js';
import { fetchAssistantStatus } from './api.js';
import { catalogProvenance } from './provenance.js';

const store = new LocalStore();
let catalog = { meta: { source: {}, completeness: {} }, challenges: [] };
let library;
let details;
let assistant;
let panels;
let history;
let training;
/** Challenge mostrata nel drawer: indipendente dalla selezione della chat. */
let detailChallengeId = null;

const byChallengeId = (id) => catalog.challenges.find((challenge) => challenge.id === id) || null;
const getDetailChallenge = () => byChallengeId(detailChallengeId);
const getSelectedChallenges = () => store.getSelectedChallengeIds().map(byChallengeId).filter(Boolean);

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  byId('theme-select').value = theme;
}

function updateWidthLabels(width, assistantPercent) {
  const roundedWidth = Math.round(width);
  byId('panel-width-value').textContent = `${roundedWidth}%`;
  byId('assistant-width-value').textContent = `${Math.round(assistantPercent)}%`;
  byId('panel-width-setting').value = String(roundedWidth);
}

function applyPreferenceUI() {
  if (!panels) return;
  const { panelWidth, activePanel, assistantCollapsed } = store.state.preferences;
  panels.apply(panelWidth, { persist: false });
  setAssistantCollapsed(assistantCollapsed, { persist: false });
  if (!panels.isCompact()) panels.setView(activePanel, { persist: false });
}

function setAssistantCollapsed(collapsed, { persist = true } = {}) {
  const value = Boolean(collapsed);
  byId('main-content').dataset.assistantCollapsed = String(value);
  const button = byId('toggle-assistant');
  button.setAttribute('aria-pressed', String(value));
  button.setAttribute('aria-label', value ? 'Ripristina il tutor AI' : 'Comprimi il tutor AI');
  button.title = value ? 'Ripristina il tutor AI' : 'Comprimi il tutor AI';
  byId('restore-assistant').hidden = !value;
  if (persist) store.setPreference('assistantCollapsed', value);
  if (!value) panels?.reflow();
}

function closeDialog(id) {
  byId(id)?.close?.();
}

function refreshWorkspace() {
  history?.render();
  training?.render();
}

/** La challenge richiesta diventa il contesto primario, non l'ultima della coda. */
function makePrimary(challenge) {
  const remaining = store.getSelectedChallengeIds().filter((id) => id !== challenge.id);
  if (remaining.length >= MAX_SELECTED_CHALLENGES) remaining.pop();
  store.setSelectedChallengeIds([challenge.id, ...remaining]);
}

/** La libreria ha già aggiornato lo store: qui solo effetti collaterali sull'UI. */
function selectChallenge(challenge, nowSelected) {
  if (nowSelected) {
    makePrimary(challenge);
    assistant.switchMode('challenge');
  }
  if (panels.isCompact()) panels.setView('assistant');
  assistant.focus();
}

function askAssistant(challenge = getDetailChallenge()) {
  if (challenge) {
    if (store.getSelectedChallengeIds().length >= MAX_SELECTED_CHALLENGES
      && !store.getSelectedChallengeIds().includes(challenge.id)) {
      toast(`Puoi selezionare al massimo ${MAX_SELECTED_CHALLENGES} challenge: la più vecchia verrà sostituita`);
    }
    makePrimary(challenge);
  }
  details.close();
  setAssistantCollapsed(false);
  panels.setView('assistant');
  if (store.getSelectedChallengeIds().length) assistant.switchMode('challenge');
  assistant.focus();
}

function startNewChat() {
  closeDialog('history-dialog');
  closeDialog('training-dialog');
  assistant.newChat();
  setAssistantCollapsed(false);
  panels.setView('assistant');
  assistant.focus();
}

function openDetails(challenge) {
  detailChallengeId = challenge.id;
  details.render();
  details.open();
}

function updateStatusBadge(mode, label) {
  const badge = byId('ai-status');
  badge.dataset.mode = mode;
  byId('ai-status-label').textContent = label;
  assistant?.setMode(mode);
}

async function checkAssistantStatus() {
  updateStatusBadge('loading', 'Assistente: verifica…');
  try {
    const data = await fetchAssistantStatus();
    updateStatusBadge(
      data.mode === 'ai' ? 'ai' : 'demo',
      data.mode === 'ai'
        ? `Assistente: AI${data.model ? ` · ${data.model.split('/').pop()}` : ''}`
        : 'Assistente: modalità DEMO',
    );
  } catch {
    updateStatusBadge('error', 'Assistente: non raggiungibile');
  }
}

function setupDialogs() {
  for (const button of document.querySelectorAll('[data-dialog-open]')) {
    button.addEventListener('click', () => byId(`${button.dataset.dialogOpen}-dialog`).showModal());
  }
  for (const button of document.querySelectorAll('[data-dialog-close]')) {
    button.addEventListener('click', () => button.closest('dialog').close());
  }
}

function setupSettings() {
  byId('theme-select').addEventListener('change', (event) => {
    store.setPreference('theme', event.target.value);
    applyTheme(event.target.value);
  });

  byId('clear-conversations').addEventListener('click', async () => {
    const ok = await confirmDialog('Cancellare tutte le conversazioni salvate in questo browser?');
    if (!ok) return;
    store.clearConversations();
    assistant.render();
    refreshWorkspace();
    toast('Conversazioni cancellate.');
  });

  byId('clear-all-data').addEventListener('click', async () => {
    const ok = await confirmDialog('Cancellare tutti i dati locali (stati, conversazioni, preferenze)?');
    if (!ok) return;
    store.clearAll();
    detailChallengeId = null;
    assistant.syncSelection();
    assistant.switchMode('general');
    details.render();
    refreshWorkspace();
    toast('Dati locali cancellati.');
  });

  byId('storage-note').textContent = store.available
    ? 'Progressi, conversazioni e preferenze sono salvati solo in questo browser (localStorage) e non si sincronizzano tra dispositivi. Aggiornare il catalogo non cancella questi dati.'
    : 'localStorage non è disponibile: lo stato verrà mantenuto solo fino al refresh della pagina.';
  if (store.lastError) byId('storage-note').textContent += ` ${store.lastError}`;
}

async function init() {
  applyTheme(store.state.preferences.theme);
  setupDialogs();
  setupSettings();

  panels = createPanels({ store, onWidthChange: updateWidthLabels });
  panels.apply(store.state.preferences.panelWidth, { persist: false });
  panels.setView(store.state.preferences.activePanel, { persist: false });
  applyPreferenceUI();
  window.addEventListener('resize', () => panels.reflow(), { passive: true });

  byId('focus-assistant').addEventListener('click', () => {
    setAssistantCollapsed(false);
    panels.setView('assistant');
    assistant.focus();
  });
  byId('toggle-assistant').addEventListener('click', () => {
    setAssistantCollapsed(!store.state.preferences.assistantCollapsed);
  });
  byId('restore-assistant').addEventListener('click', () => setAssistantCollapsed(false));
  assistant = createAssistant({
    store,
    getSelectedChallenges,
    onConversationChange: () => refreshWorkspace(),
  });

  details = createDetails({
    store,
    getChallenge: getDetailChallenge,
    onAsk: askAssistant,
  });

  history = createHistory({
    store,
    onOpenConversation: (id) => {
      if (!assistant.openConversation(id)) return;
      closeDialog('history-dialog');
      closeDialog('training-dialog');
      if (panels.isCompact()) panels.setView('assistant');
      setAssistantCollapsed(false);
      assistant.focus();
    },
    onNewChat: startNewChat,
    onDeleteConversation: (id) => assistant.deleteConversation(id),
  });

  training = createTraining({
    store,
    getCatalog: () => catalog,
    getSelectedChallenges,
    getDetailChallenge,
    onOpenDetails: openDetails,
    onAskAssistant: askAssistant,
    onOpenLibrary: () => {
      closeDialog('training-dialog');
      panels.setView('library');
    },
    onNewChat: startNewChat,
  });

  function renderCatalogProvenance(meta, challenges) {
    const provenance = catalogProvenance(meta, challenges);
    const badge = byId('catalog-provenance');
    badge.className = `provenance-badge provenance-badge--${provenance.kind}`;
    badge.textContent = provenance.label;
    const name = meta?.source?.name || 'Catalogo';
    byId('catalog-source-note').textContent = meta?.source?.note
      ? `${name} — ${meta.source.note}`
      : `${name} — provenienza: ${provenance.label}.`;
  }

  try {
    catalog = await loadCatalog();
    renderCatalogProvenance(catalog.meta, catalog.challenges);
  } catch (error) {
    renderCatalogProvenance({}, []);
    byId('catalog-source-note').textContent = `Catalogo non disponibile: ${error.message}`;
    toast('Impossibile caricare il catalogo delle challenge.', 5000);
  }

  library = createLibrary({
    store,
    challenges: catalog.challenges,
    onSelect: selectChallenge,
    onOpenDetails: openDetails,
  });
  library.correctFilters();
  refreshWorkspace();

  let lastNotifiedState = store.state;
  store.subscribe((state) => {
    const previous = lastNotifiedState;
    lastNotifiedState = state;
    if (previous === state) return;

    const filtersChanged = JSON.stringify(previous.preferences.filters)
      !== JSON.stringify(state.preferences.filters);
    const statusesChanged = JSON.stringify(previous.statuses) !== JSON.stringify(state.statuses);
    const selectionChanged = JSON.stringify(previous.selectedChallengeIds)
      !== JSON.stringify(state.selectedChallengeIds);
    const conversationsChanged = JSON.stringify(previous.conversations) !== JSON.stringify(state.conversations)
      || JSON.stringify(previous.conversationMeta) !== JSON.stringify(state.conversationMeta);
    const activeChanged = previous.activeConversation !== state.activeConversation;
    const themeChanged = previous.preferences.theme !== state.preferences.theme;
    const layoutChanged = previous.preferences.panelWidth !== state.preferences.panelWidth
      || previous.preferences.activePanel !== state.preferences.activePanel
      || previous.preferences.assistantCollapsed !== state.preferences.assistantCollapsed;

    if (filtersChanged) library.syncFilters();
    else if (statusesChanged || selectionChanged) library.render();

    if (statusesChanged) details.render();
    if (selectionChanged && !assistant.isApplyingContext) assistant.syncSelection();
    if (statusesChanged || selectionChanged || conversationsChanged || activeChanged) refreshWorkspace();
    if (themeChanged) applyTheme(state.preferences.theme);
    if (layoutChanged) applyPreferenceUI();
  });

  assistant.syncSelection();
  checkAssistantStatus();
}

init();
