const { send, parseBody, route, requireGroup } = require('../lib/http');
const { sanitizeCompleted, mutate } = require('../lib/logic');

module.exports = route('POST', async (req, res) => {
  const body = parseBody(req);
  const g = requireGroup(res, body.group);
  if (!g) return;
  const completed = sanitizeCompleted(body.completed);
  const { row } = await mutate(g, () => {
    const patch = { finished_at: new Date().toISOString() };
    if (completed) patch.completed = completed;
    return { patch, result: null };
  });
  send(res, 200, { ok: true, finished_at: row.finished_at, locks: row.locks || {}, completed: row.completed || [] });
});
