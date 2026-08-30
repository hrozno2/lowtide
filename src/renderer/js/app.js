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
import { REVISION_COLOURS, colourById, applyRevisions, restoreMarks,
         dropRevision, serialiseMarks, revisionCounts,
         revertRevision, applyRevision, rangesOf } from './revisions.js';

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

/* ------------------------------------------------------------------ boot */

(async function boot() {
  document.body.classList.add(
    api.platform === 'darwin' ? 'mac' : api.platform === 'win32' ? 'win' : 'linux');

  state.prefs = await api.prefs.get();
  state.goal = state.prefs.goal || null;
  state.goalHistory = state.prefs.goalHistory || [];
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

  // Small automation surface: the main process reads the live buffer through
  // this when confirming an unsaved close, and scripts/selftest.js drives it.
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

  if (changed('theme')) applyTheme(p.theme || 'material');
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

  shown.forEach(({ item, i }) => {
    list.append(ui.h('button', {
      class: `nav-item lvl-${item.level}`,
      'data-i': i,
      onclick: () => { gotoPosition(view, item.from); highlightActive(true); }
    },
      ui.h('span', { class: 'label' }, item.title),
      ui.h('span', { class: 'count' }, item.words ? item.words.toLocaleString() : '')));
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
  state.goalHistory = [{
    finishedAt: Date.now(),
    type: goal.type,
    target: goal.target,
    achieved,
    met: achieved >= goal.target
  }].concat(state.goalHistory || []).slice(0, 40);
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
    list.append(ui.h('div', { class: 'goal-empty' }, 'Finished goals are listed here.'));
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
    player, list);

  paint();
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

  const status = ui.h('div', { class: 'yt-note' },
    `${service.name}\u2019s own site, in a browser view. Search above, tap a result to play it.`);

  web.addEventListener('dom-ready', applyZoom);
  web.addEventListener('did-fail-load', (e) => {
    if (e.errorCode === -3) return;   // aborted by a redirect, not a failure
    status.textContent = `Could not load ${service.name} (${e.errorDescription || e.errorCode}).`;
  });
  web.addEventListener('did-navigate', () => { remember(web.getURL()); applyZoom(); });
  web.addEventListener('did-navigate-in-page', () => remember(web.getURL()));

  // Leaving the site opens the real browser instead of wandering off in here.
  web.addEventListener('will-navigate', (e) => {
    if (!service.owns(e.url)) {
      e.preventDefault();
      api.music.openExternal(e.url);
    }
  });

  // Chromium leaves the guest sized for the whole window after HTML fullscreen,
  // which is what used to swallow the interface. Put everything back by hand.
  web.addEventListener('enter-html-full-screen', () => document.body.classList.add('media-fullscreen'));
  web.addEventListener('leave-html-full-screen', () => {
    document.body.classList.remove('media-fullscreen');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    for (const prop of ['position', 'top', 'left', 'right', 'bottom', 'width', 'height', 'z-index', 'transform']) {
      web.style.removeProperty(prop);
    }
    web.style.removeProperty('inset');
    requestAnimationFrame(applyZoom);
  });

  body.append(
    ui.h('div', { class: 'music-bar' }, back, search),
    ui.h('div', { class: 'music-bar tight' }, home, openOut,
      ui.h('span', { class: 'spacer' }), zoomOut, zoomLabel, zoomIn),
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

/* ---------------------------------------------------------------- chrome */

function wireChrome() {
  $('btn-navigator').onclick = () => setPrefs({ navigatorOpen: !(state.prefs.navigatorOpen !== false) });

  $('btn-preview').onclick = () => togglePreview(true);
  $('view-text').onclick = () => togglePreview(false);
  wireViewSwitch();
  $('btn-prefs').onclick = () => ui.showPreferences(ctx());
  $('btn-home').onclick = () => api.home.show();
  $('save-state').onclick = () => save(false);
  $('save-state').title = 'Save now';
  $('btn-outline').onclick = () => dockToggle('outline');
  $('dock-close').onclick = () => dockClose();
  wireReferencePanel();
  wireDockResize();
  $('btn-sprint').onclick = () => ui.showSprint(ctx());
  $('pv-pdf').onclick = () => exportAs('pdf');
  $('pv-title').onchange = (e) => { setPrefs({ previewTitlePage: e.target.checked }); renderPreview(true); };
  $('pv-notes').onchange = (e) => { setPrefs({ previewNotes: e.target.checked }); renderPreview(true); };

  wireScratchpad();

  $('rev-new').onclick = () => ui.showNewRevision(ctx());
  $('rev-show').onchange = (e) =>
    document.body.classList.toggle('hide-revisions', !e.target.checked);

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

    'help:markup': () => ui.showHelp(),
    'help:about': () => api.app.info().then((i) =>
      ui.toast(`Low Tide ${i.version} · Electron ${i.electron}`, 4000))
  };

  api.onMenu((cmd) => {
    const fn = actions[cmd];
    if (fn) fn();
  });
}
