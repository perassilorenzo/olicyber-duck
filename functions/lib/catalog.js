/**
 * Catalogo authoritative lato server: il client può inviare solo ID.
 *
 * Il contesto del tutor è deliberatamente MINIMO: ID, ID originale, titolo,
 * categoria, tag, difficoltà e punteggio. Descrizioni, statement, hint,
 * obiettivi, allegati, URL e stati NON sono mai passati al modello.
 */

import catalog from './catalog-data.cjs';
import { GENERAL_CHALLENGE_ID } from './validate.js';

export const CATALOG_META = {
  schemaVersion: catalog.schemaVersion,
  status: catalog.status,
  source: catalog.source,
  completeness: catalog.completeness,
};

export function findChallengeById(id) {
  return catalog.challenges.find((challenge) => challenge.id === id) || null;
}

export function toPromptContext(challenge) {
  if (!challenge) {
    return {
      id: GENERAL_CHALLENGE_ID,
      originalId: null,
      title: 'Modalità generale di studio',
      category: 'Cybersecurity',
      difficulty: null,
      score: null,
      tags: [],
      general: true,
    };
  }
  return {
    id: challenge.id,
    originalId: challenge.originalId ?? null,
    title: challenge.title,
    category: challenge.category ?? null,
    difficulty: challenge.difficulty ?? null,
    score: challenge.score ?? null,
    tags: Array.isArray(challenge.tags) ? challenge.tags.slice(0, 12) : [],
    general: false,
  };
}

/** Restituisce i contesti autorizzati, oppure null se un ID non è nel catalogo. */
export function toPromptContexts(ids = []) {
  if (!Array.isArray(ids) || ids.length === 0) return [toPromptContext(null)];
  const contexts = [];
  for (const id of ids) {
    const challenge = findChallengeById(id);
    if (!challenge) return null;
    contexts.push(toPromptContext(challenge));
  }
  return contexts;
}
