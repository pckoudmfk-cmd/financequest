// Local stand-in for Vercel: static files from public/, handlers from api/ (req.query / req.body like Vercel).
const http = require('http');
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css' };

function start(port) {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname.startsWith('/api/')) {
      const file = path.join(root, u.pathname + '.js');
      if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('{}'); }
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        req.query = Object.fromEntries(u.searchParams);
        const ct = req.headers['content-type'] || '';
        req.body = raw && ct.includes('json') ? (() => { try { return JSON.parse(raw); } catch (e) { return raw; } })() : raw;
        require(file)(req, res);
      });
      return;
    }
    let p = u.pathname === '/' ? '/index.html' : u.pathname;
    if (!path.extname(p)) p += '.html';
    const f = path.join(root, 'public', p);
    if (!f.startsWith(path.join(root, 'public')) || !fs.existsSync(f)) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('Content-Type', types[path.extname(f)] || 'application/octet-stream');
    res.end(fs.readFileSync(f));
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}
module.exports = { start };
