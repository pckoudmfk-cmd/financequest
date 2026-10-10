const crypto = require('crypto');
const { normalizeGroup, allowedGroups } = require('./group');

function send(res, status, body) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function parseBody(req) {
  let b = req.body;
  if (b == null || b === '') return {};
  if (Buffer.isBuffer(b)) b = b.toString('utf8');
  if (typeof b === 'string') { try { return JSON.parse(b); } catch (e) { return {}; } }
  return typeof b === 'object' ? b : {};
}

// Wraps a handler: method check, error handling, group validation helper.
function route(method, fn) {
  return async function (req, res) {
    try {
      if (req.method !== method) {
        res.setHeader('Allow', method);
        return send(res, 405, { error: 'Method not allowed' });
      }
      await fn(req, res);
    } catch (e) {
      console.error(e && e.stack || e);
      send(res, e.status || 500, { error: e.status ? e.message : 'Server error' });
    }
  };
}

// Returns the normalised group or sends an error and returns null.
function requireGroup(res, raw) {
  const g = normalizeGroup(raw);
  const allowed = allowedGroups();
  if (!g || allowed.indexOf(g) === -1) {
    send(res, 404, { error: 'Unknown group', code: 'unknown_group', allowed });
    return null;
  }
  return g;
}

function sameSecret(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

async function requireTeacher(req, res) {
  const pw = process.env.TEACHER_PASSWORD;
  if (!pw) { send(res, 500, { error: 'TEACHER_PASSWORD is not set' }); return false; }
  const given = req.headers['x-teacher-password'] || '';
  if (!given || !sameSecret(given, pw)) {
    await new Promise((r) => setTimeout(r, 600));
    send(res, 401, { error: 'Wrong password' });
    return false;
  }
  return true;
}

module.exports = { send, parseBody, route, requireGroup, requireTeacher };
