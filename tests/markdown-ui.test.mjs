import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

import { renderMarkdownInto, normalizeMarkdown } from '../public/src/markdown.js';

test('12: Markdown visualizzato correttamente, escape normalizzati e nessun HTML iniettato', () => {
  const dom = new JSDOM('<!doctype html><div id="out"></div>');
  globalThis.document = dom.window.document;
  const out = globalThis.document.getElementById('out');
  const source = '\\*\\*testo\\*\\* e **grassetto** con *corsivo* e `codice`.\n\n'
    + '- primo\n- secondo\n\n```html\n<img src=x onerror=alert(1)>\n```\n\n'
    + '[sicuro](https://example.org/docs) [pericoloso](javascript:alert(1))';
  renderMarkdownInto(out, source);

  assert.equal(normalizeMarkdown('\\*\\*grassetto\\*\\*'), '**grassetto**');
  assert.equal(out.querySelector('strong')?.textContent, 'testo');
  assert.ok([...out.querySelectorAll('strong')].some((node) => node.textContent === 'grassetto'));
  assert.ok([...out.querySelectorAll('em')].some((node) => node.textContent === 'corsivo'));
  assert.equal(out.querySelector('code')?.textContent, 'codice');
  assert.equal(out.querySelectorAll('li').length, 2);
  assert.equal(out.querySelectorAll('img, script, iframe').length, 0);
  assert.equal(out.querySelector('pre code').textContent, '<img src=x onerror=alert(1)>');
  const links = [...out.querySelectorAll('a')];
  assert.equal(links.length, 1);
  assert.equal(links[0].href, 'https://example.org/docs');
  assert.match(links[0].rel, /noopener/);
  assert.equal(out.textContent.includes('javascript:alert(1)'), true);
  assert.equal(out.innerHTML.includes('<img'), false);

  // Testo semplice: nessuna formattazione e contenuto invariato (compatibilità).
  renderMarkdownInto(out, 'Risposta semplice senza Markdown.');
  assert.equal(out.textContent, 'Risposta semplice senza Markdown.');
  assert.equal(out.children.length, 1);
  dom.window.close();
});
