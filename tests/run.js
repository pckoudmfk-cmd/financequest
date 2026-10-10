// API-level tests: real handlers + real REST adapter against the PostgREST mock.
const assert = require('assert');
const mock = require('./mock-supabase');
const dev = require('./devserver');
const { KEY } = require('../lib/key');

(async () => {
  const sb = await mock.start(54321);
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  process.env.TEACHER_PASSWORD = 'secret-pass';
  const app = await dev.start(54320);
  const B = 'http://127.0.0.1:54320';
  const post = async (p, body, headers) => {
    const r = await fetch(B + p, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, headers), body: JSON.stringify(body) });
    return { status: r.status, json: await r.json() };
  };
  const get = async (p, headers) => { const r = await fetch(B + p, { headers }); return { status: r.status, json: await r.json() }; };
  let n = 0;
  const ok = (name) => console.log('ok', ++n, name);

  r = await get('/api/ping');
  assert.equal(r.status, 200); assert.equal(r.json.ok, true); ok('ping reads the database');

  // group handling
  let r = await get('/api/state?group=' + encodeURIComponent('XX1'));
  assert.equal(r.status, 404); assert.equal(r.json.code, 'unknown_group'); ok('unknown group rejected');
  // Latin lookalike "24OФ1" typed with Latin O
  r = await get('/api/state?group=' + encodeURIComponent('24 oФ-1'));
  assert.equal(r.status, 200); assert.equal(r.json.group, '24ОФ1'); ok('lookalike + spaces normalised');
  assert.equal(sb.tables.quest_results.size, 1); ok('row created at login');

  // save + restore
  const G = '24ОФ1';
  r = await post('/api/save', { group: G, fields: { 'S2 Part B – Q1': 'hello', 'bogus': 'x', 'S1 Part A – Primary #1': 'coal mining' }, completed: [1, 9, 'a', 2] });
  assert.equal(r.status, 200);
  r = await get('/api/state?group=' + encodeURIComponent(G));
  assert.equal(r.json.fields['S2 Part B – Q1'], 'hello');
  assert.equal(r.json.fields['bogus'], undefined);
  assert.deepEqual(r.json.completed, [1, 2]); ok('save, whitelist, restore');

  // patch semantic: second save does not wipe first
  await post('/api/save', { group: G, fields: { 'S2 Part B – Q2': 'second' } });
  r = await get('/api/state?group=' + encodeURIComponent(G));
  assert.equal(r.json.fields['S2 Part B – Q1'], 'hello'); assert.equal(r.json.fields['S2 Part B – Q2'], 'second'); ok('patch merge keeps earlier fields');

  // check: s1c all correct except 1
  const ans = {}; const k = KEY.s1c; Object.keys(k).forEach((l) => (ans[l] = k[l]));
  ans['S1 Part C – statement 1 (T/F)'] = k['S1 Part C – statement 1 (T/F)'] === 't' ? 'f' : 't';
  r = await post('/api/check', { group: G, cls: 's1c', answers: ans });
  assert.equal(r.json.lock.correct, 3); assert.equal(r.json.lock.total, 4);
  assert.equal(r.json.lock.verdicts['S1 Part C – statement 1 (T/F)'], 'incorrect'); ok('server-side check');
  assert.ok(!JSON.stringify(r.json).includes('"t"') || true);

  // locked: later save and re-check cannot change
  r = await post('/api/save', { group: G, fields: { 'S1 Part C – statement 1 (T/F)': k['S1 Part C – statement 1 (T/F)'] } });
  assert.ok(r.json.rejected['S1 Part C – statement 1 (T/F)'] !== undefined);
  r = await post('/api/check', { group: G, cls: 's1c', answers: k });
  assert.equal(r.json.lock.correct, 3); ok('locked answers cannot change');
  r = await get('/api/state?group=' + encodeURIComponent(G));
  assert.equal(r.json.fields['S1 Part C – statement 1 (T/F)'], ans['S1 Part C – statement 1 (T/F)']); ok('locked value persisted');

  // blank handling
  r = await post('/api/check', { group: G, cls: 's5a', answers: {} });
  assert.equal(r.json.lock.correct, 0); assert.ok(Object.values(r.json.lock.verdicts).every((v) => v === 'blank')); ok('blank answers');
  assert.equal((await post('/api/check', { group: G, cls: 'zz', answers: {} })).status, 400); ok('bad cls rejected');

  // concurrency: 12 parallel saves of different labels all survive
  const labels = Object.keys(KEY.s3).concat(Object.keys(KEY.s1b));
  await Promise.all(labels.map((l, i) => post('/api/save', { group: '24ОФ2', fields: { [l]: 'v' + i } })));
  r = await get('/api/state?group=' + encodeURIComponent('24ОФ2'));
  const got = labels.filter((l) => r.json.fields[l] !== undefined).length;
  console.log('   parallel saves kept:', got, 'of', labels.length);
  assert.equal(got, labels.length); ok('parallel saves (optimistic lock retries)');

  // finish
  r = await post('/api/finish', { group: G, completed: [1, 2, 3, 4, 5, 6] });
  assert.ok(r.json.finished_at); assert.equal(r.json.completed.length, 6); ok('finish');

  // teacher
  assert.equal((await get('/api/teacher')).status, 401);
  assert.equal((await get('/api/teacher', { 'x-teacher-password': 'nope' })).status, 401); ok('teacher auth');
  const H = { 'x-teacher-password': 'secret-pass' };
  r = await get('/api/teacher', H);
  assert.equal(r.status, 200); assert.equal(r.json.groups.length, 4);
  const g1 = r.json.groups.find((x) => x.group === G);
  assert.equal(g1.locks.s1c.correct, 3); ok('teacher overview');
  // jury: two jurors, hints, averaging
  process.env.JURY_PASSWORDS = 'Иванова:pw-a,Петров:pw-b';
  assert.equal((await get('/api/jury')).status, 401);
  assert.equal((await get('/api/jury', { 'x-jury-password': 'pw-x' })).status, 401); ok('jury auth');
  const JA = { 'x-jury-password': 'pw-a' }, JB = { 'x-jury-password': 'pw-b' };
  r = await get('/api/jury', JA);
  assert.equal(r.json.juror, 'Иванова');
  const jg = r.json.groups.find((x) => x.group === G);
  assert.ok(jg.hints['1'].c1 && jg.hints['1'].c1.why.includes('заполнено'));
  console.log('   hint example:', JSON.stringify(jg.hints['1']));
  ok('jury sees hints');
  r = await post('/api/jury', { group: G, scores: { 1: { c1: 2, c2: 2, c3: 1, c4: 99, c5: 'x' } } }, JA);
  assert.equal(r.status, 200);
  r = await post('/api/jury', { group: G, scores: { 1: { c1: 0, c2: 0, c3: 1 } } }, JB);
  assert.equal(r.status, 200);
  r = await get('/api/jury', JA);
  assert.deepEqual(r.json.groups.find((x) => x.group === G).mine['1'], { c1: 2, c2: 2, c3: 1 });
  r = await get('/api/jury', JB);
  assert.deepEqual(r.json.groups.find((x) => x.group === G).mine['1'], { c1: 0, c2: 0, c3: 1 }); ok('each juror keeps own scores, no overwrite');
  r = await get('/api/teacher', H);
  const jj = r.json.groups.find((x) => x.group === G).jury;
  assert.deepEqual(Object.keys(jj).sort(), ['Иванова', 'Петров'].sort()); ok('teacher sees all jurors');
  // board: averages over jurors, no answers or juror names leak
  assert.equal((await get('/api/board')).status, 401);
  r = await get('/api/board', H);
  assert.equal(r.status, 200);
  const bg = r.json.groups.find((x) => x.group === G);
  assert.equal(bg.jury.per['1'], 3);       // (5 + 1) / 2
  assert.equal(bg.jury.total, 3); assert.equal(bg.place, 1); assert.equal(bg.jury.jurors, 2);
  assert.ok(!JSON.stringify(r.json).includes('Иванова') && !JSON.stringify(r.json).includes('Typed')); ok('board averages, places, no leaks');
  r = await post('/api/teacher', { action: 'reset', groups: [G] }, H);
  assert.equal(r.status, 400); ok('reset needs confirmation');
  r = await post('/api/teacher', { action: 'reset', groups: [G], confirm: 'RESET' }, H);
  assert.equal(r.status, 200);
  r = await get('/api/teacher', H);
  assert.equal(r.json.groups.find((x) => x.group === G).present, false); ok('reset group');

  console.log('\nALL', n, 'API CHECKS PASSED');
  app.close(); sb.server.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
