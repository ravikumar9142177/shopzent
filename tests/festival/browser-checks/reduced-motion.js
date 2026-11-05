
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
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, reducedMotion: process.env.RM ? 'reduce' : 'no-preference' });
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
  const browser = await chromium.launch({ executablePath: '/home/user/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome', args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  const r = await storefront(browser, 'diwali-reduced', { enabled: true, theme: 'diwali', variant: 0, title: 'Happy Diwali', greeting: 'x', intensity: 'high', starts_at: '2026-11-01T00:00:00+05:30', ends_at: '2026-11-30T23:59:00+05:30', offer: { enabled: true, headline: 'Diwali offer: 20% OFF', text: 'Limited', link: 'https://qeuika.shop/products.html', code: 'DIWALI20', show_code: true }, version: 2 }, 'index.html', 'festival-diwali-reduced-390.jpg', { interact: true });
  console.log(JSON.stringify(r));
  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
