/* Save safety.
 *
 * Two separate concerns:
 *   1. A save must never leave a half-written manuscript on disk, so every
 *      write goes to a temp file in the same directory, is flushed, and is
 *      then renamed over the target — rename is atomic on every platform we
 *      ship to.
 *   2. Even a correct save can save the wrong thing, so each document keeps a
 *      rolling set of past versions outside the document's own folder.
 */
'use strict';
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KEEP = 40;                       // versions retained per document
const MIN_GAP_MS = 90 * 1000;          // never snapshot more often than this

function backupsRoot() {
  return path.join(app.getPath('userData'), 'backups');
}

function keyFor(filePath) {
  return crypto.createHash('sha1').update(filePath).digest('hex').slice(0, 16);
}

function dirFor(filePath) {
  return path.join(backupsRoot(), keyFor(filePath));
}

/** Write via temp file + rename so a crash cannot truncate the original. */
function writeAtomic(target, content) {
  const dir = path.dirname(target);
  const tmp = path.join(dir, `.${path.basename(target)}.${process.pid}.tmp`);
  let fd;
  try {
    fd = fs.openSync(tmp, 'w');
    fs.writeFileSync(fd, content, typeof content === 'string' ? 'utf8' : undefined);
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tmp, target);
  } catch (err) {
    if (fd != null) { try { fs.closeSync(fd); } catch {} }
    try { fs.unlinkSync(tmp); } catch {}
    throw err;
  }
}

function parseStamp(name) {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})/.exec(name);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
}

/** Versions for one document, newest first. */
function listIn(dir) {
  let names;
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith('.txt') && n !== 'source.txt')
    .map((n) => {
      const file = path.join(dir, n);
      let size = 0;
      try { size = fs.statSync(file).size; } catch {}
      return { name: n, file, size, time: (parseStamp(n) || new Date(0)).getTime() };
    })
    .sort((a, b) => b.time - a.time);
}

function listBackups(filePath) {
  return listIn(dirFor(filePath));
}

function prune(dir) {
  for (const entry of listIn(dir).slice(KEEP)) {
    try { fs.unlinkSync(entry.file); } catch {}
  }
}

/**
 * Keep a copy of `content` for `filePath`. Skips when nothing changed since the
 * last version, or when the last one is very recent, so a stream of autosaves
 * does not flood the store.
 */
function snapshot(filePath, content, { force = false } = {}) {
  if (!filePath || typeof content !== 'string') return null;
  const dir = dirFor(filePath);
  try {
    fs.mkdirSync(dir, { recursive: true });
    const existing = listIn(dir);
    const last = existing[0];

    if (last) {
      if (!force && Date.now() - last.time < MIN_GAP_MS) return null;
      try {
        if (fs.readFileSync(last.file, 'utf8') === content) return null;
      } catch {}
    }

    try { fs.writeFileSync(path.join(dir, 'source.txt'), filePath, 'utf8'); } catch {}

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, '');
    const target = path.join(dir, `${stamp}.txt`);
    writeAtomic(target, content);
    prune(dir);
    return target;
  } catch (err) {
    console.error('[low-tide] backup failed:', err.message);
    return null;
  }
}

function readBackup(file) {
  return fs.readFileSync(file, 'utf8');
}

module.exports = { writeAtomic, snapshot, listBackups, readBackup, dirFor, KEEP };
