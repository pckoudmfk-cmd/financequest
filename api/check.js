const { KEY } = require('../lib/key');
const { send, parseBody, route, requireGroup } = require('../lib/http');
const { gradeGroup, mutate } = require('../lib/logic');

module.exports = route('POST', async (req, res) => {
  const body = parseBody(req);
  const g = requireGroup(res, body.group);
  if (!g) return;
  const cls = String(body.cls || '');
  if (!Object.prototype.hasOwnProperty.call(KEY, cls)) return send(res, 400, { error: 'Unknown task group' });
  const { result } = await mutate(g, (cur) => {
    const r = gradeGroup(cur, cls, body.answers || {});
    return { patch: r.patch, result: r.lock };
  });
  send(res, 200, { ok: true, cls, lock: result });
});
