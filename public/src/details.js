/** Drawer dei dettagli: nessuna terza colonna permanente, la chat resta disponibile. */

import { byId, toast } from './utils.js';
import { safeHttpsUrl } from './url.js';
import { challengeProvenance } from './provenance.js';

const STATUS_LABELS = { todo: 'Da fare', 'in-progress': 'In corso', completed: 'Completata' };
const NEXT_STATUS = { todo: 'in-progress', 'in-progress': 'completed', completed: 'todo' };
const NEXT_LABEL = { todo: 'Segna in corso', 'in-progress': 'Segna completata', completed: 'Ricomincia' };
const ATTACHMENT_LABELS = {
  text: 'Testo', binary: 'Binario', error: 'Errore', unknown: 'Sconosciuto',
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function link(url, label) {
  const safeUrl = safeHttpsUrl(url);
  if (!safeUrl) return element('span', 'resource-row__text', `${label} (URL non disponibile)`);
  const anchor = element('a', null, label);
  anchor.href = safeUrl;
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
  const background = [...document.body.children].filter((element) => element !== layer && element.id !== 'toast');
  let lastFocus = null;

  function setBackgroundInert(value) {
    for (const element of background) {
      if (value) element.setAttribute('inert', '');
      else element.removeAttribute('inert');
    }
  }

  function focusableInDrawer() {
    return [...drawer.querySelectorAll('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')]
      .filter((element) => element.isConnected && !element.hasAttribute('inert'));
  }

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
    const restoreStatusFocus = document.activeElement?.id === 'cycle-status';
    body.replaceChildren();
    if (!challenge) {
      closeDrawer();
      return;
    }
    byId('details-title').textContent = challenge.title;
    const provenance = challengeProvenance(challenge);

    const badges = element('div', 'badges');
    for (const key of ['category', 'difficulty', 'edition', 'path']) {
      if (challenge[key]) badges.append(element('span', key === 'difficulty' ? 'tag tag--difficulty' : 'tag', challenge[key]));
    }
    const top = element('div', 'challenge-detail__top');
    top.append(badges);
    top.append(element(
      'span',
      `provenance-badge provenance-badge--${provenance.kind}`,
      provenance.label,
    ));
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
    cycle.id = 'cycle-status';
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

    const hints = Array.isArray(challenge.metadata?.hints)
      ? challenge.metadata.hints.filter((hint) => typeof hint === 'string' && hint.trim())
      : [];
    if (hints.length) {
      const hintSection = section('Hint disponibili');
      const list = element('ul', 'hint-list');
      for (const hint of hints) list.append(element('li', null, hint));
      hintSection.append(list);
      body.append(hintSection);
    }

    if (challenge.tags.length) {
      const tags = section('Tag');
      const row = element('div', 'badges');
      for (const tag of challenge.tags) row.append(element('span', 'tag', tag));
      tags.append(row);
      body.append(tags);
    }

    const facts = section('Informazioni');
    const rows = [
      ['Provenienza', provenance.label],
      ['ID catalogo', challenge.id],
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
    for (const item of challenge.attachments || []) {
      if (!item || !item.name) continue;
      const row = element('div', 'resource-row attachment-row');
      const label = element('span', 'attachment-row__label');
      label.append(
        element('strong', null, 'Allegato'),
        element(
          'span',
          `attachment-kind attachment-kind--${item.kind || 'unknown'}`,
          ATTACHMENT_LABELS[item.kind] || ATTACHMENT_LABELS.unknown,
        ),
      );
      const name = item.url
        ? link(item.url, item.name)
        : element('span', 'resource-row__text', `${item.name} (URL non disponibile)`);
      row.append(label, name);
      resources.append(row);
      if (item.error) {
        resources.append(element('p', 'attachment-note', `Errore durante l'importazione: ${item.error}`));
      }
      if (item.kind === 'text' && item.preview) {
        resources.append(element('pre', 'attachment-preview', item.preview));
      }
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
    ask.id = 'ask-from-details';
    ask.type = 'button';
    ask.addEventListener('click', () => { closeDrawer(); onAsk?.(); });
    body.append(ask);
    if (restoreStatusFocus) cycle.focus({ preventScroll: true });
  }

  function openDrawer() {
    if (!drawer.classList.contains('is-open')) lastFocus = document.activeElement;
    layer.hidden = false;
    drawer.classList.add('is-open');
    drawer.setAttribute('aria-hidden', 'false');
    drawer.removeAttribute('inert');
    setBackgroundInert(true);
    close.focus();
  }

  function closeDrawer() {
    if (!drawer.classList.contains('is-open')) return;
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    drawer.setAttribute('inert', '');
    layer.hidden = true;
    setBackgroundInert(false);
    if (lastFocus?.isConnected) lastFocus.focus({ preventScroll: true });
    lastFocus = null;
  }

  close.addEventListener('click', closeDrawer);
  backdrop?.addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (event) => {
    if (!drawer.classList.contains('is-open')) return;
    if (event.key === 'Escape') {
      closeDrawer();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = focusableInDrawer();
    if (!focusable.length) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const inside = drawer.contains(document.activeElement);
    if (event.shiftKey && (!inside || document.activeElement === first)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (!inside || document.activeElement === last)) {
      event.preventDefault();
      first.focus();
    }
  });
  drawer.setAttribute('aria-hidden', 'true');
  drawer.setAttribute('inert', '');
  render();

  return { render, open: openDrawer, close: closeDrawer, get isOpen() { return drawer.classList.contains('is-open'); } };
}
