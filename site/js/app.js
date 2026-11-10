// Entry point for every public page: draws the layout, then runs the page by <body data-page>.
import { chrome } from './layout.js';
import * as C from './pages/catalog.js';
import * as A from './pages/account.js';
import * as G from './pages/game.js';
import * as GH from './pages/games.js';
import { api, DEMO } from './api.js';
import { watchForms, waLink, esc } from './util.js';
const PAGES = {
  home: C.home, products: () => C.listing('products'), trending: () => C.listing('trending'), deals: () => C.listing('deals'), featured: () => C.listing('featured'),
  product: C.product, categories: C.categoriesPage, brands: C.brandsPage, apps: () => C.appsPage(false), apk: () => C.appsPage(true), app: C.appDetail,
  videos: () => C.videosPage('tutorial'), 'promo-videos': () => C.videosPage('promo'), ads: C.adsPage, offers: C.offersPage, about: C.aboutPage, contact: C.contactPage,
  login: A.login, register: A.register, forgot: A.forgot, reset: A.reset, dashboard: A.dashboard, profile: A.profilePage, wishlist: A.wishlistPage, cart: A.cartPage, checkout: A.checkout,
  payment: A.payment, 'payment-submit': A.paymentSubmit, orders: A.orders, order: A.orderDetail, wallet: A.walletPage, returns: A.returnsPage,
  game: G.gamePage,
  games: GH.gamesHub, play: GH.arcadePage,
};

// Visitor location (state / district) — ONLY if the visitor taps "Haan". Exact position is never saved: only the state and district name.
function geoAsk(vid) {
  try {
    if (!navigator.geolocation) return; const day = new Date().toISOString().slice(0, 10); if (localStorage.getItem('sz_geo_day') === day || localStorage.getItem('sz_geo_deny') === day) return;
    setTimeout(async () => { try {
      const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: false, timeout: 20000, maximumAge: 86400000 }));
      const u = 'https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=' + pos.coords.latitude.toFixed(2) + '&longitude=' + pos.coords.longitude.toFixed(2) + '&localityLanguage=en';
      const j = await (await fetch(u)).json(); const adm = (j.localityInfo && j.localityInfo.administrative) || []; const dist = (adm.find((a) => a.adminLevel === 5 && /district/i.test(a.name)) || adm.find((a) => a.adminLevel === 5) || {}).name || j.city || '';
      const vill = j.locality || j.city || '';
      if (j.principalSubdivision) await api.rpc('track_visit_geo', { p_vid: vid, p_state: j.principalSubdivision, p_district: dist, p_village: vill });
      localStorage.setItem('sz_geo_day', day);
    } catch (e) { try { if (e && e.code === 1) localStorage.setItem('sz_geo_deny', new Date().toISOString().slice(0, 10)); } catch {} } }, 3000);
  } catch {}
}
// Maintenance mode: when the admin has UNPUBLISHED the site, visitors see a friendly closed page (admins still see the site, with a banner).
function closedPage(st) {
  const wa = (window.SHOPZENT_CONFIG && window.SHOPZENT_CONFIG.WHATSAPP_FALLBACK) || '9942598154';
  const root = document.body.dataset.root || '.';
  document.title = 'SHOPZENT — thodi der me wapas | Back soon';
  document.body.className = ''; document.body.removeAttribute('data-page');
  document.body.innerHTML = `<main id="main" style="min-height:100vh;display:grid;place-items:center;padding:20px;background:#0E0818"><div style="max-width:440px;width:100%;background:#1B1230;color:#fff;border-radius:24px;box-shadow:0 20px 50px rgba(124,58,237,.35);padding:28px 22px;text-align:center">
    <img src="${root}/assets/logo-lockup.png?v=5" alt="SHOPZENT" style="height:44px;margin-bottom:14px">
    <div style="font-size:3rem;line-height:1" aria-hidden="true">🛠️</div>
    <h1 style="font-size:1.35rem;margin:12px 0 6px">Website abhi thodi der ke liye band hai</h1>
    <p style="font-size:1.05rem;margin:0 0 14px"><b>Jaldi wapas aayenge 🙏</b></p>
    <p style="color:#d1d5db;margin:0 0 6px">SHOPZENT is temporarily closed for a short while.<br>We will be back very soon.</p>
    ${st && st.message ? `<p style="background:rgba(167,139,250,.18);border-radius:14px;padding:10px 12px;margin:14px 0;color:#ede9fe">${esc(st.message)}</p>` : ''}
    <a href="${waLink(wa, 'Hi SHOPZENT')}" rel="noopener" style="display:flex;align-items:center;justify-content:center;gap:8px;height:50px;border-radius:999px;background:#16a34a;color:#fff;font-weight:600;text-decoration:none;margin-top:16px">💬 WhatsApp: +91 ${esc(wa)}</a>
    <p style="margin:16px 0 0;font-size:.8rem"><a href="${root}/admin/index.html" style="color:#9ca3af;text-decoration:none">Admin</a></p></div></main>`;
}
(async () => {
  const page = document.body.dataset.page;
  const statusP = DEMO ? Promise.resolve(null) : api.rpc('public_site_status').catch(() => null); // runs beside the page's own first requests: no extra wait
  try { await chrome(); } catch (e) { console.error(e); }
  watchForms();
  const st = await statusP;
  if (st && st.published === false) {
    const me = await api.auth.profile().catch(() => null);
    if (me && ['admin', 'super_admin'].includes(me.role)) document.body.insertAdjacentHTML('afterbegin', '<div style="background:#dc2626;color:#fff;text-align:center;padding:8px;font-weight:600;position:sticky;top:0;z-index:99">🔴 Website is UNPUBLISHED — customers see the closed page. Only you can see this. <a href="admin/dashboard.html" style="color:#fff;text-decoration:underline">Publish again</a></div>');
    else { closedPage(st); return; }
  }
  try { if (!DEMO) { let vid = localStorage.getItem('sz_vid'); if (!vid) { vid = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)); localStorage.setItem('sz_vid', vid); } api.rpc('track_visit', { p_vid: vid, p_src: /SHOPZENTApp/.test(navigator.userAgent) ? 'app' : 'web' }).catch(() => {}); geoAsk(vid); } } catch {}
  try { if (page && page.startsWith('legal-')) await C.legalPage(page.slice(6)); else if (PAGES[page]) await PAGES[page](); }
  catch (e) { if (e && e.message === 'redirect') return; console.error(e); const m = document.getElementById('main'); if (m && !m.dataset.static) m.insertAdjacentHTML('afterbegin', '<div class="container"><div class="alert bad" style="margin-top:16px">Something went wrong loading this page. Please refresh. If it keeps happening, contact us on WhatsApp.</div></div>'); }
})();
