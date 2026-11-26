/** Training: dashboard centrale con stato reale del catalogo e del workspace. */

import { byId } from './utils.js';
import { catalogProvenance, challengeProvenance } from './provenance.js';

const STATUS_LABELS = { todo: 'Da fare', 'in-progress': 'In corso', completed: 'Completata' };

function node(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}

function button(label, onClick, variant = 'outline') {
  const element = node('button', `btn btn--${variant} btn--sm`, label);
  element.type = 'button';
  element.addEventListener('click', onClick);
  return element;
}

export function createTraining({
  store, getCatalog, getSelectedChallenges, getDetailChallenge,
  onOpenDetails, onAskAssistant, onOpenLibrary, onNewChat,
}) {
  const body = byId('training-body');

  function stat(value, label) {
    const card = node('div', 'training-stat');
    card.append(node('strong', null, String(value)), node('span', null, label));
    return card;
  }

  function render() {
    if (!body) return;
    const { meta = {}, challenges = [] } = getCatalog() || {};
    const selected = getSelectedChallenges() || [];
    const detail = getDetailChallenge?.();
    const provenance = catalogProvenance(meta, challenges);
    const counts = { todo: 0, 'in-progress': 0, completed: 0 };
    for (const challenge of challenges) {
      const status = store.getStatus(challenge.id);
      if (status in counts) counts[status] += 1;
    }

    body.replaceChildren();

    const hero = node('div', 'training-hero');
    hero.append(node('h3', null, selected.length
      ? `${selected.length} challenge nel contesto di studio`
      : 'Pronto per allenarti?'));
    hero.append(node('p', null, selected.length
      ? 'Il tutor usa queste challenge come contesto strutturato. Apri una card per leggere i dettagli oppure chiedi un primo hint senza ricevere la soluzione.'
      : 'Seleziona una challenge dalla libreria per aprire una conversazione dedicata, oppure usa il tutor in modalità generale per un concetto di cybersecurity.'));
    body.append(hero);

    const stats = node('div', 'training-stats');
    stats.append(
      stat(challenges.length, 'Challenge nel catalogo'),
      stat(counts.todo, 'Da fare'),
      stat(counts['in-progress'], 'In corso'),
      stat(counts.completed, 'Completate'),
    );
    body.append(stats);

    const catalogCard = node('section', 'training-card');
    catalogCard.append(node('h3', null, 'Catalogo'));
    const badge = node('span', `provenance-badge provenance-badge--${provenance.kind}`, provenance.label);
    const badges = node('div', 'training-badges');
    badges.append(badge);
    catalogCard.append(badges);
    catalogCard.append(node('p', null, meta?.source?.note
      ? `${meta.source.name || 'Catalogo'} — ${meta.source.note}`
      : 'Il tutor riceve solo metadati autorizzati: nessuna descrizione, hint o allegato del catalogo viene inviato al modello.'));
    catalogCard.append(node('p', 'training-note', 'Le consegne restano non verificate finché non incolli un estratto: il tutor distingue sempre i dati forniti dallo studente.'));
    body.append(catalogCard);

    const focus = node('section', 'training-card');
    focus.append(node('h3', null, 'Contesto attivo'));
    if (selected.length) {
      const list = node('ul', 'hint-list');
      for (const challenge of selected) {
        const item = node('li', null, `${challenge.title} · ${STATUS_LABELS[store.getStatus(challenge.id)]}`);
        list.append(item);
      }
      focus.append(list);
      const actions = node('div', 'training-card__actions');
      actions.append(
        button('Apri dettagli', () => onOpenDetails?.(selected[0]), 'outline'),
        button('Chiedi a OliDuck', () => onAskAssistant?.(selected[0]), 'primary'),
      );
      focus.append(actions);
    } else {
      focus.append(node('p', null, 'Nessuna challenge selezionata: la chat attuale è generale.'));
      const actions = node('div', 'training-card__actions');
      actions.append(button('Apri la libreria', () => onOpenLibrary?.(), 'outline'));
      focus.append(actions);
    }
    body.append(focus);

    if (detail) {
      const quick = node('section', 'training-card');
      quick.append(node('h3', null, 'Ultima challenge aperta'));
      quick.append(node('p', 'training-focus__title', detail.title));
      const detailProvenance = challengeProvenance(detail).label;
      quick.append(node('p', 'training-focus__meta', `${detail.category || 'Categoria non indicata'} · ${detailProvenance}`));
      const actions = node('div', 'training-card__actions');
      actions.append(button('Dettagli', () => onOpenDetails?.(detail), 'outline'));
      quick.append(actions);
      body.append(quick);
    }

    const actions = node('section', 'training-card');
    actions.append(node('h3', null, 'Azioni rapide'));
    const row = node('div', 'training-card__actions');
    row.append(
      button('Nuova chat', () => onNewChat?.(), 'outline'),
      button('Vai al tutor', () => onAskAssistant?.(selected[0] || detail || null), 'primary'),
    );
    actions.append(row);
    body.append(actions);
  }

  return { render };
}
