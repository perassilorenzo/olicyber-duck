import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../public/styles/main.css', import.meta.url), 'utf8');

function setupDom() {
  const dom = new JSDOM(html, { url: 'http://localhost:8788/', pretendToBeVisual: true });
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.localStorage = dom.window.localStorage;
  globalThis.getComputedStyle = dom.window.getComputedStyle.bind(dom.window);
  dom.window.localStorage.clear();
  dom.window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
  return dom;
}

function withWidth(workspace, width) {
  Object.defineProperty(workspace, 'clientWidth', { configurable: true, value: width });
  Object.defineProperty(workspace, 'getBoundingClientRect', {
    configurable: true, value: () => ({ left: 0, width }),
  });
}

test('CSS del workspace: due pannelli, dashboard CTF scura, griglia 3/2/1 e palette richiesta', () => {
  const doc = new JSDOM(html).window.document;
  assert.equal(doc.querySelectorAll('main > .panel').length, 2);
  assert.equal(doc.querySelectorAll('main > .panel')[0].id, 'library-panel');
  assert.equal(doc.querySelectorAll('main > .panel')[1].id, 'assistant-panel');
  assert.equal(doc.getElementById('history-dialog').tagName, 'DIALOG');
  assert.equal(doc.getElementById('training-dialog').tagName, 'DIALOG');

  assert.match(css, /--ctf-bg:\s*#1e2124/);
  assert.match(css, /--ctf-surface:\s*#1a1d20/);
  assert.match(css, /--font:\s*Inter, Roboto, "Segoe UI"/);
  assert.match(css, /--ctf-red:\s*#dc3545/);
  assert.match(css, /--ctf-blue:\s*#007bff/);
  assert.match(css, /--ctf-amber:\s*#ffc107/);
  assert.match(css, /--ctf-green:\s*#28a745/);
  assert.match(css, /--ctf-gray:\s*#6c757d/);
  assert.match(css, /grid-template-columns:\s*minmax\(0, var\(--dashboard-width\)\) 12px minmax\(0, 1fr\)/);
  assert.match(css, /\.ctf-grid\s*\{\s*display: grid; grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); gap: 16px/);
  assert.match(css, /padding:\s*14px 16px; border-radius: 6px/);
  assert.match(css, /@media \(max-width: 1400px\)[\s\S]*?grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 900px\)[\s\S]*?grid-template-columns: 1fr/);
  assert.match(css, /\.panel\s*\{[\s\S]*?min-width: 0; min-height: 0;[\s\S]*?overflow: hidden/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test('splitter: default 60/40, limiti 35–75%, minimi in pixel, reset e tab mobile', async () => {
  const dom = setupDom();
  const { LocalStore, DEFAULT_PANEL_WIDTH, MIN_PANEL_WIDTH, MAX_PANEL_WIDTH } = await import('../public/src/store.js');
  const { createPanels } = await import('../public/src/panels.js');

  assert.equal(DEFAULT_PANEL_WIDTH, 60);
  assert.equal(MIN_PANEL_WIDTH, 35);
  assert.equal(MAX_PANEL_WIDTH, 75);

  const doc = dom.window.document;
  const workspace = doc.getElementById('main-content');
  withWidth(workspace, 2000);
  const store = new LocalStore();
  let labels = [];
  const panels = createPanels({ store, onWidthChange: (width, assistant) => labels.push([width, assistant]) });

  panels.apply(store.state.preferences.panelWidth, { persist: false });
  assert.equal(workspace.style.getPropertyValue('--dashboard-width'), '60%');
  assert.equal(panels.width, 60);
  assert.equal(doc.getElementById('splitter').getAttribute('aria-valuenow'), '60');
  assert.equal(panels.assistantPercent, 39);

  panels.apply(10);
  assert.equal(panels.width, 35);
  panels.apply(90);
  assert.equal(panels.width, 75);
  doc.getElementById('splitter').dispatchEvent(new dom.window.KeyboardEvent('keydown', {
    key: 'Home', bubbles: true, cancelable: true,
  }));
  assert.equal(panels.width, 35);
  doc.getElementById('splitter').dispatchEvent(new dom.window.KeyboardEvent('keydown', {
    key: 'End', bubbles: true, cancelable: true,
  }));
  assert.equal(panels.width, 75);

  // Reset con singola azione: torna esattamente a 60/40.
  doc.getElementById('reset-panels').click();
  assert.equal(panels.width, 60);
  assert.equal(store.state.preferences.panelWidth, 60);
  assert.match(doc.getElementById('toast').textContent, /60% \/ 40%/);

  // Minimi in pixel: a 1000px la dashboard non scende sotto 360px e il tutor sotto 340px.
  withWidth(workspace, 1000);
  panels.apply(35);
  assert.equal(panels.width, 36);
  panels.apply(75);
  assert.equal(panels.width, 64);

  // A larghezze troppo piccole per due pannelli la percentuale non viene
  // alterata: le tab mobili mostrano un solo pannello per volta.
  withWidth(workspace, 390);
  doc.getElementById('reset-panels').click();
  assert.equal(panels.width, 60);
  assert.equal(doc.getElementById('splitter').getAttribute('aria-valuenow'), '60');
  assert.equal(store.state.preferences.panelWidth, 60);

  // A schermo compatto esistono solo due tab e il pannello attivo è uno alla volta.
  dom.window.matchMedia = () => ({ matches: true, addListener() {}, removeListener() {} });
  doc.querySelector('[data-panel-tab="library"]').click();
  assert.equal(workspace.dataset.view, 'library');
  assert.equal(doc.querySelector('[data-panel-tab="library"]').getAttribute('aria-selected'), 'true');
  assert.equal(doc.querySelector('[data-panel-tab="assistant"]').getAttribute('aria-selected'), 'false');
  doc.querySelector('[data-panel-tab="assistant"]').click();
  assert.equal(workspace.dataset.view, 'assistant');
  assert.equal(doc.querySelectorAll('[data-panel-tab]').length, 2);

  dom.window.close();
});
