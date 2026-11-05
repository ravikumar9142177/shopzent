// Tap Rush browser check (see ../README.md). Mocked sessions where noted.

const { chromium } = require('/home/user/node_modules/playwright-core');
const fs = require('fs');
const sess = JSON.parse(fs.readFileSync('/tmp/gt/sess.json', 'utf8'));
const MODE = process.env.MODE || 'pending';   // 'none' | 'approved'
const winRow = (sub) => ({ id: 7, week_key: '2026-11-02', place: 1, coins: 30, submit_status: sub, name_submitted: null, reject_reason: null, photo_public_path: null });
const podiumFor = (approved) => [
  { place: 1, name: approved ? 'Ravi K' : 'Suraj', coins: 30, photo_path: approved ? 'settings/game-winners/demo-1.jpg' : null },
  { place: 2, name: 'Priya', coins: 20, photo_path: null },
  { place: 3, name: 'Amit', coins: 10, photo_path: null } ];
const state = (me) => ({ enabled: true, week_key: '2026-11-02', week_ends_at: '2026-11-09T00:00:00+05:30', target: 3600, prizes: [30, 20, 10],
  winners_count: 1, decided: false, podium_week: '2026-11-02', podium: podiumFor(MODE === 'approved'), logged_in: true, me });
(async () => {
  const browser = await chromium.launch({ executablePath: '/home/user/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome', args: ['--no-sandbox','--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript((s) => { try { localStorage.setItem('sb-njrgbpvpabqgjqiojtjr-auth-token', JSON.stringify(s)); } catch (e) {} }, sess);
  const page = await ctx.newPage();
  const errs = []; page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  page.on('pageerror', e => errs.push('pageerror: ' + String(e).slice(0, 300)));
  const calls = [];
  await page.route('**/rest/v1/rpc/**', async (route) => {
    const u = route.request().url(); const name = u.split('/rpc/')[1].split('?')[0]; const body = route.request().postData() || '';
    calls.push(name + (name.startsWith('game_') && name !== 'game_state' ? ' ' + body.slice(0, 80) : ''));
    let out = null;
    if (name === 'my_profile') out = { id: sess.user.id, customer_id: 'SZC-TEST01', wallet_id: 'SZW-TEST01', full_name: 'Suraj Test', email: 'mock@example.test', role: 'customer', status: 'active', aal: 'aal1' };
    if (name === 'game_state') out = state(MODE === 'none' || MODE === 'approved' || MODE === 'pending' ? { won_place: 1, prize_plays_left: 60, plays_today: 2, prize_eligible_now: false, wins: [winRow(MODE === 'approved' ? 'approved' : MODE === 'pending' ? 'pending' : 'none')] } : null);
    if (name === 'game_start') out = { run_id: '11111111-1111-4111-8111-111111111111', seed: 987654, duration_ms: 30000, prize_run: false, target: 3600, week_key: '2026-11-02', week_ends_at: '2026-11-09T00:00:00+05:30' };
    if (name === 'game_finish') { const ev = JSON.parse(body).p_events || []; fs.writeFileSync('/tmp/gt/events.json', JSON.stringify({ seed: 987654, events: ev, elapsed: 33000 })); out = MODE === 'none' ? { ok: true, score: 3720, best_combo: 14, hits: 61, prize: { eligible: true, won: true, place: 2, coins: 20 } } : { ok: true, score: 3720, best_combo: 14, hits: 61, prize: { eligible: false } }; }
    if (name === 'game_submit_winner') { out = { ok: true, submit_status: 'pending' }; }
    if (out === null) out = {};
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) });
  });
  // registered in this order: the last matching route wins, so the specific ones go last
  await page.route('**/storage/v1/object/**', (route) => { if (route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'image/jpeg', body: fs.readFileSync('/tmp/gt/photo.jpg') }); return route.continue(); });
  await page.route('**/storage/v1/object/public-media/**', (route) => { calls.push('upload public-media'); route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: 'x', Id: 'x' }) }); });
  await page.route('**/storage/v1/object/game-photos/**', (route) => { if (route.request().method() === 'POST') { calls.push('upload game-photos POST ' + route.request().url().split('/game-photos/')[1].slice(0, 30)); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: 'game-photos/x', Id: 'x' }) }); } return route.fulfill({ status: 200, contentType: 'image/jpeg', body: fs.readFileSync('/tmp/gt/photo.jpg') }); });
  await page.goto('http://127.0.0.1:8791/game.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#tr-podium .tr-podium', { timeout: 20000 });
  await page.waitForTimeout(500);
  const out = {};
  out.podium = await page.evaluate(() => document.getElementById('tr-podium').innerText.replace(/\n+/g, ' | ').slice(0, 300));
  out.podiumImg = await page.evaluate(() => [...document.querySelectorAll('#tr-podium img')].map(i => i.src.slice(-60)));
  out.uploadForms = await page.evaluate(() => document.querySelectorAll('#tr-upload form.tr-up').length);
  out.okBox = await page.evaluate(() => document.getElementById('tr-upload').innerText.slice(0, 160));
  if (MODE === 'none') {
    // invalid name first, then a real file and a valid name
    await page.locator('#tr-upload .tr-name').fill('<b>x</b>');
    await page.locator('#tr-upload .tr-file').setInputFiles('/tmp/gt/photo.jpg');
    await page.locator('#tr-upload button[type=submit]').click();
    await page.waitForTimeout(700);
    out.badNameMsg = await page.evaluate(() => document.querySelector('#tr-upload .tr-up-msg').textContent);
    await page.locator('#tr-upload .tr-name').fill('Ravi K');
    await page.locator('#tr-upload button[type=submit]').click();
    await page.waitForTimeout(2500);
    out.afterSubmit = await page.evaluate(() => document.getElementById('tr-upload').innerText.slice(0, 200));
    await page.locator('#tr-upload').scrollIntoViewIfNeeded();
    await page.screenshot({ path: '/tmp/gt/upload-390.jpg', type: 'jpeg', quality: 80 });
  }
  if (MODE === 'pending' || MODE === 'approved') {
    await page.locator('#tr-upload').scrollIntoViewIfNeeded();
    await page.screenshot({ path: `/tmp/gt/podium-${MODE}-390.jpg`, type: 'jpeg', quality: 80 });
  }
  if (MODE === 'none') {
    // play one run with scripted taps, then the server answers with a win
    await page.locator('#tr-stage').scrollIntoViewIfNeeded();
    await page.click('.tr-go'); await page.waitForTimeout(3300);
    await page.locator('#tr-cv').scrollIntoViewIfNeeded();
    await page.screenshot({ path: '/tmp/gt/play-logged-390.jpg', type: 'jpeg', quality: 80 });
    let box = await page.locator('#tr-cv').boundingBox(); const t0 = Date.now();
    while (Date.now() - t0 < 30800) {
      if (!(await page.evaluate(() => document.getElementById('tr-ov').hidden))) break;
      const x = box.x + 30 + Math.random() * (box.width - 60), y = box.y + 80 + Math.random() * (box.height - 160);
      await page.mouse.click(x, y); await page.waitForTimeout(120);
      if ((Date.now() - t0) % 5000 < 130) { await page.locator('#tr-cv').scrollIntoViewIfNeeded(); box = await page.locator('#tr-cv').boundingBox(); }
    }
    await page.waitForSelector('.tr-over', { timeout: 15000 }).catch(() => {});
    out.result = await page.evaluate(() => document.getElementById('tr-ov').innerText.slice(0, 240));
    await page.locator('#tr-ov').scrollIntoViewIfNeeded().catch(() => {});
    await page.screenshot({ path: '/tmp/gt/result-logged-390.jpg', type: 'jpeg', quality: 80 });
  }
  out.calls = calls.slice(0, 30); out.errs = errs.slice(0, 10);
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})().catch(e => { console.error('FAIL', String(e).slice(0, 800)); process.exit(1); });
