/* Low Tide markup — a small superset of plain text.
 *
 *   # Chapter One            headings, levels 1–4
 *   > centered text <        centered
 *   > right                  flush right
 *   ===                      page break
 *   ***  or  ---             scene break
 *   **bold**  *italic*  _underline_  ~~strike~~  ***both***
 *   [[a note to self]]       notes (excluded from word count and print)
 *   /* omitted text *​/       block comment (excluded everywhere)
 *
 * Everything here works on plain strings so the same rules drive the live
 * editor, the navigator, the statistics and the print preview.
 */

export const LINE = {
  blank: 'blank',
  heading: 'heading',
  center: 'center',
  right: 'right',
  pagebreak: 'pagebreak',
  divider: 'divider',
  list: 'list',
  body: 'body'
};

const RE_HEADING = /^(#{1,4})([ \t]+)(.*)$/;
/* A line of nothing but hashes is a heading with its title not typed yet.
   Without this it counts as body text, so editing the hashes of an existing
   heading collapses the line to body height and springs it back — the text
   jumps under the caret while you are working on it. */
const RE_HEADING_BARE = /^(#{1,4})([ \t]*)$/;
const RE_CENTER = /^(>)([ \t]*)(.*?)([ \t]*)(<)[ \t]*$/;
const RE_RIGHT = /^(>)([ \t]+)(\S.*?)[ \t]*$/;
const RE_PAGEBREAK = /^(?:={3,}|-{3,})[ \t]*$/;
const RE_DIVIDER = /^(?:\*[ \t]*){3,}[ \t]*$|^~{3,}[ \t]*$/;
const RE_LIST = /^([ \t]*)([-+*\u2022\u2013\u2014]|\d{1,3}[.)])([ \t]+)(.*)$/;

/** Classify one line. Returns the block type plus any leading marker span. */
export function classifyLine(text) {
  if (!text.trim()) return { type: LINE.blank, level: 0, markerTo: 0, contentFrom: 0 };

  let m = RE_HEADING.exec(text) || RE_HEADING_BARE.exec(text);
  if (m) {
    return {
      type: LINE.heading,
      level: m[1].length,
      markerTo: m[1].length + m[2].length,
      contentFrom: m[1].length + m[2].length,
      title: (m[3] || '').trim()
    };
  }
  if (RE_PAGEBREAK.test(text)) return { type: LINE.pagebreak, level: 0, markerTo: 0, contentFrom: 0 };
  if (RE_DIVIDER.test(text)) return { type: LINE.divider, level: 0, markerTo: 0, contentFrom: 0 };

  m = RE_CENTER.exec(text);
  if (m) {
    const openTo = m[1].length + m[2].length;
    return {
      type: LINE.center, level: 0,
      markerTo: openTo, contentFrom: openTo,
      contentTo: openTo + m[3].length,
      closeFrom: text.length - (text.length - (openTo + m[3].length + m[4].length))
    };
  }
  m = RE_RIGHT.exec(text);
  if (m) {
    const openTo = m[1].length + m[2].length;
    return { type: LINE.right, level: 0, markerTo: openTo, contentFrom: openTo };
  }
  m = RE_LIST.exec(text);
  if (m) {
    const openTo = m[1].length + m[2].length + m[3].length;
    return { type: LINE.list, level: 0, markerTo: openTo, contentFrom: openTo, title: m[4] };
  }
  return { type: LINE.body, level: 0, markerTo: 0, contentFrom: 0 };
}

/* ------------------------------------------------------------------ inline */

const EMPH = { '*': true, '_': true, '~': true };

function runLength(text, i, ch) {
  let j = i;
  while (j < text.length && text[j] === ch) j++;
  return j - i;
}

/**
 * Walk a string emitting emphasis / note spans.
 * `emit(from, to, cls)` is called with offsets relative to `text`.
 * Marker characters are emitted separately so they can be dimmed.
 */
export function scanInline(text, emit) {
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];

    if (c === '\\') { i += 2; continue; }

    if (c === '[' && text[i + 1] === '[') {
      const end = text.indexOf(']]', i + 2);
      if (end > -1) {
        emit(i, i + 2, 'm-note m-note-marker');
        if (end > i + 2) emit(i + 2, end, 'm-note');
        emit(end, end + 2, 'm-note m-note-marker');
        i = end + 2;
        continue;
      }
    }

    if (EMPH[c]) {
      const len = Math.min(runLength(text, i, c), c === '*' ? 3 : 2);
      const closer = findCloser(text, i + len, c, len);
      if (closer > -1) {
        const cls = classFor(c, len);
        emit(i, i + len, 'm-marker');
        emit(i + len, closer, cls);
        emit(closer, closer + len, 'm-marker');
        i = closer + len;
        continue;
      }
      i += len;
      continue;
    }

    i++;
  }
}

function classFor(ch, len) {
  if (ch === '_') return 'm-underline';
  if (ch === '~') return len >= 2 ? 'm-strike' : 'm-strike';
  if (len >= 3) return 'm-bolditalic';
  if (len === 2) return 'm-bold';
  return 'm-italic';
}

function findCloser(text, from, ch, len) {
  if (from >= text.length) return -1;
  if (text[from] === ' ' || text[from] === '\t') return -1;   // "3 * 4 * 5" is arithmetic
  for (let j = from; j < text.length; j++) {
    if (text[j] === '\\') { j++; continue; }
    if (text[j] !== ch) continue;
    const run = runLength(text, j, ch);
    if (run >= len && j > from && text[j - 1] !== ' ' && text[j - 1] !== '\t') return j;
    j += run - 1;
  }
  return -1;
}

/* ---------------------------------------------------------------- comments */

/** Blank out /* … *​/ regions, preserving length and line breaks. */
export function maskComments(text) {
  if (text.indexOf('/*') === -1) return text;
  return text.replace(/\/\*[\s\S]*?(?:\*\/|$)/g, (m) => m.replace(/[^\n]/g, ' '));
}

/** Character ranges covered by block comments. */
export function commentRanges(text) {
  const out = [];
  if (text.indexOf('/*') === -1) return out;
  const re = /\/\*[\s\S]*?(?:\*\/|$)/g;
  let m;
  while ((m = re.exec(text))) {
    out.push([m.index, m.index + m[0].length]);
    if (re.lastIndex === m.index) re.lastIndex++;
  }
  return out;
}

/* ------------------------------------------------------------------- words */

const NON_WORD_HIGH = new Set([
  0x00ab, 0x00bb, 0x2010, 0x2011, 0x2012, 0x2013, 0x2014, 0x2015,
  0x2018, 0x2019, 0x201a, 0x201c, 0x201d, 0x201e, 0x2026, 0x2032, 0x2033,
  0x00a0, 0x2028, 0x2029, 0x3000
]);

function isWordChar(code) {
  if (code > 47 && code < 58) return true;                 // 0-9
  if (code > 64 && code < 91) return true;                 // A-Z
  if (code > 96 && code < 123) return true;                // a-z
  if (isJoiner(code)) return true;
  if (code < 128) return false;
  return !NON_WORD_HIGH.has(code);
}

// Apostrophes hold a word together but can never begin one, so "it's" counts
// once and a leading quote counts not at all. Hyphens deliberately separate,
// "well-known" counts as two words.
function isJoiner(code) {
  return code === 39 || code === 0x2019;                   // ' ’
}

/**
 * Word count over prose only: markup characters, notes and comments are
 * skipped. Single pass, no allocation — safe to run on a whole novel.
 */
export function countWords(text) {
  let count = 0, inWord = false, i = 0;
  const n = text.length;
  while (i < n) {
    const c = text.charCodeAt(i);

    if (c === 47 && text.charCodeAt(i + 1) === 42) {        // /*
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      inWord = false;
      continue;
    }
    if (c === 91 && text.charCodeAt(i + 1) === 91) {        // [[
      const end = text.indexOf(']]', i + 2);
      i = end === -1 ? n : end + 2;
      inWord = false;
      continue;
    }
    if (isWordChar(c)) {
      if (!inWord && !isJoiner(c)) { count++; inWord = true; }
    } else {
      inWord = false;
    }
    i++;
  }
  return count;
}

/** Plain prose for a single line — markers removed. */
export function stripMarkup(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\[\[[\s\S]*?\]\]/g, '')
    .replace(/^#{1,4}\s+/, '')
    .replace(/^[ \t]*(?:[-+*\u2022]|\d{1,3}[.)])[ \t]+/, '')
    .replace(/^>\s*/, '')
    .replace(/\s*<\s*$/, '')
    .replace(/\*{1,3}(.+?)\*{1,3}/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/\\(.)/g, '$1')
    .trim();
}
