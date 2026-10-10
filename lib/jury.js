// Jury access (several jurors, each with own password) and rule-based score hints.
const { KEY, LABELS } = require('./key');
const { sameSecret } = require('./http');

// JURY_PASSWORDS="Name1:password1,Name2:password2"  (up to a handful of jurors)
function jurors() {
  const raw = process.env.JURY_PASSWORDS || '';
  return raw.split(',').map((x) => x.trim()).filter(Boolean).map((x) => {
    const i = x.indexOf(':');
    return i > 0 ? { name: x.slice(0, i).trim(), password: x.slice(i + 1).trim() } : null;
  }).filter((j) => j && j.name && j.password);
}

function jurorByPassword(given) {
  if (!given) return null;
  let found = null;
  for (const j of jurors()) {
    if (sameSecret(given, j.password)) found = j.name; // no early exit, same timing for all
  }
  return found;
}

const MEMO_TERMS = ['market segmentation', 'target segments', 'competitive advantage', 'market positioning',
  'personalized products', 'client needs', 'strategic direction', 'communication', 'sustainable growth', 'inefficient'];

// Station -> task groups checked by the server.
const STATION_CLASSES = { 1: ['s1a', 's1b', 's1c'], 3: ['s3'], 5: ['s5a', 's5b'] };

function stationOf(label) {
  const m = /^S(\d)/.exec(label);
  return m ? Number(m[1]) : 0;
}

// Optional fields are not counted as "must be filled".
function required(label) {
  return !/correction$/.test(label) && !/ note$/.test(label);
}

function score3(share, low, high) {
  return share >= high ? 2 : share >= low ? 1 : 0;
}

// Returns { "1": { c1: {value, why}, c2: {...}, c3: {...} }, ... } only where data supports a hint.
function computeHints(row) {
  const fields = (row && row.fields) || {};
  const locks = (row && row.locks) || {};
  const out = {};
  for (let s = 1; s <= 6; s++) {
    const h = {};
    const labels = LABELS.filter((l) => stationOf(l) === s && required(l));
    if (labels.length) {
      const filled = labels.filter((l) => String(fields[l] || '').trim() !== '').length;
      const share = filled / labels.length;
      h.c1 = { value: score3(share, 0.4, 0.8), why: 'заполнено ' + filled + ' из ' + labels.length + ' полей (' + Math.round(share * 100) + '%)' };
    }
    const classes = STATION_CLASSES[s];
    if (classes && classes.every((c) => locks[c])) {
      let ok = 0, all = 0;
      classes.forEach((c) => { ok += locks[c].correct; all += locks[c].total; });
      const share = all ? ok / all : 0;
      h.c2 = { value: score3(share, 0.5, 0.8), why: 'верно ' + ok + ' из ' + all + ' пунктов (' + Math.round(share * 100) + '%)' };
    }
    if (s === 6) {
      const text = String(fields['S6 Task2 – advisory memo'] || '').toLowerCase();
      const used = MEMO_TERMS.filter((t) => text.indexOf(t) !== -1).length;
      h.c3 = { value: used >= 6 ? 2 : used >= 3 ? 1 : 0, why: 'целевых слов в меморандуме ' + used + ' из ' + MEMO_TERMS.length };
    }
    if (Object.keys(h).length) out[s] = h;
  }
  return out;
}

function cleanScores(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (let s = 1; s <= 6; s++) {
    const row = input[s] || input[String(s)];
    if (!row || typeof row !== 'object') continue;
    const r = {};
    for (let c = 1; c <= 5; c++) {
      const v = row['c' + c];
      if (v === null || v === '' || v === undefined) continue;
      const n = Number(v);
      if (Number.isInteger(n) && n >= 0 && n <= 2) r['c' + c] = n;
    }
    if (Object.keys(r).length) out[s] = r;
  }
  return out;
}

function stationSum(scores, s) {
  const row = (scores && (scores[s] || scores[String(s)])) || {};
  let sum = 0, any = false;
  for (let c = 1; c <= 5; c++) {
    if (typeof row['c' + c] === 'number') { sum += row['c' + c]; any = true; }
  }
  return any ? sum : null;
}

// byJuror: { name: scores }. Station value = mean of station sums over jurors who scored it; total = sum of station values.
function aggregate(byJuror) {
  const names = Object.keys(byJuror || {});
  const per = {};
  let total = 0, any = false;
  for (let s = 1; s <= 6; s++) {
    const vals = names.map((n) => stationSum(byJuror[n], s)).filter((x) => x !== null);
    per[s] = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
    if (vals.length) { any = true; total += per[s]; }
  }
  return { per, total, any, jurors: names.length };
}

module.exports = { aggregate, jurors, jurorByPassword, computeHints, cleanScores, MEMO_TERMS };
