/**
 * Gate di pubblicazione per la Knowledge Base del tutor.
 *
 * Il default è DENY: un documento entra nel corpus solo se tutte le condizioni
 * sono soddisfatte esplicitamente. La provenienza del repository non implica
 * né licenza né autorizzazione.
 */

import { FLAG_LIKE_PATTERN, PLACEHOLDERS, restorePlaceholders } from './text-normalization.mjs';

export const GATE_DEFAULT = 'DENY';

export const TUTOR_ALLOWED_CLASSIFICATIONS = Object.freeze([
  'official-description',
  'learning-material',
]);

export const DENIED_CLASSIFICATIONS = Object.freeze([
  'official-writeup',
  'community-solution',
  'attachment',
  'derived-content',
  'challenge-metadata',
]);

const SOLUTION_MARKER_PATTERN = /\b(?:soluzione|writeup|script di soluzione|passaggi risolutivi|step-by-step|flag\s*[{\[])\b/i;
const SOURCE_PATH_PATTERN = /(?:official-writeups|community-solutions)\/|\.git\//i;
const SOURCE_LINE_PATTERN = /^\s*(?:fonte|source|provenienza)\s*:/im;
const DEFORMED_PLACEHOLDER_PATTERN = /\[(?:FLAG|SEGRETO|TOKEN)RIMOSS[OA]\]/i;

/**
 * Contenuti che non possono entrare nel testo del tutor.
 * I placeholder canonicali sono ammessi: provano che la redaction è avvenuta.
 */
export function detectForbiddenContent(value) {
  const text = typeof value === 'string' ? value : '';
  const reasons = [];

  if (!text.trim()) return reasons;
  if (FLAG_LIKE_PATTERN.test(text)) reasons.push('flagNelTesto');
  if (DEFORMED_PLACEHOLDER_PATTERN.test(text)) reasons.push('placeholderRedactionDeformato');
  if (SOURCE_LINE_PATTERN.test(text)) reasons.push('dichiarazioneFonteNelTesto');
  if (SOURCE_PATH_PATTERN.test(text)) reasons.push('percorsoSorgenteNelTesto');

  return reasons;
}

/** Placeholder canonicali presenti ma deformati: la redaction non è affidabile. */
export function deformedPlaceholders(value) {
  const text = typeof value === 'string' ? value : '';
  const found = text.match(DEFORMED_PLACEHOLDER_PATTERN) ?? [];
  return found.map(restorePlaceholders).filter((item) => Object.values(PLACEHOLDERS).includes(item));
}

/**
 * Valuta un documento per l'uso nel corpus RAG.
 * @param {object} document Documento candidato.
 * @param {{ paths?: Set<string> }} options Insieme dei percorsi inventariati.
 */
export function evaluatePublicationGate(document, { paths = null } = {}) {
  if (!document || typeof document !== 'object') {
    return { allowed: false, reasons: ['documentoNonOggetto'], classification: null };
  }

  const reasons = [];
  const classification = document.classification ?? null;

  if (document.publicationAllowed !== true) reasons.push('autorizzazioneEsplicitaAssente');
  if (document.reviewStatus !== 'approved') reasons.push('revisioneNonApprovata');
  if (!TUTOR_ALLOWED_CLASSIFICATIONS.includes(classification)) reasons.push('classificazioneNonAmmessa');
  if (DENIED_CLASSIFICATIONS.includes(classification)) reasons.push('classificazioneEsclusa');

  if (!document.license || typeof document.license !== 'object') {
    reasons.push('licenzaAssente');
  } else if (document.license.verified !== true) {
    reasons.push('licenzaNonVerificata');
  }

  if (!document.provenanceType) reasons.push('provenienzaAssente');

  const refs = Array.isArray(document.sourceRefs) ? document.sourceRefs : [];
  if (!refs.length) {
    reasons.push('riferimentiFonteAssenti');
  } else {
    for (const ref of refs) {
      if (!ref || typeof ref !== 'object' || !ref.path) {
        reasons.push('riferimentoSenzaPercorso');
        continue;
      }
      if (paths && !paths.has(ref.path)) reasons.push('riferimentoNonInventariato');
      if (!ref.sourceRepository || !ref.sourceCommit) reasons.push('provenienzaIncompleta');
      if (ref.license && ref.license.verified === false) reasons.push('licenzaFonteNonVerificata');
    }
  }

  const text = typeof document.text === 'string' ? document.text : '';
  if (!text.trim()) {
    reasons.push('testoVuoto');
  } else {
    reasons.push(...detectForbiddenContent(text));
    if (SOLUTION_MARKER_PATTERN.test(text)) reasons.push('markerSoluzioneNelTesto');
  }

  return {
    allowed: reasons.length === 0,
    reasons: [...new Set(reasons)].sort(),
    classification,
  };
}
