import { EditorView, keymap, drawSelection, dropCursor, rectangularSelection,
         crosshairCursor, highlightSpecialChars } from '@codemirror/view';
import { EditorState, EditorSelection, Compartment } from '@codemirror/state';
import { history, historyKeymap, defaultKeymap, standardKeymap } from '@codemirror/commands';
import { search, searchKeymap, openSearchPanel, closeSearchPanel,
         findNext, findPrevious, replaceNext, replaceAll as replaceAllMatches,
         highlightSelectionMatches } from '@codemirror/search';
import { markupExtensions, setStyleOptions } from './decorations.js';
import { revisionState } from './revisions.js';

const typography = new Compartment();
const spellcheck = new Compartment();

/* ------------------------------------------------------- smart typography */

/* Characters after which a quote opens rather than closes. Curly quotes are
   deliberately absent so that typing "" gives a pair, not two openers. */
const OPENERS = ' \t\n([{—–\u00a0';

const opensAfter = (ch) => OPENERS.indexOf(ch) > -1;

/**
 * Implemented as a transaction filter rather than an input handler: rewriting
 * the transaction that CodeMirror is already applying avoids dispatching a
 * second, re-entrant one, which could race with the next keystroke and drop a
 * character.
 */
function smartTypography(enabled) {
  return EditorState.transactionFilter.of((tr) => {
    if (!enabled() || !tr.docChanged || !tr.isUserEvent('input.type')) return tr;

    let ranges = 0;
    let rewrite = null;
    tr.changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
      ranges++;
      if (ranges > 1) return;
      const text = inserted.toString();
      if (text.length !== 1) return;

      const doc = tr.startState.doc;
      const prev = fromA > 0 ? doc.sliceString(fromA - 1, fromA) : '\n';

      if (text === '"') {
        rewrite = { from: fromA, to: toA, insert: opensAfter(prev) ? '\u201c' : '\u201d' };
      } else if (text === "'") {
        rewrite = { from: fromA, to: toA, insert: opensAfter(prev) ? '\u2018' : '\u2019' };
      } else if (text === '-' && prev === '-') {
        rewrite = { from: fromA - 1, to: toA, insert: '\u2014' };
      } else if (text === '.' && fromA >= 2 && doc.sliceString(fromA - 2, fromA) === '..') {
        rewrite = { from: fromA - 2, to: toA, insert: '\u2026' };
      }
    });

    if (!rewrite || ranges !== 1) return tr;
    return {
      changes: rewrite,
      selection: EditorSelection.cursor(rewrite.from + rewrite.insert.length),
      userEvent: 'input.type',
      scrollIntoView: true
    };
  });
}

/* --------------------------------------------------------------- creation */

export function createEditor({ parent, doc, onChange, onCursor, onSave, prefs }) {
  let typewriterOn = !!prefs.typewriter;
  let smartOn = prefs.smartTypography !== false;
  let scrollPending = false;

  const view = new EditorView({
    parent,
    doc: doc || '',
    extensions: [
      EditorView.lineWrapping,
      history(),
      drawSelection({ cursorBlinkRate: 1060 }),   // matches the system caret
      dropCursor(),
      highlightSpecialChars(),
      highlightSelectionMatches({ minSelectionLength: 3 }),
      rectangularSelection(),
      crosshairCursor(),
      EditorState.allowMultipleSelections.of(true),
      search({ top: true }),
      markupExtensions,
      revisionState,
      keymap.of([
        { key: 'Mod-s', run: () => { onSave(); return true; }, preventDefault: true },
        { key: 'Mod-f', run: openSearchPanel, preventDefault: true },
        ...searchKeymap,
        ...defaultKeymap,
        ...historyKeymap
      ]),
      smartTypography(() => smartOn),
      typography.of(EditorView.theme({})),
      spellcheck.of(EditorView.contentAttributes.of({
        spellcheck: prefs.spellcheck === false ? 'false' : 'true',
        autocapitalize: 'sentences',
        autocorrect: 'off'
      })),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) onChange(update);
        if (update.selectionSet || update.docChanged) onCursor(update);
        if (typewriterOn && (update.docChanged || update.selectionSet) && !scrollPending) {
          scrollPending = true;
          requestAnimationFrame(() => {
            scrollPending = false;
            if (!view.dom.isConnected) return;
            view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'center' }) });
          });
        }
      })
    ]
  });

  return {
    view,
    setTypewriter(on) { typewriterOn = on; if (on) centerCursor(view); },
    setSmartTypography(on) { smartOn = on; },
    setSpellcheck(on) {
      view.dispatch({ effects: spellcheck.reconfigure(EditorView.contentAttributes.of({
        spellcheck: on ? 'true' : 'false', autocapitalize: 'sentences', autocorrect: 'off'
      })) });
    },
    setStyle(opts) { view.dispatch({ effects: setStyleOptions.of(opts) }); }
  };
}

/**
 * Opens the find bar, optionally with the caret in the replace field. The menu
 * owns the accelerator, so this is what Cmd/Ctrl-F actually runs.
 */
export function openFind(view, { replace = false } = {}) {
  const selection = view.state.selection.main;
  if (!selection.empty && selection.to - selection.from < 200) {
    // Seed the query with the selection, the way every other editor does.
    const term = view.state.sliceDoc(selection.from, selection.to);
    openSearchPanel(view);
    requestAnimationFrame(() => {
      const field = view.dom.querySelector('.cm-search input[name="search"]');
      if (field) {
        field.value = term;
        field.dispatchEvent(new Event('change', { bubbles: true }));
      }
      focusField(view, replace);
    });
    return;
  }
  openSearchPanel(view);
  requestAnimationFrame(() => focusField(view, replace));
}

function focusField(view, replace) {
  const panel = view.dom.querySelector('.cm-search');
  if (!panel) return;
  const field = panel.querySelector(replace ? 'input[name="replace"]' : 'input[name="search"]');
  if (field) { field.focus(); field.select(); }
}

export function closeFind(view) { closeSearchPanel(view); }
export const findNextMatch = (view) => findNext(view);
export const findPreviousMatch = (view) => findPrevious(view);
export const replaceNextMatch = (view) => replaceNext(view);
export const replaceEveryMatch = (view) => replaceAllMatches(view);

export function centerCursor(view) {
  view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'center' }) });
}

/* --------------------------------------------------------------- commands */

const PAIRS = { bold: '**', italic: '*', underline: '_', strike: '~~' };

export function toggleEmphasis(view, kind) {
  const mark = PAIRS[kind];
  if (!mark) return;
  const changes = [];
  const ranges = [];

  for (const range of view.state.selection.ranges) {
    let { from, to } = range;
    if (from === to) {
      const word = wordAt(view.state, from);
      from = word.from; to = word.to;
    }
    const len = mark.length;
    const outer = view.state.doc.sliceString(Math.max(0, from - len), from) === mark &&
                  view.state.doc.sliceString(to, to + len) === mark;
    const inner = view.state.doc.sliceString(from, from + len) === mark &&
                  view.state.doc.sliceString(to - len, to) === mark && to - from >= len * 2;

    if (outer) {
      changes.push({ from: from - len, to: from }, { from: to, to: to + len });
      ranges.push(EditorSelection.range(from - len, to - len));
    } else if (inner) {
      changes.push({ from, to: from + len }, { from: to - len, to });
      ranges.push(EditorSelection.range(from, to - len * 2));
    } else {
      changes.push({ from, insert: mark }, { from: to, insert: mark });
      ranges.push(range.empty && from === to
        ? EditorSelection.cursor(from + len)
        : EditorSelection.range(from + len, to + len));
    }
  }

  view.dispatch({ changes, selection: EditorSelection.create(ranges, 0), userEvent: 'input' });
  view.focus();
}

function wordAt(state, pos) {
  const line = state.doc.lineAt(pos);
  const rel = pos - line.from;
  const isWord = (c) => c && /[\w'’À-ɏ]/.test(c);
  let a = rel, b = rel;
  while (a > 0 && isWord(line.text[a - 1])) a--;
  while (b < line.text.length && isWord(line.text[b])) b++;
  return { from: line.from + a, to: line.from + b };
}

export function setHeading(view, level) {
  const { state } = view;
  const changes = [];
  const markerLen = new Map();          // line number -> length of the old "## "

  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let n = first; n <= last; n++) {
      if (markerLen.has(n)) continue;
      const line = state.doc.line(n);
      const m = /^(#{1,4})[ \t]*/.exec(line.text);
      const current = m ? m[1].length : 0;
      markerLen.set(n, m ? m[0].length : 0);
      const target = current === level ? 0 : level;
      const prefix = target ? '#'.repeat(target) + ' ' : '';
      changes.push({ from: line.from, to: line.from + (m ? m[0].length : 0), insert: prefix });
    }
  }
  if (!changes.length) { view.focus(); return; }

  /* The marker is rewritten in place, so a caret sitting on or inside it has
     nowhere obvious to land and CodeMirror leaves it in front of the new
     hashes. Move it to the end of the old marker first: that is the boundary
     of the replaced range, so it maps to just after the new one and the caret
     keeps its place in the words. */
  const set = state.changes(changes);
  const keep = (pos) => {
    const line = state.doc.lineAt(pos);
    const len = markerLen.get(line.number);
    return set.mapPos(len == null ? pos : Math.max(pos, line.from + len), 1);
  };
  const ranges = state.selection.ranges.map((r) => (r.empty
    ? EditorSelection.cursor(keep(r.head))
    : EditorSelection.range(keep(r.anchor), keep(r.head))));

  view.dispatch({
    changes: set,
    selection: EditorSelection.create(ranges, state.selection.mainIndex),
    userEvent: 'input'
  });
  view.focus();
}

export function toggleCenter(view) {
  const { state } = view;
  const changes = [];
  const seen = new Set();

  for (const range of state.selection.ranges) {
    const first = state.doc.lineAt(range.from).number;
    const last = state.doc.lineAt(range.to).number;
    for (let n = first; n <= last; n++) {
      if (seen.has(n)) continue;
      seen.add(n);
      const line = state.doc.line(n);
      const text = line.text;
      if (/^>\s*.*<\s*$/.test(text)) {
        const inner = text.replace(/^>\s*/, '').replace(/\s*<\s*$/, '');
        changes.push({ from: line.from, to: line.to, insert: inner });
      } else if (text.trim()) {
        changes.push({ from: line.from, to: line.to, insert: `> ${text.trim()} <` });
      }
    }
  }
  view.dispatch({ changes, userEvent: 'input' });
  view.focus();
}

export function wrapNote(view) {
  const range = view.state.selection.main;
  if (range.empty) {
    view.dispatch({ changes: { from: range.from, insert: '[[]]' },
                    selection: { anchor: range.from + 2 }, userEvent: 'input' });
  } else {
    view.dispatch({
      changes: [{ from: range.from, insert: '[[' }, { from: range.to, insert: ']]' }],
      selection: { anchor: range.from + 2, head: range.to + 2 },
      userEvent: 'input'
    });
  }
  view.focus();
}

export function insertBlock(view, text) {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const atLineStart = line.text.trim() === '';
  const prefix = atLineStart ? '' : '\n';
  const insert = `${prefix}${text}\n`;
  const at = atLineStart ? line.from : line.to;
  const end = atLineStart ? line.to : at;
  view.dispatch({
    changes: { from: at, to: end, insert },
    selection: { anchor: at + insert.length },
    userEvent: 'input'
  });
  view.focus();
}

export function gotoPosition(view, pos, { center = false } = {}) {
  const target = Math.min(Math.max(pos, 0), view.state.doc.length);
  const line = view.state.doc.lineAt(target);
  const where = center ? { y: 'center' } : { y: 'start', yMargin: 72 };

  view.dispatch({
    selection: { anchor: line.from },
    effects: EditorView.scrollIntoView(line.from, where),
    scrollIntoView: false
  });

  // Line heights outside the viewport are estimates until they are drawn, so
  // the first scroll can land short. Re-assert over the next two frames, by
  // which point the real heights are known.
  let frames = 0;
  const settle = () => {
    if (view.destroyed || !view.dom.isConnected || frames++ > 1) return;
    view.dispatch({ effects: EditorView.scrollIntoView(line.from, where) });
    requestAnimationFrame(settle);
  };
  requestAnimationFrame(settle);

  view.focus();
}

export function replaceAll(view, text, cursor = 0) {
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: { anchor: Math.min(cursor, text.length) },
    annotations: []
  });
}
