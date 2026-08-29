/* Renders build/icon.png (1024²) with Electron so the project needs no
   image tooling: node_modules/.bin/electron scripts/icon.js */
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const SVG = `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <defs>
    <!-- brushed gunmetal face -->
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
    <!-- machined bevel around the edge -->
    <linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#9fb4b2"/>
      <stop offset="0.35" stop-color="#546564"/>
      <stop offset="1" stop-color="#161e1e"/>
    </linearGradient>
    <!-- fine radial brushing, barely there so it survives small sizes -->
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

  <!-- three lines of text that have become the tide, gathered at the caret -->
  <g fill="none" stroke="#7df0dc" stroke-width="30" stroke-linecap="round"
     stroke-linejoin="round" filter="url(#glow)">
    <path d="M300 400 c 43 -34, 87 -34, 130 0 s 87 34, 130 0 s 87 -34, 130 0"/>
    <path d="M300 518 c 43 -34, 87 -34, 130 0 s 87 34, 130 0 s 87 -34, 130 0"/>
    <path d="M300 636 c 43 -34, 87 -34, 130 0 s 87 34, 130 0 s 87 -34, 130 0"/>
    <path d="M690 352 L690 684"/>
  </g>
</svg>`;

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1024, height: 1024, show: false, frame: false, transparent: true,
    backgroundColor: '#00000000', webPreferences: { offscreen: true }
  });
  await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
    `<html><body style="margin:0;background:transparent">${SVG}</body></html>`));
  await new Promise((r) => setTimeout(r, 600));
  const img = await win.webContents.capturePage();
  const out = path.join(__dirname, '..', 'build', 'icon.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, img.toPNG());
  console.log('wrote', out, img.getSize());
  app.exit(0);
});
