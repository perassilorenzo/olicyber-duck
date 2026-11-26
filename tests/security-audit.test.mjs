import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function readJson(relative) {
  return JSON.parse(readFileSync(path.join(ROOT, relative), 'utf8'));
}

function readText(relative) {
  return readFileSync(path.join(ROOT, relative), 'utf8');
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.cjs'))) out.push(full);
  }
  return out;
}

const catalog = readJson('dataset-input/catalog.json');
const ragIndex = readJson('dataset-input/rag-index.json');
const manifest = readJson('dataset-input/manifest.json');
const importReport = readJson('dataset-input/import-report.json');
const applicationCatalog = readJson('dataset-input/derived/application-catalog.json');
const applicationReport = readJson('dataset-input/derived/application-import-report.json');

test('il RAG indicizza solo tipologie ammesse e nessun documento solutivo', () => {
  const allowed = new Set(['official-description', 'learning-material']);
  const forbidden = new Set(['official-writeup', 'community-solution', 'attachment', 'derived-content', 'challenge-metadata']);

  assert.deepEqual(ragIndex.includedSections, ['learningKnowledgeBase']);
  assert.deepEqual(ragIndex.excludedSections, ['solutionArchive']);
  assert.equal(ragIndex.runtimeConnected, false);
  assert.equal(ragIndex.status, 'empty-no-authorized-documents');

  for (const chunk of ragIndex.chunks) {
    assert.equal(chunk.section, 'learningKnowledgeBase');
    assert.ok(allowed.has(chunk.classification), `classificazione non ammessa: ${chunk.classification}`);
    assert.ok(!forbidden.has(chunk.classification));
    assert.ok(!forbidden.has(chunk.docType));
    assert.ok(!chunk.docId.startsWith('sol-'));
  }
  assert.equal(ragIndex.chunks.length, catalog.learningKnowledgeBase.count);
  assert.equal(catalog.publicationGate.defaultDecision, 'DENY');
});

test('ogni chunk conserva riferimenti risolvibili e chiavi di retrieval', () => {
  const paths = new Set(manifest.files.map((file) => file.path));
  assert.ok(paths.size > 0);

  for (const chunk of ragIndex.chunks) {
    assert.ok(chunk.sourceRefs.length > 0, `senza riferimenti: ${chunk.id}`);
    for (const ref of chunk.sourceRefs) {
      assert.ok(paths.has(ref.path), `${chunk.id} -> ${ref.path} non inventariato`);
    }
    for (const key of ['challengeId', 'title', 'category', 'edition', 'source', 'docType']) {
      assert.ok(Object.hasOwn(chunk.retrievalKeys, key), `${chunk.id} manca ${key}`);
    }
  }
  assert.equal(importReport.verification.kbSourceRefsComplete, true);
  assert.equal(importReport.verification.catalogSourceRefsComplete, true);
});

test('nessuna flag letterale entra nei contenuti utilizzabili dal tutor', () => {
  const scopes = [
    catalog.challengeCatalog,
    catalog.learningKnowledgeBase,
    ragIndex,
    applicationCatalog,
  ];
  for (const scope of scopes) {
    assert.doesNotMatch(JSON.stringify(scope), /flag\s*\{/i);
  }

  const flagLike = /\b(?:ITASEC|ITA|CTF)\s*\{/i;
  for (const chunk of ragIndex.chunks) {
    if (flagLike.test(chunk.text)) {
      assert.match(chunk.text, /NON descrizione ufficiale/i, `${chunk.id} contiene un formato flag-like senza etichetta`);
    }
  }
});

test('le descrizioni derivate non sono presentate come descrizioni ufficiali', () => {
  assert.equal(catalog.counts.officialDescriptions, 0);
  for (const challenge of catalog.challengeCatalog.challenges) {
    assert.equal(challenge.description.official, null);
    if (challenge.description.derived) {
      assert.ok(challenge.description.derived.provenance);
      assert.match(challenge.description.derived.method, /non.*ufficiale|writeup|soluzione/i);
    }
  }
  for (const doc of catalog.learningKnowledgeBase.documents.filter((item) => item.docType === 'derived-context')) {
    assert.match(doc.text, /NON descrizione ufficiale/i, `${doc.id} non etichettato`);
  }
  for (const challenge of applicationCatalog.challenges) {
    assert.equal(challenge.description, '');
    assert.equal(challenge.statement, '');
    assert.equal(typeof challenge.metadata?.derivedDescriptionExcluded, 'boolean');
  }
});

test('il Solution Archive contiene soluzioni ma resta ristretto e fuori dal tutor', () => {
  const solutions = catalog.solutionArchive.documents;
  assert.ok(solutions.length > 0);
  assert.ok(solutions.some((doc) => /flag\s*\{/i.test(doc.text ?? '')));
  for (const doc of solutions) {
    assert.equal(doc.restricted, true);
    assert.equal(doc.exposePublicly, false);
    assert.equal(doc.cloudflareUploadAllowed, false);
    assert.ok(!ragIndex.chunks.some((chunk) => chunk.docId === doc.id));
  }
  assert.equal(applicationReport.counts.solutionArchiveDocumentsExcluded, solutions.length);
});

test('il runtime carica solo l’indice RAG sanificato, non il dataset di ricerca', () => {
  const files = [
    ...walk(path.join(ROOT, 'functions')),
    ...walk(path.join(ROOT, 'public', 'src')),
    path.join(ROOT, 'public', 'index.html'),
    path.join(ROOT, 'wrangler.toml'),
  ];
  const forbidden = ['solutionArchive', 'learningKnowledgeBase', 'dataset-input', 'build-dataset', 'import-dataset'];
  const ragShim = path.join(ROOT, 'functions', 'data', 'rag-data.cjs');
  assert.ok(readText('functions/data/rag-data.cjs').includes('rag-index.json'));
  assert.equal(existsSync(path.join(ROOT, 'public', 'data', 'rag-index.json')), false);
  for (const file of files) {
    const text = readFileSync(file, 'utf8');
    for (const needle of forbidden) {
      assert.ok(!text.includes(needle), `${path.relative(ROOT, file)} contiene ${needle}`);
    }
    if (file !== ragShim) {
      assert.ok(!text.includes('rag-index'), `${path.relative(ROOT, file)} contiene rag-index`);
    }
  }

  const wrangler = readText('wrangler.toml');
  assert.match(wrangler, /^\s*#\s*\[ai\]\s*$/m);
  assert.doesNotMatch(wrangler, /^\s*\[ai\]\s*$/m);
});

test('catalogo demo e catalogo derivato restano separati', () => {
  const demo = readJson('public/data/challenges.json');
  assert.equal(demo.status, 'unverified-demo');
  assert.equal(demo.source.verified, false);
  assert.equal(demo.source.authorizedExportUsed, false);
  assert.equal(demo.completeness.verifiedAgainstSource, false);
  assert.ok(demo.challenges.every((challenge) => challenge.demo === true));

  assert.equal(applicationCatalog.status, 'unverified-derived');
  assert.equal(applicationCatalog.completeness.verifiedAgainstSource, false);
  assert.equal(applicationReport.appliedToPublic, false);
  assert.ok(!applicationCatalog.challenges.some((challenge) => challenge.demo === true));
});

test('provenienza, licenze, duplicati e snapshot sono coerenti', () => {
  assert.equal(catalog.generatedAt, catalog.sources.map((source) => source.committedAt).sort().at(-1));
  assert.deepEqual(catalog.sources.map((source) => source.commit), [
    '0d1ac26e3cc01c0ba85ab25d04cf1ece4548fa63',
    '081b0fef425b91e6ee34352643cbb9e5a1aac50d',
  ]);

  const official = manifest.files.filter((file) => file.repository === 'official-writeups');
  const community = manifest.files.filter((file) => file.repository === 'community-solutions');
  assert.ok(official.every((file) => file.license === 'GPL-3.0' && file.licenseVerified === true));
  assert.ok(community.every((file) => file.license === 'non verificata' && file.licenseVerified === false));

  const duplicateIds = catalog.challengeCatalog.challenges.filter((challenge) => challenge.duplicateSourceId);
  assert.equal(duplicateIds.length, 2);
  assert.deepEqual(duplicateIds.map((item) => item.sourceChallengeId), ['726', '726']);
  assert.notEqual(duplicateIds[0].title, duplicateIds[1].title);

  const shared = catalog.challengeCatalog.challenges
    .filter((challenge) => challenge.writeups.includes('official-writeups/2022-nazionale/binary2-3.md'));
  assert.equal(shared.length, 2);
  assert.notEqual(shared[0].id, shared[1].id);
});
