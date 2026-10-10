const { KEY, LABELS } = require('./key');
const { getDb } = require('./db');

const FLAG_KEY = '_S2_flagged';
const FLAG_TEXT = 'S2 – words marked in draft';
const ALLOWED = new Set(LABELS.concat([FLAG_KEY, FLAG_TEXT]));
const MAX_VALUE = 4000;

function sanitizeFields(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const label of Object.keys(input)) {
    if (!ALLOWED.has(label)) continue;
    const v = input[label];
    if (typeof v !== 'string') continue;
    out[label] = v.slice(0, MAX_VALUE);
  }
  return out;
}

function sanitizeCompleted(input) {
  if (!Array.isArray(input)) return null;
  const set = new Set();
  for (const n of input) {
    const k = Number(n);
    if (Number.isInteger(k) && k >= 1 && k <= 6) set.add(k);
  }
  return Array.from(set).sort((a, b) => a - b);
}

function lockedLabels(locks) {
  const s = new Set();
  for (const cls of Object.keys(locks || {})) {
    for (const l of Object.keys((locks[cls] && locks[cls].verdicts) || {})) s.add(l);
  }
  return s;
}

function judge(cls, label, value) {
  const v = String(value == null ? '' : value).trim().toLowerCase();
  if (v === '') return 'blank';
  const expected = KEY[cls][label];
  return v === expected ? 'correct' : 'incorrect';
}

// Pure: merge a save request into a row. Locked labels are never changed.
function mergeSave(row, fields, completed) {
  const locked = lockedLabels(row.locks);
  const next = Object.assign({}, row.fields || {});
  const rejected = {};
  for (const label of Object.keys(fields)) {
    if (locked.has(label)) { rejected[label] = next[label] || ''; continue; }
    next[label] = fields[label];
  }
  const patch = { fields: next };
  if (completed) patch.completed = completed;
  return { patch, rejected };
}

// Pure: grade a task group, storing the submitted answers and a lock.
function gradeGroup(row, cls, answers) {
  const existing = (row.locks || {})[cls];
  if (existing) return { patch: null, lock: existing };
  const labels = Object.keys(KEY[cls]);
  const fields = Object.assign({}, row.fields || {});
  const verdicts = {};
  let correct = 0;
  for (const label of labels) {
    const sent = answers && typeof answers[label] === 'string' ? answers[label].slice(0, 200) : null;
    const value = sent !== null ? sent : String(fields[label] || '');
    fields[label] = value;
    verdicts[label] = judge(cls, label, value);
    if (verdicts[label] === 'correct') correct++;
  }
  const lock = { verdicts, correct, total: labels.length, at: new Date().toISOString() };
  const locks = Object.assign({}, row.locks || {}, { [cls]: lock });
  return { patch: { fields, locks }, lock };
}

// Optimistic-lock loop: read, compute, write with rev check, retry on conflict.
async function mutate(group, fn) {
  const db = getDb();
  for (let attempt = 0; attempt < 10; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, Math.random() * 40 * attempt));
    let row = await db.getResult(group);
    if (!row) row = await db.createResult(group);
    const { patch, result } = fn(row);
    if (!patch) return { row, result };
    const updated = await db.updateResult(group, row.rev, patch);
    if (updated) return { row: updated, result };
  }
  const err = new Error('Too many concurrent writes, please retry.');
  err.status = 409;
  throw err;
}

function publicState(row) {
  return {
    group: row.group_name,
    fields: row.fields || {},
    locks: row.locks || {},
    completed: row.completed || [],
    finished_at: row.finished_at || null,
    rev: row.rev,
  };
}

module.exports = {
  FLAG_KEY, FLAG_TEXT, sanitizeFields, sanitizeCompleted, lockedLabels,
  judge, mergeSave, gradeGroup, mutate, publicState,
};
