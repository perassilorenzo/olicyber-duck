/** Bootstrap dell'applicazione: collega catalogo, store, pannelli e backend. */

import { byId, confirmDialog, toast } from './utils.js';
import { loadCatalog } from './catalog.js';
import { LocalStore } from './store.js';
import { createLibrary } from './library.js';
import { createWorkspace } from './workspace.js';
import { createAssistant } from './assistant.js';
import { fetchAssistantStatus } from './api.js';

const store = new LocalStore();
const workspace = byId('main-content');
const compact = () => window.matchMedia('(max-width: 900px)').matches;

let catalog = { challenges: [] };
let library;
let workspacePanel;
let assistant;
let statusMode = null;

const byChallengeId = (id) => catalog.challenges.find((challenge) => challenge.id === id) || null;
const getSelectedChallenge = () => byChallengeId(store.state.selectedChallengeId);

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  byId('theme-select').value = theme;
}

function applyCollapsed(collapsed) {
  workspace.dataset.collapsed = String(collapsed);
  byId('assistant-collapsed-setting').checked = collapsed;
  const button = byId('collapse-assistant');
  button.setAttribute('aria-label', collapsed ? 'Espandi pannello assistente' : 'Riduci pannello assistente');
  button.title = collapsed ? 'Espandi pannello' : 'Riduci pannello';
}

function applyView(view) {
  workspace.dataset.view = view;
  for (const button of document.querySelectorAll('[data-mobile-tab]')) {
    button.classList.toggle('is-active', button.dataset.mobileTab === view);
  }
  store.setPreference('mobileView', view);
}

function selectChallenge(challenge) {
  store.selectChallenge(challenge.id);
  assistant.selectChallenge(challenge);
  if (compact()) applyView('workspace');
}

function openAssistant() {
  applyCollapsed(false);
  if (compact()) applyView('assistant');
  requestAnimationFrame(() => assistant.focus());
}

function updateStatusBadge(mode, label) {
  statusMode = mode;
  const badge = byId('ai-status');
  badge.dataset.mode = mode;
  byId('ai-status-label').textContent = label;
  assistant?.setMode(mode);
}

async function checkAssistantStatus() {
  updateStatusBadge('loading', 'Assistente: verifica…');
  try {
    const data = await fetchAssistantStatus();
    if (data.mode === 'ai') {
      updateStatusBadge('ai', `Assistente: AI${data.model ? ` · ${data.model.split('/').pop()}` : ''}`);
    } else {
      updateStatusBadge('demo', 'Assistente: modalità DEMO');
    }
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
  byId('assistant-collapsed-setting').addEventListener('change', (event) => {
    applyCollapsed(event.target.checked);
  });
  byId('clear-conversations').addEventListener('click', async () => {
    const ok = await confirmDialog('Cancellare tutte le conversazioni salvate in questo browser?');
    if (!ok) return;
    store.clearConversations();
    assistant.selectChallenge(getSelectedChallenge());
    toast('Conversazioni cancellate.');
  });
  byId('clear-all-data').addEventListener('click', async () => {
    const ok = await confirmDialog('Cancellare tutti i dati locali (stati, conversazioni, preferenze)?');
    if (!ok) return;
    store.clearAll();
    applyTheme(store.state.preferences.theme);
    applyCollapsed(store.state.preferences.assistantCollapsed);
    applyView(store.state.preferences.mobileView);
    library?.syncFilters();
    assistant.selectChallenge(getSelectedChallenge());
    toast('Dati locali cancellati.');
  });
  byId('storage-note').textContent = store.available
    ? 'Progressi, conversazioni e preferenze sono salvati solo in questo browser (localStorage) e non si sincronizzano tra dispositivi.'
    : 'localStorage non è disponibile: lo stato verrà mantenuto solo fino al refresh della pagina.';
  if (store.lastError) byId('storage-note').textContent += ` ${store.lastError}`;
}

function setupPanelControls() {
  byId('collapse-assistant').addEventListener('click', () => {
    applyCollapsed(workspace.dataset.collapsed !== 'true');
  });
  byId('expand-assistant').addEventListener('click', openAssistant);
  for (const button of document.querySelectorAll('[data-open-assistant]')) {
    button.addEventListener('click', openAssistant);
  }
  for (const button of document.querySelectorAll('[data-mobile-tab]')) {
    button.addEventListener('click', () => applyView(button.dataset.mobileTab));
  }
}

async function init() {
  applyTheme(store.state.preferences.theme);
  applyCollapsed(store.state.preferences.assistantCollapsed);
  applyView(store.state.preferences.mobileView);
  setupDialogs();
  setupSettings();
  setupPanelControls();

  assistant = createAssistant({
    store,
    getChallenge: getSelectedChallenge,
    onConversationChange: () => library?.render(),
  });

  try {
    catalog = await loadCatalog();
    const note = byId('library-footnote');
    if (catalog.note) note.textContent = catalog.note;
  } catch (error) {
    byId('challenge-empty').querySelector('h3').textContent = 'Catalogo non disponibile';
    byId('challenge-empty').querySelector('p').textContent = `${error.message} Verifica che /data/challenges.json sia pubblicato.`;
    toast('Impossibile caricare il catalogo delle challenge.', 5000);
  }

  library = createLibrary({ store, challenges: catalog.challenges, onSelect: selectChallenge });
  workspacePanel = createWorkspace({ store, getChallenge: getSelectedChallenge });

  store.subscribe(() => {
    library.render();
    workspacePanel.render();
  });

  library.render();
  workspacePanel.render();
  assistant.selectChallenge(getSelectedChallenge());
  checkAssistantStatus();
}

init();
