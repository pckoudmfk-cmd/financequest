const { getDb } = require('../lib/db');
const { send } = require('../lib/http');

// Called once a day by the Vercel cron job (see vercel.json). Reads one row so the
// Supabase free project sees regular activity. Returns nothing but "ok".
module.exports = async function handler(req, res) {
  try {
    await getDb().getResult('__ping__');
    send(res, 200, { ok: true });
  } catch (e) {
    console.error(e && e.stack || e);
    send(res, 500, { ok: false });
  }
};
