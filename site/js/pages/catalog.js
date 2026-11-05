// Public catalogue pages
import { api, DEMO } from '../api.js';
import { $, $$, esc, inr, param, toast, safeUrl, debounce, sanitizeHtml, waLink, fmtDate, reveal } from '../util.js';
import { href, media, IC, cart, settings, categories, brands, renderProducts, skeletonCards, decorate, productCard, wishlistIds, toggleWish, adSlot, openAffiliate, mktName, profile } from '../layout.js';
import { captureRef, shareContext, shareBlockHtml, wireShare, loadReviews } from '../share.js';
const main = () => $('#main');
const PUB = { eq: { published: true } };

export async function home() {
  const s = await settings(); const h = s.home || {};
  main().innerHTML = `
  <section class="hero"><span class="hero-blob b1" aria-hidden="true"></span><span class="hero-blob b2" aria-hidden="true"></span><span class="hero-blob b3" aria-hidden="true"></span><span class="hero-blob b4" aria-hidden="true"></span><div class="container hero-in"><div>
    <h1 class="sr-only">${esc(h.hero_title || 'Discover More. Shop Smarter.')}</h1>
    <form class="search" action="products.html" role="search"><input name="q" type="search" placeholder="Search earbuds, kurtas, chargers…" aria-label="Search" maxlength="80"><button aria-label="Search">${IC.search.replace('<svg', '<svg width="18" height="18"')}</button></form>
    <div class="offer-slider" aria-label="Offers"><div class="offer-track" id="offer-track">
      <a class="offer" href="deals.html" style="--c1:#F97316;--c2:#EC4899;--c3:#B4380F"><b>Best Deals</b><span class="s">Handpicked offers, checked by our team</span><span class="go">Shop deals →</span><span class="big" aria-hidden="true">💸</span></a>
      <a class="offer" href="trending.html" style="--c1:#7C3AED;--c2:#06B6D4;--c3:#4C1D95"><b>Trending Now</b><span class="s">What shoppers love this week</span><span class="go">See trending →</span><span class="big" aria-hidden="true">🔥</span></a>
      <a class="offer" href="offers.html" style="--c1:#EC4899;--c2:#A855F7;--c3:#86198F"><b>Coupons &amp; Offers</b><span class="s">Save more on every order</span><span class="go">Get coupons →</span><span class="big" aria-hidden="true">🎟️</span></a>
      <a class="offer" href="products.html?type=direct" style="--c1:#10B981;--c2:#06B6D4;--c3:#065F46"><b>All Products</b><span class="s">Sirf SHOPZENT ke products, ek hi jagah</span><span class="go">Saare products →</span><span class="big" aria-hidden="true">🛍️</span></a>
      <a class="offer" href="wallet.html" style="--c1:#0EA5E9;--c2:#7C3AED;--c3:#1E3A8A"><b>Share &amp; Earn Coins</b><span class="s">Share our products, earn coins after delivery</span><span class="go">My wallet →</span><span class="big" aria-hidden="true">🪙</span></a>
    </div><div class="offer-dots" id="offer-dots"><i class="on"></i><i></i><i></i><i></i><i></i></div></div>
    </div>
    <div class="hero-art" aria-hidden="true"><div class="float-card"><picture><source srcset="assets/banners/categories-suraj.webp" type="image/webp"><img src="assets/banners/categories-suraj.jpg" alt="" style="border-radius:14px" width="1080" height="691"></picture></div></div>
  </div></section>
  <section class="sec reveal" style="padding-top:0"><div class="container"><a href="games.html" class="games-card"><span class="gc-ic" aria-hidden="true">🎮</span><span class="gc-tx"><b>Games</b><span>Free games khelo, aur Tap Rush me is hafte ke 3 winners ko coins</span></span><span class="gc-go">Play →</span></a></div></section>
  <section class="sec reveal"><div class="container"><div class="sec-h"><div><span class="eyebrow">Shop by category</span><h2>Categories</h2></div><a href="categories.html">View all →</a></div><div class="cats" id="h-cats">${'<div class="sk" style="height:110px"></div>'.repeat(6)}</div></div></section>
  <section class="sec reveal" style="padding-top:0"><div class="container"><a class="promo-wide" href="categories.html" aria-label="Discover your next favourite — browse categories"><picture><source srcset="assets/banners/categories-suraj.webp" type="image/webp"><img loading="lazy" src="assets/banners/categories-suraj.jpg" alt="Discover your next favourite — Electronics, Home goods, Fashion, Beauty, Lifestyle, Accessories" width="1080" height="691"></picture></a></div></section>
  <section class="sec reveal" style="padding-top:0"><div class="container"><div class="sec-h"><div><span class="eyebrow">Hot right now</span><h2>Trending products</h2></div><a href="trending.html">See all →</a></div><div class="scroller" id="h-trending">${skeletonCards(4)}</div></div></section>
  <section class="sec reveal" style="padding-top:0"><div class="container"><div class="coupons one" id="h-coupons"></div></div></section>
  <section class="sec reveal" style="padding-top:0"><div class="container"><div class="sec-h"><div><span class="eyebrow">Save more</span><h2>Best deals</h2></div><a href="deals.html">See all →</a></div><div class="grid" id="h-deals">${skeletonCards(4)}</div></div></section>
  <section class="sec reveal" style="padding-top:0"><div class="container" id="h-ad-mid"></div></section>
  <section class="sec reveal" style="padding-top:0"><div class="container"><div class="sec-h"><div><span class="eyebrow">Editor's picks</span><h2>Featured products</h2></div><a href="featured.html">See all →</a></div><div class="scroller" id="h-featured">${skeletonCards(4)}</div></div></section>
  <section class="sec reveal" style="padding-top:0"><div class="container"><div class="sec-h"><div><span class="eyebrow">Collections</span><h2>Featured collections</h2></div></div><div class="grid g3" id="h-coll"></div></div></section>
  <section class="sec reveal" style="padding-top:0"><div class="container"><div class="sec-h"><div><span class="eyebrow">Loved by shoppers</span><h2>Popular products</h2></div><a href="products.html?sort=popular">See all →</a></div><div class="scroller" id="h-popular">${skeletonCards(4)}</div></div></section>
  <section class="sec reveal" style="padding-top:0"><div class="container"><div class="sec-h"><div><span class="eyebrow">Just in</span><h2>Latest products</h2></div><a href="products.html?sort=new">See all →</a></div><div class="scroller" id="h-latest">${skeletonCards(4)}</div></div></section>
  <section class="sec reveal" style="padding-top:0"><div class="container"><div class="sec-h"><div><span class="eyebrow">Top brands</span><h2>Brands</h2></div><a href="brands.html">All brands →</a></div><div class="brands" id="h-brands"></div></div></section>
  <section class="sec reveal" style="padding-top:0"><div class="container"><div class="sec-h"><div><span class="eyebrow">Watch & learn</span><h2>Videos</h2></div><a href="videos.html">All videos →</a></div><div class="grid" id="h-videos"></div></div></section>
  <section class="sec reveal" style="padding-top:0"><div class="container"><div class="sec-h"><div><span class="eyebrow">Digital</span><h2>Apps & downloads</h2></div><a href="apps.html">All apps →</a></div><div class="grid g3" id="h-apps"></div></div></section>
  <section class="sec reveal" style="padding-top:0"><div class="container"><div class="sec-h"><div><span class="eyebrow">Why SHOPZENT</span><h2>Shop with confidence</h2></div></div><div class="why">
    <div class="card"><div class="ic">🔍</div><h3>Handpicked deals</h3><p class="small muted">Products and prices added and checked by our team — never made-up ratings or fake discounts.</p></div>
    <div class="card"><div class="ic">💳</div><h3>Simple UPI payment</h3><p class="small muted">Pay with any UPI app. Every payment is verified by a real person before your order is confirmed.</p></div>
    <div class="card"><div class="ic">🛡️</div><h3>Secure accounts</h3><p class="small muted">Encrypted logins, optional 2-step verification and strict data protection.</p></div>
    <div class="card"><div class="ic">💬</div><h3>Real support</h3><p class="small muted">Talk to us on WhatsApp or email — clear returns and refund rules.</p></div></div></div></section>
  <section class="sec reveal" style="padding-top:0"><div class="container"><div class="grid g2">
    <div class="card pad"><span class="eyebrow">About us</span><h2>Discover more, shop smarter</h2><p class="muted">SHOPZENT brings together products sold directly by us and the best picks from Amazon India and Flipkart, plus useful apps and how-to videos — in one colourful, easy place.</p><a class="btn sec sm" href="about.html">Read more about SHOPZENT</a></div>
    <div class="newsletter"><h2 style="color:#fff">Get the best deals first</h2><p style="opacity:.85;position:relative;z-index:1">New offers and coupon drops in your inbox. No spam.</p>
      <form id="nl"><input type="email" name="email" required placeholder="your@email.com" aria-label="Email" maxlength="120"><button class="btn">Subscribe</button></form><p class="err" id="nl-msg" style="position:relative;z-index:1;color:#FDE68A"></p></div></div></div></section>
  <section class="sec reveal" style="padding-top:0"><div class="container"><div class="card pad row between"><div><h3 style="margin:0">Need help?</h3><p class="muted small" style="margin:0">WhatsApp +91 ${esc(s.contact.whatsapp)} · ${esc(s.contact.email)}</p></div><div class="row"><a class="btn wa sm" target="_blank" rel="noopener" href="${waLink(s.contact.whatsapp, 'Hi SHOPZENT')}">${IC.wa.replace('<svg', '<svg width="18" height="18"')} WhatsApp</a><a class="btn sec sm" href="mailto:${esc(s.contact.email)}">Email us</a></div></div></div></section>`;
  reveal();
  const cats = await categories();
  { const tr = $('#offer-track'), dots = [...document.querySelectorAll('#offer-dots i')]; if (tr && dots.length) { let i = 0, hold = false;
    const go = (n) => { const c = tr.children[n]; if (c) tr.scrollTo({ left: c.offsetLeft - tr.offsetLeft - (tr.clientWidth - c.clientWidth) / 2, behavior: 'smooth' }); };
    tr.addEventListener('scroll', () => { const k = Math.round(tr.scrollLeft / Math.max(1, tr.scrollWidth / tr.children.length)); dots.forEach((d, j) => d.classList.toggle('on', j === Math.min(k, dots.length - 1))); i = k; }, { passive: true });
    ['touchstart', 'pointerdown'].forEach((e) => tr.addEventListener(e, () => { hold = true; }, { passive: true })); tr.addEventListener('touchend', () => { setTimeout(() => { hold = false; }, 4000); }, { passive: true });
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) setInterval(() => { if (hold || document.hidden) return; i = (i + 1) % dots.length; go(i); }, 4000); } }
  $('#h-cats').innerHTML = cats.map((c) => `<a class="cat" href="products.html?category=${encodeURIComponent(c.slug)}"><span class="ic" aria-hidden="true">${/^https?:|\//.test(c.icon || '') ? `<img loading="lazy" decoding="async" src="${esc(media(c.icon))}" alt="">` : esc(c.icon || '🛍️')}</span>${esc(c.name)}</a>`).join('') || '<p class="muted">Categories will appear here.</p>';
  $('#h-coll').innerHTML = cats.slice(0, 3).map((c) => `<a class="banner-card" href="products.html?category=${encodeURIComponent(c.slug)}"><img loading="lazy" src="${esc(media(c.banner_url) || 'assets/banners/promo.svg')}" alt="${esc(c.name)} collection"></a>`).join('');
  const all = await api.select('products', { ...PUB, order: { col: 'created_at', asc: false }, limit: 60 });
  const pick = (f, n = 8) => all.filter(f).slice(0, n);
  await renderProducts($('#h-trending'), pick((p) => p.is_trending), 'Trending products will appear here.');
  await renderProducts($('#h-deals'), pick((p) => p.is_deal, 4), 'Deals will appear here.');
  await renderProducts($('#h-featured'), pick((p) => p.is_featured), 'Featured products will appear here.');
  await renderProducts($('#h-popular'), all.filter((p) => p.is_popular).concat(all.filter((p) => !p.is_popular).sort((a, b) => b.view_count - a.view_count)).slice(0, 8));
  await renderProducts($('#h-latest'), all.slice(0, 8));
  $('#h-coupons').innerHTML = couponHint();
  featuredCoupon().then((html) => { if (!html) return; $('#h-coupons').innerHTML = html; const cb = $('#h-coupons [data-copy]'); if (cb) cb.onclick = () => navigator.clipboard?.writeText(cb.dataset.copy).then(() => toast('Copied ✓', 'ok')); });
  const br = await brands(); $('#h-brands').innerHTML = br.slice(0, 12).map((b) => `<a class="brand-tile" href="products.html?brand=${encodeURIComponent(b.slug)}">${b.logo_url ? `<img loading="lazy" decoding="async" src="${esc(media(b.logo_url))}" alt="${esc(b.name)}" style="max-height:44px">` : esc(b.name)}</a>`).join('');
  const vids = await api.select('videos', { ...PUB, order: { col: 'sort', asc: true }, limit: 4 }); $('#h-videos').innerHTML = vids.map(videoCard).join('') || '<p class="muted">Videos coming soon.</p>';
  const apps = await api.select('apps', { ...PUB, order: { col: 'updated_at', asc: false }, limit: 3 }); $('#h-apps').innerHTML = apps.map(appCard).join('') || '<p class="muted">Apps coming soon.</p>';
  adSlot($('#h-ad-mid'), 'home_mid');
  $('#nl').addEventListener('submit', async (e) => { e.preventDefault(); const em = e.target.email.value.trim(); try { await api.rpc('subscribe_newsletter', { p_email: em }); $('#nl-msg').textContent = 'Thanks! You are subscribed ✓'; e.target.reset(); } catch { $('#nl-msg').textContent = 'Please enter a valid email.'; } });
}
// Aaj ka coupon: the one PUBLIC coupon inside its show window (server decides; private codes never come here)
async function featuredCoupon() {
  const f = await api.rpc('featured_coupon').catch(() => null);
  if (!f || !f.code) return '';
  const off = f.discount_type === 'percent' ? `${Number(f.discount_value)}% off` : `₹${Number(f.discount_value)} off`;
  const min = Number(f.min_order) > 0 ? ` · min order ₹${Number(f.min_order)}` : '';
  const until = f.show_until ? ` · ${new Date(f.show_until).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })} tak` : '';
  return `<div class="coupon feat-coupon"><div class="pct">🎟️<small>AAJ KA</small></div><div><div style="font-weight:700">Aaj ka coupon: <code class="fc-code">${esc(f.code)}</code></div><div class="small" style="opacity:.92">${esc(off + min + until)}</div></div><button class="cbtn" type="button" data-copy="${esc(f.code)}">Copy</button></div>`;
}
export const couponHint = () => `<div class="coupon"><div class="pct">🎟️<small>CODE</small></div><div><div style="font-weight:700">Have a coupon code?</div><div class="small" style="opacity:.92">Apply it at checkout — your discount is checked and calculated securely.</div></div><a class="cbtn" href="offers.html">How it works</a></div>`;
export const videoCard = (v) => `<article class="vcard"><a class="th" href="#" data-video="${esc(v.id)}" aria-label="Play ${esc(v.title)}"><img loading="lazy" src="${esc(media(v.thumbnail_url) || 'assets/banners/promo.svg')}" alt=""><span class="play"><span>${IC.play}</span></span></a><div class="b"><span class="tag ${v.kind === 'promo' ? 'pink' : 'cyan'}">${v.kind === 'promo' ? 'Promo' : 'Tutorial'}</span><h3 style="margin:8px 0 4px;font-size:.95rem">${esc(v.title)}</h3><p class="small muted" style="margin:0">${esc(v.description || '')}</p></div></article>`;
export const appCard = (a) => `<article class="acard"><div class="ic">${a.icon_url ? `<img loading="lazy" decoding="async" src="${esc(media(a.icon_url))}" alt="">` : '📲'}</div><div style="min-width:0;flex:1"><h3 style="font-size:.98rem;margin:0 0 2px">${esc(a.name)}</h3><div class="tiny muted">${esc(a.platform || 'Android')} · v${esc(a.version || '—')} · ${esc(a.category || '')}</div>
  <div class="row" style="gap:6px;margin:6px 0">${a.verification_status === 'verified' || a.verification_status === 'scanned_clean' ? '<span class="tag green">✓ Scanned</span>' : '<span class="tag orange">Not verified</span>'}${a.is_third_party ? '<span class="tag gray">Third-party</span>' : ''}</div><a class="btn xs sec" href="app.html?slug=${encodeURIComponent(a.slug)}">Details</a></div></article>`;
function embedFor(url) { const u = safeUrl(url, false); if (!u) return ''; const yt = u.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/); if (yt) return `<iframe src="https://www.youtube-nocookie.com/embed/${yt[1]}" title="Video" allow="encrypted-media; picture-in-picture" allowfullscreen style="width:100%;aspect-ratio:16/9;border:0;border-radius:14px" referrerpolicy="strict-origin-when-cross-origin" sandbox="allow-scripts allow-same-origin allow-presentation"></iframe>`;
  const vm = u.match(/vimeo\.com\/(\d+)/); if (vm) return `<iframe src="https://player.vimeo.com/video/${vm[1]}" title="Video" allowfullscreen style="width:100%;aspect-ratio:16/9;border:0;border-radius:14px" sandbox="allow-scripts allow-same-origin allow-presentation"></iframe>`;
  const sa = u.match(/^https:\/\/screenapp\.io\/app\/share\/([\w-]{8,})/); if (sa) return `<video src="https://screenapp.io/app/api/public/files/${sa[1]}" controls playsinline preload="metadata" style="width:100%;max-height:72vh;border-radius:14px;background:#000"></video>`;
  if (/\.(mp4|webm)(\?|$)/i.test(u)) return `<video src="${esc(u)}" controls playsinline style="width:100%;border-radius:14px;background:#000"></video>`;
  const ig = u.match(/instagram\.com\/(p|reel|reels|tv)\/([\w-]+)/i); if (ig) return `<iframe src="https://www.instagram.com/${ig[1].toLowerCase() === 'reels' ? 'reel' : ig[1].toLowerCase()}/${ig[2]}/embed" title="Instagram" loading="lazy" allowfullscreen style="width:100%;height:min(78vh,640px);border:0;border-radius:14px;background:#fff" sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"></iframe>${linkCard(u, 'Open on Instagram')}`;
  if (/(^https:\/\/(www\.|m\.|web\.)?facebook\.com\/|^https:\/\/fb\.watch\/)/i.test(u)) return `<iframe src="https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(u)}&show_text=false&width=500" title="Facebook" loading="lazy" allowfullscreen style="width:100%;aspect-ratio:16/9;border:0;border-radius:14px;background:#000" sandbox="allow-scripts allow-same-origin allow-popups allow-presentation"></iframe>${linkCard(u, 'Open on Facebook')}`;
  return linkCard(u, 'Open link'); }
function linkCard(u, label) { let host = ''; try { host = new URL(u).hostname.replace(/^www\./, ''); } catch {} return `<a class="btn sec" href="${esc(u)}" target="_blank" rel="noopener noreferrer nofollow" style="margin-top:8px;width:100%">▶ ${esc(label)}${host ? ' · ' + esc(host) : ''}</a>`; }
document.addEventListener('click', async (e) => { const v = e.target.closest('[data-video]'); if (!v) return; e.preventDefault(); const row = await api.select('videos', { eq: { id: v.dataset.video }, single: true }); if (!row) return;
  const { modal } = await import('../util.js'); const emb = embedFor(row.video_url);
  modal(`<div class="row between"><h3 style="margin:0">${esc(row.title)}</h3><button class="btn ghost sm" data-close aria-label="Close">✕</button></div><div style="margin:12px 0">${emb || `<div class="alert warn">This is a sample video entry — no video has been added yet. The admin can add a YouTube/Vimeo link or upload an MP4 in Admin → Videos.</div>`}</div><p class="muted">${esc(row.description || '')}</p>`, { wide: true }); });

// ---------- listing pages ----------
export async function listing(kind) {
  const titles = { products: ['All products', 'Everything on SHOPZENT — direct purchases and Amazon / Flipkart picks.'], trending: ['Trending products', 'What shoppers are checking out right now.'], deals: ['Best deals', 'Products with active discounts, updated by our team.'], featured: ['Featured products', 'Our editors\' handpicked favourites.'] };
  const [t, sub] = titles[kind];
  const cats = await categories(), brs = await brands();
  const cs = param('category'), bs = param('brand'), q = (param('q') || '').slice(0, 80);
  const cat = cats.find((c) => c.slug === cs), br = brs.find((b) => b.slug === bs);
  const heading = cat ? cat.name : br ? br.name : q ? `Results for “${q}”` : t;
  main().innerHTML = `<div class="phead"><div class="container"><div class="crumbs"><a href="index.html">Home</a> / ${esc(heading)}</div><h1>${esc(heading)}</h1><p class="muted" style="margin:0">${esc(cat?.description || sub)}</p></div></div>
  <div class="container"><div id="ad-top" style="margin-top:14px"></div>
  <div class="toolbar" role="group" aria-label="Filters"><select id="f-cat" aria-label="Category"><option value="">All categories</option>${cats.map((c) => `<option value="${esc(c.slug)}" ${c.slug === cs ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
    <select id="f-brand" aria-label="Brand"><option value="">All brands</option>${brs.map((b) => `<option value="${esc(b.slug)}" ${b.slug === bs ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>
    <select id="f-type" aria-label="Type"><option value="">Direct + affiliate</option><option value="direct">SHOPZENT direct</option><option value="affiliate">Amazon / Flipkart</option></select>
    <select id="f-sort" aria-label="Sort"><option value="new">Newest</option><option value="popular">Popular</option><option value="price_asc">Price: low to high</option><option value="price_desc">Price: high to low</option><option value="discount">Biggest discount</option></select>
    <label class="chip"><input type="checkbox" id="f-stock"> In stock</label></div>
  <p class="small muted" id="count" aria-live="polite"></p><div class="grid" id="list">${skeletonCards(8)}</div><div class="center" style="margin:20px 0"><button class="btn sec" id="more" hidden>Load more</button></div></div>`;
  if (kind === 'products') adSlot($('#ad-top'), 'products_top'); else $('#ad-top').remove();
  if (param('sort')) $('#f-sort').value = param('sort');
  if (param('type') === 'direct') { $('#f-type').value = 'direct'; const h = $('.phead h1'); if (h && kind === 'products' && !cat && !br && !q) h.textContent = 'SHOPZENT Products'; }
  let all = [], shown = 24;
  const filters = { ...PUB, order: { col: 'created_at', asc: false }, limit: 500 };
  if (kind === 'trending') filters.eq = { ...filters.eq, is_trending: true }; if (kind === 'deals') filters.eq = { ...filters.eq, is_deal: true }; if (kind === 'featured') filters.eq = { ...filters.eq, is_featured: true };
  if (q) filters.search = { text: q, cols: ['name', 'description'] };
  try { all = await api.select('products', filters); } catch (e) { $('#list').innerHTML = '<p class="err">Could not load products.</p>'; return; }
  await decorate(all);
  const draw = async () => { const fc = $('#f-cat').value, fb = $('#f-brand').value, ft = $('#f-type').value, so = $('#f-sort').value, st = $('#f-stock').checked;
    let r = all.filter((p) => (!fc || p._cat?.slug === fc) && (!fb || brs.find((b) => b.id === p.brand_id)?.slug === fb) && (!ft || p.purchase_type === ft) && (!st || p.availability === 'in_stock'));
    if (q && !r.length) { const ql = q.toLowerCase(); r = all.filter((p) => (p._brand || '').toLowerCase().includes(ql) || (p._cat?.name || '').toLowerCase().includes(ql)); }
    const pr = (p) => p.price ?? Infinity; const disc = (p) => p.original_price && p.price ? (p.original_price - p.price) / p.original_price : 0;
    r.sort({ new: (a, b) => (b.created_at > a.created_at ? 1 : -1), popular: (a, b) => b.view_count - a.view_count || b.is_popular - a.is_popular, price_asc: (a, b) => pr(a) - pr(b), price_desc: (a, b) => (b.price ?? -1) - (a.price ?? -1), discount: (a, b) => disc(b) - disc(a) }[so]);
    $('#count').textContent = `${r.length} product${r.length === 1 ? '' : 's'}`; const w = await wishlistIds();
    $('#list').innerHTML = r.length ? r.slice(0, shown).map((p) => productCard(p, w)).join('') : `<div class="empty" style="grid-column:1/-1"><img src="assets/img/empty.svg" alt=""><p>No products match. Try another filter or search.</p></div>`;
    $('#more').hidden = r.length <= shown; };
  ['#f-cat', '#f-brand', '#f-type', '#f-sort', '#f-stock'].forEach((s) => $(s).addEventListener('change', () => { shown = 24; draw(); }));
  $('#more').onclick = () => { shown += 24; draw(); }; draw();
}

// ---------- product details ----------
export async function product() {
  const slug = param('slug'); const p = slug && await api.select('products', { eq: { slug, published: true }, single: true });
  if (!p) { main().innerHTML = `<div class="container empty"><img src="assets/img/empty.svg" alt=""><h2>Product not found</h2><p>It may have been removed.</p><a class="btn" href="products.html">Browse products</a></div>`; return; }
  await decorate([p]); const s = await settings(); const w = await wishlistIds();
  captureRef(p); const shc = await shareContext(p); const savedNow = w.has(p.id);
  document.title = `${p.seo_title || p.name} | SHOPZENT`; const md = $('meta[name=description]'); if (md) md.content = (p.seo_description || p.description || '').slice(0, 160);
  const imgs = (p.images || []).map(media).filter(Boolean); if (!imgs.length) imgs.push('assets/img/placeholder.svg');
  const aff = p.purchase_type === 'affiliate'; const hasLink = !aff || !!p.affiliate_url; const noPrice = p.price == null || p.price === ''; const ask = waLink(s.contact?.whatsapp, `Hi SHOPZENT, please share the price of ${p.name} (${p.product_code || ''})`); const oos = p.availability === 'out_of_stock' || p.availability === 'discontinued';
  const specs = Object.entries(p.specs || {}).filter(([k]) => k);
  const disc = p.original_price && p.price && p.original_price > p.price ? Math.round((p.original_price - p.price) / p.original_price * 100) : 0;
  // sizes (fashion): size chips; out-of-stock sizes greyed; a size is required before cart / buy
  const sizesOn = p._sizes === true; const sizeOpts = sizesOn && Array.isArray(p.size_options) ? p.size_options : [];
  const sizeBlock = sizesOn ? `<div class="size-pick" style="margin:12px 0"><b>Size chuniye / Choose size</b>${sizeOpts.length ? `<div class="size-chips" role="group" aria-label="Size">${sizeOpts.map((o) => { const out = o.stock !== null && o.stock !== undefined && Number(o.stock) <= 0; return `<button type="button" class="size-chip" data-size="${esc(o.label)}"${out ? ' disabled aria-disabled="true" title="Out of stock"' : ''}>${esc(o.label)}${out ? ' <small>(khatam)</small>' : ''}</button>`; }).join('')}</div><p class="tiny muted" id="size-msg">Pehle size chuniye, phir cart me add hoga.</p>` : '<p class="small muted">Is product ke size abhi set nahi hain.</p>'}</div>` : '';
  main().innerHTML = `<div class="container"><div class="crumbs" style="margin-top:14px"><a href="index.html">Home</a> / ${p._cat ? `<a href="products.html?category=${esc(p._cat.slug)}">${esc(p._cat.name)}</a> / ` : ''}${esc(p.name)}</div>
  <div class="pd"><div class="gallery"><div class="main"><img id="g-main" src="${esc(imgs[0])}" alt="${esc(p.name)}"></div>${imgs.length > 1 ? `<div class="thumbs">${imgs.map((u, i) => `<button class="${i ? '' : 'on'}" data-img="${esc(u)}" aria-label="Image ${i + 1}"><img src="${esc(u)}" alt=""></button>`).join('')}</div>` : ''}
    ${safeUrl(p.video_url, false) ? `<div style="margin-top:12px">${embedFor(p.video_url)}</div>` : ''}</div>
  <div><div class="row" style="gap:6px;margin-bottom:8px"><span class="mkt ${esc(p.marketplace)}">${esc(mktName(p.marketplace))}</span>${p.is_trending ? '<span class="tag pink">Trending</span>' : ''}${p.is_deal ? '<span class="tag orange">Deal</span>' : ''}${p.is_sample ? '<span class="tag dark">SAMPLE LISTING</span>' : ''}</div>
    ${p._brand ? `<div class="brand small muted" style="text-transform:uppercase;letter-spacing:.06em;font-weight:600">${esc(p._brand)}</div>` : ''}<h1 style="font-size:clamp(1.3rem,4vw,2rem)">${esc(p.name)}</h1>
    ${noPrice ? (aff && hasLink ? `<p class="muted">Price and availability are shown on ${esc(mktName(p.marketplace))}.</p>` : `<div class="price"><span class="muted" style="font-size:1rem">See price: ask us on WhatsApp</span></div>`) : `<div class="price"><b>${inr(p.price)}</b>${disc ? `<s>${inr(p.original_price)}</s><span class="off">${disc}% off</span>` : ''}</div>`}
    ${aff && p.price != null ? `<p class="tiny muted">Price ${p.price_verified_at ? 'last checked on ' + fmtDate(p.price_verified_at, false) : 'may have changed'} — the final price is the one shown on ${esc(mktName(p.marketplace))}.</p>` : ''}
    ${!aff && p.product_discount_percent > 0 ? `<p class="small" style="color:var(--ok);font-weight:600">Extra ${Number(p.product_discount_percent)}% product discount applied at checkout</p>` : ''}
    ${p.offer_expires_at ? `<p class="small"><span class="tag orange">Offer ends ${fmtDate(p.offer_expires_at)}</span></p>` : ''}
    <p class="small"><b>Availability:</b> ${({ in_stock: '<span style="color:var(--ok)">In stock</span>', out_of_stock: '<span style="color:var(--bad)">Out of stock</span>', preorder: 'Pre-order', discontinued: 'Discontinued' })[p.availability] || ''} ${!aff && !noPrice && p.coupon_eligibility !== 'no' ? ' · <span class="tag green">Coupons accepted</span>' : ''}</p>
    ${sizeBlock}<div class="sticky-buy">${aff && hasLink ? `<button class="btn block" data-aff="${esc(p.id)}">Buy on ${esc(mktName(p.marketplace))} ${IC.ext}</button>` : (aff || noPrice) ? `<a class="btn block" href="${esc(ask)}" target="_blank" rel="noopener">Ask price on WhatsApp</a>` : oos ? '<button class="btn block" disabled>Out of stock</button>' : `<div class="qty" role="group" aria-label="Quantity"><button id="qminus" aria-label="Less">−</button><input id="qty" value="1" inputmode="numeric" aria-label="Quantity"><button id="qplus" aria-label="More">+</button></div><button class="btn grow" id="add">Add to cart</button><button class="btn dark" id="buy">Buy now</button>`}
      <button class="icon-btn wish ${w.has(p.id) ? 'on' : ''}" data-wish="${esc(p.id)}" aria-label="Wishlist" style="border:1.5px solid var(--line);border-radius:50%">${w.has(p.id) ? IC.heartF : IC.heart}</button></div>
    ${shareBlockHtml(p, shc, savedNow)}${aff && !hasLink ? '' : aff ? `<div class="alert" style="margin-top:10px">This is an affiliate product. You will buy it on ${esc(mktName(p.marketplace))}; the order, payment, delivery and returns are handled by ${esc(mktName(p.marketplace))}, not SHOPZENT. We may earn a small commission at no extra cost to you.</div>`
      : `<div class="card pad" style="margin-top:12px;font-size:.86rem"><div>🚚 ${esc(s.delivery?.estimate_text || 'Delivery estimate shown at checkout.')}</div><div style="margin-top:6px">↩️ ${esc(s.return_policy?.summary || '')} <a href="refund-policy.html">Policy</a></div><div style="margin-top:6px">💳 Pay by UPI. Your order is confirmed after our team verifies the payment.</div><div style="margin-top:6px">🏷️ Sold by ${esc(s.seller?.name || 'SHOPZENT')}</div></div>`}
    ${p.description ? `<h3 style="margin-top:20px">Description</h3><p style="white-space:pre-line">${esc(p.description)}</p>` : ''}
    ${specs.length ? `<h3>Specifications</h3><table class="specs">${specs.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>` : ''}
    <div id="reviews"></div>
    <p class="tiny muted" style="margin-top:10px">Product ID: ${esc(p.product_code || p.id)}</p></div></div>
  <section class="sec" style="padding-top:0"><div class="sec-h"><h2>You may also like</h2></div><div class="scroller" id="related">${skeletonCards(4)}</div></section></div>`;
  $$('[data-img]').forEach((b) => b.onclick = () => { $('#g-main').src = b.dataset.img; $$('[data-img]').forEach((x) => x.classList.toggle('on', x === b)); });
  const qv = () => Math.max(1, Math.min(20, parseInt($('#qty')?.value) || 1));
  $('#qminus')?.addEventListener('click', () => { $('#qty').value = Math.max(1, qv() - 1); }); $('#qplus')?.addEventListener('click', () => { $('#qty').value = Math.min(20, qv() + 1); });
  let chosenSize = '';
  main().querySelectorAll('.size-chip').forEach((b) => b.addEventListener('click', () => { chosenSize = b.dataset.size; main().querySelectorAll('.size-chip').forEach((x) => x.classList.toggle('on', x === b)); const m = $('#size-msg'); if (m) m.textContent = 'Size chuna: ' + chosenSize; }));
  const needSize = () => { if (sizesOn && !chosenSize) { toast('Pehle size chuniye 👕 (please pick a size first)', 'bad'); $('#size-msg')?.scrollIntoView({ block: 'center' }); return true; } return false; };
  $('#add')?.addEventListener('click', () => { if (needSize()) return; cart.add(p.id, qv(), chosenSize); toast('Added to cart 🛒', 'ok'); });
  $('#buy')?.addEventListener('click', () => { if (needSize()) return; cart.add(p.id, qv(), chosenSize); location.href = 'cart.html'; });
  wireShare(p, shc); loadReviews(p, $('#reviews'));
  $('.save-btn')?.addEventListener('click', async (e) => { const b = e.currentTarget; await toggleWish(p.id, null); const on = (await wishlistIds()).has(p.id); b.setAttribute('aria-pressed', on ? 'true' : 'false'); b.innerHTML = (on ? IC.heartF : IC.heart) + ` <span>${on ? 'Saved' : 'Save'}</span>`; });
  api.rpc('record_view', { p_product_id: p.id }).catch(() => {});
  let rel = []; try { rel = await api.select('products', p.category_id ? { ...PUB, eq: { published: true, category_id: p.category_id }, limit: 9 } : { ...PUB, order: { col: 'created_at', asc: false }, limit: 9 }); } catch {} await renderProducts($('#related'), rel.filter((x) => x.id !== p.id).slice(0, 8), 'More products coming soon.');
  // structured data — only verified facts (name, image, price for direct products)
  if (!aff && !noPrice && !p.is_sample) { const ld = document.createElement('script'); ld.type = 'application/ld+json'; ld.textContent = JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name: p.name, image: imgs.filter((u) => /^https:/.test(u)), sku: p.product_code, offers: { '@type': 'Offer', priceCurrency: 'INR', price: String(p.price), availability: p.availability === 'in_stock' ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock' } }); document.head.appendChild(ld); }
}
export async function categoriesPage() {
  const cats = await categories(); const prods = await api.select('products', { ...PUB, limit: 1000 });
  main().innerHTML = `<div class="phead"><div class="container"><div class="crumbs"><a href="index.html">Home</a> / Categories</div><h1>Categories</h1><p class="muted" style="margin:0">Browse by what you love.</p></div></div>
  <div class="container sec"><a class="promo-wide" href="#cat-grid" style="margin-bottom:18px"><picture><source srcset="assets/banners/categories-suraj.webp" type="image/webp"><img src="assets/banners/categories-suraj.jpg" alt="Discover your next favourite" width="1080" height="691"></picture></a><div class="grid g2" id="cat-grid">${cats.map((c) => `<a class="banner-card" href="products.html?category=${encodeURIComponent(c.slug)}" style="aspect-ratio:12/5"><img loading="lazy" src="${esc(media(c.banner_url) || 'assets/banners/promo.svg')}" alt="${esc(c.name)}"><span class="tag dark" style="position:absolute;right:12px;bottom:12px">${prods.filter((p) => p.category_id === c.id).length} products</span></a>`).join('') || '<p class="muted">No categories yet.</p>'}</div></div>`;
}
export async function brandsPage() {
  const brs = await brands(); main().innerHTML = `<div class="phead"><div class="container"><div class="crumbs"><a href="index.html">Home</a> / Brands</div><h1>Brands</h1><p class="muted" style="margin:0">Shop your favourite brands.</p></div></div>
  <div class="container sec"><div class="brands">${brs.map((b) => `<a class="brand-tile" style="height:110px;flex-direction:column;gap:6px" href="products.html?brand=${encodeURIComponent(b.slug)}">${b.logo_url ? `<img src="${esc(media(b.logo_url))}" alt="" style="max-height:48px">` : ''}<span>${esc(b.name)}</span></a>`).join('') || '<p class="muted">No brands yet.</p>'}</div>
  <div class="card pad" style="margin-top:20px"><h3>Marketplaces</h3><p class="muted small">Besides products sold directly by SHOPZENT, we list handpicked products from <b>Amazon India</b> and <b>Flipkart</b> through their affiliate programmes.</p></div></div>`;
}
export async function appsPage(apkOnly = false) {
  const apps = await api.select('apps', { ...PUB, order: { col: 'updated_at', asc: false } }); const list = apkOnly ? apps.filter((a) => /android/i.test(a.platform || '')) : apps;
  main().innerHTML = `<div class="phead"><div class="container"><div class="crumbs"><a href="index.html">Home</a> / ${apkOnly ? 'APK Downloads' : 'Digital Apps'}</div><h1>${apkOnly ? 'APK Downloads' : 'Digital Apps'}</h1><p class="muted" style="margin:0">${apkOnly ? 'Android app files (APK). Only download apps you trust.' : 'Useful apps and digital tools.'}</p></div></div>
  <div class="container sec"><div class="alert warn">🛡️ Safety first: an app is marked <b>“Scanned”</b> only after its file has actually been checked. Third-party apps belong to their developers; SHOPZENT lists them with permission / under their licence. Install APKs only if you understand the risk, and keep “Install unknown apps” off afterwards. <a href="downloads-policy.html">Digital downloads policy</a></div>
  <div class="grid g3">${list.map(appCard).join('') || '<p class="muted">No apps listed yet.</p>'}</div></div>`;
}
export async function appDetail() {
  const a = await api.select('apps', { eq: { slug: param('slug') || '', published: true }, single: true });
  if (!a) { main().innerHTML = '<div class="container empty"><h2>App not found</h2><a class="btn" href="apps.html">All apps</a></div>'; return; }
  document.title = `${a.name} | SHOPZENT Apps`; const ok = ['verified', 'scanned_clean'].includes(a.verification_status);
  main().innerHTML = `<div class="container sec"><div class="crumbs"><a href="apps.html">Apps</a> / ${esc(a.name)}</div><div class="card pad" style="margin-top:12px"><div class="acard" style="box-shadow:none;padding:0"><div class="ic" style="width:84px;height:84px">${a.icon_url ? `<img loading="lazy" decoding="async" src="${esc(media(a.icon_url))}" alt="">` : '📲'}</div><div><h1 style="font-size:1.5rem;margin:0">${esc(a.name)}</h1><div class="muted small">${esc(a.developer || '')}</div>
    <div class="row" style="gap:6px;margin-top:6px">${ok ? '<span class="tag green">✓ File scanned</span>' : '<span class="tag orange">Not verified — not scanned yet</span>'}${a.is_third_party ? '<span class="tag gray">Third-party app</span>' : ''}</div></div></div>
    <table class="specs" style="margin:16px 0"><tr><td>Version</td><td>${esc(a.version || '—')}</td></tr><tr><td>Platform</td><td>${esc(a.platform || '—')}</td></tr><tr><td>File size</td><td>${a.file_size_bytes ? (a.file_size_bytes / 1048576).toFixed(1) + ' MB' : '—'}</td></tr><tr><td>Last updated</td><td>${fmtDate(a.updated_at, false)}</td></tr>${a.sha256 ? `<tr><td>SHA-256</td><td style="word-break:break-all"><code class="tiny">${esc(a.sha256)}</code></td></tr>` : ''}${a.license_note ? `<tr><td>Licence</td><td>${esc(a.license_note)}</td></tr>` : ''}</table>
    <p style="white-space:pre-line">${esc(a.description || '')}</p>${a.changelog ? `<h3>What's new</h3><p class="small" style="white-space:pre-line">${esc(a.changelog)}</p>` : ''}
    <div id="dl" style="margin-top:14px"></div></div></div>`;
  const dl = $('#dl');
  if (a.storage_path) { if (!ok) dl.innerHTML = '<div class="alert warn">This file is waiting for a security scan, so downloads are switched off until it passes.</div>'; else { dl.innerHTML = '<button class="btn" id="dlb">Download APK</button>'; $('#dlb').onclick = async () => { try { const u = await api.signedUrl('apk-files', a.storage_path, 120); if (!u) throw 0; location.href = u; } catch { toast('Download is not available right now.', 'bad'); } }; } }
  else if (safeUrl(a.download_url, false)) dl.innerHTML = `<a class="btn" href="${esc(safeUrl(a.download_url, false))}" target="_blank" rel="noopener nofollow">Get the app ${IC.ext}</a><p class="tiny muted" style="margin-top:6px">Opens the developer's / store's page.</p>`;
  else dl.innerHTML = '<div class="alert">No download is attached to this listing yet.</div>';
}
export async function videosPage(kind) {
  const vids = await api.select('videos', { ...PUB, eq: { published: true, kind }, order: { col: 'sort', asc: true } });
  const cats = [...new Set(vids.map((v) => v.category).filter(Boolean))];
  main().innerHTML = `<div class="phead"><div class="container"><div class="crumbs"><a href="index.html">Home</a> / ${kind === 'promo' ? 'Promotional Videos' : 'Video Tutorials'}</div><h1>${kind === 'promo' ? 'Promotional Videos' : 'Video Tutorials'}</h1><p class="muted" style="margin:0">${kind === 'promo' ? 'Launches, offers and brand stories.' : 'How-to guides for shopping, paying and using SHOPZENT.'}</p></div></div>
  <div class="container sec">${cats.length > 1 ? `<div class="pill-tabs">${['All', ...cats].map((c, i) => `<button class="chip ${i ? '' : 'active'}" data-vc="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}<div class="grid" id="vg">${vids.map(videoCard).join('') || '<p class="muted">No videos yet.</p>'}</div></div>`;
  $$('[data-vc]').forEach((b) => b.onclick = () => { $$('[data-vc]').forEach((x) => x.classList.toggle('active', x === b)); const c = b.dataset.vc; $('#vg').innerHTML = vids.filter((v) => c === 'All' || v.category === c).map(videoCard).join(''); });
}
export async function adsPage() {
  const s = await settings();
  main().innerHTML = `<div class="phead"><div class="container"><div class="crumbs"><a href="index.html">Home</a> / Advertisements</div><h1>Advertisements & promotions</h1><p class="muted" style="margin:0">Current promotions — and how to advertise with SHOPZENT.</p></div></div>
  <div class="container sec"><div class="grid g2" id="ads-list"></div><div class="card pad" style="margin-top:20px"><h2>Advertise with us</h2><p class="muted">Want your brand, product or app in front of SHOPZENT shoppers? Banner, homepage and video placements are available.</p>
  <div class="row"><a class="btn wa sm" target="_blank" rel="noopener" href="${waLink(s.contact.whatsapp, 'Hi SHOPZENT, I want to advertise on your website.')}">${IC.wa.replace('<svg', '<svg width="18" height="18"')} WhatsApp us</a><a class="btn sec sm" href="mailto:${esc(s.contact.email)}?subject=Advertising%20on%20SHOPZENT">Email</a></div><p class="tiny muted" style="margin-top:10px">All ads are clearly labelled “AD”. We don't accept misleading, illegal or adult advertising.</p></div></div>`;
  const n = Date.now(); const ads = (await api.select('ads', { order: { col: 'sort', asc: true } })).filter((a) => a.image_url || a.video_url);
  $('#ads-list').innerHTML = ads.map((a) => `<div class="card"><a href="#" class="ad-slot" data-ad="${esc(a.id)}" style="box-shadow:none;border-radius:0"><span class="lbl">AD</span>${a.image_url ? `<img loading="lazy" src="${esc(media(a.image_url))}" alt="${esc(a.title)}">` : ''}</a>${a.video_url && safeUrl(a.video_url, false) ? embedFor(a.video_url) : ''}<div class="b"><h3 style="margin:0;font-size:1rem">${esc(a.title)}</h3></div></div>`).join('') || '<p class="muted">No active promotions right now.</p>';
  ads.forEach((a) => api.rpc('track_ad', { p_ad_id: a.id, p_event: 'impression' }).catch(() => {}));
}
export async function offersPage() {
  const s = await settings();
  main().innerHTML = `<div class="phead"><div class="container"><div class="crumbs"><a href="index.html">Home</a> / Coupons & Offers</div><h1>Coupons & offers</h1><p class="muted" style="margin:0">Have a coupon code? Apply it at checkout.</p></div></div>
  <div class="container sec"><div class="card pad offer-cta" style="text-align:center"><div style="font-size:2.2rem" aria-hidden="true">🎟️</div><h2 style="margin:6px 0">Have a coupon code? Apply it at checkout</h2><p class="muted" style="max-width:560px;margin:0 auto 14px">Coupon codes are shared personally by SHOPZENT — they aren't listed publicly. If you have one, add your items to the cart and type the code in the <b>Coupon code</b> box on the checkout page. You'll see the discount before you pay.</p><div class="row" style="justify-content:center;gap:10px;flex-wrap:wrap"><a class="btn" href="products.html">Start shopping</a><a class="btn sec" href="cart.html" style="white-space:nowrap">Go to cart</a></div></div>
  <div class="card pad" style="margin-top:20px"><h3>How coupons work</h3><ul class="small muted"><li>Coupons apply to eligible <b>SHOPZENT direct purchases</b> only — not to Amazon / Flipkart affiliate products.</li><li>Some products or categories may be excluded; a minimum order value or maximum discount may apply.</li><li>Only one coupon per order unless a coupon says it can be combined.</li><li>If a coupon is invalid, expired, used up or not applicable you'll see a clear message at checkout.</li></ul><a href="coupon-terms.html">Full coupon terms</a></div>
  <div class="sec-h" style="margin-top:26px"><h2>Today's deals</h2><a href="deals.html">See all →</a></div><div class="grid" id="od">${skeletonCards(4)}</div></div>`;
  const d = await api.select('products', { ...PUB, eq: { published: true, is_deal: true }, limit: 8 }); await renderProducts($('#od'), d, 'Deals will appear here.');
}
export async function aboutPage() {
  const s = await settings(); const custom = s.page_about?.html;
  main().innerHTML = `<div class="phead"><div class="container"><div class="crumbs"><a href="index.html">Home</a> / About</div><h1>About SHOPZENT</h1><p class="muted" style="margin:0">${esc(s.brand?.tagline || 'Discover More. Shop Smarter.')}</p></div></div>
  <div class="container sec prose">${custom ? sanitizeHtml(custom) : `<p>SHOPZENT is a colourful, easy shopping destination for everyone in India. We bring together:</p><ul><li><b>Products sold directly by SHOPZENT</b> — pay by UPI; our team verifies every payment before confirming your order.</li><li><b>Handpicked Amazon India & Flipkart products</b> — you buy on the marketplace through our affiliate links.</li><li><b>Digital apps</b>, how-to <b>video tutorials</b>, promotions and the best <b>deals & coupons</b>.</li></ul><h2>Our promise</h2><ul><li>No fake prices, reviews, ratings or discounts. Prices are entered and checked by our team.</li><li>Your account is protected with secure login and optional 2-step verification.</li><li>Clear return and refund rules, and real people on WhatsApp and email.</li></ul>`}
  <h2>Seller details</h2><p>${esc(s.seller?.name || 'SHOPZENT')}<br>${esc(s.seller?.address || '')}${s.seller?.gstin ? '<br>GSTIN: ' + esc(s.seller.gstin) : ''}<br>WhatsApp: +91 ${esc(s.contact.whatsapp)} · Email: ${esc(s.contact.email)}</p>
  <div id="preview" class="alert warn" ${DEMO ? '' : 'hidden'}><b>About preview mode:</b> this copy of the website is not connected to a database yet. Products marked “SAMPLE” are placeholders, and anything you do here (sign-ups, orders, payments) is saved only in your own browser for testing. Once the owner connects Supabase, the site uses the real database, real logins and real admin verification.</div></div>`;
}
export async function contactPage() {
  const s = await settings(); const c = s.contact;
  main().innerHTML = `<div class="phead"><div class="container"><div class="crumbs"><a href="index.html">Home</a> / Contact</div><h1>Contact us</h1><p class="muted" style="margin:0">We usually reply within a working day.</p></div></div>
  <div class="container sec"><div class="grid g2"><div><div class="card pad"><h3>Reach us directly</h3>${s.page_contact?.html ? sanitizeHtml(s.page_contact.html) : ''}
    <p><a class="btn wa block" target="_blank" rel="noopener" href="${waLink(c.whatsapp, 'Hi SHOPZENT, I have a question')}">${IC.wa.replace('<svg', '<svg width="18" height="18"')} WhatsApp +91 ${esc(c.whatsapp)}</a></p><p><a class="btn sec block" href="mailto:${esc(c.email)}">${esc(c.email)}</a></p>
    ${c.hours ? `<p class="small muted">Hours: ${esc(c.hours)}</p>` : ''}${c.address ? `<p class="small muted">${esc(c.address)}</p>` : ''}<p class="tiny muted">Never share your password, OTP or recovery codes with anyone — SHOPZENT staff will never ask for them.</p></div></div>
    <form class="card pad" id="cf" novalidate><h3>Send a message</h3><div class="field"><label for="c-name">Name</label><input id="c-name" name="name" required maxlength="80" autocomplete="name"></div>
    <div class="form-grid"><div class="field"><label for="c-email">Email</label><input id="c-email" name="email" type="email" required maxlength="120" autocomplete="email"></div><div class="field"><label for="c-mob">Mobile (optional)</label><input id="c-mob" name="mobile" inputmode="numeric" maxlength="10" autocomplete="tel"></div></div>
    <div class="field"><label for="c-sub">Subject</label><input id="c-sub" name="subject" maxlength="120"></div><div class="field"><label for="c-msg">Message</label><textarea id="c-msg" name="message" required maxlength="4000"></textarea></div>
    <input type="text" name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true"><p class="err" id="c-err"></p><button class="btn block">Send message</button></form></div></div>`;
  $('#cf').addEventListener('submit', async (e) => { e.preventDefault(); const f = e.target; if (f.website.value) return; const d = Object.fromEntries(new FormData(f));
    if (!d.name.trim() || !/^\S+@\S+\.\S+$/.test(d.email) || d.message.trim().length < 5) { $('#c-err').textContent = 'Please fill your name, a valid email and a message.'; return; }
    try { f.querySelector('button').disabled = true; await api.rpc('submit_contact', { p_name: d.name.trim(), p_email: d.email.trim(), p_mobile: d.mobile.trim(), p_subject: d.subject.trim(), p_message: d.message.trim() }); f.innerHTML = '<div class="alert ok">Thank you! Your message has reached the SHOPZENT team. We will reply by email.</div>'; }
    catch (er) { $('#c-err').textContent = (await import('../util.js')).errText(er); f.querySelector('button').disabled = false; } });
}
export async function legalPage(key) { const s = await settings(); const c = s['legal_' + key]?.html; if (c && c.trim()) { const box = $('#legal-body'); if (box) box.innerHTML = sanitizeHtml(c); } }
