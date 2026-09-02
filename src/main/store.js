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
  typewriter: false,
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
  // Print template. The defaults describe a typical printed novel page;
  // every value is adjustable in Preferences.
  pageSize: 'letter',        // 'letter' | 'a4'
  printFontSize: 12,         // pt
  printLeading: 1.8,         // multiple of the font size
  theme: 'material',
  saveTo: 'documents',      // 'documents' | 'dropbox'
  printMargin: 1,            // inches
  printJustify: true,
  goal: null,
  goalHistory: [],
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
      return Object.assign({}, this.defaults, raw);
    } catch {
      return Object.assign({}, this.defaults);
    }
  }
  get all() { return this.data; }
  get(key) { return this.data[key]; }
  set(patch) {
    Object.assign(this.data, patch);
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
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    } catch (err) {
      console.error('[low-tide] could not write', this.file, err.message);
    }
  }
}

let prefs = null;
let session = null;
let sidecar = null;

function getPrefs() {
  if (!prefs) prefs = new JsonFile('preferences.json', DEFAULTS);
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

module.exports = { getPrefs, getSession, getSidecar, docEntry, setDocEntry, addRecent, DEFAULTS };
