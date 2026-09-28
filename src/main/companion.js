/* A manuscript's companion file.
 *
 * Everything the app knows about a document that is not the document itself —
 * its outline, its scratchpad, its revisions, and the goal history it was
 * written under — used to live only in this machine's settings, keyed by the
 * file's absolute path. Carry the manuscript to another computer and none of
 * it followed; move it to another folder and even this machine lost sight of
 * it.
 *
 * So it is also written beside the manuscript, as `Book.fountain.lowtide`.
 * Whatever syncs the document syncs the companion with it, and the newer of
 * the two wins when they disagree.
 */
'use strict';
const fs = require('fs');
const backups = require('./backups');

const VERSION = 1;

function pathFor(filePath) {
  return `${filePath}.lowtide`;
}

/** The companion beside `filePath`, or null if there is none to read. */
function read(filePath) {
  if (!filePath) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(pathFor(filePath), 'utf8'));
    if (!raw || typeof raw !== 'object') return null;
    return {
      updated: Number(raw.updated) || 0,
      extras: raw.extras && typeof raw.extras === 'object' ? raw.extras : {},
      goals: Array.isArray(raw.goals) ? raw.goals : [],
      sprints: Array.isArray(raw.sprints) ? raw.sprints : []
    };
  } catch {
    return null;                      // absent, unreadable or not ours
  }
}

/**
 * Write the companion. Never throws: a manuscript on a read-only volume, or
 * beside a folder we may not write to, must still save.
 */
function write(filePath, { extras = {}, goals = [], sprints = [] } = {}) {
  if (!filePath) return false;
  try {
    const body = JSON.stringify({ v: VERSION, updated: Date.now(), extras, goals, sprints }, null, 2);
    backups.writeAtomic(pathFor(filePath), body);
    return true;
  } catch (err) {
    console.error('[low-tide] could not write the companion:', err.message);
    return false;
  }
}

/** Move the companion when its document moves. */
function moveWith(from, to) {
  try {
    if (fs.existsSync(pathFor(from))) fs.renameSync(pathFor(from), pathFor(to));
  } catch { /* the document still moved, which is what matters */ }
}

/**
 * One history out of two. Both goals and sprints are moments with a number
 * attached, so they join on the moment: the same run read back from a file
 * it was already written to is one run, not two. Where an entry has only a
 * day to it — an older history, or one kept by day — the day is the key, and
 * the fuller count wins, since a day's count only climbs as it is written.
 */
function mergeRecords(a = [], b = []) {
  const keyOf = (e) => (e.finishedAt != null ? `t${e.finishedAt}` : (e.date ? `d${e.date}` : null));
  const countOf = (e) => Number(e.achieved != null ? e.achieved : e.words) || 0;
  const held = new Map();
  for (const entry of [...(a || []), ...(b || [])]) {
    if (!entry || typeof entry !== 'object') continue;
    const key = keyOf(entry);
    if (!key) continue;
    const there = held.get(key);
    if (!there || countOf(entry) > countOf(there)) held.set(key, entry);
  }
  return [...held.values()].sort((x, y) =>
    (Number(y.finishedAt) || 0) - (Number(x.finishedAt) || 0) ||
    String(y.date || '').localeCompare(String(x.date || '')));
}

module.exports = { pathFor, read, write, moveWith, mergeRecords,
                   mergeGoals: mergeRecords, mergeRuns: mergeRecords, VERSION };
