/* Covers for the shelf.
 *
 * Every manuscript on the shelf gets a cover, and none of them is a picture of
 * a cover someone else designed: the art is painted from a number derived from
 * the document's own path, so a book always looks like itself, on this machine
 * and the next, with nothing stored and nothing to download. Rename the file
 * and it gets a new face — which is the right behaviour, because by then it is
 * a different book to you.
 *
 * Two layers, as a real cover has. The art is an abstract in a palette the
 * seed chose. The type is real text drawn over it, never part of the picture,
 * so a title stays sharp at any size, reads out loud to a screen reader, and
 * costs nothing to re-set when you retitle the thing.
 *
 * SVG rather than a canvas: it scales, it theme-switches, and it can be
 * tested, which a bitmap cannot.
 */

/* The tile these are drawn for. Everything below is in these units, and the
   shelf scales the whole thing with CSS. */
export const W = 200;
export const H = 300;

/* ----------------------------------------------------------------- chance */

/* A string to a number, the same number every time, on every machine. FNV-1a:
   short, well spread, and no dependency. */
export function seedOf(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < String(str).length; i++) {
    h ^= String(str).charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** A sequence of numbers in [0, 1) that depends only on the seed. */
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (r, list) => list[Math.floor(r() * list.length)];
const between = (r, a, b) => a + r() * (b - a);

/* --------------------------------------------------------------- palettes */

/* One hue decides a cover. Most sit on a deep ground, because most books do;
   a few go pale, so a shelf is not a row of the same weight. */
export function paletteFor(seed) {
  const r = rng(seed ^ 0x9e3779b9);
  const base = Math.floor(r() * 360);
  const scheme = pick(r, ['analogous', 'split', 'mono', 'duotone']);
  const sat = between(r, 26, 58);
  const dark = r() < 0.72;
  const hsl = (h, s, l) => `hsl(${(((h % 360) + 360) % 360).toFixed(0)}, ${s.toFixed(0)}%, ${l.toFixed(0)}%)`;

  const hues = scheme === 'analogous' ? [base, base + 28, base - 24]
             : scheme === 'split' ? [base, base + 152, base + 208]
             : scheme === 'mono' ? [base, base + 7, base - 7]
             : [base, base + 180, base + 180];

  return {
    dark,
    scheme,
    ground: hsl(hues[0], sat * 0.8, dark ? between(r, 9, 20) : between(r, 80, 92)),
    deep: hsl(hues[1], sat * 0.7, dark ? between(r, 5, 14) : between(r, 70, 84)),
    mid: hsl(hues[1], sat, dark ? between(r, 30, 46) : between(r, 46, 62)),
    accent: hsl(hues[2], Math.min(92, sat * 1.7), dark ? between(r, 52, 68) : between(r, 38, 52)),
    /* Type sits on the ground, so its colour is decided by the ground, not by
       taste: near-white on a deep cover, near-black on a pale one. */
    ink: dark ? hsl(hues[0], 14, 95) : hsl(hues[0], 30, 12),
    inkSoft: dark ? hsl(hues[0], 12, 76) : hsl(hues[0], 22, 36)
  };
}

/* ------------------------------------------------------------------- art */

/* Five ways to paint a cover. Each is a handful of shapes: a cover is seen at
   the size of a thumbnail, and anything busier than this turns to mud. */
export const ARTS = ['wash', 'bands', 'arcs', 'rule', 'wedge'];

/**
 * @param clear {{top, bottom}} — the band of the tile the type occupies. Art
 *   with hard edges keeps out of it: a rule through the middle of a title is
 *   the one way these covers can look like a mistake rather than a design.
 */
export function artFor(seed, p, clear = null) {
  const r = rng(seed ^ 0x85ebca6b);
  const kind = pick(r, ARTS);
  const g = `g${seed.toString(36)}`;
  const clashes = (y, h = 0) => !!clear && y + h > clear.top && y < clear.bottom;

  if (kind === 'bands') {
    const n = Math.floor(between(r, 3, 7));
    const bands = [];
    for (let i = 0; i < n; i++) {
      const h = between(r, 3, 16);
      const fill = r() < 0.34 ? p.accent : p.mid;
      const op = between(r, 0.5, 0.95);
      // a few tries at a clear place, then that band is simply not drawn
      let y = -1;
      for (let k = 0; k < 8; k++) {
        const candidate = between(r, 0.08, 0.9) * H;
        if (!clashes(candidate, h)) { y = candidate; break; }
      }
      if (y < 0) continue;
      bands.push(`<rect x="0" y="${y.toFixed(1)}" width="${W}" height="${h.toFixed(1)}" ` +
        `fill="${fill}" opacity="${op.toFixed(2)}"/>`);
    }
    return { kind, svg: `<rect width="${W}" height="${H}" fill="${p.ground}"/>${bands.join('')}` };
  }

  if (kind === 'arcs') {
    const cx = between(r, 0.2, 0.8) * W;
    const cy = between(r, 0.55, 0.95) * H;
    const n = Math.floor(between(r, 3, 6));
    const rings = [];
    for (let i = 0; i < n; i++) {
      const rad = (i + 1) * between(r, 26, 44);
      rings.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${rad.toFixed(1)}" fill="none" ` +
        `stroke="${i % 2 ? p.accent : p.mid}" stroke-width="${between(r, 1, 3).toFixed(1)}" opacity="0.7"/>`);
    }
    return { kind, svg: `<rect width="${W}" height="${H}" fill="${p.ground}"/>${rings.join('')}` };
  }

  if (kind === 'rule') {
    let y = between(r, 0.58, 0.76) * H;
    // below the type if it can be, above it if it cannot
    if (clashes(y, 2)) y = clear.bottom + 12 < H - 20 ? clear.bottom + 12 : Math.max(16, clear.top - 14);
    return { kind, svg:
      `<rect width="${W}" height="${H}" fill="${p.ground}"/>` +
      `<rect x="0" y="${y.toFixed(1)}" width="${W}" height="${(H - y).toFixed(1)}" fill="${p.deep}"/>` +
      `<rect x="0" y="${(y - 2).toFixed(1)}" width="${W}" height="2" fill="${p.accent}"/>` };
  }

  if (kind === 'wedge') {
    const x1 = between(r, 0.1, 0.5) * W;
    const x2 = between(r, 0.5, 1) * W;
    return { kind, svg:
      `<rect width="${W}" height="${H}" fill="${p.ground}"/>` +
      `<path d="M0 ${H} L${x1.toFixed(1)} ${(H * 0.32).toFixed(1)} L${x2.toFixed(1)} ${H} Z" fill="${p.mid}" opacity="0.85"/>` +
      `<path d="M${(W * 0.45).toFixed(1)} ${H} L${(W * 0.82).toFixed(1)} ${(H * 0.46).toFixed(1)} L${W} ${H} Z" fill="${p.accent}" opacity="0.7"/>` };
  }

  // wash — a ground with a soft light somewhere in it
  const cx = between(r, 0.2, 0.8) * W;
  const cy = between(r, 0.2, 0.8) * H;
  return { kind: 'wash', svg:
    `<defs><radialGradient id="${g}" cx="${(cx / W).toFixed(3)}" cy="${(cy / H).toFixed(3)}" r="0.75">` +
    `<stop offset="0" stop-color="${p.accent}" stop-opacity="0.85"/>` +
    `<stop offset="0.55" stop-color="${p.mid}" stop-opacity="0.45"/>` +
    `<stop offset="1" stop-color="${p.ground}" stop-opacity="0"/>` +
    `</radialGradient></defs>` +
    `<rect width="${W}" height="${H}" fill="${p.ground}"/>` +
    `<rect width="${W}" height="${H}" fill="url(#${g})"/>` };
}

/* ------------------------------------------------------------------ type */

/* A cover is read across a room, so the title is set as large as will fit and
   broken where a person would break it. Serif faces at display sizes run near
   0.52em to the character, which is close enough to choose line breaks by and
   is then confirmed by sizing the type to the longest line that came out. */
/* Capitals are far wider than lower case in a serif face -- near 0.72 of the
   type size against 0.54 -- so the case has to be settled BEFORE the type is
   sized, or a title set in capitals runs off both edges of the tile. */
const PER_CHAR_UPPER = 0.72;
const PER_CHAR_MIXED = 0.54;
const UPPER_UPTO = 13;     // characters in the longest line
const MAX_TITLE = 34;      // px, before fitting
const MIN_TITLE = 9;       // small, but on the cover rather than off it
const INSET = 18;          // px of margin either side of the type

/**
 * Break a title into lines of roughly even length, never more than `max`.
 * A word longer than a line is left alone rather than hyphenated — a cover
 * with a broken word on it looks like a mistake.
 */
export function breakTitle(title, max = 4) {
  const words = String(title || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  if (words.length === 1) return words;

  /* Try every number of lines up to `max` and keep the one whose longest line
     is shortest: that is the setting that lets the type be biggest. */
  let best = null;
  for (let n = 1; n <= Math.min(max, words.length); n++) {
    const lines = splitInto(words, n);
    const longest = Math.max(...lines.map((l) => l.length));
    if (!best || longest < best.longest) best = { lines, longest };
  }
  return best.lines;
}

/* Words into n lines, greedily balanced by character length. */
function splitInto(words, n) {
  const total = words.join(' ').length;
  const target = total / n;
  const lines = [];
  let line = [];
  let len = 0;
  for (const w of words) {
    const grown = len ? len + 1 + w.length : w.length;
    const left = n - lines.length;
    // keep enough words back to fill the lines that are still to come
    const mustBreak = len && grown > target * 1.35 && words.length - (lines.flat().length + line.length) >= left - 1;
    if (mustBreak && lines.length < n - 1) {
      lines.push(line.join(' '));
      line = [w];
      len = w.length;
    } else {
      line.push(w);
      len = grown;
    }
  }
  if (line.length) lines.push(line.join(' '));
  return lines;
}

/** How the title and author are set on the tile. */
export function typeFor({ title, author }, seed = 0) {
  const r = rng(seed ^ 0xc2b2ae35);
  const lines = breakTitle(title);
  const longest = Math.max(1, ...lines.map((l) => l.length));

  /* Capitals while they can still be set large; past that the title is long
     enough that capitals would be both cramped and hard to read. */
  const upper = longest <= UPPER_UPTO;

  // the size at which the longest line just fits the measure, in that case
  const measure = W - INSET * 2;
  const perChar = upper ? PER_CHAR_UPPER : PER_CHAR_MIXED;
  const size = Math.max(MIN_TITLE, Math.min(MAX_TITLE, measure / (longest * perChar)));
  const leading = size * 1.14;

  const block = lines.length * leading;
  const place = pick(r, ['top', 'middle']);
  const top = place === 'top' ? H * 0.16 : (H - block) / 2 - H * 0.04;

  return { lines, size, leading, upper, top, author: String(author || '').trim(), place };
}

/* ------------------------------------------------------------------ cover */

const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

/**
 * The whole cover, as one SVG string.
 * @param book {{ path, title, author }}
 */
export function coverFor(book = {}) {
  const seed = seedOf(book.path || book.title || '');
  const p = paletteFor(seed);
  /* Type first: the art is painted around it. */
  const t = typeFor(book, seed);
  const art = artFor(seed, p, {
    top: t.top - 6,
    bottom: t.top + t.lines.length * t.leading + (t.author ? 40 : 10)
  });

  const title = t.lines.map((line, i) => {
    const y = t.top + t.size * 0.82 + i * t.leading;
    return `<text x="${W / 2}" y="${y.toFixed(1)}" text-anchor="middle" fill="${p.ink}" ` +
      `font-size="${t.size.toFixed(1)}" font-family="var(--cover-face)" font-weight="600" ` +
      `letter-spacing="${t.upper ? '0.04em' : '0'}">${esc(t.upper ? line.toUpperCase() : line)}</text>`;
  }).join('');

  const rule = `<rect x="${(W / 2 - 14).toFixed(1)}" y="${(t.top + t.lines.length * t.leading + 10).toFixed(1)}" ` +
    `width="28" height="1.5" fill="${p.inkSoft}"/>`;

  const author = t.author
    ? `<text x="${W / 2}" y="${(t.top + t.lines.length * t.leading + 32).toFixed(1)}" text-anchor="middle" ` +
      `fill="${p.inkSoft}" font-size="10" font-family="var(--cover-face)" letter-spacing="0.14em">` +
      `${esc(t.author.toUpperCase())}</text>`
    : '';

  return `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" ` +
    `aria-label="${esc(book.title || 'Untitled')}">${art.svg}${title}${t.author ? rule + author : ''}</svg>`;
}
