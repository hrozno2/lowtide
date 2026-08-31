/* Revision marking.
 *
 * A revision is a name plus a colour. While one is active, everything you type
 * is tagged with it. The marks live in a CodeMirror RangeSet so they follow the
 * text through every later edit, and they are stored beside the document rather
 * than inside it — the manuscript file stays plain text.
 */

import { StateField, StateEffect } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';

export const REVISION_COLOURS = [
  { id: 'blue', name: 'Blue', hex: '#5aa9e6' },
  { id: 'pink', name: 'Pink', hex: '#f27eb2' },
  { id: 'yellow', name: 'Yellow', hex: '#e0b44c' },
  { id: 'green', name: 'Green', hex: '#7fc96b' },
  { id: 'orange', name: 'Orange', hex: '#e8934a' },
  { id: 'purple', name: 'Purple', hex: '#b08ae0' },
  { id: 'red', name: 'Red', hex: '#e8695f' },
  { id: 'teal', name: 'Teal', hex: '#4ec7b8' }
];

export const colourById = (id) =>
  REVISION_COLOURS.find((c) => c.id === id) || REVISION_COLOURS[0];

export const setRevisions = StateEffect.define();   // { list, active }
export const loadMarks = StateEffect.define();      // [{ id, from, to }]
export const clearRevision = StateEffect.define();  // revision id
export const clearAllRevisions = StateEffect.define();
export const addMarks = StateEffect.define();       // [{ id, from, to }]

const markFor = (rev) => Decoration.mark({
  class: `m-rev m-rev-${rev.colour}`,
  attributes: { 'data-rev': rev.id },   // lets one revision be hidden by CSS
  revision: rev.id,
  inclusive: false
});

// Typing and pasting mark text; undo, formatting commands and programmatic
// edits do not.
const isTyping = (tr) => tr.isUserEvent('input');

export const revisionState = StateField.define({
  create: () => ({ list: [], active: null, marks: Decoration.none }),

  update(value, tr) {
    let { list, active } = value;
    let marks = value.marks.map(tr.changes);
    if (tr.docChanged) marks = marks.update({ filter: (from, to) => to > from });

    for (const effect of tr.effects) {
      if (effect.is(setRevisions)) {
        if (effect.value.list) list = effect.value.list;
        if ('active' in effect.value) active = effect.value.active;
      }
      if (effect.is(loadMarks)) {
        const ranges = [];
        for (const m of effect.value) {
          const rev = list.find((r) => r.id === m.id);
          if (!rev) continue;
          const from = Math.max(0, Math.min(m.from, tr.state.doc.length));
          const to = Math.max(from, Math.min(m.to, tr.state.doc.length));
          if (to > from) ranges.push(markFor(rev).range(from, to));
        }
        ranges.sort((a, b) => a.from - b.from || a.to - b.to);
        marks = Decoration.set(ranges, true);
      }
      if (effect.is(addMarks)) {
        const ranges = [];
        for (const m of effect.value) {
          const rev = list.find((r) => r.id === m.id);
          if (!rev) continue;
          const from = Math.max(0, Math.min(m.from, tr.state.doc.length));
          const to = Math.max(from, Math.min(m.to, tr.state.doc.length));
          if (to > from) ranges.push(markFor(rev).range(from, to));
        }
        if (ranges.length) {
          ranges.sort((a, b) => a.from - b.from || a.to - b.to);
          marks = marks.update({ add: ranges, sort: true });
        }
      }
      if (effect.is(clearRevision)) {
        marks = marks.update({ filter: (f, t, v) => v.spec.revision !== effect.value });
      }
      if (effect.is(clearAllRevisions)) {
        marks = Decoration.none;
      }
    }

    const current = list.find((r) => r.id === active);
    if (current && tr.docChanged && isTyping(tr)) {
      const added = [];
      tr.changes.iterChanges((fromA, toA, fromB, toB) => {
        if (toB > fromB) added.push(markFor(current).range(fromB, toB));
      });
      if (added.length) {
        added.sort((a, b) => a.from - b.from || a.to - b.to);
        marks = marks.update({ add: added, sort: true });
      }
    }

    return { list, active, marks };
  },

  provide: (field) => EditorView.decorations.from(field, (value) => value.marks)
});

/* -------------------------------------------------------------- commands */

export function applyRevisions(view, { list, active }) {
  view.dispatch({ effects: setRevisions.of({ list, active }) });
}

export function restoreMarks(view, marks) {
  view.dispatch({ effects: loadMarks.of(marks || []) });
}

/** Re-apply marks that a wholesale move of text would otherwise discard. */
export function keepMarks(view, marks) {
  if (marks && marks.length) view.dispatch({ effects: addMarks.of(marks) });
}

export function dropRevision(view, id) {
  view.dispatch({ effects: clearRevision.of(id) });
}

export function dropAllRevisions(view) {
  view.dispatch({ effects: clearAllRevisions.of(null) });
}

/** Every range belonging to one revision, in document order. */
export function rangesOf(state, id) {
  const field = state.field(revisionState, false);
  const out = [];
  if (!field) return out;
  field.marks.between(0, state.doc.length, (from, to, value) => {
    if (value.spec.revision === id) out.push({ from, to });
  });
  return out;
}

/** Remove the text one revision added, and its marks with it. */
export function revertRevision(view, id) {
  const ranges = rangesOf(view.state, id);
  if (!ranges.length) return 0;
  const changes = ranges
    .slice()
    .sort((a, b) => a.from - b.from)
    .map(({ from, to }) => ({ from, to }));
  view.dispatch({ changes, effects: clearRevision.of(id), userEvent: 'delete.revision' });
  return ranges.length;
}

/** Keep the text, drop the colouring. */
export function applyRevision(view, id) {
  view.dispatch({ effects: clearRevision.of(id) });
}

/** Serialise the marks for storage next to the document. */
export function serialiseMarks(state) {
  const field = state.field(revisionState, false);
  if (!field) return [];
  const out = [];
  field.marks.between(0, state.doc.length, (from, to, value) => {
    out.push({ id: value.spec.revision, from, to });
  });
  return out;
}

/** How many characters each revision currently covers. */
export function revisionCounts(state) {
  const field = state.field(revisionState, false);
  const counts = {};
  if (!field) return counts;
  field.marks.between(0, state.doc.length, (from, to, value) => {
    counts[value.spec.revision] = (counts[value.spec.revision] || 0) + (to - from);
  });
  return counts;
}
