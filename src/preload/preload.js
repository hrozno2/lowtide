'use strict';
const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Map();
function on(channel, fn) {
  const wrapped = (_e, payload) => fn(payload);
  listeners.set(fn, wrapped);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.off(channel, wrapped);
}

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,

  prefs: {
    get: () => ipcRenderer.invoke('prefs:get'),
    set: (patch) => ipcRenderer.invoke('prefs:set', patch),
    onChange: (fn) => on('prefs:changed', fn)
  },

  theme: {
    setIcon: (id) => ipcRenderer.invoke('theme:set-icon', id)
  },

  doc: {
    state: (state) => ipcRenderer.invoke('doc:state', state),
    extras: (path) => ipcRenderer.invoke('doc:extras', path),
    setExtras: (path, patch) => ipcRenderer.invoke('doc:extras-set', { path, patch }),
    onLoad: (fn) => on('doc:load', fn),
    onSaved: (fn) => on('doc:saved', fn),
    onMoved: (fn) => on('doc:moved', fn)
  },

  file: {
    new: () => ipcRenderer.invoke('file:new'),
    open: () => ipcRenderer.invoke('file:open'),
    openPath: (p) => ipcRenderer.invoke('file:open-path', p),
    save: (content, saveAs) => ipcRenderer.invoke('file:save', { content, saveAs: !!saveAs }),
    export: (payload) => ipcRenderer.invoke('file:export', payload),
    reveal: (p) => ipcRenderer.invoke('app:reveal', p)
  },

  home: {
    data: () => ipcRenderer.invoke('home:data'),
    open: (path) => ipcRenderer.invoke('home:open', path),
    create: (templateId) => ipcRenderer.invoke('home:create', templateId),
    browse: () => ipcRenderer.invoke('home:browse'),
    close: () => ipcRenderer.invoke('home:close'),
    show: () => ipcRenderer.invoke('win:home')
  },

  update: {
    check: (opts) => ipcRenderer.invoke('update:check', opts),
    open: (url) => ipcRenderer.invoke('update:open', url),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    installPacman: () => ipcRenderer.invoke('update:install-pacman'),
    installHomebrew: () => ipcRenderer.invoke('update:install-homebrew'),
    restart: () => ipcRenderer.invoke('update:restart'),
    onProgress: (fn) => on('update:progress', fn),
    onDownloaded: (fn) => on('update:downloaded', fn),
    onInstallProgress: (fn) => on('update:install-progress', fn)
  },

  lookup: {
    word: (w) => ipcRenderer.invoke('lookup:word', w),
    native: () => ipcRenderer.invoke('lookup:native')
  },

  menu: {
    describe: () => ipcRenderer.invoke('menu:describe'),
    invoke: (id) => ipcRenderer.invoke('menu:invoke', id)
  },
  music: {
    pick: () => ipcRenderer.invoke('music:pick'),
    openExternal: (url) => ipcRenderer.invoke('music:open-external', url),
    signIn: (partition) => ipcRenderer.invoke('music:sign-in', partition)
  },

  spell: {
    languages: () => ipcRenderer.invoke('spell:languages'),
    setLanguages: (langs) => ipcRenderer.invoke('spell:set-languages', langs)
  },

  backup: {
    list: (path) => ipcRenderer.invoke('backup:list', path),
    open: (file, sourcePath) => ipcRenderer.invoke('backup:open', { file, sourcePath }),
    snapshot: (path, content) => ipcRenderer.invoke('backup:snapshot', { path, content })
  },

  win: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    maximize: () => ipcRenderer.invoke('win:maximize'),
    close: () => ipcRenderer.invoke('win:close'),
    closeConfirmed: () => ipcRenderer.invoke('win:close-confirmed'),
    menu: (x, y) => ipcRenderer.invoke('win:menu', { x, y })
  },

  app: {
    info: () => ipcRenderer.invoke('app:info'),
    dropbox: () => ipcRenderer.invoke('app:dropbox'),
    moveToDropbox: (path) => ipcRenderer.invoke('dropbox:move', path)
  },

  onMenu: (fn) => on('menu', fn)
});
