'use strict';
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const DEFAULTS = {
  fontFamily: 'mono',
  fontSize: 16,
  lineHeight: 1.6,
  pageWidth: 650,
  paragraphStyle: 'none', // 'none' | 'indent' | 'spaced'
  focusMode: false,
  focusScope: 'paragraph', // 'paragraph' | 'line' | 'sentence'
  noteStyle: 'highlight',  // 'highlight' | 'dim' — notes lit, or out of the way
  typewriter: false,
  caretSnap: false,        // true keeps the caret hard against the edge
  autosave: true,            // write to disk as you work, without a word about it
  autosaveSeconds: 15,       // at least this often while you keep writing
  versionsKept: 200,         // past versions of a document, before thinning
  companionFile: true,       // keep a .lowtide beside a manuscript so its
                             // outline, notes and goal history travel with it
  navigatorOpen: true,
  spellcheck: true,
  spellLanguages: [],
  onlineLookup: true,
  updateCheck: true,
  updateDismissed: '',
  lastUpdateCheck: 0,
  musicMode: 'files',
  musicZoom: 0.75,
  musicUrls: {},
  youtubeEnabled: true,
  youtubeMinimal: true,
  musicVolume: 1,
  menuStyle: 'button',      // 'button' | 'bar' — Windows and Linux only
  statusBar: true,
  readingSpeed: 275,
  /* Print template — a printed novel, not a manuscript. Every value is
     adjustable in Preferences, and PAGE_PRESETS below sets them in a group.

     6x9 is the standard trade paperback trim. 11.5pt Amiri on 145% leading in
     a 4.25in measure gives 31 lines a page, which is how a trade paperback is
     actually set, and it lands on the number the trade works to: a page is
     about 300 words. Measured, not estimated — scripts/wpp.js lays 30,000
     words of real novel prose out in this exact geometry and reads back what
     a page holds: 307 (Austen), 320 (Doyle), 316 (Melville), mean 314.

     The page Highland draws is a different thing and is kept as a preset:
     13pt on 20.8pt lines in a 385pt column on the locale's paper, which comes
     to about 386 words a page. That is a manuscript page count, not a book's,
     so it no longer leads. */
  pageSize: '6x9',           // '6x9' | '5.5x8.5' | 'letter' | 'a4'
  printFontSize: 11.5,       // pt
  printLeading: 1.45,        // multiple of the font size
  printSideMargin: 0.875,    // inches, left and right: a 4.25in measure on 6x9
  printHyphenate: false,
  theme: 'material',
  saveTo: 'documents',      // 'documents' | 'dropbox'
  printMargin: 0.9,          // inches, top
  printBottomMargin: 0.9,    // inches; 31 lines a page
  printJustify: true,
  pageMarkers: false,        // page numbers in the margin of the writing view
  positionMode: null,        // null = 'N pages' | 'page' | 'chapter' (the status bar cycles)
  goal: null,
  // Kept only to hand to the first document opened after the change that
  // made a goal belong to its manuscript (see readCompanion in main).
  goalHistory: [],
  sprintHistory: [],
  goalsAreDocuments: false,
  // How Home is arranged: see src/main/shelf.js. Empty until you move
  // something, and then it holds the arrangement you made.
  shelves: [],
  homeView: 'shelf',        // 'shelf' | 'list'
  sidebarTab: 'navigator',
  toolbarOrder: ['export', 'theme', 'music', 'sprint', 'focus', 'prefs'],
  toolbarHidden: [],
  dockMode: 'outline',
  dockOpen: false,
  dockWidth: 380,
  previewTitlePage: false,
  previewNotes: false,
  recent: [],
  window: { width: 1120, height: 780, x: undefined, y: undefined }
};

/**
 * The app used to be called Foolscap, so Electron kept its data in a folder of
 * that name. Move it across once rather than silently starting empty.
 */
function migrateOldProfile() {
  try {
    const now = app.getPath('userData');
    const old = path.join(path.dirname(now), 'Foolscap');
    if (old === now || !fs.existsSync(old)) return;
    if (fs.existsSync(path.join(now, 'preferences.json'))) return;

    fs.mkdirSync(now, { recursive: true });
    for (const name of ['preferences.json', 'session.json', 'documents.json', 'backups']) {
      const from = path.join(old, name);
      const to = path.join(now, name);
      if (!fs.existsSync(from) || fs.existsSync(to)) continue;
      fs.cpSync(from, to, { recursive: true });
    }
    console.log('[low-tide] carried settings over from the previous name');
  } catch (err) {
    console.error('[low-tide] could not migrate the old profile:', err.message);
  }
}

let migrated = false;

// Values earlier versions wrote to disk as their defaults. A settings file
// from before SETTINGS_VERSION 2 has them written out in full whether or not
// they were ever chosen, so on first read they are dropped and the current
// defaults apply. (A deliberate pick of the same value is indistinguishable
// and goes with them; that is the price of the older, whole-object writes.)
// The file is then stamped, so a value chosen later is never touched.
const SETTINGS_VERSION = 2;
const RETIRED_DEFAULTS = {
  pageSize: ['letter', '6x9'],
  printFontSize: [12, 11, 12.75],
  printLeading: [1.8, 1.42, 1.65],
  printSideMargin: [1.45]
};

// Letter is the paper of the US and a few of its neighbours; everywhere else
// it is A4. Only the manuscript presets use it now: a book is set on a book
// trim wherever you live.
function paperFor(country) {
  return ['US', 'CA', 'MX', 'PH'].includes(String(country || '').toUpperCase()) ? 'letter' : 'a4';
}

/* Whole pages, set the way the job is actually set, so the seven values that
   describe a page can be chosen as one. Words-per-page is measured, not
   estimated: scripts/wpp.js lays 30,000 words of real novel prose out in each
   geometry and reads back what a page holds. */
function pagePresets(country) {
  const paper = paperFor(country);
  return [
    { id: 'book', name: 'Trade paperback', hint: '6×9, about 300 words a page',
      prefs: { pageSize: '6x9', printFontSize: 11.5, printLeading: 1.45,
               printSideMargin: 0.875, printMargin: 0.9, printBottomMargin: 0.9,
               printJustify: true, printHyphenate: false } },
    { id: 'pocket', name: 'Mass market', hint: '5.5×8.5, a smaller book',
      prefs: { pageSize: '5.5x8.5', printFontSize: 10.5, printLeading: 1.42,
               printSideMargin: 0.75, printMargin: 0.75, printBottomMargin: 0.75,
               printJustify: true, printHyphenate: false } },
    { id: 'highland', name: 'Highland Novel', hint: 'the page Highland 2 draws, about 390 words',
      prefs: { pageSize: paper, printFontSize: 13, printLeading: 1.6,
               printSideMargin: 1.46, printMargin: 1, printBottomMargin: 1,
               printJustify: true, printHyphenate: false } },
    { id: 'manuscript', name: 'Submission manuscript', hint: 'double spaced, 12pt, an inch all round',
      prefs: { pageSize: paper, printFontSize: 12, printLeading: 2,
               printSideMargin: 1, printMargin: 1, printBottomMargin: 1,
               printJustify: false, printHyphenate: false } }
  ];
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

class JsonFile {
  constructor(name, defaults) {
    if (!migrated) { migrated = true; migrateOldProfile(); }
    this.file = path.join(app.getPath('userData'), name);
    this.defaults = defaults;
    this.data = this._read();
    this._timer = null;
  }
  _read() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if ((raw.settingsVersion || 0) < SETTINGS_VERSION) {
        for (const [k, olds] of Object.entries(RETIRED_DEFAULTS)) {
          if (olds.some((v) => same(raw[k], v))) delete raw[k];
        }
      }
      return Object.assign({}, this.defaults, raw, { settingsVersion: SETTINGS_VERSION });
    } catch {
      return Object.assign({}, this.defaults, { settingsVersion: SETTINGS_VERSION });
    }
  }
  get all() { return this.data; }
  get(key) { return this.data[key]; }
  set(patch) {
    Object.assign(this.data, patch);
    this.flushLater();
    return this.data;
  }
  /** Put the named keys back to their defaults. */
  reset(keys) {
    for (const k of keys) {
      if (k in this.defaults) this.data[k] = clone(this.defaults[k]);
      else delete this.data[k];
    }
    this.flushLater();
    return this.data;
  }
  flushLater() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.flush(), 400);
  }
  flush() {
    clearTimeout(this._timer);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      // Only what differs from the defaults goes to disk. Writing the whole
      // object froze every default at whatever it was the first time any
      // preference was touched, so a later change of default never reached
      // an existing install.
      const sparse = {};
      for (const [k, v] of Object.entries(this.data)) {
        if (!same(v, this.defaults[k])) sparse[k] = v;
      }
      fs.writeFileSync(this.file, JSON.stringify(sparse, null, 2));
    } catch (err) {
      console.error('[low-tide] could not write', this.file, err.message);
    }
  }
}

let prefs = null;
let localeCountry = '';
let session = null;
let sidecar = null;

function getPrefs() {
  if (!prefs) {
    let country = '';
    try { country = app.getLocaleCountryCode(); } catch { /* not ready: A4 */ }
    localeCountry = country;
    prefs = new JsonFile('preferences.json', DEFAULTS);
  }
  return prefs;
}

function getSession() {
  if (!session) session = new JsonFile('session.json', { docs: [] });
  return session;
}

/**
 * Per-document extras that must not pollute the manuscript file itself:
 * the scratchpad and the revision marks, keyed by absolute path.
 */
function getSidecar() {
  if (!sidecar) sidecar = new JsonFile('documents.json', { docs: {} });
  return sidecar;
}

function docEntry(path) {
  const all = getSidecar().get('docs') || {};
  return all[path] || {};
}

function setDocEntry(path, patch) {
  const store = getSidecar();
  const all = Object.assign({}, store.get('docs') || {});
  all[path] = Object.assign({}, all[path] || {}, patch);
  // Drop entries whose file is gone so the store cannot grow without bound.
  const keys = Object.keys(all);
  if (keys.length > 400) {
    for (const k of keys.slice(0, keys.length - 400)) delete all[k];
  }
  store.set({ docs: all });
  return all[path];
}

function addRecent(filePath) {
  if (!filePath) return;
  const p = getPrefs();
  const recent = (p.get('recent') || []).filter((r) => r !== filePath);
  recent.unshift(filePath);
  p.set({ recent: recent.slice(0, 12) });
  try { app.addRecentDocument(filePath); } catch {}
}

module.exports = { getPrefs, getSession, getSidecar, docEntry, setDocEntry, addRecent, DEFAULTS, pagePresets: () => pagePresets(localeCountry) };
