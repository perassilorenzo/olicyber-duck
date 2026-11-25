import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROVENANCE_KINDS, catalogProvenance, challengeProvenance,
} from '../public/src/provenance.js';
import { SPLITTER_PX, effectiveAssistantPercent } from '../public/src/layout.js';

test('il badge della challenge deriva da demo e dallo stato di verifica', () => {
  assert.deepEqual(challengeProvenance({ demo: true, provenance: { verified: false } }), {
    kind: PROVENANCE_KINDS.demo, label: 'DEMO',
  });
  assert.deepEqual(challengeProvenance({ provenance: { verified: true, catalogVerified: true } }), {
    kind: PROVENANCE_KINDS.verified, label: 'VERIFICATA',
  });
  assert.deepEqual(challengeProvenance({ provenance: { verified: true, catalogVerified: false } }), {
    kind: PROVENANCE_KINDS.unverified, label: 'NON VERIFICATA',
  });
  assert.deepEqual(challengeProvenance({ provenance: { verified: false } }), {
    kind: PROVENANCE_KINDS.unverified, label: 'NON VERIFICATA',
  });
  assert.deepEqual(challengeProvenance(null), {
    kind: PROVENANCE_KINDS.unverified, label: 'NON VERIFICATA',
  });
});

test('il badge del catalogo usa lo stato del catalogo, non testi statici', () => {
  assert.deepEqual(
    catalogProvenance({ status: 'unverified-demo', source: { verified: false } }, []),
    { kind: PROVENANCE_KINDS.demo, label: 'DEMO' },
  );
  assert.deepEqual(
    catalogProvenance({ status: 'verified-import', source: { verified: true } }, [{ demo: false }]),
    { kind: PROVENANCE_KINDS.verified, label: 'VERIFICATA' },
  );
  assert.deepEqual(
    catalogProvenance({ status: 'imported-unverified', source: { verified: false } }, []),
    { kind: PROVENANCE_KINDS.unverified, label: 'NON VERIFICATA' },
  );
  assert.deepEqual(
    catalogProvenance({ status: 'verified-import', source: { verified: false } }, []),
    { kind: PROVENANCE_KINDS.unverified, label: 'NON VERIFICATA' },
  );
  assert.deepEqual(
    catalogProvenance({ status: 'verified-import', source: { verified: true } }, [{ demo: true }]),
    { kind: PROVENANCE_KINDS.demo, label: 'DEMO' },
  );
});

test('la larghezza effettiva dell’assistente tiene conto dello splitter', () => {
  assert.equal(SPLITTER_PX, 12);
  assert.equal(effectiveAssistantPercent(60, 1000), 39);
  assert.equal(effectiveAssistantPercent(40, 1000), 59);
  assert.equal(effectiveAssistantPercent(60, 0), 40);
  assert.equal(effectiveAssistantPercent(100, 1000), 0);
  assert.equal(effectiveAssistantPercent(-10, 1000), 99);
});
