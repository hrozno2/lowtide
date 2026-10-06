/* Words-per-page probe.
 *
 * A page is only "about 300 words" if the type, the measure and the leading
 * actually make it so, and no arithmetic on average word length gets that
 * right — line breaking decides it. So this boots the real app, lays real
 * novel prose out in the real print geometry, and reads back what a page
 * holds. It is how the shipped page in src/main/store.js was chosen.
 *
 *   npx electron scripts/wpp.js corpus/*.md
 *
 * A corpus is a plain manuscript: one `# Chapter` head and the prose under
 * it. Use several books — word length varies more between authors than the
 * page does. Page counts are integers, so give each corpus 20,000 words or
 * more, or the rounding swamps the difference between two candidates.
 */
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const base = path.join(__dirname, '..');
const PROFILE = path.join(os.tmpdir(), `low-tide-wpp-${process.pid}`);
app.setPath('userData', PROFILE);
fs.mkdirSync(PROFILE, { recursive: true });
process.env.LOWTIDE_HARNESS = '1';
require(path.join(base, 'src', 'main', 'main.js'));

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
setTimeout(() => { console.log('TIMED OUT'); app.exit(2); }, 600000);

/* Candidate pages. The first is what Low Tide ships today. */
/* By default, every page Preferences offers. Pass --candidates to compare
   geometries that are not presets yet. */
const { pagePresets } = require(path.join(base, 'src', 'main', 'store'));
const CANDIDATES = pagePresets().map((x) => Object.assign({ name: `${x.name} (${x.trim})` }, x.prefs));

app.whenReady().then(async () => {
  await wait(2500);
  const findDoc = () => BrowserWindow.getAllWindows()
    .find((w) => !w.isDestroyed() && w.webContents.getURL().includes('index.html'));
  if (!findDoc()) {
    const home = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().includes('home.html'));
    if (!home) { console.log('no window'); app.exit(1); return; }
    home.webContents.executeJavaScript(`window.api.home.create('blank')`, true).catch(() => {});
    await wait(2500);
  }
  const win = findDoc();
  if (!win) { console.log('no document window'); app.exit(1); return; }
  const wc = win.webContents;
  const js = (code) => wc.executeJavaScript(code, true);

  const files = process.argv.slice(2).filter((a) => a.endsWith('.md'));
  const rows = [];

  for (const file of files) {
    const body = fs.readFileSync(file, 'utf8');
    // Words the way the reader counts them: the prose, not the heading.
    const words = body.split('\n').filter((l) => !l.startsWith('#')).join(' ')
      .split(/\s+/).filter(Boolean).length;
    wc.send('doc:load', { path: null, content: body });
    await wait(1500);
    if (await js(`document.getElementById('preview-host').hidden`)) {
      wc.send('menu', 'view:preview');
      await wait(1500);
    }

    for (const c of CANDIDATES) {
      for (const [k, v] of Object.entries(c)) {
        if (k === 'name') continue;
        await js(`window.__setPref(${JSON.stringify(k)}, ${JSON.stringify(v)})`);
      }
      await wait(250);
      await js(`(async () => { await document.fonts.ready; window.__forcePaginate(); })()`);
      await wait(900);
      const got = await js(`(() => {
        const pages = document.querySelectorAll('#preview-scroll .page:not(.page-measure)');
        const el = pages[0];
        const cs = el ? getComputedStyle(el) : null;
        return { pages: pages.length,
                 col: cs ? (parseFloat(cs.width) - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) : 0,
                 lh: cs ? parseFloat(cs.lineHeight) : 0,
                 box: cs ? (parseFloat(cs.height) - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom)) : 0 }; })()`);
      rows.push({ corpus: path.basename(file, '.md'), name: c.name, words,
                  pages: got.pages, wpp: got.pages ? Math.round(words / got.pages) : 0,
                  lines: got.lh ? Math.round(got.box / got.lh) : 0,
                  col: (got.col / 96).toFixed(2) });
    }
  }

  const by = {};
  for (const r of rows) (by[r.name] = by[r.name] || []).push(r);
  console.log('\n  page                           col   lines   words/page by corpus      mean');
  for (const [name, rs] of Object.entries(by)) {
    const each = rs.map((r) => `${r.corpus.replace('corpus-','').slice(0, 4)} ${String(r.wpp).padStart(4)}`).join('  ');
    const mean = Math.round(rs.reduce((a, r) => a + r.wpp, 0) / rs.length);
    console.log(`  ${name.padEnd(30)} ${rs[0].col}  ${String(rs[0].lines).padStart(3)}    ${each}   ${String(mean).padStart(4)}`);
  }
  app.exit(0);
});
