/** Challenge Library v2: filtri derivati dai dati, ordinamento, selezione e lista virtualizzata. */

import { byId } from './utils.js';
import {
  SORT_OPTIONS, deriveFacets, filterChallenges, sortChallenges,
} from './catalog.js';

const STATUS_LABELS = { todo: 'Da fare', 'in-progress': 'In corso', completed: 'Completata' };
const ROW_HEIGHT = 96;
const OVERSCAN = 4;

const DEFAULT_FILTERS = {
  query: '', category: 'all', difficulty: 'all', edition: 'all',
  path: 'all', status: 'all', sort: 'title-asc',
};

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
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
    status: byId('status-filter'),
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
  }

  fillSelect(selects.category, facets.categories, 'Tutte');
  fillSelect(selects.difficulty, facets.difficulties, 'Tutte');
  fillSelect(selects.edition, facets.editions, 'Tutte');
  fillSelect(selects.path, facets.paths, 'Tutti');
  for (const option of SORT_OPTIONS) {
    const element = node('option', null, option.label);
    element.value = option.value;
    selects.sort.append(element);
  }

  function syncFilters() {
    const current = store.state.preferences.filters;
    search.value = current.query || '';
    for (const key of Object.keys(selects)) {
      const allowed = key === 'sort'
        ? SORT_OPTIONS.some((option) => option.value === current.sort)
        : [...selects[key].options].some((option) => option.value === current[key]);
      selects[key].value = allowed ? current[key] : DEFAULT_FILTERS[key];
      if (!allowed && current[key] !== DEFAULT_FILTERS[key]) store.setFilter(key, DEFAULT_FILTERS[key]);
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
    const wrapper = node('div', 'challenge-item');
    wrapper.dataset.id = challenge.id;
    wrapper.setAttribute('role', 'listitem');
    wrapper.setAttribute('aria-posinset', String(index + 1));
    wrapper.setAttribute('aria-setsize', String(visible.length));
    wrapper.classList.toggle('is-selected', selected);
    wrapper.style.top = `${index * ROW_HEIGHT}px`;

    const main = node('button', 'challenge-item__main');
    main.type = 'button';
    main.setAttribute('aria-pressed', String(selected));
    main.append(node('span', 'challenge-item__title', challenge.title));

    if (challenge.demo) main.append(node('span', 'demo-tag', 'DEMO'));

    const meta = node('span', 'challenge-item__meta');
    if (challenge.category) meta.append(node('span', 'tag', challenge.category));
    if (challenge.difficulty) {
      const tag = node('span', 'tag tag--difficulty', challenge.difficulty);
      tag.dataset.difficulty = challenge.difficulty;
      meta.append(tag);
    }
    if (challenge.edition) meta.append(node('span', 'challenge-item__detail', challenge.edition));
    if (challenge.path) meta.append(node('span', 'challenge-item__detail', challenge.path));
    if (challenge.score !== null && challenge.score !== undefined) {
      meta.append(node('span', 'challenge-item__detail', `${challenge.score} pt`));
    }
    main.append(meta);

    const statusNode = node('span', 'challenge-item__status');
    const dot = node('span', 'status-dot');
    dot.dataset.status = status;
    dot.setAttribute('aria-hidden', 'true');
    statusNode.append(dot, node('span', null, STATUS_LABELS[status]));
    main.append(statusNode);
    main.addEventListener('click', () => onSelect(challenge));

    const details = node('button', 'challenge-item__details', 'Dettagli');
    details.type = 'button';
    details.setAttribute('aria-label', `Apri i dettagli di ${challenge.title}`);
    details.addEventListener('click', () => onOpenDetails(challenge));

    wrapper.append(main, details);
    return wrapper;
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
    items.style.height = `${visible.length * ROW_HEIGHT}px`;
    items.replaceChildren(...visible.slice(first, last).map((challenge, offset) => itemNode(challenge, first + offset)));

    if (!visible.length) {
      items.style.height = 'auto';
      items.append(node('p', 'empty-list', 'Nessuna challenge corrisponde ai filtri selezionati.'));
    }
  }

  function render() {
    visible = sortChallenges(filterChallenges(
      challenges, currentFilters(), (id) => store.getStatus(id),
    ), selects.sort.value);
    count.textContent = `${visible.length} challenge${visible.length === 1 ? '' : 's'}`;
    list.scrollTop = 0;
    paint();
  }

  search.addEventListener('input', () => {
    store.setFilter('query', search.value);
    render();
  });
  for (const [key, select] of Object.entries(selects)) {
    select.addEventListener('change', () => {
      store.setFilter(key, select.value);
      render();
    });
  }
  list.addEventListener('scroll', paint, { passive: true });
  byId('clear-filters').addEventListener('click', () => {
    store.update((draft) => { draft.preferences.filters = { ...DEFAULT_FILTERS }; });
    syncFilters();
    render();
  });

  syncFilters();
  render();

  return {
    render,
    syncFilters() { syncFilters(); render(); },
    get visible() { return [...visible]; },
  };
}
