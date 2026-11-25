import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cleanMarkdown,
  normalizeForTutor,
  PLACEHOLDERS,
  redactSecrets,
} from '../scripts/lib/text-normalization.mjs';
import {
  DENIED_CLASSIFICATIONS,
  detectForbiddenContent,
  evaluatePublicationGate,
} from '../scripts/lib/publication-gate.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATASET = path.join(ROOT, 'dataset-input');
const BUILDER = path.join(ROOT, 'scripts', 'build-dataset.mjs');
const IMPORTER = path.join(ROOT, 'scripts', 'import-dataset.mjs');
const OUTPUTS = [
  'dataset-input/REPORT.md',
  'dataset-input/manifest.json',
  'dataset-input/import-report.json',
  'dataset-input/catalog.json',
  'dataset-input/rag-index.json',
];

function readJson(relative) {
  return JSON.parse(readFileSync(path.join(DATASET, relative), 'utf8'));
}

function hash(relative) {
  return createHash('sha256').update(readFileSync(path.join(ROOT, relative))).digest('hex');
}

function run(script, args = []) {
  return execFileSync(process.execPath, [script, ...args], { cwd: ROOT, encoding: 'utf8' });
}

const catalog = readJson('catalog.json');
const ragIndex = readJson('rag-index.json');
const manifest = readJson('manifest.json');
const importReport = readJson('import-report.json');
const applicationCatalog = readJson('derived/application-catalog.json');
const tutorText = [
  ...catalog.learningKnowledgeBase.documents.map((doc) => doc.text),
  ...ragIndex.chunks.map((chunk) => chunk.text),
];

test('1. nessun chunk derivato da writeup o soluzione entra nel corpus pubblico', () => {
  const forbiddenDocTypes = new Set([
    'derived-context', 'concept-index', 'challenge-overview',
    'official-writeup', 'community-solution', 'solution-attachment',
  ]);
  for (const chunk of ragIndex.chunks) {
    assert.ok(!forbiddenDocTypes.has(chunk.docType), `${chunk.id} ha docType solutivo/derivato`);
    assert.ok(!DENIED_CLASSIFICATIONS.includes(chunk.classification), `${chunk.id} non è ammesso`);
    assert.ok(!chunk.sourceRefs.some((ref) => ['official-writeup', 'community-solution'].includes(ref.kind)));
  }
  assert.equal(catalog.learningKnowledgeBase.documents.filter((doc) => doc.docType === 'derived-context').length, 0);
  assert.ok(catalog.publicationGate.excludedByClassification['derived-content'] > 0);
});

test('2. soluzioni community senza licenza verificata non vengono pubblicate', () => {
  const admitted = new Set(ragIndex.chunks.map((chunk) => chunk.docId));
  for (const doc of catalog.publicationGate.excludedDocuments) {
    const unverified = doc.license?.verified !== true;
    const community = String(doc.sourcePath ?? '').startsWith('community-solutions/');
    if (unverified || community) assert.ok(!admitted.has(doc.id), `${doc.id} è stato ammesso`);
  }
  assert.ok(manifest.files.filter((file) => file.repository === 'community-solutions')
    .every((file) => file.licenseVerified === false));
  assert.ok(catalog.learningKnowledgeBase.documents.every((doc) => doc.license.verified === true));
});

test('3. nessuna flag entra nel corpus utilizzabile dal tutor', () => {
  for (const text of tutorText) {
    assert.doesNotMatch(text, /flag\s*[{[(]/i);
    assert.deepEqual(detectForbiddenContent(text), []);
  }
  assert.equal(importReport.verification.noForbiddenContentInTutorCorpus, true);
  assert.equal(importReport.verification.placeholdersIntactInTutorCorpus, true);
});

test('4. i placeholder di redaction sono preservati in tutte le varianti', () => {
  const variants = [
    'flag{abc123}',
    'FLAG{ABC123}',
    'Flag_ABC{abc123}',
    'flag[abc123]',
    'flag (abc123)',
    'ITASEC{abc123}',
    'ctf [abc123]',
    'oliduck_{abc123}',
  ];
  for (const variant of variants) {
    assert.equal(normalizeForTutor(variant), PLACEHOLDERS.flag, `variante non redatta: ${variant}`);
  }
  assert.equal(cleanMarkdown(`Testo ${PLACEHOLDERS.flag} e ${PLACEHOLDERS.token}`), `Testo ${PLACEHOLDERS.flag} e ${PLACEHOLDERS.token}`);
  assert.equal(cleanMarkdown(`[FLAGRIMOSSA] ${PLACEHOLDERS.secret}`), `${PLACEHOLDERS.flag} ${PLACEHOLDERS.secret}`);
  assert.deepEqual(detectForbiddenContent('[FLAGRIMOSSA]'), ['placeholderRedactionDeformato']);
});

test('5. i percorsi sorgente non finiscono nel testo dei chunk', () => {
  for (const text of tutorText) {
    assert.doesNotMatch(text, /^\s*(?:fonte|source|provenienza)\s*:/im);
    assert.doesNotMatch(text, /official-writeups\/|community-solutions\//i);
  }
  const pathValue = 'community-solutions/Introduzione/Crypto/crypto02.py';
  assert.equal(normalizeForTutor(`Fonte: ${pathValue}\nTesto didattico`), 'Testo didattico');
  assert.equal(redactSecrets(pathValue), pathValue);
  assert.ok(!redactSecrets(pathValue).includes(PLACEHOLDERS.token));
});

test('6. ogni chunk conserva riferimenti e metadati strutturati', () => {
  const requiredTopLevel = [
    'sourceId', 'sourcePath', 'sourceRepository', 'sourceCommit',
    'license', 'provenanceType', 'documentType', 'sourceRefs',
  ];
  for (const field of requiredTopLevel) {
    assert.ok(ragIndex.citationFields.includes(field), `campo citazione mancante: ${field}`);
  }
  for (const field of ['challengeId', 'category', 'edition', 'classification']) {
    assert.ok(Object.hasOwn(ragIndex.filters, field), `filtro mancante: ${field}`);
  }
  const paths = new Set(manifest.files.map((file) => file.path));
  for (const chunk of ragIndex.chunks) {
    for (const field of requiredTopLevel) assert.ok(Object.hasOwn(chunk, field), `${chunk.id} manca ${field}`);
    assert.ok(chunk.sourceRefs.length > 0);
    for (const ref of chunk.sourceRefs) assert.ok(paths.has(ref.path));
  }
  assert.equal(importReport.verification.kbSourceRefsComplete, true);
});

test('7. il gate blocca i documenti non autorizzati e usa DENY come default', () => {
  assert.equal(catalog.publicationGate.defaultDecision, 'DENY');
  assert.deepEqual(evaluatePublicationGate({}).reasons.includes('autorizzazioneEsplicitaAssente'), true);

  for (const classification of DENIED_CLASSIFICATIONS) {
    const decision = evaluatePublicationGate({
      classification,
      publicationAllowed: true,
      reviewStatus: 'approved',
      license: { name: 'GPL-3.0', verified: true },
      provenanceType: 'source-derived',
      sourceRefs: [{ path: 'official-writeups/README.md', sourceRepository: 'repo', sourceCommit: 'abc', license: { verified: true } }],
      text: 'Concetti generali di crittografia.',
    }, { paths: new Set(['official-writeups/README.md']) });
    assert.equal(decision.allowed, false, `${classification} è stato ammesso`);
  }

  const pathValue = 'community-solutions/Introduzione/Crypto/crypto11.md';
  const base = {
    classification: 'learning-material',
    publicationAllowed: true,
    reviewStatus: 'approved',
    provenanceType: 'repository-learning-material',
    sourceRefs: [{ path: pathValue, sourceRepository: 'repo', sourceCommit: 'abc', license: { verified: true } }],
    text: 'Concetti generali di crittografia.',
  };
  assert.ok(evaluatePublicationGate({ ...base, license: { name: 'non verificata', verified: false } }, { paths: new Set([pathValue]) }).reasons.includes('licenzaNonVerificata'));
  assert.deepEqual(evaluatePublicationGate({ ...base, license: { name: 'MIT', verified: true } }, { paths: new Set([pathValue]) }), {
    allowed: true, reasons: [], classification: 'learning-material',
  });
});

test('8. il Solution Archive resta separato e integralmente locale', () => {
  const solutions = catalog.solutionArchive.documents;
  assert.equal(solutions.length, 348);
  for (const doc of solutions) {
    assert.ok(doc.classification);
    assert.equal(doc.restricted, true);
    assert.equal(doc.tutorAllowed, false);
    assert.equal(doc.exposePublicly, false);
    assert.equal(doc.cloudflareUploadAllowed, false);
    assert.ok(!ragIndex.chunks.some((chunk) => chunk.docId === doc.id));
  }
  assert.ok(solutions.some((doc) => /flag\s*[{]/i.test(doc.text ?? '')));
  assert.ok(!ragIndex.includedSections.includes('solutionArchive'));
  assert.ok(!JSON.stringify(applicationCatalog).includes('solutionArchive'));
});

test('9. il catalogo demo non viene sovrascritto', () => {
  const demoBefore = hash('public/data/challenges.json');
  const reportBefore = hash('public/data/import-report.json');
  const tmp = mkdtempSync('/tmp/opencode/oliduck-remediation-');
  run(IMPORTER, ['--out', path.join(tmp, 'catalog.json'), '--report', path.join(tmp, 'report.json')]);
  assert.equal(hash('public/data/challenges.json'), demoBefore);
  assert.equal(hash('public/data/import-report.json'), reportBefore);

  const demo = JSON.parse(readFileSync(path.join(ROOT, 'public/data/challenges.json'), 'utf8'));
  assert.equal(demo.status, 'unverified-demo');
  assert.equal(demo.challenges.length, 7);
  assert.ok(demo.challenges.every((challenge) => challenge.demo === true));
  assert.equal(readJson('derived/application-import-report.json').appliedToPublic, false);
});

test('10. la generazione del dataset è deterministica', () => {
  const before = new Map(OUTPUTS.map((file) => [file, hash(file)]));
  const publicBefore = hash('public/data/challenges.json');
  assert.match(run(BUILDER), /Dataset generato/);
  for (const file of OUTPUTS) assert.equal(hash(file), before.get(file), `output non deterministico: ${file}`);
  assert.equal(hash('public/data/challenges.json'), publicBefore);
});
