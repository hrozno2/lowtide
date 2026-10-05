/* Darlings — passages cut out of the manuscript and kept.
 *
 * "Murder your darlings" is advice about the sentence you love that is doing
 * the chapter no good. The hard part is not seeing it; it is deleting it. So
 * a darling is cut from the manuscript — really gone, out of the word count,
 * out of the page count — and kept whole somewhere you can get it back.
 *
 * Getting it back is the whole trick. An offset would rot the moment you
 * typed a line above it, and a marker left behind in the text would be
 * something foreign in a file that is supposed to be nothing but your words.
 * So a darling remembers the run of text on either side of the cut and finds
 * its way home by looking for that run again. Edit around it and it still
 * knows; rewrite the paragraph it came out of and it says so rather than
 * guessing.
 */

import { classifyLine, LINE } from './markup.js';

/** How much text is kept from each side of the cut. */
export const ANCHOR = 60;

/* Shorter and shorter looks, so a darling still goes home when the words at
   the seam have since been edited. The first is the exact cut closing up. */
const LADDER = [ANCHOR, 30, 14];

const tail = (s, n) => s.slice(Math.max(0, s.length - n));
const head = (s, n) => s.slice(0, n);

/** The words either side of a cut from `from` to `to`. */
export function anchorsFor(text, from, to) {
  return {
    before: text.slice(Math.max(0, from - ANCHOR), from),
    after: text.slice(to, to + ANCHOR)
  };
}

/**
 * Where in `text` a darling belongs now.
 * @returns {{ at: number, sure: boolean }} — `at` is -1 when its place is
 *   gone. `sure` is true only for the exact cut, closed up and found once:
 *   anything less is a good guess and the caller should say so.
 */
export function homeFor(text, { before = '', after = '' } = {}) {
  // The cut closing up exactly. Found once, that is certainly the place.
  if (before && after) {
    const seam = before + after;
    const at = text.indexOf(seam);
    if (at !== -1) return { at: at + before.length, sure: text.indexOf(seam, at + 1) === -1 };
  }

  /* One side only, shortening until it matches. Nearest the cut is the part
     most likely to have survived, so each step keeps the end of the text
     before and the start of the text after. */
  for (const n of LADDER) {
    if (before.length) {
      const part = tail(before, n);
      const at = text.indexOf(part);
      if (at !== -1 && text.indexOf(part, at + 1) === -1) return { at: at + part.length, sure: false };
    }
    if (after.length) {
      const part = head(after, n);
      const at = text.indexOf(part);
      if (at !== -1 && text.indexOf(part, at + 1) === -1) return { at, sure: false };
    }
  }
  return { at: -1, sure: false };
}

/**
 * The text to put back. Dropped where it was cut from, into text nobody has
 * touched since, the passage alone reproduces the paragraph exactly — so the
 * only thing to add is a space where putting it back would otherwise run two
 * words together, which can happen once the match is a near one.
 */
export function restoreText(text, at, body) {
  const before = at > 0 ? text[at - 1] : '';
  const after = at < text.length ? text[at] : '';
  const lead = before && !/\s/.test(before) && !/^\s/.test(body) ? ' ' : '';
  const trail = after && !/\s/.test(after) && !/\s$/.test(body) ? ' ' : '';
  return lead + body + trail;
}

/** The heading a position sits under, for saying where a darling came from.
 *  Asks the markup what a heading is rather than keeping a second rule. */
export function chapterAt(text, pos) {
  const upto = text.slice(0, pos).split('\n');
  for (let i = upto.length - 1; i >= 0; i--) {
    const info = classifyLine(upto[i]);
    if (info.type === LINE.heading) return (info.title || '').trim() || 'Untitled';
  }
  return '';
}

/** A darling, ready to keep. */
export function cutFrom(text, from, to, { now = Date.now() } = {}) {
  const body = text.slice(from, to);
  return {
    id: `d${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
    text: body,
    words: (body.trim().match(/\S+/g) || []).length,
    chapter: chapterAt(text, from),
    at: now,
    ...anchorsFor(text, from, to)
  };
}
