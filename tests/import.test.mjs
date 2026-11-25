import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const script = new URL('../scripts/import-catalog.mjs', import.meta.url).pathname;

function runExport(records, extra = []) {
  const dir = mkdtempSync(join(tmpdir(), 'oliduck-import-'));
  const input = join(dir, 'export.json');
  const out = join(dir, 'challenges.json');
  const report = join(dir, 'report.json');
  writeFileSync(input, JSON.stringify({ challenges: records }));
  execFileSync(process.execPath, [
    script, '--file', input, '--out', out, '--report', report,
    '--source-name', 'Export autorizzato di test',
    ...extra,
  ], { encoding: 'utf8' });
  return {
    catalog: JSON.parse(readFileSync(out, 'utf8')),
    report: JSON.parse(readFileSync(report, 'utf8')),
  };
}

const sample = {
  id: 42,
  name: 'Challenge autorizzata',
  description: 'Testo ufficiale <br> con tag',
  category: 'web',
  value: 100,
  state: 'visible',
  tags: [{ value: 'HTTP' }, 'input'],
  files: [{ name: 'file.txt', url: 'https://example.invalid/file.txt' }],
  flag: 'flag{NON_DEVE_ESSERE_IMPORTATA}',
  writeup: 'soluzione completa',
};

test('l\'import autorizzato rimuove campi sensibili e conserva la provenienza', () => {
  const { catalog, report } = runExport([sample], ['--expected-total', '1']);
  assert.equal(catalog.status, 'verified-import');
  assert.equal(catalog.source.authorizedExportUsed, true);
  assert.equal(catalog.source.verified, true);
  assert.equal(catalog.completeness.imported, 1);
  assert.equal(report.verifiedAgainstSource, true);

  const challenge = catalog.challenges[0];
  assert.equal(challenge.id, 'olicyber-42');
  assert.equal(challenge.originalId, '42');
  assert.equal(challenge.title, 'Challenge autorizzata');
  assert.equal(challenge.description, 'Testo ufficiale \n con tag');
  assert.equal(challenge.score, 100);
  assert.equal(challenge.sourceUrl, 'https://training.olicyber.it/challenges/42');
  assert.deepEqual(challenge.provenance.verified, true);
  assert.deepEqual(challenge.metadata.ignoredSensitiveFields.sort(), ['flag', 'writeup']);

  const serialized = JSON.stringify(catalog);
  assert.equal(serialized.includes('NON_DEVE_ESSERE_IMPORTATA'), false);
  assert.equal(serialized.includes('soluzione completa'), false);
});

test('l\'import segnala duplicati e non dichiara completezza senza totale ufficiale', () => {
  const { catalog, report } = runExport([sample, { ...sample }]);
  assert.equal(catalog.status, 'imported-unverified');
  assert.equal(catalog.completeness.duplicates, 1);
  assert.equal(catalog.completeness.imported, 1);
  assert.equal(catalog.completeness.verifiedAgainstSource, false);
  assert.match(report.limitations.join(' '), /completezza non è verificabile/);
});

test('l\'import interrompe l\'elaborazione se rileva una flag nei campi autorizzati', () => {
  const dir = mkdtempSync(join(tmpdir(), 'oliduck-import-'));
  const input = join(dir, 'export.json');
  writeFileSync(input, JSON.stringify({
    challenges: [{ id: 1, name: 'Con flag', description: 'flag{segreta}' }],
  }));
  assert.throws(() => execFileSync(process.execPath, [
    script, '--file', input,
    '--out', join(dir, 'challenges.json'),
    '--report', join(dir, 'report.json'),
  ], { encoding: 'utf8' }));
});
