#!/usr/bin/env node
/**
 * Costruisce il dataset di ricerca OliDuck dalle fonti pubbliche scaricate.
 *
 * Regole operative:
 * - solo lettura del filesystem: nessuna rete, nessuna esecuzione di file delle fonti;
 * - gli archivi vengono inventariati ma mai estratti;
 * - i tre archivi (catalogo, knowledge base, solution archive) restano separati;
 * - l'output è deterministico e sovrascrivibile: una nuova versione delle fonti
 *   aggiorna i record esistenti senza accumulare duplicati.
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DENIED_CLASSIFICATIONS,
  detectForbiddenContent,
  evaluatePublicationGate,
  GATE_DEFAULT,
  TUTOR_ALLOWED_CLASSIFICATIONS,
} from './lib/publication-gate.mjs';
import { cleanMarkdown, normalizeForTutor } from './lib/text-normalization.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES_DIR = path.join(ROOT, 'dataset-input', 'sources');
const OUTPUT_DIR = path.join(ROOT, 'dataset-input');
const REPOS = ['official-writeups', 'community-solutions'];

const DECODER = new TextDecoder('utf-8', { fatal: true });
const CHUNK_SIZE = 1100;
const CHUNK_OVERLAP = 140;

/**
 * Autorizzazioni esplicite per il tutor. Vuote di proposito: la provenienza
 * di una repository non è un'autorizzazione. Un'aggiunta richiede revisione
 * umana, licenza verificata e pericolo documentato.
 */
const PUBLICATION_OVERRIDES = new Map();

const CONCEPTS = [
  ['Python', /\bpython\b/i],
  ['JavaScript', /\bjavascript\b|\bjs\b/i],
  ['PHP', /\bphp\b/i],
  ['C', /\bC\b(?:\+\+)?/],
  ['SQL', /\bsql\b/i],
  ['SQLite', /\bsqlite\b/i],
  ['Regex', /\bregex\b|regular expression|espressione regolare/i],
  ['RSA', /\brsa\b/i],
  ['AES', /\baes\b/i],
  ['XOR', /\bxor\b|xor/i],
  ['Diffie-Hellman', /diffie[- ]hellman|\bdh\b/i],
  ['Curve ellittiche', /elliptic curve|curva ellittica|\becc\b/i],
  ['MD5', /\bmd5\b/i],
  ['SHA', /\bsha[- ]?\d*\b/i],
  ['Base64', /base64/i],
  ['Hex', /\bhex\b|esadecimale/i],
  ['JWT', /\bjwt\b/i],
  ['Cookie e sessioni', /\bcookie\b|\bsession\b|sessione/i],
  ['CSRF', /\bcsrf\b/i],
  ['SSRF', /\bssrf\b/i],
  ['SQL injection', /sql injection|iniezione sql/i],
  ['XSS', /\bxss\b/i],
  ['Command injection', /command injection|injection|iniezione di comandi/i],
  ['Path traversal', /path traversal|directory traversal|\.\.\//i],
  ['LFI/RFI', /\blfi\b|\brfi\b|local file inclusion|remote file inclusion/i],
  ['Deserializzazione', /deserializz|unserializ|pickle/i],
  ['Buffer overflow', /buffer overflow|overflow/i],
  ['Stack', /\bstack\b|pila/i],
  ['ROP', /\brop\b|return[- ]oriented/i],
  ['ret2libc', /ret2libc/i],
  ['Format string', /format string/i],
  ['Heap', /\bheap\b/i],
  ['GDB', /\bgdb\b/i],
  ['pwntools', /pwntools/i],
  ['radare2', /radare2|\br2\b/i],
  ['Ghidra', /\bghidra\b/i],
  ['objdump/strings/nm', /objdump|\bstrings\b|\bnm\b/i],
  ['Wireshark/tcpdump', /wireshark|tcpdump/i],
  ['DNS', /\bdns\b/i],
  ['HTTP', /\bhttp\b|\bhttps\b/i],
  ['SSH', /\bssh\b/i],
  ['FTP/SFTP', /\bftp\b|\bsftp\b/i],
  ['SMTP', /\bsmtp\b/i],
  ['TLS/SSL', /\btls\b|\bssl\b/i],
  ['Padding oracle', /padding oracle/i],
  ['CBC', /\bcbc\b/i],
  ['ECB', /\becb\b/i],
  ['OTP', /\botp\b|one[- ]time pad/i],
  ['PRNG/LCG', /\bprng\b|\blcg\b|generatore pseudo/i],
  ['Steganografia', /steganograf/i],
  ['Forensica', /forensic|forensic/i],
  ['ZIP', /\bzip\b/i],
  ['PNG/BMP/GIF', /\bpng\b|\bbmp\b|\bgif\b/i],
  ['EXIF/metadata', /\bexif\b|metadati/i],
  ['Obfuscation', /obfuscat|offuscat/i],
  ['Encoding', /encod|decod|codifica/i],
];

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function gitInfo(dir) {
  const run = (args) => execFileSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim();
  return {
    origin: run(['remote', 'get-url', 'origin']),
    commit: run(['rev-parse', 'HEAD']),
    committedAt: run(['log', '-1', '--format=%cI']),
  };
}

function originToWeb(origin) {
  return origin.replace(/^git@github\.com:/, 'https://github.com/').replace(/\.git$/, '');
}

/** Rileva la licenza da un file presente nella repository, senza assumere autorizzazioni. */
function detectRepositoryLicense(repo) {
  const base = path.join(SOURCES_DIR, repo);
  const candidates = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'COPYING', 'COPYING.md'];
  const licensePath = candidates
    .map((name) => path.join(base, name))
    .find((candidate) => existsSync(candidate) && statSync(candidate).isFile());

  if (!licensePath) {
    return {
      name: 'non verificata',
      verified: false,
      file: null,
      detection: 'nessun file di licenza nella repository',
    };
  }

  const info = readUtf8(readFileSync(licensePath));
  const text = info.readable ? info.text : '';
  let name = null;
  if (/GNU GENERAL PUBLIC LICENSE/i.test(text) && /Version\s+3\b/i.test(text)) name = 'GPL-3.0';
  else if (/MIT License/i.test(text)) name = 'MIT';
  else if (/Apache License[\s\S]{0,200}Version 2\.0/i.test(text)) name = 'Apache-2.0';
  else if (/Creative Commons Attribution[^\n]{0,80}4\.0/i.test(text)) name = 'CC-BY-4.0';

  return {
    name: name ?? 'non verificata',
    verified: Boolean(name),
    file: path.posix.join(repo, path.relative(base, licensePath).split(path.sep).join('/')),
    detection: name ? 'contenuto del file di licenza' : 'file di licenza non riconosciuto',
  };
}

function encodeSegments(rel) {
  return rel.split('/').map((part) => encodeURIComponent(part)).join('/');
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out.sort();
}

function detectFormat(rel, buffer, ext) {
  const head = buffer.subarray(0, 8);
  if (head.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) return 'application/zip';
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (head.subarray(0, 6).equals(Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))
    || head.subarray(0, 6).equals(Buffer.from([0x47, 0x49, 0x46, 0x38, 0x37, 0x61]))) return 'image/gif';
  if (head.subarray(0, 3).equals(Buffer.from([0x42, 0x4d]))) return 'image/bmp';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.md') return 'text/markdown';
  if (ext === '.py') return 'text/x-python';
  if (ext === '.js') return 'text/javascript';
  if (ext === '.php') return 'text/x-php';
  if (ext === '.txt' || ext === '.sample') return 'text/plain';
  if (ext === '.json') return 'application/json';
  if (ext === '.pack' || ext === '.idx' || ext === '.rev') return 'application/x-git-object';
  if (head.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) return 'application/x-executable';
  return ext ? `unknown${ext}` : 'application/octet-stream';
}

function readUtf8(buffer) {
  try {
    const text = DECODER.decode(buffer);
    if (text.includes('\u0000')) return { readable: false, reason: 'contiene byte NUL', text: null };
    return { readable: true, reason: null, text };
  } catch {
    return { readable: false, reason: 'non è UTF-8 valido', text: null };
  }
}

function repoRelativePath(rel) {
  const slash = rel.indexOf('/');
  return slash === -1 ? rel : rel.slice(slash + 1);
}

function roleOf(rel, format, readable, scope) {
  if (scope === 'repository-metadata') return 'repository-metadata';
  if (/(^|\/)README\.md$/i.test(rel) || /(^|\/)LICENSE(\.md|\.txt)?$/i.test(rel) || rel.endsWith('/.gitignore')) return 'documentation';
  const inRepo = repoRelativePath(rel);
  if (format.startsWith('image/') || format === 'application/octet-stream'
    || format === 'application/x-executable' || format === 'unknown.bin'
    || format === 'application/zip' || rel.includes('/attachments/') || rel.startsWith('community-solutions/Assets/')) return 'attachment';
  if (/^Introduzione\//i.test(inRepo)) return 'learning-material';
  if (rel.startsWith('official-writeups/') && rel.endsWith('.md')) return 'official-writeup';
  if (!readable) return 'attachment';
  return 'community-solution';
}

function normalizeTitle(value) {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeCompactTitle(value) {
  return normalizeTitle(value).replace(/\s+/g, '');
}

function slug(value) {
  return normalizeTitle(value).replace(/ /g, '-').replace(/^-|-$/g, '').slice(0, 90);
}

function deriveOfficialDescription(text) {
  const lines = text.split(/\r?\n/);
  let afterHeading = false;
  const buffer = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (/^##\s+\[/.test(line)) { afterHeading = true; continue; }
    if (!afterHeading) continue;
    if (/^#{3,}\s/.test(line)) break;
    if (line.startsWith('```')) {
      if (buffer.length) break;
      continue;
    }
    if (line.startsWith('![')) continue;
    if (!line) {
      if (buffer.length) break;
      continue;
    }
    buffer.push(line);
  }
  const result = normalizeForTutor(buffer.join(' '));
  return result ? result.slice(0, 700) : null;
}

function deriveCommunityDescription(text) {
  const lines = text.split(/\r?\n/);
  const buffer = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith('>')) {
      if (buffer.length) break;
      continue;
    }
    buffer.push(line.replace(/^>\s?/, ''));
  }
  const result = normalizeForTutor(buffer.join(' '));
  return result ? result.slice(0, 700) : null;
}

function conceptsOf(text) {
  const found = new Set();
  for (const [label, pattern] of CONCEPTS) {
    if (pattern.test(text)) found.add(label);
  }
  return [...found].sort((a, b) => a.localeCompare(b, 'it')).slice(0, 14);
}

function attachmentsFromWriteup(rel, text, manifestByPath) {
  const found = new Set();
  const re = /!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let match;
  while ((match = re.exec(text)) !== null) {
    const target = match[1];
    if (/^(https?:|mailto:|#)/i.test(target)) continue;
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(rel), decodeURIComponent(target)));
    if (manifestByPath.has(resolved)
      && (resolved.includes('/attachments/') || /\.(png|gif|bmp|svg|jpg|jpeg|zip|bin|wav|mp3)$/i.test(resolved))) {
      found.add(resolved);
    }
  }
  return [...found].sort();
}

function stableSourceId(pathValue) {
  return `src-${sha256(pathValue).slice(0, 16)}`;
}

function classificationForRole(role) {
  if (role === 'official-writeup') return 'official-writeup';
  if (role === 'learning-material') return 'learning-material';
  if (role === 'attachment') return 'attachment';
  if (role === 'community-solution') return 'community-solution';
  if (role === 'repository-metadata') return 'challenge-metadata';
  return 'challenge-metadata';
}

function provenanceTypeForKind(kind) {
  if (kind === 'official-index' || kind === 'edition-index') return 'official-index';
  if (kind === 'official-writeup') return 'official-writeup';
  if (kind === 'learning-material') return 'repository-learning-material';
  if (kind === 'community-solution') return 'community-solution';
  return 'repository-source';
}

function sourceRef(pathValue, kind, evidence) {
  const repo = pathValue.split('/')[0];
  const info = metaByRepo.get(repo);
  const file = manifestByPathGlobal.get(pathValue);
  const license = file?.licenseVerified
    ? { name: file.license, verified: true, file: file.licenseFile ?? null }
    : { name: file?.license ?? (repo === 'official-writeups' ? 'GPL-3.0' : 'non verificata'), verified: false, file: null };
  return {
    sourceId: stableSourceId(pathValue),
    path: pathValue,
    sourcePath: pathValue,
    kind,
    evidence,
    sourceRepository: info?.origin ?? repo,
    sourceCommit: info?.commit ?? null,
    license,
    provenanceType: provenanceTypeForKind(kind),
    documentType: classificationForRole(file?.role ?? kind),
  };
}

function licenseForRefs(refs) {
  const licenses = new Set(refs.map((ref) => ref.license?.name).filter(Boolean));
  if (licenses.size === 1 && licenses.has('GPL-3.0')) {
    return { name: 'GPL-3.0', verified: true, file: 'official-writeups/LICENSE' };
  }
  if (licenses.size === 0) return { name: 'non verificata', verified: false, file: null };
  return {
    name: [...licenses].sort((a, b) => a.localeCompare(b, 'it')).join(' + '),
    verified: false,
    file: null,
  };
}

function parseOfficialReadme(text, manifestByPath, meta) {
  const rows = [];
  let editionLabel = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    const heading = line.match(/^##\s+OliCyber\.IT\s+(\d{4})\s+-\s+(.+?)\s*$/);
    if (heading) {
      editionLabel = `OliCyber.IT ${heading[1]} - ${heading[2]}`;
      continue;
    }
    const row = line.match(
      /^\|\s*(\d+)\s*\|\s*([a-z]+)\s*\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|\s*\[([^\]]+)\]\(([^)]+)\)\s*\|\s*(\d+)\s*\|\s*(.*?)\s*\|\s*$/,
    );
    if (!row || !editionLabel) continue;
    const writeupPath = `official-writeups/${row[6].replace(/^\//, '')}`;
    const idMatch = row[4].match(/challenge-(\d+)/);
    rows.push({
      rowNumber: Number(row[1]),
      category: row[2],
      title: row[3],
      sourceUrl: row[4],
      writeupLabel: row[5],
      writeupPath,
      resolutions: Number(row[7]),
      author: row[8],
      authorHandles: [...row[8].matchAll(/<@([^>]+)>/g)].map((m) => m[1]),
      editionLabel,
      editionSlug: path.posix.basename(path.posix.dirname(writeupPath)),
      sourceChallengeId: idMatch ? idMatch[1] : null,
      writeupText: manifestByPath.get(writeupPath)?.text ?? null,
      meta,
    });
  }
  return rows;
}

function officialChallenge(row, id, duplicateSourceId) {
  const writeupTitleMatch = row.writeupText?.match(/^##\s+\[[^\]]+\]\s+(.+?)\s*\(/m);
  const text = row.writeupText ?? '';
  const derived = row.writeupText ? deriveOfficialDescription(text) : null;
  const attachments = row.writeupText ? attachmentsFromWriteup(row.writeupPath, text, manifestByPathGlobal) : [];
  const concepts = conceptsOf(text);
  const refs = [
    sourceRef('official-writeups/README.md', 'official-index', 'riga della tabella ufficiale con ID, titolo, categoria, autore e link'),
    sourceRef(`official-writeups/${row.editionSlug}/README.md`, 'edition-index', 'indice dell\'edizione che conferma la riga'),
    sourceRef(row.writeupPath, 'official-writeup', 'writeup ufficiale: fonte di metadati e testo derivato, non descrizione ufficiale'),
  ].filter((ref) => manifestByPathGlobal.has(ref.path));

  const missing = ['descrizione ufficiale (assente nelle fonti)'];
  if (!row.author) missing.push('autore');
  if (!row.sourceChallengeId) missing.push('ID sorgente');
  if (!row.writeupText) missing.push('testo writeup leggibile');
  if (!refs.some((ref) => ref.kind === 'official-writeup')) missing.push('writeup presente');

  return {
    id,
    sourceChallengeId: row.sourceChallengeId,
    duplicateSourceId,
    title: row.title,
    writeupPath: row.writeupPath,
    classification: 'challenge-metadata',
    documentType: 'challenge-metadata',
    provenanceType: row.sourceChallengeId ? 'official-index' : 'path-derived',
    publicationAllowed: false,
    reviewStatus: 'not-approved',
    category: row.category,
    edition: row.editionLabel,
    editionSlug: row.editionSlug,
    author: row.author,
    authorHandles: row.authorHandles,
    resolutions: row.resolutions,
    sourceUrl: row.sourceUrl,
    description: {
      official: null,
      derived: derived ? {
        text: derived,
        provenance: row.writeupPath,
        method: 'primo paragrafo del writeup prima della sezione soluzione; mai etichettato come descrizione ufficiale',
        classification: 'derived-content',
        publicationAllowed: false,
        reviewStatus: 'not-approved',
      } : null,
    },
    materials: {
      attachments,
      referencedFiles: attachments,
    },
    writeups: [row.writeupPath],
    writeupTitle: writeupTitleMatch ? cleanMarkdown(writeupTitleMatch[1]) : null,
    titleMismatch: writeupTitleMatch
      ? normalizeCompactTitle(writeupTitleMatch[1]) !== normalizeCompactTitle(row.title)
      : null,
    concepts,
    communityReferences: [],
    sourceRefs: refs,
    license: licenseForRefs(refs),
    verification: {
      status: 'source-metadata-verified-description-derived',
      verifiedFields: ['titolo', 'categoria', 'edizione', 'autore', 'ID sorgente', 'URL sorgente'],
      unverifiedFields: ['descrizione ufficiale', 'difficoltà', 'punteggio', 'disponibilità', 'completezza del catalogo'],
    },
    missingFields: missing,
  };
}

function isCategoryDirectory(name) {
  return /^(crypto|web|misc|network|software|binary|introduzione|assets)$/i.test(name);
}

function isEventDirectory(relDir) {
  const parts = relDir.split('/');
  const last = parts.at(-1);
  return parts.length <= 2
    || isCategoryDirectory(last)
    || /^(20\d{2}(-\d+)?|\d{4}-[a-z-]+|nazionale|territoriale|training camp)$/i.test(last);
}

function editionFromCommunityPath(relDir) {
  const parts = relDir.split('/');
  const year = parts.find((part) => /^20\d{2}$/.test(part)) ?? parts.find((part) => /^Olicyber-\d{4}$/i.test(part))?.match(/\d{4}/)?.[0] ?? null;
  const phase = parts.find((part) => /^(nazionale|territoriale)$/i.test(part))?.toLowerCase() ?? null;
  const camp = parts.find((part) => /training camp/i.test(part));
  if (year && phase) return { label: `${year} - ${phase}`, slug: `${year}-${phase}` };
  if (year && camp) return { label: `${year} - Training Camp`, slug: `${year}-camp` };
  if (year) return { label: `${year}`, slug: year };
  return { label: null, slug: null };
}

function categoryFromCommunityPath(relDir) {
  const raw = relDir.split('/').reverse().find((part) => isCategoryDirectory(part));
  if (!raw) return null;
  const map = { software: 'binary' };
  return map[raw.toLowerCase()] ?? raw.toLowerCase();
}

function communityGroups(files, manifestByPath) {
  const candidates = [];
  const byKey = new Map();
  const filesByDir = new Map();
  for (const file of files) {
    const list = filesByDir.get(file.relDir) ?? [];
    list.push(file);
    filesByDir.set(file.relDir, list);
  }

  for (const file of files) {
    if (file.role === 'documentation' || file.role === 'attachment'
      || file.role === 'repository-metadata' || file.role === 'learning-material') continue;
    const stem = path.posix.basename(file.rel, path.posix.extname(file.rel));
    const baseStem = stem.replace(/[ _-](?:v?\d+(?:\.\d+)?)$/i, '');
    const dirFiles = filesByDir.get(file.relDir) ?? [];
    const dirName = path.posix.basename(file.relDir);
    const dirIsChallenge = !isEventDirectory(file.relDir)
      && dirFiles.length <= 4
      && (normalizeTitle(dirName) === normalizeTitle(stem)
        || normalizeTitle(dirName) === normalizeTitle(baseStem)
        || dirFiles.every((item) => item.role === 'community-solution')
        || dirFiles.every((item) => item.role === 'community-solution' || item.role === 'attachment'));
    const key = dirIsChallenge
      ? `dir::${file.relDir}`
      : `stem::${file.relDir}::${normalizeTitle(baseStem)}`;

    if (!byKey.has(key)) {
      const edition = editionFromCommunityPath(file.relDir);
      byKey.set(key, {
        key,
        title: dirIsChallenge ? dirName : baseStem,
        titleSource: dirIsChallenge ? 'nome della directory' : 'nome del file',
        relDir: file.relDir,
        edition,
        category: categoryFromCommunityPath(file.relDir),
        event: file.relDir.split('/')[0],
        files: [],
        evidence: dirIsChallenge ? ['raggruppamento per directory con nome coerente'] : ['raggruppamento per nome file nella stessa directory'],
      });
    }
    byKey.get(key).files.push(file);
  }

  for (const group of byKey.values()) {
    group.files.sort((a, b) => a.rel.localeCompare(b.rel));
    const md = group.files.find((file) => file.format === 'text/markdown' && !/README/i.test(file.rel));
    if (md) {
      group.title = path.posix.basename(md.rel, '.md');
      group.titleSource = 'nome del file markdown nella directory';
    }
    const texts = group.files.filter((file) => file.readable && file.text).map((file) => file.text);
    group.text = texts.join('\n\n');
    group.derived = texts.map(deriveCommunityDescription).find(Boolean) ?? null;
    group.concepts = conceptsOf(group.text);
    group.explicitIds = new Set();
    for (const text of texts) {
      for (const match of text.matchAll(/(?:challenges[#/]|challenge-)(\d{2,5})/gi)) {
        group.explicitIds.add(match[1]);
      }
    }
    const refs = group.files.map((file) => sourceRef(file.rel, file.role, group.evidence[0]));
    const primary = group.files[0];
    group.id = `cs-${slug(group.event || 'community')}-${slug(group.title)}`;
    group.sourceUrl = `${originToWeb(metaByRepo.get(primary.repo).origin)}/blob/${metaByRepo.get(primary.repo).commit}/${encodeSegments(primary.rel.slice(primary.repo.length + 1))}`;
    group.sourceRefs = refs;
    group.license = licenseForRefs(refs);
    candidates.push(group);
  }
  return candidates.sort((a, b) => a.id.localeCompare(b.id));
}

function chunkText(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const chunks = [];
  let start = 0;
  let guard = 0;
  while (start < clean.length && guard < 1000) {
    guard += 1;
    let end = Math.min(start + CHUNK_SIZE, clean.length);
    if (end < clean.length) {
      const space = clean.lastIndexOf(' ', end);
      if (space > start + CHUNK_SIZE / 2) end = space;
    }
    const value = clean.slice(start, end).trim();
    if (value) chunks.push({ text: value, start, end });
    if (end >= clean.length) break;
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }
  return chunks.map((chunk, index) => ({ ...chunk, chunkIndex: index, totalChunks: chunks.length }));
}

let manifestByPathGlobal = new Map();
let metaByRepo = new Map();

function main() {
  if (!existsSync(SOURCES_DIR)) {
    console.error(`Directory sorgente assente: ${SOURCES_DIR}`);
    process.exit(1);
  }

  const meta = {};
  for (const repo of REPOS) {
    const dir = path.join(SOURCES_DIR, repo);
    if (!existsSync(dir)) {
      console.error(`Repository assente: ${dir}`);
      process.exit(1);
    }
    meta[repo] = gitInfo(dir);
  }
  metaByRepo = new Map(REPOS.map((repo) => [repo, meta[repo]]));
  const licenseByRepo = new Map(REPOS.map((repo) => [repo, detectRepositoryLicense(repo)]));

  // Fase 1: inventario completo, senza eseguire alcun contenuto.
  const files = [];
  for (const repo of REPOS) {
    const base = path.join(SOURCES_DIR, repo);
    for (const abs of walk(base)) {
      const rel = path.posix.join(repo, path.relative(base, abs).split(path.sep).join('/'));
      const buffer = readFileSync(abs);
      const ext = path.extname(rel).toLowerCase();
      const format = detectFormat(rel, buffer, ext);
      const textInfo = readUtf8(buffer);
      const scope = rel.slice(repo.length + 1).startsWith('.git/') ? 'repository-metadata' : 'content';
      const role = roleOf(rel, format, textInfo.readable, scope);
      const repoLicense = licenseByRepo.get(repo);
      const licenseVerified = repoLicense.verified;
      const commit = meta[repo].commit;
      const sourceUrl = scope === 'content'
        ? `${originToWeb(meta[repo].origin)}/blob/${commit}/${encodeSegments(rel.slice(repo.length + 1))}`
        : null;
      files.push({
        rel,
        repo,
        relDir: path.posix.dirname(rel),
        scope,
        format,
        extension: ext || '(none)',
        sizeBytes: statSync(abs).size,
        sha256: sha256(buffer),
        readable: textInfo.readable,
        readabilityNote: textInfo.reason,
        encoding: textInfo.readable ? 'utf-8' : null,
        lineCount: textInfo.readable ? textInfo.text.split(/\r?\n/).length : null,
        role,
        executable: /\.(py|js|php)$/i.test(rel) || role === 'attachment',
        executed: false,
        archive: format === 'application/zip',
        extracted: false,
        extractionNote: format === 'application/zip' ? 'archivio non estratto: contenuto e sicurezza non verificati' : null,
        license: repoLicense.name,
        licenseFile: repoLicense.file,
        licenseVerified,
        licenseDetection: repoLicense.detection,
        sourceUrl,
        text: textInfo.text,
      });
    }
  }
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  manifestByPathGlobal = new Map(files.map((file) => [file.rel, file]));

  // Fase 2: duplicati esatti per contenuto.
  const byHash = new Map();
  for (const file of files) {
    const list = byHash.get(file.sha256) ?? [];
    list.push(file);
    byHash.set(file.sha256, list);
  }
  let duplicateGroupNo = 0;
  const duplicateGroups = [];
  for (const list of byHash.values()) {
    if (list.length < 2) continue;
    duplicateGroupNo += 1;
    const groupId = `dup-${String(duplicateGroupNo).padStart(3, '0')}`;
    duplicateGroups.push({
      groupId,
      sha256: list[0].sha256,
      sizeBytes: list[0].sizeBytes,
      paths: list.map((file) => file.rel),
    });
    for (const file of list.slice(1)) {
      file.duplicateOf = list[0].rel;
      file.duplicateGroup = groupId;
    }
  }

  // Fase 3: catalogo ufficiale ricavato dall'indice README ufficiale.
  const officialIndex = manifestByPathGlobal.get('official-writeups/README.md');
  if (!officialIndex?.text) throw new Error('README ufficiale non leggibile');
  const officialRows = parseOfficialReadme(officialIndex.text, manifestByPathGlobal, meta['official-writeups']);
  const idCounts = new Map();
  for (const row of officialRows) {
    if (row.sourceChallengeId) idCounts.set(row.sourceChallengeId, (idCounts.get(row.sourceChallengeId) ?? 0) + 1);
  }
  const challenges = officialRows.map((row) => {
    const duplicate = row.sourceChallengeId && idCounts.get(row.sourceChallengeId) > 1;
    const base = row.sourceChallengeId
      ? `oc-${row.editionSlug}-${row.sourceChallengeId}`
      : `oc-${row.editionSlug}-${slug(row.title)}`;
    const id = duplicate ? `${base}-r${row.rowNumber}` : base;
    return officialChallenge(row, id, duplicate);
  });

  const challengeById = new Map(challenges.map((challenge) => [challenge.id, challenge]));
  const officialByEditionTitle = new Map();
  const officialById = new Map();
  for (const challenge of challenges) {
    const key = `${challenge.editionSlug}::${normalizeCompactTitle(challenge.title)}`;
    const list = officialByEditionTitle.get(key) ?? [];
    list.push(challenge);
    officialByEditionTitle.set(key, list);
    if (challenge.sourceChallengeId) {
      const idList = officialById.get(challenge.sourceChallengeId) ?? [];
      idList.push(challenge);
      officialById.set(challenge.sourceChallengeId, idList);
    }
  }

  // Fase 4: soluzioni community, agganciate solo con evidenza esplicita.
  const communityFiles = files.filter((file) => file.scope === 'content');
  const groups = communityGroups(communityFiles, manifestByPathGlobal);
  let matched = 0;
  const unmatched = [];
  const ambiguous = [];
  for (const group of groups) {
    const evidence = [];
    let candidates = [];
    for (const id of group.explicitIds) {
      const matches = officialById.get(id) ?? [];
      if (matches.length === 1) {
        candidates.push(matches[0]);
        evidence.push(`ID esplicito #challenge-${id} nel testo della soluzione`);
      }
    }
    const titleKey = `${group.edition.slug}::${normalizeCompactTitle(group.title)}`;
    const titleMatches = officialByEditionTitle.get(titleKey) ?? [];
    if (titleMatches.length === 1 && !candidates.length) {
      candidates.push(titleMatches[0]);
      evidence.push(`titolo normalizzato identico nell'edizione ${group.edition.slug}`);
    }
    if (candidates.length > 1 && new Set(candidates.map((item) => item.id)).size > 1) {
      ambiguous.push({ candidate: group.id, matches: candidates.map((item) => item.id), reason: 'evidenze contrastanti' });
      continue;
    }
    if (candidates.length === 1) {
      const target = candidates[0];
      target.communityReferences.push({
        candidateId: group.id,
        title: group.title,
        edition: group.edition.label,
        files: group.files.map((file) => file.rel),
        evidence,
      });
      for (const ref of group.sourceRefs) {
        if (!target.sourceRefs.some((existing) => existing.path === ref.path)) target.sourceRefs.push(ref);
      }
      target.writeups.push(...group.files.filter((file) => file.role === 'community-solution').map((file) => file.rel));
      target.materials.attachments.push(...group.files.filter((file) => file.role === 'attachment').map((file) => file.rel));
      target.materials.attachments = [...new Set(target.materials.attachments)].sort();
      target.writeups = [...new Set(target.writeups)].sort();
      for (const file of group.files) {
        file.challengeIds = [...new Set([...(file.challengeIds ?? []), target.id])].sort();
      }
      matched += 1;
      continue;
    }
    if (titleMatches.length > 1) {
      ambiguous.push({ candidate: group.id, matches: titleMatches.map((item) => item.id), reason: 'titolo ambiguo nella stessa edizione' });
      continue;
    }
    unmatched.push(group);
  }

  const communityOnly = unmatched.map((group) => {
    const missing = ['descrizione ufficiale (assente nelle fonti)', 'autore della challenge'];
    if (!group.edition.label) missing.push('edizione');
    if (!group.category) missing.push('categoria');
    return {
      id: group.id,
      sourceChallengeId: null,
      duplicateSourceId: false,
      title: group.title,
      titleSource: group.titleSource,
      classification: 'challenge-metadata',
      documentType: 'challenge-metadata',
      provenanceType: 'path-derived',
      publicationAllowed: false,
      reviewStatus: 'not-approved',
      category: group.category,
      edition: group.edition.label,
      editionSlug: group.edition.slug,
      event: group.event,
      author: null,
      resolutions: null,
      sourceUrl: group.sourceUrl,
      description: {
        official: null,
        derived: group.derived ? {
          text: group.derived,
          provenance: group.files.find((file) => file.format === 'text/markdown')?.rel ?? group.files[0].rel,
          method: 'primo blocco citato nel file di soluzione community; non è una descrizione ufficiale',
          classification: 'derived-content',
          publicationAllowed: false,
          reviewStatus: 'not-approved',
        } : null,
      },
      materials: {
        attachments: group.files.filter((file) => file.role === 'attachment').map((file) => file.rel).sort(),
        referencedFiles: group.files.map((file) => file.rel).sort(),
      },
      writeups: group.files.filter((file) => file.role === 'community-solution').map((file) => file.rel).sort(),
      concepts: group.concepts,
      communityReferences: [{
        candidateId: group.id,
        title: group.title,
        edition: group.edition.label,
        files: group.files.map((file) => file.rel),
        evidence: group.evidence,
      }],
      sourceRefs: group.sourceRefs,
      license: licenseForRefs(group.sourceRefs),
      verification: {
        status: 'path-derived-unverified',
        verifiedFields: ['presenza del file nella repository community'],
        unverifiedFields: ['identità della challenge', 'descrizione ufficiale', 'autore', 'edizione', 'categoria'],
      },
      missingFields: missing,
    };
  });

  const allChallenges = [...challenges, ...communityOnly].sort((a, b) => a.id.localeCompare(b.id));
  for (const challenge of allChallenges) {
    for (const ref of challenge.sourceRefs) {
      const file = manifestByPathGlobal.get(ref.path);
      if (file) file.challengeIds = [...new Set([...(file.challengeIds ?? []), challenge.id])].sort();
    }
  }

  // Fase 5: associazione degli asset condivisi citati dai markdown community.
  const assetFiles = files.filter((file) => file.rel.startsWith('community-solutions/Assets/'));
  for (const asset of assetFiles) {
    const name = path.posix.basename(asset.rel);
    const refs = files.filter((file) => file.readable && file.text?.includes(`/Assets/${name}`));
    asset.referencedBy = refs.map((file) => file.rel).sort();
    asset.challengeIds = [...new Set(refs.flatMap((file) => file.challengeIds ?? []))].sort();
    for (const file of refs) {
      const owner = allChallenges.find((challenge) => (file.challengeIds ?? []).includes(challenge.id));
      if (owner && !owner.materials.attachments.includes(asset.rel)) owner.materials.attachments.push(asset.rel);
    }
  }
  for (const challenge of allChallenges) challenge.materials.attachments.sort();

  // Fase 6: candidati KB classificati. Il gate decide quali entrano nel tutor.
  const inventoryPaths = new Set(files.map((file) => file.rel));
  const kbCandidates = [];

  function addKbCandidate(base) {
    const refs = base.sourceRefs ?? [];
    const override = PUBLICATION_OVERRIDES.get(base.id) ?? {};
    const primary = refs[0] ?? null;
    kbCandidates.push({
      ...base,
      sourceId: primary?.sourceId ?? null,
      sourcePath: primary?.path ?? null,
      sourceRepository: primary?.sourceRepository ?? null,
      sourceCommit: primary?.sourceCommit ?? null,
      license: base.license ?? licenseForRefs(refs),
      provenanceType: base.provenanceType ?? primary?.provenanceType ?? 'repository-source',
      documentType: base.docType,
      publicationAllowed: override.publicationAllowed === true,
      reviewStatus: override.reviewStatus ?? 'not-approved',
      text: normalizeForTutor(base.text),
    });
  }

  for (const challenge of allChallenges) {
    const overviewRefs = challenge.sourceRefs;
    addKbCandidate({
      id: `kb-overview-${challenge.id}`,
      challengeId: challenge.id,
      title: challenge.title,
      category: challenge.category,
      edition: challenge.edition,
      source: overviewRefs[0]?.path ?? null,
      docType: 'challenge-overview',
      classification: 'challenge-metadata',
      provenanceType: 'challenge-metadata',
      sourceRefs: overviewRefs,
      license: licenseForRefs(overviewRefs),
      text: [
        `Challenge: ${challenge.title}`,
        `Categoria: ${challenge.category ?? 'non dichiarata'}`,
        `Edizione: ${challenge.edition ?? 'non dichiarata'}`,
        `Autore: ${challenge.author ?? 'non dichiarato'}`,
      ].join('\n'),
    });

    if (challenge.description.derived) {
      const derivedRefs = challenge.sourceRefs.filter((ref) => ref.path === challenge.description.derived.provenance);
      addKbCandidate({
        id: `kb-context-${challenge.id}`,
        challengeId: challenge.id,
        title: challenge.title,
        category: challenge.category,
        edition: challenge.edition,
        source: challenge.description.derived.provenance,
        docType: 'derived-context',
        classification: 'derived-content',
        provenanceType: 'source-derived',
        sourceRefs: derivedRefs,
        license: licenseForRefs(derivedRefs),
        text: `Contesto ricostruito da una fonte di soluzione (NON descrizione ufficiale): ${challenge.description.derived.text}`,
      });
    }

    if (challenge.concepts.length) {
      addKbCandidate({
        id: `kb-concepts-${challenge.id}`,
        challengeId: challenge.id,
        title: challenge.title,
        category: challenge.category,
        edition: challenge.edition,
        source: challenge.sourceRefs[0]?.path ?? null,
        docType: 'concept-index',
        classification: 'derived-content',
        provenanceType: 'source-derived',
        sourceRefs: challenge.sourceRefs,
        license: licenseForRefs(challenge.sourceRefs),
        text: `Concetti tecnici citati nelle fonti: ${challenge.concepts.join(', ')}. Il testo completo non è incluso.`,
      });
    }
  }

  for (const file of files.filter((item) => item.role === 'learning-material' && item.readable)) {
    const concepts = conceptsOf(file.text ?? '');
    if (!concepts.length) continue;
    addKbCandidate({
      id: `kb-material-${slug(file.rel)}`,
      challengeId: (file.challengeIds ?? [])[0] ?? null,
      title: path.posix.basename(file.rel),
      category: categoryFromCommunityPath(file.relDir),
      edition: editionFromCommunityPath(file.relDir).label,
      source: file.rel,
      docType: 'learning-material',
      classification: 'learning-material',
      provenanceType: 'repository-learning-material',
      sourceRefs: [sourceRef(file.rel, 'learning-material', 'materiale didattico individuato dal percorso della repository community')],
      license: { name: file.license, verified: file.licenseVerified, file: file.licenseFile },
      text: `Materiale didattico individuato nella repository community. Concetti: ${concepts.join(', ')}. Il codice completo non è incluso.`,
    });
  }

  const gateDecisions = kbCandidates.map((doc) => ({
    id: doc.id,
    docType: doc.docType,
    classification: doc.classification,
    decision: evaluatePublicationGate(doc, { paths: inventoryPaths }),
  }));
  const decisionById = new Map(gateDecisions.map((entry) => [entry.id, entry.decision]));
  for (const doc of kbCandidates) {
    doc.publicationGate = decisionById.get(doc.id);
  }

  const kbDocuments = kbCandidates.filter((doc) => decisionById.get(doc.id).allowed);
  const excludedDocuments = kbCandidates
    .filter((doc) => !decisionById.get(doc.id).allowed)
    .map((doc) => ({
      id: doc.id,
      docType: doc.docType,
      classification: doc.classification,
      sourceId: doc.sourceId,
      sourcePath: doc.sourcePath,
      license: doc.license,
      reasons: decisionById.get(doc.id).reasons,
    }));

  const solutionDocuments = [];
  for (const file of files) {
    if (file.scope !== 'content') continue;
    const isOfficialWriteup = file.role === 'official-writeup';
    const isLearningMaterial = file.role === 'learning-material';
    const isCommunitySolution = file.role === 'community-solution' || isLearningMaterial;
    const isBinaryRelated = file.role === 'attachment' && (file.rel.includes('/attachments/') || file.rel.startsWith('Assets/') || file.rel.includes('Byte-flag/'));
    if (!isOfficialWriteup && !isCommunitySolution && !isBinaryRelated) continue;
    const classification = isOfficialWriteup
      ? 'official-writeup'
      : isLearningMaterial ? 'learning-material' : isCommunitySolution ? 'community-solution' : 'attachment';
    const ref = sourceRef(file.rel, classification, 'archivio locale ristretto: mai indicizzato per il tutor');
    solutionDocuments.push({
      id: `sol-${slug(file.rel)}`,
      title: path.posix.basename(file.rel),
      text: isOfficialWriteup || isCommunitySolution ? file.text : null,
      format: file.format,
      sizeBytes: file.sizeBytes,
      sha256: file.sha256,
      sourceId: ref.sourceId,
      sourcePath: file.rel,
      sourceRepository: ref.sourceRepository,
      sourceCommit: ref.sourceCommit,
      sourceRefs: [ref],
      sourceUrl: file.sourceUrl,
      challengeIds: file.challengeIds ?? [],
      license: { name: file.license, verified: file.licenseVerified, file: file.licenseFile },
      provenanceType: 'restricted-source-file',
      documentType: file.role,
      classification,
      publicationAllowed: false,
      reviewStatus: 'not-approved',
      docType: isOfficialWriteup ? 'official-writeup' : isCommunitySolution ? 'community-solution' : 'solution-attachment',
      restricted: true,
      tutorAllowed: false,
      exposePublicly: false,
      cloudflareUploadAllowed: false,
      archive: file.archive,
      extracted: file.extracted,
    });
  }

  const ragChunks = [];
  for (const doc of kbDocuments) {
    const parts = chunkText(doc.text);
    for (const part of parts) {
      ragChunks.push({
        id: `${doc.id}-c${part.chunkIndex}`,
        section: 'learningKnowledgeBase',
        docId: doc.id,
        docType: doc.docType,
        classification: doc.classification,
        challengeId: doc.challengeId,
        title: doc.title,
        category: doc.category,
        edition: doc.edition,
        source: doc.source,
        sourceId: doc.sourceId,
        sourcePath: doc.sourcePath,
        sourceRepository: doc.sourceRepository,
        sourceCommit: doc.sourceCommit,
        license: doc.license,
        provenanceType: doc.provenanceType,
        documentType: doc.documentType,
        sourceRefs: doc.sourceRefs,
        publicationAllowed: doc.publicationAllowed,
        reviewStatus: doc.reviewStatus,
        retrievalKeys: {
          challengeId: doc.challengeId,
          title: doc.title,
          category: doc.category,
          edition: doc.edition,
          docType: doc.docType,
          classification: doc.classification,
          source: doc.source,
        },
        text: part.text,
        charStart: part.start,
        charEnd: part.end,
        chunkIndex: part.chunkIndex,
        totalChunks: part.totalChunks,
      });
    }
  }

  // Fase 7: verifiche prima di scrivere.
  const manifestFiles = files.map((file) => ({
    path: file.rel,
    repository: file.repo,
    scope: file.scope,
    format: file.format,
    extension: file.extension,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    source: {
      name: file.repo,
      url: originToWeb(meta[file.repo].origin),
      commit: meta[file.repo].commit,
      sourceUrl: file.sourceUrl,
    },
    license: file.license,
    licenseVerified: file.licenseVerified,
    licenseFile: file.licenseFile ?? null,
    licenseDetection: file.licenseDetection ?? null,
    readable: file.readable,
    readabilityNote: file.readabilityNote,
    encoding: file.encoding,
    lineCount: file.lineCount,
    role: file.role,
    executable: file.executable,
    executed: file.executed,
    archive: file.archive,
    extracted: file.extracted,
    extractionNote: file.extractionNote,
    challengeIds: file.challengeIds ?? [],
    duplicateOf: file.duplicateOf ?? null,
    duplicateGroup: file.duplicateGroup ?? null,
    referencedBy: file.referencedBy ?? [],
  }));
  const manifestByFinalPath = new Map(manifestFiles.map((file) => [file.path, file]));

  for (const challenge of allChallenges) {
    if (!challenge.sourceRefs.length) throw new Error(`Challenge senza sorgente: ${challenge.id}`);
    for (const ref of challenge.sourceRefs) {
      if (!manifestByFinalPath.has(ref.path)) throw new Error(`Riferimento inesistente per ${challenge.id}: ${ref.path}`);
    }
  }
  for (const chunk of ragChunks) {
    if (!chunk.sourceRefs.length) throw new Error(`Chunk senza riferimento: ${chunk.id}`);
  }
  const catalogSerializedCheck = JSON.stringify({ challenges: allChallenges, kbDocuments });
  if (/flag\s*\{[^{}]+\}/i.test(catalogSerializedCheck)) {
    throw new Error('Il catalogo o la knowledge base contengono una flag: generazione interrotta.');
  }

  const tutorItems = [...kbDocuments, ...ragChunks];
  const forbiddenInTutor = tutorItems.flatMap((item) => (
    detectForbiddenContent(item.text).map((reason) => `${item.id}:${reason}`)
  ));
  if (forbiddenInTutor.length) {
    throw new Error(`Contenuto non ammesso nel corpus tutor: ${forbiddenInTutor.join(', ')}`);
  }
  const tutorSerializedCheck = JSON.stringify({ documents: kbDocuments, chunks: ragChunks });
  if (/\[(?:FLAG|SEGRETO|TOKEN)RIMOSS[OA]\]/i.test(tutorSerializedCheck)) {
    throw new Error('Placeholder di redaction deformato nel corpus tutor: generazione interrotta.');
  }

  const gateSummary = {
    defaultDecision: GATE_DEFAULT,
    admittedClassifications: [...TUTOR_ALLOWED_CLASSIFICATIONS],
    deniedClassifications: [...DENIED_CLASSIFICATIONS],
    candidates: kbCandidates.length,
    admitted: kbDocuments.length,
    excluded: excludedDocuments.length,
    admittedIds: kbDocuments.map((doc) => doc.id),
    excludedByClassification: countBy(excludedDocuments, (doc) => doc.classification),
    excludedByReason: countBy(
      gateDecisions.filter((entry) => !entry.decision.allowed),
      (entry) => entry.decision.reasons,
      true,
    ),
    excludedDocuments,
  };

  const generatedAt = REPOS.map((repo) => meta[repo].committedAt).sort().at(-1);
  const counts = buildCounts(files, allChallenges, officialRows, duplicateGroups, kbDocuments, solutionDocuments, ragChunks, matched, ambiguous, gateSummary);
  const limitations = buildLimitations(counts);

  const catalog = {
    schemaVersion: 1,
    kind: 'oliduck-research-dataset',
    generatedAt,
    deterministic: true,
    idScheme: {
      official: 'oc-<edizioneSlug>-<challengeId>[-r<riga>: solo se l\'ID sorgente è duplicato]',
      community: 'cs-<evento>-<titolo-derivato-da-percorso>',
      note: 'Gli ID non vengono mai riassegnati in base a similarità di titolo.',
    },
    separationPolicy: {
      challengeCatalog: 'metadati e descrizioni derivate, senza testi di soluzione; non autorizzato per il tutor',
      learningKnowledgeBase: 'solo documenti ammessi dal gate di pubblicazione; testo senza percorsi sorgente, flag o soluzioni',
      solutionArchive: 'writeup, script e materiale didattico non verificato: local-only, non indicizzato per il tutor',
      publicExposure: 'nessuna sezione è pubblicata automaticamente; il catalogo applicativo non copia descrizioni derivate',
    },
    publicationGate: gateSummary,
    sources: REPOS.map((repo) => {
      const license = licenseByRepo.get(repo);
      return {
        name: repo,
        url: originToWeb(meta[repo].origin),
        commit: meta[repo].commit,
        committedAt: meta[repo].committedAt,
        license: license.name,
        licenseVerified: license.verified,
        licenseFile: license.file,
      };
    }),
    counts,
    challengeCatalog: {
      count: allChallenges.length,
      challenges: allChallenges,
    },
    learningKnowledgeBase: {
      count: kbDocuments.length,
      documents: kbDocuments,
    },
    solutionArchive: {
      count: solutionDocuments.length,
      restricted: true,
      exposePublicly: false,
      cloudflareUploadAllowed: false,
      documents: solutionDocuments,
    },
  };

  const ragIndex = {
    schemaVersion: 1,
    generatedAt,
    chunkSize: CHUNK_SIZE,
    overlap: CHUNK_OVERLAP,
    includedSections: ['learningKnowledgeBase'],
    excludedSections: ['solutionArchive'],
    status: ragChunks.length ? 'populated-not-runtime-connected' : 'empty-no-authorized-documents',
    runtimeConnected: false,
    gate: {
      defaultDecision: GATE_DEFAULT,
      admittedClassifications: [...TUTOR_ALLOWED_CLASSIFICATIONS],
      candidates: gateSummary.candidates,
      admitted: gateSummary.admitted,
      excluded: gateSummary.excluded,
    },
    filters: {
      challengeId: [...new Set(ragChunks.map((chunk) => chunk.challengeId).filter(Boolean))].sort(),
      category: [...new Set(ragChunks.map((chunk) => chunk.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it')),
      edition: [...new Set(ragChunks.map((chunk) => chunk.edition).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it')),
      classification: [...new Set(ragChunks.map((chunk) => chunk.classification).filter(Boolean))].sort(),
    },
    citationFields: [
      'sourceId',
      'sourcePath',
      'sourceRepository',
      'sourceCommit',
      'license',
      'provenanceType',
      'documentType',
      'sourceRefs',
    ],
    count: ragChunks.length,
    chunks: ragChunks,
    note: 'Struttura pronta per un futuro retrieval: nessun binding Workers AI o Vectorize è attivo e il runtime non carica questo indice.',
  };

  const manifest = {
    schemaVersion: 1,
    generatedAt,
    root: 'dataset-input/sources',
    repositories: REPOS.map((repo) => {
      const license = licenseByRepo.get(repo);
      return {
        name: repo,
        url: originToWeb(meta[repo].origin),
        commit: meta[repo].commit,
        committedAt: meta[repo].committedAt,
        license: license.name,
        licenseVerified: license.verified,
        licenseFile: license.file,
        licenseDetection: license.detection,
        files: files.filter((file) => file.repo === repo).length,
      };
    }),
    executionPolicy: 'nessun programma, script, binario o allegato delle fonti è stato eseguito',
    extractionPolicy: 'nessun archivio è stato estratto',
    duplicateGroups,
    files: manifestFiles,
  };

  const importReport = {
    schemaVersion: 1,
    generatedAt,
    status: 'derived-from-public-sources-unverified',
    purpose: 'report di provenienza del dataset di ricerca, non del catalogo ufficiale Training',
    sources: catalog.sources,
    counts,
    publicationGate: gateSummary,
    duplicates: {
      exactFileGroups: duplicateGroups.length,
      exactFileCopies: duplicateGroups.reduce((sum, group) => sum + group.paths.length - 1, 0),
      duplicateSourceChallengeIds: challenges.filter((challenge) => challenge.duplicateSourceId).map((challenge) => ({
        id: challenge.id,
        sourceChallengeId: challenge.sourceChallengeId,
        title: challenge.title,
      })),
      sharedWriteups: challenges
        .filter((challenge) => challenge.writeupPath)
        .reduce((acc, challenge) => {
          const key = challenge.writeups[0];
          acc.set(key, [...(acc.get(key) ?? []), challenge.id]);
          return acc;
        }, new Map()),
      ambiguousCommunityMatches: ambiguous,
      matchedCommunityCandidates: matched,
      unmatchedCommunityCandidates: unmatched.length,
    },
    verification: {
      catalogSourceRefsComplete: allChallenges.every((challenge) => challenge.sourceRefs.every((ref) => manifestByFinalPath.has(ref.path))),
      kbSourceRefsComplete: ragChunks.every((chunk) => chunk.sourceRefs.length > 0
        && chunk.sourceRefs.every((ref) => manifestByFinalPath.has(ref.path))
        && Boolean(chunk.sourceId && chunk.sourcePath && chunk.sourceRepository && chunk.sourceCommit && chunk.provenanceType && chunk.documentType)),
      noFlagsInCatalogOrKb: !catalogSerializedCheck.match(/flag\s*\{[^{}]+\}/i),
      noForbiddenContentInTutorCorpus: forbiddenInTutor.length === 0,
      placeholdersIntactInTutorCorpus: !/\[(?:FLAG|SEGRETO|TOKEN)RIMOSSA\]/i.test(tutorSerializedCheck),
      publicationGateDefaultDeny: GATE_DEFAULT === 'DENY',
      solutionsNotInPublic: solutionDocuments.every((doc) => doc.exposePublicly === false),
      solutionArchiveNotIndexed: ragChunks.every((chunk) => !chunk.docId.startsWith('sol-')),
      ragRuntimeNotConnected: ragIndex.runtimeConnected === false,
    },
    limitations,
  };
  importReport.duplicates.sharedWriteups = Object.fromEntries(
    [...importReport.duplicates.sharedWriteups.entries()].filter(([, ids]) => ids.length > 1),
  );

  mkdirSync(OUTPUT_DIR, { recursive: true });
  writeJson(path.join(OUTPUT_DIR, 'manifest.json'), manifest);
  writeJson(path.join(OUTPUT_DIR, 'catalog.json'), catalog);
  writeJson(path.join(OUTPUT_DIR, 'rag-index.json'), ragIndex);
  writeJson(path.join(OUTPUT_DIR, 'import-report.json'), importReport);
  writeAtomic(path.join(OUTPUT_DIR, 'REPORT.md'), `${renderReport(counts, catalog, importReport, manifest)}\n`);

  console.log(`Dataset generato: ${allChallenges.length} challenge, ${kbDocuments.length} documenti KB, ${ragChunks.length} chunk, ${solutionDocuments.length} documenti soluzione.`);
  console.log('Output: dataset-input/{REPORT.md,manifest.json,import-report.json,catalog.json,rag-index.json}');
}

function countBy(items, keyFn, flatten = false) {
  const counts = {};
  for (const item of items) {
    const raw = keyFn(item);
    const keys = flatten ? (Array.isArray(raw) ? raw : [raw]) : [raw];
    for (const key of keys) {
      if (key === null || key === undefined) continue;
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b, 'it')));
}

function buildCounts(files, challenges, officialRows, duplicateGroups, kbDocuments, solutionDocuments, ragChunks, matched, ambiguous, gateSummary) {
  const content = files.filter((file) => file.scope === 'content');
  const metadata = files.filter((file) => file.scope === 'repository-metadata');
  const missingFields = {};
  for (const challenge of challenges) {
    for (const field of challenge.missingFields) missingFields[field] = (missingFields[field] ?? 0) + 1;
  }
  const categories = new Set(challenges.map((item) => item.category).filter(Boolean));
  const editions = new Set(challenges.map((item) => item.edition).filter(Boolean));
  return {
    repositoriesAnalyzed: REPOS.length,
    filesExamined: files.length,
    contentFiles: content.length,
    repositoryMetadataFiles: metadata.length,
    challengesIdentified: challenges.length,
    officialRowsDiscovered: officialRows.length,
    officialUniqueSourceIds: new Set(officialRows.map((row) => row.sourceChallengeId).filter(Boolean)).size,
    officialChallengeRecords: challenges.filter((item) => item.sourceChallengeId).length,
    communityOnlyChallenges: challenges.filter((item) => !item.sourceChallengeId).length,
    matchedCommunityCandidates: matched,
    ambiguousCommunityMatches: ambiguous.length,
    officialDescriptions: challenges.filter((item) => item.description.official).length,
    derivedDescriptions: challenges.filter((item) => item.description.derived).length,
    officialWriteups: files.filter((file) => file.role === 'official-writeup').length,
    communitySolutionFiles: files.filter((file) => file.role === 'community-solution' || file.role === 'learning-material').length,
    solutionArchiveDocuments: solutionDocuments.length,
    attachments: files.filter((file) => file.role === 'attachment' && file.scope === 'content').length,
    categories: categories.size,
    categoryNames: [...categories].sort((a, b) => a.localeCompare(b, 'it')),
    editions: editions.size,
    editionNames: [...editions].sort((a, b) => a.localeCompare(b, 'it')),
    exactDuplicateFileGroups: duplicateGroups.length,
    exactDuplicateFileCopies: duplicateGroups.reduce((sum, group) => sum + group.paths.length - 1, 0),
    duplicateSourceChallengeIds: challenges.filter((item) => item.duplicateSourceId).length,
    unreadableFiles: files.filter((file) => !file.readable).length,
    unreadableContentFiles: content.filter((file) => !file.readable).length,
    archivesNotExtracted: files.filter((file) => file.archive).length,
    licenseVerifiedFiles: files.filter((file) => file.licenseVerified).length,
    licenseUnverifiedFiles: files.filter((file) => !file.licenseVerified).length,
    knowledgeBaseCandidates: gateSummary.candidates,
    knowledgeBaseDocumentsAuthorized: kbDocuments.length,
    knowledgeBaseDocumentsExcluded: gateSummary.excluded,
    knowledgeBaseDocuments: kbDocuments.length,
    ragChunks: ragChunks.length,
    missingFields,
  };
}

function buildLimitations(counts) {
  const limitations = [
    'Le fonti pubbliche non contengono il catalogo ufficiale completo: la completezza resta non verificabile senza export autorizzato.',
    `Tutte le ${counts.officialChallengeRecords} challenge ufficiali identificate hanno descrizione ufficiale assente; il testo presente nelle writeup è solo contesto derivato.`,
    'La repository community non dichiara licenza: nessun contenuto community deve essere pubblicato o caricato su Cloudflare senza autorizzazione.',
    'Gli allegati binari e gli archivi non sono stati eseguiti né estratti; la loro sicurezza non è stata verificata.',
    'Le soluzioni sono archive locali e non sono indicizzate per il tutor AI né accessibili da frontend o API pubbliche.',
    'L\'ID sorgente 726 compare due volte nel README ufficiale: i due record sono stati mantenuti distinti e segnalati.',
  ];
  if (counts.knowledgeBaseDocumentsAuthorized === 0) {
    limitations.push('Nessun documento supera il gate di pubblicazione: il corpus RAG autorizzato è vuoto e non è pronto per l\'integrazione del tutor.');
  }
  return limitations;
}

/**
 * Scrittura atomica: i test possono eseguire il builder in processi diversi.
 * Senza rename, un secondo builder e un hash in lettura possono intercettare
 * un file parzialmente scritto e far fallire il controllo di determinismo.
 */
function writeAtomic(file, content) {
  const temp = `${file}.tmp-${process.pid}-${process.hrtime.bigint()}`;
  try {
    writeFileSync(temp, content);
    renameSync(temp, file);
  } catch (error) {
    try { unlinkSync(temp); } catch { /* file già rimosso */ }
    throw error;
  }
}

function writeJson(file, value) {
  writeAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

function renderReport(counts, catalog, importReport, manifest) {
  const missingRows = Object.entries(counts.missingFields)
    .map(([field, count]) => `| ${field} | ${count} |`)
    .join('\n');
  const dupRows = importReport.duplicates.duplicateSourceChallengeIds
    .map((item) => `| ${item.id} | ${item.sourceChallengeId} | ${item.title} |`)
    .join('\n');
  return `# REPORT — acquisizione fonti pubbliche OliDuck

Generato in modo deterministico dall'ultimo commit delle fonti: \`${catalog.generatedAt}\`.

## 1. Sintesi

| Metrica | Valore |
| --- | ---: |
| Repository analizzate | ${counts.repositoriesAnalyzed} |
| File esaminati (inclusi metadati Git) | ${counts.filesExamined} |
| File di contenuto | ${counts.contentFiles} |
| File metadati repository (\`.git/\`) | ${counts.repositoryMetadataFiles} |
| Challenge identificate | ${counts.challengesIdentified} |
| Righe dell'indice ufficiale | ${counts.officialRowsDiscovered} |
| ID sorgente ufficiali unici | ${counts.officialUniqueSourceIds} |
| Challenge ufficiali dal README | ${counts.officialChallengeRecords} |
| Challenge solo community | ${counts.communityOnlyChallenges} |
| Candidati community agganciati a challenge ufficiali | ${counts.matchedCommunityCandidates} |
| Descrizioni ufficiali | ${counts.officialDescriptions} |
| Descrizioni derivate da writeup/soluzioni | ${counts.derivedDescriptions} |
| Writeup ufficiali | ${counts.officialWriteups} |
| File soluzione community | ${counts.communitySolutionFiles} |
| Documenti nel Solution Archive | ${counts.solutionArchiveDocuments} |
| Allegati | ${counts.attachments} |
| Categorie | ${counts.categories} |
| Edizioni | ${counts.editions} |
| Gruppi di duplicati esatti | ${counts.exactDuplicateFileGroups} |
| Copie duplicate esatte | ${counts.exactDuplicateFileCopies} |
| ID challenge sorgente duplicati | ${counts.duplicateSourceChallengeIds} |
| File non leggibili | ${counts.unreadableFiles} |
| Archivi non estratti | ${counts.archivesNotExtracted} |
| Candidati Knowledge Base | ${counts.knowledgeBaseCandidates} |
| Documenti KB ammessi dal gate | ${counts.knowledgeBaseDocumentsAuthorized} |
| Documenti KB esclusi dal gate | ${counts.knowledgeBaseDocumentsExcluded} |
| Chunk RAG autorizzati | ${counts.ragChunks} |

**Categorie:** ${counts.categoryNames.join(', ') || 'nessuna'}.

**Edizioni:** ${counts.editionNames.join(', ') || 'nessuna'}.

## 2. Fonti

${manifest.repositories.map((repo) => `- \`${repo.name}\` — ${repo.url} — commit \`${repo.commit}\` — licenza: **${repo.license}** — file: ${repo.files}`).join('\n')}

Nessuna richiesta di rete è stata effettuata durante l'analisi. Nessun programma, script, binario o allegato delle fonti è stato eseguito. L'unico archivio ZIP presente è stato inventariato e **non estratto**.

## 3. Separazione dei dati

- **Challenge Catalog** (\`catalog.json\`, chiave \`challengeCatalog\`): metadati, provenienza e descrizioni *derivate*. Nessun testo di soluzione; non autorizzato per il tutor.
- **Learning Knowledge Base** (\`catalog.json\`, chiave \`learningKnowledgeBase\`; indice in \`rag-index.json\`): solo documenti che superano il gate. Il testo non contiene righe \`Fonte:\`, percorsi sorgente, flag o passaggi risolutivi.
- **Solution Archive** (\`catalog.json\`, chiave \`solutionArchive\`): writeup ufficiali, script, soluzioni community e materiale didattico non verificato. \`exposePublicly: false\`, \`cloudflareUploadAllowed: false\`, non indicizzato per il tutor.

### Gate di pubblicazione

| Parametro | Valore |
| --- | --- |
| Decisione predefinita | \`${catalog.publicationGate.defaultDecision}\` |
| Classificazioni ammesse | ${catalog.publicationGate.admittedClassifications.join(', ') || 'nessuna'} |
| Candidati valutati | ${catalog.publicationGate.candidates} |
| Documenti ammessi | ${catalog.publicationGate.admitted} |
| Documenti esclusi | ${catalog.publicationGate.excluded} |

Motivi di esclusione: ${Object.entries(catalog.publicationGate.excludedByReason).map(([reason, count]) => `\`${reason}\` (${count})`).join(', ') || 'nessuno'}.

I percorsi sorgente restano nei campi strutturati \`sourceRefs\`, \`sourceId\`, \`sourcePath\`, \`sourceRepository\`, \`sourceCommit\`, \`license\`, \`provenanceType\` e \`documentType\`; non vengono serializzati nel testo dei chunk.

## 4. Descrizioni e provenienza

**Descrizioni ufficiali: ${counts.officialDescriptions}.** Le fonti disponibili non contengono il testo ufficiale delle challenge: contengono indici, writeup e soluzioni. Ogni challenge dichiara quindi \`description.official: null\`.

**Descrizioni derivate: ${counts.derivedDescriptions}** sono contrassegnate con percorso del file e metodo di estrazione. Non sono mai presentate come descrizioni ufficiali e non vengono copiate in \`description\` o \`statement\` dal catalogo applicativo derivato.

## 5. Duplicati e conflitti

### ID sorgente duplicati

| ID record | ID sorgente | Titolo |
| --- | --- | --- |
${dupRows || '| (nessuno) | | |'}

L'ID \`726\` compare due volte nel README ufficiale per due titoli diversi. I record sono stati mantenuti separati con ID stabili suffissati dal numero di riga; non è stata fatta alcuna scelta arbitraria.

### Duplicati esatti

Sono stati rilevati ${counts.exactDuplicateFileGroups} gruppi di file con contenuto identico (${counts.exactDuplicateFileCopies} copie aggiuntive). L'elenco completo è in \`manifest.json\`, chiave \`duplicateGroups\`.

### Writeup condivisi e agganci community

Alcuni writeup ufficiali coprono più challenge (per esempio \`2022-nazionale/binary2-3.md\`): il file è referenziato da più record senza unire le challenge. I candidati community sono stati agganciati solo in presenza di ID esplicito nel testo o di titolo normalizzato identico nella stessa edizione; i casi ambigui restano separati e segnalati in \`import-report.json\`.

## 6. Leggibilità e archivi

- File non leggibili come testo UTF-8: **${counts.unreadableFiles}** (di cui **${counts.unreadableContentFiles}** tra i file di contenuto). Sono immagini, binari, metadati Git o file con byte non testuali; vengono inventariati per hash e dimensione, senza interpretazione del contenuto.
- Archivi: **${counts.archivesNotExtracted}** (\`output\`, ZIP). Non estratti: contenuto e sicurezza non verificati.

## 7. Licenze e avvisi

- \`official-writeups\` dichiara **GPL-3.0** nel file \`LICENSE\`: il riutilizzo del dataset derivato deve conservare la medesima attribuzione/condizione.
- \`community-solutions\` **non dichiara alcuna licenza**. La licenza di ogni file è registrata come \`non verificata\`: non è lecito presumere un permesso di pubblicazione.
- Nessun file community, writeup completo, flag o soluzione è stato caricato su Cloudflare o incluso in \`public/\`.
- Il Solution Archive contiene flag reali presenti nelle fonti: resta un archivio locale ristretto.
- La licenza dei singoli allegati (immagini/binari) non è dichiarata separatamente: non ne è stato assunto il riutilizzo.

## 8. Informazioni mancanti

Conteggio per campo, calcolato sui record del Challenge Catalog:

| Campo mancante | Record |
| --- | ---: |
${missingRows || '| (nessuno) | 0 |'}

Il numero totale ufficiale delle challenge Training non è pubblico: questo dataset **non dimostra completezza**.

## 9. Verifica finale

| Controllo | Esito |
| --- | --- |
| Ogni challenge ha almeno un riferimento a un file esistente | ${importReport.verification.catalogSourceRefsComplete ? 'OK' : 'FALLITO'} |
| Ogni chunk RAG ha riferimenti strutturati risolvibili | ${importReport.verification.kbSourceRefsComplete ? 'OK' : 'FALLITO'} |
| Nessuna flag nel catalogo o nella knowledge base | ${importReport.verification.noFlagsInCatalogOrKb ? 'OK' : 'FALLITO'} |
| Nessun contenuto solutivo o flag-like nel corpus tutor | ${importReport.verification.noForbiddenContentInTutorCorpus ? 'OK' : 'FALLITO'} |
| Placeholder di redaction preservati | ${importReport.verification.placeholdersIntactInTutorCorpus ? 'OK' : 'FALLITO'} |
| Gate di pubblicazione con default DENY | ${importReport.verification.publicationGateDefaultDeny ? 'OK' : 'FALLITO'} |
| Soluzioni non esposte pubblicamente | ${importReport.verification.solutionsNotInPublic ? 'OK' : 'FALLITO'} |
| Solution Archive non indicizzato | ${importReport.verification.solutionArchiveNotIndexed ? 'OK' : 'FALLITO'} |
| RAG non collegato al runtime | ${importReport.verification.ragRuntimeNotConnected ? 'OK' : 'FALLITO'} |

## 10. Aggiornamenti ripetibili

Rieseguendo \`npm run dataset:build\` con una nuova versione delle fonti:

- gli ID sono derivati da percorso/ID sorgente e restano stabili;
- i file sono identificati per SHA-256, quindi i duplicati non vengono accumulati;
- gli output vengono riscritti integralmente in modo deterministico;
- \`npm run dataset:import\` produce un catalogo applicativo sanificato in \`dataset-input/derived/\` senza toccare \`public/data/\`;
- solo \`npm run dataset:import -- --apply\` sovrascrive esplicitamente il catalogo applicativo, con stato \`unverified-derived\`.

Lo stato dell'applicazione resta \`unverified-demo\` finché non viene fornito un export ufficiale autorizzato. Il corpus RAG autorizzato contiene **${counts.ragChunks} chunk**; ${counts.ragChunks === 0 ? 'essendo vuoto, non è pronto per l\'integrazione del tutor.' : 'resta comunque da collegare esplicitamente al runtime solo dopo revisione.'}
`;
}

main();
