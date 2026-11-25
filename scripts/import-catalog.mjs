#!/usr/bin/env node
/**
 * Import autorizzato del catalogo OliCyber Training.
 *
 * Accetta SOLO un file JSON esportato legalmente dall'utente (ad es. l'export
 * admin CTFd effettuato con il proprio token). Non legge token, cookie, sessioni
 * o variabili d'ambiente, non effettua richieste di rete e non aggira controlli.
 *
 * Uso:
 *   node scripts/import-catalog.mjs --file /percorso/export-autorizzato.json \
 *     --expected-total 123 --source-name "Export admin OliCyber 2026"
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    file: { type: 'string' },
    out: { type: 'string', default: 'public/data/challenges.json' },
    report: { type: 'string', default: 'public/data/import-report.json' },
    'expected-total': { type: 'string' },
    'source-name': { type: 'string', default: 'Export autorizzato OliCyber Training' },
    portal: { type: 'string', default: 'https://training.olicyber.it' },
  },
  allowPositionals: true,
});

if (!values.file) {
  console.error('Errore: specificare --file con un export JSON autorizzato.');
  process.exit(1);
}

function text(value) {
  if (value === null || value === undefined) return null;
  return String(value)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function flattenExport(data) {
  if (Array.isArray(data)) return data.map((record) => ({ category: null, record }));
  if (!data || typeof data !== 'object') return [];
  const challenges = data.challenges ?? data.data?.challenges ?? [];
  if (Array.isArray(challenges)) return challenges.map((record) => ({ category: null, record }));
  return Object.entries(challenges).flatMap(([category, records]) =>
    (Array.isArray(records) ? records : []).map((record) => ({ category, record })),
  );
}

function tagsOf(record) {
  const source = Array.isArray(record.tags) ? record.tags : [];
  return source
    .map((tag) => (typeof tag === 'object' ? tag?.value ?? tag?.name : tag))
    .filter((tag) => typeof tag === 'string' && tag.trim())
    .map((tag) => tag.trim().slice(0, 60))
    .slice(0, 20);
}

function attachmentsOf(record) {
  const files = Array.isArray(record.files) ? record.files : [];
  return files
    .map((file) => {
      const name = typeof file === 'string' ? file : file?.name ?? file?.filename;
      const url = typeof file === 'object' ? file?.url ?? file?.downloadUrl ?? null : null;
      return name ? { name: String(name).slice(0, 160), url } : null;
    })
    .filter(Boolean)
    .slice(0, 20);
}

function toChallenge({ category, record }) {
  if (!record || typeof record !== 'object') return null;
  const originalId = record.id ?? record.challenge_id ?? null;
  const title = text(record.name ?? record.title);
  if (!title) return null;

  const state = text(record.state) ?? null;
  const available = state ? !['hidden', 'disabled', 'archived'].includes(state.toLowerCase()) : true;
  const sourceUrl = text(record.url) ?? (originalId !== null
    ? `${values.portal.replace(/\/$/, '')}/challenges/${encodeURIComponent(originalId)}`
    : null);

  const sensitive = ['flag', 'flags', 'solution', 'writeup', 'writeups'].filter((key) => key in record);

  return {
    id: originalId !== null ? `olicyber-${originalId}` : `import-${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)}`,
    originalId: originalId === null ? null : String(originalId),
    title,
    description: text(record.description) ?? '',
    statement: text(record.statement ?? record.description) ?? '',
    category: text(category ?? record.category) ?? null,
    difficulty: text(record.difficulty) ?? null,
    score: Number.isFinite(Number(record.value)) && record.value !== null ? Number(record.value) : null,
    author: text(record.author) ?? null,
    edition: text(record.edition ?? record.event) ?? null,
    path: text(record.path) ?? null,
    publishedAt: text(record.published_at ?? record.date ?? record.created) ?? null,
    state,
    available,
    sourceUrl,
    attachments: attachmentsOf(record),
    tags: tagsOf(record),
    metadata: {
      challengeType: text(record.type) ?? null,
      hintsCount: Array.isArray(record.hints) ? record.hints.length : null,
      ignoredSensitiveFields: sensitive,
    },
    provenance: { source: values['source-name'], importedAt: new Date().toISOString(), verified: true },
    demo: false,
    source: values['source-name'],
    externalUrl: sourceUrl,
  };
}

const raw = JSON.parse(readFileSync(values.file, 'utf8'));
const flat = flattenExport(raw);
const seen = new Set();
const challenges = [];
let duplicates = 0;

for (const entry of flat) {
  const challenge = toChallenge(entry);
  if (!challenge) continue;
  const key = challenge.originalId || challenge.title.toLocaleLowerCase('it');
  if (seen.has(key)) { duplicates += 1; continue; }
  seen.add(key);
  challenges.push(challenge);
}

const fields = ['title', 'description', 'statement', 'category', 'sourceUrl'];
const missing = challenges.filter((challenge) => fields.some((field) => !challenge[field])).length;
const unavailable = challenges.filter((challenge) => !challenge.available).length;
const expected = values['expected-total'] === undefined ? null : Number(values['expected-total']);
const verified = expected !== null && expected === challenges.length;
const categories = {};
for (const challenge of challenges) {
  const name = challenge.category || '(non categorizzata)';
  categories[name] = (categories[name] || 0) + 1;
}

const generatedAt = new Date().toISOString();
const catalog = {
  schemaVersion: 2,
  status: verified ? 'verified-import' : 'imported-unverified',
  source: {
    name: values['source-name'],
    portal: values.portal,
    endpointObserved: '/api/challenges (autenticazione richiesta)',
    authorizedExportUsed: true,
    importedAt: generatedAt,
    verified,
  },
  completeness: {
    expectedTotal: expected,
    discovered: flat.length,
    imported: challenges.length,
    duplicates,
    missingFields: missing,
    unavailable,
    verifiedAgainstSource: verified,
    report: '/data/import-report.json',
  },
  challenges,
};

const serialized = JSON.stringify(catalog, null, 2);
if (/flag\s*[{[]/i.test(serialized)) {
  console.error('Errore: l\'export contiene flag o soluzioni. Import interrotto.');
  process.exit(1);
}
writeFileSync(values.out, `${serialized}\n`);

const report = {
  schemaVersion: 2,
  generatedAt,
  status: catalog.status,
  source: catalog.source,
  counts: {
    discovered: flat.length,
    imported: challenges.length,
    duplicatesRemoved: duplicates,
    recordsWithMissingFields: missing,
    unavailableChallenges: unavailable,
    officialTotal: expected,
  },
  categories,
  limitations: [
    'L\'import richiede un export ottenuto con autorizzazione dall\'utente.',
    'Nessuna credenziale, cookie o sessione è stata letta o salvata dall\'importatore.',
    expected === null
      ? 'Non è stato fornito il numero totale ufficiale: la completezza non è verificabile.'
      : verified
        ? 'Il numero di record importati corrisponde al totale ufficiale fornito.'
        : `Il numero importato (${challenges.length}) non corrisponde al totale fornito (${expected}).`,
  ],
  verifiedAgainstSource: verified,
};
writeFileSync(values.report, `${JSON.stringify(report, null, 2)}\n`);

console.log(`Import completato: ${challenges.length} challenge, ${duplicates} duplicati, ${missing} record con campi mancanti.`);
console.log(`Catalogo: ${values.out}`);
console.log(`Report: ${values.report}`);
