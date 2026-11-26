/** Libreria v2: card compatte in ordine dataset, filtri derivati e navigazione da tastiera. */

import { byId } from './utils.js';
import { challengeProvenance } from './provenance.js';
import {
  DEFAULT_SORT, SORT_OPTIONS, deriveFacets, filterChallenges, sortChallenges,
} from './catalog.js';

const STATUS_LABELS = { todo: 'Da fare', 'in-progress': 'In corso', completed: 'Completata' };

/** Altezza di una card più il margine: usata dalla lista virtualizzata. */
export const ROW_HEIGHT = 132;
const OVERSCAN = 4;

const DEFAULT_FILTERS = {
  query: '', category: 'all', difficulty: 'all', edition: 'all',
  path: 'all', tag: 'all', status: 'all', sort: DEFAULT_SORT,
};

const STATE_LABELS = {
  online: 'Online',
  'non disponibile': 'Non disponibile',
};

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
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

function stateLabel(state) {
  return STATE_LABELS[state.toLocaleLowerCase('it')] || state;
}

function detailRow(label, value, className = 'challenge-item__extras-item') {
  const row = node('span', className);
  row.append(node('span', 'challenge-item__extras-label', label), node('span', null, value));
  return row;
}

export function createLibrary({ store, challenges, onSelect, onOpenDetails }) {
  const list = byId('challenge-list');
  const items = byId('challenge-items');
  const count = byId('challenge-count');
  const search = byId('search-input');
  const selects = {
    category: byId('category-filter'),
    difficulty: byId('difficulty-filter'),
    edition: byId('edition-filter'),
    path: byId('path-filter'),
    tag: byId('tag-filter'),
    status: byId('status-filter'),
    sort: byId('sort-filter'),
  };
  const facets = deriveFacets(challenges);
  let visible = [];
  let focusIndex = 0;

  function fillSelect(select, values, allLabel) {
    select.replaceChildren(node('option', null, allLabel));
    select.firstChild.value = 'all';
    for (const value of values) {
      const option = node('option', null, value);
      option.value = value;
      select.append(option);
    }
    const wrapper = select.closest('.field');
    if (wrapper) wrapper.hidden = values.length === 0;
  }

  fillSelect(selects.category, facets.categories, 'Tutte');
  fillSelect(selects.difficulty, facets.difficulties, 'Tutte');
  fillSelect(selects.edition, facets.editions, 'Tutte');
  fillSelect(selects.path, facets.paths, 'Tutti');
  fillSelect(selects.tag, facets.tags, 'Tutti');
  selects.sort.replaceChildren();
  for (const option of SORT_OPTIONS) {
    const element = node('option', null, option.label);
    element.value = option.value;
    selects.sort.append(element);
  }

  function isAllowedFilter(key, value) {
    return key === 'sort'
      ? SORT_OPTIONS.some((option) => option.value === value)
      : [...selects[key].options].some((option) => option.value === value);
  }

  function syncFilterControls() {
    const current = store.state.preferences.filters;
    search.value = current.query || '';
    for (const key of Object.keys(selects)) {
      selects[key].value = isAllowedFilter(key, current[key])
        ? current[key]
        : DEFAULT_FILTERS[key];
    }
  }

  /** Allinea i filtri persistiti alle facet effettive, dopo che la libreria è pronta. */
  function correctFilters() {
    const current = store.state.preferences.filters;
    const corrections = {};
    for (const key of Object.keys(selects)) {
      if (!isAllowedFilter(key, current[key])) corrections[key] = DEFAULT_FILTERS[key];
    }
    if (Object.keys(corrections).length) {
      store.update((draft) => { Object.assign(draft.preferences.filters, corrections); });
    }
  }

  function currentFilters() {
    return Object.fromEntries([
      ['query', search.value],
      ...Object.entries(selects).map(([key, select]) => [key, select.value]),
    ]);
  }

  function itemNode(challenge, index) {
    const status = store.getStatus(challenge.id);
    const selected = store.state.selectedChallengeId === challenge.id;
    const provenance = challengeProvenance(challenge);
    const wrapper = node('article', 'challenge-item');
    wrapper.dataset.id = challenge.id;
    wrapper.dataset.index = String(index);
    wrapper.setAttribute('role', 'listitem');
    wrapper.setAttribute('aria-posinset', String(index + 1));
    wrapper.setAttribute('aria-setsize', String(visible.length));
    wrapper.classList.toggle('is-selected', selected);
    wrapper.style.top = `${index * ROW_HEIGHT}px`;

    const main = node('button', 'challenge-item__main');
    main.type = 'button';
    main.setAttribute('aria-label', `Apri i dettagli di ${challenge.title}`);
    main.addEventListener('click', () => onOpenDetails(challenge));

    const head = node('span', 'challenge-item__head');
    head.append(node('span', 'challenge-item__number', `#${itemNumber(challenge)}`));
    head.append(node('span', 'challenge-item__title', challenge.title));
    head.append(node(
      'span',
      `provenance-badge provenance-badge--${provenance.kind}`,
      provenance.label,
    ));
    main.append(head);

    const meta = node('span', 'challenge-item__meta');
    if (challenge.category) meta.append(node('span', 'tag tag--category', challenge.category));
    if (challenge.difficulty) {
      const tag = node('span', 'tag tag--difficulty', challenge.difficulty);
      tag.dataset.difficulty = challenge.difficulty;
      meta.append(tag);
    }
    for (const tag of (challenge.tags || []).slice(0, 2)) meta.append(node('span', 'tag', tag));
    if ((challenge.tags || []).length > 2) {
      meta.append(node('span', 'challenge-item__detail', `+${challenge.tags.length - 2}`));
    }
    if (challenge.score !== null && challenge.score !== undefined) {
      meta.append(node('span', 'challenge-item__score', `${challenge.score} pt`));
    }
    const sourceState = reliableState(challenge);
    if (sourceState) {
      const state = node('span', 'challenge-item__state', stateLabel(sourceState));
      state.dataset.available = String(sourceAvailable(challenge));
      meta.append(state);
    }
    const statusNode = node('span', 'challenge-item__status');
    const dot = node('span', 'status-dot');
    dot.dataset.status = status;
    dot.setAttribute('aria-hidden', 'true');
    statusNode.append(dot, node('span', null, STATUS_LABELS[status]));
    meta.append(statusNode);
    main.append(meta);

    const description = challenge.description || challenge.statement;
    if (description) main.append(node('span', 'challenge-item__description', description));

    const extras = node('span', 'challenge-item__extras');
    if (Number.isFinite(challenge.metadata?.solves)) {
      extras.append(detailRow('Risolte', new Intl.NumberFormat('it-IT').format(challenge.metadata.solves)));
    }
    if (challenge.author) extras.append(detailRow('Autore', challenge.author));
    const attachments = Array.isArray(challenge.attachments) ? challenge.attachments.length : 0;
    if (attachments) extras.append(detailRow('Allegati', attachments));
    if (challenge.edition) extras.append(detailRow('Edizione', challenge.edition));
    if (challenge.path) extras.append(detailRow('Percorso', challenge.path));
    if (extras.childElementCount) main.append(extras);

    const chat = node('button', 'challenge-item__chat', 'Chat');
    chat.type = 'button';
    chat.setAttribute('aria-pressed', String(selected));
    chat.setAttribute('aria-label', `Apri la chat di ${challenge.title}`);
    chat.addEventListener('click', () => onSelect(challenge));

    wrapper.append(main, chat);
    return wrapper;
  }

  function activeRowInfo() {
    const active = document.activeElement;
    const row = active?.closest?.('.challenge-item');
    if (!row) return null;
    return {
      id: row.dataset.id,
      part: active.classList.contains('challenge-item__chat') ? 'chat' : 'main',
    };
  }

  function clearFilters() {
    store.update((draft) => { draft.preferences.filters = { ...DEFAULT_FILTERS }; });
  }

  function paint() {
    const height = list.clientHeight || 0;
    const canVirtualize = height > 0 && visible.length > Math.ceil(height / ROW_HEIGHT) + OVERSCAN * 2;
    let first = 0;
    let last = visible.length;
    if (canVirtualize) {
      first = Math.max(0, Math.floor(list.scrollTop / ROW_HEIGHT) - OVERSCAN);
      last = Math.min(visible.length, Math.ceil((list.scrollTop + height) / ROW_HEIGHT) + OVERSCAN);
    }
    const active = activeRowInfo();
    items.style.height = `${visible.length * ROW_HEIGHT}px`;
    items.replaceChildren(...visible.slice(first, last).map((challenge, offset) => itemNode(challenge, first + offset)));

    if (!visible.length) {
      items.style.height = 'auto';
      const empty = node('div', 'empty-list');
      empty.append(
        node('p', 'empty-list__title', 'Nessuna challenge corrisponde ai filtri selezionati.'),
        node('p', 'empty-list__hint', 'Prova a cambiare ricerca, categoria o tag.'),
      );
      const reset = node('button', 'btn btn--outline btn--sm', 'Azzera filtri');
      reset.type = 'button';
      reset.addEventListener('click', clearFilters);
      empty.append(reset);
      items.append(empty);
      return;
    }

    if (active) {
      const row = [...items.children].find((element) => element.dataset.id === active.id);
      const selector = active.part === 'chat' ? '.challenge-item__chat' : '.challenge-item__main';
      row?.querySelector(selector)?.focus({ preventScroll: true });
    }
  }

  function render({ resetScroll = false } = {}) {
    const previousScroll = list.scrollTop;
    visible = sortChallenges(filterChallenges(
      challenges, currentFilters(), (id) => store.getStatus(id),
    ), selects.sort.value);
    const orderLabel = selects.sort.value === DEFAULT_SORT ? ' · ordine del catalogo' : '';
    count.textContent = `${visible.length} challenge${visible.length === 1 ? '' : 's'}${orderLabel}`;

    items.style.height = `${visible.length * ROW_HEIGHT}px`;
    const maxScroll = Math.max(0, visible.length * ROW_HEIGHT - (list.clientHeight || 0));
    list.scrollTop = resetScroll ? 0 : Math.min(previousScroll, maxScroll);
    paint();
  }

  function focusItem(index) {
    if (!visible.length) return;
    focusIndex = Math.min(visible.length - 1, Math.max(0, index));
    const top = focusIndex * ROW_HEIGHT;
    const bottom = top + ROW_HEIGHT;
    const height = list.clientHeight || 0;
    if (height > 0 && top < list.scrollTop) list.scrollTop = top;
    else if (height > 0 && bottom > list.scrollTop + height) list.scrollTop = bottom - height;
    paint();
    const row = [...items.children].find((element) => Number(element.dataset.index) === focusIndex);
    row?.querySelector('.challenge-item__main')?.focus({ preventScroll: true });
  }

  search.addEventListener('input', () => {
    store.setFilter('query', search.value);
  });
  for (const [key, select] of Object.entries(selects)) {
    select.addEventListener('change', () => {
      store.setFilter(key, select.value);
    });
  }
  list.addEventListener('keydown', (event) => {
    if (!visible.length) return;
    const row = event.target.closest?.('.challenge-item');
    const currentIndex = row ? Number(row.dataset.index) : -1;
    let next = null;
    if (event.key === 'ArrowDown') next = currentIndex + 1;
    else if (event.key === 'ArrowUp') next = currentIndex < 0 ? visible.length - 1 : currentIndex - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = visible.length - 1;
    else return;
    event.preventDefault();
    focusItem(next);
  });
  list.addEventListener('scroll', paint, { passive: true });
  byId('clear-filters').addEventListener('click', clearFilters);

  syncFilterControls();
  render();

  return {
    render,
    correctFilters,
    syncFilters() {
      syncFilterControls();
      render({ resetScroll: true });
    },
    get visible() { return [...visible]; },
  };
}
