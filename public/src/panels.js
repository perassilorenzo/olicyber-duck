/** Controllo del workspace a due pannelli: splitter, espansione, reset, tab mobile. */

import { byId, toast } from './utils.js';
import {
  DEFAULT_PANEL_WIDTH, MIN_PANEL_WIDTH, MAX_PANEL_WIDTH,
} from './store.js';
import { effectiveAssistantPercent, SPLITTER_PX } from './layout.js';

const MIN_DASHBOARD_PX = 360;
const MIN_ASSISTANT_PX = 340;

export function createPanels({ store, onWidthChange }) {
  const workspace = byId('main-content');
  const splitter = byId('splitter');
  const range = byId('panel-width-setting');
  let current = store.state.preferences.panelWidth;

  function metrics() {
    const rect = workspace.getBoundingClientRect?.() || { left: 0, width: 0 };
    const style = getComputedStyle(workspace);
    const padLeft = parseFloat(style.paddingLeft) || 0;
    const padRight = parseFloat(style.paddingRight) || 0;
    const width = workspace.clientWidth || rect.width || 0;
    return { left: (rect.left || 0) + padLeft, inner: Math.max(0, width - padLeft - padRight) };
  }

  function clamp(value) {
    let lower = MIN_PANEL_WIDTH;
    let upper = MAX_PANEL_WIDTH;
    const { inner } = metrics();
    // I minimi in pixel valgono solo quando c'è spazio per due pannelli reali:
    // su mobile le tab mostrano un pannello alla volta e la percentuale resta
    // invariata (35–75%), così il ritorno al desktop non trova valori assurdi.
    if (inner >= MIN_DASHBOARD_PX + MIN_ASSISTANT_PX + SPLITTER_PX) {
      lower = Math.max(lower, Math.ceil((MIN_DASHBOARD_PX / inner) * 100));
      upper = Math.min(upper, Math.floor(((inner - MIN_ASSISTANT_PX - SPLITTER_PX) / inner) * 100));
    }
    upper = Math.max(lower, upper);
    const number = Number(value);
    const requested = Number.isFinite(number) ? Math.round(number) : DEFAULT_PANEL_WIDTH;
    return Math.min(upper, Math.max(lower, requested));
  }

  function apply(value, { persist = true } = {}) {
    current = clamp(value);
    workspace.style.setProperty('--dashboard-width', `${current}%`);
    splitter.setAttribute('aria-valuenow', String(current));
    if (range) range.value = String(current);
    onWidthChange?.(current, effectiveAssistantPercent(current, metrics().inner, SPLITTER_PX));
    if (persist) store.setPreference('panelWidth', current);
    return current;
  }

  function reset() {
    apply(DEFAULT_PANEL_WIDTH);
    toast('Larghezze predefinite ripristinate (60% / 40%).');
  }

  function isCompact() {
    return Boolean(window.matchMedia?.('(max-width: 900px)').matches);
  }

  // ---- Trascinamento ----
  let dragging = false;

  function onMove(event) {
    const { left, inner } = metrics();
    if (inner <= 0) return;
    apply(((event.clientX - left) / inner) * 100, { persist: false });
  }

  splitter.addEventListener('pointerdown', (event) => {
    if (isCompact()) return;
    dragging = true;
    splitter.classList.add('is-dragging');
    splitter.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });
  splitter.addEventListener('pointermove', (event) => { if (dragging) onMove(event); });

  function endDrag() {
    if (!dragging) return;
    dragging = false;
    splitter.classList.remove('is-dragging');
    store.setPreference('panelWidth', current);
  }
  splitter.addEventListener('pointerup', endDrag);
  splitter.addEventListener('pointercancel', endDrag);
  splitter.addEventListener('lostpointercapture', endDrag);

  splitter.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 5 : 2;
    let next = current;
    if (event.key === 'ArrowLeft') next = current - step;
    else if (event.key === 'ArrowRight') next = current + step;
    else if (event.key === 'Home') next = MIN_PANEL_WIDTH;
    else if (event.key === 'End') next = MAX_PANEL_WIDTH;
    else return;
    event.preventDefault();
    apply(next);
  });
  splitter.addEventListener('dblclick', reset);

  // ---- Pulsanti di espansione ----
  byId('expand-library')?.addEventListener('click', () => {
    apply(MAX_PANEL_WIDTH);
    toast('Dashboard espansa.');
  });
  byId('expand-assistant')?.addEventListener('click', () => {
    apply(MIN_PANEL_WIDTH);
    toast('Tutor espanso.');
  });
  byId('reset-panels')?.addEventListener('click', reset);

  range?.addEventListener('input', (event) => apply(event.target.value, { persist: false }));
  range?.addEventListener('change', (event) => apply(event.target.value));

  // ---- Tab mobile ----
  const tabs = [...document.querySelectorAll('[data-panel-tab]')];

  function setView(view, { persist = true } = {}) {
    const next = view === 'library' ? 'library' : 'assistant';
    workspace.dataset.view = next;
    for (const button of tabs) {
      const selected = button.dataset.panelTab === next;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      button.classList.toggle('is-active', selected);
    }
    if (persist) store.setPreference('activePanel', next);
  }

  for (const button of tabs) {
    button.addEventListener('click', () => {
      if (isCompact()) setView(button.dataset.panelTab);
    });
    button.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const index = tabs.indexOf(button);
      const delta = event.key === 'ArrowRight' ? 1 : -1;
      const next = tabs[(index + delta + tabs.length) % tabs.length];
      next.focus();
      if (isCompact()) setView(next.dataset.panelTab);
    });
  }

  return {
    apply,
    reset,
    setView,
    reflow: () => apply(current, { persist: false }),
    isCompact,
    get width() { return current; },
    get assistantPercent() { return effectiveAssistantPercent(current, metrics().inner, SPLITTER_PX); },
    get view() { return workspace.dataset.view; },
  };
}
