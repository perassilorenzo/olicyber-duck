/** Etichette di provenienza derivate dai dati, mai da testi statici nel markup. */

export const PROVENANCE_KINDS = Object.freeze({
  demo: 'demo',
  verified: 'verified',
  unverified: 'unverified',
});

const LABELS = Object.freeze({
  [PROVENANCE_KINDS.demo]: 'DEMO',
  [PROVENANCE_KINDS.verified]: 'VERIFICATA',
  [PROVENANCE_KINDS.unverified]: 'NON VERIFICATA',
});

function result(kind) {
  return { kind, label: LABELS[kind] };
}

export function challengeProvenance(challenge) {
  if (!challenge || typeof challenge !== 'object') return result(PROVENANCE_KINDS.unverified);
  if (challenge.demo === true) return result(PROVENANCE_KINDS.demo);
  const provenance = challenge.provenance;
  const verified = provenance?.verified === true && provenance?.catalogVerified !== false;
  return result(verified ? PROVENANCE_KINDS.verified : PROVENANCE_KINDS.unverified);
}

export function catalogProvenance(meta = {}, challenges = []) {
  const catalogIsDemo = meta.status === 'unverified-demo'
    || (challenges.length > 0 && challenges.every((challenge) => challenge?.demo === true));
  if (catalogIsDemo) return result(PROVENANCE_KINDS.demo);
  if (meta.source?.verified === true) return result(PROVENANCE_KINDS.verified);
  return result(PROVENANCE_KINDS.unverified);
}
