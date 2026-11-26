/** Drawer dei dettagli: testo completo, struttura chiara e nessun campo vuoto. */

import { byId, toast } from './utils.js';
import { safeHttpsUrl } from './url.js';
import { challengeProvenance } from './provenance.js';

const STATUS_LABELS = { todo: 'Da fare', 'in-progress': 'In corso', completed: 'Completata' };
const NEXT_STATUS = { todo: 'in-progress', 'in-progress': 'completed', completed: 'todo' };
const NEXT_LABEL = { todo: 'Segna in corso', 'in-progress': 'Segna completata', completed: 'Ricomincia' };
const ATTACHMENT_LABELS = {
  text: 'Testo', binary: 'Binario', error: 'Errore', unknown: 'Sconosciuto',
};
const STATE_LABELS = {
  online: 'Online',
  'non disponibile': 'Non disponibile',
};

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== '';
}

/** Formatta in sicurezza backtick e link HTTPS senza usare innerHTML. */
function appendFormattedText(container, text) {
  const source = String(text || '');
  const pattern = /(`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;
  let cursor = 0;
  for (const match of source.matchAll(pattern)) {
    if (match.index > cursor) container.append(document.createTextNode(source.slice(cursor, match.index)));
    const token = match[0];
    if (token.startsWith('`') && token.endsWith('`')) {
      container.append(element('code', null, token.slice(1, -1)));
    } else {
      const parts = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
      const url = parts && safeHttpsUrl(parts[2]);
      if (url) {
        const anchor = element('a', null, parts[1]);
        anchor.href = url;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        container.append(anchor);
      } else {
        container.append(document.createTextNode(token));
      }
    }
    cursor = match.index + token.length;
  }
  if (cursor < source.length) container.append(document.createTextNode(source.slice(cursor)));
  return container;
}

function formattedText(className, text) {
  return appendFormattedText(element('div', className), text);
}

function compact(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/** Evita di ripetere la descrizione quando lo statement è solo descrizione + allegati/hint. */
function extraStatement(description, statement) {
  const descriptionText = compact(description);
  const statementText = compact(statement);
  if (!statementText || statementText === descriptionText) return null;
  if (statementText.startsWith(descriptionText)) {
    const extra = statementText.slice(descriptionText.length).trim();
    if (!extra) return null;
    if (/^(?:(?:Hint|Allegati):[\s\S]*?)(?:\s+(?:Hint|Allegati):[\s\S]*?)*$/i.test(extra)) return null;
  }
  return statement;
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

function itemNumber(challenge) {
  if (challenge.originalId !== null && challenge.originalId !== undefined) return String(challenge.originalId);
  return String(challenge.id || '').replace(/^olicyber-/, '');
}

function reliableState(challenge) {
  if (typeof challenge.state === 'string' && challenge.state.trim()) return challenge.state.trim();
  if (challenge.available === false) return 'non disponibile';
  return null;
}

function sourceAvailable(challenge) {
  const state = reliableState(challenge);
  return state ? state.toLocaleLowerCase('it') !== 'non disponibile' : challenge.available !== false;
}

function listedMetadata(value) {
  return Array.isArray(value) && value.length ? value.filter((item) => typeof item === 'string' && item.trim()).join(', ') : null;
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
    const sourceState = reliableState(challenge);

    const badges = element('div', 'badges');
    if (challenge.category) badges.append(element('span', 'tag tag--category', challenge.category));
    if (challenge.difficulty) {
      const tag = element('span', 'tag tag--difficulty', challenge.difficulty);
      tag.dataset.difficulty = challenge.difficulty;
      badges.append(tag);
    }
    if (hasValue(challenge.score)) badges.append(element('span', 'tag tag--score', `${challenge.score} pt`));
    if (sourceState) {
      const state = element('span', 'tag tag--state', STATE_LABELS[sourceState.toLocaleLowerCase('it')] || sourceState);
      state.dataset.available = String(sourceAvailable(challenge));
      badges.append(state);
    }
    const top = element('div', 'challenge-detail__top');
    top.append(badges);
    top.append(element(
      'span',
      `provenance-badge provenance-badge--${provenance.kind}`,
      provenance.label,
    ));
    body.append(top);

    const identity = element('div', 'challenge-detail__identity');
    identity.append(element('span', 'challenge-detail__number', `#${itemNumber(challenge)}`));
    identity.append(element('span', 'challenge-detail__id', challenge.id));
    body.append(identity);
    body.append(element('h3', 'challenge-detail__title', challenge.title));

    const statement = extraStatement(challenge.description, challenge.statement);
    if (challenge.description) {
      body.append(formattedText('challenge-detail__description prose', challenge.description));
    } else if (challenge.statement) {
      body.append(formattedText('challenge-detail__description prose', challenge.statement));
    }
    if (!challenge.description && !challenge.statement) {
      body.append(element('p', 'detail-note', 'Testo non disponibile nel catalogo.'));
    }

    const status = store.getStatus(challenge.id);
    const statusBar = element('div', 'status-bar');
    const info = element('div', 'status-bar__info');
    const dot = element('span', 'status-dot');
    dot.dataset.status = status;
    dot.setAttribute('aria-hidden', 'true');
    info.append(dot, element('span', null, `Stato personale: ${STATUS_LABELS[status]}`));
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

    if (statement) {
      const statementSection = section('Testo completo della challenge');
      statementSection.append(formattedText('prose statement-text', statement));
      body.append(statementSection);
    }

    const hints = Array.isArray(challenge.metadata?.hints)
      ? challenge.metadata.hints.filter((hint) => typeof hint === 'string' && hint.trim())
      : [];
    if (hints.length) {
      const hintSection = section('Hint disponibili');
      const list = element('ul', 'hint-list');
      for (const hint of hints) {
        const item = element('li');
        appendFormattedText(item, hint);
        list.append(item);
      }
      hintSection.append(list);
      body.append(hintSection);
    }

    const tags = Array.isArray(challenge.tags) ? challenge.tags.filter((tag) => typeof tag === 'string' && tag.trim()) : [];
    if (tags.length) {
      const tagsSection = section('Tag');
      const row = element('div', 'badges');
      for (const tag of tags) row.append(element('span', 'tag', tag));
      tagsSection.append(row);
      body.append(tagsSection);
    }

    const rows = [
      ['ID catalogo', challenge.id],
      ['ID originale', challenge.originalId],
      ['Categoria', challenge.category],
      ['Difficoltà', challenge.difficulty],
      ['Punteggio', challenge.score],
      ['Autore', challenge.author],
      ['Risoluzioni', challenge.metadata?.solves],
      ['Argomenti hint', listedMetadata(challenge.metadata?.hintTopics)],
      ['Obiettivi apprendimento', listedMetadata(challenge.metadata?.learningGoals)],
      ['Allegati registrati', challenge.metadata?.attachmentCount],
      ['Edizione', challenge.edition],
      ['Percorso', challenge.path],
      ['Pubblicata', challenge.publishedAt],
      ['Stato sorgente', sourceState ? STATE_LABELS[sourceState.toLocaleLowerCase('it')] || sourceState : null],
      ['Disponibilità', challenge.available === false ? 'Non disponibile' : null],
      ['Provenienza', provenance.label],
      ['Fonte', challenge.source || challenge.provenance?.source],
      ['Importata il', challenge.metadata?.importedAt],
    ];
    const facts = section('Informazioni');
    let hasFacts = false;
    for (const [label, value] of rows) {
      if (!hasValue(value)) continue;
      facts.append(fact(label, value));
      hasFacts = true;
    }
    if (hasFacts) body.append(facts);

    const attachments = Array.isArray(challenge.attachments)
      ? challenge.attachments.filter((item) => item && typeof item === 'object' && !Array.isArray(item))
      : [];
    if (attachments.length || challenge.sourceUrl || challenge.provenance?.sourceUrl) {
      const resources = section('Fonti e allegati');
      if (challenge.sourceUrl) {
        const row = element('div', 'resource-row');
        row.append(element('strong', null, 'Challenge originale'), link(challenge.sourceUrl, 'Apri su OliCyber Training'));
        resources.append(row);
      }
      for (const item of attachments) {
        if (!item.name) continue;
        const row = element('div', 'resource-row attachment-row');
        const label = element('span', 'attachment-row__label');
        label.append(element('strong', null, 'Allegato'));
        label.append(element(
          'span',
          `attachment-kind attachment-kind--${item.kind || 'unknown'}`,
          ATTACHMENT_LABELS[item.kind] || ATTACHMENT_LABELS.unknown,
        ));
        if (hasValue(item.size)) label.append(element('span', 'challenge-item__detail', `${item.size} B`));
        const name = item.url
          ? link(item.url, item.name)
          : element('span', 'resource-row__text', item.name);
        row.append(label, name);
        resources.append(row);
        if (item.error) {
          resources.append(element('p', 'attachment-note', `Errore durante l'importazione: ${item.error}`));
        }
        if (item.kind === 'text' && item.preview) {
          resources.append(element('pre', 'attachment-preview', item.preview));
        }
      }
      const provenanceUrl = challenge.provenance?.sourceUrl;
      if (provenanceUrl) {
        const row = element('div', 'resource-row');
        row.append(element('strong', null, 'Provenienza'), link(provenanceUrl, 'Fonte del record'));
        resources.append(row);
      }
      body.append(resources);
    }

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
