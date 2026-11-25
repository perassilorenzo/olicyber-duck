import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATASET = path.join(ROOT, 'dataset-input');
const BUILDER = path.join(ROOT, 'scripts', 'build-dataset.mjs');
const IMPORTER = path.join(ROOT, 'scripts', 'import-dataset.mjs');

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
const manifest = readJson('manifest.json');
const importReport = readJson('import-report.json');
const ragIndex = readJson('rag-index.json');
const reportText = readFileSync(path.join(DATASET, 'REPORT.md'), 'utf8');

test('il dataset ha tre sezioni separate e conteggi coerenti', () => {
  assert.equal(catalog.kind, 'oliduck-research-dataset');
  assert.ok(catalog.challengeCatalog);
  assert.ok(catalog.learningKnowledgeBase);
  assert.ok(catalog.solutionArchive);
  assert.equal(catalog.challengeCatalog.count, catalog.challengeCatalog.challenges.length);
  assert.equal(catalog.learningKnowledgeBase.count, catalog.learningKnowledgeBase.documents.length);
  assert.equal(catalog.solutionArchive.count, catalog.solutionArchive.documents.length);
  assert.equal(catalog.counts.challengesIdentified, catalog.challengeCatalog.count);
  assert.equal(catalog.counts.filesExamined, manifest.files.length);
  assert.equal(catalog.counts.ragChunks, ragIndex.count);
  assert.equal(importReport.counts.challengesIdentified, catalog.challengeCatalog.count);
});

test('ogni informazione del catalogo è riconducibile a un file inventariato', () => {
  const paths = new Set(manifest.files.map((file) => file.path));
  assert.ok(paths.size > 0);
  for (const challenge of catalog.challengeCatalog.challenges) {
    assert.ok(challenge.sourceRefs.length > 0, `senza fonti: ${challenge.id}`);
    for (const ref of challenge.sourceRefs) {
      assert.ok(paths.has(ref.path), `${challenge.id} -> ${ref.path} non inventariato`);
    }
  }
  assert.equal(importReport.verification.catalogSourceRefsComplete, true);
});

test('le descrizioni ufficiali sono assenti e quelle derivate sono etichettate', () => {
  const challenges = catalog.challengeCatalog.challenges;
  assert.equal(catalog.counts.officialDescriptions, 0);
  for (const challenge of challenges) {
    assert.equal(challenge.description.official, null);
    if (challenge.description.derived) {
      assert.ok(challenge.description.derived.provenance);
      assert.match(challenge.description.derived.method, /non.*ufficiale|writeup|soluzione/i);
    }
  }
  assert.ok(challenges.some((challenge) => challenge.description.derived));
});

test('duplicati e writeup condivisi sono segnalati senza unire record', () => {
  const duplicates = catalog.challengeCatalog.challenges.filter((challenge) => challenge.duplicateSourceId);
  assert.equal(duplicates.length, 2);
  assert.deepEqual(duplicates.map((item) => item.sourceChallengeId), ['726', '726']);
  assert.notEqual(duplicates[0].title, duplicates[1].title);
  assert.match(duplicates[0].id, /-r5$/);
  assert.match(duplicates[1].id, /-r7$/);

  const shared = catalog.challengeCatalog.challenges
    .filter((challenge) => challenge.writeups.includes('official-writeups/2022-nazionale/binary2-3.md'));
  assert.equal(shared.length, 2);
  assert.notEqual(shared[0].id, shared[1].id);

  assert.ok(importReport.duplicates.matchedCommunityCandidates > 0);
  for (const challenge of catalog.challengeCatalog.challenges.filter((item) => item.communityReferences.length)) {
    assert.ok(challenge.communityReferences[0].evidence.length > 0);
  }
});

test('la knowledge base autorizzata è vuota e il solution archive resta ristretto', () => {
  assert.ok(ragIndex.excludedSections.includes('solutionArchive'));
  assert.equal(ragIndex.runtimeConnected, false);
  assert.equal(ragIndex.status, 'empty-no-authorized-documents');
  assert.equal(ragIndex.chunks.length, 0);
  assert.equal(catalog.learningKnowledgeBase.count, 0);
  assert.ok(catalog.publicationGate.candidates > 0);
  assert.ok(catalog.publicationGate.excluded > 0);
  for (const chunk of ragIndex.chunks) {
    assert.equal(chunk.section, 'learningKnowledgeBase');
    assert.ok(chunk.sourceRefs.length > 0);
    for (const key of ['challengeId', 'title', 'category', 'edition', 'source', 'docType']) {
      assert.ok(Object.hasOwn(chunk.retrievalKeys, key));
    }
  }
  assert.ok(!/flag\s*\{[^{}]+\}/i.test(JSON.stringify(catalog.learningKnowledgeBase)));
  assert.ok(!/flag\s*\{[^{}]+\}/i.test(JSON.stringify(catalog.challengeCatalog)));

  const solutions = catalog.solutionArchive.documents;
  assert.ok(solutions.some((doc) => /flag\s*\{[^{}]+\}/i.test(doc.text ?? '')));
  for (const doc of solutions) {
    assert.equal(doc.exposePublicly, false);
    assert.equal(doc.cloudflareUploadAllowed, false);
    assert.equal(doc.restricted, true);
  }
});

test('inventario registra licenze, archivi non estratti e nessuna esecuzione', () => {
  assert.ok(reportText.includes('GPL-3.0'));
  assert.ok(reportText.includes('non dichiara alcuna licenza'));
  assert.ok(importReport.limitations.some((line) => /licenza/i.test(line)));
  assert.ok(manifest.files.every((file) => file.executed === false));
  const archives = manifest.files.filter((file) => file.archive);
  assert.ok(archives.length > 0);
  assert.ok(archives.every((file) => file.extracted === false));
});

test('l\'import del dataset è sanificato, ripetibile e non tocca public/data', () => {
  const publicBefore = hash('public/data/challenges.json');
  const reportBefore = hash('public/data/import-report.json');
  const tmp = mkdtempSync('/tmp/opencode/oliduck-dataset-');
  const out = path.join(tmp, 'application-catalog.json');
  const report = path.join(tmp, 'application-report.json');
  const args = ['--out', out, '--report', report];

  execFileSync(process.execPath, [IMPORTER, ...args], { cwd: ROOT, encoding: 'utf8' });
  const first = readFileSync(out, 'utf8');
  execFileSync(process.execPath, [IMPORTER, ...args], { cwd: ROOT, encoding: 'utf8' });
  const second = readFileSync(out, 'utf8');
  assert.equal(first, second);

  assert.equal(hash('public/data/challenges.json'), publicBefore);
  assert.equal(hash('public/data/import-report.json'), reportBefore);

  const imported = JSON.parse(first);
  assert.equal(imported.status, 'unverified-derived');
  assert.equal(imported.completeness.verifiedAgainstSource, false);
  assert.equal(imported.completeness.imported, imported.challenges.length);
  assert.equal(imported.challenges.some((challenge) => challenge.demo), false);
  assert.ok(imported.challenges.every((challenge) => challenge.description === '' && challenge.statement === ''));
  assert.ok(imported.challenges.every((challenge) => challenge.tags.length === 0));
  assert.ok(imported.challenges.every((challenge) => challenge.path === null));
  assert.ok(!JSON.stringify(imported).includes('flag{'));
  assert.ok(!JSON.stringify(imported).includes('solutionArchive'));

  const importedReport = JSON.parse(readFileSync(report, 'utf8'));
  assert.equal(importedReport.counts.solutionArchiveDocumentsExcluded, catalog.solutionArchive.count);
});

test('il builder è deterministico e non altera il catalogo demo', () => {
  const outputs = [
    'dataset-input/REPORT.md',
    'dataset-input/manifest.json',
    'dataset-input/import-report.json',
    'dataset-input/catalog.json',
    'dataset-input/rag-index.json',
  ];
  const publicBefore = hash('public/data/challenges.json');
  const before = new Map(outputs.map((file) => [file, hash(file)]));
  const output = run(BUILDER);
  assert.match(output, /Dataset generato/);
  for (const file of outputs) assert.equal(hash(file), before.get(file), `output non deterministico: ${file}`);
  assert.equal(hash('public/data/challenges.json'), publicBefore);
});
