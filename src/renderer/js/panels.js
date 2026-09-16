/* Lightweight panel system: one panel at a time.
 *
 * Panels open as a sheet down the right rather than over the middle of the
 * window, and the workspace gives up the width to make room, so nothing ever
 * covers the line being written. They close on Esc, on Done, or on a click
 * anywhere outside — including back in the text, which is usually what the
 * next click is for. */

const host = () => document.getElementById('panel-host');
const scrim = () => document.getElementById('scrim');

let current = null;

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

let outsideCloser = null;

/* Panels that must not be rebuilt when they close. The music pane holds a
   <webview>; removing it from the document destroys the guest and takes
   whatever is playing with it. These are hidden instead and handed back the
   next time they are asked for. */
const kept = new Map();

/* The control the panel came out of, so it can be pointed at and so clicking
   it again closes rather than reopens. */
let lastTrigger = null;
let lastTriggerAt = 0;
document.addEventListener('pointerdown', (e) => {
  const el = e.target && e.target.closest
    ? e.target.closest('.icon-btn, .text-btn, .btn, .goal-face, .side-tab, .vs-btn')
    : null;
  if (el) { lastTrigger = el; lastTriggerAt = Date.now(); }
}, true);

/* A panel opened from the keyboard or the menu bar has no click to hang off,
   so each one knows the control it belongs to. Without this those panels fall
   back to the middle of the window, which is the thing we are trying to stop
   happening. */
const ANCHOR_BY_NAME = {
  prefs: 'btn-prefs',
  search: 'btn-search',
  sprint: 'btn-sprint',
  theme: 'btn-theme',
  export: 'btn-export',
  goal: 'goal-face',
  revision: 'rev-new',
  'revision-menu': 'rev-new',
  goto: 'btn-navigator',
  backups: 'btn-home',
  help: 'btn-prefs'
};

function anchorFor(name, explicit) {
  if (explicit && document.contains(explicit)) return explicit;

  // A click from a moment ago is the best answer; an older one is unrelated.
  if (lastTrigger && document.contains(lastTrigger) && Date.now() - lastTriggerAt < 1500) {
    return lastTrigger;
  }
  const byName = document.getElementById(ANCHOR_BY_NAME[name] || '');
  if (byName && byName.offsetParent !== null) return byName;

  // Anything else hangs off the toolbar, which keeps it clear of the page.
  const toolbar = document.getElementById('tb-buttons');
  return toolbar && toolbar.offsetParent !== null ? toolbar : null;
}

/* Set when a panel is dismissed by clicking the very control that opened it.
   Without this the click closes the panel on the way down and the button's own
   handler opens it again on the way up, so it never appears to toggle. */
let suppress = null;

function stopWatchingOutside() {
  if (!outsideCloser) return;
  document.removeEventListener('pointerdown', outsideCloser, true);
  outsideCloser = null;
}

export function closePanel() {
  if (!current) return;
  stopWatchingOutside();
  if (current.persist) {
    /* Parked, not removed. It keeps its place in the document — moving a
       <webview> destroys the guest — but it gives up the .panel class while
       it is away, so that looking for "the panel that is open" cannot find
       this one sitting behind the one that is. */
    current.el.hidden = true;
    current.el.classList.remove('panel');
    current.el.classList.add('panel-parked');
  } else {
    current.el.remove();
  }
  scrim().hidden = true;
  document.body.classList.remove('panel-open');
  const after = current.onClose;
  current = null;
  if (after) after();
}

/* Sits the panel under whatever opened it, kept inside the window, with the
   nub pointing back at the control. */
const SVG_NS = 'http://www.w3.org/2000/svg';

/* The bump on the top edge, pointing back at the button. Drawn as an open
   path so the fill closes flat along its base while the stroke follows only
   the curve; the little rectangle then covers the card's own border where the
   bump meets it, so the outline reads as one continuous line. */
function makeNub() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'panel-nub');
  svg.setAttribute('viewBox', '0 0 56 20');
  svg.setAttribute('aria-hidden', 'true');

  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M0,19 C13,19 15.5,4 28,4 C40.5,4 43,19 56,19');
  svg.append(path);

  const cover = document.createElementNS(SVG_NS, 'rect');
  cover.setAttribute('x', '3');
  cover.setAttribute('y', '18');
  cover.setAttribute('width', '50');
  cover.setAttribute('height', '3');
  svg.append(cover);

  return svg;
}

function place(el, anchor) {
  const gap = 9;
  const margin = 10;
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;

  let left = r.right - w;                                  // right edges line up
  left = Math.max(margin, Math.min(left, window.innerWidth - w - margin));

  let top = r.bottom + gap;
  if (top + h > window.innerHeight - margin) {
    top = Math.max(margin, window.innerHeight - h - margin);
  }

  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;

  // Where the bump sits along the top edge.
  const centre = Math.min(Math.max(r.left + r.width / 2 - left, 30), w - 30);
  el.style.setProperty('--nub-x', `${Math.round(centre)}px`);
  if (!el.querySelector('.panel-nub')) el.append(makeNub());
  el.classList.remove('centred');
}

/** The kept element for a panel, if it has been built already. */
export function keptPanel(name) { return kept.get(name) || null; }

export function openPanel(name, el, { onClose, focus, anchor, persist = false } = {}) {
  // Clicking the button of the panel that is already open just closes it.
  if (suppress && suppress.name === name && Date.now() - suppress.at < 400) {
    suppress = null;
    return null;
  }
  suppress = null;
  if (panelIsOpen(name)) { closePanel(); return null; }

  closePanel();
  const trigger = anchorFor(name, anchor);

  let node = el;
  if (persist) {
    const already = kept.get(name);
    if (already && already.isConnected) node = already;
    else { kept.set(name, el); host().append(el); }
    node.hidden = false;
    node.classList.remove('panel-parked');
    node.classList.add('panel');
  } else {
    host().append(node);
  }

  current = { name, el: node, onClose, trigger, persist };

  // Measuring needs the element laid out, so this comes after unhiding.
  if (trigger) place(node, trigger);
  else node.classList.add('centred');

  /* Wait a frame before listening, or the very click that opened the panel
     closes it again. */
  requestAnimationFrame(() => {
    if (!current || current.el !== node) return;
    outsideCloser = (e) => {
      if (node.contains(e.target)) return;
      if (current.trigger && current.trigger.contains(e.target)) {
        suppress = { name: current.name, at: Date.now() };
      }
      closePanel();
    };
    document.addEventListener('pointerdown', outsideCloser, true);
  });

  if (focus) requestAnimationFrame(() => focus.focus());
  return node;
}

export function panelIsOpen(name) { return !!current && (!name || current.name === name); }

export function panelShell(title, body, foot) {
  return h('div', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('span', {}, title),
      h('button', { class: 'text-btn', onclick: closePanel }, 'Done')),
    h('div', { class: 'panel-body' }, body),
    foot ? h('div', { class: 'panel-foot' }, foot) : null);
}

/* ------------------------------------------------------------------- toast */

let toastTimer = null;
export function toast(message, ms = 2200) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

/* ------------------------------------------------------------- preferences */

/** Reorder and hide the buttons at the top right. */
function toolbarEditor(ctx) {
  const host = h('div', {});

  const draw = () => {
    const items = ctx.toolbar.items();
    const hidden = new Set(ctx.toolbar.hidden());
    host.textContent = '';

    items.forEach((item, i) => {
      const move = (delta) => {
        const order = items.map((x) => x.id);
        const j = i + delta;
        if (j < 0 || j >= order.length) return;
        [order[i], order[j]] = [order[j], order[i]];
        ctx.toolbar.setOrder(order);
        draw();
      };

      const row = h('div', {
        class: `tb-row ${item.pinned ? 'pinned' : ''}`,
        draggable: !item.pinned,
        ondragstart: (e) => {
          e.dataTransfer.setData('text/plain', item.id);
          row.classList.add('dragging');
        },
        ondragend: () => row.classList.remove('dragging'),
        ondragover: (e) => e.preventDefault(),
        ondrop: (e) => {
          e.preventDefault();
          const moved = e.dataTransfer.getData('text/plain');
          if (!moved || moved === item.id) return;
          const order = items.map((x) => x.id).filter((id) => id !== moved);
          order.splice(order.indexOf(item.id), 0, moved);
          ctx.toolbar.setOrder(order);
          draw();
        }
      },
        h('span', { class: 'grip' }, '\u2261'),
        h('span', { class: 'label' }, item.title),
        h('button', { class: 'move', title: 'Move left', disabled: i === 0,
                      onclick: () => move(-1) }, '\u2191'),
        h('button', { class: 'move', title: 'Move right', disabled: i === items.length - 1,
                      onclick: () => move(1) }, '\u2193'),
        item.pinned
          ? h('span', { class: 'val' }, 'always')
          : toggle(!hidden.has(item.id), (on) => {
              const next = new Set(hidden);
              if (on) next.delete(item.id); else next.add(item.id);
              ctx.toolbar.setHidden([...next]);
            }));
      host.append(row);
    });
  };

  draw();
  return host;
}

/** Multi-select of the dictionaries Chromium can download. */
function languagePicker(ctx) {
  const spelling = ctx.spelling || { available: [], current: [] };
  const chosen = new Set(spelling.current || []);
  const select = h('select', {
    multiple: true, size: 4, style: 'width:170px; height:88px',
    onchange: (e) => {
      const langs = [...e.target.selectedOptions].map((o) => o.value);
      ctx.setLanguages(langs);
    }
  });
  const common = ['en-US', 'en-GB', 'de', 'fr', 'es', 'it', 'nl', 'pt-BR', 'pl', 'sk', 'cs', 'hu'];
  const ordered = (spelling.available || []).slice().sort((a, b) => {
    const ai = common.indexOf(a); const bi = common.indexOf(b);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    return a.localeCompare(b);
  });
  for (const lang of ordered) {
    select.append(h('option', { value: lang, selected: chosen.has(lang) }, lang));
  }
  return select;
}

function row(label, hint, control) {
  return h('div', { class: 'row' },
    h('div', {}, h('div', {}, label), hint ? h('span', { class: 'hint' }, hint) : null),
    h('div', { class: 'ctl' }, control));
}

function slider(value, min, max, step, format, onInput) {
  const out = h('span', { class: 'val' }, format(value));
  const input = h('input', {
    type: 'range', min, max, step, value,
    oninput: (e) => { const v = parseFloat(e.target.value); out.textContent = format(v); onInput(v); }
  });
  return [input, out];
}

function segmented(options, value, onPick) {
  const wrap = h('div', { class: 'seg' });
  options.forEach(([val, label]) => {
    const b = h('button', { class: val === value ? 'on' : '', onclick: () => {
      wrap.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      onPick(val);
    } }, label);
    wrap.append(b);
  });
  return wrap;
}

function toggle(value, onPick) {
  const b = h('button', { class: `switch ${value ? 'on' : ''}` });
  b.addEventListener('click', () => {
    const next = !b.classList.contains('on');
    b.classList.toggle('on', next);
    onPick(next);
  });
  return b;
}

const PAGE_LAYOUT_KEYS = ['pageSize', 'printMargin', 'printBottomMargin', 'printSideMargin', 'printFontSize', 'printLeading', 'printJustify', 'printHyphenate'];

const PREF_SECTIONS = [
  { id: 'writing', title: 'Writing' },
  { id: 'words', title: 'Spelling & words' },
  { id: 'page', title: 'Page' },
  { id: 'window', title: 'Window' },
  { id: 'music', title: 'Music' },
  { id: 'files', title: 'Files & updates' }
];

/* Every setting, as words: what the row says, and the other words people
   reach for. The controls are built separately (see prefControls), so this
   list can be searched without building a panel. */
export const PREF_CATALOGUE = [
  { id: 'fontFamily', section: 'writing', label: 'Typeface', keys: 'font serif sans mono courier typewriter' },
  { id: 'fontSize', section: 'writing', label: 'Text size', keys: 'font size zoom bigger smaller' },
  { id: 'lineHeight', section: 'writing', label: 'Line spacing', keys: 'leading height' },
  { id: 'pageWidth', section: 'writing', label: 'Column width', keys: 'measure margin narrow wide' },
  { id: 'paragraphStyle', section: 'writing', label: 'Paragraphs', hint: 'How body text is laid out', keys: 'indent spacing blank line' },
  { id: 'typewriter', section: 'writing', label: 'Typewriter scrolling', hint: 'Keep the caret centred', keys: 'cursor centre scroll' },
  { id: 'focusScope', section: 'writing', label: 'Focus scope', hint: 'What stays lit in Focus Mode', keys: 'dim highlight distraction' },
  { id: 'smartTypography', section: 'writing', label: 'Smart punctuation', hint: 'Curly quotes, — and …', keys: 'quotes dashes ellipsis apostrophe' },
  { id: 'spellcheck', section: 'words', label: 'Check spelling', keys: 'spell misspelling underline' },
  { id: 'spellLanguages', section: 'words', label: 'Dictionary', hint: 'Right-click a misspelling for corrections', keys: 'language spelling english' },
  { id: 'onlineLookup', section: 'words', label: 'Look up words online', hint: 'Sends only the word, to dictionaryapi.dev and datamuse.com', keys: 'thesaurus synonyms definition reference privacy' },
  { id: 'readingSpeed', section: 'words', label: 'Reading speed', hint: 'Words per minute', keys: 'wpm reading time minutes stats' },
  { id: 'pageSize', section: 'page', label: 'Paper', hint: 'Letter and A4 are manuscript paper; the first two are book trims', keys: 'size trim a4 letter book print pdf' },
  { id: 'printSideMargin', section: 'page', label: 'Side margins', keys: 'left right column width print' },
  { id: 'printMargin', section: 'page', label: 'Top margin', keys: 'print' },
  { id: 'printBottomMargin', section: 'page', label: 'Bottom margin', keys: 'print lines per page' },
  { id: 'printFontSize', section: 'page', label: 'Print type size', keys: 'font pt pdf' },
  { id: 'printLeading', section: 'page', label: 'Print leading', hint: 'Book typesetting runs 120–170% of the type size', keys: 'line spacing height pdf' },
  { id: 'printJustify', section: 'page', label: 'Justify text', keys: 'ragged align flush' },
  { id: 'printHyphenate', section: 'page', label: 'Hyphenate', hint: 'Break words at the margin, as a printed book does', keys: 'hyphens break' },
  { id: 'pageMarkers', section: 'page', label: 'Page markers', hint: 'Where each printed page begins, in the margin as you write', keys: 'numbers breaks editor' },
  { id: 'resetPage', section: 'page', label: 'Reset page layout', hint: 'Back to Highland\'s page: 13pt Amiri at 160% in a 5.35in column', keys: 'default defaults highland' },
  { id: 'statusBar', section: 'window', label: 'Status bar', keys: 'word count footer bottom' },
  { id: 'menuStyle', section: 'window', label: 'Menu', hint: 'A button in the title bar, or the menus written out along it', keys: 'menubar title bar', notOn: 'darwin' },
  { id: 'toolbar', section: 'window', label: 'Toolbar', hint: 'Drag to reorder; switch buttons off', keys: 'buttons icons order hide', block: true },
  { id: 'youtubeEnabled', section: 'music', label: 'YouTube in the music pane', hint: 'Off means no browser view at all', keys: 'video sound audio browser' },
  { id: 'youtubeMinimal', section: 'music', label: 'Hide the distractions', hint: 'Comments, likes, recommendations and the shorts bar', keys: 'youtube comments recommendations shorts' },
  { id: 'saveTo', section: 'files', label: 'Save new documents to', keys: 'folder location dropbox' },
  { id: 'updateCheck', section: 'files', label: 'Check for updates on launch', hint: 'Asks GitHub for the newest release; installs nothing', keys: 'upgrade version github' }
];

export const prefSectionTitle = (id) => (PREF_SECTIONS.find((s) => s.id === id) || {}).title || '';

/** The control for each row, built against the live prefs. */
function prefControls(ctx, rebuild) {
  const p = ctx.prefs;
  const set = ctx.setPrefs;
  const managed = ctx.spelling && ctx.spelling.managedByOS;
  return {
    fontFamily: () => h('select', { onchange: (e) => set({ fontFamily: e.target.value }) },
      ...[['serif', 'Serif'], ['sans', 'Sans'], ['mono', 'Typewriter']].map(([v, l]) =>
        h('option', { value: v, selected: p.fontFamily === v }, l))),
    fontSize: () => slider(p.fontSize, 13, 30, 1, (v) => `${v}px`, (v) => set({ fontSize: v })),
    lineHeight: () => slider(p.lineHeight, 1.2, 2.4, 0.05, (v) => v.toFixed(2), (v) => set({ lineHeight: v })),
    pageWidth: () => slider(p.pageWidth, 460, 1100, 10, (v) => `${v}px`, (v) => set({ pageWidth: v })),
    paragraphStyle: () => segmented([['none', 'Plain'], ['indent', 'Indented'], ['spaced', 'Spaced']],
      p.paragraphStyle || 'none', (v) => set({ paragraphStyle: v })),
    typewriter: () => toggle(p.typewriter, (v) => set({ typewriter: v })),
    focusScope: () => segmented([['paragraph', 'Paragraph'], ['line', 'Line']], p.focusScope, (v) => set({ focusScope: v })),
    smartTypography: () => toggle(p.smartTypography !== false, (v) => set({ smartTypography: v })),
    spellcheck: () => toggle(p.spellcheck !== false, (v) => set({ spellcheck: v })),
    spellLanguages: () => (managed ? h('span', { class: 'val' }, 'System') : languagePicker(ctx)),
    onlineLookup: () => toggle(p.onlineLookup !== false, (v) => set({ onlineLookup: v })),
    readingSpeed: () => h('input', {
      type: 'number', min: 100, max: 600, step: 25, value: p.readingSpeed || 275, style: 'width:74px',
      onchange: (e) => set({ readingSpeed: Math.max(100, Math.min(600, +e.target.value || 275)) })
    }),
    pageSize: () => segmented([['6x9', '6×9'], ['5.5x8.5', '5½×8½'], ['letter', 'Letter'], ['a4', 'A4']],
      p.pageSize || 'a4', (v) => set({ pageSize: v })),
    printSideMargin: () => slider(p.printSideMargin || 1.46, 0.5, 2, 0.01, (v) => `${v.toFixed(2)}"`, (v) => set({ printSideMargin: v })),
    printMargin: () => slider(p.printMargin || 1, 0.5, 2, 0.05, (v) => `${v.toFixed(2)}"`, (v) => set({ printMargin: v })),
    printBottomMargin: () => slider(p.printBottomMargin || 1, 0.5, 2, 0.05, (v) => `${v.toFixed(2)}"`, (v) => set({ printBottomMargin: v })),
    printFontSize: () => slider(p.printFontSize || 13, 9, 16, 0.25, (v) => `${v}pt`, (v) => set({ printFontSize: v })),
    printLeading: () => slider(p.printLeading || 1.6, 1.2, 2.4, 0.05, (v) => v.toFixed(2), (v) => set({ printLeading: v })),
    printJustify: () => toggle(p.printJustify !== false, (v) => set({ printJustify: v })),
    printHyphenate: () => toggle(!!p.printHyphenate, (v) => set({ printHyphenate: v })),
    pageMarkers: () => toggle(!!p.pageMarkers, (v) => set({ pageMarkers: v })),
    resetPage: () => h('button', { class: 'btn', id: 'reset-page-layout', onclick: async () => {
      const prefs = await ctx.resetPrefs(PAGE_LAYOUT_KEYS);
      rebuild(Object.assign({}, ctx, { prefs }));   // so the sliders show what they now hold
    } }, 'Reset'),
    statusBar: () => toggle(p.statusBar !== false, (v) => set({ statusBar: v })),
    menuStyle: () => segmented([['button', 'Button'], ['bar', 'Menu bar']],
      p.menuStyle === 'bar' ? 'bar' : 'button', (v) => set({ menuStyle: v })),
    toolbar: () => toolbarEditor(ctx),
    youtubeEnabled: () => toggle(p.youtubeEnabled !== false, (v) => set({ youtubeEnabled: v })),
    youtubeMinimal: () => toggle(p.youtubeMinimal !== false, (v) => set({ youtubeMinimal: v })),
    saveTo: () => segmented([['documents', 'Documents'], ['dropbox', 'Dropbox']],
      p.saveTo || 'documents', (v) => set({ saveTo: ctx.dropbox ? v : 'documents' })),
    updateCheck: () => toggle(p.updateCheck !== false, (v) => set({ updateCheck: v }))
  };
}

/** Rows shown on this platform, with hints that depend on the machine. */
export function prefRows(ctx) {
  return PREF_CATALOGUE.filter((r) => !r.notOn || r.notOn !== ctx.platform).map((r) => {
    if (r.id === 'spellLanguages' && ctx.spelling && ctx.spelling.managedByOS) {
      return Object.assign({}, r, { hint: 'macOS uses the languages set in System Settings' });
    }
    if (r.id === 'saveTo') return Object.assign({}, r, { hint: ctx.dropbox || 'Dropbox folder not found' });
    return r;
  });
}

/**
 * @param opts.focus  a row id: its section opens, the row scrolls into view
 *                    and is picked out for a moment. How Search lands here.
 */
export function showPreferences(ctx, opts = {}) {
  const el = openPanel('prefs', panelShell('Preferences', preferencesBody(ctx, opts)));
  if (el && opts.focus) revealPref(el, opts.focus);
}

function revealPref(panel, id) {
  const row = panel.querySelector(`[data-pref="${id}"]`);
  if (!row) return;
  row.scrollIntoView({ block: 'center' });
  row.classList.add('picked');
  setTimeout(() => row.classList.remove('picked'), 1600);
}

function preferencesBody(ctx, opts = {}) {
  const set = ctx.setPrefs;
  const collapsed = new Set(ctx.prefs.prefsCollapsed || PREF_SECTIONS.slice(1).map((s) => s.id));
  if (opts.focus) {
    const r = PREF_CATALOGUE.find((x) => x.id === opts.focus);
    if (r) collapsed.delete(r.section);
  }

  let body;
  const rebuild = (ctx2) => {
    const next = preferencesBody(ctx2, opts);
    body.replaceWith(next);
    body = next;
  };
  const controls = prefControls(ctx, rebuild);
  const rows = prefRows(ctx);

  body = h('div', { class: 'prefs-body' });
  for (const sec of PREF_SECTIONS) {
    const list = h('div', { class: 'prefs-rows' });
    for (const r of rows.filter((x) => x.section === sec.id)) {
      const control = controls[r.id]();
      const el = r.block
        ? h('div', { class: 'row block' },
            h('div', {}, h('div', {}, r.label), r.hint ? h('span', { class: 'hint' }, r.hint) : null), control)
        : row(r.label, r.hint, control);
      el.dataset.pref = r.id;
      list.append(el);
    }
    const isOpen = !collapsed.has(sec.id);
    const head = h('button', { class: 'prefs-section-head', type: 'button', 'aria-expanded': String(isOpen) },
      h('span', { class: 'chev' }), h('span', {}, sec.title));
    const el = h('section', { class: `prefs-section${isOpen ? '' : ' collapsed'}`, 'data-section': sec.id }, head, list);
    head.onclick = () => {
      const closing = !el.classList.contains('collapsed');
      el.classList.toggle('collapsed', closing);
      head.setAttribute('aria-expanded', String(!closing));
      if (closing) collapsed.add(sec.id); else collapsed.delete(sec.id);
      set({ prefsCollapsed: [...collapsed] });
    };
    body.append(el);
  }
  return body;
}

/* ------------------------------------------------------------------ search */

/* Words people reach for that are not the words on anything. Each maps to
   the ids of things it should find. */
const RELATED = {
  font: ['fontFamily', 'printFontSize'], fonts: ['fontFamily', 'printFontSize'],
  zoom: ['fontSize', 'printFontSize', 'go:pages'], bigger: ['fontSize', 'printFontSize'], smaller: ['fontSize', 'printFontSize'],
  width: ['pageWidth', 'printSideMargin'], narrow: ['pageWidth', 'printSideMargin'], wide: ['pageWidth', 'printSideMargin'],
  spacing: ['lineHeight', 'printLeading', 'paragraphStyle'], leading: ['lineHeight', 'printLeading'],
  indent: ['paragraphStyle'], indentation: ['paragraphStyle'],
  quotes: ['smartTypography'], dashes: ['smartTypography'], punctuation: ['smartTypography'],
  language: ['spellLanguages'], languages: ['spellLanguages'], spell: ['spellcheck', 'spellLanguages'],
  print: ['pageSize', 'printFontSize', 'go:export'], pdf: ['go:export', 'pageSize'],
  page: ['pageSize', 'pageMarkers', 'go:pages'], pages: ['go:pages', 'pageSize', 'pageMarkers'],
  numbers: ['pageMarkers'], count: ['go:stats', 'pageMarkers'],
  a4: ['pageSize'], letter: ['pageSize'], trim: ['pageSize'], book: ['pageSize', 'printHyphenate'],
  sound: ['go:music', 'youtubeEnabled'], audio: ['go:music'], video: ['go:music', 'youtubeEnabled'], song: ['go:music'], playlist: ['go:music'],
  distraction: ['youtubeMinimal', 'go:focus'], distractions: ['youtubeMinimal', 'go:focus'],
  dim: ['focusScope', 'go:focus'], concentrate: ['go:focus', 'go:sprint'],
  update: ['updateCheck', 'go:updates'], updates: ['updateCheck', 'go:updates'], upgrade: ['go:updates'],
  dropbox: ['saveTo'], folder: ['saveTo'], location: ['saveTo'], where: ['saveTo'],
  wpm: ['readingSpeed'], minutes: ['readingSpeed', 'go:sprint'], time: ['readingSpeed', 'go:sprint'],
  privacy: ['onlineLookup', 'updateCheck'], online: ['onlineLookup', 'updateCheck'], internet: ['onlineLookup', 'updateCheck', 'youtubeEnabled'],
  buttons: ['toolbar'], icons: ['toolbar'], order: ['toolbar'],
  colour: ['go:themes'], colours: ['go:themes'], color: ['go:themes'], colors: ['go:themes'],
  dark: ['go:themes'], light: ['go:themes'], appearance: ['go:themes'], background: ['go:themes'], look: ['go:themes'], wallpaper: ['go:themes'], skin: ['go:themes'], mode: ['go:themes', 'go:focus'],
  goal: ['go:stats'], goals: ['go:stats'], target: ['go:stats'], daily: ['go:stats'], progress: ['go:stats'],
  timer: ['go:sprint'], pomodoro: ['go:sprint'], stopwatch: ['go:sprint'],
  shortcut: ['go:help'], shortcuts: ['go:help'], keyboard: ['go:help'], hotkey: ['go:help'], hotkeys: ['go:help'], syntax: ['go:help'], markdown: ['go:help'], fountain: ['go:help'],
  backup: ['go:revisions'], backups: ['go:revisions'], autosave: ['go:revisions'], versions: ['go:revisions'], history: ['go:revisions'], undo: ['go:revisions'],
  stats: ['go:stats'], statistics: ['go:stats'], words: ['go:stats', 'readingSpeed'],
  notes: ['go:scratch', 'go:outline'], ideas: ['go:scratch'], todo: ['go:scratch'], plan: ['go:outline'], structure: ['go:outline', 'go:navigator'], beats: ['go:outline'],
  chapters: ['go:navigator'], scenes: ['go:navigator'], contents: ['go:navigator'],
  synonym: ['go:reference'], synonyms: ['go:reference'], thesaurus: ['go:reference'], dictionary: ['go:reference', 'spellLanguages'], definition: ['go:reference'],
  cover: ['go:title'], author: ['go:title'], copyright: ['go:title'],
  open: ['go:home'], recent: ['go:home'], new: ['go:home'], files: ['go:home', 'saveTo'],
  settings: ['go:prefs'], options: ['go:prefs'], config: ['go:prefs']
};

/* Edit distance with transpositions, capped so it stays cheap. */
function editDistance(a, b, cap) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = null, cur = Array.from({ length: b.length + 1 }, (_, j) => j), prev2 = null;
  for (let i = 1; i <= a.length; i++) {
    prev2 = prev; prev = cur; cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prev2[j - 2] + 1);
      cur.push(v); if (v < best) best = v;
    }
    if (best > cap) return cap + 1;
  }
  return cur[b.length];
}

const tolerance = (word) => (word.length <= 3 ? 0 : word.length <= 5 ? 1 : 2);
const wordsOf = (text) => String(text).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Everything Search can find: places in the app, settings, and the menu. */
function searchIndex(ctx, menu) {
  const go = ctx.open || {};
  const places = [
    ['go:navigator', 'Navigator', 'Chapters and sections, in the sidebar', 'chapters sections outline contents structure', () => go.tab && go.tab('navigator')],
    ['go:stats', 'Statistics and word goal', 'In the sidebar', 'words pages reading time goal target count', () => go.tab && go.tab('stats')],
    ['go:scratch', 'Scratchpad', 'Notes beside the manuscript', 'notes ideas todo scratch', () => go.tab && go.tab('scratch')],
    ['go:revisions', 'Revisions', 'Saved versions and backups', 'versions history backup compare', () => go.tab && go.tab('revisions')],
    ['go:reference', 'Dictionary and thesaurus', 'Definitions and synonyms, in the sidebar', 'lookup synonyms definition words', () => go.tab && go.tab('reference')],
    ['go:outline', 'Outline', 'A second editor beside the manuscript', 'plan structure beats story circle acts', () => go.outline && go.outline()],
    ['go:pages', 'Pages view', 'The manuscript as it prints', 'preview print pdf zoom', () => go.preview && go.preview(true)],
    ['go:text', 'Text view', 'Back to writing', 'editor write', () => go.preview && go.preview(false)],
    ['go:focus', 'Focus mode', 'Dim everything but where you are', 'concentrate distraction dim', () => go.focus && go.focus()],
    ['go:music', 'Music', 'Your files, or YouTube', 'sound audio youtube playlist', () => go.music && go.music()],
    ['go:themes', 'Themes', 'Colours of the window', 'dark light colour appearance', () => showThemes(ctx)],
    ['go:sprint', 'Writing sprint', 'A timer and a word target', 'timer pomodoro', () => showSprint(ctx)],
    ['go:export', 'Export', 'PDF, HTML, Word or plain text', 'print save share', () => showExport(ctx)],
    ['go:title', 'Title page', 'Title, author, contact, draft date', 'cover front matter copyright', () => showTitlePage(ctx)],
    ['go:help', 'Markup and shortcuts', 'What the symbols mean; every key', 'help keyboard syntax markdown fountain', () => showHelp()],
    ['go:prefs', 'Preferences', 'Every setting', 'settings options', () => showPreferences(ctx)],
    ['go:home', 'Home', 'Open, create, recent documents', 'open recent new files templates', () => go.home && go.home()],
    ['go:updates', 'Check for updates', 'Asks GitHub for the newest release', 'upgrade version', () => go.updates && go.updates()]
  ].map(([id, label, hint, keys, run]) => ({ id, kind: 'Go to', label, hint, keys, run }));

  const settings = prefRows(ctx).map((r) => ({
    id: r.id, kind: 'Setting', label: r.label, hint: `${prefSectionTitle(r.section)} · Preferences`,
    keys: `${r.hint || ''} ${r.keys}`, run: () => showPreferences(ctx, { focus: r.id })
  }));

  const commands = [];
  const walk = (items, path) => {
    for (const it of items || []) {
      if (!it || it.type === 'separator' || !it.label) continue;
      if (it.submenu) { walk(it.submenu, path.concat(it.label)); continue; }
      if (!it.id || it.enabled === false) continue;
      const trail = path.filter((x) => x && !/^(Low Tide|Window)$/.test(x));
      commands.push({ id: `menu:${it.id}`, kind: 'Command', label: it.label.replace(/…$/, ''),
        hint: trail.join(' › ') + (it.accelerator ? `  ${prettyAccelerator(it.accelerator, ctx.platform)}` : ''),
        keys: trail.join(' '), run: () => ctx.menu && ctx.menu.invoke(it.id) });
    }
  };
  walk(menu, []);
  // A menu item that only opens a place already listed says nothing new.
  const named = new Set([...places, ...settings].map((e) => e.label.toLowerCase()));
  return [...places, ...settings, ...commands.filter((c) => !named.has(c.label.toLowerCase()))];
}

function prettyAccelerator(acc, platform) {
  const mac = platform === 'darwin';
  return acc.replace('CmdOrCtrl', mac ? '⌘' : 'Ctrl').replace('Shift', mac ? '⇧' : 'Shift').replace('Alt', mac ? '⌥' : 'Alt')
    .replace(/\+/g, mac ? '' : '+').replace('Plus', '+');
}

let menuCache = null;

/** The search popover: everything in the app, a keystroke away. */
export async function showSearch(ctx) {
  if (!menuCache && ctx.menu) {
    try { menuCache = await ctx.menu.describe(); } catch { menuCache = []; }
  }
  const index = searchIndex(ctx, menuCache || []);
  const allWords = [...new Set(index.flatMap((e) => wordsOf(`${e.label} ${e.keys}`)).filter((w) => w.length > 2))];

  const input = h('input', { class: 'search-input', type: 'search', placeholder: 'Search settings, places and commands',
    'aria-label': 'Search', autocomplete: 'off', spellcheck: 'false' });
  const results = h('div', { class: 'search-results', role: 'listbox' });
  const body = h('div', { class: 'search-body' }, input, results);
  let selected = 0;

  // A token matches a word outright, or within a typo or two of the word
  // or of the word's opening — so "margn" reaches "margins".
  const hits = (token, text) => {
    if (text.includes(token)) return 0;
    const tol = tolerance(token);
    return tol > 0 && wordsOf(text).some((w) =>
      editDistance(token, w, tol) <= tol ||
      (token.length >= 5 && w.length > token.length && editDistance(token, w.slice(0, token.length), tol) <= tol)) ? 1 : -1;
  };

  // The ids a token reaches through RELATED, allowing for a typo in it.
  const relatedTo = (t) => {
    const out = new Set();
    for (const w of Object.keys(RELATED)) {
      if (w === t || editDistance(t, w, tolerance(t)) <= tolerance(t)) RELATED[w].forEach((id) => out.add(id));
    }
    return out;
  };

  // How well an entry answers the query: how many of its words it meets,
  // and how directly (a label is better than a hint is better than a typo).
  const score = (e, tokens, related) => {
    const label = e.label.toLowerCase();
    const rest = `${e.hint || ''} ${e.keys || ''}`.toLowerCase();
    let total = 0, met = 0;
    for (let i = 0; i < tokens.length; i++) {
      const t = tokens[i];
      met++;
      if (label.startsWith(t)) { total += 0; continue; }
      if (label.includes(t)) { total += 1; continue; }
      if (related[i].has(e.id)) { total += 1.5; continue; }
      const inRest = hits(t, rest);
      if (inRest === 0) { total += 2; continue; }
      if (hits(t, label) === 1) { total += 3; continue; }
      if (inRest === 1) { total += 4; continue; }
      met--;
    }
    return { met, total: total + (e.kind === 'Go to' ? 0 : e.kind === 'Setting' ? 0.5 : 1) };
  };

  const render = () => {
    const tokens = wordsOf(input.value);
    results.textContent = '';
    if (!tokens.length) {
      results.append(h('div', { class: 'search-tip' }, 'Type a setting, a place in the app, or a menu command. ↑↓ to choose, Enter to go.'));
      return;
    }
    const related = tokens.map(relatedTo);
    // Everything that meets every word; failing that, anything meeting some.
    const scored = index.map((e) => ({ e, s: score(e, tokens, related) })).filter((x) => x.s.met > 0);
    const best = Math.max(0, ...scored.map((x) => x.s.met));
    const ranked = scored.filter((x) => x.s.met === best)
      .sort((a, b) => a.s.total - b.s.total).slice(0, 12).map((x) => x.e);
    selected = 0;
    if (ranked.length) {
      ranked.forEach((e, i) => {
        results.append(h('button', { class: `search-hit${i === 0 ? ' selected' : ''}`, type: 'button', role: 'option',
          'data-id': e.id, onclick: () => choose(e), onmousemove: () => select(i) },
          h('span', { class: 'kind' }, e.kind),
          h('span', { class: 'text' }, h('span', { class: 'label' }, e.label), e.hint ? h('span', { class: 'hint' }, e.hint) : null)));
      });
      return;
    }
    // Nothing: the nearest real words, and anything related.
    const near = [];
    for (const t of tokens) for (const w of allWords) {
      if (w.length < 4) continue;
      const d = editDistance(t, w, 2);
      if (d <= 2 && d < t.length) near.push({ w, d });
    }
    near.sort((a, b) => a.d - b.d || a.w.length - b.w.length);
    const suggestions = [...new Set(near.map((n) => n.w))].filter((w) => !tokens.includes(w)).slice(0, 4);
    const relatedIds = new Set(related.flatMap((set) => [...set]));
    results.append(h('div', { class: 'search-empty' }, `Nothing for “${input.value.trim()}”`));
    if (suggestions.length) {
      results.append(h('div', { class: 'search-line' }, 'Did you mean ',
        ...suggestions.flatMap((w, i) => [i ? ', ' : '', h('button', { class: 'prefs-chip', type: 'button',
          onclick: () => { input.value = w; render(); input.focus(); } }, w)]), '?'));
    }
    const rel = [...relatedIds].map((id) => index.find((e) => e.id === id)).filter(Boolean);
    if (rel.length) {
      results.append(h('div', { class: 'search-line' }, 'Related'));
      rel.slice(0, 6).forEach((e, i) => results.append(h('button', { class: `search-hit${i === 0 ? ' selected' : ''}`, type: 'button',
        'data-id': e.id, onclick: () => choose(e), onmousemove: () => select(i) },
        h('span', { class: 'kind' }, e.kind),
        h('span', { class: 'text' }, h('span', { class: 'label' }, e.label), e.hint ? h('span', { class: 'hint' }, e.hint) : null))));
    }
    if (!suggestions.length && !rel.length) {
      results.append(h('div', { class: 'search-line' }, 'Try the name of a setting, a sidebar tab, or a menu item.'));
    }
  };

  const hitEls = () => [...results.querySelectorAll('.search-hit')];
  const select = (i) => {
    const els = hitEls();
    if (!els.length) return;
    selected = Math.max(0, Math.min(els.length - 1, i));
    els.forEach((el, k) => el.classList.toggle('selected', k === selected));
    els[selected].scrollIntoView({ block: 'nearest' });
  };
  const choose = (e) => { closePanel(); e.run(); };

  input.addEventListener('input', render);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'ArrowDown') { select(selected + 1); ev.preventDefault(); }
    else if (ev.key === 'ArrowUp') { select(selected - 1); ev.preventDefault(); }
    else if (ev.key === 'Enter') {
      const el = hitEls()[selected];
      if (el) { const e = index.find((x) => x.id === el.dataset.id); if (e) choose(e); }
      ev.preventDefault();
    }
  });
  render();
  openPanel('search', h('div', { class: 'panel search-panel' }, body), { focus: input });
}

/* ------------------------------------------------------------------ sprint */

export function showSprint(ctx) {
  const sprint = ctx.sprint;
  const state = sprint.state();

  if (state.running) {
    const body = h('div', { class: 'sprint-face' },
      h('div', { class: 'sprint-clock', id: 'sprint-clock' }, sprint.clock()),
      h('div', { class: 'sprint-sub', id: 'sprint-sub' }, sprint.subtitle()));
    const panel = panelShell('Sprint', body, [
      h('button', { class: 'btn', onclick: () => { sprint.stop(); closePanel(); } }, 'Stop')
    ]);
    openPanel('sprint', panel, { onClose: () => sprint.setTick(null) });
    sprint.setTick(() => {
      const c = document.getElementById('sprint-clock');
      const s = document.getElementById('sprint-sub');
      if (c) c.textContent = sprint.clock();
      if (s) s.textContent = sprint.subtitle();
    });
    return;
  }

  let minutes = ctx.prefs.sprintMinutes || 15;
  let goal = ctx.prefs.sprintGoal || 0;

  const presets = h('div', { class: 'sprint-presets' });
  const mkPreset = (m) => h('button', { class: `btn ${m === minutes ? 'primary' : ''}`, onclick: () => {
    minutes = m;
    presets.querySelectorAll('button').forEach((b) => b.classList.remove('primary'));
    presets.querySelectorAll('button')[[5, 10, 15, 25, 45].indexOf(m)].classList.add('primary');
    clock.textContent = `${String(m).padStart(2, '0')}:00`;
  } }, `${m}m`);
  [5, 10, 15, 25, 45].forEach((m) => presets.append(mkPreset(m)));

  const clock = h('div', { class: 'sprint-clock' }, `${String(minutes).padStart(2, '0')}:00`);

  const body = h('div', {},
    h('div', { class: 'sprint-face' }, clock,
      h('div', { class: 'sprint-sub' }, 'Write without stopping.')),
    presets,
    row('Word goal', 'Optional — 0 for none', h('input', {
      type: 'number', min: 0, max: 5000, step: 50, value: goal, style: 'width:84px',
      onchange: (e) => { goal = Math.max(0, +e.target.value || 0); }
    })));

  const panel = panelShell('Sprint', body, [
    h('button', { class: 'btn', onclick: closePanel }, 'Cancel'),
    h('button', { class: 'btn primary', onclick: () => {
      ctx.setPrefs({ sprintMinutes: minutes, sprintGoal: goal });
      sprint.start(minutes, goal);
      closePanel();
    } }, 'Start')
  ]);
  openPanel('sprint', panel);
}

/* ------------------------------------------------------------------ themes */

export function showThemes(ctx) {
  const { THEMES, swatches } = ctx.themes;
  const current = ctx.prefs.theme || 'material';
  const body = h('div', {});

  for (const dark of [false, true]) {
    body.append(h('div', { class: 'theme-group' }, dark ? 'Dark' : 'Light'));
    for (const theme of THEMES.filter((t) => !!t.dark === dark)) {
      const chips = h('span', { class: 'theme-chips' },
        ...swatches(theme).map((c) => h('i', { style: `background:${c}` })));
      body.append(h('button', {
        class: `theme-row ${theme.id === current ? 'on' : ''}`,
        onclick: (e) => {
          body.querySelectorAll('.theme-row').forEach((r) => r.classList.remove('on'));
          e.currentTarget.classList.add('on');
          ctx.setPrefs({ theme: theme.id });
        }
      }, h('span', {}, theme.name), chips));
    }
  }

  openPanel('theme', panelShell('Editor Theme', body));
}

/* --------------------------------------------------------------- revisions */

export function showNewRevision(ctx) {
  const colours = ctx.revisionColours;
  const used = new Set((ctx.prefs.__usedColours || []));
  let picked = (colours.find((c) => !used.has(c.id)) || colours[0]).id;

  const input = h('input', { type: 'text', placeholder: 'Revision name',
                             class: 'filter-input', value: '' });

  const swatchRow = h('div', { class: 'rev-swatches' });
  colours.forEach((c) => {
    const b = h('button', {
      class: `rev-swatch ${c.id === picked ? 'on' : ''}`,
      style: `background:${c.hex}`, title: c.name,
      onclick: () => {
        picked = c.id;
        swatchRow.querySelectorAll('.rev-swatch').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        if (!input.value.trim()) input.value = c.name;
      }
    });
    swatchRow.append(b);
  });

  const create = () => {
    const name = input.value.trim() ||
      colours.find((c) => c.id === picked).name;
    ctx.addRevision(name, picked);
    closePanel();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });

  const body = h('div', {}, input, swatchRow,
    h('div', { class: 'hint', style: 'margin-top:10px' },
      'While a revision is selected, everything you type is marked in its colour.'));

  openPanel('revision', panelShell('New Revision', body, [
    h('button', { class: 'btn', onclick: closePanel }, 'Cancel'),
    h('button', { class: 'btn primary', onclick: create }, 'Create')
  ]), { focus: input });
}

/* -------------------------------------------------------------------- goal */

export function showGoal(ctx) {
  const types = ctx.goalTypes;
  let type = 'new-words';

  const input = h('input', {
    type: 'number', min: 1, max: 200000, step: 10, value: 500,
    class: 'filter-input', style: 'text-align:center; font-size:17px'
  });

  const select = h('select', { style: 'width:100%',
    onchange: (e) => { type = e.target.value; } },
    ...types.map((t) => h('option', { value: t.id }, t.label.replace(/^./, (c) => c.toUpperCase()))));

  const presets = h('div', { class: 'sprint-presets' });
  [250, 500, 1000, 1667].forEach((n) => {
    presets.append(h('button', { class: 'btn', onclick: () => { input.value = n; } }, n.toLocaleString()));
  });

  const create = () => {
    const target = Math.max(1, +input.value || 0);
    ctx.startGoal(type, target);
    closePanel();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });

  const body = h('div', {},
    h('div', { class: 'sprint-sub', style: 'text-align:center;margin-bottom:10px' },
      'What are you aiming for?'),
    input,
    h('div', { style: 'margin-top:10px' }, select),
    presets);

  openPanel('goal', panelShell('New Goal', body, [
    h('button', { class: 'btn', onclick: closePanel }, 'Cancel'),
    h('button', { class: 'btn primary', onclick: create }, 'Set Goal')
  ]), { focus: input });
}

/* ------------------------------------------------------------ revision menu */

export function showRevisionMenu(ctx) {
  const rev = ctx.revision;
  const marked = ctx.marked;

  const item = (label, hint, onclick, cls = '') =>
    h('button', { class: `menu-item ${cls}`, onclick: () => { onclick(); closePanel(); } },
      h('span', {}, label), h('span', { class: 's' }, hint));

  const body = h('div', { class: 'menu-list' },
    item(rev.hidden ? 'Show marks' : 'Hide marks',
         rev.hidden ? 'Colour this revision again' : 'Keep the marks, stop showing them',
         ctx.toggleVisible),
    item('Apply', marked ? 'Keep the text, clear the colour' : 'Nothing marked',
         ctx.apply),
    item('Revert changes',
         marked ? `Delete the ${marked.toLocaleString()} character${marked === 1 ? '' : 's'} it added` : 'Nothing marked',
         ctx.revert, 'danger'),
    item('Delete revision', 'Remove it from the list; the text stays', ctx.remove, 'danger'));

  openPanel('revision-menu', panelShell(rev.name, body));
}

/* -------------------------------------------------------------------- goto */

export function showGoto(ctx) {
  const items = ctx.outline();
  if (!items.length) { toast('No chapters yet — start a line with #'); return; }

  let filtered = items;
  let sel = 0;

  const list = h('div', { class: 'goto-list' });
  const input = h('input', {
    class: 'filter-input', type: 'text', placeholder: 'Go to chapter…',
    oninput: (e) => { apply(e.target.value); }
  });

  function render() {
    list.textContent = '';
    filtered.forEach((item, i) => {
      list.append(h('button', {
        class: `goto-item lvl-${item.level} ${i === sel ? 'sel' : ''}`,
        onclick: () => { ctx.goto(item); closePanel(); }
      }, h('span', {}, item.title), h('span', { class: 'count' }, `${item.words.toLocaleString()}`)));
    });
    const active = list.children[sel];
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  function apply(query) {
    const q = query.trim().toLowerCase();
    filtered = q ? items.filter((i) => i.title.toLowerCase().includes(q)) : items;
    sel = 0;
    render();
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, filtered.length - 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); render(); e.preventDefault(); }
    else if (e.key === 'Enter') { if (filtered[sel]) { ctx.goto(filtered[sel]); closePanel(); } e.preventDefault(); }
  });

  render();
  openPanel('goto', panelShell('Go to Chapter', h('div', {}, input, list)), { focus: input });
}

/* -------------------------------------------------------------------- help */

const CHEATS = [
  ['Structure', [
    ['# Chapter One', 'Chapter — appears in the Navigator'],
    ['## Scene', 'Section'],
    ['### Beat', 'Sub-section'],
    ['===', 'Page break'],
    ['***', 'Scene break']
  ]],
  ['Emphasis', [
    ['**bold**', 'Bold'],
    ['*italic*', 'Italic'],
    ['***both***', 'Bold italic'],
    ['_underline_', 'Underline'],
    ['~~struck~~', 'Strikethrough']
  ]],
  ['Asides', [
    ['[[a note]]', 'Note — never printed, never counted'],
    ['/* … */', 'Comment — hidden from the manuscript'],
    ['> centered <', 'Centered line'],
    ['> flush right', 'Right aligned']
  ]]
];

export function showHelp() {
  const grid = h('div', { class: 'help-grid' });
  for (const [section, rows] of CHEATS) {
    grid.append(h('div', { class: 'help-sect' }, section));
    for (const [code, desc] of rows) {
      grid.append(h('code', {}, code), h('span', {}, desc));
    }
  }
  openPanel('help', panelShell('Markup', grid));
}

/* ----------------------------------------------------------------- backups */

function whenLabel(time) {
  const d = new Date(time);
  const mins = Math.round((Date.now() - time) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const sameDay = new Date().toDateString() === d.toDateString();
  const clock = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `today, ${clock}`;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${clock}`;
}

export function showBackups(ctx) {
  const body = h('div', {});

  if (!ctx.list.length) {
    body.append(h('div', { class: 'rev-empty' },
      'No versions kept yet. One is stored each time the document is saved over.'));
  } else {
    const list = h('div', { class: 'goto-list' });
    for (const entry of ctx.list) {
      list.append(h('button', {
        class: 'goto-item',
        onclick: () => { ctx.open(entry); closePanel(); }
      },
        h('span', {}, whenLabel(entry.time)),
        h('span', { class: 'count' }, `${Math.max(1, Math.round(entry.size / 1024))} KB`)));
    }
    body.append(list);
    body.append(h('div', { class: 'hint', style: 'margin-top:10px' },
      'A version opens in a new window so the document you are editing is never overwritten.'));
  }

  openPanel('backups', panelShell('Revert to Backup', body));
}

/* ------------------------------------------------------------------ export */

/**
 * The title page as a form. The document keeps it as a Key: Value block at the
 * top — that is what the file format is — but nobody should have to remember
 * the keys. Fill the fields in and the block is written; clear them and it
 * goes. Turning the title page on in the pages view is a separate switch,
 * since a manuscript can carry the details without printing a page of them.
 */
export function showTitlePage(ctx) {
  const meta = ctx.frontMatter();
  const fields = [
    ['title', 'Title', meta.title || ''],
    ['author', 'Author', meta.author || meta.authors || ''],
    ['contact', 'Contact', meta.contact || ''],
    ['draft date', 'Draft date', meta['draft date'] || meta.date || ''],
    ['copyright', 'Copyright', meta.copyright || '']
  ];

  const inputs = {};
  const body = h('div', { class: 'title-form' },
    ...fields.map(([key, label, value]) => {
      const input = h('input', { type: 'text', class: 'filter-input', value, spellcheck: 'false',
                                 placeholder: label });
      inputs[key] = input;
      return h('label', { class: 'title-field' }, h('span', {}, label), input);
    }),
    h('p', { class: 'hint' },
      'Kept at the top of the file as plain text, so it travels with the manuscript. ' +
      'Tick “Title Page” in the pages view to print it.'));

  const apply = () => {
    const entries = fields
      .map(([key, label]) => [label, inputs[key].value.trim()])
      .filter(([, v]) => v);
    ctx.setFrontMatter(entries);
    closePanel();
    toast(entries.length ? 'Title page updated' : 'Title page cleared');
  };

  openPanel('title', panelShell('Title Page', body, [
    h('button', { class: 'btn', onclick: closePanel }, 'Cancel'),
    h('button', { class: 'btn primary', onclick: apply }, 'Save')
  ]), { focus: inputs.title });
}

export function showExport(ctx) {
  const body = h('div', {},
    row('PDF', 'Formatted manuscript pages', h('button', { class: 'btn primary',
      onclick: () => { ctx.exportAs('pdf'); closePanel(); } }, 'Export')),
    row('Word', 'A real .docx, styles and all', h('button', { class: 'btn',
      onclick: () => { ctx.exportAs('docx'); closePanel(); } }, 'Export')),
    row('HTML', 'Self-contained web page', h('button', { class: 'btn',
      onclick: () => { ctx.exportAs('html'); closePanel(); } }, 'Export')),
    row('Plain text', 'Prose only — markup stripped', h('button', { class: 'btn',
      onclick: () => { ctx.exportAs('txt'); closePanel(); } }, 'Export')),
    row('Markdown', 'Source as written', h('button', { class: 'btn',
      onclick: () => { ctx.exportAs('md'); closePanel(); } }, 'Export')));
  openPanel('export', panelShell('Export', body));
}
