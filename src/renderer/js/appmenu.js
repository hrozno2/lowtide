/* The application menu, drawn by the app.
 *
 * On Windows and Linux the menu is ours to place, and the platform's own popup
 * arrives in the system's colours rather than the theme's — a white slab in a
 * dark editor. So the structure is read from the real menu and drawn here,
 * while the work is still done by the real menu: every row carries the id of
 * the item it stands for, and choosing one asks the main process to click it.
 * That keeps roles like Quit and Toggle Full Screen working, which no amount
 * of copied data would.
 *
 * Two shapes, chosen in Preferences:
 *   button — one popup off the title-bar button, the menus as sections
 *   bar    — File Edit Format View … along the title bar, as on a Mac
 */

import { h } from './panels.js';

const api = window.api;

let tree = null;          // the menu as data, fetched once
let openMenu = null;      // { root, el, index }

export async function loadMenu() {
  if (tree) return tree;
  try { tree = await api.menu.describe(); } catch { tree = []; }
  return tree;
}

/** The menu changes when the recent-documents list does. */
export function forgetMenu() { tree = null; }

function accelText(raw) {
  if (!raw) return '';
  return raw
    .replace(/CommandOrControl|CmdOrCtrl/g, api.platform === 'darwin' ? '⌘' : 'Ctrl')
    .replace(/Command|Cmd/g, '⌘')
    .replace(/Control|Ctrl/g, 'Ctrl')
    .replace(/Shift/g, '⇧')
    .replace(/Alt|Option/g, api.platform === 'darwin' ? '⌥' : 'Alt')
    .replace(/\+/g, api.platform === 'darwin' ? '' : '+');
}

function rowFor(item, close) {
  if (item.type === 'separator') return h('div', { class: 'menu-sep' });

  const row = h('button', {
    class: `menu-row${item.enabled ? '' : ' off'}${item.checked ? ' checked' : ''}`,
    disabled: item.enabled ? false : true,
    title: item.sublabel || ''
  },
    h('span', { class: 'menu-label' }, item.label),
    item.accelerator ? h('span', { class: 'menu-key' }, accelText(item.accelerator)) : null);

  if (item.enabled && item.id) {
    row.addEventListener('click', () => {
      close();
      api.menu.invoke(item.id);
    });
  }
  return row;
}

function closeOpen() {
  if (!openMenu) return;
  openMenu.el.remove();
  document.removeEventListener('pointerdown', openMenu.away, true);
  document.removeEventListener('keydown', openMenu.keys, true);
  const bar = document.getElementById('menubar');
  if (bar) bar.querySelectorAll('.menubar-item.on').forEach((b) => b.classList.remove('on'));
  openMenu = null;
}

export function menuIsOpen() { return !!openMenu; }
export { closeOpen as closeMenu };

function popup(items, anchor, { drill = false } = {}) {
  closeOpen();

  const el = h('div', { class: 'appmenu' });

  /* Every menu in one list runs to sixty-odd rows, which is a scroll, not a
     menu. So the button shows the menus and steps into the one you pick. */
  const draw = (list, backTo) => {
    el.textContent = '';
    if (backTo) {
      const back = h('button', { class: 'menu-row menu-back' },
        h('span', { class: 'menu-label' }, `\u2039  ${backTo}`));
      back.addEventListener('click', () => draw(items, null));
      el.append(back, h('div', { class: 'menu-sep' }));
    }
    for (const item of list) {
      if (drill && !backTo) {
        if (!item.submenu || !item.submenu.length) continue;
        const row = h('button', { class: 'menu-row' },
          h('span', { class: 'menu-label' }, item.label),
          h('span', { class: 'menu-key' }, '\u203a'));
        row.addEventListener('click', () => draw(item.submenu, item.label));
        el.append(row);
      } else {
        el.append(rowFor(item, closeOpen));
      }
    }
    size();
  };

  document.getElementById('panel-host').append(el);

  const size = () => {
    const r = anchor.getBoundingClientRect();
    const margin = 8;
    const w = el.offsetWidth;
    const left = Math.min(Math.max(margin, r.left), window.innerWidth - w - margin);
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(r.bottom + 4)}px`;
    el.style.maxHeight = `${Math.round(window.innerHeight - r.bottom - 16)}px`;
  };

  draw(items, null);

  const away = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) closeOpen(); };
  const keys = (e) => { if (e.key === 'Escape') { e.preventDefault(); closeOpen(); } };
  document.addEventListener('pointerdown', away, true);
  document.addEventListener('keydown', keys, true);

  openMenu = { el, away, keys, anchor };
  return el;
}

/** The title-bar button: every menu in one list, under its own heading. */
export async function showAppMenu(anchor) {
  if (openMenu && openMenu.anchor === anchor) { closeOpen(); return; }
  const items = await loadMenu();
  const usable = items.filter((t) => t.submenu && t.submenu.length);
  if (!usable.length) return;
  popup(usable, anchor, { drill: true });
}

/** The menu bar: one dropdown per top-level entry. */
export async function renderMenuBar() {
  const bar = document.getElementById('menubar');
  if (!bar) return;
  bar.textContent = '';

  const items = await loadMenu();
  for (const top of items) {
    if (!top.submenu || !top.submenu.length) continue;
    const btn = h('button', { class: 'menubar-item' }, top.label);

    btn.addEventListener('click', () => {
      const wasOpen = openMenu && openMenu.anchor === btn;
      closeOpen();
      if (wasOpen) return;
      btn.classList.add('on');
      popup(top.submenu, btn);
    });

    // Once one is open, sliding across opens the next, as a menu bar should.
    btn.addEventListener('pointerenter', () => {
      if (!openMenu || openMenu.anchor === btn) return;
      closeOpen();
      btn.classList.add('on');
      popup(top.submenu, btn);
    });

    bar.append(btn);
  }
}
