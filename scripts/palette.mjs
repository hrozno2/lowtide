/* Writes the first-paint palette in theme.css from the one themes.js derives.
 * The stylesheet paints before any script runs, so the two have to agree; they
 * have drifted apart twice by being kept in step by hand. Run: npm run palette
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { paletteFor } from '../src/renderer/js/themes.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const file = path.join(here, '..', 'src', 'renderer', 'css', 'theme.css');
const css = fs.readFileSync(file, 'utf8');

const derived = paletteFor('material');
let changed = 0;
const out = css.replace(/^(\s*)(--[a-z0-9-]+):\s*([^;]+);/gm, (line, indent, name, value) => {
  if (!(name in derived)) return line;
  const want = String(derived[name]);
  if (value.trim().toLowerCase() === want.toLowerCase()) return line;
  changed++;
  return `${indent}${name}:${' '.repeat(Math.max(1, 16 - name.length))}${want};`;
});

fs.writeFileSync(file, out);
console.log(changed ? `theme.css: ${changed} token(s) brought back in line` : 'theme.css: already in step');
