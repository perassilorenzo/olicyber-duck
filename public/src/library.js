/** Dashboard CTF: categorie reali, card compatte, filtri derivati e preferiti. */

import { byId, toast } from './utils.js';
import { MAX_SELECTED_CHALLENGES } from './store.js';
import { challengeProvenance } from './provenance.js';
import {
  DEFAULT_SORT, SORT_OPTIONS, deriveFacets, filterChallenges, sortChallenges,
} from './catalog.js';

const STATUS_LABELS = { todo: 'Da fare', 'in-progress': 'In corso', completed: 'Risolta' };
const CTF_STATUS = { todo: 'unsolved', 'in-progress': 'in-progress', completed: 'solved' };

/** Altezza indicativa usata solo per lo scroll da tastiera (nessuna virtualizzazione). */
export const ROW_HEIGHT = 168;

const DEFAULT_FILTERS = {
  query: '', category: 'all', difficulty: 'all', edition: 'all',
  path: 'all', tag: 'all', status: 'all', favorite: 'all', sort: DEFAULT_SORT,
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

function detailRow(label, value) {
  const row = node('span', 'challenge-item__extras-item');
  row.append(node('span', 'challenge-item__extras-label', label), node('span', null, value));
  return row;
}

export function createLibrary({ store, challenges, onSelect, onOpenDetails }) {
  const list = byId('challenge-list');
  const items = byId('challenge-items');
  const count = byId('challenge-count');
  const titleNumbers = byId('dashboard-title-numbers');
  const summary = byId('dashboard-summary');
  const search = byId('search-input');
  const selects = {
    category: byId('category-filter'),
    difficulty: byId('difficulty-filter'),
    edition: byId('edition-filter'),
    path: byId('path-filter'),
    tag: byId('tag-filter'),
    status: byId('status-filter'),
    favorite: byId('favorite-filter'),
    sort: byId('sort-filter'),
  };
  const facets = deriveFacets(challenges);
  let visible = [];

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
      selects[key].value = isAllowedFilter(key, current[key]) ? current[key] : DEFAULT_FILTERS[key];
    }
  }

  /** Allinea i filtri persistiti alle facet effettive, dopo la dashboard pronta. */
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
    const selected = store.getSelectedChallengeIds().includes(challenge.id);
    const favorite = store.isFavorite(challenge.id);
    const provenance = challengeProvenance(challenge);
    const wrapper = node('article', 'challenge-item ctf-card');
    wrapper.dataset.id = challenge.id;
    wrapper.dataset.index = String(index);
    wrapper.dataset.category = challenge.category || 'Altro';
    wrapper.setAttribute('role', 'listitem');
    wrapper.setAttribute('aria-posinset', String(index + 1));
    wrapper.setAttribute('aria-setsize', String(visible.length));
    wrapper.classList.toggle('is-selected', selected);

    const main = node('button', 'challenge-item__main');
    main.type = 'button';
    main.setAttribute('aria-label', `Apri i dettagli di ${challenge.title}`);
    main.addEventListener('click', () => onOpenDetails(challenge));

    const head = node('span', 'ctf-card__head');
    head.append(node('span', 'challenge-item__number', `#${itemNumber(challenge)}`));
    head.append(node('span', 'challenge-item__title', challenge.title));
    head.append(node(
      'span',
      `provenance-badge provenance-badge--${provenance.kind}`,
      provenance.label,
    ));
    main.append(head);

    const description = challenge.description || challenge.statement;
    if (description) main.append(node('span', 'ctf-card__description', description));

    const badges = node('span', 'ctf-card__badges');
    if (challenge.score !== null && challenge.score !== undefined) {
      badges.append(node('span', 'ctf-badge ctf-badge--points', `${challenge.score} pt`));
    }
    if (Number.isFinite(challenge.metadata?.solves)) {
      badges.append(node(
        'span', 'ctf-badge ctf-badge--solves',
        `${new Intl.NumberFormat('it-IT').format(challenge.metadata.solves)} risoluzioni`,
      ));
    }
    if (challenge.category) badges.append(node('span', 'ctf-tag ctf-tag--category', challenge.category));
    for (const tag of (challenge.tags || []).slice(0, 2)) badges.append(node('span', 'ctf-tag', tag));
    if ((challenge.tags || []).length > 2) {
      badges.append(node('span', 'ctf-card__more', `+${challenge.tags.length - 2}`));
    }
    main.append(badges);

    const extras = node('span', 'challenge-item__extras');
    if (challenge.author) extras.append(detailRow('Autore', challenge.author));
    const attachments = Array.isArray(challenge.attachments) ? challenge.attachments.length : 0;
    if (attachments) extras.append(detailRow('Allegati', attachments));
    if (challenge.edition) extras.append(detailRow('Edizione', challenge.edition));
    if (challenge.path) extras.append(detailRow('Percorso', challenge.path));
    if (extras.childElementCount) main.append(extras);
    wrapper.append(main);

    const actions = node('span', 'ctf-card__actions');
    const statusNode = node('span', 'ctf-status', STATUS_LABELS[status]);
    statusNode.dataset.status = CTF_STATUS[status];
    actions.append(statusNode);

    const buttons = node('span', 'ctf-card__buttons');
    const star = node('button', 'ctf-card__favorite', favorite ? '★' : '☆');
    star.type = 'button';
    star.setAttribute('aria-pressed', String(favorite));
    star.setAttribute('aria-label', favorite
      ? `Rimuovi ${challenge.title} dai preferiti`
      : `Aggiungi ${challenge.title} ai preferiti`);
    star.addEventListener('click', () => {
      store.toggleFavorite(challenge.id);
      render();
    });

    const chat = node('button', 'challenge-item__chat', 'Chat');
    chat.type = 'button';
    chat.setAttribute('aria-pressed', String(selected));
    chat.setAttribute(
      'aria-label',
      selected
        ? `Rimuovi ${challenge.title} dal contesto della chat`
        : `Aggiungi ${challenge.title} al contesto della chat`,
    );
    chat.addEventListener('click', () => {
      const ids = store.getSelectedChallengeIds();
      const isSelected = ids.includes(challenge.id);
      if (!isSelected && ids.length >= MAX_SELECTED_CHALLENGES) {
        toast(`Puoi selezionare al massimo ${MAX_SELECTED_CHALLENGES} challenge`);
        return;
      }
      const nowSelected = store.toggleChallengeSelection(challenge.id);
      onSelect?.(challenge, nowSelected);
    });
    buttons.append(star, chat);
    actions.append(buttons);
    wrapper.append(actions);
    return wrapper;
  }

  function clearFilters() {
    store.update((draft) => { draft.preferences.filters = { ...DEFAULT_FILTERS }; });
  }

  function renderNumbers() {
    const total = challenges.length;
    const categories = facets.categories.length || (total ? 1 : 0);
    if (titleNumbers) titleNumbers.textContent = `${total} challenge · ${categories} categorie`;
    if (!summary) return;
    let solved = 0;
    let inProgress = 0;
    for (const challenge of challenges) {
      const status = store.getStatus(challenge.id);
      if (status === 'completed') solved += 1;
      else if (status === 'in-progress') inProgress += 1;
    }
    summary.textContent = `${total} challenge · ${solved} risolte · ${inProgress} in corso · ${total - solved - inProgress} da fare`;
  }

  function categoryGroups() {
    const groups = new Map();
    visible.forEach((challenge, index) => {
      const name = challenge.category || 'Altro';
      if (!groups.has(name)) groups.set(name, { name, items: [] });
      groups.get(name).items.push({ challenge, index });
    });
    return [...groups.values()].sort((a, b) => (
      b.items.length - a.items.length || a.name.localeCompare(b.name, 'it', { sensitivity: 'base' })
    ));
  }

  function render({ resetScroll = false } = {}) {
    const previousScroll = list.scrollTop;
    visible = sortChallenges(filterChallenges(
      challenges, currentFilters(), (id) => store.getStatus(id), (id) => store.isFavorite(id),
    ), selects.sort.value);
    const orderLabel = selects.sort.value === DEFAULT_SORT ? ' · ordine del catalogo' : '';
    count.textContent = `${visible.length} challenge${visible.length === 1 ? '' : 's'}${orderLabel}`;
    renderNumbers();

    const groups = categoryGroups();
    const nodes = groups.map((group) => {
      const section = node('section', 'ctf-category');
      const header = node('header', 'ctf-category__header');
      header.append(node('h2', null, group.name));
      const solved = group.items.filter(({ challenge }) => store.getStatus(challenge.id) === 'completed').length;
      header.append(node(
        'span', 'ctf-category__count',
        `${group.items.length} challenge · ${solved} risolte`,
      ));
      section.append(header);
      const grid = node('div', 'ctf-grid');
      for (const { challenge, index } of group.items) grid.append(itemNode(challenge, index));
      section.append(grid);
      return section;
    });

    if (visible.length) {
      items.replaceChildren(...nodes);
    } else {
      const empty = node('div', 'empty-list');
      empty.append(
        node('p', 'empty-list__title', 'Nessuna challenge corrisponde ai filtri selezionati.'),
        node('p', 'empty-list__hint', 'Prova a cambiare ricerca, categoria o preferiti.'),
      );
      const reset = node('button', 'btn btn--outline btn--sm', 'Azzera filtri');
      reset.type = 'button';
      reset.addEventListener('click', clearFilters);
      empty.append(reset);
      items.replaceChildren(empty);
    }
    // Il browser applica i limiti reali di scrollHeight: qui non li calcoliamo,
    // così un aggiornamento di stato non riporta in alto la dashboard.
    list.scrollTop = resetScroll ? 0 : previousScroll;
  }

  function focusItem(index) {
    if (!visible.length) return;
    const next = Math.min(visible.length - 1, Math.max(0, index));
    const row = [...items.querySelectorAll('.challenge-item')]
      .find((element) => Number(element.dataset.index) === next);
    row?.querySelector('.challenge-item__main')?.focus({ preventScroll: true });
    const top = next * ROW_HEIGHT;
    const height = list.clientHeight || 0;
    if (height > 0 && top < list.scrollTop) list.scrollTop = top;
    else if (height > 0 && top + ROW_HEIGHT > list.scrollTop + height) list.scrollTop = top + ROW_HEIGHT - height;
  }

  search.addEventListener('input', () => store.setFilter('query', search.value));
  for (const [key, select] of Object.entries(selects)) {
    select.addEventListener('change', () => store.setFilter(key, select.value));
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
