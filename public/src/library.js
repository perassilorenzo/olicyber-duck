/** Challenge Library: ricerca, filtri, conteggio e selezione. */

import { byId } from './utils.js';
import { CATEGORIES, filterChallenges } from './catalog.js';

const STATUS_LABELS = { todo: 'Da fare', 'in-progress': 'In corso', completed: 'Completata' };

export function createLibrary({ store, challenges, onSelect }) {
  const list = byId('challenge-list');
  const count = byId('challenge-count');
  const search = byId('search-input');
  const category = byId('category-filter');
  const difficulty = byId('difficulty-filter');
  const filters = store.state.preferences.filters;

  for (const name of CATEGORIES) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    category.append(option);
  }
  search.value = filters.query;
  category.value = filters.category;
  difficulty.value = filters.difficulty;

  function itemNode(challenge) {
    const status = store.getStatus(challenge.id);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'challenge-item';
    button.setAttribute('role', 'listitem');
    button.classList.toggle('is-selected', store.state.selectedChallengeId === challenge.id);
    button.setAttribute('aria-pressed', String(store.state.selectedChallengeId === challenge.id));

    const title = document.createElement('span');
    title.className = 'challenge-item__title';
    title.textContent = challenge.title;
    if (challenge.demo) {
      const demo = document.createElement('span');
      demo.className = 'demo-tag';
      demo.textContent = 'DEMO';
      title.append(demo);
    }

    const meta = document.createElement('span');
    meta.className = 'challenge-item__meta';
    for (const [text, css] of [
      [challenge.category, 'tag'],
      [challenge.difficulty, 'tag tag--difficulty'],
    ]) {
      const tag = document.createElement('span');
      tag.className = css;
      tag.textContent = text;
      if (css.includes('difficulty')) tag.dataset.difficulty = challenge.difficulty;
      meta.append(tag);
    }

    const statusNode = document.createElement('span');
    statusNode.className = 'challenge-item__status';
    const dot = document.createElement('span');
    dot.className = 'status-dot';
    dot.dataset.status = status;
    dot.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = STATUS_LABELS[status];
    statusNode.append(dot, label);

    button.append(title, meta, statusNode);
    button.addEventListener('click', () => onSelect(challenge));
    return button;
  }

  function render() {
    const visible = filterChallenges(challenges, {
      query: search.value,
      category: category.value,
      difficulty: difficulty.value,
    });
    count.textContent = `${visible.length} challenge${visible.length === 1 ? '' : 's'}`;
    list.replaceChildren();
    if (!visible.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-list';
      empty.textContent = 'Nessuna challenge corrisponde ai filtri selezionati.';
      list.append(empty);
      return;
    }
    for (const challenge of visible) list.append(itemNode(challenge));
  }

  search.addEventListener('input', () => {
    store.setFilter('query', search.value);
    render();
  });
  category.addEventListener('change', () => {
    store.setFilter('category', category.value);
    render();
  });
  difficulty.addEventListener('change', () => {
    store.setFilter('difficulty', difficulty.value);
    render();
  });

  function syncFilters() {
    const current = store.state.preferences.filters;
    search.value = current.query;
    category.value = current.category;
    difficulty.value = current.difficulty;
  }

  return { render, syncFilters };
}
