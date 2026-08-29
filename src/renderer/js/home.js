import { applyTheme } from './themes.js';

const api = window.api;
const $ = (id) => document.getElementById(id);

const state = { view: 'recent', data: { recent: [], templates: [], samples: [] }, selected: null };

const STARTERS = [
  { id: 'novel', title: 'Start a Novel', sub: 'Title page and a first chapter',
    icon: '#i-book', colour: 'var(--primary)' },
  { id: 'chapter', title: 'Start a Chapter', sub: 'Just a heading and a blank page',
    icon: '#i-page', colour: 'var(--stat)' },
  { id: 'outline', title: 'Start an Outline', sub: 'Three acts, ready to fill in',
    icon: '#i-list', colour: 'var(--note)' }
];

function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v != null && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    node.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

function icon(href, cls = '') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  if (cls) svg.setAttribute('class', cls);
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', href);
  svg.append(use);
  return svg;
}

function whenLabel(time) {
  if (!time) return '';
  const date = new Date(time);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  if (sameDay) return 'Today';
  const yesterday = new Date(today.getTime() - 86400000);
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

/* ------------------------------------------------------------------ views */

function renderStarters() {
  const host = $('starters');
  host.textContent = '';
  for (const s of STARTERS) {
    host.append(el('button', { class: 'starter', onclick: () => api.home.create(s.id) },
      el('span', { class: 'starter-mark', style: `background:${s.colour}` }, icon(s.icon)),
      el('span', {},
        el('span', { class: 't' }, s.title),
        el('br'),
        el('span', { class: 's' }, s.sub))));
  }
}

function renderList() {
  const host = $('home-list');
  host.textContent = '';
  state.selected = null;
  $('home-open').disabled = true;

  if (state.view === 'recent') {
    if (!state.data.recent.length) {
      host.append(el('div', { class: 'home-empty' },
        'No documents yet. Start one on the left, or browse for a file.'));
      return;
    }
    for (const doc of state.data.recent) {
      host.append(el('button', {
        class: 'home-item',
        onclick: (e) => selectItem(e.currentTarget, { kind: 'file', path: doc.path }),
        ondblclick: () => api.home.open(doc.path)
      },
        el('span', { class: 'mark' }, icon('#i-doc')),
        el('span', { class: 'body' },
          el('span', { class: 't' }, doc.name),
          el('div', { class: 's' }, whenLabel(doc.time)))));
    }
    return;
  }

  const items = state.view === 'templates' ? state.data.templates : state.data.samples;
  for (const item of items) {
    host.append(el('button', {
      class: 'home-item',
      onclick: (e) => selectItem(e.currentTarget, { kind: 'template', id: item.id }),
      ondblclick: () => api.home.create(item.id)
    },
      el('span', { class: 'mark' }, icon(state.view === 'templates' ? '#i-page' : '#i-doc')),
      el('span', { class: 'body' },
        el('span', { class: 't' }, item.name),
        el('div', { class: 's' }, item.hint))));
  }
}

function selectItem(node, payload) {
  document.querySelectorAll('.home-item').forEach((n) => n.classList.remove('on'));
  node.classList.add('on');
  state.selected = payload;
  $('home-open').disabled = false;
}

function openSelected() {
  const sel = state.selected;
  if (!sel) return;
  if (sel.kind === 'file') api.home.open(sel.path);
  else api.home.create(sel.id);
}

/* ------------------------------------------------------------------- boot */

(async function boot() {
  const prefs = await api.prefs.get();
  applyTheme(prefs.theme || 'material');
  document.body.classList.add(api.platform === 'darwin' ? 'mac' : 'win');

  const info = await api.app.info();
  $('brand-version').textContent = `Version ${info.version}`;
  $('brand-foot').textContent = 'Plain text in, manuscript out.';
  if (api.platform !== 'darwin') $('new-key').textContent = 'Ctrl+N';

  state.data = await api.home.data();
  renderStarters();
  renderList();

  document.querySelectorAll('.home-tab').forEach((tab) => {
    tab.onclick = () => {
      document.querySelectorAll('.home-tab').forEach((t) => t.classList.remove('on'));
      tab.classList.add('on');
      state.view = tab.dataset.view;
      renderList();
    };
  });

  $('home-new').onclick = () => api.home.create('blank');
  $('home-browse').onclick = () => api.home.browse();
  $('home-open').onclick = openSelected;
  $('home-close').onclick = () => api.home.close();

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') api.home.close();
    if (e.key === 'Enter') openSelected();
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
      e.preventDefault();
      api.home.create('blank');
    }
  });
})();
