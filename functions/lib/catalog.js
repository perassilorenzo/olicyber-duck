/** Catalogo authoritative lato server: il client non può scegliere il contesto. */
import catalog from '../../public/data/challenges.json' with { type: 'json' };

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
      id: 'general',
      title: 'Modalità generale di studio',
      category: 'Cybersecurity',
      difficulty: null,
      description: 'Nessuna challenge selezionata: lo studente chiede informazioni generali.',
      statement: '',
      tags: [],
      learningGoals: [],
      hintTopics: [],
      score: null,
      edition: null,
      state: null,
      sourceUrl: null,
      demo: false,
      general: true,
    };
  }
  return {
    id: challenge.id,
    originalId: challenge.originalId ?? null,
    title: challenge.title,
    category: challenge.category ?? null,
    difficulty: challenge.difficulty ?? null,
    description: challenge.description ?? '',
    statement: challenge.statement ?? '',
    tags: Array.isArray(challenge.tags) ? challenge.tags : [],
    learningGoals: challenge.metadata?.learningGoals ?? [],
    hintTopics: challenge.metadata?.hintTopics ?? [],
    score: challenge.score ?? null,
    edition: challenge.edition ?? null,
    state: challenge.state ?? null,
    sourceUrl: challenge.sourceUrl ?? null,
    demo: challenge.demo === true,
    general: false,
  };
}
