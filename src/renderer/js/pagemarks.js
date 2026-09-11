/* Page markers in the writing view.
 *
 * A short rule and a number in the margin at the line where each printed page
 * begins, so you can see how far down a page you are without leaving the
 * text. The positions come from the real pagination, not an estimate, and are
 * pushed in here whenever it runs; they are mapped through edits in between
 * so they stay roughly right until the next count. */

import { StateField, StateEffect } from '@codemirror/state';
import { Decoration, EditorView } from '@codemirror/view';

/** [{ line, page }] — zero-based source line, one-based page number. */
export const setPageMarks = StateEffect.define();

export const pageMarkState = StateField.define({
  create: () => Decoration.none,

  update(marks, tr) {
    marks = marks.map(tr.changes);
    for (const effect of tr.effects) {
      if (!effect.is(setPageMarks)) continue;
      const ranges = [];
      for (const { line, page } of effect.value) {
        if (line == null || line < 0 || line >= tr.state.doc.lines) continue;
        const l = tr.state.doc.line(line + 1);
        ranges.push(Decoration.line({
          class: 'page-start',
          attributes: { 'data-page': String(page) }
        }).range(l.from));
      }
      ranges.sort((a, b) => a.from - b.from);
      marks = Decoration.set(ranges, true);
    }
    return marks;
  },

  provide: (f) => EditorView.decorations.from(f)
});

/** Push a fresh set of page starts into the editor. */
export function showPageMarks(view, starts) {
  view.dispatch({ effects: setPageMarks.of(starts) });
}
