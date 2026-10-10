// Storage adapter. Production: Supabase PostgREST over fetch (service role key, server only).
// Tests: in-memory adapter with the same interface and the same optimistic-lock semantics.

function cfg() {
  const url = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) throw new Error('Supabase is not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
  return { url, key };
}

async function rest(method, path, body, prefer) {
  const { url, key } = cfg();
  const headers = { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' };
  if (prefer) headers.Prefer = prefer;
  const res = await fetch(url + '/rest/v1/' + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error('Supabase ' + res.status + ': ' + text.slice(0, 300));
  return text ? JSON.parse(text) : null;
}

const enc = encodeURIComponent;

const supabase = {
  async getResult(g) {
    const rows = await rest('GET', 'quest_results?group_name=eq.' + enc(g) + '&select=*');
    return rows && rows[0] ? rows[0] : null;
  },
  async createResult(g) {
    await rest('POST', 'quest_results', { group_name: g }, 'resolution=ignore-duplicates,return=minimal');
    return this.getResult(g);
  },
  // Returns the updated row, or null if rev no longer matches (someone else wrote first).
  async updateResult(g, rev, patch) {
    const body = Object.assign({}, patch, { rev: rev + 1, updated_at: new Date().toISOString() });
    const rows = await rest(
      'PATCH',
      'quest_results?group_name=eq.' + enc(g) + '&rev=eq.' + rev,
      body,
      'return=representation'
    );
    return rows && rows[0] ? rows[0] : null;
  },
  async listResults() {
    return (await rest('GET', 'quest_results?select=*&order=group_name.asc')) || [];
  },
  async listJury() {
    return (await rest('GET', 'quest_jury?select=*&order=group_name.asc')) || [];
  },
  async upsertJury(g, scores) {
    const rows = await rest(
      'POST',
      'quest_jury?on_conflict=group_name',
      { group_name: g, scores, updated_at: new Date().toISOString() },
      'resolution=merge-duplicates,return=representation'
    );
    return rows && rows[0];
  },
  async listJuryScores() {
    return (await rest('GET', 'quest_jury_scores?select=*&order=group_name.asc')) || [];
  },
  async upsertJuryScore(g, juror, scores) {
    const rows = await rest(
      'POST',
      'quest_jury_scores?on_conflict=group_name,juror',
      { group_name: g, juror, scores, updated_at: new Date().toISOString() },
      'resolution=merge-duplicates,return=representation'
    );
    return rows && rows[0];
  },
  async deleteGroup(g) {
    await rest('DELETE', 'quest_results?group_name=eq.' + enc(g), undefined, 'return=minimal');
    await rest('DELETE', 'quest_jury?group_name=eq.' + enc(g), undefined, 'return=minimal');
    await rest('DELETE', 'quest_jury_scores?group_name=eq.' + enc(g), undefined, 'return=minimal');
  },
};

function memory() {
  const results = new Map();
  const jury = new Map();
  const juryScores = new Map();
  const clone = (x) => (x == null ? x : JSON.parse(JSON.stringify(x)));
  const now = () => new Date().toISOString();
  return {
    _results: results,
    async getResult(g) { return clone(results.get(g) || null); },
    async createResult(g) {
      if (!results.has(g)) {
        results.set(g, {
          group_name: g, fields: {}, locks: {}, completed: [], finished_at: null,
          started_at: now(), updated_at: now(), rev: 0,
        });
      }
      return clone(results.get(g));
    },
    async updateResult(g, rev, patch) {
      const cur = results.get(g);
      if (!cur || cur.rev !== rev) return null;
      const next = Object.assign({}, cur, clone(patch), { rev: rev + 1, updated_at: now() });
      results.set(g, next);
      return clone(next);
    },
    async listResults() { return clone(Array.from(results.values()).sort((a, b) => a.group_name.localeCompare(b.group_name))); },
    async listJury() { return clone(Array.from(jury.values())); },
    async upsertJury(g, scores) {
      const row = { group_name: g, scores: clone(scores), updated_at: now() };
      jury.set(g, row);
      return clone(row);
    },
    async listJuryScores() { return clone(Array.from(juryScores.values())); },
    async upsertJuryScore(g, juror, scores) {
      const row = { group_name: g, juror, scores: clone(scores), updated_at: now() };
      juryScores.set(g + '\u0000' + juror, row);
      return clone(row);
    },
    async deleteGroup(g) {
      results.delete(g); jury.delete(g);
      Array.from(juryScores.keys()).forEach((k) => { if (k.split('\u0000')[0] === g) juryScores.delete(k); });
    },
  };
}

let override = null;
function getDb() { return override || supabase; }
function setDb(d) { override = d; }

module.exports = { getDb, setDb, memory, supabase };
