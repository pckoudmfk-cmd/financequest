const { getDb } = require('../lib/db');
const { TITLES, LABELS } = require('../lib/key');
const { normalizeGroup, allowedGroups } = require('../lib/group');
const { send, parseBody, requireTeacher } = require('../lib/http');

function cleanScores(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (let s = 1; s <= 6; s++) {
    const row = input[s] || input[String(s)];
    if (!row || typeof row !== 'object') continue;
    out[s] = {};
    for (let c = 1; c <= 5; c++) {
      const v = row['c' + c];
      if (v === null || v === '' || v === undefined) continue;
      const n = Number(v);
      if (Number.isInteger(n) && n >= 0 && n <= 10) out[s]['c' + c] = n;
    }
  }
  return out;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return send(res, 405, { error: 'Method not allowed' });
    }
    if (!(await requireTeacher(req, res))) return;
    const db = getDb();
    const allowed = allowedGroups();

    if (req.method === 'POST') {
      const body = parseBody(req);
      if (body.action === 'jury') {
        const g = normalizeGroup(body.group);
        if (allowed.indexOf(g) === -1) return send(res, 404, { error: 'Unknown group' });
        const row = await db.upsertJury(g, cleanScores(body.scores));
        return send(res, 200, { ok: true, jury: row });
      }
      if (body.action === 'reset') {
        if (body.confirm !== 'RESET') return send(res, 400, { error: 'Confirmation missing' });
        const targets = body.groups === 'all'
          ? Array.from(new Set(allowed.concat((await db.listResults()).map((r) => r.group_name))))
          : (Array.isArray(body.groups) ? body.groups.map(normalizeGroup) : []);
        for (const g of targets) await db.deleteGroup(g);
        return send(res, 200, { ok: true, reset: targets });
      }
      return send(res, 400, { error: 'Unknown action' });
    }

    const [results, jury] = await Promise.all([db.listResults(), db.listJury()]);
    const byGroup = new Map(results.map((r) => [r.group_name, r]));
    const juryBy = new Map(jury.map((r) => [r.group_name, r]));
    const names = Array.from(new Set(allowed.concat(results.map((r) => r.group_name))));
    const groups = names.map((g) => {
      const r = byGroup.get(g);
      const j = juryBy.get(g);
      return {
        group: g,
        present: !!r,
        started_at: r ? r.started_at : null,
        updated_at: r ? r.updated_at : null,
        finished_at: r ? r.finished_at : null,
        completed: r ? r.completed || [] : [],
        locks: r ? r.locks || {} : {},
        fields: r ? r.fields || {} : {},
        jury: j ? j.scores || {} : {},
      };
    });
    send(res, 200, { groups, titles: TITLES, labels: LABELS, server_time: new Date().toISOString() });
  } catch (e) {
    console.error(e && e.stack || e);
    send(res, 500, { error: 'Server error' });
  }
};
