#!/usr/bin/env node
/**
 * Importa il catalogo applicativo sanificato dal dataset di ricerca OliDuck.
 *
 * Di default scrive solo in dataset-input/derived/: il catalogo demo in public/
 * non viene toccato. L'overwrite di public/data richiede --apply esplicito.
 *
 * Il Solution Archive non attraversa mai questo importatore.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values } = parseArgs({
  options: {
    catalog: { type: 'string', default: 'dataset-input/catalog.json' },
    out: { type: 'string' },
    report: { type: 'string' },
    apply: { type: 'boolean', default: false },
  },
  allowPositionals: false,
});

const catalogPath = path.resolve(ROOT, values.catalog);
const outPath = path.resolve(ROOT, values.out
  ?? (values.apply ? 'public/data/challenges.json' : 'dataset-input/derived/application-catalog.json'));
const reportPath = path.resolve(ROOT, values.report
  ?? (values.apply ? 'public/data/import-report.json' : 'dataset-input/derived/application-import-report.json'));

const dataset = JSON.parse(readFileSync(catalogPath, 'utf8'));
if (dataset.schemaVersion !== 1 || dataset.kind !== 'oliduck-research-dataset') {
  console.error('Errore: catalogo del dataset non riconosciuto.');
  process.exit(1);
}
if (!dataset.challengeCatalog || !dataset.learningKnowledgeBase || !dataset.solutionArchive) {
  console.error('Errore: le tre sezioni del dataset non sono complete.');
  process.exit(1);
}

function redact(value) {
  return String(value ?? '')
    .replace(/flag\s*\{[^{}\n]{0,240}\}/gi, '[FLAG_RIMOSSA]')
    .replace(/OliDuck\s*\{[^{}\n]{0,240}\}/gi, '[SEGRETO_RIMOSSO]')
    .replace(/\b[A-Za-z0-9+/]{48,}={0,2}\b/g, '[TOKEN_RIMOSSO]')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasForbiddenKeys(value) {
  if (Array.isArray(value)) return value.some(hasForbiddenKeys);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) => (
    /^(flag|flags|solution|solutionText|writeup|writeups|writeupText)$/i.test(key) || hasForbiddenKeys(child)
  ));
}

const sourceName = 'Dataset pubblico derivato da indici e soluzioni disponibili';
const challenges = dataset.challengeCatalog.challenges.map((challenge) => {
  const description = redact(challenge.description?.derived?.text ?? '');
  const tags = [...new Set(challenge.concepts ?? [])].slice(0, 12);
  const sourceRefs = (challenge.sourceRefs ?? []).map((ref) => ref.path);
  return {
    id: challenge.id,
    originalId: challenge.sourceChallengeId,
    title: challenge.title,
    description,
    statement: description,
    category: challenge.category ?? null,
    difficulty: null,
    score: null,
    author: challenge.author ?? null,
    edition: challenge.edition ?? null,
    path: sourceRefs[0] ?? null,
    publishedAt: null,
    state: null,
    available: true,
    sourceUrl: challenge.sourceUrl ?? null,
    attachments: (challenge.materials?.attachments ?? []).map((name) => ({ name, url: null })),
    tags,
    metadata: {
      challengeType: null,
      hintsCount: null,
      ignoredSensitiveFields: ['officialDescription', 'solutionText', 'writeupText', 'flags'],
      learningGoals: tags.slice(0, 5),
      hintTopics: [],
      sourceRefs,
      descriptionProvenance: challenge.description?.derived
        ? { type: 'derived-from-solution-source', path: challenge.description.derived.provenance }
        : null,
      verification: challenge.verification?.status ?? null,
      duplicateSourceId: challenge.duplicateSourceId === true,
    },
    provenance: {
      source: sourceName,
      importedAt: dataset.generatedAt,
      verified: false,
      status: challenge.verification?.status ?? null,
    },
    demo: false,
    source: sourceName,
    externalUrl: challenge.sourceUrl ?? null,
  };
});

const serialized = JSON.stringify(challenges);
if (/flag\s*\{[^{}]+\}/i.test(serialized)) {
  console.error('Errore: una flag è presente nel catalogo applicativo. Import interrotto.');
  process.exit(1);
}
if (hasForbiddenKeys(challenges) || serialized.includes('solutionArchive')) {
  console.error('Errore: contenuto riservato presente nel catalogo applicativo. Import interrotto.');
  process.exit(1);
}

const missing = challenges.filter((challenge) => !challenge.title || !challenge.description || !challenge.sourceUrl).length;
const catalog = {
  schemaVersion: 2,
  status: 'unverified-derived',
  source: {
    name: sourceName,
    portal: 'https://training.olicyber.it',
    endpointObserved: 'fonti pubbliche locali, nessuna richiesta di rete',
    authorizedExportUsed: false,
    importedAt: dataset.generatedAt,
    verified: false,
  },
  completeness: {
    expectedTotal: null,
    discovered: dataset.counts.officialRowsDiscovered ?? challenges.length,
    imported: challenges.length,
    duplicates: dataset.counts.duplicateSourceChallengeIds ?? 0,
    missingFields: missing,
    unavailable: 0,
    verifiedAgainstSource: false,
    report: path.relative(path.dirname(outPath), reportPath).split(path.sep).join('/'),
  },
  challenges,
};

const report = {
  schemaVersion: 2,
  generatedAt: dataset.generatedAt,
  status: catalog.status,
  source: catalog.source,
  counts: {
    discovered: catalog.completeness.discovered,
    imported: catalog.completeness.imported,
    challengeCatalogRecords: dataset.challengeCatalog.count,
    knowledgeBaseDocuments: dataset.learningKnowledgeBase.count,
    solutionArchiveDocumentsExcluded: dataset.solutionArchive.count,
    recordsWithMissingFields: missing,
    officialTotal: null,
  },
  limitations: [
    'Il catalogo deriva da fonti pubbliche e non è il catalogo ufficiale Training.',
    'Nessuna descrizione ufficiale è disponibile: ogni testo mostrato è esplicitamente derivato da una fonte di soluzione.',
    'Il Solution Archive non è stato importato e non è accessibile da frontend o API pubbliche.',
    'La completezza non è verificabile senza un export autorizzato.',
    'La repository community non dichiara licenza: non pubblicare o caricare su Cloudflare i suoi contenuti senza autorizzazione.',
  ],
  verifiedAgainstSource: false,
  appliedToPublic: values.apply,
  output: path.relative(ROOT, outPath).split(path.sep).join('/'),
};

mkdirSync(path.dirname(outPath), { recursive: true });
mkdirSync(path.dirname(reportPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(catalog, null, 2)}\n`);
writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);

console.log(`Import dataset completato: ${challenges.length} challenge, 0 soluzioni importate.`);
console.log(`Catalogo: ${path.relative(ROOT, outPath)}`);
console.log(`Report: ${path.relative(ROOT, reportPath)}`);
if (values.apply) {
  console.log('ATTENZIONE: public/data è stato sovrascritto. Lo stato resta unverified-derived.');
}
