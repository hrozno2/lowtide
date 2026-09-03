/* Update checking.
 *
 * Low Tide asks GitHub whether a newer release exists and, on most platforms,
 * offers a link — no code signing needed, and the running app is untouched
 * until you choose to leave it. Windows and a real AppImage go further and
 * self-install through electron-updater. A pacman install and a Homebrew
 * cask can't do that (there's no electron-updater support for either), but
 * both still need something better than "go find the file yourself": the
 * installPacman/installHomebrew functions below run the one privileged
 * command each format actually needs — pkexec pacman -U, or a Homebrew
 * upgrade — behind the OS's own permission prompt (polkit, or macOS's admin
 * dialog), never silently.
 */
'use strict';

const https = require('https');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;   // at most four times a day
const TIMEOUT_MS = 6000;

/** "v1.2.3" / "1.2.3-beta.1" -> [1, 2, 3, 'beta.1'] */
function parseVersion(raw) {
  const text = String(raw || '').trim().replace(/^v/i, '');
  const [core, pre] = text.split('-');
  const parts = core.split('.').map((n) => parseInt(n, 10));
  if (parts.some((n) => Number.isNaN(n))) return null;
  while (parts.length < 3) parts.push(0);
  return { parts: parts.slice(0, 3), pre: pre || '' };
}

/**
 * -1 when a < b, 0 when equal, 1 when a > b.
 * A release without a pre-release suffix beats one with the same numbers.
 */
function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) {
    if (x.parts[i] !== y.parts[i]) return x.parts[i] < y.parts[i] ? -1 : 1;
  }
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;      // 1.0.0 > 1.0.0-beta
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/** owner/repo from a package.json repository field. */
function repoSlug(pkg) {
  const url = (pkg.repository && (pkg.repository.url || pkg.repository)) || '';
  const m = String(url).match(/github\.com[/:]([^/]+)\/([^/.]+)/i);
  return m ? `${m[1]}/${m[2]}` : null;
}

async function fetchLatest(slug) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.github.com/repos/${slug}/releases/latest`, {
      signal: controller.signal,
      headers: { Accept: 'application/vnd.github+json' }
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;                 // offline, rate limited, whatever — stay quiet
  } finally {
    clearTimeout(timer);
  }
}

/**
 * @param opts.currentVersion  the running version
 * @param opts.pkg             package.json, for the repository URL
 * @param opts.prefs          the preference store
 * @param opts.force           ignore both the interval and the switch
 */
async function checkForUpdate({ currentVersion, pkg, prefs, force = false }) {
  if (!force && prefs.get('updateCheck') === false) {
    return { checked: false, reason: 'disabled' };
  }

  const last = Number(prefs.get('lastUpdateCheck')) || 0;
  if (!force && Date.now() - last < CHECK_INTERVAL_MS) {
    return { checked: false, reason: 'checked recently' };
  }

  const slug = repoSlug(pkg);
  if (!slug) return { checked: false, reason: 'no repository configured' };

  const release = await fetchLatest(slug);
  prefs.set({ lastUpdateCheck: Date.now() });
  if (!release || !release.tag_name) return { checked: true, available: false };

  const newer = compareVersions(release.tag_name, currentVersion) > 0;
  return {
    checked: true,
    available: newer,
    version: String(release.tag_name).replace(/^v/i, ''),
    current: currentVersion,
    url: release.html_url,
    notes: (release.body || '').slice(0, 500)
  };
}

/* Windows and the Linux AppImage can install a new build themselves via
   electron-updater; mac stays on the notice-and-link path above, since an
   unsigned, unnotarised build can't self-update reliably through Squirrel.Mac.
   Required lazily so the plain-Node unit tests, which only exercise the pure
   functions above, never have to load an Electron-aware module. */
let wired = false;

/** Wires download/install events to a callback, once per process. */
function initAutoUpdater(onEvent) {
  const { autoUpdater } = require('electron-updater');
  if (wired) return autoUpdater;
  wired = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('download-progress', (p) => onEvent('progress', {
    percent: p.percent, bytesPerSecond: p.bytesPerSecond, transferred: p.transferred, total: p.total
  }));
  autoUpdater.on('update-downloaded', () => onEvent('downloaded', {}));
  autoUpdater.on('error', (err) => onEvent('error', { message: err.message }));
  return autoUpdater;
}

/**
 * Runs one electron-updater check and maps it into the same shape
 * checkForUpdate() returns above, so the renderer doesn't need to know
 * which path a given platform is on.
 */
function checkForUpdateAuto(currentVersion) {
  const { autoUpdater } = require('electron-updater');
  return new Promise((resolve) => {
    const done = (result) => {
      autoUpdater.removeListener('update-available', onAvailable);
      autoUpdater.removeListener('update-not-available', onNotAvailable);
      autoUpdater.removeListener('error', onError);
      resolve(result);
    };
    const onAvailable = (info) => done({
      checked: true,
      available: true,
      version: String(info.version).replace(/^v/i, ''),
      current: currentVersion,
      url: `https://github.com/hrozno2/lowtide/releases/tag/v${info.version}`,
      notes: typeof info.releaseNotes === 'string' ? info.releaseNotes.slice(0, 500) : ''
    });
    const onNotAvailable = () => done({ checked: true, available: false });
    const onError = (err) => done({ checked: false, reason: err.message });
    autoUpdater.once('update-available', onAvailable);
    autoUpdater.once('update-not-available', onNotAvailable);
    autoUpdater.once('error', onError);
    autoUpdater.checkForUpdates().catch(onError);
  });
}

/* Homebrew Cask copies the .app straight into /Applications with nothing left
   behind that this process could inspect, so there's no reliable way to tell
   from the running app alone. Asking `brew` itself is the honest way — by
   full path, since a GUI app launched from Finder doesn't inherit the shell
   PATH Homebrew installs itself onto. */
const BREW_PATHS = ['/opt/homebrew/bin/brew', '/usr/local/bin/brew'];
function findBrew() {
  return BREW_PATHS.find((p) => fs.existsSync(p)) || null;
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 5 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message || '').trim() || `${cmd} failed`));
      else resolve(stdout);
    });
  });
}

/** Follows redirects itself: GitHub's release-asset URLs 302 to a signed S3
    link, and a plain https.get does not chase that on its own. */
function httpGet(url, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'low-tide-updater' } }, (res) => {
      const loc = res.headers.location;
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && loc && redirectsLeft > 0) {
        res.resume();
        resolve(httpGet(new URL(loc, url).toString(), redirectsLeft - 1));
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`GitHub returned ${res.statusCode} for ${url}`));
        return;
      }
      resolve(res);
    }).on('error', reject);
  });
}

/** The matching asset from the latest release, or null. `namePattern` is
    matched against each asset's file name (e.g. /-linux-x64\.pacman$/). */
async function findReleaseAsset(slug, namePattern) {
  const release = await fetchLatest(slug);
  const asset = release && Array.isArray(release.assets)
    ? release.assets.find((a) => namePattern.test(a.name))
    : null;
  return asset ? { url: asset.browser_download_url, name: asset.name, size: asset.size } : null;
}

/** Downloads to a temp file, reporting 0..1 progress as bytes arrive. */
async function downloadToTemp(url, onProgress) {
  const res = await httpGet(url);
  const total = Number(res.headers['content-length']) || 0;
  const dest = path.join(os.tmpdir(), `lowtide-update-${Date.now()}-${path.basename(new URL(url).pathname)}`);
  const out = fs.createWriteStream(dest);
  let received = 0;
  await new Promise((resolve, reject) => {
    res.on('data', (chunk) => {
      received += chunk.length;
      if (onProgress && total) onProgress(received / total);
    });
    res.on('error', reject);
    out.on('error', reject);
    out.on('finish', resolve);
    res.pipe(out);
  });
  return dest;
}

/**
 * Downloads the release's pacman package and installs it with pkexec, which
 * puts up polkit's own graphical password prompt — the one step that can't
 * be skipped, since writing into /opt and pacman's database needs root no
 * matter who asks. --noconfirm because pkexec gives pacman no terminal to
 * prompt on for the "proceed? [Y/n]" it would otherwise ask.
 */
async function installPacman(pkg, onProgress) {
  const slug = repoSlug(pkg);
  const asset = slug && await findReleaseAsset(slug, /-linux-x64\.pacman$/);
  if (!asset) throw new Error('no pacman package found in the latest release');
  const file = await downloadToTemp(asset.url, onProgress);
  try {
    await run('pkexec', ['pacman', '-U', '--noconfirm', file]);
  } finally {
    fsp.unlink(file).catch(() => {});
  }
}

/**
 * Runs the Homebrew upgrade behind macOS's own admin-password dialog. A
 * personal-tap cask upgrade does not actually need elevation — Homebrew
 * itself never wants sudo — but asking anyway keeps this the same shape as
 * the Linux path: a real, visible gate in front of anything that changes
 * the app on its own, rather than a click that just does it.
 */
async function installHomebrew() {
  const brew = findBrew();
  if (!brew) throw new Error('Homebrew was not found');
  const script = `do shell script "${brew} upgrade lowtide" with administrator privileges`;
  await run('osascript', ['-e', script]);
}

module.exports = {
  checkForUpdate, compareVersions, parseVersion, repoSlug, CHECK_INTERVAL_MS,
  initAutoUpdater, checkForUpdateAuto, findBrew, installPacman, installHomebrew
};
