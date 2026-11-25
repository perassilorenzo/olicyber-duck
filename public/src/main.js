/** Bootstrap: collega catalogo, store, pannelli, dettagli e assistente. */

import { byId, confirmDialog, toast } from './utils.js';
import { loadCatalog } from './catalog.js';
import { LocalStore } from './store.js';
import { createLibrary } from './library.js';
import { createDetails } from './details.js';
import { createAssistant } from './assistant.js';
import { createPanels } from './panels.js';
import { fetchAssistantStatus } from './api.js';

const store = new LocalStore();
let catalog = { meta: { source: {}, completeness: {} }, challenges: [] };
let library;
let details;
let assistant;
let panels;

const byChallengeId = (id) => catalog.challenges.find((challenge) => challenge.id === id) || null;
const getSelectedChallenge = () => byChallengeId(store.state.selectedChallengeId);

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  byId('theme-select').value = theme;
}

function applyPreferenceUI() {
  const { panelWidth, activePanel } = store.state.preferences;
  byId('panel-width-value').textContent = `${panelWidth}%`;
  byId('assistant-width-value').textContent = `${100 - panelWidth}%`;
  byId('panel-width-setting').value = String(panelWidth);
  if (panels && !panels.isCompact()) panels.setView(activePanel, { persist: false });
}

function selectChallenge(challenge) {
  store.selectChallenge(challenge.id);
  assistant.selectChallenge(challenge);
  details.render();
  if (panels.isCompact()) panels.setView('assistant');
  assistant.focus();
}

function askAssistant() {
  details.close();
  panels.setView('assistant');
  assistant.switchMode('challenge');
  assistant.focus();
}

function openDetails(challenge) {
  store.selectChallenge(challenge.id);
  assistant.selectChallenge(challenge);
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
    toast('Conversazioni cancellate.');
  });

  byId('clear-all-data').addEventListener('click', async () => {
    const ok = await confirmDialog('Cancellare tutti i dati locali (stati, conversazioni, preferenze)?');
    if (!ok) return;
    store.clearAll();
    applyTheme(store.state.preferences.theme);
    panels.apply(store.state.preferences.panelWidth, { persist: false });
    panels.setView(store.state.preferences.activePanel, { persist: false });
    library.syncFilters();
    assistant.selectChallenge(getSelectedChallenge());
    assistant.switchMode('general');
    details.render();
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

  panels = createPanels({ store });
  panels.apply(store.state.preferences.panelWidth, { persist: false });
  panels.setView(store.state.preferences.activePanel, { persist: false });
  applyPreferenceUI();
  window.addEventListener('resize', () => panels.reflow(), { passive: true });

  byId('focus-assistant').addEventListener('click', () => {
    panels.setView('assistant');
    assistant.focus();
  });

  assistant = createAssistant({
    store,
    getChallenge: getSelectedChallenge,
    onConversationChange: () => library?.render(),
  });

  details = createDetails({
    store,
    getChallenge: getSelectedChallenge,
    onAsk: askAssistant,
  });

  try {
    catalog = await loadCatalog();
    const meta = catalog.meta;
    const verified = meta.source.verified === true;
    byId('library-footnote').textContent = meta.source.note
      ? `${meta.source.name} — ${meta.source.note}`
      : `${meta.source.name || 'Catalogo'} — provenienza: ${verified ? 'verificata' : 'non verificata'}.`;
  } catch (error) {
    byId('library-footnote').textContent = `Catalogo non disponibile: ${error.message}`;
    toast('Impossibile caricare il catalogo delle challenge.', 5000);
  }

  library = createLibrary({
    store,
    challenges: catalog.challenges,
    onSelect: selectChallenge,
    onOpenDetails: openDetails,
  });

  store.subscribe(() => {
    library.render();
    details.render();
    applyPreferenceUI();
  });

  assistant.selectChallenge(getSelectedChallenge());
  checkAssistantStatus();
}

init();
