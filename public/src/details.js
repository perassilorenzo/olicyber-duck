/** Drawer dei dettagli: nessuna terza colonna permanente, la chat resta disponibile. */

import { byId, toast } from './utils.js';

const STATUS_LABELS = { todo: 'Da fare', 'in-progress': 'In corso', completed: 'Completata' };
const NEXT_STATUS = { todo: 'in-progress', 'in-progress': 'completed', completed: 'todo' };
const NEXT_LABEL = { todo: 'Segna in corso', 'in-progress': 'Segna completata', completed: 'Ricomincia' };

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function link(url, label) {
  const anchor = element('a', null, label);
  anchor.href = url;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  return anchor;
}

export function createDetails({ store, getChallenge, onAsk }) {
  const drawer = byId('details-drawer');
  const layer = byId('drawer-layer');
  const body = byId('details-body');
  const close = byId('close-details');
  const backdrop = byId('details-backdrop');
  let lastFocus = null;

  function section(title) {
    const wrap = element('section', 'detail-section');
    wrap.append(element('h4', 'detail-section__title', title));
    return wrap;
  }

  function fact(label, value) {
    const row = element('div', 'resource-row');
    row.append(element('strong', null, label), element('span', null, value));
    return row;
  }

  function render() {
    const challenge = getChallenge();
    body.replaceChildren();
    if (!challenge) {
      closeDrawer();
      return;
    }
    byId('details-title').textContent = challenge.title;

    const badges = element('div', 'badges');
    for (const key of ['category', 'difficulty', 'edition', 'path']) {
      if (challenge[key]) badges.append(element('span', key === 'difficulty' ? 'tag tag--difficulty' : 'tag', challenge[key]));
    }
    const top = element('div', 'challenge-detail__top');
    top.append(badges);
    if (challenge.demo) top.append(element('span', 'demo-tag', 'DEMO'));
    body.append(top);
    body.append(element('h3', 'challenge-detail__title', challenge.title));
    if (challenge.description) body.append(element('p', 'challenge-detail__description', challenge.description));

    const status = store.getStatus(challenge.id);
    const statusBar = element('div', 'status-bar');
    const info = element('div', 'status-bar__info');
    const dot = element('span', 'status-dot');
    dot.dataset.status = status;
    dot.setAttribute('aria-hidden', 'true');
    info.append(dot, element('span', null, `Stato: ${STATUS_LABELS[status]}`));
    const cycle = element('button', 'btn btn--outline btn--sm', NEXT_LABEL[status]);
    cycle.type = 'button';
    cycle.addEventListener('click', () => {
      const next = NEXT_STATUS[store.getStatus(challenge.id)] || 'todo';
      store.setStatus(challenge.id, next);
      toast(`Stato aggiornato: ${STATUS_LABELS[next]}.`);
    });
    statusBar.append(info, cycle);
    body.append(statusBar);

    const statement = section('Testo della challenge');
    const text = element('div', 'prose statement-text', challenge.statement || 'Testo non disponibile nel catalogo.');
    statement.append(text);
    body.append(statement);

    if (challenge.tags.length) {
      const tags = section('Tag');
      const row = element('div', 'badges');
      for (const tag of challenge.tags) row.append(element('span', 'tag', tag));
      tags.append(row);
      body.append(tags);
    }

    const facts = section('Informazioni');
    const rows = [
      ['ID originale', challenge.originalId],
      ['Punteggio', challenge.score],
      ['Autore', challenge.author],
      ['Pubblicata', challenge.publishedAt],
      ['Stato sorgente', challenge.state],
      ['Disponibilità', challenge.available ? 'Disponibile' : 'Non disponibile'],
      ['Fonte', challenge.source || challenge.provenance?.source],
    ];
    let hasFacts = false;
    for (const [label, value] of rows) {
      if (value === null || value === undefined || value === '') continue;
      facts.append(fact(label, value));
      hasFacts = true;
    }
    if (hasFacts) body.append(facts);

    const resources = section('Fonti e allegati');
    let hasResources = false;
    if (challenge.sourceUrl) {
      const row = element('div', 'resource-row');
      row.append(element('strong', null, 'Challenge originale'), link(challenge.sourceUrl, 'Apri su OliCyber Training'));
      resources.append(row);
      hasResources = true;
    }
    for (const item of challenge.attachments) {
      if (!item.name || !item.url) continue;
      const row = element('div', 'resource-row');
      row.append(element('strong', null, 'Allegato'), link(item.url, item.name));
      resources.append(row);
      hasResources = true;
    }
    const provenanceUrl = challenge.provenance?.sourceUrl;
    if (provenanceUrl) {
      const row = element('div', 'resource-row');
      row.append(element('strong', null, 'Provenienza'), link(provenanceUrl, 'Fonte del record'));
      resources.append(row);
      hasResources = true;
    }
    if (!hasResources) resources.append(element('p', 'settings-note', 'Nessun link o allegato disponibile nel catalogo.'));
    body.append(resources);

    const ask = element('button', 'btn btn--primary btn--sm', 'Chiedi a OliDuck');
    ask.type = 'button';
    ask.addEventListener('click', () => { closeDrawer(); onAsk?.(); });
    body.append(ask);
  }

  function openDrawer() {
    if (!drawer.classList.contains('is-open')) lastFocus = document.activeElement;
    layer.hidden = false;
    drawer.classList.add('is-open');
    drawer.setAttribute('aria-hidden', 'false');
    drawer.removeAttribute('inert');
    close.focus();
  }

  function closeDrawer() {
    if (!drawer.classList.contains('is-open')) return;
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    drawer.setAttribute('inert', '');
    layer.hidden = true;
    if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true });
    lastFocus = null;
  }

  close.addEventListener('click', closeDrawer);
  backdrop?.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && drawer.classList.contains('is-open')) closeDrawer();
  });
  drawer.setAttribute('aria-hidden', 'true');
  drawer.setAttribute('inert', '');
  render();

  return { render, open: openDrawer, close: closeDrawer, get isOpen() { return drawer.classList.contains('is-open'); } };
}
