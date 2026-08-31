/* Dev utility: boot the real app, drive it through the same IPC the menus use,
   and capture PNGs of the renderer.  node_modules/.bin/electron scripts/shot.js
   --out=/tmp/shot --seed=samples/x.fountain --steps=default,nav,focus,preview  */
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

// Screenshots run against a throwaway profile so they never read or write the
// preferences of a real install.
app.setPath('userData', path.join(app.getPath('temp'), `low-tide-shot-profile-${process.pid}`));

const store = require(path.join(__dirname, '..', 'src', 'main', 'store.js'));
process.env.LOWTIDE_HARNESS = '1';
require(path.join(__dirname, '..', 'src', 'main', 'main.js'));

// --demo seeds throwaway goal history so the stats panel can be reviewed,
// then puts the real preferences back before exiting.
if (process.argv.includes('--demo')) {
  const prefs = store.getPrefs();
  const day = (back) => {
    const d = new Date(); d.setDate(d.getDate() - back);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  prefs.set({ dailyGoal: 500,
    goalDays: { [day(0)]: 261, [day(2)]: 500, [day(3)]: 512, [day(5)]: 500, [day(6)]: 340 } });
}

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const out = arg('out', '/tmp/low-tide');
const seed = arg('seed', '');
const steps = arg('steps', 'default').split(',');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function capture(win, name) {
  const img = await win.webContents.capturePage();
  const file = `${out}-${name}.png`;
  fs.writeFileSync(file, img.toPNG());
  console.log('wrote', file);
}

setTimeout(() => { console.log('TIMEOUT: screenshot run stalled'); app.exit(2); }, 120000);
process.on('unhandledRejection', (err) => {
  console.log('REJECTED:', err && err.message);
  app.exit(3);
});

app.whenReady().then(async () => {
  await wait(1800);

  if (process.argv.includes('--home')) {
    const home = BrowserWindow.getAllWindows().find((w) =>
      w.webContents.getURL().includes('home.html'));
    if (!home) { console.log('no home window'); app.exit(1); return; }
    home.setSize(940, 600);
    await wait(700);
    await capture(home, 'home');
    app.exit(0);
    return;
  }

  // A fresh profile lands on Home; open a document from it first.
  const findDoc = () => BrowserWindow.getAllWindows()
    .find((w) => !w.isDestroyed() && w.webContents.getURL().includes('index.html'));

  if (!findDoc()) {
    const home = BrowserWindow.getAllWindows()
      .find((w) => w.webContents.getURL().includes('home.html'));
    if (home) {
      // The bundled sample, not a blank page: the pictures are of a document
      // with something in it, and several steps address particular lines.
      const starter = arg('starter', 'lighthouse');
      home.webContents.executeJavaScript(`window.api.home.create('${starter}')`, true).catch(() => {});
      await wait(2000);
    }
  }

  const win = findDoc();
  if (!win) { console.log('no document window'); app.exit(1); return; }
  win.setSize(1180, 820);
  await wait(300);

  if (seed) {
    const content = fs.readFileSync(path.resolve(seed), 'utf8');
    win.webContents.send('doc:load', { path: path.resolve(seed), content });
    await wait(900);
  }

  for (const step of steps) {
    switch (step) {
      case 'default': break;
      case 'nav-closed': win.webContents.send('menu', 'view:navigator'); break;
      case 'focus': win.webContents.send('menu', 'view:focus'); break;
      case 'preview': win.webContents.send('menu', 'view:preview'); break;
      case 'prefs': win.webContents.send('menu', 'tools:prefs'); break;
      case 'sprint': win.webContents.send('menu', 'tools:sprint'); break;
      case 'goto': win.webContents.send('menu', 'tools:goto'); break;
      case 'scroll':
        await win.webContents.executeJavaScript(
          `document.querySelector(".cm-scroller").scrollTop = ${+arg('scrolltop', 1500)}`, true);
        break;
      case 'preview-title':
        win.webContents.send('menu', 'view:preview');
        await wait(500);
        await win.webContents.executeJavaScript(
          'document.getElementById("pv-title").click()', true);
        break;
      case 'revisions':
        await win.webContents.executeJavaScript(
          'document.querySelector(\'.side-tab[data-tab="revisions"]\').click()', true);
        break;
      case 'scratch':
        await win.webContents.executeJavaScript(
          'document.querySelector(\'.side-tab[data-tab="scratch"]\').click()', true);
        break;
      case 'theme-paper':
        await win.webContents.executeJavaScript(
          'document.getElementById("btn-theme").click()', true);
        await wait(300);
        await win.webContents.executeJavaScript(
          '[...document.querySelectorAll(".theme-row")].find(r => r.textContent.startsWith("Paper")).click()', true);
        await wait(300);
        await win.webContents.executeJavaScript('document.getElementById("scrim").click()', true);
        break;
      case 'themepicker':
        await win.webContents.executeJavaScript(
          'document.getElementById("btn-theme").click()', true);
        break;
      case 'newgoal':
        await win.webContents.executeJavaScript(
          'document.querySelector(\'.side-tab[data-tab="stats"]\').click()', true);
        await wait(300);
        await win.webContents.executeJavaScript('document.getElementById("goal-face").click()', true);
        break;
      case 'revmenu':
        await win.webContents.executeJavaScript(
          'document.querySelector(\'.side-tab[data-tab="revisions"]\').click()', true);
        await wait(250);
        await win.webContents.executeJavaScript('document.getElementById("rev-new").click()', true);
        await wait(350);
        await win.webContents.executeJavaScript(
          '(() => { document.querySelector(".panel input[type=\'text\']").value = "First Pass"; return true; })()', true);
        await win.webContents.executeJavaScript(
          '[...document.querySelectorAll(".panel .btn")].find(b => b.textContent === "Create").click()', true);
        await wait(400);
        await win.webContents.executeJavaScript('document.querySelector(".rev-item .more").click()', true);
        break;
      case 'layout':
        // hover near the switch so it fades in for the shot
        await win.webContents.executeJavaScript(`(() => {
          const r = document.getElementById('view-switch').getBoundingClientRect();
          document.querySelector('.pane').dispatchEvent(new MouseEvent('mousemove',
            { clientX: Math.round(r.right + 20), clientY: Math.round(r.bottom + 20), bubbles: true }));
          return true; })()`, true);
        break;
      case 'outline+pages':
        await win.webContents.executeJavaScript('document.getElementById("btn-outline").click()', true);
        await wait(700);
        await win.webContents.executeJavaScript(`(() => {
          const t = [...document.querySelectorAll('.tpl-item')].find(x => x.textContent.includes('Story Circle'));
          if (t) t.click(); return true; })()`, true);
        await wait(700);
        await win.webContents.executeJavaScript('document.getElementById("btn-preview").click()', true);
        await wait(1500);
        await win.webContents.executeJavaScript(`(() => {
          const r = document.getElementById('view-switch').getBoundingClientRect();
          document.querySelector('.pane').dispatchEvent(new MouseEvent('mousemove',
            { clientX: Math.round(r.right + 20), clientY: Math.round(r.bottom + 20), bubbles: true }));
          return true; })()`, true);
        break;
      case 'reference':
        await win.webContents.executeJavaScript(
          'document.querySelector(\'.side-tab[data-tab="reference"]\').click()', true);
        await wait(2500);
        break;
      case 'music':
        await win.webContents.executeJavaScript('document.getElementById("btn-music").click()', true);
        await wait(900);
        break;
      case 'revisions-marked':
        await win.webContents.executeJavaScript(
          'document.querySelector(\'.side-tab[data-tab="revisions"]\').click()', true);
        await wait(300);
        await win.webContents.executeJavaScript('document.getElementById("rev-new").click()', true);
        await wait(400);
        await win.webContents.executeJavaScript(
          '(() => { document.querySelector(".panel input[type=\'text\']").value = "Second Pass"; return true; })()', true);
        await win.webContents.executeJavaScript(
          '[...document.querySelectorAll(".panel .btn")].find(b => b.textContent === "Create").click()', true);
        await wait(500);
        await win.webContents.executeJavaScript(`(() => {
          const v = window.__lowTideView;
          const at = v.state.doc.line(7).to;
          v.dispatch({ selection: { anchor: at } });
          v.dispatch({ changes: { from: at, insert: ' She had never named it, and now it was too late to start.' },
                       selection: { anchor: at + 1 }, userEvent: 'input' });
          return true; })()`, true);
        await wait(800);
        break;
      case 'lookup':
        await win.webContents.executeJavaScript(
          'document.querySelector(\'.side-tab[data-tab="reference"]\').click()', true);
        await wait(400);
        await win.webContents.executeJavaScript(
          '(() => { const i = document.getElementById("ref-input"); i.value = "indifferent"; return true; })()', true);
        await win.webContents.executeJavaScript('document.getElementById("ref-go").click()', true);
        await wait(9000);
        break;
      case 'stats':
        await win.webContents.executeJavaScript('document.querySelector(\'.side-tab[data-tab="stats"]\').click()', true);
        break;
      case 'help': win.webContents.send('menu', 'help:markup'); break;
      default: break;
    }
    await wait(650);
    await capture(win, step);
    if (['prefs', 'sprint', 'goto', 'help', 'themepicker'].includes(step)) {
      await win.webContents.executeJavaScript('document.getElementById("scrim").click()', true);
      await wait(250);
    }
    if (step === 'preview') { win.webContents.send('menu', 'view:preview'); await wait(300); }
    if (step === 'focus') { win.webContents.send('menu', 'view:focus'); await wait(300); }
    if (step === 'nav-closed') { win.webContents.send('menu', 'view:navigator'); await wait(300); }
  }

  app.exit(0);
});
