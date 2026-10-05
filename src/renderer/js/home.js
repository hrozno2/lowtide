import { applyTheme } from './themes.js';
import { coverFor } from './covers.js';

const api = window.api;
const $ = (id) => document.getElementById(id);

const state = { view: 'shelf', data: { recent: [], shelves: [], templates: [], samples: [] },
                selected: null, dragging: null };

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

/* ------------------------------------------------------------------ shelf */

/* Covers are drawn from the document's own path, so a book looks the same on
   every machine with nothing stored and nothing fetched. See covers.js. */

function bookTile(book, shelfId) {
  const tile = el('button', {
    class: 'book',
    draggable: 'true',
    title: `${book.title}${book.author ? ' — ' + book.author : ''}\n${book.path}`,
    onclick: (e) => selectItem(e.currentTarget, { kind: 'file', path: book.path }),
    ondblclick: () => api.home.open(book.path),
    oncontextmenu: (e) => { e.preventDefault(); forget(tile, book); }
  });
  tile.dataset.path = book.path;
  tile.dataset.shelf = shelfId;

  const art = el('span', { class: 'book-cover', html: coverFor(book) });
  tile.append(art);

  /* The goal belongs to the document, so a book on the shelf can show how far
     along it is without opening it. */
  const goal = book.goal && Number(book.goal.target) > 0 ? book.goal : null;
  if (goal) {
    const done = Math.max(0, Math.min(1, (Number(goal.achieved) || 0) / Number(goal.target)));
    tile.append(el('span', { class: 'book-progress', title: `${Math.round(done * 100)}% of ${goal.target.toLocaleString()}` },
      el('span', { class: 'book-progress-fill', style: `width:${(done * 100).toFixed(1)}%` })));
  }

  tile.append(el('span', { class: 'book-when' }, whenLabel(book.time)));

  tile.addEventListener('dragstart', (e) => {
    state.dragging = { path: book.path, from: shelfId };
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', book.path);
    tile.classList.add('dragging');
  });
  tile.addEventListener('dragend', () => { state.dragging = null; tile.classList.remove('dragging'); clearMarks(); });
  return tile;
}

function clearMarks() {
  document.querySelectorAll('.book-drop').forEach((n) => n.remove());
  document.querySelectorAll('.shelf.over').forEach((n) => n.classList.remove('over'));
}

/* Where in this row the book would land, by the gaps between the covers. */
function dropIndex(row, x) {
  const tiles = [...row.querySelectorAll('.book:not(.dragging)')];
  for (let i = 0; i < tiles.length; i++) {
    const r = tiles[i].getBoundingClientRect();
    if (x < r.left + r.width / 2) return i;
  }
  return tiles.length;
}

function shelfSection(shelf) {
  const sec = el('section', { class: 'shelf' });
  sec.dataset.shelfId = shelf.id;

  const head = el('div', { class: 'shelf-head' });
  const grip = el('span', { class: 'shelf-grip', draggable: 'true', title: 'Drag to reorder shelves' }, '⠿');
  const name = el('span', {
    class: 'shelf-name', role: 'button', tabindex: '0',
    title: 'Click to rename',
    onclick: () => rename(sec, shelf),
    onkeydown: (e) => { if (e.key === 'Enter') rename(sec, shelf); }
  }, shelf.name);
  head.append(grip, name, el('span', { class: 'shelf-count' },
    shelf.books.length ? `${shelf.books.length}` : ''));
  if (state.data.shelves.length > 1) {
    head.append(el('button', {
      class: 'text-btn shelf-remove', title: 'Remove this shelf — its books move to the first one',
      onclick: async () => { state.data.shelves = await api.home.shelf.remove(shelf.id); renderShelves(); }
    }, 'Remove'));
  }
  sec.append(head);

  const row = el('div', { class: 'shelf-row' });
  for (const book of shelf.books) row.append(bookTile(book, shelf.id));
  if (!shelf.books.length) {
    row.append(el('div', { class: 'shelf-empty' }, 'Drag a book here, or start one on the left.'));
  }
  sec.append(row);

  /* Books land where they are dropped, with a bar showing where that is. */
  row.addEventListener('dragover', (e) => {
    if (!state.dragging) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    sec.classList.add('over');
    const mark = document.querySelector('.book-drop') || el('div', { class: 'book-drop' });
    const tiles = [...row.querySelectorAll('.book:not(.dragging)')];
    const at = dropIndex(row, e.clientX);
    row.insertBefore(mark, tiles[at] || null);
  });
  row.addEventListener('dragleave', (e) => {
    if (!row.contains(e.relatedTarget)) sec.classList.remove('over');
  });
  row.addEventListener('drop', async (e) => {
    if (!state.dragging) return;
    e.preventDefault();
    const at = dropIndex(row, e.clientX);
    const moving = state.dragging;
    clearMarks();
    state.dragging = null;
    state.data.shelves = await api.home.shelf.moveBook(moving.path, shelf.id, at);
    renderShelves();
  });

  // whole shelves reorder by their grip
  grip.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('application/x-lowtide-shelf', shelf.id);
    e.dataTransfer.effectAllowed = 'move';
    sec.classList.add('dragging');
  });
  grip.addEventListener('dragend', () => sec.classList.remove('dragging'));
  return sec;
}

function renderShelves() {
  const host = $('home-shelves');
  host.textContent = '';
  state.selected = null;
  $('home-open').disabled = true;

  const shelves = state.data.shelves || [];
  if (!shelves.length || !shelves.some((s) => s.books.length)) {
    host.append(el('div', { class: 'home-empty' },
      'No documents yet. Start one on the left, or browse for a file.'));
    return;
  }
  for (const shelf of shelves) host.append(shelfSection(shelf));
}

/* Renaming happens in place. Electron has no window.prompt — it is not
   implemented and simply returns null — so a dialog here would be a button
   that quietly does nothing. */
function rename(sec, shelf) {
  const label = sec.querySelector('.shelf-name');
  if (!label || sec.querySelector('.shelf-rename')) return;
  const input = el('input', { class: 'shelf-rename', type: 'text', value: shelf.name, spellcheck: 'false' });
  label.replaceWith(input);
  input.focus();
  input.select();

  let done = false;
  const finish = async (keep) => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    if (keep && name && name !== shelf.name) {
      state.data.shelves = await api.home.shelf.rename(shelf.id, name);
    }
    renderShelves();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    e.stopPropagation();          // Escape here closes the field, not Home
  });
  input.addEventListener('blur', () => finish(true));
}

/* Taking a book off the shelf only forgets where it was; the file is not
   touched. Still worth a confirmation, because a right-click is easy to do by
   accident — asked on the tile itself rather than in a dialog. */
function forget(tile, book) {
  if (tile.querySelector('.book-ask')) return;
  const ask = el('span', { class: 'book-ask' },
    el('span', { class: 'book-ask-t' }, 'Off the shelf?'),
    el('button', { class: 'text-btn', onclick: async (e) => {
      e.stopPropagation();
      state.data.shelves = await api.home.shelf.forget(book.path);
      state.data.recent = state.data.recent.filter((r) => r.path !== book.path);
      renderShelves();
    } }, 'Yes'),
    el('button', { class: 'text-btn', onclick: (e) => { e.stopPropagation(); ask.remove(); } }, 'No'));
  tile.append(ask);
}

/** Whichever of the two the tabs have chosen. */
function render() {
  const onShelf = state.view === 'shelf';
  $('home-shelves').hidden = !onShelf;
  $('home-list').hidden = onShelf;
  $('shelf-add').hidden = !onShelf;
  if (onShelf) renderShelves(); else renderList();
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
  state.view = prefs.homeView === 'list' ? 'recent' : 'shelf';
  document.querySelectorAll('.home-tab').forEach((t) =>
    t.classList.toggle('on', t.dataset.view === state.view));
  renderStarters();
  render();

  document.querySelectorAll('.home-tab').forEach((tab) => {
    tab.onclick = () => {
      document.querySelectorAll('.home-tab').forEach((t) => t.classList.remove('on'));
      tab.classList.add('on');
      state.view = tab.dataset.view;
      // which of the two you were last on is remembered; the rest are a look
      if (state.view === 'shelf' || state.view === 'recent') {
        api.prefs.set({ homeView: state.view === 'shelf' ? 'shelf' : 'list' });
      }
      render();
    };
  });

  /* A new shelf arrives named and ready to be renamed, rather than asking
     first: it is one less step, and the name is the only thing to say. */
  $('shelf-add').onclick = async () => {
    state.data.shelves = await api.home.shelf.add('New shelf');
    renderShelves();
    const last = state.data.shelves[state.data.shelves.length - 1];
    const sec = document.querySelector(`.shelf[data-shelf-id="${last.id}"]`);
    if (sec) { sec.scrollIntoView({ block: 'nearest' }); rename(sec, last); }
  };

  /* A shelf dragged by its grip lands between the shelves it was dropped
     between; the whole column is the target, so there is no narrow strip to
     hit. */
  const shelvesHost = $('home-shelves');
  shelvesHost.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes('application/x-lowtide-shelf')) return;
    e.preventDefault();
    const mark = document.querySelector('.shelf-drop') || el('div', { class: 'shelf-drop' });
    const others = [...shelvesHost.querySelectorAll('.shelf:not(.dragging)')];
    const at = others.find((sec) => {
      const r = sec.getBoundingClientRect();
      return e.clientY < r.top + r.height / 2;
    });
    shelvesHost.insertBefore(mark, at || null);
  });
  shelvesHost.addEventListener('drop', async (e) => {
    const id = e.dataTransfer.getData('application/x-lowtide-shelf');
    if (!id) return;
    e.preventDefault();
    const mark = document.querySelector('.shelf-drop');
    let index = 0;
    for (const child of shelvesHost.children) {
      if (child === mark) break;
      if (child.classList.contains('shelf') && !child.classList.contains('dragging')) index++;
    }
    if (mark) mark.remove();
    state.data.shelves = await api.home.shelf.move(id, index);
    renderShelves();
  });

  /* Drop a manuscript on the window to open it. The whole window is the
     target — there is nothing on Home you could be trying to drop onto
     instead — and it lights up while a file is over it so that is clear. */
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    document.body.classList.add('dropping');
  });
  window.addEventListener('dragleave', (e) => {
    if (!e.relatedTarget) document.body.classList.remove('dropping');
  });
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    document.body.classList.remove('dropping');
    for (const file of e.dataTransfer.files) {
      const p = api.file.pathOf(file);
      if (p && /\.(fountain|txt|md|markdown)$/i.test(p)) api.home.open(p);
    }
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
