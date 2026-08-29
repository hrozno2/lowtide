'use strict';
const { app, BrowserWindow, ipcMain, dialog, Menu, MenuItem, shell, nativeTheme, session } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { getPrefs, getSession, docEntry, setDocEntry, addRecent } = require('./store');
const { buildMenu } = require('./menu');
const backups = require('./backups');
const { buildDocx } = require('./docx');
const { TEMPLATES, SAMPLES, templateBody } = require('./templates');
// app.getVersion() reports Electron's version when running unpackaged.
const APP_VERSION = require('../../package.json').version;

const isMac = process.platform === 'darwin';
const HARNESS = !!process.env.LOWTIDE_HARNESS;

/** Report a problem without blocking an automated run behind a modal. */
function reportProblem(win, message, detail) {
  if (HARNESS) {
    console.log(`[low-tide] ${message}${detail ? ` — ${detail}` : ''}`);
    return Promise.resolve();
  }
  return dialog.showMessageBox(win || undefined, { type: 'error', message, detail });
}
const BG = '#0d1416';

/** Per-window document state mirrored from the renderer. */
const docs = new Map(); // win.id -> {path, dirty, content, cursor, title}
/** Windows that have already answered the "save your changes?" prompt. */
const closing = new Set();

// Only these are ever opened from the command line; anything else on argv is a
// flag or, when running unpackaged, the script path itself.
const OPENABLE = /\.(fountain|txt|md|markdown|text)$/i;

function openableArgs(argv) {
  return argv.filter((a) => {
    if (!a || a.startsWith('-') || !OPENABLE.test(a)) return false;
    try { return fs.statSync(a).isFile(); } catch { return false; }
  });
}

const FILTERS = [
  { name: 'Low Tide Documents', extensions: ['fountain', 'txt', 'md', 'markdown', 'text'] },
  { name: 'Fountain', extensions: ['fountain'] },
  { name: 'Markdown', extensions: ['md', 'markdown'] },
  { name: 'Plain Text', extensions: ['txt', 'text'] },
  { name: 'All Files', extensions: ['*'] }
];

/* ------------------------------------------------------------------ windows */

function createWindow(opts = {}) {
  const prefs = getPrefs();
  const bounds = prefs.get('window') || {};
  const offset = BrowserWindow.getAllWindows().length * 24;

  const win = new BrowserWindow({
    width: bounds.width || 1120,
    height: bounds.height || 780,
    x: Number.isFinite(bounds.x) ? bounds.x + offset : undefined,
    y: Number.isFinite(bounds.y) ? bounds.y + offset : undefined,
    minWidth: 520,
    minHeight: 420,
    backgroundColor: BG,
    show: false,
    title: 'Untitled',
    frame: isMac,
    titleBarStyle: isMac ? 'hiddenInset' : 'default',
    trafficLightPosition: isMac ? { x: 14, y: 13 } : undefined,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: true,
      backgroundThrottling: false,
      // The music pane hosts YouTube in a <webview>, which is a separate
      // process with no access to this one.
      webviewTag: true
    }
  });

  docs.set(win.id, { path: null, dirty: false, content: '', cursor: 0, title: 'Untitled' });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  win.once('ready-to-show', () => {
    win.show();
    if (opts.filePath) openInWindow(win, opts.filePath);
    else if (opts.restore) win.webContents.send('doc:load', opts.restore);
  });

  const saveBounds = () => {
    if (!win.isDestroyed() && !win.isFullScreen() && !win.isMaximized()) {
      const b = win.getBounds();
      prefs.set({ window: b });
    }
  };
  win.on('resize', saveBounds);
  win.on('move', saveBounds);

  win.on('close', (e) => {
    const state = docs.get(win.id);
    if (state && state.dirty && !closing.has(win.id)) {
      e.preventDefault();
      confirmClose(win);
    }
  });

  win.on('closed', () => {
    docs.delete(win.id);
    closing.delete(win.id);
    writeSession();
  });

  // Right-clicking a misspelling offers corrections, the way every native
  // text field does.
  win.webContents.on('context-menu', (event, params) => {
    const menu = new Menu();

    for (const suggestion of params.dictionarySuggestions.slice(0, 6)) {
      menu.append(new MenuItem({
        label: suggestion,
        click: () => win.webContents.replaceMisspelling(suggestion)
      }));
    }
    if (params.misspelledWord) {
      if (params.dictionarySuggestions.length) menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({
        label: 'Add to Dictionary',
        click: () => win.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord)
      }));
      menu.append(new MenuItem({ type: 'separator' }));
    }

    menu.append(new MenuItem({ role: 'cut', enabled: params.editFlags.canCut }));
    menu.append(new MenuItem({ role: 'copy', enabled: params.editFlags.canCopy }));
    menu.append(new MenuItem({ role: 'paste', enabled: params.editFlags.canPaste }));
    if (params.selectionText) {
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({ label: 'Bold', click: () => win.webContents.send('menu', 'format:bold') }));
      menu.append(new MenuItem({ label: 'Italic', click: () => win.webContents.send('menu', 'format:italic') }));
      menu.append(new MenuItem({ label: 'Note', click: () => win.webContents.send('menu', 'format:note') }));
    }
    menu.popup({ window: win });
  });

  // A video going fullscreen inside the music pane takes the whole window with
  // it. Remember how the window was, and put it back afterwards.
  let fullScreenBefore = false;
  win.webContents.on('enter-html-full-screen', () => { fullScreenBefore = win.isFullScreen(); });
  win.webContents.on('leave-html-full-screen', () => {
    if (!win.isDestroyed() && win.isFullScreen() !== fullScreenBefore) win.setFullScreen(fullScreenBefore);
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  return win;
}

async function confirmClose(win) {
  const state = docs.get(win.id);
  // Pull the freshest buffer straight from the renderer so nothing typed in the
  // last few hundred milliseconds is lost.
  try {
    const fresh = await win.webContents.executeJavaScript('window.__lowTideContent && window.__lowTideContent()', true);
    if (typeof fresh === 'string') state.content = fresh;
  } catch {}
  const name = state.path ? path.basename(state.path) : (state.title || 'Untitled');
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: isMac ? ['Save', 'Cancel', "Don't Save"] : ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: isMac ? 1 : 2,
    message: `Do you want to save the changes you made to “${name}”?`,
    detail: "Your changes will be lost if you don't save them."
  });
  const choice = isMac ? ['save', 'cancel', 'discard'][response] : ['save', 'discard', 'cancel'][response];
  if (choice === 'cancel') return;
  if (choice === 'save') {
    const current = docs.get(win.id) || state;
    const saved = await saveDocument(win, current.content, current.path);
    if (!saved) return;
  }
  closing.add(win.id);
  if (!win.isDestroyed()) win.close();
}

/* --------------------------------------------------------------------- file */

function readTextFile(filePath) {
  const buf = fs.readFileSync(filePath);
  let text = buf.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text.replace(/\r\n?/g, '\n');
}

function openInWindow(win, filePath) {
  try {
    const content = readTextFile(filePath);
    docs.set(win.id, {
      path: filePath, dirty: false, content, cursor: 0,
      title: path.basename(filePath)
    });
    win.webContents.send('doc:load', { path: filePath, content });
    win.setTitle(path.basename(filePath));
    if (isMac) win.setRepresentedFilename(filePath);
    addRecent(filePath);
    refreshMenu();
  } catch (err) {
    reportProblem(win, 'Could not open that file.', err.message);
  }
}

function windowForPath(filePath) {
  return BrowserWindow.getAllWindows().find((w) => {
    const s = docs.get(w.id);
    return s && s.path === filePath;
  });
}

function openFile(filePath, fromWindow) {
  const existing = windowForPath(filePath);
  if (existing) { existing.focus(); return existing; }
  const target = fromWindow && docs.get(fromWindow.id);
  // Reuse a pristine, empty, untitled window; otherwise open a new one.
  if (target && !target.path && !target.dirty && target.content.trim() === '') {
    openInWindow(fromWindow, filePath);
    return fromWindow;
  }
  return createWindow({ filePath });
}

async function promptOpen(fromWindow) {
  const win = fromWindow || BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win || undefined, {
    title: 'Open',
    properties: ['openFile'],
    filters: FILTERS
  });
  if (result.canceled) return;
  result.filePaths.forEach((p) => openFile(p, win));
}

async function saveDocument(win, content, filePath) {
  let target = filePath;
  if (!target) {
    const state = docs.get(win.id) || {};
    const suggested = (state.title || 'Untitled').replace(/[\\/:*?"<>|]/g, '-');
    const result = await dialog.showSaveDialog(win, {
      title: 'Save',
      defaultPath: path.join(defaultSaveDir(), `${suggested}.fountain`),
      filters: FILTERS.slice(0, 4)
    });
    if (result.canceled || !result.filePath) return null;
    target = result.filePath;
  }
  try {
    // Keep the version that is about to be replaced, then write atomically.
    if (fs.existsSync(target)) {
      try { backups.snapshot(target, fs.readFileSync(target, 'utf8')); } catch {}
    }
    backups.writeAtomic(target, content);
  } catch (err) {
    await reportProblem(win, 'Could not save.',
      `${err.message}\n\nYour text is still open in the window, and recent versions are in File ▸ Revert to Backup.`);
    return null;
  }
  const state = docs.get(win.id);
  if (state) { state.path = target; state.dirty = false; state.content = content; state.title = path.basename(target); }
  win.setTitle(path.basename(target));
  win.setDocumentEdited && win.setDocumentEdited(false);
  if (isMac) win.setRepresentedFilename(target);
  addRecent(target);
  refreshMenu();
  win.webContents.send('doc:saved', { path: target });
  return target;
}

/* ------------------------------------------------------------------ session */

let sessionTimer = null;
function writeSession() {
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(() => {
    const s = getSession();
    const open = BrowserWindow.getAllWindows()
      .map((w) => docs.get(w.id))
      .filter(Boolean)
      .map((d) => ({ path: d.path, content: d.content, cursor: d.cursor, dirty: d.dirty }));
    if (open.length) s.set({ docs: open });
    s.flush();
  }, 500);
}

/* --------------------------------------------------------------------- menu */

function refreshMenu() {
  Menu.setApplicationMenu(buildMenu({
    onNewWindow: () => createWindow(),
    onHome: () => createHomeWindow(),
    onOpen: () => promptOpen(BrowserWindow.getFocusedWindow()),
    onOpenRecent: (p) => {
      if (fs.existsSync(p)) openFile(p, BrowserWindow.getFocusedWindow());
      else {
        const prefs = getPrefs();
        prefs.set({ recent: (prefs.get('recent') || []).filter((r) => r !== p) });
        refreshMenu();
      }
    },
    onClearRecent: () => { getPrefs().set({ recent: [] }); app.clearRecentDocuments(); refreshMenu(); },
    recent: getPrefs().get('recent')
  }));
}

/* -------------------------------------------------------------------- home */

let homeWindow = null;

function createHomeWindow() {
  if (homeWindow && !homeWindow.isDestroyed()) {
    homeWindow.focus();
    return homeWindow;
  }
  homeWindow = new BrowserWindow({
    width: 900,
    height: 580,
    minWidth: 760,
    minHeight: 500,
    backgroundColor: BG,
    show: false,
    resizable: true,
    fullscreenable: false,
    title: 'Low Tide',
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });
  homeWindow.loadFile(path.join(__dirname, '..', 'renderer', 'home.html'));
  homeWindow.once('ready-to-show', () => homeWindow.show());
  homeWindow.on('closed', () => { homeWindow = null; });
  return homeWindow;
}

function closeHome() {
  if (homeWindow && !homeWindow.isDestroyed()) homeWindow.close();
  homeWindow = null;
}

function recentDocuments() {
  const list = getPrefs().get('recent') || [];
  const out = [];
  for (const p of list) {
    try {
      const stat = fs.statSync(p);
      out.push({ path: p, name: path.basename(p).replace(/\.[^.]+$/, ''), time: stat.mtimeMs });
    } catch {
      /* file moved or deleted - leave it out */
    }
  }
  return out;
}

ipcMain.handle('home:data', () => ({
  recent: recentDocuments(),
  templates: TEMPLATES.map(({ id, name, hint }) => ({ id, name, hint })),
  samples: SAMPLES.map(({ id, name, hint }) => ({ id, name, hint }))
}));

ipcMain.handle('home:open', (e, filePath) => {
  if (!filePath) return;
  openFile(filePath);
  closeHome();
});

ipcMain.handle('home:create', (e, templateId) => {
  const body = templateBody(templateId);
  const win = createWindow();
  win.once('ready-to-show', () => {
    if (body) win.webContents.send('doc:load', { path: null, content: body, dirty: false });
  });
  closeHome();
});

ipcMain.handle('home:browse', async () => {
  const before = BrowserWindow.getAllWindows().length;
  await promptOpen(homeWindow);
  if (BrowserWindow.getAllWindows().length > before) closeHome();
});

ipcMain.handle('home:close', () => {
  // Closing the start window just closes it. On Windows and Linux that is the
  // last window, so the app exits; on macOS it stays in the Dock, where Cmd-N
  // or clicking the icon brings it back.
  closeHome();
});

/* ----------------------------------------------------------------- dropbox */

/**
 * The Dropbox desktop client records its folder in info.json. Using that means
 * documents sync through the client the user already trusts — no API key, no
 * second copy of the file, and no conflict resolution of our own.
 */
let dropboxCache;
function dropboxRoot() {
  if (dropboxCache !== undefined) return dropboxCache;
  const home = app.getPath('home');
  const candidates = process.platform === 'win32'
    ? [
        path.join(process.env.APPDATA || '', 'Dropbox', 'info.json'),
        path.join(process.env.LOCALAPPDATA || '', 'Dropbox', 'info.json')
      ]
    : [path.join(home, '.dropbox', 'info.json')];

  for (const file of candidates) {
    try {
      const info = JSON.parse(fs.readFileSync(file, 'utf8'));
      const account = info.personal || info.business || Object.values(info)[0];
      if (account && account.path && fs.existsSync(account.path)) {
        dropboxCache = account.path;
        return dropboxCache;
      }
    } catch {}
  }
  const plain = path.join(home, 'Dropbox');
  dropboxCache = fs.existsSync(plain) ? plain : null;
  return dropboxCache;
}

function defaultSaveDir() {
  if (getPrefs().get('saveTo') === 'dropbox') {
    const root = dropboxRoot();
    if (root) {
      const dir = path.join(root, 'Low Tide');
      try {
        fs.mkdirSync(dir, { recursive: true });
        return dir;
      } catch {
        return root;
      }
    }
  }
  return app.getPath('documents');
}

/* ---------------------------------------------------------------------- ipc */

ipcMain.handle('prefs:get', () => getPrefs().all);
ipcMain.handle('prefs:set', (e, patch) => {
  const p = getPrefs().set(patch);
  // Broadcast so every window stays in sync.
  BrowserWindow.getAllWindows().forEach((w) => {
    if (w.webContents !== e.sender) w.webContents.send('prefs:changed', p);
  });
  return p;
});

ipcMain.handle('doc:state', (e, state) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return;
  const prev = docs.get(win.id) || {};
  const next = Object.assign({}, prev, state);
  docs.set(win.id, next);
  const name = next.path ? path.basename(next.path) : (next.title || 'Untitled');
  const title = next.dirty && !isMac ? `${name} — Edited` : name;
  if (win.getTitle() !== title) win.setTitle(title);
  if (isMac) win.setDocumentEdited(!!next.dirty);
  writeSession();
});

ipcMain.handle('backup:list', (e, filePath) => {
  if (!filePath) return [];
  return backups.listBackups(filePath).map((b) => ({
    name: b.name, file: b.file, size: b.size, time: b.time
  }));
});

ipcMain.handle('backup:open', async (e, { file, sourcePath }) => {
  try {
    const content = backups.readBackup(file);
    const win = createWindow();
    win.once('ready-to-show', () => {
      const label = path.basename(sourcePath || 'Untitled').replace(/\.[^.]+$/, '');
      win.webContents.send('doc:load', { path: null, content, dirty: true });
      win.setTitle(`${label} (backup)`);
    });
    return true;
  } catch (err) {
    dialog.showErrorBox('Could not open backup', err.message);
    return false;
  }
});

ipcMain.handle('backup:snapshot', (e, { path: filePath, content }) => {
  if (!filePath) return null;
  return backups.snapshot(filePath, content, { force: true });
});

ipcMain.handle('doc:extras', (e, path) => (path ? docEntry(path) : {}));
ipcMain.handle('doc:extras-set', (e, { path, patch }) => {
  if (!path) return null;
  return setDocEntry(path, patch);
});

ipcMain.handle('file:new', () => { createWindow(); });
ipcMain.handle('win:home', () => { createHomeWindow(); });
ipcMain.handle('file:open', (e) => promptOpen(BrowserWindow.fromWebContents(e.sender)));
ipcMain.handle('file:open-path', (e, p) => { openFile(p, BrowserWindow.fromWebContents(e.sender)); });

ipcMain.handle('file:save', async (e, { content, saveAs }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const state = docs.get(win.id) || {};
  return saveDocument(win, content, saveAs ? null : state.path);
});

ipcMain.handle('file:export', async (e, { content, html, format, suggested, runningHead, pageSetup, blocks, meta }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const extMap = { txt: 'txt', md: 'md', fountain: 'fountain', html: 'html', pdf: 'pdf', docx: 'docx' };
  const ext = extMap[format] || 'txt';
  const result = await dialog.showSaveDialog(win, {
    title: 'Export',
    defaultPath: path.join(defaultSaveDir(), `${(suggested || 'Untitled').replace(/[\\/:*?"<>|]/g, '-')}.${ext}`),
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }]
  });
  if (result.canceled || !result.filePath) return null;

  if (format === 'pdf') {
    const ok = await exportPdf(html, result.filePath, runningHead, pageSetup);
    if (!ok) return null;
  } else if (format === 'docx') {
    try {
      const setup = pageSetup || {};
      backups.writeAtomic(result.filePath, buildDocx(blocks || [], meta || {}, {
        fontSize: setup.fontSize, leading: setup.leading,
        justify: setup.justify, margin: setup.margin,
        titlePage: setup.titlePage
      }));
    } catch (err) {
      await reportProblem(win, 'Could not write the Word file.', err.message);
      return null;
    }
  } else {
    fs.writeFileSync(result.filePath, format === 'html' ? html : content, 'utf8');
  }
  return result.filePath;
});

function headerTemplate(runningHead) {
  const safe = String(runningHead || '').replace(/[&<>]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  return `<div style="width:100%;font:9px Georgia,'Times New Roman',serif;color:#000;` +
         `padding:0 1in;text-align:right;">${safe}&nbsp;&middot;&nbsp;` +
         `<span class="pageNumber"></span></div>`;
}

async function exportPdf(html, target, runningHead, pageSetup) {
  const tmp = path.join(os.tmpdir(), `low-tide-print-${Date.now()}.html`);
  fs.writeFileSync(tmp, html, 'utf8');
  const m = (pageSetup && Number(pageSetup.margin)) || 1;
  const printer = new BrowserWindow({ show: false, webPreferences: { offscreen: true, javascript: false } });
  try {
    await printer.loadFile(tmp);
    const data = await printer.webContents.printToPDF({
      printBackground: false,
      pageSize: (pageSetup && pageSetup.pageSize === 'a4') ? 'A4' : 'Letter',
      margins: {
        marginType: 'custom',
        top: m, bottom: m, left: m, right: m
      },
      // Chromium paginates the HTML itself, so the running head has to come
      // from the print engine rather than from the document.
      displayHeaderFooter: !!runningHead,
      headerTemplate: headerTemplate(runningHead),
      footerTemplate: '<div></div>'
    });
    fs.writeFileSync(target, data);
    return true;
  } catch (err) {
    dialog.showErrorBox('Export failed', err.message);
    return false;
  } finally {
    printer.destroy();
    fs.unlink(tmp, () => {});
  }
}

ipcMain.handle('win:close-confirmed', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win) confirmClose(win);
});
ipcMain.handle('win:minimize', (e) => BrowserWindow.fromWebContents(e.sender)?.minimize());
ipcMain.handle('win:maximize', (e) => {
  const w = BrowserWindow.fromWebContents(e.sender);
  if (!w) return;
  w.isMaximized() ? w.unmaximize() : w.maximize();
});
ipcMain.handle('win:close', (e) => BrowserWindow.fromWebContents(e.sender)?.close());
ipcMain.handle('win:menu', (e, { x, y }) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const menu = Menu.getApplicationMenu();
  if (menu && win) menu.popup({ window: win, x: Math.round(x), y: Math.round(y) });
});

/* ------------------------------------------------------------- reference */

/**
 * Definitions and synonyms are fetched here rather than in the renderer, so the
 * editor keeps its strict content-security policy and never talks to the
 * network itself. Only the single word is ever sent.
 */
const lookupCache = new Map();

async function fetchJson(url, ms = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

ipcMain.handle('lookup:word', async (e, rawWord) => {
  const word = String(rawWord || '').trim().toLowerCase().replace(/[^\p{L}\p{N}'\- ]/gu, '');
  if (!word) return { word: '', definitions: [], synonyms: [], antonyms: [], offline: false };
  if (lookupCache.has(word)) return lookupCache.get(word);

  if (getPrefs().get('onlineLookup') === false) {
    return { word, definitions: [], synonyms: [], antonyms: [], disabled: true };
  }

  const [entries, syn, ant] = await Promise.all([
    fetchJson(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`),
    fetchJson(`https://api.datamuse.com/words?rel_syn=${encodeURIComponent(word)}&max=40`),
    fetchJson(`https://api.datamuse.com/words?rel_ant=${encodeURIComponent(word)}&max=12`)
  ]);

  const definitions = [];
  if (Array.isArray(entries)) {
    for (const entry of entries) {
      for (const meaning of entry.meanings || []) {
        for (const def of (meaning.definitions || []).slice(0, 3)) {
          definitions.push({
            part: meaning.partOfSpeech || '',
            text: def.definition || '',
            example: def.example || ''
          });
        }
      }
    }
  }

  const result = {
    word,
    definitions: definitions.slice(0, 12),
    synonyms: Array.isArray(syn) ? syn.map((w) => w.word).slice(0, 40) : [],
    antonyms: Array.isArray(ant) ? ant.map((w) => w.word).slice(0, 12) : [],
    offline: !entries && !syn
  };
  lookupCache.set(word, result);
  if (lookupCache.size > 400) lookupCache.delete(lookupCache.keys().next().value);
  return result;
});

/** macOS has a real dictionary built in; use it when we can. */
ipcMain.handle('lookup:native', (e) => {
  if (!isMac) return false;
  const wc = e.sender;
  wc.showDefinitionForSelection();
  return true;
});

ipcMain.handle('music:open-external', (e, url) => {
  if (/^https:\/\/[^\s]+$/i.test(url)) {
    shell.openExternal(url);
    return true;
  }
  return false;
});

ipcMain.handle('music:pick', async (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const result = await dialog.showOpenDialog(win, {
    title: 'Add music',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio', extensions: ['mp3', 'm4a', 'aac', 'flac', 'wav', 'ogg', 'opus'] }]
  });
  if (result.canceled) return [];
  return result.filePaths.map((p) => ({ path: p, name: path.basename(p).replace(/\.[^.]+$/, '') }));
});

/* ------------------------------------------------------------- spelling */

/**
 * macOS uses the system spellchecker, which follows the languages set in
 * System Settings; everywhere else Chromium downloads Hunspell dictionaries
 * for whichever languages we ask for.
 */
ipcMain.handle('spell:languages', () => {
  const ses = session.defaultSession;
  return {
    managedByOS: isMac,
    available: isMac ? [] : (ses.availableSpellCheckerLanguages || []),
    current: isMac ? [] : (ses.getSpellCheckerLanguages ? ses.getSpellCheckerLanguages() : [])
  };
});

ipcMain.handle('spell:set-languages', (e, languages) => {
  if (isMac) return { managedByOS: true, current: [] };
  const ses = session.defaultSession;
  const available = new Set(ses.availableSpellCheckerLanguages || []);
  const wanted = (languages || []).filter((l) => available.has(l));
  try {
    ses.setSpellCheckerLanguages(wanted.length ? wanted : ['en-US']);
    getPrefs().set({ spellLanguages: wanted });
  } catch (err) {
    console.error('[low-tide] could not set spellchecker languages:', err.message);
  }
  return { managedByOS: false, current: ses.getSpellCheckerLanguages() };
});

ipcMain.handle('app:dropbox', () => ({ root: dropboxRoot() }));

/** Move the open document into the Dropbox folder so the client syncs it. */
ipcMain.handle('dropbox:move', async (e, filePath) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  const root = dropboxRoot();
  if (!root) {
    await dialog.showMessageBox(win, {
      type: 'info',
      message: 'No Dropbox folder found.',
      detail: 'Install and sign in to the Dropbox desktop app, then try again.'
    });
    return null;
  }
  if (!filePath) {
    await dialog.showMessageBox(win, {
      type: 'info',
      message: 'Save the document first.',
      detail: 'Once it exists on disk it can be moved into Dropbox.'
    });
    return null;
  }
  if (filePath.startsWith(root)) {
    await dialog.showMessageBox(win, {
      type: 'info', message: 'Already in Dropbox.', detail: filePath
    });
    return filePath;
  }

  try {
    const dir = path.join(root, 'Low Tide');
    fs.mkdirSync(dir, { recursive: true });

    const ext = path.extname(filePath);
    const stem = path.basename(filePath, ext);
    let target = path.join(dir, stem + ext);
    let n = 2;
    while (fs.existsSync(target)) target = path.join(dir, `${stem} ${n++}${ext}`);

    try {
      fs.renameSync(filePath, target);
    } catch {
      // Different volume: copy, verify, then remove the original.
      fs.copyFileSync(filePath, target);
      if (fs.readFileSync(target, 'utf8') !== fs.readFileSync(filePath, 'utf8')) {
        throw new Error('The copy did not match the original, so nothing was removed.');
      }
      fs.unlinkSync(filePath);
    }

    // Carry the scratchpad and revision marks across to the new path.
    const extras = docEntry(filePath);
    if (extras && Object.keys(extras).length) setDocEntry(target, extras);

    const state = docs.get(win.id);
    if (state) { state.path = target; state.title = path.basename(target); }
    win.webContents.send('doc:moved', { path: target });
    win.setTitle(path.basename(target));
    if (isMac) win.setRepresentedFilename(target);
    addRecent(target);
    refreshMenu();
    return target;
  } catch (err) {
    await dialog.showMessageBox(win, {
      type: 'error', message: 'Could not move the document.', detail: err.message
    });
    return null;
  }
});

ipcMain.handle('app:info', () => ({
  platform: process.platform,
  version: APP_VERSION,
  electron: process.versions.electron,
  chrome: process.versions.chrome
}));

ipcMain.handle('app:reveal', (e, p) => { if (p) shell.showItemInFolder(p); });

/* --------------------------------------------------------------- lifecycle */

const pendingFiles = [];
app.on('open-file', (event, filePath) => {
  event.preventDefault();
  if (app.isReady()) openFile(filePath, BrowserWindow.getFocusedWindow());
  else pendingFiles.push(filePath);
});

if (!process.env.LOWTIDE_HARNESS && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (event, argv) => {
    const files = openableArgs(argv.slice(1));
    if (files.length) files.forEach((f) => openFile(f));
    else {
      const win = BrowserWindow.getAllWindows()[0];
      if (win) { if (win.isMinimized()) win.restore(); win.focus(); }
      else createWindow();
    }
  });
}

app.whenReady().then(() => {
  nativeTheme.themeSource = 'dark';

  // Restore the chosen dictionaries before any window opens.
  if (!isMac) {
    const wanted = getPrefs().get('spellLanguages');
    if (Array.isArray(wanted) && wanted.length) {
      try { session.defaultSession.setSpellCheckerLanguages(wanted); } catch {}
    }
  }
  refreshMenu();

  const argFiles = openableArgs(process.argv.slice(1));
  const files = pendingFiles.concat(argFiles);

  if (files.length) {
    files.forEach((f) => createWindow({ filePath: f }));
  } else {
    const saved = (getSession().get('docs') || []).filter((d) => d && (d.dirty || d.path));
    const restorable = saved.slice(0, 4).filter((d) => !d.path || fs.existsSync(d.path));
    if (restorable.length) {
      restorable.forEach((d) => {
        // Prefer disk contents for saved files; keep the buffer for unsaved work.
        let content = d.content || '';
        if (d.path && !d.dirty) { try { content = readTextFile(d.path); } catch {} }
        createWindow({ restore: { path: d.path || null, content, cursor: d.cursor || 0, dirty: !!d.dirty } });
      });
    } else {
      createHomeWindow();
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createHomeWindow();
  });
});

app.on('window-all-closed', () => {
  getPrefs().flush();
  if (!isMac) app.quit();
});

app.on('before-quit', () => {
  getPrefs().flush();
  const s = getSession();
  const open = BrowserWindow.getAllWindows().map((w) => docs.get(w.id)).filter(Boolean)
    .map((d) => ({ path: d.path, content: d.content, cursor: d.cursor, dirty: d.dirty }));
  if (open.length) s.set({ docs: open });
  s.flush();
});
