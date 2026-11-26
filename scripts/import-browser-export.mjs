#!/usr/bin/env node
/**
 * Importa l'export browser di OliCyber Training senza usare rete o credenziali.
 *
 * Legge SOLO i tre file generati dall'utente in dataset-input/browser-import/ e
 * produce asset derivati: catalogo pubblico sanitizzato, report e indice RAG
 * server-side. I Base64, le URL interne autenticate e i flag restano fuori.
 */

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    dataset: { type: 'string', default: 'dataset-input/browser-import/oliduck-dataset.json' },
    rag: { type: 'string', default: 'dataset-input/browser-import/oliduck-rag.json' },
    failed: { type: 'string', default: 'dataset-input/browser-import/oliduck-failed.json' },
    out: { type: 'string', default: 'public/data/olicyber-challenges.json' },
    ragOut: { type: 'string', default: 'functions/data/rag-index.json' },
    reportOut: { type: 'string', default: 'public/data/olicyber-import-report.json' },
    failuresOut: { type: 'string', default: 'dataset-input/derived/browser-import/import-failures.json' },
    chunkSize: { type: 'string', default: '600' },
    overlap: { type: 'string', default: '80' },
    maxCharsPerDoc: { type: 'string', default: '5000' },
    maxChunksPerDoc: { type: 'string', default: '14' },
  },
  allowPositionals: false,
});

const CHUNK_SIZE = Number(values.chunkSize);
const OVERLAP = Number(values.overlap);
const MAX_CHARS_PER_DOC = Number(values.maxCharsPerDoc);
const MAX_CHUNKS_PER_DOC = Number(values.maxChunksPerDoc);

if (![CHUNK_SIZE, OVERLAP, MAX_CHARS_PER_DOC, MAX_CHUNKS_PER_DOC].every((value) => Number.isInteger(value) && value > 0)) {
  console.error('Errore: i parametri di chunking devono essere interi positivi.');
  process.exit(1);
}
if (OVERLAP >= CHUNK_SIZE) {
  console.error('Errore: l\'overlap deve essere minore della dimensione del chunk.');
  process.exit(1);
}

const STOPWORDS = new Set([
  'che', 'chi', 'come', 'con', 'cosa', 'della', 'delle', 'delli', 'dello', 'di', 'e', 'ed', 'essere', 'fa',
  'finche', 'gli', 'ha', 'hanno', 'hai', 'ho', 'il', 'in', 'io', 'la', 'le', 'lei', 'lo', 'loro', 'lui',
  'ma', 'me', 'mi', 'nel', 'nella', 'nelle', 'nello', 'noi', 'non', 'nostro', 'o', 'per', 'perche', 'piu',
  'quale', 'quali', 'quando', 'quanto', 'quello', 'questa', 'queste', 'questi', 'questo', 'se', 'senza',
  'si', 'sia', 'siamo', 'sono', 'sta', 'stato', 'su', 'sul', 'sulla', 'sulle', 'suo', 'suoi', 'tanto',
  'te', 'ti', 'tra', 'tu', 'tuo', 'un', 'una', 'uno', 'vi', 'voi', 'vostro', 'the', 'and', 'for', 'with',
]);

const CATEGORIES = [
  [[/^crypto$/, /crypt/, /cifr/, /hash/], 'Crypto'],
  [[/^web$/, /^http$/, /^tls$/, /cookie/], 'Web'],
  [[/^binary$/, /^elf$/, /^strings$/, /^bytes$/], 'Binary'],
  [[/^misc$/], 'Misc'],
  [[/^network$/, /^remote$/, /^tcp$/, /^pcap$/, /^stream$/], 'Network'],
  [[/^pwn$/, /^gdb$/, /^pwntools$/], 'Pwn'],
  [[/^osint$/i], 'OSINT'],
  [[/^reverse$/, /^rev$/, /^regex$/], 'Reverse'],
  [[/^forensics$/], 'Forensics'],
];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function writeJson(path, data, pretty = false) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, pretty ? 2 : undefined)}\n`);
}

/** Rimuove flag letterali, marcatori di formato e flag codificate in Base64. */
function redactFlags(text) {
  return text
    // Prefissi noti, anche con contenuto multilinea o formati di esempio.
    .replace(/\b(?:flag|ctf|olicyber|ITASEC|OBUDMW|ptm|cnvlbd|cixd|xcqv|fzau|synt|cyvz)\s*[{\[][^\]}]{0,240}[\]}]/gis, '[FLAG RIMOSSA]')
    // Flag con prefisso arbitrario: contenuto snake/kebab-case, con eventuale
    // punteggiatura finale. Non tocca la sintassi di codice come `set {type}`.
    .replace(/\b[A-Za-z][A-Za-z0-9_]*\s*\{\s*[A-Za-z0-9]+(?:[_-][A-Za-z0-9]+)+[!?]?\s*\}/gi, '[FLAG RIMOSSA]')
    // Flag con prefisso arbitrario e contenuto alfanumerico lungo.
    .replace(/\b[A-Za-z][A-Za-z0-9_]*\s*\{\s*[A-Za-z0-9]{8,}[!?]?\s*\}/gi, '[FLAG RIMOSSA]')
    // Marcatori senza chiusura, ad es. `flag{` citato in una spiegazione.
    .replace(/\b(?:flag|ctf|olicyber)\s*[{\[]/gi, '[MARCATORE RIMOSSO]')
    // Flag intere codificate in Base64 (anche senza padding).
    .replace(/\b[A-Za-z0-9+/]{12,}={0,2}\b/g, (token) => {
      try {
        const decoded = Buffer.from(token, 'base64').toString('utf8');
        if (/\b(?:flag|ctf|olicyber)\s*[{\[]/i.test(decoded)) return '[TESTO SENSIBILE RIMOSSO]';
      } catch { /* token non decodificabile: lasciato invariato */ }
      return token;
    });
}

function cleanText(value, maxChars = 2000) {
  if (typeof value !== 'string') return '';
  return redactFlags(value)
    .replace(/\r\n?/g, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[\u200b-\u200f\u2028\u2029]/g, '')
    .replace(/\bflag\s*[:=]\s*[^\s`"']{4,}/gi, '[TESTO SENSIBILE RIMOSSO]')
    .replace(/Leggi la \[writeup\]\([^)]+\)\s* della challenge!/gi, '')
    .replace(/https?:\/\/\S*writeup\S*/gi, '[LINK WRITEUP RIMOSSO]')
    .replace(/\b(?:token|cookie|authorization|api[-_]?key|password|session)\s*[:=]\s*\S+/gi, '[DATO SENSIBILE RIMOSSO]')
    .replace(/\/api\/file\/[^\s)'"]+/gi, '[URL INTERNO RIMOSSO]')
    .replace(/[A-Za-z0-9+/]{120,}={0,2}/g, '[CONTENUTO BINARIO OMESSO]')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxChars);
}

function tagsOf(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((tag) => typeof tag === 'string' && tag.trim())
    .map((tag) => cleanText(tag, 60))
    .filter(Boolean))].slice(0, 20);
}

function categoryOf(tags) {
  for (const [patterns, label] of CATEGORIES) {
    if (tags.some((tag) => patterns.some((pattern) => pattern.test(tag.toLowerCase())))) return label;
  }
  return 'Altro';
}

function textOf(value, maxChars) {
  return cleanText(value, maxChars);
}

function attachmentsOf(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((item) => item && typeof item === 'object' && !Array.isArray(item)).map((item) => {
    const name = textOf(item.name, 120) || 'allegato';
    const contentType = textOf(item.contentType, 80) || null;
    const size = Number.isFinite(Number(item.size)) ? Number(item.size) : null;
    if (typeof item.text === 'string') {
      return {
        name,
        contentType,
        size,
        kind: 'text',
        preview: textOf(item.text, 260),
        textLength: item.text.length,
      };
    }
    if (typeof item.base64 === 'string') {
      return { name, contentType, size, kind: 'binary', preview: null, textLength: 0 };
    }
    if (item.error) {
      return { name, contentType, size, kind: 'error', preview: null, textLength: 0, error: textOf(item.error, 160) };
    }
    return { name, contentType, size, kind: 'unknown', preview: null, textLength: 0 };
  });
}

function challengeId(id) {
  const normalized = String(id ?? '').trim();
  return /^\d+$/.test(normalized) ? `olicyber-${normalized}` : null;
}

function isImportable(raw) {
  return raw && typeof raw === 'object' && !Array.isArray(raw)
    && !raw.importError
    && raw.id !== null && raw.id !== undefined
    && typeof raw.title === 'string' && raw.title.trim()
    && typeof raw.description === 'string' && raw.description.trim()
    && Array.isArray(raw.tags) && raw.tags.length > 0;
}

function buildChallenge(raw, exportedAt) {
  const id = challengeId(raw.id);
  const tags = tagsOf(raw.tags);
  const hints = (Array.isArray(raw.hints) ? raw.hints : [])
    .map((hint) => textOf(typeof hint === 'string' ? hint : hint?.content, 300))
    .filter(Boolean)
    .slice(0, 8);
  const attachments = attachmentsOf(raw.attachments);
  const statementParts = [textOf(raw.description, 4000)];
  if (hints.length) statementParts.push(`Hint: ${hints.join(' | ')}`);
  const names = attachments.map((item) => item.name);
  if (names.length) statementParts.push(`Allegati: ${names.join(', ')}`);
  const sourceState = raw.status && typeof raw.status === 'object'
    ? (raw.status.ok === false ? 'non disponibile' : 'online')
    : null;

  return {
    id,
    originalId: String(raw.id),
    title: textOf(raw.title, 200),
    description: textOf(raw.description, 4000),
    statement: textOf(statementParts.join('\n\n'), 5000),
    category: categoryOf(tags),
    difficulty: null,
    score: Number.isFinite(Number(raw.currentScore)) ? Number(raw.currentScore) : null,
    edition: null,
    path: null,
    publishedAt: null,
    state: sourceState,
    available: sourceState !== 'non disponibile',
    sourceUrl: null,
    author: Array.isArray(raw.authors) ? raw.authors.map((name) => textOf(name, 80)).filter(Boolean).join(', ') || null : null,
    attachments,
    tags,
    metadata: {
      hints,
      hintTopics: tags.slice(0, 6),
      learningGoals: [],
      solves: Number.isFinite(Number(raw.currentGlobalSolves)) ? Number(raw.currentGlobalSolves) : null,
      attachmentCount: attachments.length,
      importedAt: exportedAt,
    },
    provenance: {
      source: 'OliCyber Training',
      sourceUrl: null,
      verified: false,
      catalogVerified: false,
      recordVerified: false,
    },
    demo: false,
    source: 'OliCyber Training (export browser autorizzato)',
  };
}

function tokensOf(text) {
  return String(text || '')
    .toLocaleLowerCase('it')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !STOPWORDS.has(token) && !/^\d+$/.test(token));
}

function keywordsOf(text, title, tags, category) {
  const counts = new Map();
  for (const token of [...tokensOf(title), ...tokensOf(tags.join(' ')), ...tokensOf(category), ...tokensOf(text)]) {
    counts.set(token, (counts.get(token) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 18)
    .map(([token]) => token);
}

function chunksOf(text) {
  const clean = text.replace(/\n{3,}/g, '\n\n');
  const chunks = [];
  let start = 0;
  while (start < clean.length && chunks.length < MAX_CHUNKS_PER_DOC) {
    let end = Math.min(start + CHUNK_SIZE, clean.length);
    if (end < clean.length) {
      const slice = clean.slice(start, end);
      const candidates = [slice.lastIndexOf('\n'), slice.lastIndexOf('. '), slice.lastIndexOf(' ')];
      const boundary = Math.max(...candidates);
      if (boundary > CHUNK_SIZE * 0.6) end = start + boundary + 1;
    }
    const part = clean.slice(start, end).trim();
    if (part) chunks.push(part);
    if (end >= clean.length) break;
    start = Math.max(start + 1, end - OVERLAP);
  }
  return chunks;
}

function buildRagIndex(rag, exportedAt) {
  const chunks = [];
  let documents = 0;
  for (const doc of rag) {
    if (!doc || typeof doc !== 'object' || doc.id === null || doc.id === undefined) continue;
    const title = textOf(doc.title, 200);
    if (!title) continue;
    const tags = tagsOf(doc.tags);
    const category = categoryOf(tags);
    const content = textOf(doc.content, MAX_CHARS_PER_DOC);
    if (!content) continue;
    const parts = chunksOf(content);
    if (!parts.length) continue;
    const id = challengeId(doc.id);
    const truncated = doc.content.length > MAX_CHARS_PER_DOC || parts.length >= MAX_CHUNKS_PER_DOC;
    documents += 1;
    parts.forEach((part, index) => {
      chunks.push({
        id: `${doc.id}-${index}`,
        challengeId: id || null,
        originalId: String(doc.id),
        title,
        category,
        tags,
        index,
        truncated,
        keywords: keywordsOf(part, title, tags, category),
        text: part,
      });
    });
  }
  return {
    schemaVersion: 1,
    source: 'OliCyber Training (export browser autorizzato)',
    generatedAt: exportedAt,
    settings: { chunkSize: CHUNK_SIZE, overlap: OVERLAP, maxCharsPerDoc: MAX_CHARS_PER_DOC, maxChunksPerDoc: MAX_CHUNKS_PER_DOC },
    documents,
    chunks: chunks.length,
    items: chunks,
  };
}

const datasetPath = values.dataset;
const ragPath = values.rag;
const failedPath = values.failed;

const dataset = readJson(datasetPath);
const rag = readJson(ragPath);
const failedFile = readJson(failedPath);
const exportedAt = typeof dataset.exportedAt === 'string' ? dataset.exportedAt : null;
const sourceChallenges = Array.isArray(dataset.challenges) ? dataset.challenges : [];

const isComplete = (item) => Boolean(item && item.id && item.title && item.description && item.tags.length);
const built = sourceChallenges.filter(isImportable).map((raw) => buildChallenge(raw, exportedAt));
const accepted = new Set(
  sourceChallenges
    .filter(isImportable)
    .filter((raw, index) => isComplete(built[index]))
    .map((raw) => String(raw.id)),
);
const challenges = built.filter(isComplete);
const uniqueChallenges = [...new Map(challenges.map((item) => [item.id, item])).values()];
const importedIds = uniqueChallenges.map((item) => item.id);

const failures = new Map();
for (const entry of Array.isArray(failedFile) ? failedFile : []) {
  if (!entry || typeof entry !== 'object') continue;
  const id = String(entry.id ?? '').trim();
  if (!id) continue;
  failures.set(id, {
    id: challengeId(id) || id,
    originalId: id,
    title: textOf(entry.title, 200),
    error: textOf(entry.importError || entry.error || 'Importazione non riuscita.', 240),
    reason: 'source-error',
  });
}
for (const raw of sourceChallenges) {
  const id = String(raw?.id ?? '').trim();
  if (!id || accepted.has(id) || failures.has(id)) continue;
  failures.set(id, {
    id: challengeId(id) || id,
    originalId: id,
    title: textOf(raw?.title, 200),
    error: textOf(raw?.importError || 'Campi essenziali assenti dopo la sanificazione.', 240),
    reason: raw?.importError ? 'source-error' : 'incomplete-record',
  });
}

const failureList = [...failures.values()].sort((a, b) => Number(a.originalId) - Number(b.originalId));
const ragIndex = buildRagIndex(Array.isArray(rag) ? rag : [], exportedAt);

const report = {
  schemaVersion: 1,
  source: 'OliCyber Training',
  exportedAt,
  generatedFrom: {
    dataset: { file: datasetPath.split('/').pop(), sha256: sha256(datasetPath) },
    rag: { file: ragPath.split('/').pop(), sha256: sha256(ragPath) },
    failed: { file: failedPath.split('/').pop(), sha256: sha256(failedPath) },
  },
  counters: {
    discovered: Number(dataset.total) || sourceChallenges.length,
    reportedSuccessful: Number(dataset.successful) || uniqueChallenges.length,
    reportedFailed: Number(dataset.failed) || failureList.length,
    imported: uniqueChallenges.length,
    failed: failureList.length,
    ragDocuments: ragIndex.documents,
    ragChunks: ragIndex.chunks,
  },
  rules: {
    credentialsStored: false,
    attachmentsBase64Published: false,
    internalUrlsPublished: false,
    failedChallengesPublished: false,
    ragRuntimeConnected: true,
  },
  failedIds: failureList.map((item) => item.id),
  importedIds,
};

writeJson(values.out, {
  schemaVersion: 2,
  status: 'imported-partial',
  source: {
    name: 'OliCyber Training',
    note: `Export browser autorizzato; ${failureList.length} record non importati e provenienza non verificata.`,
    authorizedExportUsed: true,
    verified: false,
    importedAt: exportedAt,
  },
  completeness: {
    discovered: report.counters.discovered,
    imported: report.counters.imported,
    failed: report.counters.failed,
    verifiedAgainstSource: false,
  },
  challenges: uniqueChallenges,
}, true);

writeJson(values.ragOut, ragIndex);
writeJson(values.reportOut, report, true);
writeJson(values.failuresOut, {
  exportedAt,
  importedIds,
  failed: failureList,
}, true);

console.log(`Import completato: ${uniqueChallenges.length} challenge, ${failureList.length} errori, ${ragIndex.chunks} chunk RAG.`);
