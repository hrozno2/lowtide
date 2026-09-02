'use strict';
const { app, Menu, shell, BrowserWindow } = require('electron');

const isMac = process.platform === 'darwin';

function send(cmd) {
  return () => {
    const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
    if (win) win.webContents.send('menu', cmd);
  };
}

function buildMenu({ onNewWindow, onOpen, onOpenRecent, recent, onClearRecent, onHome }) {
  const recentItems = (recent || []).length
    ? (recent || []).map((p) => ({
        label: p.replace(/^.*[\\/]/, ''),
        sublabel: p,
        click: () => onOpenRecent(p)
      })).concat([{ type: 'separator' }, { label: 'Clear Menu', click: onClearRecent }])
    : [{ label: 'No Recent Documents', enabled: false }];

  const template = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about', label: 'About Low Tide' },
        { type: 'separator' },
        { label: 'Preferences…', accelerator: 'CmdOrCtrl+,', click: send('tools:prefs') },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide', label: 'Hide Low Tide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit', label: 'Quit Low Tide' }
      ]
    }] : []),
    {
      label: '&File',
      submenu: [
        { label: 'New', accelerator: 'CmdOrCtrl+N', click: () => onNewWindow() },
        { label: 'Home…', accelerator: 'CmdOrCtrl+Shift+H', click: () => onHome() },
        { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: () => onOpen() },
        { label: 'Open Recent', submenu: recentItems },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: send('file:save') },
        { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: send('file:save-as') },
        { type: 'separator' },
        { label: 'Revert to Backup…', click: send('file:backups') },
        { label: 'Move to Dropbox', click: send('file:dropbox') },
        { type: 'separator' },
        { label: 'Export…', accelerator: 'CmdOrCtrl+E', click: send('file:export') },
        { label: 'Print / PDF…', accelerator: 'CmdOrCtrl+P', click: send('file:print') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit', label: 'Exit' }
      ]
    },
    {
      label: '&Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle', label: 'Paste as Plain Text' },
        { role: 'selectAll' },
        { type: 'separator' },
        { label: 'Find…', accelerator: 'CmdOrCtrl+F', click: send('tools:find') },
        { label: 'Find and Replace…',
          accelerator: isMac ? 'Cmd+Alt+F' : 'Ctrl+H', click: send('tools:replace') },
        { label: 'Find Next', accelerator: 'CmdOrCtrl+G', click: send('tools:find-next') },
        { label: 'Find Previous', accelerator: 'Shift+CmdOrCtrl+G', click: send('tools:find-prev') },
        { label: 'Replace', accelerator: 'CmdOrCtrl+Alt+E', click: send('tools:replace-next') },
        { label: 'Replace All', accelerator: 'Shift+CmdOrCtrl+Alt+E', click: send('tools:replace-all') },
        { type: 'separator' },
        { label: 'Go to Chapter…', accelerator: 'CmdOrCtrl+J', click: send('tools:goto') },
        ...(isMac ? [{ type: 'separator' }, { role: 'startSpeaking', label: 'Start Speaking' }, { role: 'stopSpeaking' }] : [])
      ]
    },
    {
      label: 'F&ormat',
      submenu: [
        { label: 'Bold', accelerator: 'CmdOrCtrl+B', click: send('format:bold') },
        { label: 'Italic', accelerator: 'CmdOrCtrl+I', click: send('format:italic') },
        { label: 'Underline', accelerator: 'CmdOrCtrl+U', click: send('format:underline') },
        { type: 'separator' },
        { label: 'Chapter', accelerator: 'CmdOrCtrl+1', click: send('format:h1') },
        { label: 'Section', accelerator: 'CmdOrCtrl+2', click: send('format:h2') },
        { label: 'Sub-section', accelerator: 'CmdOrCtrl+3', click: send('format:h3') },
        { label: 'Body Text', accelerator: 'CmdOrCtrl+0', click: send('format:body') },
        { type: 'separator' },
        { label: 'Centered', accelerator: 'CmdOrCtrl+Shift+C', click: send('format:center') },
        { label: 'Note', accelerator: 'CmdOrCtrl+Shift+N', click: send('format:note') },
        { label: 'Scene Break', accelerator: 'CmdOrCtrl+Shift+B', click: send('format:divider') },
        { label: 'Page Break', accelerator: 'CmdOrCtrl+Shift+P', click: send('format:pagebreak') }
      ]
    },
    {
      label: '&View',
      submenu: [
        { label: 'Navigator', accelerator: 'CmdOrCtrl+Shift+L', click: send('view:navigator') },
        { label: 'Preview', accelerator: 'CmdOrCtrl+Shift+E', click: send('view:preview') },
        { label: 'Status Bar', click: send('view:statusbar') },
        { label: 'Editor Theme…', accelerator: 'CmdOrCtrl+T', click: send('view:theme') },
        { type: 'separator' },
        { label: 'Outline', accelerator: 'CmdOrCtrl+Shift+U', click: send('view:outline') },
        { label: 'Dictionary and Thesaurus', accelerator: 'CmdOrCtrl+Shift+D', click: send('view:reference') },
        { label: 'Music', accelerator: 'CmdOrCtrl+Shift+M', click: send('view:music') },
        { type: 'separator' },
        { label: 'Focus Mode', accelerator: 'CmdOrCtrl+Shift+F', click: send('view:focus') },
        { label: 'Typewriter Mode', accelerator: 'CmdOrCtrl+Shift+T', click: send('view:typewriter') },
        { label: 'Sprint…', accelerator: 'CmdOrCtrl+Shift+R', click: send('tools:sprint') },
        { label: 'Scratchpad', accelerator: 'CmdOrCtrl+Shift+K', click: send('tools:scratch') },
        { label: 'New Revision…', accelerator: 'CmdOrCtrl+Shift+V', click: send('tools:revision') },
        { type: 'separator' },
        { label: 'Bigger Text', accelerator: 'CmdOrCtrl+Plus', click: send('view:zoom-in') },
        { label: 'Smaller Text', accelerator: 'CmdOrCtrl+-', click: send('view:zoom-out') },
        { label: 'Actual Size', accelerator: 'CmdOrCtrl+Shift+0', click: send('view:zoom-reset') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(process.env.LOWTIDE_DEV ? [{ role: 'toggleDevTools' }, { role: 'reload' }] : [])
      ]
    },
    {
      label: '&Window',
      submenu: [
        { role: 'minimize' },
        ...(isMac ? [{ role: 'zoom' }, { type: 'separator' }, { role: 'front' }] : [{ role: 'close' }])
      ]
    },
    {
      label: '&Help',
      submenu: [
        { label: 'Markup Cheat Sheet', accelerator: 'F1', click: send('help:markup') },
        { label: 'Check for Updates…', click: send('help:updates') },
        ...(isMac ? [] : [{ type: 'separator' }, { label: 'About Low Tide', click: send('help:about') }])
      ]
    }
  ];

  return Menu.buildFromTemplate(stamp(template));
}

/* Every item gets an id on the way through, so the renderer can draw the menu
   itself and still ask the real one to do the work — roles included, which no
   amount of serialised data could carry on its own. */
let counter = 0;
function stamp(items) {
  for (const item of items) {
    if (item.type === 'separator') continue;
    if (!item.id) item.id = `m${counter++}`;
    if (item.submenu) stamp(item.submenu);
  }
  return items;
}

/** The built menu as plain data: what to draw, and the id to invoke. */
function describeMenu() {
  const menu = Menu.getApplicationMenu();
  if (!menu) return [];

  const walk = (items) => items.map((item) => ({
    id: item.id || null,
    label: (item.label || '').replace(/&/g, ''),
    sublabel: item.sublabel || '',
    accelerator: item.accelerator || item.userAccelerator || '',
    type: item.type,
    enabled: item.enabled !== false,
    checked: !!item.checked,
    submenu: item.submenu ? walk(item.submenu.items) : null
  }));

  return walk(menu.items);
}

/** Runs the item the renderer's drawing stands for. */
function invokeMenuItem(id) {
  const menu = Menu.getApplicationMenu();
  const item = menu && menu.getMenuItemById(id);
  if (!item || item.enabled === false) return false;
  item.click();
  return true;
}

module.exports = { buildMenu, describeMenu, invokeMenuItem };
