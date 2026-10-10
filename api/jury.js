const { getDb } = require('../lib/db');
const { allowedGroups, normalizeGroup } = require('../lib/group');
const { send, parseBody } = require('../lib/http');
const { jurorByPassword, computeHints, cleanScores } = require('../lib/jury');
const { TITLES } = require('../lib/key');

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET' && req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return send(res, 405, { error: 'Method not allowed' });
    }
    const juror = jurorByPassword(req.headers['x-jury-password']);
    if (!juror) {
      await new Promise((r) => setTimeout(r, 600));
      return send(res, 401, { error: 'Wrong password' });
    }
    const db = getDb();
    const allowed = allowedGroups();

    if (req.method === 'POST') {
      const body = parseBody(req);
      const g = normalizeGroup(body.group);
      if (allowed.indexOf(g) === -1) return send(res, 404, { error: 'Unknown group' });
      const row = await db.upsertJuryScore(g, juror, cleanScores(body.scores));
      return send(res, 200, { ok: true, saved_at: row && row.updated_at });
    }

    const [results, scores] = await Promise.all([db.listResults(), db.listJuryScores()]);
    const byGroup = new Map(results.map((r) => [r.group_name, r]));
    const mine = new Map(scores.filter((x) => x.juror === juror).map((x) => [x.group_name, x.scores]));
    const names = Array.from(new Set(allowed.concat(results.map((r) => r.group_name))));
    const groups = names.map((g) => {
      const r = byGroup.get(g);
      return {
        group: g,
        present: !!r,
        finished_at: r ? r.finished_at : null,
        updated_at: r ? r.updated_at : null,
        fields: r ? r.fields || {} : {},
        locks: r ? r.locks || {} : {},
        hints: r ? computeHints(r) : {},
        mine: mine.get(g) || {},
      };
    });
    send(res, 200, { juror, groups, titles: TITLES });
  } catch (e) {
    console.error(e && e.stack || e);
    send(res, 500, { error: 'Server error' });
  }
};
