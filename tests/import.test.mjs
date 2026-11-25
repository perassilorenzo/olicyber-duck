import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { safeHttpsUrl } from '../public/src/url.js';

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

test('safeHttpsUrl accetta solo URL HTTPS assoluti', () => {
  assert.equal(safeHttpsUrl('https://example.invalid/file.txt'), 'https://example.invalid/file.txt');
  assert.equal(safeHttpsUrl(' HTTPS://EXAMPLE.invalid/x?a=1 '), 'https://example.invalid/x?a=1');
  for (const value of [
    'javascript:alert(1)', 'data:text/html;base64,PHNjcmlwdD4=', 'file:///etc/passwd',
    'http://example.invalid/x', '//example.invalid/x', '/challenges/42',
    'https://user:pass@example.invalid/x', '', null, undefined, 42,
  ]) {
    assert.equal(safeHttpsUrl(value), null, `URL non sicuro accettato: ${String(value)}`);
  }
});

test('l\'import scarta URL non HTTPS di fonti, allegati e provenienza', () => {
  const unsafe = {
    ...sample,
    url: 'javascript:alert(1)',
    files: [
      { name: 'pagina.html', url: 'data:text/html;base64,PHNjcmlwdD4=' },
      { name: 'locale.txt', url: 'file:///etc/passwd' },
      { name: 'chiaro.txt', url: 'http://example.invalid/chiaro' },
      { name: 'relativo.txt', url: '/challenges/42' },
      { name: 'sicuro.txt', url: 'https://example.invalid/sicuro' },
    ],
  };
  const { catalog } = runExport([unsafe], ['--expected-total', '1']);
  const challenge = catalog.challenges[0];
  assert.equal(challenge.sourceUrl, null);
  assert.equal(challenge.externalUrl, null);
  assert.equal(challenge.provenance.sourceUrl, null);
  assert.deepEqual(challenge.attachments.map((item) => item.url), [
    null, null, null, null, 'https://example.invalid/sicuro',
  ]);

  const serialized = JSON.stringify(catalog);
  for (const fragment of ['javascript:', 'data:text', 'file:///', 'http://']) {
    assert.equal(serialized.includes(fragment), false, `URL non sicuro presente nel catalogo: ${fragment}`);
  }
});

test('provenance.verified distingue completezza del catalogo e verifica del record', () => {
  const verified = runExport([sample], ['--expected-total', '1']);
  const provenance = verified.catalog.challenges[0].provenance;
  assert.equal(provenance.verified, true);
  assert.equal(provenance.catalogVerified, true);
  assert.equal(provenance.recordVerified, false);
  assert.equal(provenance.verificationScope, 'catalog-completeness');
  assert.match(verified.report.limitations.join(' '), /singolo record non è automatica/);

  const unverified = runExport([sample]);
  const pending = unverified.catalog.challenges[0].provenance;
  assert.equal(pending.verified, false);
  assert.equal(pending.catalogVerified, false);
  assert.equal(pending.recordVerified, false);
  assert.equal(unverified.catalog.source.verified, false);
  assert.equal(unverified.report.verifiedAgainstSource, false);
});

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
