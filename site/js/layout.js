// Shared layout: header, navigation, footer, bottom nav, cart/wishlist state, product cards.
import { api, DEMO, config } from './api.js';
import { $, $$, esc, inr, safeUrl, safeImg, toast, waLink, reveal, modal, fmtDate } from './util.js';
export const ROOT = document.body.dataset.root || '.';
export const href = (p) => (ROOT === '.' ? p : ROOT + '/' + p);
export const media = (u) => { const s = safeImg(u); if (!s) return ''; if (/^(https:|data:)/.test(s)) return s; return href(s.replace(/^\.\//, '')); };
export const IC = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  cart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.5L21 8H6.2"/><circle cx="10" cy="20" r="1.3"/><circle cx="17" cy="20" r="1.3"/></svg>',
  heart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 20s-7-4.4-9.2-9A5 5 0 0 1 12 6a5 5 0 0 1 9.2 5C19 15.6 12 20 12 20z"/></svg>',
  heartF: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 20s-7-4.4-9.2-9A5 5 0 0 1 12 6a5 5 0 0 1 9.2 5C19 15.6 12 20 12 20z"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M4 7h16M4 12h16M4 17h10"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>',
  grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/></svg>',
  tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 12V4h8l10 10-8 8z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
  bell: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 21h4"/></svg>',
  wa: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.3-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.3 2.2 2.2 0 0 0 .2-1.3c-.1-.1-.3-.2-.5-.3z"/></svg>',
  mail: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>',
  ig: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.5" cy="6.5" r="1" fill="currentColor"/></svg>',
  yt: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M22 8.2a3 3 0 0 0-2.1-2.1C18 5.6 12 5.6 12 5.6s-6 0-7.9.5A3 3 0 0 0 2 8.2 31 31 0 0 0 1.6 12 31 31 0 0 0 2 15.8a3 3 0 0 0 2.1 2.1c1.9.5 7.9.5 7.9.5s6 0 7.9-.5a3 3 0 0 0 2.1-2.1 31 31 0 0 0 .4-3.8 31 31 0 0 0-.4-3.8zM10 15V9l5.2 3z"/></svg>',
  fb: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M14 8h3V4h-3a4 4 0 0 0-4 4v2H8v4h2v8h4v-8h3l1-4h-4V8z"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.8 3h3.1l-6.8 7.8L22 21h-6.2l-4.9-6.4L5.3 21H2.2l7.3-8.3L2 3h6.4l4.4 5.8zm-1.1 16.2h1.7L7.4 4.7H5.6z"/></svg>',
  tg: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21.5 4.3L2.9 11.5c-1.3.5-1.2 1.2-.2 1.5l4.8 1.5 1.8 5.6c.2.6.4.8.9.8.4 0 .6-.2.9-.5l2.3-2.2 4.8 3.5c.9.5 1.5.2 1.7-.8l3.1-14.6c.3-1.3-.5-1.9-1.5-1.5zM9.6 14.2l8.6-5.4c.4-.2.8-.1.5.2l-7.4 6.7-.3 3.2z"/></svg>',
  play: '<svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
  ext: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
};
// ---------- state ----------
export const cart = {
  get() { try { return JSON.parse(localStorage.getItem('sz_cart') || '[]').filter((i) => i && i.product_id); } catch { return []; } },
  set(items) { localStorage.setItem('sz_cart', JSON.stringify(items.slice(0, 30))); updateBadges(); },
  // one cart line per product + size (size '' = no size)
  add(id, qty = 1, size = '') { const sz = size || ''; const c = cart.get(); const i = c.find((x) => x.product_id === id && (x.size || '') === sz); if (i) i.qty = Math.min(20, i.qty + qty); else c.push({ product_id: id, qty: Math.min(20, qty), ...(sz ? { size: sz } : {}) }); cart.set(c); },
  qty(id, qty, size = '') { const sz = size || ''; const c = cart.get().map((x) => x.product_id === id && (x.size || '') === sz ? { ...x, qty: Math.max(1, Math.min(20, qty)) } : x); cart.set(c); },
  remove(id, size = '') { const sz = size || ''; cart.set(cart.get().filter((x) => !(x.product_id === id && (x.size || '') === sz))); },
  clear() { cart.set([]); },
  count() { return cart.get().reduce((a, x) => a + x.qty, 0); },
};
let _settings = null, _profile, _wish = null, _cats = null, _brands = null;
export async function settings() { if (_settings) return _settings; try { const c = JSON.parse(sessionStorage.getItem('sz.settings') || 'null'); if (c && Date.now() - c.t < 120000 && !location.pathname.includes('/admin/')) { _settings = c.v; } } catch {} if (!_settings) try { const rows = await api.select('site_settings'); _settings = Object.fromEntries(rows.map((r) => [r.key, r.value || {}])); try { sessionStorage.setItem('sz.settings', JSON.stringify({ t: Date.now(), v: _settings })); } catch {} } catch { _settings = {}; }
  _settings.contact = { whatsapp: config.WHATSAPP_FALLBACK, email: config.EMAIL_FALLBACK, ..._settings.contact }; return _settings; }
export async function profile() { if (_profile !== undefined) return _profile; try { _profile = await api.auth.profile(); } catch { _profile = null; } return _profile; }
export function resetProfile() { _profile = undefined; }
export async function categories() { if (!_cats) { try { _cats = await api.select('categories', { eq: { published: true }, order: { col: 'sort', asc: true } }); try { const used = new Set((await api.select('products', { eq: { published: true }, limit: 1000 })).map((x) => x.category_id)); if (used.size) _cats = _cats.filter((c) => used.has(c.id)); } catch {} } catch { _cats = []; } } return _cats; }
export async function brands() { if (!_brands) { try { _brands = await api.select('brands', { eq: { published: true }, order: { col: 'sort', asc: true } }); } catch { _brands = []; } } return _brands; }
export async function wishlistIds() { if (_wish) return _wish; const p = await profile(); if (!p) { _wish = new Set(); return _wish; } try { _wish = new Set((await api.select('wishlist')).map((w) => w.product_id)); } catch { _wish = new Set(); } return _wish; }
// share the SHOPZENT website itself (no reward)
export async function shareSite() { const text = 'SHOPZENT — shopping ka naya address'; const url = 'https://qeuika.shop/';
  try { if (navigator.share) { await navigator.share({ title: 'SHOPZENT', text, url }); return; } } catch { return; }
  window.open(`https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}`, '_blank', 'noopener'); }
export async function toggleWish(id, btn) { const p = await profile(); if (!p) { toast('Please log in to save items to your wishlist.'); setTimeout(() => location.href = href('login.html?next=' + encodeURIComponent(location.pathname.split('/').pop() + location.search)), 900); return; }
  try { const on = await api.rpc('toggle_wishlist', { p_product_id: id }); const w = await wishlistIds(); on ? w.add(id) : w.delete(id); document.querySelectorAll('[data-wish]').forEach((b) => { if (b.dataset.wish !== String(id)) return; b.classList.toggle('on', on); b.innerHTML = (on ? IC.heartF : IC.heart) + (b.dataset.label ? ` <span>${on ? 'Saved' : 'Save'}</span>` : ''); b.setAttribute('aria-pressed', on); }); toast(on ? 'Saved to wishlist ❤️' : 'Removed from wishlist'); } catch (e) { toast('Could not update wishlist', 'bad'); } }
function updateBadges() { const n = cart.count(); $$('[data-cart-count]').forEach((b) => { b.textContent = n || ''; b.dataset.n = n; }); }
// ---------- product card ----------
export function productCard(p, wish = new Set()) {
  const img = media((p.images || [])[0]) || href('assets/img/placeholder.svg');
  const flags = [p.is_deal ? '<span class="tag orange">Deal</span>' : '', p.is_trending ? '<span class="tag pink">Trending</span>' : '', p.availability === 'out_of_stock' ? '<span class="tag gray">Out of stock</span>' : ''].join('');
  const aff = p.purchase_type === 'affiliate', hasLink = !aff || !!p.affiliate_url, noPrice = p.price == null || p.price === '';
  const priceHtml = noPrice ? `<div class="price"><span class="small muted">${aff && hasLink ? 'See price on ' + esc(mktName(p.marketplace)) : 'See price'}</span></div>`
    : `<div class="price"><b>${inr(p.price)}</b>${p.original_price && p.original_price > p.price ? `<s>${inr(p.original_price)}</s><span class="off">${Math.round((p.original_price - p.price) / p.original_price * 100)}% off</span>` : ''}</div>`;
  const purl = href('product.html?slug=' + encodeURIComponent(p.slug));
  const on = wish.has(p.id);
  return `<article class="pcard"><a class="img" href="${href('product.html?slug=' + encodeURIComponent(p.slug))}" aria-label="${esc(p.name)}"><img loading="lazy" decoding="async" src="${esc(img)}" alt="${esc(p.name)}" width="400" height="400">${p.is_sample ? '<span class="sample-ribbon">SAMPLE LISTING</span>' : ''}</a>
    <div class="flags">${flags}</div><button class="wish ${on ? 'on' : ''}" data-wish="${esc(p.id)}" aria-label="Save to wishlist" aria-pressed="${on}">${on ? IC.heartF : IC.heart}</button>
    <div class="body"><div class="row between"><span class="brand">${esc(p._brand || '')}</span><span class="mkt ${esc(p.marketplace)}">${esc(mktName(p.marketplace))}</span></div>
    <h3><a href="${href('product.html?slug=' + encodeURIComponent(p.slug))}">${esc(p.name)}</a></h3>${priceHtml}
    ${p.purchase_type === 'affiliate' && p.price != null && p.price_verified_at ? `<span class="tiny muted">Price checked ${new Date(p.price_verified_at).toLocaleDateString('en-IN')}</span>` : ''}
    <div class="save-row"><button class="btn ghost sm save-card" type="button" data-wish="${esc(p.id)}" data-label="1" aria-pressed="${on}">${on ? IC.heartF : IC.heart} <span>${on ? 'Saved' : 'Save'}</span></button></div><div class="foot">${aff ? (hasLink ? `<button class="btn sm block" data-aff="${esc(p.id)}">Buy on ${esc(mktName(p.marketplace))} ${IC.ext}</button>` : `<a class="btn sm sec block" href="${purl}">View details</a>`) : p.availability === 'out_of_stock' ? '<button class="btn sm sec block" disabled>Out of stock</button>' : noPrice ? `<a class="btn sm sec block" href="${purl}">View details</a>` : (p._sizes ? `<a class="btn sm block" href="${purl}">Size chuniye 👕</a>` : `<button class="btn sm block" data-add="${esc(p.id)}">Add to cart</button>`)}</div></div></article>`;
}
export const mktName = (m) => ({ amazon: 'Amazon', flipkart: 'Flipkart', shopzent: 'SHOPZENT', other: 'Partner store' }[m] || 'Partner store');
export function skeletonCards(n = 4) { return Array.from({ length: n }, () => '<div class="sk-card"><div class="sk sk-img"></div><div class="sk sk-l"></div><div class="sk sk-l" style="width:60%"></div></div>').join(''); }
export async function decorate(products) { const [b, c] = await Promise.all([brands(), categories()]); const bm = Object.fromEntries(b.map((x) => [x.id, x.name])), cm = Object.fromEntries(c.map((x) => [x.id, x])); products.forEach((p) => { p._brand = bm[p.brand_id] || ''; p._cat = cm[p.category_id]; p._sizes = (p.sizes_enabled ?? p._cat?.has_sizes) === true; }); return products; }
export async function renderProducts(el, products, emptyMsg = 'No products here yet.') { if (!products.length) { el.innerHTML = `<div class="empty" style="grid-column:1/-1"><img src="${href('assets/img/empty.svg')}" alt=""><p>${esc(emptyMsg)}</p></div>`; return; } await decorate(products); const w = await wishlistIds(); el.innerHTML = products.map((p) => productCard(p, w)).join(''); }
export async function openAffiliate(id) { const win = window.open('', '_blank'); try { const url = await api.rpc('track_affiliate_click', { p_product_id: id }); const u = safeUrl(url, false); if (!u) throw new Error(); if (win) { win.opener = null; win.location.href = u; } else location.href = u; } catch { win && win.close(); toast('This affiliate link is not available right now.', 'bad'); } }
document.addEventListener('click', async (e) => {
  const add = e.target.closest('[data-add]'); if (add) { e.preventDefault(); cart.add(add.dataset.add, 1); toast('Added to cart 🛒', 'ok'); add.textContent = 'Added ✓'; setTimeout(() => { add.textContent = 'Add to cart'; }, 1400); return; }
  const aff = e.target.closest('[data-aff]'); if (aff) { e.preventDefault(); openAffiliate(aff.dataset.aff); return; }
  const wi = e.target.closest('[data-wish]'); if (wi) { e.preventDefault(); toggleWish(wi.dataset.wish, wi); return; }
  const ad = e.target.closest('[data-ad]'); if (ad) { e.preventDefault(); try { const u = await api.rpc('track_ad', { p_ad_id: ad.dataset.ad, p_event: 'click' }); const s = safeUrl(u); if (s) { if (/^https:/.test(s)) window.open(s, '_blank', 'noopener'); else location.href = href(s); } } catch {} }
});
// ---------- ads ----------
export async function adSlot(el, placement) { if (!el) return; try { const ads = (await api.select('ads', { eq: { placement }, order: { col: 'sort', asc: true }, limit: 3 })).filter((a) => a.image_url);
  if (!ads.length) { el.remove(); return; } el.innerHTML = ads.map((a) => `<a class="ad-slot" href="#" data-ad="${esc(a.id)}"><span class="lbl">AD</span><img loading="lazy" src="${esc(media(a.image_url))}" alt="${esc(a.title)}"></a>`).join('');
  ads.forEach((a) => api.rpc('track_ad', { p_ad_id: a.id, p_event: 'impression' }).catch(() => {})); } catch { el.remove(); } }
// ---------- app look: tab bar pages, 3D tilt ----------
const NO_TAB_BAR = ['checkout', 'payment', 'payment-submit', 'login', 'register', 'forgot', 'reset'];
// Subtle 3D tilt on product and category cards: mouse/pen only, never with reduced motion or on touch screens (no gyroscope).
// Sets --rx/--ry on the card; the CSS in css/app.css turns them into a transform. Delegated, so cards rendered later tilt too.
let _tiltOn = false;
export function initTilt() {
  if (_tiltOn || typeof matchMedia !== 'function') return; _tiltOn = true;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !matchMedia('(hover: hover) and (pointer: fine)').matches) return;
  const SEL = '.pcard, .cat';
  document.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const el = e.target.closest?.(SEL); if (!el) return;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) return;
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty('--rx', (-y * 7).toFixed(2) + 'deg'); el.style.setProperty('--ry', (x * 9).toFixed(2) + 'deg');
  }, { passive: true });
  document.addEventListener('pointerout', (e) => {
    const el = e.target.closest?.(SEL); if (!el || (e.relatedTarget && el.contains(e.relatedTarget))) return;
    el.style.setProperty('--rx', '0deg'); el.style.setProperty('--ry', '0deg');
  }, { passive: true });
}
// ---------- chrome ----------
const NAV = [['index.html', 'Home'], ['products.html', 'All Products'], ['categories.html', 'Categories'], ['trending.html', 'Trending'], ['deals.html', 'Best Deals'], ['featured.html', 'Featured'], ['brands.html', 'Brands'], ['apps.html', 'Digital Apps'], ['apk.html', 'APK Downloads'], ['videos.html', 'Video Tutorials'], ['promo-videos.html', 'Promo Videos'], ['offers.html', 'Coupons & Offers']];
// canonical + og:url: config SITE_URL, else the domain saved in Admin → Domain, else this site's own address
export function siteBase(s) { const d = String(s?.domain?.domain || '').trim().toLowerCase();
  if (config.SITE_URL) return config.SITE_URL.replace(/\/?$/, '/');
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) return 'https://' + d + '/';
  return location.origin + location.pathname.replace(/[^/]*$/, '').replace(/admin\/$/, ''); }
function setCanonical(s, here) { try { const url = siteBase(s) + (here === 'index.html' ? '' : here) + (['product.html', 'products.html'].includes(here) ? location.search : '');
  let l = document.querySelector('link[rel="canonical"]'); if (!l) { l = document.createElement('link'); l.rel = 'canonical'; document.head.appendChild(l); } l.href = url;
  let m = document.querySelector('meta[property="og:url"]'); if (!m) { m = document.createElement('meta'); m.setAttribute('property', 'og:url'); document.head.appendChild(m); } m.content = url;
  const og = document.querySelector('meta[property="og:image"]'); if (og && !/^https?:/.test(og.content)) og.content = siteBase(s) + 'assets/og.png'; } catch {} }
export async function chrome() {
  const page = document.body.dataset.page; const s = await settings(); const p = await profile(); const c = s.contact || {};
  const here = location.pathname.split('/').pop() || 'index.html';
  setCanonical(s, here);
  const top = document.createElement('div');
  top.innerHTML = `<a class="skip" href="#main">Skip to content</a>
  ${DEMO ? `<div class="demo-bar" role="note">👀 <b>Preview mode</b> — sample data stored only in your browser. No real orders, payments or accounts. <a href="${href('about.html#preview')}" style="color:#fff;text-decoration:underline">What's this?</a></div>` : ''}
  ${s.home?.announcement && !DEMO ? `<div class="demo-bar" style="background:var(--grad);color:#fff">${esc(s.home.announcement)}</div>` : ''}
  <header class="hdr"><div class="container hdr-in">
    <button class="icon-btn hide-lg" id="menu-btn" aria-label="Open menu">${IC.menu}</button>
    <a class="logo" href="${href('index.html')}" aria-label="SHOPZENT home"><img src="${esc(media(s.brand?.logo_url) || href('assets/logo-lockup.png?v=2'))}" alt="${esc(s.brand?.name || 'SHOPZENT')} — Discover More. Shop Smarter." width="210" height="36"></a><span class="fz-hslot"></span>
    <form class="search" role="search" action="${href('products.html')}"><input name="q" type="search" placeholder="Search products, brands…" aria-label="Search products" maxlength="80" value="${esc(new URLSearchParams(location.search).get('q') || '')}"><button type="button" class="cam-btn" aria-label="Search with a photo"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg></button><button aria-label="Search">${IC.search.replace('<svg', '<svg width="16" height="16"')}</button></form>
    <div class="hdr-actions"><a class="icon-btn hide-sm" href="${href('wishlist.html')}" aria-label="Wishlist">${IC.heart}</a>
      ${p ? `<button class="icon-btn" id="bell-btn" type="button" aria-label="Notifications">${IC.bell}<span class="badge" id="bell-n" style="display:none"></span></button>` : ''}
      <a class="icon-btn" href="${href('cart.html')}" aria-label="Cart">${IC.cart}<span class="badge" data-cart-count></span></a>
      <a class="icon-btn hide-sm" href="${href(p ? 'wallet.html' : 'login.html')}" aria-label="${p ? 'My wallet' : 'Log in'}">${IC.user}</a></div>
  </div><nav class="nav" aria-label="Main"><div class="container"><ul>${NAV.map(([h, l]) => `<li><a href="${href(h)}" class="${h === here ? 'active' : ''}">${l}</a></li>`).join('')}</ul></div></nav></header>
  <div class="drawer" id="drawer" aria-hidden="true"><div class="shade" data-close-drawer></div><div class="panel" role="dialog" aria-label="Menu">
    <div class="logo-c" style="margin:0 0 10px"><img src="${href('assets/logo-lockup.png?v=2')}" alt="SHOPZENT" style="height:34px"></div>
    ${p ? `<a class="drawer-me" href="${href('wallet.html')}" aria-label="Open my wallet"><div class="alert" style="margin:6px 4px 10px">Hi <b>${esc(p.full_name || 'there')}</b> · <code>${esc(p.customer_id || '')}</code> <span class="tiny" style="color:var(--purple);font-weight:700">Wallet →</span></div></a>` : `<div class="row" style="margin:8px 4px 12px"><a class="btn sm" href="${href('login.html')}" style="color:#fff">Log in</a><a class="btn sm sec" href="${href('register.html')}">Sign up</a></div>`}
    ${(() => { const L = (arr) => arr.map(([h, l]) => `<a href="${href(h)}">${l}</a>`).join('');
      const G = (ic, t, inner, open) => `<div class="dg${open ? ' open' : ''}"><button type="button" class="dg-h" aria-expanded="${open ? 'true' : 'false'}"><span>${ic} ${t}</span><i aria-hidden="true">›</i></button><div class="dg-b">${inner}</div></div>`;
      const adm = p && ['admin', 'super_admin'].includes(p.role) ? `<a href="${href('admin/index.html')}">🛡️ Admin Panel</a>` : '';
      return `<a class="dg-top" href="${href('index.html')}">🏠 Home</a>`
        + `<a class="dg-top" href="${href('downloads/shopzent-v1.2.0.apk')}" download="shopzent.apk" style="color:var(--purple);font-weight:800">📲 Download SHOPZENT App (APK)</a>`
        + G('🛍️', 'Shop', L([['products.html', 'All Products'], ['categories.html', 'Categories'], ['trending.html', 'Trending'], ['deals.html', 'Best Deals'], ['featured.html', 'Featured'], ['brands.html', 'Brands'], ['offers.html', 'Coupons & Offers'], ['games.html', '🎮 Play Game']]))
        + G('📲', 'Apps & Videos', L([['apps.html', 'Digital Apps'], ['apk.html', 'APK Downloads'], ['videos.html', 'Video Tutorials'], ['promo-videos.html', 'Promo Videos']]))
        + G('👤', 'My Account', L([['dashboard.html', 'Dashboard'], ['orders.html', 'My Orders'], ['wallet.html', 'Wallet & Coins'], ['wishlist.html', 'Wishlist'], ['returns.html', 'Returns / Refunds'], ['profile.html', 'Profile & Security']]) + adm + (p ? '<a href="#" data-logout>Log out</a>' : ''))
        + G('ℹ️', 'Help', L([['about.html', 'About Us'], ['contact.html', 'Contact Us'], ['ads.html', 'Advertisements'], ['privacy.html', 'Privacy Policy'], ['terms.html', 'Terms'], ['affiliate-disclosure.html', 'Affiliate Disclosure']])); })()}
    </div></div>`;
  document.body.prepend(top);
  categories().then((cs) => { const li = top.querySelector('.nav a[href$="categories.html"]')?.parentElement; if (!li || !cs.length) return; const frag = cs.map((c) => { const n = document.createElement('li'); n.innerHTML = `<a href="${href('products.html')}?category=${encodeURIComponent(c.slug)}">${esc(c.name)}</a>`; return n; }); li.after(...frag); }).catch(() => {});
  if (p && !DEMO) initBell();
  const year = new Date().getFullYear(); const so = s.social || {};
  const socials = [['instagram', IC.ig], ['youtube', IC.yt], ['facebook', IC.fb], ['x', IC.x], ['telegram', IC.tg]].filter(([k]) => safeUrl(so[k], false)).map(([k, i]) => `<a href="${esc(safeUrl(so[k], false))}" target="_blank" rel="noopener" aria-label="${k}">${i}</a>`).join('');
  const f = document.createElement('footer'); f.className = 'ftr';
  f.addEventListener('click', (e) => { const b = e.target.closest('[data-share-site]'); if (!b) return; e.preventDefault(); shareSite(); });
  f.innerHTML = `<div class="container"><div class="ftr-grid"><div class="about"><img src="${href('assets/logo-lockup.png?v=2')}" alt="SHOPZENT" style="height:46px;margin-bottom:12px"><p>${esc(s.brand?.tagline || 'Discover More. Shop Smarter.')} Multi-brand shopping, deals, Amazon & Flipkart picks, apps and videos in one place.</p>
    <div class="social">${socials}<button class="btn ghost sm" type="button" data-share-site style="margin-left:4px">Share website (no reward)</button><a href="${waLink(c.whatsapp, 'Hi SHOPZENT')}" target="_blank" rel="noopener" aria-label="WhatsApp">${IC.wa}</a><a href="mailto:${esc(c.email)}" aria-label="Email">${IC.mail}</a></div></div>
    <div><h4>Shop</h4><ul><li><a href="${href('products.html')}">All Products</a></li><li><a href="${href('trending.html')}">Trending</a></li><li><a href="${href('deals.html')}">Best Deals</a></li><li><a href="${href('featured.html')}">Featured</a></li><li><a href="${href('brands.html')}">Brands</a></li><li><a href="${href('offers.html')}">Coupons</a></li></ul></div>
    <div><h4>Discover</h4><ul><li><a href="${href('apps.html')}">Digital Apps</a></li><li><a href="${href('apk.html')}">APK Downloads</a></li><li><a href="${href('videos.html')}">Video Tutorials</a></li><li><a href="${href('promo-videos.html')}">Promo Videos</a></li><li><a href="${href('ads.html')}">Advertise</a></li><li><a href="${href('about.html')}">About Us</a></li></ul></div>
    <div><h4>Policies</h4><ul><li><a href="${href('privacy.html')}">Privacy Policy</a></li><li><a href="${href('terms.html')}">Terms & Conditions</a></li><li><a href="${href('refund-policy.html')}">Refund & Returns</a></li><li><a href="${href('shipping-policy.html')}">Shipping Policy</a></li><li><a href="${href('wallet-terms.html')}">Wallet & Coins Terms</a></li><li><a href="${href('coupon-terms.html')}">Coupon Terms</a></li><li><a href="${href('downloads-policy.html')}">Digital Downloads</a></li><li><a href="${href('affiliate-disclosure.html')}">Affiliate Disclosure</a></li></ul></div>
    <div><h4>Contact</h4><ul><li><a href="${waLink(c.whatsapp, 'Hi SHOPZENT')}" target="_blank" rel="noopener">WhatsApp: +91 ${esc(c.whatsapp)}</a></li><li><a href="mailto:${esc(c.email)}">${esc(c.email)}</a></li>${c.hours ? `<li>${esc(c.hours)}</li>` : ''}${c.address ? `<li>${esc(c.address)}</li>` : ''}<li><a href="${href('contact.html')}">Contact form →</a></li></ul></div></div>
    <p class="disclosure">SHOPZENT participates in affiliate marketing programs. Some links on this website are affiliate links. We may earn a commission from qualifying purchases made through these links, at no additional cost to you. Wallet balance and coins are SHOPZENT store credit / loyalty points only — not money, not a bank account and not withdrawable.</p>
    <div class="ftr-bottom"><span>© ${year} SHOPZENT. All rights reserved.</span><span><a href="${href('admin/index.html')}">🔐 Admin login</a></span></div></div>`;
  document.body.appendChild(f);
  // App-style bottom tab bar (phone). Hidden where it would get in the way: checkout, payment, login and account-recovery pages.
  if (!NO_TAB_BAR.includes(page) && !here.startsWith('admin')) {
    const bn = document.createElement('nav'); bn.className = 'bnav'; bn.setAttribute('aria-label', 'Quick');
    bn.innerHTML = [['index.html', 'Home', IC.home], ['categories.html', 'Categories', IC.grid], ['wishlist.html', 'Saved', IC.heart], ['cart.html', 'Cart', IC.cart + '<span class="badge" data-cart-count></span>'], [p ? 'wallet.html' : 'login.html', p ? 'Wallet' : 'Login', IC.user]]
      .map(([h, l, i]) => `<a href="${href(h)}" class="${h === here || (h === 'wallet.html' && (here === 'profile.html' || here === 'dashboard.html')) ? 'active' : ''}"${h === 'cart.html' ? ' data-tab="cart"' : ''}>${i}<span>${l}</span></a>`).join('');
    document.body.appendChild(bn); document.body.classList.add('has-bnav');
    bn.querySelector('a[href$="categories.html"]')?.addEventListener('click', async (e) => { e.preventDefault(); const cs = await categories(); const m = modal(`<div class="row between"><h3 style="margin:0">Categories</h3><button class="btn ghost sm" data-close aria-label="Close">✕</button></div><div class="cats" style="margin-top:12px">${cs.map((c) => `<a class="cat" href="${href('products.html')}?category=${encodeURIComponent(c.slug)}"><span class="ic" aria-hidden="true">${/^https?:|\//.test(c.icon || '') ? `<img loading="lazy" decoding="async" src="${esc(media(c.icon))}" alt="">` : esc(c.icon || '🛍️')}</span>${esc(c.name)}</a>`).join('') || '<p class="muted">No categories yet.</p>'}</div><a class="btn sec block sm" style="margin-top:12px" href="${href('categories.html')}">All categories page →</a>`); });
  }
  if (page !== 'payment' && page !== 'payment-submit') { const wa = document.createElement('a'); wa.className = 'wa-float'; wa.href = waLink(c.whatsapp, 'Hi SHOPZENT, I need help'); wa.target = '_blank'; wa.rel = 'noopener'; wa.setAttribute('aria-label', 'Chat on WhatsApp'); wa.innerHTML = IC.wa; document.body.appendChild(wa); }
  document.querySelectorAll('#drawer .dg-h').forEach((b) => b.addEventListener('click', () => { const g = b.parentElement, was = g.classList.contains('open'); document.querySelectorAll('#drawer .dg.open').forEach((x) => { x.classList.remove('open'); x.firstElementChild.setAttribute('aria-expanded', 'false'); }); if (!was) { g.classList.add('open'); b.setAttribute('aria-expanded', 'true'); } }));
  const dr = $('#drawer'); $('#menu-btn')?.addEventListener('click', () => { dr.classList.add('open'); dr.setAttribute('aria-hidden', 'false'); });
  dr.addEventListener('click', (e) => { if (e.target.closest('[data-close-drawer]') || e.target.closest('a[href]:not([data-logout])')) { dr.classList.remove('open'); dr.setAttribute('aria-hidden', 'true'); } });
  $$('[data-logout]').forEach((a) => a.addEventListener('click', async (e) => { e.preventDefault(); await api.auth.signOut(); resetProfile(); location.href = href('index.html'); }));
  updateBadges(); reveal(); initTilt();
  festivalHook(s, page);
  import('./visualsearch.js').then((m) => m.initCameraSearch()).catch(() => {});
}
// Festival Studio (migration 0031/0032): the festival code loads only while a festival is on and inside its window, never on /admin/.
function festivalHook(s, page) { try { const f = s.festival; if (!f || f.enabled !== true || location.pathname.includes('/admin/')) return;
  const now = Date.now(), a = f.starts_at ? Date.parse(f.starts_at) : 0, b = f.ends_at ? Date.parse(f.ends_at) : Infinity; if (!(now >= a && now < b) || f.theme === 'none') return;
  if (page === 'home') { const mn = document.getElementById('main'); if (mn && mn.parentNode && !document.querySelector('.fz-ph')) { const ph = document.createElement('div'); ph.className = 'fz-ph'; ph.setAttribute('aria-hidden', 'true'); mn.parentNode.insertBefore(ph, mn); setTimeout(() => ph.remove(), 6000); } }
  import('./festival/festival.js').then((m) => m.mountFestival(f, { noStrip: NO_TAB_BAR.includes(page) })).catch(() => { document.querySelector('.fz-ph')?.remove(); }); } catch { /* the festival never breaks a page */ } }
export async function requireLogin() { const p = await profile(); if (!p) { const here = location.pathname.split('/').pop() || 'index.html'; location.replace(href('login.html?next=' + encodeURIComponent(here === 'checkout.html' ? 'cart.html' : here + location.search))); throw new Error('redirect'); } return p; }

// Customer notification bell: unread count + the latest messages (order updates, "new update on the website" notices). Loads after the page, never blocks it.
async function initBell() {
  const btn = document.getElementById('bell-btn'); if (!btn) return;
  const paint = (n) => { const b = document.getElementById('bell-n'); if (b) { b.textContent = n > 9 ? '9+' : String(n); b.style.display = n ? '' : 'none'; } };
  let rows = [];
  try { rows = await api.select('notifications', { order: { col: 'created_at', asc: false }, limit: 20 }); } catch { return; }
  paint(rows.filter((r) => !r.read_at).length);
  btn.addEventListener('click', async () => {
    modal(`<h3 style="margin-top:0">🔔 Notifications</h3><div style="max-height:60vh;overflow:auto">${rows.map((n) => `<div style="padding:10px 0;border-bottom:1px solid var(--line)" class="${n.read_at ? 'muted' : ''}"><b>${esc(n.title)}</b><br><span class="small">${esc(n.body || '')}</span><div class="tiny muted">${fmtDate(n.created_at)}${n.link && safeUrl(n.link) ? ` · <a href="${esc(href(safeUrl(n.link)))}">open</a>` : ''}</div></div>`).join('') || '<p class="muted small">No notifications yet.</p>'}</div>
      <div class="row" style="justify-content:flex-end;margin-top:12px"><button class="btn sec sm" data-close>Close</button><button class="btn sm" id="bell-refresh">Refresh page</button></div>`,
      { onOpen: (el) => { el.querySelector('#bell-refresh').onclick = () => location.reload(); } });
    if (rows.some((r) => !r.read_at)) { paint(0); api.rpc('mark_all_notifications_read').catch(() => {}); rows = rows.map((r) => ({ ...r, read_at: r.read_at || new Date().toISOString() })); }
  });
}
