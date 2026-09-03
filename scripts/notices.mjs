/* Collects the licence text of everything that ends up in the shipped bundle
   into THIRD-PARTY-NOTICES.md.  node scripts/notices.mjs */
import * as esbuild from 'esbuild';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const build = await esbuild.build({
  entryPoints: ['src/renderer/js/app.js', 'src/renderer/js/home.js'],
  bundle: true, write: false, metafile: true, format: 'iife', outdir: '/tmp/notices'
});

const packages = new Set();
for (const file of Object.keys(build.metafile.inputs)) {
  const m = file.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/);
  if (m) packages.add(m[1]);
}

const LICENCE_FILES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'license'];

const sections = [...packages].sort().map((name) => {
  const dir = join('node_modules', name);
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const file = LICENCE_FILES.map((f) => join(dir, f)).find((f) => existsSync(f));
  const text = file ? readFileSync(file, 'utf8').trim() : '(no licence file shipped in the package)';
  return `## ${name} ${pkg.version}\n\n${pkg.license || 'see below'}${pkg.homepage ? ` — ${pkg.homepage}` : ''}\n\n\`\`\`\n${text}\n\`\`\`\n`;
});

const font = readFileSync('src/renderer/fonts/OFL.txt', 'utf8').trim();

writeFileSync('THIRD-PARTY-NOTICES.md', `# Third-party notices

Low Tide itself is MIT licensed (see LICENSE). It bundles the components below.

Electron, which supplies the runtime, is MIT licensed but embeds Chromium and
Node.js under their own terms; the full set is included in every packaged build
as \`LICENSES.chromium.html\`.

---

# Fonts

## Courier Prime

SIL Open Font License 1.1 — https://quoteunquoteapps.com/courierprime/

\`\`\`
${font}
\`\`\`

---

# Bundled JavaScript

${sections.join('\n---\n\n')}`);

console.log(`wrote THIRD-PARTY-NOTICES.md for ${packages.size} packages`);
