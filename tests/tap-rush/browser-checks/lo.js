// Tap Rush browser check (see ../README.md). Mocked sessions where noted.

const { chromium } = require('/home/user/node_modules/playwright-core');
const fs = require('fs');
(async () => {
  const browser = await chromium.launch({ executablePath: '/home/user/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome', args: ['--no-sandbox','--use-gl=swiftshader','--enable-unsafe-swiftshader','--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const errs = []; page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errs.push(m.type() + ': ' + m.text().slice(0, 300)); });
  page.on('pageerror', e => errs.push('pageerror: ' + String(e).slice(0, 300)));
  const reqs = []; page.on('response', r => { if (/rpc\/game_|game-photos|game_state/.test(r.url())) reqs.push(r.status() + ' ' + r.url().split('/rest/v1/')[1]); });
  await page.goto('http://127.0.0.1:8791/game.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#tr-banner .tr-chips', { timeout: 20000 });
  await page.waitForSelector('.tr-go', { timeout: 10000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: '/tmp/gt/lo-idle.jpg', type: 'jpeg', quality: 80, fullPage: false });
  const fpsInit = await page.evaluate(() => { window.__f = 0; const f = () => { window.__f++; requestAnimationFrame(f); }; requestAnimationFrame(f); return 1; });
  await page.click('.tr-go');
  await page.waitForTimeout(3300);
  await page.locator('#tr-cv').scrollIntoViewIfNeeded();
  const playing = await page.evaluate(() => document.getElementById('tr-ov').hidden);
  // scripted taps across the field for ~30 s
  let box = await page.locator('#tr-cv').boundingBox();
  const t0 = Date.now(); let n = 0;
  while (Date.now() - t0 < 30500) {
    if (n % 10 === 0) { await page.locator('#tr-cv').scrollIntoViewIfNeeded(); box = await page.locator('#tr-cv').boundingBox(); }
    const x = box.x + 30 + Math.random() * (box.width - 60), y = box.y + 80 + Math.random() * (box.height - 160);
    await page.mouse.click(x, y); n++;
    if (n === 40) await page.screenshot({ path: '/tmp/gt/lo-play.jpg', type: 'jpeg', quality: 80 });
    await page.waitForTimeout(130);
  }
  await page.waitForSelector('.tr-over', { timeout: 15000 }).catch(() => {});
  const over = await page.evaluate(() => ({ score: document.querySelector('.tr-final')?.textContent, best: document.querySelector('.tr-over')?.textContent.slice(0, 200) }));
  await page.screenshot({ path: '/tmp/gt/lo-over.jpg', type: 'jpeg', quality: 80 });
  const fps = await page.evaluate(() => window.__f / ((performance.now() - (window.__t0 || performance.now())) / 1000 || 1));
  const frames = await page.evaluate(() => window.__f);
  const pod = await page.evaluate(() => document.getElementById('tr-podium').innerText.slice(0, 200));
  const layoutOK = await page.evaluate(() => { const s = document.getElementById('tr-stage').getBoundingClientRect(); return { w: s.width, h: s.height, docW: document.documentElement.scrollWidth, vw: window.innerWidth }; });
  console.log(JSON.stringify({ playing, taps: n, over, frames_total: frames, layoutOK, podium: pod, errs: errs.slice(0, 12), reqs }, null, 1));
  await browser.close();
})().catch(e => { console.error('FAIL', e); process.exit(1); });
