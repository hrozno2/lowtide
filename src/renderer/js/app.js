import { createEditor, toggleEmphasis, setHeading, toggleCenter, wrapNote,
         insertBlock, gotoPosition, replaceAll, centerCursor,
         openFind, findNextMatch, findPreviousMatch,
         replaceNextMatch, replaceEveryMatch } from './editor.js';
import { outline as buildOutline, pagesHtml, printHtml, frontMatter,
         titlePageHtml, esc, documentBlocks } from './parse.js';
import { paginate, geometryFor } from './pagination.js';
import { OUTLINE_TEMPLATES, templateById } from './outlines.js';
import { countWords, stripMarkup } from './markup.js';
import * as ui from './panels.js';
import { THEMES, swatches, applyTheme } from './themes.js';
import { AMBIENCES, createAmbiencePlayer, measureAmbience } from './ambience.js';
import { REVISION_COLOURS, colourById, applyRevisions, restoreMarks,
         dropRevision, serialiseMarks, revisionCounts,
         revertRevision, applyRevision, rangesOf, keepMarks } from './revisions.js';

const api = window.api;
const $ = (id) => document.getElementById(id);

const state = {
  path: null,
  dirty: false,
  savedText: '',
  title: 'Untitled',
  prefs: {},
  outline: [],
  outlineSig: '',
  words: 0,
  chars: 0,
  lastWords: null,
  baselineWords: 0,
  activeIndex: -1,
  previewOpen: false,
  navFilter: '',
  pages: [],
  pageCount: 0,
  lastPages: 0,
  scratch: '',
  revisions: [],
  activeRevision: null,
  goal: null,
  goalHistory: [],
  outline_text: null,
  dockMode: null
};

let editor = null;
let view = null;
let outlineEditor = null;

const debounce = (fn, ms) => {
  let t;
  const wrapped = (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  wrapped.flush = (...args) => { clearTimeout(t); fn(...args); };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
};

/* Set when the music pane exists, so a theme change can repaint the guest.
   Declared up here because applyPrefs reads it on the very first paint. */
let repaintMusic = null;

/* Built once and kept: closing the music pane should not stop the sound. */
const ambience = createAmbiencePlayer();

/* ------------------------------------------------------------------ boot */

(async function boot() {
  document.body.classList.add(
    api.platform === 'darwin' ? 'mac' : api.platform === 'win32' ? 'win' : 'linux');

  state.prefs = await api.prefs.get();
  state.goal = state.prefs.goal || null;
  // Older versions kept the ones that were given up too; drop them on sight.
  state.goalHistory = (state.prefs.goalHistory || []).filter((e) => e && e.met);
  state.dropbox = (await api.app.dropbox()).root || null;
  state.spelling = await api.spell.languages();

  editor = createEditor({
    parent: $('editor-host'),
    doc: '',
    prefs: state.prefs,
    onChange: onDocChange,
    onCursor: onCursorMove,
    onSave: () => save(false)
  });
  view = editor.view;

  applyPrefs(state.prefs, null);
  setSidebarTab(state.prefs.sidebarTab === 'stats' ? 'stats' : 'navigator');
  if (state.prefs.dockWidth) {
    document.documentElement.style.setProperty('--dock-w', `${state.prefs.dockWidth}px`);
  }
  wireChrome();
  wireMenu();
  recompute.flush();
  setDirty(false);
  view.focus();

  // Automation surface. The main process reads the live buffer through
  // __lowTideContent when confirming an unsaved close; the rest exists so
  // scripts/selftest.js can drive the app the way a person would.
  window.__lowTideContent = () => view.state.doc.toString();
  window.__lowTideView = view;
  window.__setLeading = (v) => setPrefs({ printLeading: v });
  window.__setSmart = (v) => setPrefs({ smartTypography: v });
  window.__applyTheme = (id) => setPrefs({ theme: id });
  window.__themeIds = () => THEMES.map((t) => t.id);
  window.__plainText = plainText;
  window.__sprint = () => sprint;
  window.__pages = () => state.pages;
  window.__parseYouTube = parseYouTube;
  window.__setPref = (k, v) => setPrefs({ [k]: v });
  window.__checkUpdate = checkForUpdate;
  window.__moveSection = (i, slot) => moveSection(i, slot);
  window.__sectionRange = (i) => sectionRange(i);
  window.__musicThemeCss = musicThemeCss;
  window.__ambience = ambience;
  window.__measureAmbience = measureAmbience;
  window.__ambienceIds = () => AMBIENCES.map((a) => a.id);

  // after the editor is up, never before
  setTimeout(() => checkForUpdate(), 3000);
  window.__forcePaginate = () => repaginate.flush();
})();

/* ---------------------------------------------------------------- prefs */

function docFont(family) {
  return family === 'mono' ? 'var(--font-mono)'
       : family === 'sans' ? 'var(--font-sans)'
       : 'var(--font-serif)';
}

function applyPrefs(p, prev) {
  const css = document.documentElement.style;
  const changed = (k) => !prev || prev[k] !== p[k];

  if (changed('theme') || changed('youtubeMinimal')) {
    if (changed('theme')) applyTheme(p.theme || 'material');
    if (repaintMusic) repaintMusic();     // the music pane follows both
  }
  if (changed('fontFamily')) css.setProperty('--doc-font', docFont(p.fontFamily));
  if (changed('fontSize')) css.setProperty('--doc-size', `${p.fontSize}px`);
  if (changed('lineHeight')) css.setProperty('--doc-lh', String(p.lineHeight));
  if (changed('pageWidth')) css.setProperty('--doc-width', `${p.pageWidth}px`);

  document.body.classList.toggle('nav-open', p.navigatorOpen !== false);
  document.body.classList.toggle('status-on', p.statusBar !== false);
  document.body.classList.toggle('focus-mode', !!p.focusMode);
  document.body.classList.toggle('typewriter', !!p.typewriter);

  $('btn-navigator').classList.toggle('on', p.navigatorOpen !== false);
  if (changed('toolbarOrder') || changed('toolbarHidden') || !prev) renderToolbar();
  else syncToolbarState();

  if (editor) {
    if (changed('focusMode') || changed('focusScope') || changed('paragraphStyle')) {
      editor.setStyle({
        focusMode: !!p.focusMode,
        focusScope: p.focusScope || 'paragraph',
        paragraphStyle: p.paragraphStyle || 'indent'
      });
    }
    if (changed('typewriter')) editor.setTypewriter(!!p.typewriter);
    if (changed('smartTypography')) editor.setSmartTypography(p.smartTypography !== false);
    if (changed('spellcheck')) editor.setSpellcheck(p.spellcheck !== false);
  }
  if (changed('pageSize') || changed('printMargin') || changed('printFontSize') ||
      changed('printLeading') || changed('printJustify') || !prev) {
    applyPageTemplate(p);
  }
  if (changed('youtubeEnabled')) {
    const music = $('dock-body') && $('dock-body').querySelector('.dock-view[data-mode="music"]');
    if (music) renderMusicDock({ rebuild: true });
  }
  if (changed('previewNotes') || changed('previewTitlePage') ||
      changed('pageSize') || changed('printMargin') ||
      changed('printFontSize') || changed('printLeading')) {
    repaginate();
  }
}

/** Push the print template into CSS so the preview, the measurer and the
 *  exported PDF all describe the same page. */
function applyPageTemplate(p) {
  const geo = geometryFor(p);
  const css = document.documentElement.style;
  css.setProperty('--page-w', `${geo.sheet.w}in`);
  css.setProperty('--page-h', `${geo.sheet.h}in`);
  css.setProperty('--page-margin', `${geo.margin}in`);
  css.setProperty('--print-size', `${p.printFontSize || 12}pt`);
  css.setProperty('--print-leading', String(p.printLeading || 1.6));
  css.setProperty('--page-text-w', `${geo.width}px`);

  const ragged = p.printJustify === false;
  document.querySelectorAll('.page, .page-measure').forEach((el) =>
    el.classList.toggle('ragged', ragged));
  document.body.classList.toggle('print-ragged', ragged);
}

function setPrefs(patch) {
  const prev = state.prefs;
  state.prefs = Object.assign({}, prev, patch);
  applyPrefs(state.prefs, prev);
  api.prefs.set(patch);
}

api.prefs.onChange((p) => {
  const prev = state.prefs;
  state.prefs = p;
  applyPrefs(p, prev);
  renderGoal();
});

/* ------------------------------------------------------------- document */

const pushState = debounce(() => {
  api.doc.state({
    path: state.path,
    dirty: state.dirty,
    content: view.state.doc.toString(),
    cursor: view.state.selection.main.head,
    title: state.title
  });
}, 220);

const recompute = debounce(() => {
  repaginate();
  const text = view.state.doc.toString();
  // Title-page metadata is not part of the manuscript, so it is not counted.
  const offset = frontMatter(text).bodyOffset;
  const body = offset ? text.slice(offset) : text;
  state.words = countWords(body);
  state.chars = body.length;

  const items = buildOutline(text);
  const sig = items.map((i) => `${i.level}${i.title}${i.words}`).join('');
  state.outline = items;
  if (sig !== state.outlineSig) {
    state.outlineSig = sig;
    renderNavigator();
  }
  updateTitleFromDoc();
  trackGoal();
  renderStats();
  highlightActive(true);
}, 180);

function onDocChange() {
  if (!state.dirty) { setDirty(true); dirtySince = Date.now(); }
  recompute();
  pushState();
  autosave();
  if (state.activeRevision) { renderRevisions(); saveExtras(); }
}

function onCursorMove() {
  highlightActive(false);
  if (state.prefs.sidebarTab === 'stats') renderSelection();
}

function inDropbox(path) {
  return !!(state.dropbox && path && path.startsWith(state.dropbox));
}

function setDirty(dirty) {
  state.dirty = dirty;
  document.body.classList.toggle('dirty', dirty);
  const label = $('save-state');
  const where = inDropbox(state.path) ? ' · Dropbox' : '';
  if (dirty) label.textContent = (state.path ? 'Unsaved changes' : 'Draft, not yet saved') + where;
  else label.textContent = (state.path ? 'Saved' : 'New document') + where;
}

function updateTitleFromDoc() {
  if (state.path) return;
  const first = state.outline.find((i) => i.level === 1);
  const derived = first ? first.title : 'Untitled';
  if (derived !== state.title) {
    state.title = derived;
    $('doc-title').textContent = derived;
  }
}

function setPath(path) {
  state.path = path;
  state.title = path ? path.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '') : 'Untitled';
  $('doc-title').textContent = state.title;
}

/* ------------------------------------------------------------------ save */

const AUTOSAVE_IDLE = 1400;      // save this long after you stop typing
const AUTOSAVE_MAX_WAIT = 15000; // ...and at least this often while you don't

const autosave = debounce(() => {
  if (state.path && state.dirty) save(false, true);
}, AUTOSAVE_IDLE);

let dirtySince = 0;

// Typing without pausing would otherwise defer the debounce indefinitely.
setInterval(() => {
  if (!state.dirty || !state.path) return;
  if (dirtySince && Date.now() - dirtySince >= AUTOSAVE_MAX_WAIT) save(false, true);
}, 5000);

// A periodic snapshot protects unsaved drafts too: the session store holds the
// buffer, and named documents get a version in the backup store.
setInterval(() => {
  if (state.path && state.savedText) api.backup.snapshot(state.path, state.savedText);
}, 5 * 60 * 1000);

async function save(saveAs = false, silent = false) {
  const text = view.state.doc.toString();
  if (!saveAs && state.path && text === state.savedText) { setDirty(false); return state.path; }

  const label = $('save-state');
  if (!silent) { label.textContent = 'Saving'; label.classList.add('saving'); }

  const path = await api.file.save(text, saveAs);
  label.classList.remove('saving');

  if (!path) { setDirty(state.dirty); return null; }
  state.savedText = text;
  setPath(path);
  setDirty(false);
  dirtySince = 0;
  saveExtras.flush();
  pushState.flush();
  if (!silent) ui.toast(`Saved to ${path.replace(/^.*[\\/]/, '')}`);
  return path;
}

api.doc.onMoved(({ path }) => {
  setPath(path);
  setDirty(false);
  loadExtras(path);
});

api.doc.onLoad(({ path, content, cursor, dirty }) => {
  autosave.cancel();
  saveExtras.cancel();
  replaceAll(view, content || '', cursor || 0);
  setPath(path || null);
  state.savedText = dirty ? '' : (content || '');
  setDirty(!!dirty);
  state.baselineWords = countWords(content || '');
  // Opening a document is not "words written", so re-baseline the counters.
  state.lastWords = null;
  state.lastPages = state.pageCount;
  recompute.flush();
  pushState.flush();
  view.focus();
  loadExtras(path || null);
  if (state.prefs.typewriter) centerCursor(view);
});

/* ------------------------------------------------------- document extras */

const saveExtras = debounce(() => {
  if (!state.path) return;
  api.doc.setExtras(state.path, {
    scratch: state.scratch,
    outline: state.outline_text,
    revisions: state.revisions,
    activeRevision: state.activeRevision,
    marks: serialiseMarks(view.state)
  });
}, 700);

async function loadExtras(path) {
  const extras = path ? await api.doc.extras(path) : {};
  state.scratch = extras.scratch || '';
  state.outline_text = typeof extras.outline === 'string' ? extras.outline : null;
  if (state.dockMode === 'outline') renderOutlineDock();
  state.revisions = Array.isArray(extras.revisions) ? extras.revisions : [];
  state.activeRevision = extras.activeRevision || null;

  $('scratchpad').value = state.scratch;
  applyRevisions(view, { list: state.revisions, active: state.activeRevision });
  restoreMarks(view, extras.marks || []);
  renderRevisions();
}

/* ---------------------------------------------------------------- scratch */

function wireScratchpad() {
  const pad = $('scratchpad');
  const state$ = $('scratch-state');
  pad.addEventListener('input', () => {
    state.scratch = pad.value;
    state$.textContent = state.path ? 'saving' : 'unsaved doc';
    saveExtras();
    clearTimeout(wireScratchpad.t);
    wireScratchpad.t = setTimeout(() => { state$.textContent = ''; }, 1200);
  });
}

/* -------------------------------------------------------------- revisions */

function syncRevisionVisibility() {
  let style = document.getElementById('rev-hidden-style');
  if (!style) {
    style = document.createElement('style');
    style.id = 'rev-hidden-style';
    document.head.append(style);
  }
  const hidden = state.revisions.filter((r) => r.hidden).map((r) => `.cm-editor [data-rev="${r.id}"]`);
  style.textContent = hidden.length
    ? `${hidden.join(', ')} { border-bottom-color: transparent !important; background: none !important; }`
    : '';
}

function renderRevisions() {
  const list = $('rev-list');
  list.textContent = '';
  const counts = revisionCounts(view.state);

  if (!state.revisions.length) {
    list.append(ui.h('div', { class: 'rev-empty', html:
      'No revisions yet.<br>Add one, select it, and everything you type from then on is marked in its colour.' }));
  }

  for (const rev of state.revisions) {
    const colour = colourById(rev.colour);
    const active = rev.id === state.activeRevision;
    list.append(ui.h('button', {
      class: `rev-item ${active ? 'on' : ''} ${rev.hidden ? 'off' : ''}`,
      title: active ? 'Selected — new text is marked in this colour' : 'Select to mark new text',
      onclick: (e) => {
        if (e.target.closest('.more')) return;
        setActiveRevision(active ? null : rev.id);
      }
    },
      ui.h('span', { class: 'rev-dot', style: `background:${colour.hex}` }),
      ui.h('span', { class: 'name' }, rev.name),
      ui.h('span', { class: 'n' }, counts[rev.id] ? `${counts[rev.id].toLocaleString()}` : ''),
      ui.h('span', {
        class: 'more', title: 'Revision actions',
        onclick: (e) => { e.stopPropagation(); openRevisionMenu(rev); }
      }, ui.h('span', { html: '<svg class="mini"><use href="#i-more"/></svg>' }))));
  }

  syncRevisionVisibility();

  const badge = $('rev-active');
  const current = state.revisions.find((r) => r.id === state.activeRevision);
  badge.hidden = !current;
  if (current) {
    badge.textContent = '';
    badge.append(
      ui.h('span', { class: 'rev-dot', style: `background:${colourById(current.colour).hex}` }),
      document.createTextNode(`${current.name} revision`));
  }
}

function openRevisionMenu(rev) {
  ui.showRevisionMenu({
    revision: rev,
    marked: revisionCounts(view.state)[rev.id] || 0,
    toggleVisible: () => {
      rev.hidden = !rev.hidden;
      state.revisions = state.revisions.slice();
      renderRevisions();
      saveExtras();
    },
    apply: () => {
      applyRevision(view, rev.id);
      renderRevisions();
      saveExtras();
      ui.toast(`Applied ${rev.name} — text kept, marks cleared`);
    },
    revert: () => {
      const n = revertRevision(view, rev.id);
      renderRevisions();
      saveExtras();
      ui.toast(n ? `Reverted ${n} change${n === 1 ? '' : 's'} from ${rev.name}` : 'Nothing to revert');
    },
    remove: () => removeRevision(rev)
  });
}

function setActiveRevision(id) {
  state.activeRevision = id;
  applyRevisions(view, { list: state.revisions, active: id });
  renderRevisions();
  saveExtras();
  view.focus();
}

function addRevision(name, colour) {
  const rev = { id: `r${Date.now().toString(36)}`, name: name || 'Revision', colour };
  state.revisions = state.revisions.concat([rev]);
  setActiveRevision(rev.id);
}

function removeRevision(rev) {
  state.revisions = state.revisions.filter((r) => r.id !== rev.id);
  dropRevision(view, rev.id);
  syncRevisionVisibility();
  if (state.activeRevision === rev.id) state.activeRevision = null;
  applyRevisions(view, { list: state.revisions, active: state.activeRevision });
  renderRevisions();
  saveExtras();
}

/* ------------------------------------------------------------- navigator */

/** The text a heading owns: the heading line plus everything under it, up to
    the next heading at the same level or shallower. */
function sectionRange(index) {
  const items = state.outline;
  const item = items[index];
  if (!item) return null;
  let to = view.state.doc.length;
  for (let j = index + 1; j < items.length; j++) {
    if (items[j].level <= item.level) { to = items[j].from; break; }
  }
  return { from: item.from, to };
}

/* Reordering moves the heading with everything beneath it, so dragging a
   chapter carries its scenes along. `slot` is the outline index the block
   should come to sit in front of; outline.length means the end. */
function moveSection(index, slot) {
  const items = state.outline;
  const src = sectionRange(index);
  if (!src) return false;
  const doc = view.state.doc;
  const at = slot >= items.length ? doc.length : items[slot].from;
  if (at >= src.from && at <= src.to) return false;   // dropped into itself

  const isNl = (i) => i >= 0 && i < doc.length && doc.sliceString(i, i + 1) === '\n';

  // The block itself, without whatever blank line happens to trail it.
  let end = src.to;
  while (end > src.from && isNl(end - 1)) end--;
  const block = doc.sliceString(src.from, end);

  /* Cut the block along with the blank line that separated it from what came
     after. The last section in a document has nothing after it, so it takes
     the blank line in front of it instead — otherwise the move leaves a gap
     where the block used to be. */
  let cutFrom = src.from;
  let cutTo = src.to;
  if (cutTo >= doc.length) {
    while (cutFrom > 0 && isNl(cutFrom - 1)) cutFrom--;
  }
  if (at > cutFrom && at < cutTo) return false;

  /* Put it back with exactly one blank line of separation at either end of the
     document, so a moved chapter is spaced like every other one. */
  let insert, lead;
  if (at >= doc.length) {
    let have = 0;
    while (have < 2 && isNl(at - 1 - have)) have++;
    lead = 2 - have;
    insert = '\n'.repeat(lead) + block;
  } else {
    lead = 0;
    insert = block + '\n\n';
  }

  const cut = { from: cutFrom, to: cutTo };
  const paste = { from: at, to: at, insert };
  const landing = (at < cutFrom ? at : at - (cutTo - cutFrom)) + lead;

  /* Cutting the text throws away the revision marks inside it, so note where
     they sat relative to the block and put them back at the new address. */
  const carried = [];
  for (const m of serialiseMarks(view.state)) {
    if (m.from >= src.from && m.to <= end) {
      carried.push({ id: m.id, from: m.from - src.from, to: m.to - src.from });
    }
  }

  view.dispatch({
    changes: at < cutFrom ? [paste, cut] : [cut, paste],
    selection: { anchor: landing },
    scrollIntoView: true,
    userEvent: 'move.section'          // not "input": this must not mark a revision
  });
  keepMarks(view, carried.map((m) => ({ id: m.id, from: landing + m.from, to: landing + m.to })));
  view.focus();
  return true;
}

/* ------------------------------------------------------------ nav dragging */

let dragFrom = null;     // outline index being dragged
let dropSlot = null;     // outline index it would land in front of

function showDrop(slot) {
  const list = $('nav-list');
  let el = list.querySelector('.nav-drop');
  if (!el) { el = ui.h('div', { class: 'nav-drop' }); list.append(el); }
  const rows = [...list.querySelectorAll('.nav-item')];
  if (!rows.length) { el.hidden = true; return; }
  dropSlot = slot;
  const last = slot >= rows.length;
  const ref = last ? rows[rows.length - 1] : rows[slot];
  el.style.top = `${(last ? ref.offsetTop + ref.offsetHeight : ref.offsetTop) - 1}px`;
  el.hidden = false;
}

function hideDrop() {
  const el = $('nav-list').querySelector('.nav-drop');
  if (el) el.hidden = true;
  dropSlot = null;
}

function finishDrag() {
  const from = dragFrom;
  const slot = dropSlot;
  hideDrop();
  dragFrom = null;
  $('nav-list').classList.remove('dragging');
  if (from != null && slot != null) moveSection(from, slot);
}

function attachDrag(btn, i) {
  btn.addEventListener('dragstart', (e) => {
    dragFrom = i;
    btn.classList.add('dragging');
    $('nav-list').classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(i));   // a drag needs some payload
  });
  btn.addEventListener('dragend', () => {
    btn.classList.remove('dragging');
    $('nav-list').classList.remove('dragging');
    dragFrom = null;
    hideDrop();
  });
  btn.addEventListener('dragover', (e) => {
    if (dragFrom == null) return;
    e.preventDefault();
    e.stopPropagation();               // the list below would claim the end slot
    e.dataTransfer.dropEffect = 'move';
    const r = btn.getBoundingClientRect();
    showDrop(i + (e.clientY > r.top + r.height / 2 ? 1 : 0));
  });
  btn.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    finishDrag();
  });
}

function renderNavigator() {
  const list = $('nav-list');
  list.textContent = '';

  if (!state.outline.length) {
    list.append(ui.h('div', { class: 'nav-empty', html:
      'Start a line with <code>#</code> to make a chapter.<br>Chapters and sections appear here.' }));
    $('nav-total').textContent = '';
    state.activeIndex = -1;
    return;
  }

  const q = state.navFilter.trim().toLowerCase();
  const shown = state.outline
    .map((item, i) => ({ item, i }))
    .filter(({ item }) => !q || item.title.toLowerCase().includes(q));

  if (!shown.length) {
    list.append(ui.h('div', { class: 'nav-empty' }, `Nothing matches “${state.navFilter.trim()}”.`));
    $('nav-total').textContent = '';
    return;
  }

  // Reordering a filtered list would be guesswork, so it waits for a clear filter.
  const canDrag = !q;

  shown.forEach(({ item, i }) => {
    // One rule per level above this one, so the nesting is visible at a glance.
    const guides = [];
    for (let g = 1; g < item.level; g++) {
      guides.push(ui.h('span', { class: 'guide', style: `left:${g * 14 + 1}px` }));
    }

    const btn = ui.h('button', {
      class: `nav-item lvl-${item.level}`,
      'data-i': i,
      draggable: canDrag ? 'true' : 'false',
      onclick: () => { gotoPosition(view, item.from); highlightActive(true); }
    },
      ...guides,
      ui.h('span', { class: 'label' }, item.title),
      ui.h('span', { class: 'count' }, item.words ? item.words.toLocaleString() : ''));

    if (canDrag) attachDrag(btn, i);
    list.append(btn);
  });

  const chapters = state.outline.filter((i) => i.level === 1).length;
  $('nav-total').textContent = chapters ? `${chapters} ch` : `${state.outline.length}`;
  state.activeIndex = -1;
  highlightActive(true);
}

function highlightActive(force) {
  if (!state.outline.length) return;
  const pos = view.state.selection.main.head;
  let index = -1;
  for (let i = 0; i < state.outline.length; i++) {
    if (state.outline[i].from <= pos) index = i; else break;
  }
  if (index === state.activeIndex && !force) return;
  state.activeIndex = index;

  const list = $('nav-list');
  list.querySelectorAll('.nav-item.active').forEach((el) => el.classList.remove('active'));
  const el = list.querySelector(`.nav-item[data-i="${index}"]`);
  if (el) {
    el.classList.add('active');
    const box = list.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.top < box.top || r.bottom > box.bottom) el.scrollIntoView({ block: 'nearest' });
  }
}

/* ----------------------------------------------------------------- stats */

const RING_C = 2 * Math.PI * 52;

/* A goal is one target at a time: set it, work towards it, mark it done, and
   it drops into the history below. */
export const GOAL_TYPES = [
  { id: 'new-words', label: 'new words', unit: 'words', kind: 'new', of: 'words' },
  { id: 'new-pages', label: 'new pages', unit: 'pages', kind: 'new', of: 'pages' },
  { id: 'total-words', label: 'total words', unit: 'words', kind: 'total', of: 'words' },
  { id: 'total-pages', label: 'total pages', unit: 'pages', kind: 'total', of: 'pages' }
];

const goalType = (id) => GOAL_TYPES.find((t) => t.id === id) || GOAL_TYPES[0];

const persistGoal = debounce(() => {
  api.prefs.set({ goal: state.goal, goalHistory: state.goalHistory });
}, 700);

function goalValue() {
  const goal = state.goal;
  if (!goal) return 0;
  const type = goalType(goal.type);
  if (type.kind === 'total') return type.of === 'pages' ? state.pageCount : state.words;
  return Math.max(0, Math.round(goal.progress || 0));
}

/** Accumulate what has been written since the goal started. */
function trackGoal() {
  const words = state.words;
  const pages = state.pageCount;
  if (state.lastWords === null) { state.lastWords = words; state.lastPages = pages; return; }

  const dWords = words - state.lastWords;
  const dPages = pages - state.lastPages;
  state.lastWords = words;
  state.lastPages = pages;

  const goal = state.goal;
  if (!goal) return;
  const type = goalType(goal.type);
  if (type.kind !== 'new') return;

  const delta = type.of === 'pages' ? dPages : dWords;
  if (!delta) return;
  goal.progress = Math.max(0, (goal.progress || 0) + delta);
  persistGoal();
}

function startGoal(typeId, target) {
  state.goal = {
    id: `g${Date.now().toString(36)}`,
    type: typeId,
    target: Math.max(1, Math.round(target) || 1),
    startedAt: Date.now(),
    progress: 0
  };
  persistGoal.flush();
  renderGoal();
  ui.toast(`Goal set: ${state.goal.target.toLocaleString()} ${goalType(typeId).label}`);
}

function finishGoal() {
  const goal = state.goal;
  if (!goal) return;
  const achieved = goalValue();

  /* Only goals that were actually met are kept. Giving one up is a decision,
     not a failure worth a permanent record you are shown every time. */
  if (achieved >= goal.target) {
    state.goalHistory = [{
      finishedAt: Date.now(),
      type: goal.type,
      target: goal.target,
      achieved,
      met: true
    }].concat(state.goalHistory || []).slice(0, 40);
  }

  state.goal = null;
  persistGoal.flush();
  renderGoal();
}

function renderGoal() {
  const host = $('goal');
  const goal = state.goal;
  const ring = $('ring-fill');

  if (!goal) {
    host.classList.add('empty');
    host.classList.remove('met');
    $('goal-count').textContent = 'Set Goal';
    $('goal-target').textContent = '';
    $('goal-label').textContent = '';
    $('goal-action').hidden = true;
    ring.style.strokeDasharray = `${RING_C}`;
    ring.style.strokeDashoffset = `${RING_C}`;
    renderGoalHistory();
    return;
  }

  const type = goalType(goal.type);
  const value = goalValue();
  const met = value >= goal.target;

  host.classList.remove('empty');
  host.classList.toggle('met', met);
  $('goal-count').textContent = value.toLocaleString();
  $('goal-target').textContent = goal.target.toLocaleString();
  $('goal-label').textContent = type.label;

  const action = $('goal-action');
  action.hidden = false;
  action.textContent = met ? 'Done' : 'Cancel';
  action.title = met ? 'Log this goal and start another' : 'Give up on this goal';

  ring.style.strokeDasharray = `${RING_C}`;
  ring.style.strokeDashoffset = `${RING_C * (1 - Math.min(1, value / goal.target))}`;
  renderGoalHistory();
}

function renderGoalHistory() {
  const list = $('goal-history');
  list.textContent = '';
  const history = state.goalHistory || [];
  if (!history.length) {
    list.append(ui.h('div', { class: 'goal-empty' }, 'Goals you meet are listed here.'));
    return;
  }
  for (const entry of history.slice(0, 6)) {
    const type = goalType(entry.type);
    const when = new Date(entry.finishedAt)
      .toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
    list.append(ui.h('div', { class: `goal-row ${entry.met ? 'met' : ''}` },
      ui.h('span', {}, when),
      ui.h('span', { class: 'n' },
        `${entry.achieved.toLocaleString()} / ${entry.target.toLocaleString()} ${type.unit}`)));
  }
}

function readingTime(words) {
  const speed = state.prefs.readingSpeed || 275;
  const mins = Math.round(words / speed);
  if (words === 0) return '0 min';
  if (mins < 1) return '< 1 min';
  if (mins < 90) return `${mins} min`;
  return `${Math.floor(mins / 60)} h ${mins % 60} min`;
}

const repaginate = debounce(() => {
  const text = view.state.doc.toString();
  const sections = pagesHtml(text, previewOptions());
  const t0 = performance.now();
  state.pages = paginate(sections, geometryFor(state.prefs));
  // An empty document has no pages, not one blank one.
  state.pageCount = text.trim() ? state.pages.length : 0;
  state.pageMs = Math.round(performance.now() - t0);
  window.__pageMs = state.pageMs;
  renderStats();
  if (state.previewOpen) paintPreview(true);
}, 500);

function renderStats() {
  const words = state.words;
  const pages = state.pageCount;

  $('stat-chars').textContent = `${state.chars.toLocaleString()} characters`;
  $('stat-words').textContent = `${words.toLocaleString()} word${words === 1 ? '' : 's'}`;
  $('stat-pages').textContent = `${pages.toLocaleString()} page${pages === 1 ? '' : 's'}`;

  $('ds-pages').textContent = pages.toLocaleString();
  $('ds-time').textContent = readingTime(words);
  $('ds-words').textContent = words.toLocaleString();
  $('ds-chars').textContent = state.chars.toLocaleString();

  renderGoal();
  if (sprint.state().running) sprint.render();
}

const renderSelection = debounce(() => {
  const sel = view.state.selection.main;
  const w = $('ds-selwords');
  const c = $('ds-selchars');
  if (sel.empty) { w.textContent = '\u2014'; c.textContent = '\u2014'; return; }
  const text = view.state.sliceDoc(sel.from, sel.to);
  w.textContent = countWords(text).toLocaleString();
  c.textContent = text.length.toLocaleString();
}, 90);

/* --------------------------------------------------------------- sidebar */

function setSidebarTab(tab) {
  document.querySelectorAll('.side-tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
  document.querySelectorAll('.side-panel').forEach((p) => { p.hidden = p.dataset.panel !== tab; });
  if (tab !== state.prefs.sidebarTab) setPrefs({ sidebarTab: tab });
  else state.prefs.sidebarTab = tab;
  if (tab === 'stats') { renderStats(); renderSelection.flush(); }
  if (tab === 'scratch') $('scratchpad').focus();
  if (tab === 'revisions') renderRevisions();
  if (tab === 'reference') focusReferencePanel();
}

/* ---------------------------------------------------------------- sprint */

const sprint = (() => {
  let endsAt = 0, startWords = 0, goal = 0, timer = null, tick = null, running = false, finished = false;

  function written() { return Math.max(0, state.words - startWords); }

  function clock() {
    const left = Math.max(0, endsAt - Date.now());
    const m = Math.floor(left / 60000);
    const s = Math.floor((left % 60000) / 1000);
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function subtitle() {
    const w = written();
    if (goal) return `${w.toLocaleString()} of ${goal.toLocaleString()} words`;
    return `${w.toLocaleString()} word${w === 1 ? '' : 's'} so far`;
  }

  function render() {
    const el = $('sprint-status');
    if (!running) { el.hidden = true; return; }
    el.hidden = false;
    el.classList.toggle('done', finished);
    el.textContent = finished
      ? `Sprint done, ${written().toLocaleString()} words`
      : `${clock()} · ${written().toLocaleString()}${goal ? ` / ${goal}` : ''} words`;
    if (tick) tick();
  }

  function start(minutes, wordGoal) {
    stop(true);
    running = true; finished = false;
    goal = wordGoal || 0;
    startWords = state.words;
    endsAt = Date.now() + minutes * 60000;
    timer = setInterval(() => {
      if (Date.now() >= endsAt) finish();
      render();
    }, 500);
    render();
    ui.toast(`Sprint started, ${minutes} minutes`);
    view.focus();
  }

  function finish() {
    finished = true;
    clearInterval(timer); timer = null;
    render();
    ui.toast(`Sprint complete: ${written().toLocaleString()} words written`, 5000);
    setTimeout(() => { if (finished) stop(); }, 9000);
  }

  function stop(quiet) {
    clearInterval(timer); timer = null;
    running = false; finished = false;
    render();
    if (!quiet) $('sprint-status').hidden = true;
  }

  return {
    start, stop, render, clock, subtitle,
    setTick: (fn) => { tick = fn; },
    state: () => ({ running, finished, goal })
  };
})();

/* --------------------------------------------------------------- preview */

function printTemplate() {
  const p = state.prefs;
  return {
    pageSize: p.pageSize || 'letter',
    margin: Number(p.printMargin) || 1,
    fontSize: Number(p.printFontSize) || 12,
    leading: Number(p.printLeading) || 1.6,
    justify: p.printJustify !== false
  };
}

function previewOptions() {
  return {
    titlePage: !!state.prefs.previewTitlePage,
    notes: !!state.prefs.previewNotes,
    title: state.title
  };
}

/** Shrink the sheet so a whole page is visible however wide the pane is. */
function fitPreviewZoom() {
  const scroller = $('preview-scroll');
  if (!scroller || $('preview-host').hidden) return;
  const geo = geometryFor(state.prefs);
  const pageWidth = geo.sheet.w * 96;
  const available = scroller.clientWidth - 40;
  if (available <= 0) return;
  const zoom = Math.min(1, Math.max(0.25, available / pageWidth));
  scroller.style.setProperty('--page-zoom', zoom.toFixed(4));
}

function paintPreview(keepScroll) {
  const scroller = $('preview-scroll');
  const top = keepScroll ? scroller.scrollTop : 0;
  const opts = previewOptions();
  const meta = frontMatter(view.state.doc.toString()).meta;
  const out = [];

  if (opts.titlePage) {
    out.push(`<article class="page title-page">${titlePageHtml(meta, state.title)}</article>`);
  }
  state.pages.forEach((page, i) => {
    const n = i + 1;
    const head = n > 1
      ? `<header class="page-head"><span>${esc(page.chapter || '')}</span><span>${n}</span></header>`
      : '<header class="page-head"></header>';
    out.push(`<article class="page">${head}${page.html}</article>`);
  });

  scroller.innerHTML = out.join('\n');
  if (state.prefs.printJustify === false) {
    scroller.querySelectorAll('.page').forEach((el) => el.classList.add('ragged'));
  }
  const p = state.pageCount;
  $('preview-title').textContent =
    `${state.title} · ${state.words.toLocaleString()} words · ${p} page${p === 1 ? '' : 's'}`;
  scroller.scrollTop = top;
  fitPreviewZoom();
}

function renderPreview(keepScroll) {
  repaginate.flush();
  paintPreview(keepScroll);
}

function togglePreview(force) {
  const open = force != null ? force : !state.previewOpen;
  state.previewOpen = open;
  $('preview-host').hidden = !open;
  paintViewSwitch();
  if (open) {
    $('pv-title').checked = !!state.prefs.previewTitlePage;
    $('pv-notes').checked = !!state.prefs.previewNotes;
    renderPreview(false);
  } else {
    view.focus();
  }
}

function plainText(text) {
  return text
    .replace(/\/\*[\s\S]*?(?:\*\/|$)/g, '')
    .split('\n')
    .map((l) => (/^={3,}\s*$/.test(l) ? '' : stripMarkup(l)))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');
}

async function exportAs(format) {
  const text = view.state.doc.toString();
  const meta = frontMatter(text).meta;
  const payload = {
    format,
    suggested: state.title,
    runningHead: state.title,
    content: format === 'txt' ? plainText(text) : text,
    html: format === 'pdf' || format === 'html'
      ? printHtml(text, { title: state.title },
                  Object.assign(previewOptions(), { template: printTemplate() }))
      : '',
    blocks: format === 'docx' ? documentBlocks(text, previewOptions()) : null,
    meta: { title: meta.title || state.title, author: meta.author || meta.authors || '' },
    pageSetup: Object.assign(printTemplate(), { titlePage: !!state.prefs.previewTitlePage })
  };
  const path = await api.file.export(payload);
  if (path) ui.toast(`Exported ${path.replace(/^.*[\\/]/, '')}`);
}

/* --------------------------------------------------------------- backups */

async function showBackups() {
  if (!state.path) {
    ui.toast('Save the document once and versions start being kept.');
    return;
  }
  const list = await api.backup.list(state.path);
  ui.showBackups({
    list,
    sourcePath: state.path,
    open: (entry) => api.backup.open(entry.file, state.path)
  });
}

/* ------------------------------------------------------------- side dock */

/* One pane on the right, three things it can hold. The outline is a second
   editor so it behaves exactly like the manuscript beside it. */

const DOCK_TITLES = { outline: 'Outline', music: 'Music' };

/**
 * Each mode keeps its own container, built once and then only shown or hidden.
 * Tearing them down would take the media with them: a <webview> is destroyed
 * the moment it leaves the document, which restarted whatever was playing.
 */
function dockView(mode) {
  const body = $('dock-body');
  let view = body.querySelector(`.dock-view[data-mode="${mode}"]`);
  if (!view) {
    view = ui.h('div', { class: 'dock-view', 'data-mode': mode });
    body.append(view);
  }
  return view;
}

function showDockView(mode) {
  $('dock-body').querySelectorAll('.dock-view').forEach((v) => {
    v.hidden = v.dataset.mode !== mode;
  });
}

function dockOpen(mode) {
  const dock = $('side-dock');
  state.dockMode = mode;
  dock.hidden = false;
  $('dock-title').textContent = DOCK_TITLES[mode] || '';
  $('dock-tools').textContent = '';

  $('btn-outline').classList.toggle('on', mode === 'outline');
  syncToolbarState();

  if (mode === 'outline') renderOutlineDock();
  if (mode === 'music') renderMusicDock();
  showDockView(mode);

  setPrefs({ dockMode: mode, dockOpen: true });
}

function dockClose() {
  $('side-dock').hidden = true;
  state.dockMode = null;
  $('btn-outline').classList.remove('on');
  syncToolbarState();
  setPrefs({ dockOpen: false });
  view.focus();
}

function dockToggle(mode) {
  if (state.dockMode === mode && !$('side-dock').hidden) dockClose();
  else dockOpen(mode);
}

function wireDockResize() {
  const grip = $('dock-grip');
  const dock = $('side-dock');
  let startX = 0;
  let startW = 0;

  const move = (e) => {
    const width = Math.max(240, Math.min(window.innerWidth * 0.7, startW + (startX - e.clientX)));
    document.documentElement.style.setProperty('--dock-w', `${Math.round(width)}px`);
  };
  const stop = () => {
    grip.classList.remove('dragging');
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', stop);
    setPrefs({ dockWidth: parseInt(getComputedStyle(dock).width, 10) });
  };

  grip.addEventListener('mousedown', (e) => {
    startX = e.clientX;
    startW = parseInt(getComputedStyle(dock).width, 10);
    grip.classList.add('dragging');
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', stop);
    e.preventDefault();
  });
}

/* --------------------------------------------------------------- outline */

const saveOutline = debounce(() => {
  if (!state.path || state.outline_text === null) return;
  api.doc.setExtras(state.path, { outline: state.outline_text });
}, 600);

function renderOutlineDock() {
  const body = dockView('outline');

  if (state.outline_text === null || state.outline_text === undefined) {
    body.textContent = '';
    outlineEditor = null;
    body.append(ui.h('div', { class: 'dock-empty' },
      ui.h('div', {}, 'No outline for this document yet.'),
      ui.h('div', { style: 'margin-top:6px;font-size:11.5px' },
        'Pick a shape to start from, or begin blank.')));

    const list = ui.h('div', { class: 'tpl-list' });
    for (const tpl of OUTLINE_TEMPLATES) {
      list.append(ui.h('button', {
        class: 'tpl-item',
        onclick: () => {
          state.outline_text = templateById(tpl.id).body;
          saveOutline();
          renderOutlineDock();
        }
      },
        ui.h('div', { class: 't' }, tpl.name),
        ui.h('div', { class: 's' }, tpl.hint)));
    }
    body.append(list);
    return;
  }

  body.textContent = '';
  outlineEditor = createEditor({
    parent: body,
    doc: state.outline_text,
    prefs: state.prefs,
    onChange: () => {
      state.outline_text = outlineEditor.view.state.doc.toString();
      saveOutline();
    },
    onCursor: () => {},
    onSave: () => save(false)
  });
  outlineEditor.setStyle({
    focusMode: false,
    focusScope: 'paragraph',
    paragraphStyle: 'none'
  });

  $('dock-tools').textContent = '';
  $('dock-tools').append(ui.h('button', {
    class: 'text-btn', title: 'Replace with a template',
    onclick: () => {
      if (!confirmDiscardOutline()) return;
      state.outline_text = null;
      saveOutline.flush();
      renderOutlineDock();
    }
  }, 'Templates'));
}

function confirmDiscardOutline() {
  const text = (state.outline_text || '').trim();
  if (!text || text === templateById('blank').body.trim()) return true;
  return window.confirm('Replace this outline with a different template? The current outline is lost.');
}

/* -------------------------------------------------------------- reference */

function selectedWord() {
  const sel = view.state.selection.main;
  if (!sel.empty && sel.to - sel.from < 60) return view.state.sliceDoc(sel.from, sel.to).trim();
  const line = view.state.doc.lineAt(sel.head);
  const rel = sel.head - line.from;
  const isWord = (c) => c && /[\p{L}\p{N}'’-]/u.test(c);
  let a = rel;
  let b = rel;
  while (a > 0 && isWord(line.text[a - 1])) a--;
  while (b < line.text.length && isWord(line.text[b])) b++;
  return line.text.slice(a, b).trim();
}

async function runLookup() {
  const input = $('ref-input');
  const results = $('ref-results');
  const word = input.value.trim();
  if (!word) { results.textContent = ''; return; }
  results.textContent = '';
  results.append(ui.h('div', { class: 'dock-empty' }, 'Looking up…'));
  const data = await api.lookup.word(word);
  renderLookup(results, data, input, runLookup);
}

function wireReferencePanel() {
  $('ref-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') runLookup(); });
  $('ref-go').onclick = () => runLookup();
  if (api.platform === 'darwin') {
    $('ref-foot').append(ui.h('button', {
      class: 'text-btn', title: 'Use the macOS dictionary, which works offline',
      onclick: () => api.lookup.native()
    }, 'System dictionary'));
  }
}

/** Opening the panel picks up whatever word the caret is in. */
function focusReferencePanel() {
  const input = $('ref-input');
  const word = selectedWord();
  if (word && word !== input.value) { input.value = word; runLookup(); }
  else input.focus();
}

function renderLookup(host, data, input, run) {
  host.textContent = '';

  if (data.disabled) {
    host.append(ui.h('div', { class: 'dock-empty' },
      'Online lookup is switched off in Preferences.'));
    return;
  }
  if (!data.definitions.length && !data.synonyms.length) {
    host.append(ui.h('div', { class: 'dock-empty' },
      data.offline ? 'Could not reach the dictionary. Check your connection.'
                   : `Nothing found for “${data.word}”.`));
    return;
  }

  if (data.synonyms.length) {
    host.append(ui.h('div', { class: 'ref-section' }, 'Synonyms'));
    const chips = ui.h('div', { class: 'chips' });
    for (const word of data.synonyms) {
      chips.append(ui.h('button', {
        class: 'chip', title: 'Replace the selected word',
        onclick: () => replaceSelectionWith(word)
      }, word));
    }
    host.append(chips);
  }

  if (data.antonyms.length) {
    host.append(ui.h('div', { class: 'ref-section' }, 'Antonyms'));
    const chips = ui.h('div', { class: 'chips' });
    for (const word of data.antonyms) {
      chips.append(ui.h('button', {
        class: 'chip ghost', onclick: () => { input.value = word; run(); }
      }, word));
    }
    host.append(chips);
  }

  if (data.definitions.length) {
    host.append(ui.h('div', { class: 'ref-section' }, 'Definitions'));
    for (const def of data.definitions) {
      host.append(ui.h('div', { class: 'def' },
        def.part ? ui.h('span', { class: 'part' }, def.part) : null,
        ui.h('span', {}, def.text),
        def.example ? ui.h('div', { class: 'eg' }, `“${def.example}”`) : null));
    }
  }
}

function replaceSelectionWith(word) {
  const sel = view.state.selection.main;
  let { from, to } = sel;
  if (sel.empty) {
    const line = view.state.doc.lineAt(sel.head);
    const rel = sel.head - line.from;
    const isWord = (c) => c && /[\p{L}\p{N}'’-]/u.test(c);
    let a = rel;
    let b = rel;
    while (a > 0 && isWord(line.text[a - 1])) a--;
    while (b < line.text.length && isWord(line.text[b])) b++;
    from = line.from + a;
    to = line.from + b;
  }
  if (to <= from) return;
  view.dispatch({ changes: { from, to, insert: word },
                  selection: { anchor: from + word.length }, userEvent: 'input' });
  view.focus();
  ui.toast(`Replaced with “${word}”`);
}

/* ------------------------------------------------------------------ music */

/* ------------------------------------------------------------------ music */

// Without a mobile agent these sites hand back desktop layouts, which are
// unusable in a narrow pane.
const MOBILE_AGENT = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 '
  + '(KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';

const SERVICES = {
  youtube: {
    id: 'youtube',
    name: 'YouTube',
    home: 'https://m.youtube.com/',
    partition: 'persist:music-youtube',
    search: (q) => `https://m.youtube.com/results?search_query=${encodeURIComponent(q)}`,
    owns: (url) => /^https:\/\/([a-z0-9-]+\.)*(youtube\.com|youtu\.be|google\.com|googleusercontent\.com)\//i.test(url),
    link: (raw) => {
      const url = String(raw || '').trim();
      const list = url.match(/[?&]list=([A-Za-z0-9_-]+)/);
      if (list) return `https://m.youtube.com/playlist?list=${list[1]}`;
      const watch = url.match(/[?&]v=([A-Za-z0-9_-]{6,})/)
        || url.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/)
        || url.match(/\/embed\/([A-Za-z0-9_-]{6,})/);
      if (watch) return `https://m.youtube.com/watch?v=${watch[1]}`;
      if (/^https?:\/\/([a-z0-9-]+\.)*youtube\.com\//i.test(url)) return url;
      if (/^[A-Za-z0-9_-]{11}$/.test(url)) return `https://m.youtube.com/watch?v=${url}`;
      return null;
    }
  },
};

// Kept for the tests and for anything that still wants the plain parser.
const parseYouTube = SERVICES.youtube.link;

function serviceEnabled(id) {
  if (id === 'youtube') return state.prefs.youtubeEnabled !== false;
  return false;
}

/** Build the music pane once; afterwards only switch which sub-pane shows. */
function renderMusicDock({ rebuild = false } = {}) {
  const body = dockView('music');
  if (rebuild) body.textContent = '';

  const available = Object.keys(SERVICES).filter(serviceEnabled);
  const wanted = state.prefs.musicMode;
  const mode = available.includes(wanted) ? wanted : 'files';

  if (!body.childElementCount) {
    if (available.length) {
      const tabs = ui.h('div', { class: 'music-tabs' });
      for (const [id, label] of [['files', 'Your files'], ...available.map((x) => [x, SERVICES[x].name])]) {
        tabs.append(ui.h('button', {
          class: 'home-tab', 'data-pane': id,
          onclick: () => { setPrefs({ musicMode: id }); showMusicPane(id); }
        }, label));
      }
      body.append(tabs);
    }

    const files = ui.h('div', { class: 'music-pane', 'data-pane': 'files' });
    renderMusicFiles(files);
    body.append(files);

    for (const id of available) {
      const pane = ui.h('div', { class: 'music-pane', 'data-pane': id });
      renderMusicWeb(pane, SERVICES[id]);
      body.append(pane);
    }
  }

  showMusicPane(mode);
}

function showMusicPane(mode) {
  const body = dockView('music');
  body.querySelectorAll('.music-pane').forEach((p) => { p.hidden = p.dataset.pane !== mode; });
  body.querySelectorAll('.music-tabs .home-tab').forEach((t) => {
    t.classList.toggle('on', t.dataset.pane === mode);
  });
}

function renderMusicFiles(body) {
  const player = ui.h('audio', { controls: true, class: 'music-player' });
  const list = ui.h('div', { class: 'music-list' });
  const amb = renderAmbience();
  let tracks = state.tracks || [];
  let index = 0;

  const play = (i) => {
    if (!tracks[i]) return;
    index = i;
    player.src = `file://${encodeURI(tracks[i].path).replace(/#/g, '%23')}`;
    player.play().catch(() => {});
    paint();
  };

  const paint = () => {
    list.textContent = '';
    tracks.forEach((track, i) => {
      list.append(ui.h('button', {
        class: `music-track ${i === index ? 'on' : ''}`,
        onclick: () => play(i)
      }, track.name));
    });
    if (!tracks.length) {
      list.append(ui.h('div', { class: 'dock-empty' },
        'Add audio files from your machine and they play right here, with nothing sent anywhere.'));
    }
  };

  player.addEventListener('ended', () => { if (index + 1 < tracks.length) play(index + 1); });

  body.append(
    ui.h('div', { class: 'music-bar' },
      ui.h('button', {
        class: 'btn', onclick: async () => {
          const picked = await api.music.pick();
          if (!picked.length) return;
          tracks = tracks.concat(picked);
          state.tracks = tracks;
          paint();
          if (player.paused && !player.src) play(tracks.length - picked.length);
        }
      }, 'Add files'),
      ui.h('button', {
        class: 'text-btn',
        onclick: () => { tracks = []; state.tracks = []; player.pause(); player.removeAttribute('src'); paint(); }
      }, 'Clear')),
    player, amb, list);

  paint();
}

/* The site's own palette is a bright slab in the middle of a quiet editor, and
   in a narrow pane the red is the loudest thing on screen. Repaint it from the
   current theme instead. This overrides the site's design tokens rather than
   its class names: the tokens are the stable part, and one sheet then covers
   every page rather than chasing markup that changes weekly. */
function musicThemeCss() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name, fallback) => (cs.getPropertyValue(name) || fallback).trim();
  const bg = v('--surface', '#2c3635');
  const raised = v('--surface-2', '#323c3b');
  const chip = v('--surface-3', '#3b4644');
  const line = v('--outline-soft', '#384241');
  const text = v('--text', '#cbd6d2');
  const dim = v('--text-3', '#8fa09b');
  const primary = v('--primary', '#4ec7b8');

  const palette = `
    html, body, ytm-app, #app, .page-container { background: ${bg} !important; }
    html {
      color-scheme: dark;
      --yt-spec-base-background: ${bg} !important;
      --yt-spec-raised-background: ${raised} !important;
      --yt-spec-menu-background: ${raised} !important;
      --yt-spec-general-background-a: ${bg} !important;
      --yt-spec-general-background-b: ${bg} !important;
      --yt-spec-general-background-c: ${raised} !important;
      --yt-spec-brand-background-solid: ${bg} !important;
      --yt-spec-brand-background-primary: ${bg} !important;
      --yt-spec-text-primary: ${text} !important;
      --yt-spec-text-secondary: ${dim} !important;
      --yt-spec-icon-inactive: ${dim} !important;
      --yt-spec-icon-active-other: ${dim} !important;
      --yt-spec-badge-chip-background: ${chip} !important;
      --yt-spec-10-percent-layer: ${chip} !important;
      --yt-spec-outline: ${line} !important;
      --yt-spec-call-to-action: ${primary} !important;
      --yt-spec-themed-blue: ${primary} !important;
      --yt-spec-static-brand-red: ${primary} !important;
      --yt-spec-brand-link-text: ${primary} !important;
    }
    /* The top bar keeps a solid colour of its own, and the logo is the last
       piece of red on the screen. Neither belongs in a writing app. */
    ytm-mobile-topbar-renderer, .mobile-topbar-header, header, #header-bar,
    ytm-searchbox, .searchbox {
      background: ${bg} !important;
      border-color: ${line} !important;
    }
    .mobile-topbar-header-content .mobile-topbar-logo,
    ytm-logo, .topbar-logo, #logo { display: none !important; }
    /* Thumbnails and avatars are the rest of the noise. Take the edge off
       without touching the video itself, which stays as it is. */
    img, ytm-thumbnail-cover, .video-thumbnail-img { filter: saturate(.78) brightness(.9); }
    video, video ~ * img { filter: none; }
  `;

  /* Everything whose job is to send you somewhere else. Hidden by element name
     wherever possible: the ytm-* tags outlive the class names, which change
     often enough that a sheet written against them would rot. Switched off in
     Preferences if you would rather have the whole site. */
  const minimal = `
    /* Comments */
    ytm-comments-entry-point-header-renderer,
    ytm-comment-section-renderer,
    ytm-engagement-panel-section-list-renderer,
    #comments, .comments-entry-point,
    ytm-item-section-renderer[section-identifier="comment-item-section"] { display: none !important; }

    /* Likes, dislikes, share, save, subscribe */
    ytm-slim-video-action-bar-renderer,
    ytm-video-actions-renderer,
    like-button-renderer, dislike-button-renderer,
    ytm-subscribe-button-renderer, .subscribe-button,
    segmented-like-dislike-button-view-model { display: none !important; }

    /* Anything recommending the next thing */
    ytm-watch-next-secondary-results-renderer,
    ytm-item-section-renderer[section-identifier="related-items"],
    ytm-companion-slot, ytm-autonav-toggle-button-renderer,
    #related, .related-chips-slot,
    ytm-rich-grid-renderer, ytm-rich-section-renderer,
    ytm-shelf-renderer, ytm-reel-shelf-renderer,
    ytm-shorts-lockup-view-model, ytm-shorts-lockup-view-model-v2 { display: none !important; }

    /* The whole top bar: it carries the logo and the Open App button, and the
       pane has its own search box and Home button above it. */
    ytm-mobile-topbar-renderer { display: none !important; }

    /* The bar along the bottom, and the nudges to install the app */
    ytm-pivot-bar-renderer,
    ytm-mealbar-promo-renderer, ytm-app-promo-renderer,
    .mobile-topbar-header-app-promo { display: none !important; }

    /* The comment teaser that rides along under the title, and the carousel
       it sits in. These are view-models rather than ytm- elements, which is
       how the first pass missed them. */
    yt-video-metadata-carousel-view-model,
    comments-entry-point-teaser-view-model,
    yt-comment-teaser-carousel-item-view-model { display: none !important; }

    /* The like count in the line under the title; the views and the date stay. */
    .slim-video-information-like-count { display: none !important; }

    /* Search results and the player are what is left, and they stay. */
    ytm-search ytm-item-section-renderer,
    ytm-search ytm-video-with-context-renderer,
    ytm-watch #player, ytm-watch .player-container { display: block !important; }
  `;

  return state.prefs.youtubeMinimal === false ? palette : palette + minimal;
}

/* The bundled focus sounds. They are generated rather than played back, so
   there is no file to run out — see ambience.js. */
function renderAmbience() {
  const wrap = ui.h('div', { class: 'amb' });
  const rows = ui.h('div', { class: 'amb-list' });

  const paint = () => {
    rows.querySelectorAll('.amb-btn').forEach((b) => {
      b.classList.toggle('on', b.dataset.amb === ambience.playing);
    });
    stopBtn.hidden = !ambience.playing;
  };

  const stopBtn = ui.h('button', {
    class: 'text-btn', onclick: () => { ambience.stop(); paint(); }
  }, 'Stop');

  for (const a of AMBIENCES) {
    rows.append(ui.h('button', {
      class: 'amb-btn', 'data-amb': a.id, title: a.hint,
      onclick: () => { ambience.play(a.id); paint(); }
    }, a.name));
  }

  const vol = ui.h('input', {
    type: 'range', min: 0, max: 100, value: String(Math.round(ambience.volume * 100)),
    class: 'amb-vol', title: 'Focus sound volume',
    oninput: (e) => ambience.setVolume(Number(e.target.value) / 100)
  });

  wrap.append(
    ui.h('div', { class: 'amb-head' },
      ui.h('span', { class: 'amb-title' }, 'Focus sounds'),
      stopBtn),
    rows,
    ui.h('div', { class: 'amb-foot' }, vol));

  paint();
  return wrap;
}

/**
 * A music service in a <webview>: a separate process loading the site as an
 * ordinary page, with its own search rather than anything scraped.
 */
function renderMusicWeb(body, service) {
  const saved = (state.prefs.musicUrls || {})[service.id];
  const startUrl = saved && service.owns(saved) ? saved : service.home;

  const search = ui.h('input', {
    type: 'text', class: 'filter-input', placeholder: `Search ${service.name}`
  });
  const web = ui.h('webview', {
    class: 'yt-view',
    src: startUrl,
    partition: service.partition,
    useragent: MOBILE_AGENT,
    // Hidden pages are timer-throttled by default, which is fine for a
    // document and wrong for a music player.
    webpreferences: 'backgroundThrottling=no',
    allowpopups: false
  });

  const remember = (url) => {
    const urls = Object.assign({}, state.prefs.musicUrls || {});
    urls[service.id] = url;
    setPrefs({ musicUrls: urls });
  };

  const go = (url) => {
    if (!url) return;
    try { web.loadURL(url); } catch { web.src = url; }
    remember(url);
  };

  search.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const term = search.value.trim();
    if (!term) return;
    go(service.link(term) || service.search(term));
  });

  const back = ui.h('button', {
    class: 'text-btn', title: 'Back',
    onclick: () => { if (web.canGoBack && web.canGoBack()) web.goBack(); }
  }, '\u2039');

  const home = ui.h('button', { class: 'text-btn', title: `${service.name} home`,
                                onclick: () => go(service.home) }, 'Home');
  const openOut = ui.h('button', {
    class: 'text-btn', title: 'Open in your browser',
    onclick: () => api.music.openExternal(web.getURL ? web.getURL() : startUrl)
  }, 'Browser');

  const applyZoom = () => {
    const zoom = Math.max(0.4, Math.min(1.2, state.prefs.musicZoom || 0.75));
    try { web.setZoomFactor(zoom); } catch {}
    zoomLabel.textContent = `${Math.round(zoom * 100)}%`;
  };
  const nudgeZoom = (delta) => {
    const next = Math.max(0.4, Math.min(1.2, (state.prefs.musicZoom || 0.75) + delta));
    setPrefs({ musicZoom: Math.round(next * 100) / 100 });
    applyZoom();
  };
  const zoomLabel = ui.h('span', { class: 'zoom-label' }, '');
  const zoomOut = ui.h('button', { class: 'text-btn', title: 'Smaller', onclick: () => nudgeZoom(-0.05) }, '\u2212');
  const zoomIn = ui.h('button', { class: 'text-btn', title: 'Larger', onclick: () => nudgeZoom(0.05) }, '+');

  /* The site's own volume control is inside the player, which is fiddly at
     the size this pane runs at. This sets it on whatever media element is
     there, and again after every navigation, because the site replaces the
     element rather than reusing it. */
  const setGuestVolume = (v) => {
    if (!web.executeJavaScript) return;
    web.executeJavaScript(
      `(() => { for (const m of document.querySelectorAll('video, audio')) {` +
      ` m.volume = ${v}; m.muted = ${v === 0 ? 'true' : 'false'}; } return true; })()`
    ).catch(() => {});
  };

  const volume = ui.h('input', {
    type: 'range', min: 0, max: 100, class: 'yt-vol',
    value: String(Math.round((state.prefs.musicVolume != null ? state.prefs.musicVolume : 1) * 100)),
    title: 'Volume',
    oninput: (e) => {
      const v = Number(e.target.value) / 100;
      setPrefs({ musicVolume: Math.round(v * 100) / 100 });
      setGuestVolume(v);
    }
  });
  const applyVolume = () =>
    setGuestVolume(state.prefs.musicVolume != null ? state.prefs.musicVolume : 1);

  const status = ui.h('div', { class: 'yt-note' },
    `${service.name}\u2019s own site, in a browser view. Search above, tap a result to play it.`);

  /* Injected on every page, and again whenever the theme changes. The old
     sheet is removed first so switching themes does not stack them up. */
  let sheetKey = null;
  const paintGuest = () => {
    if (!web.insertCSS) return;
    if (sheetKey) { try { web.removeInsertedCSS(sheetKey); } catch {} sheetKey = null; }
    try {
      // The site keeps its dark styling behind this attribute.
      web.executeJavaScript(`document.documentElement.setAttribute('dark', '')`)
        .catch(() => {});
      web.insertCSS(musicThemeCss()).then((k) => { sheetKey = k; }).catch(() => {});
    } catch {}
  };
  repaintMusic = paintGuest;

  web.addEventListener('dom-ready', () => { applyZoom(); paintGuest(); applyVolume(); });
  web.addEventListener('did-fail-load', (e) => {
    if (e.errorCode === -3) return;   // aborted by a redirect, not a failure
    status.textContent = `Could not load ${service.name} (${e.errorDescription || e.errorCode}).`;
  });
  web.addEventListener('did-navigate', () => {
    remember(web.getURL()); applyZoom(); paintGuest(); applyVolume();
  });
  web.addEventListener('did-navigate-in-page', () => { remember(web.getURL()); applyVolume(); });
  web.addEventListener('media-started-playing', applyVolume);

  // Leaving the site opens the real browser instead of wandering off in here.
  web.addEventListener('will-navigate', (e) => {
    if (!service.owns(e.url)) {
      e.preventDefault();
      api.music.openExternal(e.url);
    }
  });

  /* Chromium leaves the guest sized for the whole window after HTML
     fullscreen. Stripping the inline styles is not enough on its own: the
     sizing lives inside the guest, not on the host element, and on Linux the
     window manager restores the window a beat after the event arrives — so a
     single pass on the way out can run before there is anything to correct.
     This keeps checking for a second and puts the guest back inside its dock
     whenever it is found outside it. */
  const reclaim = () => {
    for (const prop of ['position', 'top', 'left', 'right', 'bottom',
                        'width', 'height', 'z-index', 'transform', 'inset']) {
      web.style.removeProperty(prop);
    }
    // A one-pixel nudge makes Chromium recompute the guest's bounds. Hiding it
    // would do the same, but hiding a <webview> stops whatever is playing.
    const h = web.getBoundingClientRect().height;
    if (h > 1) {
      web.style.height = `${Math.round(h) - 1}px`;
      requestAnimationFrame(() => { web.style.removeProperty('height'); applyZoom(); });
    } else {
      requestAnimationFrame(applyZoom);
    }
  };

  const escaped = () => {
    const dock = document.getElementById('side-dock');
    if (!dock || dock.hidden) return false;
    const r = web.getBoundingClientRect();
    const d = dock.getBoundingClientRect();
    return r.width > d.width + 4 || r.left < d.left - 4 || r.top < d.top - 4;
  };

  let watchdog = null;
  const watchFor = (ms) => {
    clearInterval(watchdog);
    const until = Date.now() + ms;
    watchdog = setInterval(() => {
      if (escaped()) reclaim();
      if (Date.now() > until) { clearInterval(watchdog); watchdog = null; }
    }, 120);
  };

  web.addEventListener('enter-html-full-screen', () => document.body.classList.add('media-fullscreen'));
  web.addEventListener('leave-html-full-screen', () => {
    document.body.classList.remove('media-fullscreen');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    reclaim();
    watchFor(1500);
  });
  // The window itself resizing on the way out of fullscreen is the other half.
  window.addEventListener('resize', () => { if (escaped()) reclaim(); });

  body.append(
    ui.h('div', { class: 'music-bar' }, back, search),
    ui.h('div', { class: 'music-bar tight' }, home, openOut,
      ui.h('span', { class: 'spacer' }), volume, zoomOut, zoomLabel, zoomIn),
    web, status);

  applyZoom();
}

/* ---------------------------------------------------------------- toolbar */

/* The buttons at the top right are described here and drawn from preferences,
   so they can be reordered and switched off. Preferences itself stays put —
   hiding the way back into settings would be a trap. */
function toolbarItems() {
  return [
    { id: 'export', title: 'Export', icon: 'i-export', run: () => ui.showExport(ctx()) },
    { id: 'theme', title: 'Editor Theme', icon: 'i-theme', run: () => ui.showThemes(ctx()) },
    { id: 'music', title: 'Music', icon: 'i-music', run: () => dockToggle('music') },
    { id: 'sprint', title: 'Sprint', icon: 'i-sprint', run: () => ui.showSprint(ctx()) },
    { id: 'focus', title: 'Focus Mode', icon: 'i-focus',
      run: () => setPrefs({ focusMode: !state.prefs.focusMode }) },
    { id: 'prefs', title: 'Preferences', icon: 'i-prefs', pinned: true,
      run: () => ui.showPreferences(ctx()) }
  ];
}

export function orderedToolbar(prefs) {
  const items = toolbarItems();
  const known = new Map(items.map((i) => [i.id, i]));
  const out = [];
  for (const id of prefs.toolbarOrder || []) {
    if (known.has(id)) { out.push(known.get(id)); known.delete(id); }
  }
  for (const item of items) if (known.has(item.id)) out.push(item);
  return out;
}

function renderToolbar() {
  const host = $('tb-buttons');
  if (!host) return;
  host.textContent = '';
  const hidden = new Set(state.prefs.toolbarHidden || []);

  for (const item of orderedToolbar(state.prefs)) {
    if (hidden.has(item.id) && !item.pinned) continue;
    host.append(ui.h('button', {
      class: 'icon-btn', id: `btn-${item.id}`, title: item.title,
      html: `<svg><use href="#${item.icon}"/></svg>`,
      onclick: item.run
    }));
  }
  syncToolbarState();
}

function syncToolbarState() {
  const focus = $('btn-focus');
  if (focus) focus.classList.toggle('on', !!state.prefs.focusMode);
  const music = $('btn-music');
  if (music) music.classList.toggle('on', state.dockMode === 'music' && !$('side-dock').hidden);
}

/* ------------------------------------------------------------ view switch */

function wireViewSwitch() {
  const control = $('view-switch');
  const pane = document.querySelector('.pane');
  const NEAR = 190;

  const update = (e) => {
    const r = control.getBoundingClientRect();
    const dx = Math.max(r.left - e.clientX, 0, e.clientX - r.right);
    const dy = Math.max(r.top - e.clientY, 0, e.clientY - r.bottom);
    control.classList.toggle('near', Math.hypot(dx, dy) < NEAR);
  };

  // The sheet is re-fitted whenever the space available to it changes.
  const area = $('view-area');
  if (window.ResizeObserver && area) new ResizeObserver(() => fitPreviewZoom()).observe(area);

  pane.addEventListener('mousemove', update);
  pane.addEventListener('mouseleave', () => control.classList.remove('near'));
  // A moment of visibility on load, so it can be discovered at all.
  control.classList.add('near');
  setTimeout(() => control.classList.remove('near'), 2200);
}

function paintViewSwitch() {
  $('view-text').classList.toggle('on', !state.previewOpen);
  $('btn-preview').classList.toggle('on', state.previewOpen);
  // While the pages are showing, the way back stays visible.
  $('view-switch').classList.toggle('pinned', state.previewOpen);
}

/* ------------------------------------------------------------------ updates */

/* Nothing is installed automatically. If GitHub has a newer release we say so
   once, quietly, and let the download happen in a browser. */
async function checkForUpdate({ force = false } = {}) {
  let info;
  try {
    info = await api.update.check({ force });
  } catch {
    return;
  }
  if (!info || !info.available) {
    if (force) ui.toast(info && info.checked ? 'Low Tide is up to date' : 'Could not reach GitHub');
    return;
  }
  if (!force && state.prefs.updateDismissed === info.version) return;   // already waved away
  showUpdateBar(info);
}

function showUpdateBar(info) {
  const bar = $('update-bar');
  const text = $('update-text');
  text.textContent = '';
  text.append(document.createTextNode('Low Tide '),
              ui.h('b', {}, info.version),
              document.createTextNode(` is available. You have ${info.current}.`));
  $('update-get').onclick = () => api.update.open(info.url);
  $('update-dismiss').onclick = () => {
    bar.hidden = true;
    setPrefs({ updateDismissed: info.version });
  };
  bar.hidden = false;
}

/* ---------------------------------------------------------------- chrome */

function wireChrome() {
  $('btn-navigator').onclick = () => setPrefs({ navigatorOpen: !(state.prefs.navigatorOpen !== false) });

  $('btn-preview').onclick = () => togglePreview(true);
  $('view-text').onclick = () => togglePreview(false);
  wireViewSwitch();
  $('btn-home').onclick = () => api.home.show();
  $('save-state').onclick = () => save(false);
  $('save-state').title = 'Save now';
  $('btn-outline').onclick = () => dockToggle('outline');
  $('dock-close').onclick = () => dockClose();
  wireReferencePanel();
  wireDockResize();
  $('pv-pdf').onclick = () => exportAs('pdf');
  $('pv-title').onchange = (e) => { setPrefs({ previewTitlePage: e.target.checked }); renderPreview(true); };
  $('pv-notes').onchange = (e) => { setPrefs({ previewNotes: e.target.checked }); renderPreview(true); };

  wireScratchpad();

  $('rev-new').onclick = () => ui.showNewRevision(ctx());
  $('rev-show').onchange = (e) =>
    document.body.classList.toggle('hide-revisions', !e.target.checked);

  // Dropping in the empty space under the last chapter moves it to the end.
  const navList = $('nav-list');
  navList.addEventListener('dragover', (e) => {
    if (dragFrom == null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    showDrop(state.outline.length);
  });
  navList.addEventListener('drop', (e) => { e.preventDefault(); finishDrag(); });
  navList.addEventListener('dragleave', (e) => {
    if (dragFrom != null && !navList.contains(e.relatedTarget)) hideDrop();
  });

  const filter = $('nav-filter');
  filter.oninput = (e) => { state.navFilter = e.target.value; renderNavigator(); };
  filter.onkeydown = (e) => {
    if (e.key === 'Escape') { filter.value = ''; state.navFilter = ''; renderNavigator(); view.focus(); }
  };

  document.querySelectorAll('[data-export]').forEach((b) => {
    b.onclick = () => exportAs(b.dataset.export);
  });

  $('btn-appmenu').onclick = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    api.win.menu(r.left, r.bottom);
  };
  $('wc-min').onclick = () => api.win.minimize();
  $('wc-max').onclick = () => api.win.maximize();
  $('wc-close').onclick = () => api.win.close();

  $('doc-title-wrap').addEventListener('dblclick', () => {
    if (state.path) api.file.reveal(state.path);
  });

  document.querySelectorAll('.side-tab').forEach((b) => {
    b.onclick = () => setSidebarTab(b.dataset.tab);
  });
  $('goal-face').onclick = () => { if (!state.goal) ui.showGoal(ctx()); };
  $('goal-action').onclick = () => finishGoal();

  $('scrim').onclick = () => ui.closePanel();

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (ui.panelIsOpen()) { ui.closePanel(); e.preventDefault(); }
      else if (state.previewOpen) { togglePreview(false); e.preventDefault(); }
    }
  });

  window.addEventListener('beforeunload', () => { pushState.flush(); });
  window.addEventListener('blur', () => {
    pushState.flush();
    if (state.path && state.dirty) save(false, true);
  });

  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file && file.path) api.file.openPath(file.path);
  });
}

function ctx() {
  return {
    prefs: state.prefs,
    setPrefs,
    sprint,
    themes: { THEMES, swatches },
    revisionColours: REVISION_COLOURS,
    dropbox: state.dropbox,
    spelling: state.spelling,
    toolbar: {
      items: () => orderedToolbar(state.prefs).map(({ id, title, pinned }) => ({ id, title, pinned: !!pinned })),
      hidden: () => state.prefs.toolbarHidden || [],
      setOrder: (order) => setPrefs({ toolbarOrder: order }),
      setHidden: (hidden) => setPrefs({ toolbarHidden: hidden })
    },
    setLanguages: async (langs) => { state.spelling = await api.spell.setLanguages(langs); },
    addRevision,
    outline: () => state.outline,
    goalTypes: GOAL_TYPES,
    startGoal,
    goto: (item) => gotoPosition(view, item.from),
    exportAs
  };
}

/* ------------------------------------------------------------ menu bridge */

function wireMenu() {
  const zoom = (delta) => setPrefs({
    fontSize: Math.max(12, Math.min(32, (state.prefs.fontSize || 18) + delta))
  });

  const actions = {
    'file:save': () => save(false),
    'file:save-as': () => save(true),
    'file:export': () => ui.showExport(ctx()),
    'file:backups': () => showBackups(),
    'file:dropbox': async () => {
      const moved = await api.app.moveToDropbox(state.path);
      if (moved) ui.toast('Moved into Dropbox — the Dropbox app syncs it from here');
    },
    'file:print': () => exportAs('pdf'),

    'format:bold': () => toggleEmphasis(view, 'bold'),
    'format:italic': () => toggleEmphasis(view, 'italic'),
    'format:underline': () => toggleEmphasis(view, 'underline'),
    'format:h1': () => setHeading(view, 1),
    'format:h2': () => setHeading(view, 2),
    'format:h3': () => setHeading(view, 3),
    'format:body': () => setHeading(view, 0),
    'format:center': () => toggleCenter(view),
    'format:note': () => wrapNote(view),
    'format:divider': () => insertBlock(view, '***'),
    'format:pagebreak': () => insertBlock(view, '==='),

    'view:navigator': () => setPrefs({ navigatorOpen: !(state.prefs.navigatorOpen !== false) }),
    'view:focus': () => setPrefs({ focusMode: !state.prefs.focusMode }),
    'view:typewriter': () => setPrefs({ typewriter: !state.prefs.typewriter }),
    'view:preview': () => togglePreview(),
    'view:statusbar': () => setPrefs({ statusBar: !(state.prefs.statusBar !== false) }),
    'view:zoom-in': () => zoom(1),
    'view:zoom-out': () => zoom(-1),
    'view:zoom-reset': () => setPrefs({ fontSize: 18 }),

    'tools:sprint': () => ui.showSprint(ctx()),
    'tools:goto': () => {
      if (state.prefs.navigatorOpen !== false && state.prefs.sidebarTab !== 'stats') {
        setSidebarTab('navigator');
        $('nav-filter').focus();
        $('nav-filter').select();
      } else {
        ui.showGoto(ctx());
      }
    },
    'tools:find': () => openFind(view),
    'tools:replace': () => openFind(view, { replace: true }),
    'tools:find-next': () => { view.focus(); findNextMatch(view); },
    'tools:find-prev': () => { view.focus(); findPreviousMatch(view); },
    'tools:replace-next': () => { view.focus(); replaceNextMatch(view); },
    'tools:replace-all': () => { view.focus(); replaceEveryMatch(view); },
    'tools:prefs': () => ui.showPreferences(ctx()),
    'view:theme': () => ui.showThemes(ctx()),
    'view:outline': () => dockToggle('outline'),
    'view:reference': () => setSidebarTab('reference'),
    'view:music': () => dockToggle('music'),
    'tools:scratch': () => setSidebarTab('scratch'),
    'tools:revision': () => { setSidebarTab('revisions'); ui.showNewRevision(ctx()); },

    'help:updates': () => checkForUpdate({ force: true }),
    'help:markup': () => ui.showHelp(),
    'help:about': () => api.app.info().then((i) =>
      ui.toast(`Low Tide ${i.version} · Electron ${i.electron}`, 4000))
  };

  api.onMenu((cmd) => {
    const fn = actions[cmd];
    if (fn) fn();
  });
}
