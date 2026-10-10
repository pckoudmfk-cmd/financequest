const { getDb } = require('../lib/db');
const { allowedGroups } = require('../lib/group');
const { send, requireTeacher } = require('../lib/http');
const { aggregate } = require('../lib/jury');
const { TITLES } = require('../lib/key');

// Aggregates only (no answers, no juror names): safe to show on a screen.
module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(res, 405, { error: 'Method not allowed' }); }
    if (!(await requireTeacher(req, res))) return;
    const db = getDb();
    const [results, scores] = await Promise.all([db.listResults(), db.listJuryScores()]);
    const byGroup = new Map(results.map((r) => [r.group_name, r]));
    const jury = new Map();
    scores.forEach((x) => {
      if (!jury.has(x.group_name)) jury.set(x.group_name, {});
      jury.get(x.group_name)[x.juror] = x.scores || {};
    });
    const names = Array.from(new Set(allowedGroups().concat(results.map((r) => r.group_name))));
    const groups = names.map((g) => {
      const r = byGroup.get(g);
      const a = aggregate(jury.get(g) || {});
      let correct = 0, total = 0, checked = 0;
      Object.keys(TITLES).forEach((cls) => {
        const lk = r && r.locks && r.locks[cls];
        if (lk) { correct += lk.correct; total += lk.total; checked++; }
      });
      return {
        group: g,
        present: !!r,
        finished: !!(r && r.finished_at),
        stations_done: r ? (r.completed || []).length : 0,
        closed: { correct, total, checked, blocks: Object.keys(TITLES).length },
        jury: a,
      };
    });
    const ranked = groups.filter((g) => g.jury.any).sort((a, b) => b.jury.total - a.jury.total);
    let place = 0, prev = null;
    ranked.forEach((g, i) => {
      if (prev === null || Math.abs(g.jury.total - prev) > 1e-9) { place = i + 1; prev = g.jury.total; }
      g.place = place;
    });
    send(res, 200, { groups, server_time: new Date().toISOString() });
  } catch (e) {
    console.error(e && e.stack || e);
    send(res, 500, { error: 'Server error' });
  }
};
