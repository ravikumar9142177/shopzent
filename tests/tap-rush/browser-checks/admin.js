// Tap Rush browser check (see ../README.md). Mocked sessions where noted.

const { chromium } = require('/home/user/node_modules/playwright-core');
const fs = require('fs');
const sess = JSON.parse(fs.readFileSync('/tmp/gt/sess_admin.json', 'utf8'));
(async () => {
  const browser = await chromium.launch({ executablePath: '/home/user/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome', args: ['--no-sandbox','--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await ctx.addInitScript((s) => { try { localStorage.setItem('sb-njrgbpvpabqgjqiojtjr-auth-token', JSON.stringify(s)); } catch (e) {} }, sess);
  const page = await ctx.newPage();
  const errs = []; page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
  page.on('pageerror', e => errs.push('pageerror: ' + String(e).slice(0, 300)));
  const calls = [];
  const rows = [
    { id: 7, week_key: '2026-11-02', place: 1, customer_id: 'SZC-TEST01', full_name: 'Suraj Test', score: 3720, coins: 30, won_at: '2026-11-03T10:00:00Z', submit_status: 'pending', name_submitted: 'Ravi K', name_approved: null, photo_pending_path: sess.user.id + '/1762300000-abc.jpg', photo_public_path: null, reject_reason: null, submitted_at: '2026-11-04T10:00:00Z', reviewed_at: null },
    { id: 8, week_key: '2026-11-02', place: 2, customer_id: 'SZC-TEST02', full_name: 'Priya Rao', score: 3650, coins: 20, won_at: '2026-11-03T11:00:00Z', submit_status: 'approved', name_submitted: 'Priya', name_approved: 'Priya R', name_approved_x: null, photo_pending_path: null, photo_public_path: 'settings/game-winners/demo-2.jpg', reject_reason: null, submitted_at: null, reviewed_at: '2026-11-04T09:00:00Z' },
    { id: 9, week_key: '2026-11-02', place: 3, customer_id: 'SZC-TEST03', full_name: 'Amit Shah', score: 3610, coins: 10, won_at: '2026-11-03T12:00:00Z', submit_status: 'rejected', name_submitted: 'Amit <i>', name_approved: null, photo_pending_path: null, photo_public_path: null, reject_reason: 'Photo not clear', submitted_at: null, reviewed_at: '2026-11-04T09:30:00Z' },
  ];
  await page.route('**/storage/v1/object/**', (route) => { if (route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'image/jpeg', body: fs.readFileSync('/tmp/gt/photo.jpg') }); if (/\/sign\//.test(route.request().url())) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ signedURL: '/storage/v1/object/sign/game-photos/x.jpg?token=t' }) }); calls.push('storage ' + route.request().method() + ' ' + route.request().url().split('/object/')[1].slice(0, 40)); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: 'x', Id: 'x' }) }); });
  await page.route('**/rest/v1/site_settings**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ key: 'game_weekly', value: { enabled: true, target_score: 3600, prizes: [30, 20, 10] } }) }));
  await page.route('**/rest/v1/rpc/**', async (route) => {
    const name = route.request().url().split('/rpc/')[1].split('?')[0]; const body = route.request().postData() || ''; calls.push(name);
    let out = {};
    if (name === 'my_profile') out = { id: sess.user.id, customer_id: 'SZC-ADMIN', full_name: 'Admin', email: 'admin@example.test', role: 'admin', status: 'active', aal: 'aal2' };
    if (name === 'admin_game_pending_count') out = 1;
    if (name === 'admin_game_winners_list') out = { rows, pending: 1, week_key: '2026-11-02' };
    if (name === 'admin_site_status') out = { published: true };
    if (name === 'admin_security_alert_counts') out = { new_total: 0, new_high: 0 };
    if (name === 'admin_notifications') out = [];
    if (name === 'admin_game_approve' || name === 'admin_game_reject' || name === 'admin_set_game_settings') { calls.push(name + ' ' + body.slice(0, 120)); out = { ok: true, submit_status: 'approved', delete_pending: null, delete_public: null }; }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) });
  });
  await page.goto('http://127.0.0.1:8791/admin/game-winners.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[data-id="7"]', { timeout: 20000 });
  await page.waitForTimeout(1200);
  const out = {};
  out.rows = await page.evaluate(() => [...document.querySelectorAll('#gw-list [data-id]')].map(c => c.innerText.replace(/\n+/g, ' | ').slice(0, 160)));
  out.badge = await page.evaluate(() => (document.querySelector('.adm-side a[href="game-winners.html"]') || {}).innerText);
  out.imgs = await page.evaluate(() => [...document.querySelectorAll('#gw-list [data-prev] img')].length);
  await page.screenshot({ path: '/tmp/gt/admin-gw-390.jpg', type: 'jpeg', quality: 80 });
  // reject flow: confirm dialog with reason
  await page.locator('[data-id="7"] [data-rj]').click();
  await page.waitForTimeout(400);
  await page.locator('#cb-in').fill('Too blurry');
  await page.locator('#cb-ok').click();
  await page.waitForTimeout(800);
  // approve flow for id 7 (copies the pending photo to public-media)
  await page.locator('[data-id="7"] [data-ap]').click().catch(() => {});
  await page.waitForTimeout(400);
  await page.locator('#cb-ok').click().catch(() => {});
  await page.waitForTimeout(1500);
  out.calls = calls.filter(c => /admin_game_approve|storage|admin_game_reject/.test(c)).slice(0, 20);
  out.errs = errs.slice(0, 8);
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})().catch(e => { console.error('FAIL', String(e).slice(0, 800)); process.exit(1); });
