/**
 * Renderer Markdown sicuro per le risposte del tutor.
 *
 * Costruisce SEMPRE nodi DOM con createElement/createTextNode: nessun
 * innerHTML, insertAdjacentHTML o outerHTML. Il testo del modello resta un
 * dato: anche contenuto ostile può diventare solo testo, mai codice eseguibile.
 *
 * Supporta il sottoinsieme usato dal tutor: paragrafi, intestazioni, elenchi,
 * citazioni, blocchi di codice, grassetto, corsivo, codice inline e link HTTPS.
 * Normalizza gli escape letterali (\\*\\*testo\\*\\*) prodotti dai modelli che
 * "proteggono" la formattazione, così le risposte precedenti restano leggibili.
 */

const FENCE = /^\s{0,3}```\s*([a-zA-Z0-9+#._-]*)\s*$/;
const HEADING = /^\s{0,3}(#{1,6})\s+(.+)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;
const UL_ITEM = /^\s{0,3}([-*+])\s+(.+)$/;
const OL_ITEM = /^\s{0,3}\d+[.)]\s+(.+)$/;
const INLINE = /(`[^`]+`)|(\*\*[^*\n]+\*\*)|(__[^_\n]+__)|(\*[^*\n]+\*)|(_[^_\n]+_)|(\[[^\]\n]+\]\([^)\n]+\))/g;

/** Rende leggibili gli escape Markdown senza interpretare caratteri di controllo. */
export function normalizeMarkdown(value) {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\\([*_`~#\[\]()>])/g, '$1');
}

function isSafeUrl(url) {
  try {
    const parsed = new URL(url, 'https://oliduck.invalid');
    if (parsed.protocol !== 'https:') return null;
    // Blocca URL relativi e costruzioni con credenziali incorporate.
    if (!/^https:\/\//i.test(url) || parsed.username || parsed.password) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function appendInline(parent, text) {
  const source = normalizeMarkdown(text);
  let cursor = 0;
  // Regex locale: le chiamate ricorsive per grassetto/corsivo non devono
  // condividere lastIndex, altrimenti il ciclo ripete gli stessi match.
  const pattern = new RegExp(INLINE.source, INLINE.flags);
  let match;
  while ((match = pattern.exec(source)) !== null) {
    if (match.index > cursor) parent.append(document.createTextNode(source.slice(cursor, match.index)));
    const token = match[0];
    if (token.startsWith('`')) {
      const code = document.createElement('code');
      code.textContent = token.slice(1, -1);
      parent.append(code);
    } else if (token.startsWith('**') || token.startsWith('__')) {
      const strong = document.createElement('strong');
      appendInline(strong, token.slice(2, -2));
      parent.append(strong);
    } else if (token.startsWith('[')) {
      const divider = token.indexOf('](');
      const label = token.slice(1, divider);
      const href = isSafeUrl(token.slice(divider + 2, -1));
      if (href) {
        const link = document.createElement('a');
        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer nofollow';
        appendInline(link, label);
        parent.append(link);
      } else {
        // URL non sicuro: resta testo visibile, senza attributi navigabili.
        parent.append(document.createTextNode(token));
      }
    } else {
      const emphasis = document.createElement('em');
      appendInline(emphasis, token.slice(1, -1));
      parent.append(emphasis);
    }
    cursor = match.index + token.length;
  }
  if (cursor < source.length) parent.append(document.createTextNode(source.slice(cursor)));
}

function appendParagraph(parent, lines) {
  const paragraph = document.createElement('p');
  lines.forEach((line, index) => {
    if (index > 0) paragraph.append(document.createElement('br'));
    appendInline(paragraph, line);
  });
  parent.append(paragraph);
}

function appendList(parent, ordered, items) {
  const list = document.createElement(ordered ? 'ol' : 'ul');
  for (const item of items) {
    const li = document.createElement('li');
    appendInline(li, item);
    list.append(li);
  }
  parent.append(list);
}

/** Sostituisce tutto il contenuto di `container` con il Markdown renderizzato. */
export function renderMarkdownInto(container, value) {
  const source = normalizeMarkdown(value);
  const lines = source.split('\n');
  const target = document.createDocumentFragment();
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index += 1; continue; }

    const fence = line.match(FENCE);
    if (fence) {
      const body = [];
      index += 1;
      while (index < lines.length && !FENCE.test(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1; // chiusura del blocco
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      const language = fence[1] && /^[a-zA-Z0-9+#._-]{1,24}$/.test(fence[1]) ? fence[1] : '';
      if (language) code.classList.add(`language-${language}`);
      code.textContent = body.join('\n');
      pre.append(code);
      target.append(pre);
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      const level = Math.min(Math.max(heading[1].length + 2, 3), 6);
      const node = document.createElement(`h${level}`);
      appendInline(node, heading[2]);
      target.append(node);
      index += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted = [];
      while (index < lines.length && QUOTE.test(lines[index])) {
        quoted.push(lines[index].match(QUOTE)[1]);
        index += 1;
      }
      const blockquote = document.createElement('blockquote');
      appendInline(blockquote, quoted.join(' '));
      target.append(blockquote);
      continue;
    }

    const ordered = OL_ITEM.test(line);
    const bullet = ordered || UL_ITEM.test(line);
    if (bullet) {
      const pattern = ordered ? OL_ITEM : UL_ITEM;
      const items = [];
      while (index < lines.length && pattern.test(lines[index])) {
        items.push(lines[index].match(pattern)[2]);
        index += 1;
      }
      appendList(target, ordered, items);
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim()
      && !FENCE.test(lines[index]) && !HEADING.test(lines[index])
      && !QUOTE.test(lines[index]) && !UL_ITEM.test(lines[index]) && !OL_ITEM.test(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    appendParagraph(target, paragraph);
  }

  container.replaceChildren(target);
}
