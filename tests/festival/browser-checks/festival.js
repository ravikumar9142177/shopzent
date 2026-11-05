
const { chromium } = require('/home/user/node_modules/playwright-core');
const fs = require('fs');
const SETTINGS = JSON.parse(fs.readFileSync('/tmp/fz/settings.json', 'utf8'));
const SESS = JSON.parse(fs.readFileSync('/tmp/gt/sess_admin.json', 'utf8'));
const OUT = '/home/user/tab/files/shopzent-festival/shots/';
const now = new Date().toISOString();
const FEST = (o) => ({ enabled: true, theme: 'diwali', variant: 0, title: 'Happy Diwali', greeting: 'Shubh Deepawali 🪔 Roshni, mithai aur naye offers.', intensity: 'medium', accent: '', tune: true, tune_url: null,
  starts_at: '2026-11-01T00:00:00+05:30', ends_at: '2026-11-30T23:59:00+05:30', offer: { enabled: true, headline: 'Diwali offer: 20% OFF', text: 'Limited time ke liye.', link: 'products.html', code: 'DIWALI20', show_code: false }, version: 1, ...o });
function settingsWith(f) { const rows = SETTINGS.filter((r) => r.key !== 'festival'); rows.push({ key: 'festival', value: f, is_public: true }); return rows; }
async function ctxFor(browser) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  return ctx;
}
async function storefront(browser, name, f, path, shot, extra = {}) {
  const ctx = await ctxFor(browser); const page = await ctx.newPage();
  const errs = []; page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); }); page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 200)));
  const reqs = []; page.on('request', (r) => { if (/festival|game|settings/.test(r.url()) && /\.js|\.css|site_settings/.test(r.url())) reqs.push(r.url().split('/').slice(-2).join('/').slice(0, 80)); });
  await page.addInitScript(() => { window.__cls = 0; try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true }); } catch (e) { } });
  await page.route('**/rest/v1/site_settings**', (route) => {
    const u = route.request().url();
    if (/key=eq\.festival/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ key: 'festival', value: f }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(settingsWith(f)) });
  });
  const t0 = Date.now();
  await page.goto('http://127.0.0.1:8792/' + path, { waitUntil: 'load' });
  await page.waitForTimeout(extra.wait || 2500);
  const loadMs = Date.now() - t0;
  const res = { name, path, loadMs, festivalBand: await page.locator('.fz-band').count(), strip: await page.locator('.fz-strip').count(), canvas: await page.locator('.fz-canvas').count(), mute: await page.locator('.fz-mute').count(), reqs, errs: errs.slice(0, 6) };
  await page.screenshot({ path: OUT + shot, type: 'jpeg', quality: 82 });
  res.cls = await page.evaluate(() => Number(window.__cls.toFixed(4)));
  res.menuOpenable = await page.evaluate(() => { const b = document.getElementById('menu-btn'); return !!b; });
  if (extra.interact) {
    await page.click('#menu-btn'); await page.waitForTimeout(400);
    res.drawerOpen = await page.evaluate(() => document.getElementById('drawer').classList.contains('open'));
    await page.mouse.click(372, 600); await page.waitForTimeout(300);
    res.tuneTriedFlag = await page.evaluate(() => sessionStorage.getItem('sz.fz.tuned'));
    if (res.mute) { const before = await page.locator('.fz-mute').textContent(); await page.locator('.fz-mute').click(); await page.waitForTimeout(200); res.muteBefore = before; res.muteAfter = await page.locator('.fz-mute').textContent(); await page.locator('.fz-mute').click(); }
    if (res.strip) { await page.locator('.fz-x').click(); await page.waitForTimeout(200); res.stripAfterDismiss = await page.locator('.fz-strip').count(); res.dismissStored = await page.evaluate(() => localStorage.getItem('sz.fz.dismiss')); }
    res.headerVisible = await page.evaluate(() => { const h = document.querySelector('.hdr').getBoundingClientRect(); return Math.round(h.height); });
    await page.screenshot({ path: OUT + shot.replace('.jpg', '-after.jpg'), type: 'jpeg', quality: 82 });
  }
  await ctx.close(); return res;
}
(async () => {
  const browser = await chromium.launch({ executablePath: '/home/user/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome', args: ['--no-sandbox', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  const out = {};
  const mode = process.argv[2] || 'all';
  if (mode === 'all' || mode === 'sf') {
    out.off_home = await storefront(browser, 'off', { enabled: false }, 'index.html', 'festival-off-home-390.jpg', { interact: false });
    out.diwali_home = await storefront(browser, 'diwali', FEST({}), 'index.html', 'festival-diwali-390.jpg', { interact: true });
    out.chhath_home = await storefront(browser, 'chhath', FEST({ theme: 'chhath', variant: 0, title: '', greeting: '', offer: { enabled: false } }), 'index.html', 'festival-chhath-390.jpg', { interact: true });
    out.diwali_checkout = await storefront(browser, 'checkout', FEST({}), 'cart.html', 'festival-diwali-cart-390.jpg', {});
    out.diwali_outside_window = await storefront(browser, 'ended', FEST({ ends_at: '2026-11-02T00:00:00+05:30' }), 'index.html', 'festival-ended-390.jpg', {});
  }
  if (mode === 'all' || mode === 'admin') {
    out.admin = await adminCheck(browser);
  }
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });

async function adminCheck(browser) {
  const ctx = await ctxFor(browser); await ctx.addInitScript((s) => { try { localStorage.setItem('sb-njrgbpvpabqgjqiojtjr-auth-token', JSON.stringify(s)); } catch (e) { } }, SESS);
  const page = await ctx.newPage(); const errs = []; page.on('pageerror', (e) => errs.push('pageerror: ' + String(e).slice(0, 200))); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });
  const calls = [];
  await page.route('**/rest/v1/site_settings**', (route) => { const u = route.request().url(); if (/key=eq\.festival/.test(u)) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ key: 'festival', value: { enabled: false, theme: 'none' } }) }); return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }); });
  await page.route('**/rest/v1/rpc/**', async (route) => {
    const name = route.request().url().split('/rpc/')[1].split('?')[0]; const body = route.request().postData() || ''; calls.push(name + ' ' + body.slice(0, 300));
    let out = {};
    if (name === 'my_profile') out = { id: SESS.user.id, customer_id: 'SZC-ADMIN', full_name: 'Admin', email: 'admin@example.test', role: 'admin', status: 'active', aal: 'aal2' };
    if (name === 'admin_set_festival') out = JSON.parse(body).p_value;
    if (name === 'admin_reset_festival') out = { enabled: false, theme: 'none', version: 1 };
    if (name.endsWith('_list') || name.includes('notifications')) out = [];
    if (name === 'admin_stats') out = {};
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(out) });
  });
  await page.route('**/auth/v1/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ all: [], current: 'aal2', next: 'aal2', totp: [], user: SESS.user }) }));
  await page.goto('http://127.0.0.1:8792/admin/festival.html', { waitUntil: 'load' });
  await page.waitForSelector('#fs-looks .fs-look', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(800);
  const r = { errs: [] };
  r.looksInitial = await page.locator('#fs-looks .fs-look').count();
  r.status = (await page.textContent('#fs-status')).replace(/\s+/g, ' ').slice(0, 160);
  await page.screenshot({ path: OUT + 'festival-admin-390.jpg', type: 'jpeg', quality: 82, fullPage: false });
  // keyword matcher
  await page.fill('#fs-cmd', 'chhath');
  await page.click('#fs-cmd-go'); await page.waitForTimeout(400);
  r.fest_after_chhath = await page.inputValue('#fs-fest');
  r.on_after_chhath = await page.isChecked('#fs-on');
  r.title_after = await page.inputValue('#fs-title');
  r.msg = (await page.textContent('#fs-cmd-msg')).slice(0, 120);
  await page.fill('#fs-cmd', 'diwali offer 20%'); await page.click('#fs-cmd-go'); await page.waitForTimeout(400);
  r.fest_after_diwali = await page.inputValue('#fs-fest'); r.offer_headline = await page.inputValue('#fs-oh'); r.offer_on = await page.isChecked('#fs-oon');
  // pick look 4
  await page.locator('#fs-looks .fs-look').nth(3).click(); await page.waitForTimeout(300);
  r.look_on = await page.locator('#fs-looks .fs-look.on').getAttribute('data-k');
  await page.locator('#fs-looks').scrollIntoViewIfNeeded(); await page.waitForTimeout(300);
  await page.screenshot({ path: OUT + 'festival-admin-looks-390.jpg', type: 'jpeg', quality: 82 });
  await page.locator('#fs-prev').scrollIntoViewIfNeeded(); await page.waitForTimeout(500);
  await page.screenshot({ path: OUT + 'festival-admin-preview-390.jpg', type: 'jpeg', quality: 82 });
  // save (confirm box)
  await page.check('#fs-on');
  await page.locator('#fs-save').click(); await page.waitForTimeout(400);
  r.confirmShown = await page.locator('text=Festival save karein?').count();
  await page.locator('button:has-text("Save & publish")').last().click(); await page.waitForTimeout(800);
  r.saveCall = calls.filter((c) => c.startsWith('admin_set_festival')).slice(-1)[0] || null;
  // reset
  await page.locator('#fs-reset').click(); await page.waitForTimeout(400);
  r.resetConfirm = await page.locator('text=Reset to normal?').count();
  await page.locator('button:has-text("Reset")').last().click(); await page.waitForTimeout(700);
  r.resetCall = calls.filter((c) => c.startsWith('admin_reset_festival')).length;
  r.pageErrors = errs.slice(0, 8);
  await page.screenshot({ path: OUT + 'festival-admin-after-reset-390.jpg', type: 'jpeg', quality: 82 });
  await ctx.close();
  return r;
}
