/** Challenge Workspace: dettaglio della challenge selezionata e cambio di stato. */

import { byId, toast } from './utils.js';
import { icon } from './icons.js';

const STATUS_LABELS = { todo: 'Da fare', 'in-progress': 'In corso', completed: 'Completata' };
const NEXT_STATUS = { todo: 'in-progress', 'in-progress': 'completed', completed: 'todo' };
const NEXT_LABEL = {
  todo: 'Segna in corso',
  'in-progress': 'Segna completata',
  completed: 'Ricomincia',
};

function tag(text, className = 'tag') {
  const node = document.createElement('span');
  node.className = className;
  node.textContent = text;
  return node;
}

export function createWorkspace({ store, getChallenge }) {
  const empty = byId('challenge-empty');
  const detail = byId('challenge-detail');
  const badges = byId('detail-badges');
  const title = byId('detail-title');
  const description = byId('detail-description');
  const statement = byId('detail-statement');
  const goals = byId('detail-goals');
  const resources = byId('detail-resources');
  const statusLabel = byId('detail-status-label');
  const statusDot = byId('detail-status-dot');
  const cycle = byId('cycle-status');
  const demoTag = byId('detail-demo-tag');

  cycle.addEventListener('click', () => {
    const challenge = getChallenge();
    if (!challenge) return;
    const next = NEXT_STATUS[store.getStatus(challenge.id)] || 'todo';
    store.setStatus(challenge.id, next);
    toast(`Stato aggiornato: ${STATUS_LABELS[next]}.`);
    render();
  });

  function renderResources(challenge) {
    resources.replaceChildren();
    const rows = [];
    rows.push({ label: 'Fonte', value: challenge.source || 'Non indicata' });
    if (challenge.externalUrl) {
      rows.push({ label: 'Challenge originale', link: challenge.externalUrl, text: 'Apri il link esterno' });
    }
    if (Array.isArray(challenge.attachments)) {
      for (const item of challenge.attachments) {
        if (item?.name && item?.url) {
          rows.push({ label: 'Allegato', link: item.url, text: item.name });
        }
      }
    }
    if (!challenge.externalUrl && !Array.isArray(challenge.attachments)) {
      rows.push({ label: 'Allegati', value: 'Nessun allegato in questa demo' });
    }
    for (const row of rows) {
      const line = document.createElement('div');
      line.className = 'resource-row';
      const label = document.createElement('strong');
      label.textContent = row.label;
      const value = document.createElement('span');
      if (row.link) {
        const anchor = document.createElement('a');
        anchor.href = row.link;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.textContent = row.text;
        anchor.insertAdjacentHTML('beforeend', icon('external'));
        value.append(anchor);
      } else {
        value.textContent = row.value;
      }
      line.append(label, value);
      resources.append(line);
    }
  }

  function render() {
    const challenge = getChallenge();
    empty.hidden = Boolean(challenge);
    detail.hidden = !challenge;
    if (!challenge) return;

    badges.replaceChildren(
      tag(challenge.category),
      tag(challenge.difficulty, 'tag tag--difficulty'),
    );
    badges.lastChild.dataset.difficulty = challenge.difficulty;
    demoTag.hidden = !challenge.demo;
    title.textContent = challenge.title;
    description.textContent = challenge.description || '';
    statement.textContent = challenge.statement || 'Testo non disponibile.';

    goals.replaceChildren();
    if (Array.isArray(challenge.learningGoals) && challenge.learningGoals.length) {
      byId('goals-section').hidden = false;
      for (const goal of challenge.learningGoals) {
        const item = document.createElement('li');
        item.textContent = goal;
        goals.append(item);
      }
    } else {
      byId('goals-section').hidden = true;
    }

    renderResources(challenge);
    const status = store.getStatus(challenge.id);
    statusLabel.textContent = STATUS_LABELS[status];
    statusDot.dataset.status = status;
    cycle.textContent = NEXT_LABEL[status];
  }

  return { render };
}
