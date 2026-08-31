/* End-to-end tests: boots the real app and drives it through the same IPC and
   DOM the user would touch.  npm run test:app  */
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const base = path.join(__dirname, '..');
const PROFILE = path.join(os.tmpdir(), `low-tide-test-profile-${process.pid}`);
const WORK = path.join(os.tmpdir(), `low-tide-test-files-${process.pid}`);
app.setPath('userData', PROFILE);
fs.mkdirSync(WORK, { recursive: true });

process.env.LOWTIDE_HARNESS = '1';
// Run from source, app.getVersion() reports Electron's own version, which beats
// every real release — so the update notice needs a fixed answer to test against.
process.env.LOWTIDE_FAKE_UPDATE = '9.9.9';
require(path.join(base, 'src', 'main', 'main.js'));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => { report('TIMED OUT'); app.exit(2); }, 300000);
process.on('unhandledRejection', (err) => {
  console.log('REJECTED:', (err && err.stack) || err);
  report();
  app.exit(3);
});

/* ------------------------------------------------------------- framework */

const results = [];
let group = '';
const eq = (name, actual, expected) => {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  results.push({ group, name, ok: a === b, actual: a, expected: b });
};
const ok = (name, cond) => eq(name, !!cond, true);

async function test(name, fn) {
  try {
    await fn();
  } catch (err) {
    results.push({ group, name: `${name} (threw)`, ok: false, actual: err.message, expected: 'no error' });
  }
}

function report(note) {
  const failed = results.filter((r) => !r.ok);
  let current = '';
  for (const r of results) {
    if (r.group !== current) { current = r.group; console.log(`\n  ${current}`); }
    console.log(`    ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}` +
      (r.ok ? '' : `\n          got:  ${r.actual}\n          want: ${r.expected}`));
  }
  console.log(`\n${results.length - failed.length}/${results.length} passed` +
    (note ? ` (${note})` : ''));
  return failed.length;
}

/* ------------------------------------------------------------------ setup */

let win, wc, js;

const content = () => js('window.__lowTideContent()');
const text = (id) => js(`document.getElementById(${JSON.stringify(id)}).textContent`);

async function load(body, filePath) {
  wc.send('doc:load', { path: filePath || null, content: body });
  await wait(700);
}
async function select(from, to) {
  await js(`(() => { const v = window.__lowTideView;
    v.dispatch({selection:{anchor:${from},head:${to}}}); v.focus(); return true; })()`);
  await wait(80);
}
async function menu(cmd) { wc.send('menu', cmd); await wait(260); }
async function type(str) {
  await js(`document.querySelector('.cm-content').focus()`);
  await wait(150);
  for (const ch of str) { wc.sendInputEvent({ type: 'char', keyCode: ch }); await wait(30); }
  await wait(250);
}
async function click(selector) {
  return js(`(() => { const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) return false; el.click(); return true; })()`);
}

app.whenReady().then(async () => {
  await wait(2200);

  // A fresh profile opens the Home window; start a document from it the way a
  // person would, then test against that window.
  const findDoc = () => BrowserWindow.getAllWindows()
    .find((w) => !w.isDestroyed() && w.webContents.getURL().includes('index.html'));

  if (!findDoc()) {
    const home = BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('home.html'));
    if (!home) { console.log('neither a home nor a document window opened'); app.exit(1); return; }
    // Do not await: this closes the Home window, so the promise never settles.
    home.webContents.executeJavaScript(`window.api.home.create('blank')`, true).catch(() => {});
    await wait(2000);
  }

  win = findDoc();
  if (!win) { console.log('no document window'); app.exit(1); return; }
  wc = win.webContents;
  js = (code) => wc.executeJavaScript(code, true);

  /* ===================================================== formatting ===== */
  group = 'Formatting';

  await test('bold wraps and unwraps', async () => {
    await load('She was very quiet.');
    await select(8, 12);
    await menu('format:bold');
    eq('bold wraps selection', await content(), 'She was **very** quiet.');
    await menu('format:bold');
    eq('bold toggles off', await content(), 'She was very quiet.');
  });

  await test('bold with no selection takes the word', async () => {
    await load('single');
    await select(3, 3);
    await menu('format:bold');
    eq('bold uses the word at the caret', await content(), '**single**');
  });

  await test('headings', async () => {
    await load('A line of prose.');
    await select(0, 0);
    await menu('format:h1');
    eq('chapter applied', await content(), '# A line of prose.');
    await menu('format:h1');
    eq('chapter toggles off', await content(), 'A line of prose.');
    await menu('format:h2');
    eq('section applied', await content(), '## A line of prose.');
    await menu('format:h1');
    eq('section becomes chapter', await content(), '# A line of prose.');
    await menu('format:body');
    eq('body clears the marker', await content(), 'A line of prose.');
  });

  await test('headings across a multi-line selection', async () => {
    await load('one\ntwo');
    await select(0, 7);
    await menu('format:h2');
    eq('every selected line gets a marker', await content(), '## one\n## two');
  });

  await test('changing a heading leaves the caret in the words', async () => {
    // A caret on or inside the "## " marker has nowhere obvious to go when the
    // marker is rewritten; it used to be stranded in front of the new hashes.
    const at = () => js(`window.__lowTideView.state.selection.main.head`);

    await load('Plain line');
    await select(0, 0);
    await menu('format:h1');
    eq('from the very start of a plain line', await at(), 2);

    await load('# Heading');
    await select(0, 0);
    await menu('format:h2');
    eq('from the start of an existing heading', await at(), 3);

    await load('# Heading');
    await select(1, 1);
    await menu('format:h2');
    eq('from between the hashes and the space', await at(), 3);

    await load('# Heading');
    await select(5, 5);
    await menu('format:h2');
    eq('from inside the words', await at(), 6);

    await load('## Heading');
    await select(6, 6);
    await menu('format:h1');
    eq('shortening the marker keeps the place', await at(), 5);

    await load('# Heading');
    await select(4, 4);
    await menu('format:h1');
    eq('toggling the heading off keeps the place', await at(), 2);
  });

  await test('a half-typed heading is still a heading', async () => {
    // Without this the line collapses to body height the moment the title is
    // deleted and springs back as it is retyped, so the text jumps about while
    // the hashes are being edited.
    const cls = () => js(`(() => {
      const v = window.__lowTideView;
      let n = v.domAtPos(v.state.doc.line(1).from).node;
      n = n.nodeType === 1 ? n : n.parentElement;
      while (n && !n.classList.contains('cm-line')) n = n.parentElement;
      return n ? n.className.replace('cm-line', '').trim() : ''; })()`);

    await load('## A section');
    eq('a full heading', await cls(), 'l-h2');
    await load('##');
    eq('hashes with no title yet', await cls(), 'l-h2');
    await load('# ');
    eq('a hash and a space', await cls(), 'l-h1');
    await load('#tag');
    eq('a hash run into a word is not a heading', await cls(), 'l-body');
    await load('# 3');
    eq('a numbered title is a heading', await cls(), 'l-h1');
  });

  await test('centering and notes', async () => {
    await load('Centre me');
    await select(0, 0);
    await menu('format:center');
    eq('centering applied', await content(), '> Centre me <');
    await menu('format:center');
    eq('centering removed', await content(), 'Centre me');

    await load('note here');
    await select(0, 4);
    await menu('format:note');
    eq('note wraps selection', await content(), '[[note]] here');
  });

  await test('block inserts', async () => {
    await load('line');
    await select(4, 4);
    await menu('format:pagebreak');
    ok('page break inserted', (await content()).includes('==='));
    await menu('format:divider');
    ok('scene break inserted', (await content()).includes('***'));
  });

  await test('undo and redo', async () => {
    await load('start');
    await select(5, 5);
    await type('!');
    eq('typed', await content(), 'start!');
    await js(`window.__lowTideView.focus()`);
    const mod = process.platform === 'darwin' ? 'cmd' : 'control';
    // Always release the key: a held modifier swallows the next character.
    const chord = async (modifiers) => {
      wc.sendInputEvent({ type: 'keyDown', keyCode: 'z', modifiers });
      await wait(60);
      wc.sendInputEvent({ type: 'keyUp', keyCode: 'z', modifiers });
      await wait(300);
    };
    await chord([mod]);
    eq('undo restores', await content(), 'start');
    await chord([mod, 'shift']);
    eq('redo reapplies', await content(), 'start!');
  });

  /* ================================================== smart punctuation == */
  group = 'Smart punctuation';

  await test('quotes, dash and ellipsis', async () => {
    await load('');
    await type('"Hi" a--b it\'s...');
    eq('curly quotes, em dash, ellipsis', await content(), '“Hi” a—b it’s…');
  });

  await test('can be switched off', async () => {
    await js(`window.api.prefs.set({smartTypography:false})`);
    await js(`window.__setSmart && window.__setSmart(false)`);
    await wait(200);
    await load('');
    await type('"x"');
    eq('straight quotes when disabled', await content(), '"x"');
    await js(`window.__setSmart && window.__setSmart(true)`);
    await js(`window.api.prefs.set({smartTypography:true})`);
    await wait(200);
  });

  /* ========================================================== counting == */
  group = 'Counting';

  await test('word and character counts', async () => {
    await load('# Chapter\n\nTwo words [[ignored]] /* ignored */ three.');
    await wait(600);
    eq('words skip notes and comments', await text('stat-words'), '4 words');
    ok('characters counted', (await text('stat-chars')).endsWith('characters'));
  });

  await test('front matter is excluded', async () => {
    await load('Title: A Long Title Here\nAuthor: Someone\n\n# One\n\nword word');
    await wait(700);
    eq('front matter not counted', await text('stat-words'), '3 words');
  });

  /* ========================================================= navigator == */
  group = 'Navigator';

  await test('outline and filter', async () => {
    await load('# Act One\n\nx\n\n## Scene A\n\ny\n\n## Scene B\n\nz\n\n# Act Two\n\nq');
    await wait(700);
    eq('all headings listed', await js(`document.querySelectorAll('.nav-item').length`), 4);
    await js(`(() => { const f = document.getElementById('nav-filter');
      f.value = 'scene'; f.dispatchEvent(new Event('input')); return true; })()`);
    await wait(250);
    eq('filter narrows the list', await js(`document.querySelectorAll('.nav-item').length`), 2);
    await js(`(() => { const f = document.getElementById('nav-filter');
      f.value = ''; f.dispatchEvent(new Event('input')); return true; })()`);
    await wait(250);
    eq('clearing the filter restores it', await js(`document.querySelectorAll('.nav-item').length`), 4);
  });

  await test('clicking a chapter lands on it, and lands there again', async () => {
    // Long enough that every chapter can actually be scrolled to the top.
    const filler = Array.from({ length: 14 },
      () => 'Words that fill a printed line and then some more of them. '.repeat(3)).join('\n\n');
    await load(['# One', '', filler, '', '# Two', '', filler, '', '# Three', '',
      filler, '', '# Four', '', filler].join('\n'));
    await wait(1400);

    const scrollTop = () => js(`document.querySelector('.cm-scroller').scrollTop`);
    const headingOffset = () => js(`(() => {
      const line = [...document.querySelectorAll('.cm-line')].find(l => l.textContent.trim() === '# Four');
      if (!line) return null;
      const scroller = document.querySelector('.cm-scroller');
      return Math.round(line.getBoundingClientRect().top - scroller.getBoundingClientRect().top);
    })()`);

    await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.startsWith('Four')).click()`);
    await wait(700);
    const firstTop = await scrollTop();
    const firstOffset = await headingOffset();
    ok('the heading is scrolled near the top',
      firstOffset !== null && firstOffset >= 0 && firstOffset < 200);

    await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.startsWith('Four')).click()`);
    await wait(700);
    const secondTop = await scrollTop();
    ok('clicking the same chapter again does not move elsewhere', Math.abs(secondTop - firstTop) <= 2);

    await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.startsWith('One')).click()`);
    await wait(600);
    await js(`[...document.querySelectorAll('.nav-item')].find(n => n.textContent.startsWith('Four')).click()`);
    await wait(700);
    const thirdTop = await scrollTop();
    ok('coming back to it lands in the same place', Math.abs(thirdTop - firstTop) <= 2);
  });

  await test('nesting is drawn with one rule per level', async () => {
    await load('# One\n\nx\n\n## Two\n\ny\n\n### Three\n\nz\n\n#### Four\n\nq');
    await wait(700);
    eq('a chapter has no rules',
      await js(`document.querySelectorAll('.nav-item')[0].querySelectorAll('.guide').length`), 0);
    eq('a section has one', 
      await js(`document.querySelectorAll('.nav-item')[1].querySelectorAll('.guide').length`), 1);
    eq('a sub-section has two',
      await js(`document.querySelectorAll('.nav-item')[2].querySelectorAll('.guide').length`), 2);
    eq('a fourth level has three',
      await js(`document.querySelectorAll('.nav-item')[3].querySelectorAll('.guide').length`), 3);
    eq('each level indents further', await js(`JSON.stringify(
      [...document.querySelectorAll('.nav-item')].map(b => getComputedStyle(b).paddingLeft))`),
      JSON.stringify(['9px', '23px', '37px', '51px']));
  });

  /* ================================================ reordering chapters == */
  group = 'Reordering';

  const DOC3 = '# One\n\nAlpha.\n\n# Two\n\nBeta.\n\n# Three\n\nGamma.';
  const headings = async () =>
    (await content()).split('\n').filter((l) => /^#/.test(l));

  await test('a heading owns everything beneath it', async () => {
    await load('# Act\n\nx\n\n## Scene\n\ny\n\n### Beat\n\nz\n\n# Next\n\nq');
    await wait(700);
    eq('a chapter takes its scenes with it',
      await js(`(() => { const r = window.__sectionRange(0);
        return window.__lowTideView.state.doc.sliceString(r.from, r.to); })()`),
      '# Act\n\nx\n\n## Scene\n\ny\n\n### Beat\n\nz\n\n');
    eq('a scene takes only its beats',
      await js(`(() => { const r = window.__sectionRange(1);
        return window.__lowTideView.state.doc.sliceString(r.from, r.to); })()`),
      '## Scene\n\ny\n\n### Beat\n\nz\n\n');
  });

  await test('a chapter can be moved to the front, middle and end', async () => {
    await load(DOC3); await wait(700);
    ok('moved', await js(`window.__moveSection(2, 0)`));
    await wait(400);
    eq('to the front', await content(), '# Three\n\nGamma.\n\n# One\n\nAlpha.\n\n# Two\n\nBeta.');

    await load(DOC3); await wait(700);
    ok('moved', await js(`window.__moveSection(0, 3)`));
    await wait(400);
    eq('to the end', await content(), '# Two\n\nBeta.\n\n# Three\n\nGamma.\n\n# One\n\nAlpha.');

    await load(DOC3); await wait(700);
    ok('moved', await js(`window.__moveSection(2, 1)`));
    await wait(400);
    eq('into the middle', await content(), '# One\n\nAlpha.\n\n# Three\n\nGamma.\n\n# Two\n\nBeta.');
  });

  await test('moving keeps the spacing and loses no words', async () => {
    for (const [i, slot] of [[0, 3], [2, 0], [1, 0], [0, 2]]) {
      await load(DOC3); await wait(600);
      await js(`window.__moveSection(${i}, ${slot})`);
      await wait(350);
      const after = await content();
      ok(`${i}->${slot} keeps every word`,
        after.split(/\s+/).filter(Boolean).sort().join(' ') ===
        DOC3.split(/\s+/).filter(Boolean).sort().join(' '));
      ok(`${i}->${slot} leaves one blank line between chapters`, !/\n{3,}/.test(after));
      ok(`${i}->${slot} leaves no blank line at the end`, !/\n\s*$/.test(after));
    }
  });

  await test('a chapter carries its scenes', async () => {
    await load('# One\n\na\n\n## Scene A\n\nb\n\n# Two\n\nc');
    await wait(700);
    await js(`window.__moveSection(2, 0)`);
    await wait(400);
    eq('the scene stays under its chapter', await headings(), ['# Two', '# One', '## Scene A']);
  });

  await test('dropping a chapter on itself changes nothing', async () => {
    await load(DOC3); await wait(700);
    eq('onto its own slot', await js(`window.__moveSection(1, 1)`), false);
    eq('into its own body', await js(`window.__moveSection(0, 0)`), false);
    eq('the document is untouched', await content(), DOC3);
  });

  await test('the caret follows the moved chapter', async () => {
    await load(DOC3); await wait(700);
    await js(`window.__moveSection(2, 0)`);
    await wait(400);
    eq('the caret sits on the heading it moved', await js(`(() => { const v = window.__lowTideView;
      return v.state.doc.lineAt(v.state.selection.main.head).text; })()`), '# Three');
  });

  await test('dragging a row actually moves the chapter', async () => {
    // The handlers, not just the move underneath them: dragstart marks the row,
    // dragover puts the drop line in the right place, drop does the work.
    const drag = (from, onto, bottomHalf) => js(`(() => {
      const rows = [...document.querySelectorAll('.nav-item')];
      const src = rows[${from}], dst = rows[${onto}];
      if (!src || !dst) return null;
      const dt = new DataTransfer();
      const fire = (el, type, y) => el.dispatchEvent(new DragEvent(type, {
        bubbles: true, cancelable: true, dataTransfer: dt, clientY: y }));
      const r = dst.getBoundingClientRect();
      const y = r.top + r.height * (${bottomHalf} ? 0.75 : 0.25);
      fire(src, 'dragstart', 0);
      const dragging = src.classList.contains('dragging');
      fire(dst, 'dragover', y);
      const marker = document.querySelector('.nav-drop');
      const shown = !!marker && !marker.hidden;
      fire(dst, 'drop', y);
      fire(src, 'dragend', 0);
      return { dragging, shown };
    })()`);

    await load(DOC3); await wait(700);
    const onto = await drag(2, 0, false);
    eq('the row is marked while dragging', onto && onto.dragging, true);
    eq('a drop line is shown', onto && onto.shown, true);
    await wait(500);
    eq('dropping on the top half puts it above',
      await content(), '# Three\n\nGamma.\n\n# One\n\nAlpha.\n\n# Two\n\nBeta.');

    await load(DOC3); await wait(700);
    await drag(0, 2, true);
    await wait(500);
    eq('dropping on the bottom half puts it below',
      await content(), '# Two\n\nBeta.\n\n# Three\n\nGamma.\n\n# One\n\nAlpha.');

    eq('the drop line is put away afterwards',
      await js(`(() => { const m = document.querySelector('.nav-drop'); return !m || m.hidden; })()`), true);
    eq('no row is left mid-drag',
      await js(`document.querySelectorAll('.nav-item.dragging').length`), 0);
  });

  await test('reordering waits for a clear filter', async () => {
    await load(DOC3); await wait(700);
    eq('draggable by default',
      await js(`document.querySelector('.nav-item').getAttribute('draggable')`), 'true');
    await js(`(() => { const f = document.getElementById('nav-filter');
      f.value = 'one'; f.dispatchEvent(new Event('input')); return true; })()`);
    await wait(300);
    eq('not while filtering',
      await js(`document.querySelector('.nav-item').getAttribute('draggable')`), 'false');
    await js(`(() => { const f = document.getElementById('nav-filter');
      f.value = ''; f.dispatchEvent(new Event('input')); return true; })()`);
    await wait(300);
    eq('draggable again once cleared',
      await js(`document.querySelector('.nav-item').getAttribute('draggable')`), 'true');
  });

  await test('the music pane is painted from the theme', async () => {
    const token = (n) => js(`getComputedStyle(document.documentElement).getPropertyValue('${n}').trim()`);

    await js(`window.__applyTheme('material')`);
    await wait(300);
    const surface = await token('--surface');
    const primary = await token('--primary');
    const material = await js(`window.__musicThemeCss()`);

    ok('the sheet carries the theme surface', material.includes(surface));
    ok('the site background is overridden', material.includes('--yt-spec-base-background'));
    ok('the brand red is replaced by the theme accent',
      new RegExp('--yt-spec-static-brand-red:\\s*' + primary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).test(material));
    ok('the guest is told to use its dark styling', material.includes('color-scheme: dark'));

    await js(`window.__applyTheme('nord')`);
    await wait(300);
    const nordSurface = await token('--surface');
    const nord = await js(`window.__musicThemeCss()`);
    ok('a different theme gives a different sheet', nord !== material);
    ok('and carries the new surface', nord.includes(nordSurface));
    ok('the old surface is gone', !nord.includes(surface));

    await js(`window.__applyTheme('material')`);
    await wait(250);
  });

  /* ==================================================== focus sounds ==== */
  group = 'Focus sounds';

  await test('every sound renders, and none of them is silent or clipped', async () => {
    const ids = await js(`window.__ambienceIds()`);
    eq('nine of them are offered', ids.length, 9);

    const levels = [];
    for (const id of ids) {
      const m = await js(`window.__measureAmbience(${JSON.stringify(id)}, 2)`);
      ok(`${id} renders`, !!m);
      if (!m) continue;
      ok(`${id} makes a sound`, m.rms > 0.02);
      eq(`${id} has no broken samples`, m.nonFinite, 0);
      ok(`${id} does not clip`, m.peak < 1);
      levels.push(m.rms);
    }
    // Switching between them should not be a jolt.
    const loudest = Math.max(...levels);
    const quietest = Math.min(...levels);
    ok('they sit within about twice each other', loudest / quietest < 2.2);
  });

  await test('the focus sounds play, swap and stop', async () => {
    await click('#btn-music');
    await wait(800);
    eq('the buttons are there', await js(`document.querySelectorAll('.amb-btn').length`), 9);
    eq('nothing plays to begin with', await js(`window.__ambience.playing`), null);
    ok('the stop button is put away', await js(`document.querySelector('.amb .text-btn').hidden`));

    await js(`document.querySelector('.amb-btn[data-amb="rain"]').click()`);
    await wait(600);
    eq('rain starts', await js(`window.__ambience.playing`), 'rain');
    eq('and is the one marked', await js(`document.querySelector('.amb-btn.on').dataset.amb`), 'rain');

    await js(`document.querySelector('.amb-btn[data-amb="cafe"]').click()`);
    await wait(600);
    eq('picking another swaps to it', await js(`window.__ambience.playing`), 'cafe');
    eq('only one is marked', await js(`document.querySelectorAll('.amb-btn.on').length`), 1);

    await js(`document.querySelector('.amb-btn[data-amb="cafe"]').click()`);
    await wait(600);
    eq('picking the same one stops it', await js(`window.__ambience.playing`), null);
    eq('nothing is marked', await js(`document.querySelectorAll('.amb-btn.on').length`), 0);

    await js(`window.__ambience.setVolume(0.3)`);
    await wait(200);
    eq('the volume can be set', await js(`window.__ambience.volume`), 0.3);
    await js(`window.__ambience.setVolume(5)`);
    eq('and is held inside its range', await js(`window.__ambience.volume`), 1);
    await js(`window.__ambience.setVolume(0.6)`);
  });

  /* ==================================================== line heights ==== */
  group = 'Line heights';

  const boxes = () => js(`(() => [...document.querySelectorAll('.cm-content .cm-line')].map((el) => {
    const cs = getComputedStyle(el);
    return { h: +el.getBoundingClientRect().height.toFixed(2),
             cls: el.className.replace('cm-line', '').trim(),
             lh: cs.lineHeight, text: el.textContent.slice(0, 20) };
  }))()`);

  const HEIGHT_DOC = [
    'Body line one, plain and ordinary.', 'Body line two, also plain.', '',
    '# Chapter', '', 'After a chapter.', '',
    '## Section', '', 'After a section.', '',
    '### Sub', '', 'After a sub.', '',
    '#### Fourth', '', 'After a fourth.', '',
    '- a list item', '', '> centered <', '',
    'Body with **bold** and *italic* inline.',
    'Body with a [[note]] inline in it.',
    'Body with /* a comment */ inline.',
    'Plain tail.'
  ].join('\n');

  await test('every ordinary line is exactly the same height', async () => {
    await load(HEIGHT_DOC);
    await wait(700);
    const rows = await boxes();
    const plain = rows.filter((r) => r.cls === 'l-body');
    ok('there are body lines to compare', plain.length >= 6);
    const distinct = [...new Set(plain.map((r) => r.h))];
    eq('body lines share one height', distinct.length, 1);

    // Inline markup must not change the line box — bold, notes and comments
    // are painted, not resized.
    const inline = plain.filter((r) => /\*\*|\[\[|\/\*/.test(r.text));
    ok('inline markup was in the sample', inline.length >= 1);
    ok('inline markup does not change the line box',
      inline.every((r) => r.h === plain[0].h));

    const blanks = rows.filter((r) => r.cls === 'l-blank');
    ok('blank lines match body lines', blanks.every((r) => r.h === plain[0].h));

    const list = rows.filter((r) => r.cls.startsWith('l-list'));
    const centred = rows.filter((r) => r.cls === 'l-center');
    ok('list lines match body lines', list.every((r) => r.h === plain[0].h));
    ok('centred lines match body lines', centred.every((r) => r.h === plain[0].h));
  });

  await test('headings stand apart, in order, by a fixed amount', async () => {
    await load(HEIGHT_DOC);
    await wait(700);
    const rows = await boxes();
    const one = (cls) => rows.find((r) => r.cls === cls);
    const body = rows.find((r) => r.cls === 'l-body').h;
    const h1 = one('l-h1').h, h2 = one('l-h2').h, h3 = one('l-h3').h, h4 = one('l-h4').h;

    ok('a chapter is the tallest', h1 > h2);
    ok('a section is taller than a sub-section', h2 > h3);
    ok('a sub-section is taller than a fourth level', h3 > h4);
    ok('every heading is taller than body text', h4 > body);

    // Ratios rather than pixels, so the check survives a different font.
    const r = (x) => Math.round((x / body) * 100) / 100;
    eq('chapter ratio', r(h1), 2.4);
    eq('section ratio', r(h2), 2.09);
    eq('sub-section ratio', r(h3), 1.85);
    eq('fourth-level ratio', r(h4), 1.73);
  });

  await test('a heading returns to body height when it is removed', async () => {
    await load('Body before.\nA line.\nBody after.');
    await wait(600);
    const before = (await boxes())[1].h;

    await select(14, 14);
    await menu('format:h2');
    await wait(400);
    const asHeading = (await boxes())[1].h;
    ok('making it a heading changes the box', asHeading !== before);

    await menu('format:h2');
    await wait(400);
    const after = (await boxes())[1].h;
    eq('and taking it back gives exactly the old height', after, before);
  });

  await test('editing one heading leaves every other line alone', async () => {
    await load(HEIGHT_DOC);
    await wait(700);
    const before = await boxes();

    // Retype the title of the section heading, character by character.
    const line = await js(`window.__lowTideView.state.doc.line(8).from`);
    await select(line + 3, line + 10);
    await type('Scene');
    await wait(600);

    const after = await boxes();
    const bodyBefore = [...new Set(before.filter((r) => r.cls === 'l-body').map((r) => r.h))];
    const bodyAfter = [...new Set(after.filter((r) => r.cls === 'l-body').map((r) => r.h))];
    eq('body lines are untouched', bodyAfter, bodyBefore);
    eq('the section is still a section', after.filter((r) => r.cls === 'l-h2').length, 1);
  });

  await test('nothing in the interface takes its line box from the font', async () => {
    // `line-height: normal` measures from the font's own metrics, and the UI
    // stack resolves to a different face on each platform — so a row that
    // pins its line-height sits at odds with its neighbours on Linux while
    // looking right on macOS.
    for (const tab of ['navigator', 'stats', 'scratch', 'revisions', 'reference']) {
      await click(`.side-tab[data-tab="${tab}"]`);
      await wait(150);
    }
    // Preferences is where most of the form controls live.
    await menu('tools:prefs');
    await wait(400);
    await js(`(() => { const host = document.getElementById('ref-results');
      host.innerHTML = '<div class="ref-section">Synonyms</div><div class="chips">' +
        ['apathetic','inert','moderate'].map(w => '<button class="chip">' + w + '</button>').join('') +
        '</div><div class="def"><span class="part">adjective</span>Having no interest.' +
        '<div class="eg">an example</div></div>'; return true; })()`);
    await wait(300);

    const bad = await js(`(() => {
      const out = [];
      for (const el of document.querySelectorAll('body *')) {
        if (el.closest('.sprite') || el.tagName === 'svg' || el.tagName === 'use') continue;
        if (!el.offsetParent) continue;
        // Chromium pins <select> to normal in its own stylesheet and ignores
        // any override; that control is sized by the platform, not by a line
        // of text, so it is not what this check is looking for.
        if (el.tagName === 'SELECT') continue;
        if (getComputedStyle(el).lineHeight === 'normal') {
          out.push(el.tagName.toLowerCase() +
            (typeof el.className === 'string' && el.className.trim()
              ? '.' + el.className.trim().split(/\s+/)[0] : ''));
        }
      }
      return [...new Set(out)]; })()`);
    eq('every laid-out row has a pinned line-height', bad, []);

    const chips = await js(`JSON.stringify([...new Set(
      [...document.querySelectorAll('.chip')].map(c => +c.getBoundingClientRect().height.toFixed(2)))])`);
    eq('the thesaurus chips are all one height', JSON.parse(chips).length, 1);

    await js(`(() => { const b = [...document.querySelectorAll('.panel .btn, .panel .text-btn')]
      .find(x => /done|close/i.test(x.textContent)); if (b) b.click(); return true; })()`);
    await wait(300);
    await js(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await wait(250);
    await click('.side-tab[data-tab="navigator"]');
    await wait(150);
  });

  /* ========================================================= pagination == */
  group = 'Pagination';

  await test('empty and tiny documents', async () => {
    await load('');
    await wait(900);
    eq('empty document has no pages', await text('ds-pages'), '0');
    await load('one line');
    await wait(900);
    eq('a line is one page', await text('ds-pages'), '1');
  });

  await test('a long document splits into pages', async () => {
    const unit = 'Words that fill a printed line and then some more of them. ';
    await load('# Long\n\n' + Array.from({ length: 120 },
      (_, i) => `Para ${i + 1}. ` + unit.repeat(2 + (i % 4))).join('\n\n'));
    await wait(2600);
    const pages = parseInt((await text('ds-pages')).replace(/\D/g, ''), 10);
    ok('page count is plausible', pages > 6 && pages < 60);
    await click('#btn-preview');
    await wait(1200);
    eq('preview shows every page', await js(`document.querySelectorAll('#preview-scroll .page').length`), pages);
    ok('a paragraph is continued across a break',
      await js(`!!document.querySelector('#preview-scroll .page p.cont')`));
    await click('#view-text');
    await wait(300);
  });

  await test('title page adds a sheet', async () => {
    await load('Title: T\nAuthor: A\n\n# One\n\nshort');
    await wait(1200);
    await click('#btn-preview');
    await wait(900);
    const before = await js(`document.querySelectorAll('#preview-scroll .page').length`);
    await click('#pv-title');
    await wait(700);
    const after = await js(`document.querySelectorAll('#preview-scroll .page').length`);
    eq('title page adds one page', after, before + 1);
    ok('title page shows the title',
      await js(`!!document.querySelector('#preview-scroll .title-page h1')`));
    await click('#pv-title');
    await wait(400);
    await click('#view-text');
    await wait(300);
  });

  await test('page geometry changes the count', async () => {
    const para = 'Words that fill a printed line and then some more of them. '.repeat(3);
    await load('# Long\n\n' + Array.from({ length: 80 }, () => para).join('\n\n'));
    await wait(2000);
    const loose = parseInt((await text('ds-pages')).replace(/\D/g, ''), 10);
    await js(`window.__setLeading(1.2)`);
    await wait(1800);
    const tight = parseInt((await text('ds-pages')).replace(/\D/g, ''), 10);
    ok('tighter leading fits more on a page', tight < loose);
    await js(`window.__setLeading(1.8)`);
    await wait(1500);
  });

  /* ============================================================= themes == */
  group = 'Themes';

  await test('every theme applies', async () => {
    const ids = await js(`window.__themeIds()`);
    eq('ten themes offered', ids.length, 10);
    for (const id of ids) {
      await js(`window.api.prefs.set({theme:'${id}'})`);
      await js(`window.__applyTheme('${id}')`);
      await wait(60);
      const bg = await js(`getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()`);
      ok(`${id} sets a background`, /^#[0-9a-f]{6}$/i.test(bg));
      const text = await js(`getComputedStyle(document.documentElement).getPropertyValue('--text').trim()`);
      ok(`${id} sets text colour`, /^#[0-9a-f]{6}$/i.test(text) && text !== bg);
    }
    await js(`window.__applyTheme('material')`);
    await js(`window.api.prefs.set({theme:'material'})`);
  });

  await test('light themes flip the colour scheme', async () => {
    await js(`window.__applyTheme('paper')`);
    await wait(120);
    eq('light class applied', await js(`document.body.classList.contains('light-theme')`), true);
    await js(`window.__applyTheme('material')`);
    await wait(120);
    eq('dark class restored', await js(`document.body.classList.contains('light-theme')`), false);
  });

  /* ========================================================== revisions == */
  group = 'Revisions';

  await test('create, mark, hide, delete', async () => {
    await load('Existing sentence.');
    await click('.side-tab[data-tab="revisions"]');
    await wait(200);
    await click('#rev-new');
    await wait(300);
    await js(`(() => { document.querySelector('.panel input[type="text"]').value = 'Blue Pass'; return true; })()`);
    await js(`[...document.querySelectorAll('.panel .btn')].find(b => b.textContent === 'Create').click()`);
    await wait(400);
    eq('revision labelled', await js(`document.querySelector('.rev-item .name').textContent`), 'Blue Pass');

    await select(18, 18);
    await type(' New');
    const marked = await js(`[...document.querySelectorAll('.cm-content .m-rev')].map(e => e.textContent).join('')`);
    eq('typing is marked', marked.trim(), 'New');
    ok('mark carries the colour',
      await js(`document.querySelector('.cm-content .m-rev').className.includes('m-rev-blue')`));
    ok('status bar shows the revision', !(await js(`document.getElementById('rev-active').hidden`)));

    await click('#rev-show');
    await wait(150);
    eq('marks can be hidden', await js(`document.body.classList.contains('hide-revisions')`), true);
    await click('#rev-show');
    await wait(150);

    // per-revision menu: hide, then show again
    await js(`document.querySelector('.rev-item .more').click()`);
    await wait(300);
    await js(`[...document.querySelectorAll('.menu-item')].find(b => b.textContent.startsWith('Hide marks')).click()`);
    await wait(300);
    ok('one revision can be hidden on its own',
      (await js(`document.getElementById('rev-hidden-style').textContent`)).includes('data-rev'));

    await js(`document.querySelector('.rev-item .more').click()`);
    await wait(300);
    await js(`[...document.querySelectorAll('.menu-item')].find(b => b.textContent.startsWith('Show marks')).click()`);
    await wait(300);
    eq('showing it again clears the rule',
      await js(`document.getElementById('rev-hidden-style').textContent`), '');

    await js(`document.querySelector('.rev-item .more').click()`);
    await wait(300);
    await js(`[...document.querySelectorAll('.menu-item')].find(b => b.textContent.startsWith('Delete revision')).click()`);
    await wait(400);
    eq('deleting removes the marks', await js(`document.querySelectorAll('.cm-content .m-rev').length`), 0);
    eq('deleting removes the entry', await js(`document.querySelectorAll('.rev-item').length`), 0);
  });

  await test('marks survive a chapter being reordered', async () => {
    await load('# One\n\nAlpha.\n\n# Two\n\nBeta.');
    await click('.side-tab[data-tab="revisions"]');
    await wait(200);
    await click('#rev-new');
    await wait(300);
    await js(`(() => { document.querySelector('.panel input[type="text"]').value = 'Pass'; return true; })()`);
    await js(`[...document.querySelectorAll('.panel .btn')].find(b => b.textContent === 'Create').click()`);
    await wait(400);

    // Type inside the second chapter so the mark rides along when it moves.
    await select(27, 27);
    await type('X');
    await wait(300);
    const before = await js(`[...document.querySelectorAll('.cm-content .m-rev')].map(e => e.textContent).join('')`);
    eq('the mark is there to begin with', before.trim(), 'X');

    await js(`window.__moveSection(1, 0)`);
    await wait(600);
    const after = await js(`[...document.querySelectorAll('.cm-content .m-rev')].map(e => e.textContent).join('')`);
    eq('and is still there after the move', after.trim(), 'X');
    ok('still on the right chapter', (await content()).startsWith('# Two'));

    await js(`document.querySelector('.rev-item .more').click()`);
    await wait(300);
    await js(`[...document.querySelectorAll('.menu-item')].find(b => b.textContent.startsWith('Delete revision')).click()`);
    await wait(400);
  });

  await test('apply keeps the text, revert removes it', async () => {
    const make = async (name) => {
      await click('.side-tab[data-tab="revisions"]');
      await wait(150);
      await click('#rev-new');
      await wait(300);
      await js(`(() => { document.querySelector('.panel input[type="text"]').value = ${JSON.stringify(name)}; return true; })()`);
      await js(`[...document.querySelectorAll('.panel .btn')].find(b => b.textContent === 'Create').click()`);
      await wait(300);
    };
    const menu = async (label) => {
      await js(`document.querySelector('.rev-item .more').click()`);
      await wait(300);
      await js(`[...document.querySelectorAll('.menu-item')].find(b => b.textContent.startsWith(${JSON.stringify(label)})).click()`);
      await wait(400);
    };

    await load('Base line.');
    await make('Apply Pass');
    await select(10, 10);
    await type(' added');
    eq('text is there before applying', await content(), 'Base line. added');
    await menu('Apply');
    eq('apply keeps the text', await content(), 'Base line. added');
    eq('apply clears the marks', await js(`document.querySelectorAll('.cm-content .m-rev').length`), 0);
    await menu('Delete revision');

    await load('Base line.');
    await make('Revert Pass');
    await select(10, 10);
    await type(' added');
    eq('text is there before reverting', await content(), 'Base line. added');
    await menu('Revert changes');
    eq('revert removes what the revision added', await content(), 'Base line.');
    await menu('Delete revision');
  });

  await test('marks survive a reload', async () => {
    const file = path.join(WORK, 'revisions.fountain');
    fs.writeFileSync(file, 'Sentence one.', 'utf8');
    await load('Sentence one.', file);
    await click('.side-tab[data-tab="revisions"]');
    await wait(200);
    await click('#rev-new');
    await wait(300);
    await js(`(() => { document.querySelector('.panel input[type="text"]').value = 'Pass Two'; return true; })()`);
    await js(`[...document.querySelectorAll('.panel .btn')].find(b => b.textContent === 'Create').click()`);
    await wait(300);
    await select(13, 13);
    await type(' more');
    await wait(1200);

    await load('other doc');
    await wait(400);
    await load('Sentence one. more', file);
    await wait(900);
    eq('revision list restored', await js(`document.querySelectorAll('.rev-item').length`), 1);
    ok('marks restored', await js(`document.querySelectorAll('.cm-content .m-rev').length`) > 0);
  });

  /* ============================================================== goals == */
  group = 'Goals';

  await test('set, meet, complete and log a goal', async () => {
    await load('one two three');
    await click('.side-tab[data-tab="stats"]');
    await wait(300);
    eq('starts with no goal', await text('goal-count'), 'Set Goal');

    await click('#goal-face');
    await wait(400);
    await js(`(() => { const p = document.querySelector('.panel');
      p.querySelector('input[type="number"]').value = '3';
      p.querySelector('select').value = 'new-words';
      p.querySelector('select').dispatchEvent(new Event('change'));
      return true; })()`);
    await js(`[...document.querySelectorAll('.panel .btn')].find(b => b.textContent === 'Set Goal').click()`);
    await wait(500);
    eq('goal target shown', await text('goal-target'), '3');
    eq('goal type shown', await text('goal-label'), 'new words');
    eq('progress starts at zero', await text('goal-count'), '0');
    eq('an unmet goal offers Cancel', await text('goal-action'), 'Cancel');

    await select(13, 13);
    await type(' four five six');
    await wait(900);
    ok('progress counts words written since the goal started',
      parseInt(await text('goal-count'), 10) >= 3);
    eq('a met goal offers Done', await text('goal-action'), 'Done');
    eq('ring shows the met state', await js(`document.getElementById('goal').classList.contains('met')`), true);

    await click('#goal-action');
    await wait(500);
    eq('completing clears the ring', await text('goal-count'), 'Set Goal');
    ok('the goal moved into history',
      (await js(`document.querySelectorAll('.goal-row').length`)) >= 1);
    ok('history records the target',
      (await js(`document.querySelector('.goal-row').textContent`)).includes('3'));
  });

  await test('total-words goals read the document', async () => {
    await load('alpha beta gamma delta');
    await click('#goal-face');
    await wait(400);
    await js(`(() => { const p = document.querySelector('.panel');
      p.querySelector('input[type="number"]').value = '4';
      p.querySelector('select').value = 'total-words';
      p.querySelector('select').dispatchEvent(new Event('change'));
      return true; })()`);
    await js(`[...document.querySelectorAll('.panel .btn')].find(b => b.textContent === 'Set Goal').click()`);
    await wait(700);
    eq('counts the whole document', await text('goal-count'), '4');
    eq('met immediately', await text('goal-action'), 'Done');
    await click('#goal-action');
    await wait(400);
  });

  /* ========================================================= scratchpad == */
  group = 'Scratchpad';

  await test('holds and persists text', async () => {
    const file = path.join(WORK, 'scratch.fountain');
    fs.writeFileSync(file, 'body', 'utf8');
    await load('body', file);
    await click('.side-tab[data-tab="scratch"]');
    await wait(200);
    await js(`(() => { const t = document.getElementById('scratchpad');
      t.value = 'remember the warden'; t.dispatchEvent(new Event('input')); return true; })()`);
    await wait(1200);
    await load('elsewhere');
    await wait(400);
    await load('body', file);
    await wait(800);
    eq('scratchpad restored with the document',
      await js(`document.getElementById('scratchpad').value`), 'remember the warden');
  });

  /* =============================================== files, saves, backups = */
  group = 'Files and backups';

  await test('autosave writes to disk', async () => {
    const file = path.join(WORK, 'autosave.fountain');
    fs.writeFileSync(file, '# One\n\noriginal\n', 'utf8');
    await load('# One\n\noriginal\n', file);
    await select(16, 16);
    await type(' edited');
    await wait(2600);
    const onDisk = fs.readFileSync(file, 'utf8');
    ok('edit reached the file', onDisk.includes('edited'));
    eq('status shows saved', (await text('save-state')).startsWith('Saved'), true);
  });

  await test('overwriting keeps a backup', async () => {
    const file = path.join(WORK, 'backup.fountain');
    fs.writeFileSync(file, 'first version\n', 'utf8');
    await load('first version\n', file);
    await select(13, 13);
    await type(' plus');
    await wait(2600);
    const list = await js(`window.api.backup.list(${JSON.stringify(file)})`);
    ok('a version was kept', list.length >= 1);
    const restored = await js(`window.api.backup.list(${JSON.stringify(file)})`);
    ok('backup entries carry a time and size', restored[0].time > 0 && restored[0].size > 0);
  });

  await test('saving is atomic', async () => {
    const file = path.join(WORK, 'atomic.fountain');
    fs.writeFileSync(file, 'body\n', 'utf8');
    await load('body\n', file);
    await select(4, 4);
    await type(' more');
    await wait(2600);
    const leftovers = fs.readdirSync(WORK).filter((n) => n.includes('.tmp'));
    eq('no temp files left behind', leftovers, []);
  });

  await test('opening a missing file is reported, not fatal', async () => {
    const before = BrowserWindow.getAllWindows().length;
    await js(`window.api.file.openPath('/definitely/not/here.fountain')`).catch(() => {});
    await wait(600);
    ok('app still running', BrowserWindow.getAllWindows().length >= before - 1);
    ok('editor still responds', typeof (await content()) === 'string');
  });

  /* ============================================================ exports == */
  group = 'Exports';

  await test('plain text strips markup', async () => {
    await load('# Chapter\n\n**bold** and [[a note]] and /* hidden */ text.');
    await wait(500);
    const plain = await js(`window.__plainText(window.__lowTideContent())`);
    ok('markers removed', !plain.includes('**') && !plain.includes('#'));
    ok('note removed', !plain.includes('a note'));
    ok('comment removed', !plain.includes('hidden'));
    ok('prose kept', plain.includes('bold and') && plain.includes('text.'));
  });

  /* =============================================================== home == */
  group = 'Home';

  await test('home data is complete', async () => {
    const data = await js(`window.api.home.data()`);
    ok('templates offered', data.templates.length >= 3);
    ok('samples offered', data.samples.length >= 1);
    ok('recent is a list', Array.isArray(data.recent));
    ok('recent entries have a name and time',
      !data.recent.length || (data.recent[0].name && data.recent[0].time > 0));
  });

  /* ====================================================== find/replace == */
  group = 'Find and replace';

  await test('the find bar opens and replaces', async () => {
    await load('The warden waited. The warden watched. The warden won.');
    await menu('tools:find');
    await wait(500);
    ok('find bar is open', await js(`!!document.querySelector('.cm-panel.cm-search')`));
    ok('it has a search field', await js(`!!document.querySelector('.cm-search input[name="search"]')`));
    ok('it has a replace field', await js(`!!document.querySelector('.cm-search input[name="replace"]')`));

    await js(`(() => {
      const p = document.querySelector('.cm-search');
      const set = (name, v) => { const f = p.querySelector('input[name="' + name + '"]');
        f.value = v; f.dispatchEvent(new Event('change', { bubbles: true })); };
      set('search', 'warden');
      set('replace', 'keeper');
      return true; })()`);
    await wait(300);

    await menu('tools:replace-all');
    await wait(400);
    eq('replace all rewrote every match', await content(),
      'The keeper waited. The keeper watched. The keeper won.');

    await menu('tools:find');
    await wait(300);
    await js(`document.querySelector('.cm-search [name="close"]').click()`);
    await wait(250);
    ok('the bar closes', !(await js(`!!document.querySelector('.cm-panel.cm-search')`)));
  });

  await test('replace one match at a time', async () => {
    await load('alpha alpha alpha');
    await menu('tools:replace');
    await wait(500);
    await js(`(() => {
      const p = document.querySelector('.cm-search');
      const set = (name, v) => { const f = p.querySelector('input[name="' + name + '"]');
        f.value = v; f.dispatchEvent(new Event('change', { bubbles: true })); };
      set('search', 'alpha'); set('replace', 'beta'); return true; })()`);
    await wait(300);
    await menu('tools:find-next');
    await wait(200);
    await menu('tools:replace-next');
    await wait(400);
    const after = await content();
    ok('exactly one match changed', after.split('beta').length - 1 === 1);
    await js(`const p = document.querySelector('.cm-search [name="close"]'); if (p) p.click();`);
    await wait(200);
  });

  /* ========================================================== toolbar === */
  group = 'Toolbar';

  await test('buttons can be hidden and reordered', async () => {
    const ids = () => js(`[...document.querySelectorAll('#tb-buttons .icon-btn')].map(b => b.id)`);
    const before = await ids();
    ok('the toolbar is drawn from preferences', before.length >= 5);
    eq('preferences sits last', before[before.length - 1], 'btn-prefs');

    await js(`window.api.prefs.set({toolbarHidden:['sprint']})`);
    await js(`window.__setPref('toolbarHidden', ['sprint'])`);
    await wait(300);
    ok('a hidden button is gone', !(await ids()).includes('btn-sprint'));

    await js(`window.__setPref('toolbarOrder', ['focus','music','theme','export','sprint','prefs'])`);
    await wait(300);
    const reordered = await ids();
    eq('order follows preferences', reordered[0], 'btn-focus');

    await js(`window.__setPref('toolbarHidden', [])`);
    await js(`window.__setPref('toolbarOrder', ['export','theme','music','sprint','focus','prefs'])`);
    await wait(300);
    eq('restored', (await ids())[0], 'btn-export');
  });

  await test('preferences cannot be hidden away', async () => {
    await js(`window.__setPref('toolbarHidden', ['prefs','export','theme','music','sprint','focus'])`);
    await wait(300);
    const ids = await js(`[...document.querySelectorAll('#tb-buttons .icon-btn')].map(b => b.id)`);
    eq('only preferences remains', ids, ['btn-prefs']);
    await js(`window.__setPref('toolbarHidden', [])`);
    await wait(300);
  });

  /* ====================================================== view switch === */
  group = 'View switch';

  await test('fades with pointer distance and switches views', async () => {
    await load('# One\n\nsome prose');
    await wait(900);

    const opacity = () => js(`getComputedStyle(document.getElementById('view-switch')).opacity`);
    const move = (x, y) => js(`(() => { document.querySelector('.pane')
      .dispatchEvent(new MouseEvent('mousemove', { clientX: ${x}, clientY: ${y}, bubbles: true }));
      return true; })()`);

    await move(2000, 1400);
    await wait(500);
    eq('hidden when the pointer is far', await opacity(), '0');

    const box = await js(`(() => { const r = document.getElementById('view-switch').getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
    await move(box.x + 20, box.y + 20);
    await wait(500);
    eq('visible when the pointer is near', await opacity(), '1');

    await click('#btn-preview');
    await wait(1400);
    ok('pages view opened', !(await js(`document.getElementById('preview-host').hidden`)));
    eq('pages button marked active', await js(`document.getElementById('btn-preview').classList.contains('on')`), true);
    eq('switch stays visible in pages view',
      await js(`document.getElementById('view-switch').classList.contains('pinned')`), true);

    await click('#view-text');
    await wait(600);
    ok('back to the text view', await js(`document.getElementById('preview-host').hidden`));
    eq('text button marked active', await js(`document.getElementById('view-text').classList.contains('on')`), true);
  });

  await test('the outline stays open across both views', async () => {
    await load('# One\n\nprose here');
    await click('#btn-outline');
    await wait(700);
    if (await js(`document.querySelectorAll('.tpl-item').length`)) {
      await js(`[...document.querySelectorAll('.tpl-item')].find(t => t.textContent.includes('Blank')).click()`);
      await wait(600);
    }
    const dockVisible = () => js(`(() => { const d = document.getElementById('side-dock');
      if (d.hidden) return false;
      const r = d.getBoundingClientRect();
      return r.width > 100 && r.height > 100; })()`);
    ok('outline visible in the text view', await dockVisible());

    await click('#btn-preview');
    await wait(1300);
    ok('pages view is showing', !(await js(`document.getElementById('preview-host').hidden`)));
    ok('outline is still visible beside the pages', await dockVisible());
    ok('the pages do not cover the outline', await js(`(() => {
      const p = document.getElementById('preview-host').getBoundingClientRect();
      const d = document.getElementById('side-dock').getBoundingClientRect();
      return p.right <= d.left + 1; })()`));
    ok('a whole page fits in what is left', await js(`(() => {
      const page = document.querySelector('#preview-scroll .page');
      const scroller = document.getElementById('preview-scroll');
      if (!page) return false;
      return page.getBoundingClientRect().width <= scroller.clientWidth + 1; })()`));

    await click('#view-text');
    await wait(500);
    ok('outline survives the trip back', await dockVisible());
    await click('#dock-close');
    await wait(250);
  });

  /* ========================================================== updates === */
  group = 'Updates';

  await test('a newer release shows a notice that can be dismissed', async () => {
    // the launch check may already have fired; start from a known state
    await js(`window.__setPref('updateDismissed', '')`);
    await js(`document.getElementById('update-bar').hidden = true`);
    await wait(300);
    eq('starts hidden', await js(`document.getElementById('update-bar').hidden`), true);

    // the main process injects a fake result when LOWTIDE_FAKE_UPDATE is set
    await js(`window.__checkUpdate({ force: true })`);
    await wait(1200);
    eq('the notice appears', await js(`document.getElementById('update-bar').hidden`), false);

    const text = await js(`document.getElementById('update-text').textContent`);
    ok('it names the new version', text.includes('9.9.9'));
    // running from source, app.getVersion() is Electron's own version, so
    // compare against whatever the check actually reported
    const current = await js(`(async () => (await window.api.update.check({force:true})).current)()`);
    ok('it names the version you have', text.includes(current));

    await click('#update-dismiss');
    await wait(500);
    eq('dismissing hides it', await js(`document.getElementById('update-bar').hidden`), true);
    eq('the dismissal is remembered',
      await js(`(async () => (await window.api.prefs.get()).updateDismissed)()`), '9.9.9');

    // and it stays away on a normal (non-forced) check
    await js(`window.__checkUpdate()`);
    await wait(1000);
    eq('it does not nag again', await js(`document.getElementById('update-bar').hidden`), true);

    await js(`window.__setPref('updateDismissed', '')`);
  });

  await test('the download button only opens GitHub', async () => {
    const ok1 = await js(`window.api.update.open('https://github.com/hrozno2/lowtide/releases')`);
    const ok2 = await js(`window.api.update.open('https://evil.example.com/x')`);
    eq('a GitHub link is allowed', ok1, true);
    eq('anything else is refused', ok2, false);
  });

  /* ===================================================== window chrome === */
  group = 'Window chrome';

  await test('every platform can reach its menus, windowing and Home', async () => {
    const chrome = async (platform) => {
      await js(`(() => { document.body.classList.remove('mac','linux','win');
                         document.body.classList.add('${platform}'); return true; })()`);
      await wait(150);
      return js(`(() => {
        const shown = (id) => { const el = document.getElementById(id);
          return !!el && el.offsetParent !== null && el.getBoundingClientRect().width > 0; };
        return { menu: shown('btn-appmenu'), home: shown('btn-home'),
                 min: shown('wc-min'), close: shown('wc-close') };
      })()`);
    };

    const linux = await chrome('linux');
    ok('linux has a menu button', linux.menu);
    ok('linux can minimise', linux.min);
    ok('linux can close', linux.close);

    const win = await chrome('win');
    ok('windows has a menu button', win.menu);
    ok('windows can close', win.close);

    const mac = await chrome('mac');
    ok('macOS hides them in favour of its own', !mac.menu && !mac.min && !mac.close);

    ok('every platform has a Home button', linux.home && win.home && mac.home);
    await js(`(() => { document.body.classList.remove('mac','linux','win');
                       document.body.classList.add(window.api.platform === 'darwin' ? 'mac' : 'linux');
                       return true; })()`);
  });

  await test('the document can be saved without a keyboard shortcut', async () => {
    const file = path.join(WORK, 'button-save.fountain');
    fs.writeFileSync(file, 'start', 'utf8');
    await load('start', file);
    await select(5, 5);
    await type(' more');
    await wait(300);
    await click('#save-state');
    await wait(1200);
    eq('clicking the status bar saved it', fs.readFileSync(file, 'utf8'), 'start more');
  });

  /* ============================================================= home === */
  group = 'Home window';

  await test('closing Home does not conjure a document', async () => {
    const docsBefore = BrowserWindow.getAllWindows()
      .filter((w) => w.webContents.getURL().includes('index.html')).length;

    await js(`window.api.home.show()`);
    await wait(1400);
    const home = BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('home.html'));
    ok('home window opened', !!home);

    home.webContents.executeJavaScript(`document.getElementById('home-close').click()`, true).catch(() => {});
    await wait(1200);

    const stillHome = BrowserWindow.getAllWindows()
      .some((w) => !w.isDestroyed() && w.webContents.getURL().includes('home.html'));
    eq('home closed', stillHome, false);

    const docsAfter = BrowserWindow.getAllWindows()
      .filter((w) => !w.isDestroyed() && w.webContents.getURL().includes('index.html')).length;
    eq('no extra document appeared', docsAfter, docsBefore);
  });

  /* ============================================================= dock === */
  group = 'Side dock';

  await test('outline pane offers templates and keeps what you write', async () => {
    const file = path.join(WORK, 'outline.fountain');
    fs.writeFileSync(file, '# One\n\nbody', 'utf8');
    await load('# One\n\nbody', file);

    await click('#btn-outline');
    await wait(600);
    ok('dock is open', !(await js(`document.getElementById('side-dock').hidden`)));
    ok('templates are offered', (await js(`document.querySelectorAll('.tpl-item').length`)) >= 5);

    await js(`[...document.querySelectorAll('.tpl-item')].find(t => t.textContent.includes('Story Circle')).click()`);
    await wait(700);
    const text = await js(`document.querySelector('.dock-body .cm-content').textContent`);
    ok('the template filled the outline', text.includes('zone of comfort'));

    // the outline is a real editor, and it belongs to this document
    await load('somewhere else');
    await wait(600);
    ok('a different document starts without that outline',
      !(await js(`document.querySelector('.dock-body .cm-content')?.textContent || ''`)).includes('zone of comfort'));

    await load('# One\n\nbody', file);
    await wait(900);
    ok('reopening the document brings its outline back',
      (await js(`document.querySelector('.dock-body .cm-content')?.textContent || ''`)).includes('zone of comfort'));

    await click('#dock-close');
    await wait(300);
    ok('dock closes', await js(`document.getElementById('side-dock').hidden`));
  });

  await test('the manuscript stays editable while the outline is open', async () => {
    await load('first line');
    await click('#btn-outline');
    await wait(600);
    await select(10, 10);
    await type(' more');
    eq('typing still reaches the manuscript', await content(), 'first line more');
    await click('#dock-close');
    await wait(250);
  });

  await test('music pane plays local files, not hidden video', async () => {
    await click('#btn-music');
    await wait(500);
    ok('music pane opens', !(await js(`document.getElementById('side-dock').hidden`)));
    ok('local files are the default', await js(`!!document.querySelector('.music-player')`));
    await js(`[...document.querySelectorAll('.music-tabs .home-tab')].find(b => b.textContent === 'YouTube').click()`);
    await wait(600);
    ok('the YouTube tab hosts a browser view', await js(`!!document.querySelector('webview.yt-view')`));
    ok('it has its own search box',
      await js(`!!document.querySelector('.music-bar .filter-input')`));
    await js(`[...document.querySelectorAll('.music-tabs .home-tab')].find(b => b.textContent === 'Your files').click()`);
    await wait(300);
    await click('#dock-close');
    await wait(250);
  });

  await test('the browser view is scaled down and adjustable', async () => {
    await js(`window.__setPref('musicMode','youtube')`);
    await click('#btn-music');
    await wait(4000);
    const zoom = await js(`document.querySelector('webview').getZoomFactor()`);
    ok('starts smaller than full size', zoom > 0.4 && zoom < 1);
    eq('the label agrees', await js(`document.querySelector('.zoom-label').textContent`),
       `${Math.round(zoom * 100)}%`);

    await js(`[...document.querySelectorAll('.music-bar.tight .text-btn')].find(b => b.textContent === '\u2212').click()`);
    await wait(600);
    ok('the minus control shrinks it further',
      (await js(`document.querySelector('webview').getZoomFactor()`)) < zoom);
    await js(`window.__setPref('musicZoom', 0.75)`);
    await wait(300);
  });

  await test('leaving fullscreen gives the interface back', async () => {
    await js(`window.__setPref('musicMode','youtube')`);
    if (await js(`document.getElementById('side-dock').hidden`)) {
      await click('#btn-music');
      await wait(3000);
    }
    ok('a browser view is present', await js(`!!document.querySelector('webview')`));

    await js(`document.querySelector('webview').dispatchEvent(new Event('enter-html-full-screen'))`);
    await wait(400);
    eq('fullscreen state is marked', await js(`document.body.classList.contains('media-fullscreen')`), true);

    // Chromium leaves the guest sized for the whole window; imitate that.
    await js(`(() => { const w = document.querySelector('webview');
      w.style.position = 'fixed'; w.style.inset = '0';
      w.style.width = '100%'; w.style.height = '100%'; w.style.zIndex = '9999';
      w.dispatchEvent(new Event('leave-html-full-screen')); return true; })()`);
    await wait(700);

    const after = await js(`({
      bodyClass: document.body.classList.contains('media-fullscreen'),
      inline: document.querySelector('webview').style.position || '',
      titlebar: getComputedStyle(document.querySelector('.titlebar')).display !== 'none',
      sidebar: getComputedStyle(document.querySelector('.sidebar')).display !== 'none',
      contained: (() => { const r = document.querySelector('webview').getBoundingClientRect();
        const d = document.getElementById('side-dock').getBoundingClientRect();
        return r.left >= d.left - 1 && r.right <= d.right + 1; })()
    })`);
    eq('fullscreen state cleared', after.bodyClass, false);
    eq('the stretched styles are stripped', after.inline, '');
    eq('the title bar is back', after.titlebar, true);
    eq('the sidebar is back', after.sidebar, true);
    eq('the player is back inside its pane', after.contained, true);

    await click('#dock-close');
    await wait(250);
  });

  await test('youtube can be switched off entirely', async () => {
    await js(`window.api.prefs.set({youtubeEnabled:false})`);
    await js(`window.__setPref('youtubeEnabled', false)`);
    await wait(300);
    await click('#btn-music');
    await wait(500);
    eq('no YouTube tab is offered', await js(`document.querySelectorAll('.music-tabs').length`), 0);
    eq('no browser view exists', await js(`document.querySelectorAll('webview').length`), 0);
    ok('the local player is still there', await js(`!!document.querySelector('.music-player')`));

    await js(`window.__setPref('youtubeEnabled', true)`);
    await wait(400);
    ok('turning it back on restores the tab', (await js(`document.querySelectorAll('.music-tabs .home-tab').length`)) === 2);
    await click('#dock-close');
    await wait(250);
  });

  await test('youtube links are recognised, plain words are not', async () => {
    const parse = (u) => js(`window.__parseYouTube(${JSON.stringify(u)})`);
    ok('watch link', (await parse('https://www.youtube.com/watch?v=dQw4w9WgXcQ') || '').includes('watch?v=dQw4w9WgXcQ'));
    ok('short link', (await parse('https://youtu.be/dQw4w9WgXcQ') || '').includes('watch?v=dQw4w9WgXcQ'));
    ok('playlist link', (await parse('https://www.youtube.com/playlist?list=PL1234567890') || '').includes('playlist?list=PL1234567890'));
    eq('a search term is not a link', await parse('lofi beats'), null);
  });

  /* =========================================================== dropbox == */
  group = 'Dropbox';

  await test('folder detection', async () => {
    const info = await js(`window.api.app.dropbox()`);
    if (!info.root) {
      ok('no Dropbox installed, and that is reported cleanly', info.root === null);
    } else {
      ok('detected folder exists', typeof info.root === 'string' && info.root.length > 0);
      eq('the folder is on disk', fs.existsSync(info.root), true);
    }
  });

  /* ============================================================== view == */
  group = 'View modes';

  await test('focus, typewriter and status bar toggle', async () => {
    await menu('view:focus');
    eq('focus mode on', await js(`document.body.classList.contains('focus-mode')`), true);
    await menu('view:focus');
    eq('focus mode off', await js(`document.body.classList.contains('focus-mode')`), false);
    await menu('view:typewriter');
    eq('typewriter on', await js(`document.body.classList.contains('typewriter')`), true);
    await menu('view:typewriter');
    await menu('view:statusbar');
    eq('status bar hidden', await js(`document.body.classList.contains('status-on')`), false);
    await menu('view:statusbar');
    eq('status bar restored', await js(`document.body.classList.contains('status-on')`), true);
  });

  await test('navigator toggles', async () => {
    await menu('view:navigator');
    eq('navigator closed', await js(`document.body.classList.contains('nav-open')`), false);
    await menu('view:navigator');
    eq('navigator open', await js(`document.body.classList.contains('nav-open')`), true);
  });

  /* ============================================================ sprint == */
  group = 'Sprint';

  await test('starts and stops', async () => {
    await load('base text');
    await js(`window.__sprint().start(1, 50)`);
    await wait(400);
    ok('sprint shows in the status bar', !(await js(`document.getElementById('sprint-status').hidden`)));
    ok('sprint shows a countdown', /\d\d:\d\d/.test(await text('sprint-status')));
    await js(`window.__sprint().stop()`);
    await wait(300);
    ok('sprint clears', await js(`document.getElementById('sprint-status').hidden`));
  });

  const failed = report();
  await wait(200);
  try { fs.rmSync(WORK, { recursive: true, force: true }); } catch {}
  app.exit(failed ? 1 : 0);
});
