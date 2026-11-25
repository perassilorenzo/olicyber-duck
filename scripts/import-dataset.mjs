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
import { detectForbiddenContent } from './lib/publication-gate.mjs';
import { safeHttpsUrl } from '../public/src/url.js';

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

function hasForbiddenKeys(value) {
  if (Array.isArray(value)) return value.some(hasForbiddenKeys);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) => (
    /^(flag|flags|solution|solutionText|writeup|writeups|writeupText)$/i.test(key) || hasForbiddenKeys(child)
  ));
}

const sourceName = 'Dataset pubblico derivato da indici e soluzioni disponibili';
const safeSourceUrl = (value) => safeHttpsUrl(value);
const challenges = dataset.challengeCatalog.challenges.map((challenge) => ({
  id: challenge.id,
  originalId: challenge.sourceChallengeId,
  title: challenge.title,
  // Nessun testo derivato da writeup/soluzioni viene copiato finché non è autorizzato.
  description: '',
  statement: '',
  category: challenge.category ?? null,
  difficulty: null,
  score: null,
  author: challenge.author ?? null,
  edition: challenge.edition ?? null,
  path: null,
  publishedAt: null,
  state: null,
  available: true,
  sourceUrl: safeSourceUrl(challenge.sourceUrl),
  attachments: [],
  tags: [],
  metadata: {
    challengeType: null,
    hintsCount: null,
    ignoredSensitiveFields: ['officialDescription', 'solutionText', 'writeupText', 'flags', 'derivedDescription', 'derivedTags'],
    learningGoals: [],
    hintTopics: [],
    publicationGate: dataset.publicationGate?.defaultDecision ?? 'DENY',
    derivedDescriptionExcluded: Boolean(challenge.description?.derived),
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
  externalUrl: safeSourceUrl(challenge.sourceUrl),
}));

const serialized = JSON.stringify(challenges);
const forbiddenReasons = detectForbiddenContent(serialized);
if (/flag\s*\{[^{}]+\}/i.test(serialized) || forbiddenReasons.length) {
  console.error(`Errore: contenuto non ammesso nel catalogo applicativo (${forbiddenReasons.join(', ') || 'flag letterale'}). Import interrotto.`);
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
    'Nessuna descrizione ufficiale è disponibile: description e statement sono vuoti e il testo derivato da writeup/soluzioni resta escluso.',
    'I tag derivati dalle fonti di soluzione non sono stati copiati nel catalogo applicativo.',
    'Il Solution Archive non è stato importato e non è accessibile da frontend o API pubbliche.',
    'La completezza non è verificabile senza un export autorizzato.',
    'Solo URL HTTPS assoluti sono importati; gli altri schemi vengono scartati e non resi cliccabili.',
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
