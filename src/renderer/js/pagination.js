/* Real page breaking.
 *
 * The word-per-page estimate was never going to agree with what actually comes
 * out of the printer, so instead we lay the manuscript out once in an offscreen
 * column with the exact print geometry, read back where every line box lands,
 * and cut pages at the lines that cross the bottom margin.
 *
 * Line breaking depends only on the column width, which never changes, so a
 * single layout pass is enough: moving a line to the next page shifts it
 * vertically but never re-wraps it.
 */

const DPI = 96;               // CSS pixels per inch
const MAX_PAGES = 4000;

const SHEETS = {
  letter: { w: 8.5, h: 11 },
  a4: { w: 8.27, h: 11.69 }
};

/** Text-box size in CSS pixels for the current print template. */
export function geometryFor(prefs = {}) {
  const sheet = SHEETS[prefs.pageSize] || SHEETS.letter;
  const margin = Number(prefs.printMargin) || 1;
  return {
    width: Math.round((sheet.w - margin * 2) * DPI),
    height: Math.round((sheet.h - margin * 2) * DPI),
    sheet,
    margin
  };
}

let measurer = null;

function measurerEl() {
  if (measurer && measurer.isConnected) return measurer;
  measurer = document.createElement('div');
  measurer.className = 'page page-measure';
  measurer.setAttribute('aria-hidden', 'true');
  document.body.appendChild(measurer);
  return measurer;
}

/* ------------------------------------------------------------- measuring */

function textNodesOf(el) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  return nodes;
}

function textLength(nodes) {
  let total = 0;
  for (const n of nodes) total += n.nodeValue.length;
  return total;
}

function locate(nodes, offset) {
  let acc = 0;
  for (const node of nodes) {
    const len = node.nodeValue.length;
    if (offset <= acc + len) return { node, offset: offset - acc };
    acc += len;
  }
  const last = nodes[nodes.length - 1];
  return last ? { node: last, offset: last.nodeValue.length } : null;
}

/** One entry per visual line in a block, in document order. */
function lineBoxes(block) {
  const range = document.createRange();
  range.selectNodeContents(block);
  const rects = Array.from(range.getClientRects()).filter((r) => r.height > 0);
  if (!rects.length) {
    const r = block.getBoundingClientRect();
    return r.height ? [{ top: r.top, bottom: r.bottom }] : [];
  }
  rects.sort((a, b) => a.top - b.top);

  const lines = [];
  for (const r of rects) {
    const last = lines[lines.length - 1];
    // Inline spans produce several rects on one line; merge by vertical band.
    if (last && r.top < last.bottom - 1) {
      last.top = Math.min(last.top, r.top);
      last.bottom = Math.max(last.bottom, r.bottom);
    } else {
      lines.push({ top: r.top, bottom: r.bottom });
    }
  }
  return lines;
}

/**
 * Character offset at which visual line `target` begins, found by bisection on
 * the laid-out block and then snapped back to a word boundary.
 */
function offsetOfLine(block, target) {
  const nodes = textNodesOf(block);
  const total = textLength(nodes);
  if (!total) return 0;

  const lines = lineBoxes(block);
  if (target <= 0 || target >= lines.length) return target <= 0 ? 0 : total;
  const targetTop = lines[target].top;

  const range = document.createRange();
  const reaches = (offset) => {
    const p = locate(nodes, offset);
    if (!p) return false;
    range.setStart(block, 0);
    range.setEnd(p.node, p.offset);
    const rects = range.getClientRects();
    if (!rects.length) return false;
    let bottom = -Infinity;
    for (const r of rects) if (r.height > 0) bottom = Math.max(bottom, r.top);
    return bottom >= targetTop - 0.5;
  };

  let lo = 0;
  let hi = total;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (reaches(mid)) hi = mid; else lo = mid + 1;
  }

  // Never cut inside a word: walk back to the space the line broke on.
  const flat = nodes.map((n) => n.nodeValue).join('');
  let cut = lo;
  while (cut > 0 && !/\s/.test(flat[cut - 1])) cut--;
  return cut || lo;
}

/* --------------------------------------------------------------- slicing */

/** A copy of `block` holding only the characters in [from, to). */
function sliceBlock(block, from, to) {
  const clone = block.cloneNode(true);
  let nodes = textNodesOf(clone);
  const total = textLength(nodes);

  if (to != null && to < total) {
    const p = locate(nodes, to);
    const tail = document.createRange();
    tail.setStart(p.node, p.offset);
    tail.setEndAfter(clone.lastChild);
    tail.deleteContents();
    nodes = textNodesOf(clone);
  }
  if (from > 0) {
    const p = locate(nodes, from);
    const head = document.createRange();
    head.setStartBefore(clone.firstChild);
    head.setEnd(p.node, p.offset);
    head.deleteContents();
    clone.classList.add('cont');   // a continued paragraph is never indented
  }
  return clone;
}

/* ------------------------------------------------------------ pagination */

/**
 * @param sections [{ html, chapter }] — the hard-break sections from parse.js
 * @returns [{ html, chapter }] — one entry per printed page
 */
export function paginate(sections, geometry) {
  const geo = geometry || geometryFor();
  const pageHeight = geo.height;
  const host = measurerEl();
  const pages = [];

  for (const section of sections) {
    host.innerHTML = section.html;
    const blocks = Array.from(host.children);
    if (!blocks.length) {
      pages.push({ html: section.html, chapter: section.chapter });
      continue;
    }

    // Every line in the section, tagged with the block it belongs to.
    const lines = [];
    const perBlock = [];
    blocks.forEach((block, i) => {
      const boxes = lineBoxes(block);
      perBlock.push(boxes.length);
      boxes.forEach((box, j) => lines.push({ i, j, top: box.top, bottom: box.bottom }));
    });
    if (!lines.length) {
      pages.push({ html: section.html, chapter: section.chapter });
      continue;
    }

    // Cut before any line whose bottom would fall past the page.
    const breaks = [];
    let pageTop = lines[0].top;
    for (const line of lines) {
      if (line.bottom - pageTop > pageHeight + 0.5 && (line.i || line.j)) {
        breaks.push({ i: line.i, j: line.j });
        pageTop = line.top;
        if (pages.length + breaks.length > MAX_PAGES) break;
      }
    }

    // Offsets are read from the laid-out originals before anything is cloned.
    const cutAt = new Map();
    for (const b of breaks) {
      if (b.j > 0 && !cutAt.has(`${b.i}:${b.j}`)) {
        cutAt.set(`${b.i}:${b.j}`, offsetOfLine(blocks[b.i], b.j));
      }
    }

    const bounds = [{ i: 0, j: 0 }, ...breaks, { i: blocks.length, j: 0 }];
    for (let p = 0; p < bounds.length - 1; p++) {
      const start = bounds[p];
      const end = bounds[p + 1];
      const parts = [];

      for (let i = start.i; i <= Math.min(end.i, blocks.length - 1); i++) {
        if (i === end.i && end.j === 0 && i !== start.i) break;
        const from = i === start.i && start.j > 0 ? cutAt.get(`${i}:${start.j}`) || 0 : 0;
        const to = i === end.i && end.j > 0 ? cutAt.get(`${i}:${end.j}`) : null;
        if (from === 0 && to == null) {
          parts.push(blocks[i].outerHTML);
        } else {
          const piece = sliceBlock(blocks[i], from, to);
          if (piece.textContent.trim() || piece.tagName === 'HR') parts.push(piece.outerHTML);
        }
        if (i === end.i) break;
      }
      pages.push({ html: parts.join('\n'), chapter: section.chapter });
    }
  }

  host.innerHTML = '';
  return pages.length ? pages : [{ html: '', chapter: '' }];
}

/** Page total without keeping the page markup. */
export function countPages(sections, geometry) {
  return paginate(sections, geometry).length;
}
