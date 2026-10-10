const { send, parseBody, route, requireGroup } = require('../lib/http');
const { sanitizeFields, sanitizeCompleted, mergeSave, mutate } = require('../lib/logic');

module.exports = route('POST', async (req, res) => {
  const body = parseBody(req);
  const g = requireGroup(res, body.group);
  if (!g) return;
  const fields = sanitizeFields(body.fields);
  const completed = sanitizeCompleted(body.completed);
  const { row, result } = await mutate(g, (cur) => {
    const m = mergeSave(cur, fields, completed);
    return { patch: m.patch, result: m.rejected };
  });
  send(res, 200, { ok: true, rev: row.rev, locks: row.locks || {}, rejected: result });
});
