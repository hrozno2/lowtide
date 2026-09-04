/* Lightweight panel system: one panel at a time.
 *
 * Panels open as a sheet down the right rather than over the middle of the
 * window, and the workspace gives up the width to make room, so nothing ever
 * covers the line being written. They close on Esc, on Done, or on a click
 * anywhere outside — including back in the text, which is usually what the
 * next click is for. */

const host = () => document.getElementById('panel-host');
const scrim = () => document.getElementById('scrim');

let current = null;

export function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

let outsideCloser = null;

/* Panels that must not be rebuilt when they close. The music pane holds a
   <webview>; removing it from the document destroys the guest and takes
   whatever is playing with it. These are hidden instead and handed back the
   next time they are asked for. */
const kept = new Map();

/* The control the panel came out of, so it can be pointed at and so clicking
   it again closes rather than reopens. */
let lastTrigger = null;
let lastTriggerAt = 0;
document.addEventListener('pointerdown', (e) => {
  const el = e.target && e.target.closest
    ? e.target.closest('.icon-btn, .text-btn, .btn, .goal-face, .side-tab, .vs-btn')
    : null;
  if (el) { lastTrigger = el; lastTriggerAt = Date.now(); }
}, true);

/* A panel opened from the keyboard or the menu bar has no click to hang off,
   so each one knows the control it belongs to. Without this those panels fall
   back to the middle of the window, which is the thing we are trying to stop
   happening. */
const ANCHOR_BY_NAME = {
  prefs: 'btn-prefs',
  sprint: 'btn-sprint',
  theme: 'btn-theme',
  export: 'btn-export',
  goal: 'goal-face',
  revision: 'rev-new',
  'revision-menu': 'rev-new',
  goto: 'btn-navigator',
  backups: 'btn-home',
  help: 'btn-prefs'
};

function anchorFor(name, explicit) {
  if (explicit && document.contains(explicit)) return explicit;

  // A click from a moment ago is the best answer; an older one is unrelated.
  if (lastTrigger && document.contains(lastTrigger) && Date.now() - lastTriggerAt < 1500) {
    return lastTrigger;
  }
  const byName = document.getElementById(ANCHOR_BY_NAME[name] || '');
  if (byName && byName.offsetParent !== null) return byName;

  // Anything else hangs off the toolbar, which keeps it clear of the page.
  const toolbar = document.getElementById('tb-buttons');
  return toolbar && toolbar.offsetParent !== null ? toolbar : null;
}

/* Set when a panel is dismissed by clicking the very control that opened it.
   Without this the click closes the panel on the way down and the button's own
   handler opens it again on the way up, so it never appears to toggle. */
let suppress = null;

function stopWatchingOutside() {
  if (!outsideCloser) return;
  document.removeEventListener('pointerdown', outsideCloser, true);
  outsideCloser = null;
}

export function closePanel() {
  if (!current) return;
  stopWatchingOutside();
  if (current.persist) {
    /* Parked, not removed. It keeps its place in the document — moving a
       <webview> destroys the guest — but it gives up the .panel class while
       it is away, so that looking for "the panel that is open" cannot find
       this one sitting behind the one that is. */
    current.el.hidden = true;
    current.el.classList.remove('panel');
    current.el.classList.add('panel-parked');
  } else {
    current.el.remove();
  }
  scrim().hidden = true;
  document.body.classList.remove('panel-open');
  const after = current.onClose;
  current = null;
  if (after) after();
}

/* Sits the panel under whatever opened it, kept inside the window, with the
   nub pointing back at the control. */
const SVG_NS = 'http://www.w3.org/2000/svg';

/* The bump on the top edge, pointing back at the button. Drawn as an open
   path so the fill closes flat along its base while the stroke follows only
   the curve; the little rectangle then covers the card's own border where the
   bump meets it, so the outline reads as one continuous line. */
function makeNub() {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'panel-nub');
  svg.setAttribute('viewBox', '0 0 56 20');
  svg.setAttribute('aria-hidden', 'true');

  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', 'M0,19 C13,19 15.5,4 28,4 C40.5,4 43,19 56,19');
  svg.append(path);

  const cover = document.createElementNS(SVG_NS, 'rect');
  cover.setAttribute('x', '3');
  cover.setAttribute('y', '18');
  cover.setAttribute('width', '50');
  cover.setAttribute('height', '3');
  svg.append(cover);

  return svg;
}

function place(el, anchor) {
  const gap = 9;
  const margin = 10;
  const r = anchor.getBoundingClientRect();
  const w = el.offsetWidth;
  const h = el.offsetHeight;

  let left = r.right - w;                                  // right edges line up
  left = Math.max(margin, Math.min(left, window.innerWidth - w - margin));

  let top = r.bottom + gap;
  if (top + h > window.innerHeight - margin) {
    top = Math.max(margin, window.innerHeight - h - margin);
  }

  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;

  // Where the bump sits along the top edge.
  const centre = Math.min(Math.max(r.left + r.width / 2 - left, 30), w - 30);
  el.style.setProperty('--nub-x', `${Math.round(centre)}px`);
  if (!el.querySelector('.panel-nub')) el.append(makeNub());
  el.classList.remove('centred');
}

/** The kept element for a panel, if it has been built already. */
export function keptPanel(name) { return kept.get(name) || null; }

export function openPanel(name, el, { onClose, focus, anchor, persist = false } = {}) {
  // Clicking the button of the panel that is already open just closes it.
  if (suppress && suppress.name === name && Date.now() - suppress.at < 400) {
    suppress = null;
    return null;
  }
  suppress = null;
  if (panelIsOpen(name)) { closePanel(); return null; }

  closePanel();
  const trigger = anchorFor(name, anchor);

  let node = el;
  if (persist) {
    const already = kept.get(name);
    if (already && already.isConnected) node = already;
    else { kept.set(name, el); host().append(el); }
    node.hidden = false;
    node.classList.remove('panel-parked');
    node.classList.add('panel');
  } else {
    host().append(node);
  }

  current = { name, el: node, onClose, trigger, persist };

  // Measuring needs the element laid out, so this comes after unhiding.
  if (trigger) place(node, trigger);
  else node.classList.add('centred');

  /* Wait a frame before listening, or the very click that opened the panel
     closes it again. */
  requestAnimationFrame(() => {
    if (!current || current.el !== node) return;
    outsideCloser = (e) => {
      if (node.contains(e.target)) return;
      if (current.trigger && current.trigger.contains(e.target)) {
        suppress = { name: current.name, at: Date.now() };
      }
      closePanel();
    };
    document.addEventListener('pointerdown', outsideCloser, true);
  });

  if (focus) requestAnimationFrame(() => focus.focus());
  return node;
}

export function panelIsOpen(name) { return !!current && (!name || current.name === name); }

export function panelShell(title, body, foot) {
  return h('div', { class: 'panel' },
    h('div', { class: 'panel-head' }, h('span', {}, title),
      h('button', { class: 'text-btn', onclick: closePanel }, 'Done')),
    h('div', { class: 'panel-body' }, body),
    foot ? h('div', { class: 'panel-foot' }, foot) : null);
}

/* ------------------------------------------------------------------- toast */

let toastTimer = null;
export function toast(message, ms = 2200) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

/* ------------------------------------------------------------- preferences */

/** Reorder and hide the buttons at the top right. */
function toolbarEditor(ctx) {
  const host = h('div', {});

  const draw = () => {
    const items = ctx.toolbar.items();
    const hidden = new Set(ctx.toolbar.hidden());
    host.textContent = '';

    items.forEach((item, i) => {
      const move = (delta) => {
        const order = items.map((x) => x.id);
        const j = i + delta;
        if (j < 0 || j >= order.length) return;
        [order[i], order[j]] = [order[j], order[i]];
        ctx.toolbar.setOrder(order);
        draw();
      };

      const row = h('div', {
        class: `tb-row ${item.pinned ? 'pinned' : ''}`,
        draggable: !item.pinned,
        ondragstart: (e) => {
          e.dataTransfer.setData('text/plain', item.id);
          row.classList.add('dragging');
        },
        ondragend: () => row.classList.remove('dragging'),
        ondragover: (e) => e.preventDefault(),
        ondrop: (e) => {
          e.preventDefault();
          const moved = e.dataTransfer.getData('text/plain');
          if (!moved || moved === item.id) return;
          const order = items.map((x) => x.id).filter((id) => id !== moved);
          order.splice(order.indexOf(item.id), 0, moved);
          ctx.toolbar.setOrder(order);
          draw();
        }
      },
        h('span', { class: 'grip' }, '\u2261'),
        h('span', { class: 'label' }, item.title),
        h('button', { class: 'move', title: 'Move left', disabled: i === 0,
                      onclick: () => move(-1) }, '\u2191'),
        h('button', { class: 'move', title: 'Move right', disabled: i === items.length - 1,
                      onclick: () => move(1) }, '\u2193'),
        item.pinned
          ? h('span', { class: 'val' }, 'always')
          : toggle(!hidden.has(item.id), (on) => {
              const next = new Set(hidden);
              if (on) next.delete(item.id); else next.add(item.id);
              ctx.toolbar.setHidden([...next]);
            }));
      host.append(row);
    });
  };

  draw();
  return host;
}

/** Multi-select of the dictionaries Chromium can download. */
function languagePicker(ctx) {
  const spelling = ctx.spelling || { available: [], current: [] };
  const chosen = new Set(spelling.current || []);
  const select = h('select', {
    multiple: true, size: 4, style: 'width:170px; height:88px',
    onchange: (e) => {
      const langs = [...e.target.selectedOptions].map((o) => o.value);
      ctx.setLanguages(langs);
    }
  });
  const common = ['en-US', 'en-GB', 'de', 'fr', 'es', 'it', 'nl', 'pt-BR', 'pl', 'sk', 'cs', 'hu'];
  const ordered = (spelling.available || []).slice().sort((a, b) => {
    const ai = common.indexOf(a); const bi = common.indexOf(b);
    if (ai !== -1 || bi !== -1) return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    return a.localeCompare(b);
  });
  for (const lang of ordered) {
    select.append(h('option', { value: lang, selected: chosen.has(lang) }, lang));
  }
  return select;
}

function row(label, hint, control) {
  return h('div', { class: 'row' },
    h('div', {}, h('div', {}, label), hint ? h('span', { class: 'hint' }, hint) : null),
    h('div', { class: 'ctl' }, control));
}

function slider(value, min, max, step, format, onInput) {
  const out = h('span', { class: 'val' }, format(value));
  const input = h('input', {
    type: 'range', min, max, step, value,
    oninput: (e) => { const v = parseFloat(e.target.value); out.textContent = format(v); onInput(v); }
  });
  return [input, out];
}

function segmented(options, value, onPick) {
  const wrap = h('div', { class: 'seg' });
  options.forEach(([val, label]) => {
    const b = h('button', { class: val === value ? 'on' : '', onclick: () => {
      wrap.querySelectorAll('button').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      onPick(val);
    } }, label);
    wrap.append(b);
  });
  return wrap;
}

function toggle(value, onPick) {
  const b = h('button', { class: `switch ${value ? 'on' : ''}` });
  b.addEventListener('click', () => {
    const next = !b.classList.contains('on');
    b.classList.toggle('on', next);
    onPick(next);
  });
  return b;
}

export function showPreferences(ctx) {
  const p = ctx.prefs;
  const set = ctx.setPrefs;

  const body = h('div', {},
    row('Typeface', null, h('select', {
      onchange: (e) => set({ fontFamily: e.target.value })
    }, ...[['serif', 'Serif'], ['sans', 'Sans'], ['mono', 'Typewriter']].map(([v, l]) =>
      h('option', { value: v, selected: p.fontFamily === v }, l)))),

    row('Text size', null, slider(p.fontSize, 13, 30, 1, (v) => `${v}px`,
      (v) => set({ fontSize: v }))),

    row('Line spacing', null, slider(p.lineHeight, 1.2, 2.4, 0.05, (v) => v.toFixed(2),
      (v) => set({ lineHeight: v }))),

    row('Column width', null, slider(p.pageWidth, 460, 1100, 10, (v) => `${v}px`,
      (v) => set({ pageWidth: v }))),

    row('Paragraphs', 'How body text is laid out', segmented(
      [['none', 'Plain'], ['indent', 'Indented'], ['spaced', 'Spaced']], p.paragraphStyle || 'none',
      (v) => set({ paragraphStyle: v }))),

    row('Focus scope', 'What stays lit in Focus Mode', segmented(
      [['paragraph', 'Paragraph'], ['line', 'Line']], p.focusScope,
      (v) => set({ focusScope: v }))),

    row('Typewriter scrolling', 'Keep the caret centred', toggle(p.typewriter,
      (v) => set({ typewriter: v }))),

    row('Smart punctuation', 'Curly quotes, — and …', toggle(p.smartTypography !== false,
      (v) => set({ smartTypography: v }))),

    row('Check spelling', null, toggle(p.spellcheck !== false, (v) => set({ spellcheck: v }))),

    row('Dictionary', ctx.spelling && ctx.spelling.managedByOS
      ? 'macOS uses the languages set in System Settings'
      : 'Right-click a misspelling for corrections',
      ctx.spelling && ctx.spelling.managedByOS
        ? h('span', { class: 'val' }, 'System')
        : languagePicker(ctx)),

    row('Status bar', null, toggle(p.statusBar !== false, (v) => set({ statusBar: v }))),

    h('div', { class: 'theme-group' }, 'Toolbar'),
    toolbarEditor(ctx),

    h('div', { class: 'theme-group' }, 'Page layout'),

    row('Trim size', 'The first two are book trims; Letter and A4 are manuscript paper',
      segmented([['6x9', '6×9'], ['5.5x8.5', '5½×8½'], ['letter', 'Letter'], ['a4', 'A4']],
        p.pageSize || '6x9', (v) => set({ pageSize: v }))),

    row('Margins', null, slider(p.printMargin || 0.75, 0.5, 1.5, 0.05, (v) => `${v.toFixed(2)}"`,
      (v) => set({ printMargin: v }))),

    row('Print type size', null, slider(p.printFontSize || 12, 9, 16, 0.5, (v) => `${v}pt`,
      (v) => set({ printFontSize: v }))),

    row('Print leading', 'Book typesetting runs 120–145% of the type size',
      slider(p.printLeading || 1.4, 1.2, 2.4, 0.05,
      (v) => v.toFixed(2), (v) => set({ printLeading: v }))),

    row('Justify text', null, toggle(p.printJustify !== false, (v) => set({ printJustify: v }))),

    row('YouTube in the music pane', 'Off means no browser view at all',
      toggle(p.youtubeEnabled !== false, (v) => set({ youtubeEnabled: v }))),
    row('Hide the distractions', 'Comments, likes, recommendations and the shorts bar',
      toggle(p.youtubeMinimal !== false, (v) => set({ youtubeMinimal: v }))),

    ...(ctx.platform === 'darwin' ? [] : [
      row('Menu', 'A button in the title bar, or the menus written out along it',
        segmented([['button', 'Button'], ['bar', 'Menu bar']],
          p.menuStyle === 'bar' ? 'bar' : 'button', (v) => set({ menuStyle: v })))
    ]),

    row('Check for updates on launch', 'Asks GitHub for the newest release; installs nothing',
      toggle(p.updateCheck !== false, (v) => set({ updateCheck: v }))),

    row('Look up words online', 'Sends only the word, to dictionaryapi.dev and datamuse.com',
      toggle(p.onlineLookup !== false, (v) => set({ onlineLookup: v }))),

    h('div', { class: 'theme-group' }, 'Files'),

    row('Save new documents to', ctx.dropbox || 'Dropbox folder not found',
      segmented([['documents', 'Documents'], ['dropbox', 'Dropbox']],
        p.saveTo || 'documents',
        (v) => set({ saveTo: ctx.dropbox ? v : 'documents' }))),

    h('div', { class: 'theme-group' }, 'Other'),

    row('Reading speed', 'Words per minute', h('input', {
      type: 'number', min: 100, max: 600, step: 25, value: p.readingSpeed || 275,
      style: 'width:74px',
      onchange: (e) => set({ readingSpeed: Math.max(100, Math.min(600, +e.target.value || 275)) })
    }))
  );

  openPanel('prefs', panelShell('Preferences', body));
}

/* ------------------------------------------------------------------ sprint */

export function showSprint(ctx) {
  const sprint = ctx.sprint;
  const state = sprint.state();

  if (state.running) {
    const body = h('div', { class: 'sprint-face' },
      h('div', { class: 'sprint-clock', id: 'sprint-clock' }, sprint.clock()),
      h('div', { class: 'sprint-sub', id: 'sprint-sub' }, sprint.subtitle()));
    const panel = panelShell('Sprint', body, [
      h('button', { class: 'btn', onclick: () => { sprint.stop(); closePanel(); } }, 'Stop')
    ]);
    openPanel('sprint', panel, { onClose: () => sprint.setTick(null) });
    sprint.setTick(() => {
      const c = document.getElementById('sprint-clock');
      const s = document.getElementById('sprint-sub');
      if (c) c.textContent = sprint.clock();
      if (s) s.textContent = sprint.subtitle();
    });
    return;
  }

  let minutes = ctx.prefs.sprintMinutes || 15;
  let goal = ctx.prefs.sprintGoal || 0;

  const presets = h('div', { class: 'sprint-presets' });
  const mkPreset = (m) => h('button', { class: `btn ${m === minutes ? 'primary' : ''}`, onclick: () => {
    minutes = m;
    presets.querySelectorAll('button').forEach((b) => b.classList.remove('primary'));
    presets.querySelectorAll('button')[[5, 10, 15, 25, 45].indexOf(m)].classList.add('primary');
    clock.textContent = `${String(m).padStart(2, '0')}:00`;
  } }, `${m}m`);
  [5, 10, 15, 25, 45].forEach((m) => presets.append(mkPreset(m)));

  const clock = h('div', { class: 'sprint-clock' }, `${String(minutes).padStart(2, '0')}:00`);

  const body = h('div', {},
    h('div', { class: 'sprint-face' }, clock,
      h('div', { class: 'sprint-sub' }, 'Write without stopping.')),
    presets,
    row('Word goal', 'Optional — 0 for none', h('input', {
      type: 'number', min: 0, max: 5000, step: 50, value: goal, style: 'width:84px',
      onchange: (e) => { goal = Math.max(0, +e.target.value || 0); }
    })));

  const panel = panelShell('Sprint', body, [
    h('button', { class: 'btn', onclick: closePanel }, 'Cancel'),
    h('button', { class: 'btn primary', onclick: () => {
      ctx.setPrefs({ sprintMinutes: minutes, sprintGoal: goal });
      sprint.start(minutes, goal);
      closePanel();
    } }, 'Start')
  ]);
  openPanel('sprint', panel);
}

/* ------------------------------------------------------------------ themes */

export function showThemes(ctx) {
  const { THEMES, swatches } = ctx.themes;
  const current = ctx.prefs.theme || 'material';
  const body = h('div', {});

  for (const dark of [false, true]) {
    body.append(h('div', { class: 'theme-group' }, dark ? 'Dark' : 'Light'));
    for (const theme of THEMES.filter((t) => !!t.dark === dark)) {
      const chips = h('span', { class: 'theme-chips' },
        ...swatches(theme).map((c) => h('i', { style: `background:${c}` })));
      body.append(h('button', {
        class: `theme-row ${theme.id === current ? 'on' : ''}`,
        onclick: (e) => {
          body.querySelectorAll('.theme-row').forEach((r) => r.classList.remove('on'));
          e.currentTarget.classList.add('on');
          ctx.setPrefs({ theme: theme.id });
        }
      }, h('span', {}, theme.name), chips));
    }
  }

  openPanel('theme', panelShell('Editor Theme', body));
}

/* --------------------------------------------------------------- revisions */

export function showNewRevision(ctx) {
  const colours = ctx.revisionColours;
  const used = new Set((ctx.prefs.__usedColours || []));
  let picked = (colours.find((c) => !used.has(c.id)) || colours[0]).id;

  const input = h('input', { type: 'text', placeholder: 'Revision name',
                             class: 'filter-input', value: '' });

  const swatchRow = h('div', { class: 'rev-swatches' });
  colours.forEach((c) => {
    const b = h('button', {
      class: `rev-swatch ${c.id === picked ? 'on' : ''}`,
      style: `background:${c.hex}`, title: c.name,
      onclick: () => {
        picked = c.id;
        swatchRow.querySelectorAll('.rev-swatch').forEach((x) => x.classList.remove('on'));
        b.classList.add('on');
        if (!input.value.trim()) input.value = c.name;
      }
    });
    swatchRow.append(b);
  });

  const create = () => {
    const name = input.value.trim() ||
      colours.find((c) => c.id === picked).name;
    ctx.addRevision(name, picked);
    closePanel();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });

  const body = h('div', {}, input, swatchRow,
    h('div', { class: 'hint', style: 'margin-top:10px' },
      'While a revision is selected, everything you type is marked in its colour.'));

  openPanel('revision', panelShell('New Revision', body, [
    h('button', { class: 'btn', onclick: closePanel }, 'Cancel'),
    h('button', { class: 'btn primary', onclick: create }, 'Create')
  ]), { focus: input });
}

/* -------------------------------------------------------------------- goal */

export function showGoal(ctx) {
  const types = ctx.goalTypes;
  let type = 'new-words';

  const input = h('input', {
    type: 'number', min: 1, max: 200000, step: 10, value: 500,
    class: 'filter-input', style: 'text-align:center; font-size:17px'
  });

  const select = h('select', { style: 'width:100%',
    onchange: (e) => { type = e.target.value; } },
    ...types.map((t) => h('option', { value: t.id }, t.label.replace(/^./, (c) => c.toUpperCase()))));

  const presets = h('div', { class: 'sprint-presets' });
  [250, 500, 1000, 1667].forEach((n) => {
    presets.append(h('button', { class: 'btn', onclick: () => { input.value = n; } }, n.toLocaleString()));
  });

  const create = () => {
    const target = Math.max(1, +input.value || 0);
    ctx.startGoal(type, target);
    closePanel();
  };
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') create(); });

  const body = h('div', {},
    h('div', { class: 'sprint-sub', style: 'text-align:center;margin-bottom:10px' },
      'What are you aiming for?'),
    input,
    h('div', { style: 'margin-top:10px' }, select),
    presets);

  openPanel('goal', panelShell('New Goal', body, [
    h('button', { class: 'btn', onclick: closePanel }, 'Cancel'),
    h('button', { class: 'btn primary', onclick: create }, 'Set Goal')
  ]), { focus: input });
}

/* ------------------------------------------------------------ revision menu */

export function showRevisionMenu(ctx) {
  const rev = ctx.revision;
  const marked = ctx.marked;

  const item = (label, hint, onclick, cls = '') =>
    h('button', { class: `menu-item ${cls}`, onclick: () => { onclick(); closePanel(); } },
      h('span', {}, label), h('span', { class: 's' }, hint));

  const body = h('div', { class: 'menu-list' },
    item(rev.hidden ? 'Show marks' : 'Hide marks',
         rev.hidden ? 'Colour this revision again' : 'Keep the marks, stop showing them',
         ctx.toggleVisible),
    item('Apply', marked ? 'Keep the text, clear the colour' : 'Nothing marked',
         ctx.apply),
    item('Revert changes',
         marked ? `Delete the ${marked.toLocaleString()} character${marked === 1 ? '' : 's'} it added` : 'Nothing marked',
         ctx.revert, 'danger'),
    item('Delete revision', 'Remove it from the list; the text stays', ctx.remove, 'danger'));

  openPanel('revision-menu', panelShell(rev.name, body));
}

/* -------------------------------------------------------------------- goto */

export function showGoto(ctx) {
  const items = ctx.outline();
  if (!items.length) { toast('No chapters yet — start a line with #'); return; }

  let filtered = items;
  let sel = 0;

  const list = h('div', { class: 'goto-list' });
  const input = h('input', {
    class: 'filter-input', type: 'text', placeholder: 'Go to chapter…',
    oninput: (e) => { apply(e.target.value); }
  });

  function render() {
    list.textContent = '';
    filtered.forEach((item, i) => {
      list.append(h('button', {
        class: `goto-item lvl-${item.level} ${i === sel ? 'sel' : ''}`,
        onclick: () => { ctx.goto(item); closePanel(); }
      }, h('span', {}, item.title), h('span', { class: 'count' }, `${item.words.toLocaleString()}`)));
    });
    const active = list.children[sel];
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  function apply(query) {
    const q = query.trim().toLowerCase();
    filtered = q ? items.filter((i) => i.title.toLowerCase().includes(q)) : items;
    sel = 0;
    render();
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, filtered.length - 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); render(); e.preventDefault(); }
    else if (e.key === 'Enter') { if (filtered[sel]) { ctx.goto(filtered[sel]); closePanel(); } e.preventDefault(); }
  });

  render();
  openPanel('goto', panelShell('Go to Chapter', h('div', {}, input, list)), { focus: input });
}

/* -------------------------------------------------------------------- help */

const CHEATS = [
  ['Structure', [
    ['# Chapter One', 'Chapter — appears in the Navigator'],
    ['## Scene', 'Section'],
    ['### Beat', 'Sub-section'],
    ['===', 'Page break'],
    ['***', 'Scene break']
  ]],
  ['Emphasis', [
    ['**bold**', 'Bold'],
    ['*italic*', 'Italic'],
    ['***both***', 'Bold italic'],
    ['_underline_', 'Underline'],
    ['~~struck~~', 'Strikethrough']
  ]],
  ['Asides', [
    ['[[a note]]', 'Note — never printed, never counted'],
    ['/* … */', 'Comment — hidden from the manuscript'],
    ['> centered <', 'Centered line'],
    ['> flush right', 'Right aligned']
  ]]
];

export function showHelp() {
  const grid = h('div', { class: 'help-grid' });
  for (const [section, rows] of CHEATS) {
    grid.append(h('div', { class: 'help-sect' }, section));
    for (const [code, desc] of rows) {
      grid.append(h('code', {}, code), h('span', {}, desc));
    }
  }
  openPanel('help', panelShell('Markup', grid));
}

/* ----------------------------------------------------------------- backups */

function whenLabel(time) {
  const d = new Date(time);
  const mins = Math.round((Date.now() - time) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const sameDay = new Date().toDateString() === d.toDateString();
  const clock = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return `today, ${clock}`;
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${clock}`;
}

export function showBackups(ctx) {
  const body = h('div', {});

  if (!ctx.list.length) {
    body.append(h('div', { class: 'rev-empty' },
      'No versions kept yet. One is stored each time the document is saved over.'));
  } else {
    const list = h('div', { class: 'goto-list' });
    for (const entry of ctx.list) {
      list.append(h('button', {
        class: 'goto-item',
        onclick: () => { ctx.open(entry); closePanel(); }
      },
        h('span', {}, whenLabel(entry.time)),
        h('span', { class: 'count' }, `${Math.max(1, Math.round(entry.size / 1024))} KB`)));
    }
    body.append(list);
    body.append(h('div', { class: 'hint', style: 'margin-top:10px' },
      'A version opens in a new window so the document you are editing is never overwritten.'));
  }

  openPanel('backups', panelShell('Revert to Backup', body));
}

/* ------------------------------------------------------------------ export */

export function showExport(ctx) {
  const body = h('div', {},
    row('PDF', 'Formatted manuscript pages', h('button', { class: 'btn primary',
      onclick: () => { ctx.exportAs('pdf'); closePanel(); } }, 'Export')),
    row('Word', 'A real .docx, styles and all', h('button', { class: 'btn',
      onclick: () => { ctx.exportAs('docx'); closePanel(); } }, 'Export')),
    row('HTML', 'Self-contained web page', h('button', { class: 'btn',
      onclick: () => { ctx.exportAs('html'); closePanel(); } }, 'Export')),
    row('Plain text', 'Prose only — markup stripped', h('button', { class: 'btn',
      onclick: () => { ctx.exportAs('txt'); closePanel(); } }, 'Export')),
    row('Markdown', 'Source as written', h('button', { class: 'btn',
      onclick: () => { ctx.exportAs('md'); closePanel(); } }, 'Export')));
  openPanel('export', panelShell('Export', body));
}
