import { Decoration, ViewPlugin, EditorView } from '@codemirror/view';
import { StateField, StateEffect } from '@codemirror/state';
import { classifyLine, scanInline, commentRanges, LINE } from './markup.js';
import { metaLine } from './parse.js';

/* --------------------------------------------------------------- options */

export const setStyleOptions = StateEffect.define();

export const styleOptions = StateField.define({
  create: () => ({ focusMode: false, focusScope: 'paragraph', paragraphStyle: 'indent' }),
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setStyleOptions)) value = Object.assign({}, value, e.value);
    return value;
  }
});

/* -------------------------------------------------------------- comments */

const commentField = StateField.define({
  create: (state) => commentRanges(state.doc.toString()),
  update(value, tr) {
    if (!tr.docChanged) return value;
    if (value.length === 0 && !changeTouchesComment(tr)) return value;
    return commentRanges(tr.state.doc.toString());
  }
});

function changeTouchesComment(tr) {
  let touches = false;
  tr.changes.iterChanges((fromA, toA, fromB, toB, ins) => {
    if (touches) return;
    if (toA > fromA) { touches = true; return; }        // a deletion can join / and *
    const s = ins.toString();
    if (s.indexOf('/') > -1 || s.indexOf('*') > -1) touches = true;
  });
  return touches;
}

/* ----------------------------------------------------------- line classes */

const HEAD_CLASS = ['', 'l-h1', 'l-h2', 'l-h3', 'l-h4'];

function previousProseType(doc, lineNo) {
  for (let n = lineNo - 1; n >= 1 && n >= lineNo - 40; n--) {
    const text = doc.line(n).text;
    if (!text.trim()) continue;
    const info = classifyLine(text);
    return info.type;
  }
  return null;
}

function lineClassFor(info, doc, lineNo, opts) {
  switch (info.type) {
    case LINE.heading: return HEAD_CLASS[info.level] || 'l-h4';
    case LINE.center: return 'l-center';
    case LINE.right: return 'l-right';
    case LINE.pagebreak: return 'l-pagebreak';
    case LINE.divider: return 'l-divider';
    case LINE.list: return `l-list l-hang-${Math.min(Math.max(info.markerTo, 2), 6)}`;
    case LINE.blank: return 'l-blank';
    default: {
      const prev = previousProseType(doc, lineNo);
      if (opts.paragraphStyle !== 'indent' && opts.paragraphStyle !== 'spaced') return 'l-body';
      const continues = prev === LINE.body || prev === LINE.center || prev === LINE.right;
      if (!continues) return 'l-body';
      if (opts.paragraphStyle === 'indent') return 'l-body l-indent';
      if (opts.paragraphStyle === 'spaced') {
        const prevLineBlank = lineNo > 1 && !doc.line(lineNo - 1).text.trim();
        return prevLineBlank ? 'l-body' : 'l-body l-spaced';
      }
      return 'l-body';
    }
  }
}

/* --------------------------------------------------------------- focus */

function focusSpan(state, scope) {
  const head = state.selection.main.head;
  const line = state.doc.lineAt(head);
  if (scope === 'line') return [line.from, line.to];
  let first = line.number;
  let last = line.number;
  const total = state.doc.lines;
  while (first > 1 && state.doc.line(first - 1).text.trim()) first--;
  while (last < total && state.doc.line(last + 1).text.trim()) last++;
  return [state.doc.line(first).from, state.doc.line(last).to];
}

/* ---------------------------------------------------------------- plugin */

class MarkupHighlighter {
  constructor(view) {
    this.decorations = this.build(view);
  }

  update(update) {
    const optionsChanged = update.transactions.some((tr) =>
      tr.effects.some((e) => e.is(setStyleOptions)));
    const focusOn = update.state.field(styleOptions).focusMode;
    if (update.docChanged || update.viewportChanged || optionsChanged ||
        (focusOn && update.selectionSet)) {
      this.decorations = this.build(update.view);
    }
  }

  build(view) {
    const { state } = view;
    // Title-page metadata is only metadata while it sits at the very top.
    let metaEnd = 0;
    for (let n = 1; n <= Math.min(state.doc.lines, 12); n++) {
      if (!metaLine(state.doc.line(n).text)) break;
      metaEnd = n;
    }
    const opts = state.field(styleOptions);
    const comments = state.field(commentField);
    const focus = opts.focusMode ? focusSpan(state, opts.focusScope) : null;
    const deco = [];
    let ci = 0;

    for (const { from, to } of view.visibleRanges) {
      let pos = from;
      while (pos <= to) {
        const line = state.doc.lineAt(pos);
        const text = line.text;
        const info = classifyLine(text);

        let cls = lineClassFor(info, state.doc, line.number, opts);
        const meta = line.number <= metaEnd ? metaLine(text) : null;
        if (meta) cls = 'l-meta';
        if (focus && line.to >= focus[0] && line.from <= focus[1]) cls += ' in-focus';
        deco.push(Decoration.line({ class: cls }).range(line.from));

        if (meta) {
          deco.push(Decoration.mark({ class: 'm-meta-key' })
            .range(line.from, line.from + meta.keyTo));
          if (line.to + 1 > pos) pos = line.to + 1; else break;
          continue;
        }

        // Leading markers ("# ", "> ") are dimmed rather than hidden so the
        // document never reflows while the caret moves through them.
        if (info.markerTo > 0) {
          deco.push(Decoration.mark({ class: 'm-marker' })
            .range(line.from, line.from + info.markerTo));
        }
        if (info.type === LINE.pagebreak && text.trim().length) {
          const a = text.length - text.trimStart().length;
          const b = text.trimEnd().length;
          deco.push(Decoration.mark({ class: 'm-rule' }).range(line.from + a, line.from + b));
        }
        if (info.type === LINE.center && text.trimEnd().endsWith('<')) {
          const end = text.trimEnd().length;
          deco.push(Decoration.mark({ class: 'm-marker' }).range(line.from + end - 1, line.from + end));
        }

        if (info.type !== LINE.pagebreak && info.type !== LINE.divider && text.length) {
          while (ci > 0 && comments[ci - 1] && comments[ci - 1][1] > line.from) ci--;
          while (comments[ci] && comments[ci][1] <= line.from) ci++;

          let cursor = info.contentFrom;
          for (let k = ci; comments[k] && comments[k][0] < line.to; k++) {
            const cs = Math.max(comments[k][0] - line.from, 0);
            const ce = Math.min(comments[k][1] - line.from, text.length);
            if (ce <= cursor) continue;
            if (cs > cursor) emitInline(deco, text, line.from, cursor, cs);
            if (ce > cs) {
              deco.push(Decoration.mark({ class: 'm-comment' })
                .range(line.from + Math.max(cs, cursor), line.from + ce));
            }
            cursor = ce;
          }
          if (cursor < text.length) emitInline(deco, text, line.from, cursor, text.length);
        }

        if (line.to + 1 > pos) pos = line.to + 1; else break;
      }
    }

    return Decoration.set(deco, true);
  }
}

function emitInline(deco, text, lineFrom, from, to) {
  if (to <= from) return;
  const slice = text.slice(from, to);
  scanInline(slice, (a, b, cls) => {
    if (b <= a) return;
    deco.push(Decoration.mark({ class: cls }).range(lineFrom + from + a, lineFrom + from + b));
  });
}

export const markupHighlighter = ViewPlugin.fromClass(MarkupHighlighter, {
  decorations: (v) => v.decorations
});

export const markupExtensions = [commentField, styleOptions, markupHighlighter];
