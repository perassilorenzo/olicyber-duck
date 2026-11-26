import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => readFileSync(join(root, relativePath));
const text = (relativePath) => read(relativePath).toString('utf8');

function pngSize(buffer) {
  assert.equal(buffer.subarray(1, 4).toString('ascii'), 'PNG');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

test('logo ufficiale e derivate sono presenti e mantengono le proporzioni', () => {
  const original = read('public/assets/brand/oliduck-logo-original.jpg');
  assert.equal(original[0], 0xff);
  assert.equal(original[1], 0xd8);
  assert.ok(original.length > 100_000);

  const lockup = pngSize(read('public/assets/brand/oliduck-logo-lockup.png'));
  assert.deepEqual(lockup, { width: 481, height: 462 });
  const mark = pngSize(read('public/assets/brand/oliduck-logo-mark.png'));
  assert.deepEqual(mark, { width: 340, height: 340 });

  for (const name of ['apple-touch-icon.png', 'icon-192.png', 'icon-512.png']) {
    const icon = pngSize(read(`public/assets/brand/${name}`));
    assert.equal(icon.width, icon.height);
  }
  assert.ok(read('public/favicon.ico').length > 0);
});

test('il logo e le icone sono collegati nei punti appropriati', () => {
  const html = text('public/index.html');
  assert.match(html, /<link rel="icon" href="\/favicon\.ico" sizes="any" \/>/);
  assert.match(html, /href="\/assets\/brand\/icon-192\.png"/);
  assert.match(html, /href="\/assets\/brand\/apple-touch-icon\.png"/);
  assert.match(html, /class="brand-logo" src="\/assets\/brand\/oliduck-logo-lockup\.png" alt="OliDuck"/);
  assert.match(html, /class="panel__brand-mark" src="\/assets\/brand\/oliduck-logo-mark\.png"/);
  assert.match(html, /class="about-brand"/);

  const css = text('public/styles/main.css');
  assert.match(css, /object-fit: contain/);
  assert.match(css, /width: auto;\s*height: auto;/);
  assert.match(css, /--brand-logo: url\('\/assets\/brand\/oliduck-logo-lockup\.png'\)/);
  assert.match(css, /--brand-mark: url\('\/assets\/brand\/oliduck-logo-mark\.png'\)/);
  assert.doesNotMatch(css, /\.brand-mark/);

  const assistant = text('public/src/assistant.js');
  assert.match(assistant, /chat-message--greeting/);

  assert.match(text('README.md'), /public\/assets\/brand\/oliduck-logo-light\.jpg/);
  assert.match(text('docs/OLIDUCK-HANDBOOK.md'), /oliduck-logo-original\.jpg/);
});
