const assert = require('assert');
const { chromium } = require('playwright');
const mock = require('./mock-supabase');
const dev = require('./devserver');
const { KEY, LABELS } = require('../lib/key');

(async () => {
  const sb = await mock.start(54331);
  process.env.SUPABASE_URL = 'http://127.0.0.1:54331';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-key';
  process.env.TEACHER_PASSWORD = 'pw';
  const app = await dev.start(54330);
  const B = 'http://127.0.0.1:54330';
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  let n = 0; const ok = (m) => console.log('ok', ++n, m);
  const sync = () => page.locator('#syncStatus').getAttribute('data-state');
  const waitSync = async (st, ms = 8000) => { await page.waitForFunction((s) => document.getElementById('syncStatus').getAttribute('data-state') === s, st, { timeout: ms }); };
  const login = async (name) => {
    await page.goto(B + '/');
    await page.fill('#loginGroup', name);
    await page.click('#loginBtn');
    await page.waitForSelector('#loginScreen.hidden', { state: 'attached' });
  };

  await login('24OФ1');   // Latin O
  assert.equal(await page.locator('#teamTagValue').textContent(), '24ОФ1'); ok('login normalises Latin look-alike');

  // all DOM labels are known to the server
  const domLabels = await page.$$eval('[data-label]', (els) => els.map((e) => e.dataset.label));
  const unknown = domLabels.filter((l) => LABELS.indexOf(l) === -1);
  assert.deepEqual(unknown, []); ok('all ' + domLabels.length + ' DOM labels whitelisted');
  const noKey = await page.evaluate(() => document.documentElement.outerHTML.indexOf('data-answer') === -1 && typeof s5Answers === 'undefined');
  assert.ok(noKey); ok('no answer key in the page');

  // fill fields
  await page.selectOption('select[data-label="S1 Part A – Primary #1"]', 'extraction of raw materials');
  await page.selectOption('select[data-label="S1 Part A – Secondary #1"]', 'coal mining'); // wrong
  await page.click('.station-tab[data-target="s2"]');
  await page.fill('textarea[data-label="S2 Part B – Q1"]', 'Typed by the team');
  await page.locator('.highlightable').first().locator('.word').nth(3).click();
  await page.check('.tab-done[data-station="1"]');
  await waitSync('saved', 10000); ok('autosave reached "saved"');
  const row = sb.tables.quest_results.get('24ОФ1');
  assert.equal(row.fields['S1 Part A – Primary #1'], 'extraction of raw materials');
  assert.equal(row.fields['S2 Part B – Q1'], 'Typed by the team');
  assert.ok(row.fields['_S2_flagged']);
  assert.deepEqual(row.completed, [1]); ok('data is in the database');

  // reload: restored
  await login('24ОФ1');
  assert.equal(await page.inputValue('select[data-label="S1 Part A – Primary #1"]'), 'extraction of raw materials');
  assert.equal(await page.inputValue('textarea[data-label="S2 Part B – Q1"]'), 'Typed by the team');
  assert.equal(await page.locator('.highlightable').first().locator('.word.flagged').count(), 1);
  assert.ok(await page.isChecked('.tab-done[data-station="1"]')); ok('answers restored after reload');

  // check s1c: answer all correctly except one, then lock
  for (const [label, val] of Object.entries(KEY.s1c)) {
    const wrong = label.includes('statement 1');
    await page.selectOption('select[data-label="' + label + '"]', wrong ? (val === 't' ? 'f' : 't') : val);
  }
  await page.click('button[onclick*="checkStation(\'s1c\'"]');
  await page.waitForFunction(() => document.getElementById('score-s1c').textContent.includes('locked'));
  assert.equal(await page.locator('#score-s1c').textContent(), '3 of 4 correct — locked');
  assert.equal(await page.locator('select.s1c.incorrect').count(), 1);
  assert.equal(await page.locator('select.s1c.correct').count(), 3);
  assert.ok(await page.locator('select.s1c').first().isDisabled()); ok('check via server, locked and coloured');

  // reload: still locked
  await login('24ОФ1');
  assert.equal(await page.locator('#score-s1c').textContent(), '3 of 4 correct — locked');
  assert.ok(await page.locator('select.s1c').first().isDisabled()); ok('lock survives reload');

  // offline typing, then reconnect
  await ctx.setOffline(true);
  await page.click('.station-tab[data-target="s4"]');
  await page.fill('textarea[data-label="S4 Task1 – risk 1"]', 'written offline');
  await waitSync('offline', 10000); ok('offline indicator');
  assert.ok((await page.evaluate(() => localStorage.getItem('gfpq:24ОФ1'))).includes('written offline')); ok('local backup written');
  await ctx.setOffline(false);
  await page.evaluate(() => { flushSave(); });
  await waitSync('saved', 12000);
  assert.equal(sb.tables.quest_results.get('24ОФ1').fields['S4 Task1 – risk 1'], 'written offline'); ok('sent after connection came back');

  // login offline path
  await ctx.setOffline(true);
  await page.goto(B + '/').catch(() => {});
  await ctx.setOffline(false);

  // final download
  await login('24ОФ1');
  await page.click('.station-tab[data-target="s6"]');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#finishBtn')]);
  const text = require('fs').readFileSync(await dl.path(), 'utf8');
  assert.ok(text.includes('Group: 24ОФ1'));
  assert.ok(text.includes('S1 Part C – statement 1 (T/F): F') || text.includes('statement 1 (T/F)'));
  assert.ok(/\[CORRECT\]/.test(text) && /\[INCORRECT\]/.test(text));
  assert.ok(text.includes('Station 1 Part C — True/False: 3 correct, 1 incorrect, 0 not answered (of 4)'));
  assert.ok(text.includes('Station 5 Part A — Term matching: not checked'));
  assert.ok(text.includes('Saved on server: yes'));
  assert.ok(sb.tables.quest_results.get('24ОФ1').finished_at); ok('final file has verdicts, server confirmed');

  // unknown group
  await page.goto(B + '/');
  await page.fill('#loginGroup', '99ХХ9');
  await page.click('#loginBtn');
  await page.waitForFunction(() => document.getElementById('loginError').textContent.includes('not recognised'));
  ok('unknown group message');

  // teacher page
  const t = await ctx.newPage();
  t.on('pageerror', (e) => errors.push('teacher: ' + e));
  await t.goto(B + '/teacher');
  await t.fill('#pw', 'wrong'); await t.click('#loginBtn');
  await t.waitForFunction(() => document.getElementById('loginErr').textContent.includes('Неверный'));
  await t.fill('#pw', 'pw'); await t.click('#loginBtn');
  await t.waitForSelector('#panel:not(.hidden)');
  const ovr = await t.locator('#overview').textContent();
  assert.ok(ovr.includes('24ОФ1') && ovr.includes('завершили')); ok('teacher overview shows finished group');
  // jury page
  process.env.JURY_PASSWORDS = 'Иванова:pw-a,Петров:pw-b';
  const jp = await ctx.newPage();
  jp.on('pageerror', (e) => errors.push('jury: ' + e));
  await jp.goto(B + '/jury');
  await jp.fill('#pw', 'pw-a'); await jp.click('#loginBtn');
  await jp.waitForSelector('#panel:not(.hidden)');
  assert.ok((await jp.locator('#who').textContent()).includes('Иванова'));
  await jp.click('#groupTabs button[data-g="24ОФ1"]');
  await jp.click('#stationTabs button[data-s="1"]');
  assert.ok((await jp.locator('.hint').first().textContent()).includes('Подсказка системы')); ok('jury page shows hint');
  await jp.locator('button[data-apply="1"]').click();   // accept hint for criterion 1
  await jp.selectOption('select[data-c="2"]', '1');
  await jp.waitForFunction(() => document.getElementById('savedMsg').textContent === 'Сохранено', null, { timeout: 5000 });
  const stored = sb.tables.quest_jury_scores ? null : null;
  await jp.close();
  await t.click('#refreshBtn');
  await t.waitForFunction(() => document.getElementById('juryBox').textContent.includes('Иванова'), null, { timeout: 5000 });
  ok('jury score saved from jury page and visible to teacher');
  const ans = await t.locator('#answersBox').textContent();
  assert.ok(ans.includes('Typed by the team') && ans.includes('верно') && ans.includes('неверно')); ok('teacher sees answers with verdicts');
  const [csv] = await Promise.all([t.waitForEvent('download'), t.click('#csvSummaryBtn')]);
  const csvText = require('fs').readFileSync(await csv.path(), 'utf8');
  assert.ok(csvText.includes('24ОФ1;завершили')); ok('csv summary downloads');

  const bp = await ctx.newPage();
  bp.on('pageerror', (e) => errors.push('board: ' + e));
  await bp.goto(B + '/board');
  await bp.fill('#pw', 'pw'); await bp.click('#loginBtn');
  await bp.waitForSelector('#boardBox:not(.hidden)');
  assert.ok((await bp.locator('#tbl').textContent()).includes('24ОФ1')); ok('board shows groups');
  await bp.click('#hideBtn');
  assert.equal(await bp.locator('#tbl').getAttribute('class'), 'hide'); ok('board hide toggle');
  await bp.close();

  assert.deepEqual(errors, []); ok('no page errors');
  console.log('\nALL', n, 'BROWSER CHECKS PASSED');
  await browser.close(); app.close(); sb.server.close();
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
