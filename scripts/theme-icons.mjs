/* Renders one app-icon variant per theme, plus two monochrome mark-only
   icons, so the taskbar/dock icon can follow whichever theme is active.
   node_modules/.bin/electron scripts/theme-icons.mjs

   The badge (face, bevel, glow) is the brand and stays fixed across every
   variant — only the tide mark's colour changes, to that theme's `primary`.
   The two monochrome icons drop the badge entirely: just the mark, solid
   white or solid dark, transparent behind it, for contexts that want a
   single-colour glyph rather than the full badge. */
import { app, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* Electron's main-process loader treats themes.js as CommonJS (no
   "type": "module" nearby) despite its ESM syntax, so importing it directly
   from here fails; duplicated rather than fought. Keep in sync with the
   `id`/`primary` pairs in src/renderer/js/themes.js — re-run this script
   after changing either. */
const THEME_ACCENTS = [
  ['material', '#4ec5c2'], ['midnight', '#6ea8fe'], ['dracula', '#bd93f9'],
  ['monokai', '#a6e22e'], ['solarized-dark', '#2aa198'], ['nord', '#88c0d0'],
  ['paper', '#0f766e'], ['clean', '#1a7f6b'], ['solarized-light', '#2aa198'],
  ['winter', '#2563a8']
];

const badgeSvg = (markColor) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <linearGradient id="face" x1="0.15" y1="0" x2="0.85" y2="1">
      <stop offset="0" stop-color="#3d4b4a"/>
      <stop offset="0.45" stop-color="#2b3736"/>
      <stop offset="1" stop-color="#1d2726"/>
    </linearGradient>
    <radialGradient id="sheen" cx="0.5" cy="0.42" r="0.62">
      <stop offset="0" stop-color="#7f9694" stop-opacity=".22"/>
      <stop offset="0.65" stop-color="#7f9694" stop-opacity=".05"/>
      <stop offset="1" stop-color="#000000" stop-opacity=".18"/>
    </radialGradient>
    <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#9fb4b2"/>
      <stop offset="0.35" stop-color="#546564"/>
      <stop offset="1" stop-color="#161e1e"/>
    </linearGradient>
    <filter id="brush" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9 0.012" numOctaves="2" seed="7"/>
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.09"/></feComponentTransfer>
    </filter>
    <filter id="glow" x="-35%" y="-35%" width="170%" height="170%">
      <feGaussianBlur stdDeviation="11" result="soft"/>
      <feMerge>
        <feMergeNode in="soft"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    <clipPath id="body">
      <rect x="72" y="72" width="880" height="880" rx="232"/>
    </clipPath>
  </defs>

  <rect x="72" y="72" width="880" height="880" rx="232" fill="url(#face)"/>
  <g clip-path="url(#body)">
    <rect x="72" y="72" width="880" height="880" filter="url(#brush)" opacity=".7"/>
    <rect x="72" y="72" width="880" height="880" fill="url(#sheen)"/>
  </g>
  <rect x="76" y="76" width="872" height="872" rx="228" fill="none"
        stroke="url(#rim)" stroke-width="9"/>

  <g fill="none" stroke="${markColor}" stroke-width="30" stroke-linecap="round"
     stroke-linejoin="round" filter="url(#glow)">
    <path d="M300 400 c 43 -34, 87 -34, 130 0 s 87 34, 130 0 s 87 -34, 130 0"/>
    <path d="M300 518 c 43 -34, 87 -34, 130 0 s 87 34, 130 0 s 87 -34, 130 0"/>
    <path d="M300 636 c 43 -34, 87 -34, 130 0 s 87 34, 130 0 s 87 -34, 130 0"/>
    <path d="M690 352 L690 684"/>
  </g>
</svg>`;

const monoSvg = (color) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <g fill="none" stroke="${color}" stroke-width="34" stroke-linecap="round" stroke-linejoin="round">
    <path d="M300 400 c 43 -34, 87 -34, 130 0 s 87 34, 130 0 s 87 -34, 130 0"/>
    <path d="M300 518 c 43 -34, 87 -34, 130 0 s 87 34, 130 0 s 87 -34, 130 0"/>
    <path d="M300 636 c 43 -34, 87 -34, 130 0 s 87 34, 130 0 s 87 -34, 130 0"/>
    <path d="M690 352 L690 684"/>
  </g>
</svg>`;

async function renderSvg(win, svg, size) {
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
    `<html><body style="margin:0;background:transparent">${svg}</body></html>`));
  await new Promise((r) => setTimeout(r, 250));
  const img = await win.webContents.capturePage();
  return img.resize({ width: size, height: size }).toPNG();
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024, height: 1024, show: false, frame: false, transparent: true,
    backgroundColor: '#00000000', webPreferences: { offscreen: true }
  });

  const themeDir = path.join(__dirname, '..', 'build', 'icons', 'themes');
  const monoDir = path.join(__dirname, '..', 'build', 'icons', 'mono');
  fs.mkdirSync(themeDir, { recursive: true });
  fs.mkdirSync(monoDir, { recursive: true });

  for (const [id, primary] of THEME_ACCENTS) {
    const png = await renderSvg(win, badgeSvg(primary), 256);
    const out = path.join(themeDir, `${id}.png`);
    fs.writeFileSync(out, png);
    console.log('wrote', out);
  }

  const mono = [['white', '#ffffff'], ['dark', '#141414']];
  for (const [name, color] of mono) {
    const png = await renderSvg(win, monoSvg(color), 512);
    const out = path.join(monoDir, `${name}.png`);
    fs.writeFileSync(out, png);
    console.log('wrote', out);
  }

  app.exit(0);
});
