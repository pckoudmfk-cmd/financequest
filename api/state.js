const { getDb } = require('../lib/db');
const { send, route, requireGroup } = require('../lib/http');
const { publicState } = require('../lib/logic');

module.exports = route('GET', async (req, res) => {
  const q = req.query || {};
  const g = requireGroup(res, q.group);
  if (!g) return;
  const db = getDb();
  let row = await db.getResult(g);
  if (!row) row = await db.createResult(g);
  send(res, 200, publicState(row));
});
