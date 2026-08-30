/* Update checking.
 *
 * Low Tide does not install anything by itself: it asks GitHub whether a newer
 * release exists and, if so, offers a link. That works on every platform we
 * ship to, needs no code signing, and never touches the running app.
 */
'use strict';

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

module.exports = { checkForUpdate, compareVersions, parseVersion, repoSlug, CHECK_INTERVAL_MS };
