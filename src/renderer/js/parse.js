import { classifyLine, scanInline, countWords, LINE } from './markup.js';

export const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function stripComments(text) {
  return text.indexOf('/*') === -1 ? text : text.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, '');
}

/* ------------------------------------------------------------------ outline */

/** Headings with per-section word counts, in document order. */
export function outline(text) {
  const lines = text.split('\n');
  const items = [];
  let offset = 0;
  const starts = [];

  for (let i = 0; i < lines.length; i++) {
    const info = classifyLine(lines[i]);
    if (info.type === LINE.heading) {
      items.push({ level: info.level, title: info.title || 'Untitled', line: i, from: offset, words: 0 });
      starts.push(i);
    }
    offset += lines[i].length + 1;
  }

  for (let k = 0; k < items.length; k++) {
    const from = starts[k] + 1;
    const to = k + 1 < items.length ? starts[k + 1] : lines.length;
    items[k].words = countWords(lines.slice(from, to).join('\n'));
  }
  return items;
}

/* ------------------------------------------------------------------ inline */

function wrap(cls, inner) {
  if (cls === 'm-bold') return `<strong>${inner}</strong>`;
  if (cls === 'm-italic') return `<em>${inner}</em>`;
  if (cls === 'm-bolditalic') return `<strong><em>${inner}</em></strong>`;
  if (cls === 'm-underline') return `<u>${inner}</u>`;
  if (cls === 'm-strike') return `<s>${inner}</s>`;
  return inner;
}

function inlineHtml(text, showNotes) {
  const events = [];
  scanInline(text, (a, b, cls) => events.push([a, b, cls]));
  if (!events.length) return esc(text);

  let out = '';
  let last = 0;
  for (const [a, b, cls] of events) {
    if (a > last) out += esc(text.slice(last, a));
    if (cls === 'm-marker') {
      /* markup characters are dropped from the manuscript */
    } else if (cls.indexOf('m-note') > -1) {
      if (showNotes && cls === 'm-note') out += `<span class="note">${esc(text.slice(a, b))}</span>`;
    } else {
      out += wrap(cls, esc(text.slice(a, b)));
    }
    last = b;
  }
  if (last < text.length) out += esc(text.slice(last));
  return out;
}

/* ------------------------------------------------------------ front matter */

const META_KEYS = new Set([
  'title', 'credit', 'author', 'authors', 'source', 'draft date', 'date',
  'contact', 'copyright', 'notes', 'series'
]);

const META_RE = /^([A-Za-z][A-Za-z ]{0,18}):[ \t]*(.*)$/;

/** True when a line looks like a title-page `Key: Value` pair. */
export function metaLine(text) {
  const m = META_RE.exec(text);
  if (!m || !META_KEYS.has(m[1].trim().toLowerCase())) return null;
  return { keyTo: m[1].length + 1 };
}

/** Fountain-style `Key: Value` block at the very top of the document. */
export function frontMatter(text) {
  const lines = text.split('\n');
  const meta = {};
  let i = 0;
  while (i < lines.length) {
    const m = META_RE.exec(lines[i]);
    if (!m || !META_KEYS.has(m[1].trim().toLowerCase())) break;
    meta[m[1].trim().toLowerCase()] = m[2].trim();
    i++;
  }
  if (!i) return { meta: {}, bodyLine: 0, bodyOffset: 0 };
  while (i < lines.length && !lines[i].trim()) i++;
  let bodyOffset = 0;
  for (let k = 0; k < i; k++) bodyOffset += lines[k].length + 1;
  return { meta, bodyLine: i, bodyOffset: Math.min(bodyOffset, text.length) };
}

/* --------------------------------------------------------- structured doc */

const RUN_STYLE = {
  'm-bold': { bold: true },
  'm-italic': { italic: true },
  'm-bolditalic': { bold: true, italic: true },
  'm-underline': { underline: true },
  'm-strike': { strike: true }
};

function runsFor(text, showNotes) {
  const events = [];
  scanInline(text, (a, b, cls) => events.push([a, b, cls]));
  const runs = [];
  const push = (slice, style) => {
    if (!slice) return;
    runs.push(Object.assign({ text: slice }, style || {}));
  };

  let last = 0;
  for (const [a, b, cls] of events) {
    if (a > last) push(text.slice(last, a));
    if (cls === 'm-marker') {
      /* markup characters never reach the page */
    } else if (cls.indexOf('m-note') > -1) {
      if (showNotes && cls === 'm-note') push(text.slice(a, b), { italic: true });
    } else {
      push(text.slice(a, b), RUN_STYLE[cls]);
    }
    last = b;
  }
  if (last < text.length) push(text.slice(last));
  return runs.length ? runs : [{ text: '' }];
}

/**
 * The manuscript as blocks and styled runs — the shape a Word file needs.
 */
export function documentBlocks(text, opts = {}) {
  const showNotes = !!opts.notes;
  const clean = stripComments(text);
  const { bodyLine } = frontMatter(clean);
  const lines = clean.split('\n').slice(bodyLine);

  const blocks = [];
  let flushNext = true;

  for (const raw of lines) {
    const info = classifyLine(raw);
    const body = raw.slice(info.contentFrom);

    switch (info.type) {
      case LINE.blank:
        break;
      case LINE.pagebreak:
        blocks.push({ type: 'pagebreak' });
        flushNext = true;
        break;
      case LINE.divider:
        blocks.push({ type: 'center', runs: [{ text: '#' }] });
        flushNext = true;
        break;
      case LINE.heading:
        blocks.push({
          type: `h${Math.min(info.level, 3)}`,
          runs: runsFor(info.title || '', showNotes)
        });
        flushNext = true;
        break;
      case LINE.list:
        blocks.push({ type: 'list', runs: [{ text: '\u2022 ' }].concat(runsFor(info.title || '', showNotes)) });
        flushNext = true;
        break;
      case LINE.center:
        blocks.push({ type: 'center', runs: runsFor(body.replace(/\s*<\s*$/, ''), showNotes) });
        flushNext = true;
        break;
      case LINE.right:
        blocks.push({ type: 'right', runs: runsFor(body, showNotes) });
        flushNext = true;
        break;
      default: {
        if (!raw.trim()) break;
        blocks.push({ type: 'p', indent: !flushNext, runs: runsFor(raw, showNotes) });
        flushNext = false;
      }
    }
  }
  return blocks;
}

/* ------------------------------------------------------------------ pages */

/**
 * Render the document as manuscript pages.
 * Returns [{ html, chapter }] so callers can add running headers.
 */
export function pagesHtml(text, opts = {}) {
  const showNotes = !!opts.notes;
  const clean = stripComments(text);
  const { bodyLine } = opts.skipFrontMatter === false ? { bodyLine: 0 } : frontMatter(clean);
  const lines = clean.split('\n').slice(bodyLine);

  const pages = [];
  let page = [];
  let chapter = opts.title || '';
  let pageChapter = chapter;
  let firstOnPage = true;
  // Manuscript convention: the first paragraph after a heading or a scene
  // break sits flush left, every following one is indented.
  let flushNext = true;

  const flush = () => {
    if (page.length) pages.push({ html: page.join('\n'), chapter: pageChapter });
    page = [];
    pageChapter = chapter;
    firstOnPage = true;
    flushNext = true;
  };

  let idx = -1;
  for (const raw of lines) {
    idx++;
    // The source line this block came from, so the editor can mark where a
    // page begins. Zero-based, counted over the whole document.
    const L = ` data-line="${bodyLine + idx}"`;
    const info = classifyLine(raw);
    const body = raw.slice(info.contentFrom);

    switch (info.type) {
      case LINE.blank:
        break;

      case LINE.pagebreak:
        flush();
        break;

      case LINE.divider:
        page.push(`<hr${L}>`);
        flushNext = true;
        break;

      case LINE.heading: {
        // A chapter head does not start a new page: Highland flows it on,
        // with its own space above (see the h1 margin), and the running head
        // changes from the next page.
        if (info.level === 1) {
          chapter = info.title || '';
          if (!page.length) pageChapter = chapter;
        }
        const tag = `h${Math.min(info.level, 3)}`;
        const cls = info.level === 1 && firstOnPage ? ' class="first"' : '';
        page.push(`<${tag}${cls}${L}>${inlineHtml(info.title || '', showNotes)}</${tag}>`);
        firstOnPage = false;
        flushNext = true;
        break;
      }

      case LINE.list:
        page.push(`<p class="list"${L}>• ${inlineHtml(info.title || '', showNotes)}</p>`);
        firstOnPage = false;
        flushNext = true;
        break;

      case LINE.center:
        page.push(`<p class="center"${L}>${inlineHtml(body.replace(/\s*<\s*$/, ''), showNotes)}</p>`);
        firstOnPage = false;
        flushNext = true;
        break;

      case LINE.right:
        page.push(`<p class="right"${L}>${inlineHtml(body, showNotes)}</p>`);
        firstOnPage = false;
        flushNext = true;
        break;

      default: {
        const html = inlineHtml(raw, showNotes).trim();
        if (!html) break;
        page.push(`<p${flushNext ? ' class="flush"' : ''}${L}>${html}</p>`);
        firstOnPage = false;
        flushNext = false;
      }
    }
  }
  flush();
  return pages.length ? pages : [{ html: '<p class="flush"></p>', chapter }];
}

export function titlePageHtml(meta, fallbackTitle) {
  const title = meta.title || fallbackTitle || 'Untitled';
  const author = meta.author || meta.authors || meta.credit || '';
  const contact = meta.contact || '';
  const date = meta['draft date'] || meta.date || '';
  return `<div class="title-block">
      <h1 class="title">${esc(title)}</h1>
      ${author ? `<p class="by">by</p><p class="author">${esc(author)}</p>` : ''}
    </div>
    <div class="title-foot">
      ${date ? `<p>${esc(date)}</p>` : ''}
      ${contact ? `<p>${esc(contact)}</p>` : ''}
    </div>`;
}

/** Unpaginated preview markup — kept for callers that do not measure. */
export function previewBody(text, opts = {}) {
  const { meta } = frontMatter(stripComments(text));
  const pages = pagesHtml(text, opts);
  const out = [];
  let n = 0;

  if (opts.titlePage) {
    out.push(`<article class="page title-page">${titlePageHtml(meta, opts.title)}</article>`);
  }
  for (const page of pages) {
    n++;
    const header = n > 1
      ? `<header class="page-head"><span>${esc(page.chapter || '')}</span><span>${n}</span></header>`
      : '<header class="page-head"></header>';
    out.push(`<article class="page">${header}${page.html}</article>`);
  }
  return out.join('\n');
}

const PRINT_SHEETS = {
  '6x9': { css: '6in 9in', h: 9 },
  '5.5x8.5': { css: '5.5in 8.5in', h: 8.5 },
  letter: { css: 'Letter', h: 11 },
  a4: { css: 'A4', h: 11.69 }
};

/** Stand-alone HTML for print / PDF / HTML export. */
export function printHtml(text, docMeta = {}, opts = {}) {
  const { meta } = frontMatter(stripComments(text));
  const title = meta.title || docMeta.title || 'Untitled';
  const given = opts.template || {};
  const tpl = Object.assign(
    { pageSize: 'a4', margin: 1, fontSize: 13, leading: 1.6, justify: true, hyphenate: false }, given);
  // A template that names only `margin` means it for every side; the
  // defaults are Highland's page, wider at the sides and shorter below.
  if (tpl.sideMargin == null) tpl.sideMargin = given.margin != null ? tpl.margin : 1.46;
  if (tpl.bottomMargin == null) tpl.bottomMargin = given.margin != null ? tpl.margin : 1;
  const sheet = PRINT_SHEETS[tpl.pageSize] || PRINT_SHEETS.a4;
  const textHeight = `calc(${sheet.h}in - ${tpl.margin + tpl.bottomMargin}in)`;
  // The PDF is printed from a file on this machine, so it can reach the
  // bundled face; an HTML file may travel, so it is left to the reader's fonts.
  const faces = opts.fontBase ? [
    ['am-400', 'normal', 400], ['am-700', 'normal', 700],
    ['am-italic-400', 'italic', 400], ['am-italic-700', 'italic', 700]
  ].map(([f, style, weight]) =>
    `@font-face { font-family: "Amiri"; font-style: ${style}; font-weight: ${weight}; src: url("${opts.fontBase}${f}.woff2") format("woff2"); }`
  ).join('\n  ') : '';
  const pages = pagesHtml(text, opts);

  let n = 0;
  const body = pages.map((page) => {
    n++;
    return `<section class="sheet${n === 1 ? ' first' : ''}">${page.html}</section>`;
  }).join('\n');

  const titlePage = opts.titlePage
    ? `<section class="sheet title-page">${titlePageHtml(meta, title)}</section>`
    : '';

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  ${faces}
  @page { size: ${sheet.css}; margin: ${tpl.margin}in ${tpl.sideMargin}in ${tpl.bottomMargin}in; }
  html { background: #fff; }
  /* The same setting as the preview's page, so what prints is what was shown. */
  body { margin: 0; color: #000;
         font-family: Amiri, "Hoefler Text", "Iowan Old Style", Palatino, Georgia, "Liberation Serif", serif;
         font-size: ${tpl.fontSize}pt; line-height: ${tpl.leading};
         ${tpl.hyphenate ? 'hyphens: auto; -webkit-hyphens: auto; hyphenate-limit-chars: 6 3 3;' : ''}
         text-rendering: optimizeLegibility; font-kerning: normal; }
  .sheet { page-break-after: always; position: relative; }
  .sheet:last-child { page-break-after: auto; }
  h1 { font-size: 1.846em; font-weight: 400; font-style: italic; text-align: center;
       margin: 1.71in 0 .77em; line-height: 1.76; }
  h2 { font-size: 1.385em; font-weight: 400; text-align: center; margin: 0 0 .63em; line-height: 1.76; }
  h3 { font-size: 1.1em; font-weight: 400; font-style: italic; margin: .3in 0 .1in; }
  h1 + p, h2 + p, h3 + p { text-indent: 0; }
  h1 + p::first-line, h2 + p::first-line { font-variant-caps: small-caps; }
  p  { margin: 0; text-indent: .25in; text-align: ${tpl.justify ? 'justify' : 'left'};
       orphans: 2; widows: 2; }
  p.cont { text-indent: 0; }
  p.flush { text-indent: 0; }
  p.center { text-align: center; text-indent: 0; }
  p.right { text-align: right; text-indent: 0; }
  p.list { text-indent: -.22in; padding-left: .5in; text-align: left; }
  hr { border: 0; text-align: center; margin: .3in 0; }
  hr::before { content: '***'; letter-spacing: .1em; }
  .note { color: #7a6a2a; font-style: italic; }
  .title-page { display: flex; flex-direction: column; justify-content: center;
                height: ${textHeight}; text-align: center; page-break-after: always; }
  .title-page h1 { font-style: normal; }
  .title-page h1.title { margin: 0 0 .5in; font-size: 18pt; letter-spacing: .06em; }
  .title-page .by { margin: 0; font-size: 12pt; text-indent: 0; }
  .title-page .author { margin: .1in 0 0; font-size: 13pt; text-indent: 0; }
  .title-foot { margin-top: 1.2in; font-size: 11pt; line-height: 1.5; }
  .title-foot p { text-indent: 0; text-align: center; margin: 0; }
</style></head>
<body>
${titlePage}
${body}
</body></html>`;
}

export { countWords };
