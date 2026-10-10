// Minimal PostgREST imitation: just the calls lib/db.js makes. Used only for tests.
const http = require('http');

function start(port) {
  const tables = { quest_results: new Map(), quest_jury: new Map() };
  const defaults = {
    quest_results: () => ({ fields: {}, locks: {}, completed: [], finished_at: null, started_at: new Date().toISOString(), updated_at: new Date().toISOString(), rev: 0 }),
    quest_jury: () => ({ scores: {}, updated_at: new Date().toISOString() }),
  };
  const log = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const u = new URL(req.url, 'http://x');
      const m = /^\/rest\/v1\/(\w+)$/.exec(u.pathname);
      const send = (code, body) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(body === undefined ? '' : JSON.stringify(body)); };
      if (req.headers.apikey !== 'test-key' || req.headers.authorization !== 'Bearer test-key') return send(401, { message: 'bad key' });
      if (!m || !tables[m[1]]) return send(404, { message: 'no table' });
      const name = m[1], t = tables[name];
      const prefer = req.headers.prefer || '';
      const body = raw ? JSON.parse(raw) : null;
      const filters = [];
      for (const [k, v] of u.searchParams) if (/^eq\./.test(v)) filters.push([k, v.slice(3)]);
      const match = (row) => filters.every(([k, v]) => String(row[k]) === v);
      log.push(req.method + ' ' + name + ' ' + u.search);
      if (req.method === 'GET') {
        let rows = Array.from(t.values()).filter(match);
        rows.sort((a, b) => a.group_name.localeCompare(b.group_name));
        return send(200, rows);
      }
      if (req.method === 'POST') {
        const onConflict = u.searchParams.get('on_conflict');
        const rec = Object.assign(defaults[name](), body);
        const exists = t.has(rec.group_name);
        if (exists && prefer.includes('ignore-duplicates')) return send(prefer.includes('return=minimal') ? 201 : 200, prefer.includes('return=representation') ? [] : undefined);
        if (exists && !(onConflict && prefer.includes('merge-duplicates'))) return send(409, { code: '23505', message: 'duplicate' });
        const merged = exists ? Object.assign({}, t.get(rec.group_name), body) : rec;
        t.set(rec.group_name, merged);
        return send(201, prefer.includes('return=representation') ? [merged] : undefined);
      }
      if (req.method === 'PATCH') {
        const hit = Array.from(t.values()).filter(match);
        hit.forEach((r) => Object.assign(r, body));
        return send(200, prefer.includes('return=representation') ? hit : undefined);
      }
      if (req.method === 'DELETE') {
        Array.from(t.entries()).forEach(([k, r]) => { if (match(r)) t.delete(k); });
        return send(204);
      }
      send(405, {});
    });
  });
  return new Promise((resolve) => server.listen(port, () => resolve({ server, tables, log })));
}
module.exports = { start };
