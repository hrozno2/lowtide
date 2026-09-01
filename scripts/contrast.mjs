/* Contrast audit: every theme, every piece of text against what sits behind
   it, as a WCAG ratio. Run with: node scripts/contrast.mjs */
import { THEMES, paletteFor } from '../src/renderer/js/themes.js';

const rgb = (c) => {
  const s = String(c).trim();
  const m = s.match(/^rgba?\(([^)]+)\)$/i);
  if (m) return m[1].split(',').slice(0, 3).map((n) => parseFloat(n));
  const h = s.replace('#', '');
  const f = h.length === 3 ? h.split('').map((x) => x + x).join('') : h;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16));
};

const lum = (c) => {
  const [r, g, b] = rgb(c).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const ratio = (a, b) => {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/* What is checked, and how much it needs. Body copy is held to AA (4.5);
   labels and dim metadata to the large-text bar (3.0), since they are
   supporting text rather than the words being read. */
const CHECKS = [
  ['--text', '--bg', 4.5, 'body text on the page'],
  ['--text', '--surface', 4.5, 'body text on a panel'],
  ['--text-2', '--surface', 4.5, 'secondary text on a panel'],
  ['--text-2', '--surface-2', 4.5, 'secondary text on a row'],
  ['--text-3', '--surface', 3.0, 'dim text on a panel'],
  ['--text-3', '--surface-2', 3.0, 'dim text on a row'],
  ['--text-4', '--surface', 3.0, 'labels on a panel'],
  ['--text-4', '--surface-2', 3.0, 'labels on a row'],
  ['--primary', '--bg', 4.5, 'headings in the manuscript'],
  ['--primary-2', '--bg', 4.5, 'sub-headings'],
  ['--note', '--bg', 4.5, 'notes'],
  ['--rule', '--bg', 4.5, 'markup rules'],
  ['--stat', '--surface', 3.0, 'statistics'],
  ['--caret', '--bg', 3.0, 'the caret']
];

let failures = 0;
const rows = [];

for (const theme of THEMES) {
  const p = paletteFor(theme.id);
  for (const [fg, bg, min, what] of CHECKS) {
    const a = p[fg], b = p[bg];
    if (!a || !b) { rows.push([theme.id, what, 'MISSING', min, false]); failures++; continue; }
    const r = ratio(a, b);
    const ok = r >= min;
    if (!ok) failures++;
    rows.push([theme.id, what, r.toFixed(2), min, ok]);
  }
}

const bad = rows.filter((r) => !r[4]);
console.log(`${rows.length} checks across ${THEMES.length} themes, ${bad.length} below target\n`);
if (bad.length) {
  let theme = '';
  for (const [id, what, r, min] of bad) {
    if (id !== theme) { theme = id; console.log(`  ${id}`); }
    console.log(`      ${String(r).padStart(6)}  (needs ${min})  ${what}`);
  }
} else {
  console.log('  every piece of text clears its target.');
}

// Worst case per theme, so the tight ones are visible even when they pass.
console.log('\nlowest ratio in each theme:');
for (const theme of THEMES) {
  const mine = rows.filter((r) => r[0] === theme.id && r[2] !== 'MISSING');
  const worst = mine.reduce((m, r) => (parseFloat(r[2]) < parseFloat(m[2]) ? r : m));
  console.log(`  ${theme.id.padEnd(16)} ${String(worst[2]).padStart(6)}  ${worst[1]}`);
}
process.exit(failures ? 1 : 0);
