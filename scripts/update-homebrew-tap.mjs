#!/usr/bin/env node
/* Updates Casks/lowtide.rb in the (separate) homebrew-lowtide tap repo to
   point at a newly published release, and pushes the change.

   Called from .github/workflows/release.yml after the mac build; safe to
   run by hand too, once the tap repo (github.com/hrozno2/homebrew-lowtide)
   exists:

     HOMEBREW_TAP_TOKEN=<pat> node scripts/update-homebrew-tap.mjs 1.0.8

   Exits quietly (not an error) when HOMEBREW_TAP_TOKEN isn't set, since the
   tap repo may not exist yet — this must never fail a release.
*/
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const version = process.argv[2];
if (!version) {
  console.error('usage: node scripts/update-homebrew-tap.mjs <version>');
  process.exit(1);
}

const token = process.env.HOMEBREW_TAP_TOKEN;
if (!token) {
  console.log('HOMEBREW_TAP_TOKEN is not set — skipping the Homebrew tap update.');
  process.exit(0);
}

const TAP_REPO = 'hrozno2/homebrew-lowtide';

async function sha256Of(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not fetch ${url}: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return createHash('sha256').update(buf).digest('hex');
}

const armUrl = `https://github.com/hrozno2/lowtide/releases/download/v${version}/LowTide-${version}-mac-arm64.dmg`;
const intelUrl = `https://github.com/hrozno2/lowtide/releases/download/v${version}/LowTide-${version}-mac-x64.dmg`;

const [armSha, intelSha] = await Promise.all([sha256Of(armUrl), sha256Of(intelUrl)]);

let cask = readFileSync(new URL('../packaging/homebrew/Casks/lowtide.rb', import.meta.url), 'utf8');
cask = cask.replace(/version "[^"]*"/, `version "${version}"`);
cask = cask.replace(
  /sha256 arm:\s*"[0-9a-f]+",\s*\n\s*intel:\s*"[0-9a-f]+"/,
  `sha256 arm:   "${armSha}",\n         intel: "${intelSha}"`
);

const dir = mkdtempSync(join(tmpdir(), 'homebrew-lowtide-'));
const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'inherit' });

git('clone', `https://x-access-token:${token}@github.com/${TAP_REPO}.git`, '.');
writeFileSync(join(dir, 'Casks', 'lowtide.rb'), cask);
git('config', 'user.name', 'lowtide-release-bot');
git('config', 'user.email', 'hrozno2@users.noreply.github.com');
git('add', 'Casks/lowtide.rb');

try {
  execFileSync('git', ['diff', '--cached', '--quiet'], { cwd: dir });
  console.log('Cask already up to date; nothing to push.');
} catch {
  git('commit', '-m', `lowtide ${version}`);
  git('push');
  console.log(`Pushed lowtide ${version} to ${TAP_REPO}.`);
}
