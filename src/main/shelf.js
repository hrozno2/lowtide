/* The shelf.
 *
 * Low Tide does not own a library folder — a manuscript is a file, anywhere
 * you like, and the app's memory of it is the recent list. So a shelf here is
 * not a place on disk: it is a name and an order over paths you have already
 * opened. Nothing is moved, nothing is copied, and a shelf that loses track of
 * a file loses only the arrangement.
 *
 * Everything below is pure, so it can be tested without booting anything.
 */
'use strict';

const DEFAULT_SHELF = 'Works in progress';

/* The front matter, read from the head of the file. This mirrors parse.js's
   rule for the two keys a cover needs; the renderer's parser is ES modules and
   the main process cannot load it, and reading a whole manuscript to learn its
   title would be a poor trade for a list that redraws every time Home opens. */
const META_RE = /^([A-Za-z][A-Za-z ]{0,18}):[ \t]*(.*)$/;

/** Title and author from the first lines of a document. */
function metaFrom(head) {
  const meta = {};
  for (const line of String(head).split('\n')) {
    const m = META_RE.exec(line);
    if (!m) break;
    meta[m[1].trim().toLowerCase()] = m[2].trim();
  }
  return {
    title: meta.title || '',
    author: meta.author || meta.authors || meta.credit || '',
    series: meta.series || ''
  };
}

/** A new shelf, named but empty. */
function newShelf(name, id = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`) {
  return { id, name: String(name || DEFAULT_SHELF), paths: [] };
}

/**
 * The shelves to draw: the ones that were kept, with every book that is still
 * on disk placed on one. A document opened since the last visit has never been
 * shelved, so it goes on the first shelf, newest first — which is where
 * someone would look for the thing they were just working on.
 */
function arrange(shelves, books) {
  const known = new Map(books.map((b) => [b.path, b]));
  const out = (Array.isArray(shelves) && shelves.length ? shelves : [newShelf(DEFAULT_SHELF, 'shelf-1')])
    .map((s) => ({
      id: String(s.id || ''),
      name: String(s.name || DEFAULT_SHELF),
      // a path that is no longer on disk drops out of the arrangement
      books: (Array.isArray(s.paths) ? s.paths : []).filter((p) => known.has(p)).map((p) => known.get(p))
    }));

  const placed = new Set(out.flatMap((s) => s.books.map((b) => b.path)));
  const loose = books.filter((b) => !placed.has(b.path));
  // newest first, so the one you were just in is at the front
  loose.sort((a, b) => (b.time || 0) - (a.time || 0));
  out[0].books = loose.concat(out[0].books);
  return out;
}

/** The arrangement, back in the form that is kept in preferences. */
function toPrefs(arranged) {
  return arranged.map((s) => ({ id: s.id, name: s.name, paths: s.books.map((b) => b.path) }));
}

/**
 * Move a book to `toShelf`, landing at `index` among the books already there.
 * Taking it out of its old shelf first means a move within one shelf counts
 * positions in the list the book has already left, which is what a drag looks
 * like to the person doing it.
 */
function moveBook(shelves, path, toShelf, index) {
  const next = shelves.map((s) => ({ ...s, paths: s.paths.filter((p) => p !== path) }));
  const target = next.find((s) => s.id === toShelf) || next[0];
  if (!target) return shelves;
  const at = Math.max(0, Math.min(Number(index) || 0, target.paths.length));
  target.paths.splice(at, 0, path);
  return next;
}

/** Move a whole shelf to `index` in the list of shelves. */
function moveShelf(shelves, id, index) {
  const moving = shelves.find((s) => s.id === id);
  if (!moving) return shelves;
  const rest = shelves.filter((s) => s.id !== id);
  const at = Math.max(0, Math.min(Number(index) || 0, rest.length));
  rest.splice(at, 0, moving);
  return rest;
}

/** Remove a shelf. Its books are not lost — they fall back to the first. */
function removeShelf(shelves, id) {
  if (shelves.length <= 1) return shelves;
  const going = shelves.find((s) => s.id === id);
  if (!going) return shelves;
  const rest = shelves.filter((s) => s.id !== id);
  rest[0] = { ...rest[0], paths: rest[0].paths.concat(going.paths.filter((p) => !rest[0].paths.includes(p))) };
  return rest;
}

function renameShelf(shelves, id, name) {
  const clean = String(name || '').trim();
  if (!clean) return shelves;
  return shelves.map((s) => (s.id === id ? { ...s, name: clean } : s));
}

module.exports = {
  DEFAULT_SHELF, metaFrom, newShelf, arrange, toPrefs,
  moveBook, moveShelf, removeShelf, renameShelf
};
