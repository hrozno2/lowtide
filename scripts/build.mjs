import * as esbuild from 'esbuild';
import { existsSync, statSync, unlinkSync } from 'fs';

const watch = process.argv.includes('--watch');

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: {
    renderer: 'src/renderer/js/app.js',
    home: 'src/renderer/js/home.js'
  },
  bundle: true,
  outdir: 'src/renderer/dist',
  format: 'iife',
  platform: 'browser',
  target: ['chrome128'],
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  // MIT requires the copyright notices to ship with the code; keep them in a
  // sidecar file next to the bundle rather than dropping them.
  legalComments: 'external',
  logLevel: 'info'
};

// esbuild always writes the sidecar, even when no dependency carries a banner.
// Attribution lives in THIRD-PARTY-NOTICES.md, so drop the empty files.
function pruneEmptyNotices() {
  for (const f of ['src/renderer/dist/renderer.js.LEGAL.txt',
                   'src/renderer/dist/home.js.LEGAL.txt']) {
    if (existsSync(f) && statSync(f).size === 0) unlinkSync(f);
  }
}

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('[low-tide] watching renderer…');
} else {
  await esbuild.build(options);
  pruneEmptyNotices();
}
