// PREVIEW / DEMO data layer — runs entirely in this browser (localStorage). NOTHING here is real:
// no real orders, payments, users or money. It mirrors the Supabase backend's rules so every page can be clicked through.
// When config.js has Supabase keys, this file is not used.
import { uuid } from './util.js';
const KEY = 'sz_demo_db_v5', SKEY = 'sz_demo_session_v4';
const now = () => new Date().toISOString();
const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const AL = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rnd = (n) => { const b = crypto.getRandomValues(new Uint8Array(n)); return [...b].map((x) => AL[x % AL.length]).join(''); };
const err = (code) => { const e = new Error(code); e.code_text = code; return e; };
// Coupon codes are never shipped in plain text: customers' typed codes are matched by SHA-256 of the
// uppercased code; the admin list decodes a lightly obfuscated copy (preview only — real codes live in Supabase).
const OBK = [83, 90, 23, 100, 101, 109, 111, 5, 107, 57];
const xo = (str) => { let o = ''; for (let i = 0; i < str.length; i++) o += String.fromCharCode(str.charCodeAt(i) ^ OBK[i % OBK.length] ^ ((i * 29) & 255)); return o; };
const deob = (e) => { try { return xo(atob(e || '')); } catch { return ''; } };
const obf = (code) => btoa(xo(code));
const b64bytes = (b) => Uint8Array.from(atob(b), (c) => c.charCodeAt(0));
// Admin password check for preview mode: PBKDF2-SHA256 against the hash in config.js (the password itself is never stored).
async function pbkdf2ok(pw, p) {
  try { const want = b64bytes(p.hash_b64); const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(pw)), 'PBKDF2', false, ['deriveBits']);
    const got = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: b64bytes(p.salt_b64), iterations: Number(p.iterations) }, key, want.length * 8));
    let d = got.length ^ want.length; for (let i = 0; i < want.length; i++) d |= got[i] ^ want[i]; return d === 0; } catch { return false; } }
async function sha(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); }

function seed() {
  const t = now(); const id = () => uuid();
  const cats = [['Electronics', 'electronics', '🎧', 'assets/banners/electronics.svg'], ['Fashion', 'fashion', '👗', 'assets/banners/fashion.svg'], ['Beauty', 'beauty', '💄', 'assets/banners/beauty.svg'],
    ['Home & Kitchen', 'home-kitchen', '🏠', 'assets/banners/home-kitchen.svg'], ['Mobile Accessories', 'mobile-accessories', '📱', 'assets/banners/mobile-accessories.svg'], ['Lifestyle', 'lifestyle', '⌚', 'assets/banners/lifestyle.svg']]
    .map(([name, slug, icon, banner_url], i) => ({ id: id(), name, slug, icon, banner_url, description: '', sort: i, published: true, created_at: t }));
  const brands = ['Nova (sample)', 'Urbano (sample)', 'Glow Lab (sample)', 'Kitchenly (sample)', 'VoltX (sample)', 'Pulse (sample)']
    .map((name, i) => ({ id: id(), name, slug: name.toLowerCase().replace(/[^a-z]+/g, '-').replace(/-+$/, ''), logo_url: '', description: 'Sample brand for the preview — replace from the Admin Panel.', published: true, sort: i, created_at: t }));
  const C = Object.fromEntries(cats.map((c) => [c.slug, c.id])), B = brands.map((b) => b.id);
  const P = (o) => ({ id: id(), product_code: 'SZP-' + rnd(6), description: 'This is a SAMPLE listing so you can see how the store looks. The name, image and demo price are placeholders — edit or delete it from Admin → Products and add your real products with genuine photos and verified prices.',
    images: [], video_url: '', marketplace: 'shopzent', purchase_type: 'direct', specs: { 'Listing type': 'Sample / placeholder', Note: 'Replace with real specifications' }, affiliate_url: null, availability: 'in_stock', stock_qty: 25,
    is_featured: false, is_trending: false, is_deal: false, is_popular: false, coupon_eligibility: 'yes', product_discount_percent: 0, max_discount_percent: 90, allow_combine: true, offer_expires_at: null, price_verified_at: null,
    seo_title: '', seo_description: '', is_sample: true, published: true, view_count: 0, created_at: t, updated_at: t, ...o });
  const products = [
    P({ name: 'Wireless Earbuds (Sample)', slug: 'sample-wireless-earbuds', images: ['assets/img/samples/earbuds.svg'], brand_id: B[4], category_id: C.electronics, price: 1299, original_price: 2499, is_trending: true, is_featured: true, is_deal: true }),
    P({ name: 'Smart Watch (Sample)', slug: 'sample-smart-watch', images: ['assets/img/samples/watch.svg'], brand_id: B[5], category_id: C.lifestyle, price: 2199, original_price: 3999, is_trending: true, is_popular: true }),
    P({ name: 'Cotton Kurta (Sample)', slug: 'sample-cotton-kurta', images: ['assets/img/samples/kurta.svg'], brand_id: B[1], category_id: C.fashion, price: 799, original_price: 1199, is_featured: true, is_deal: true, product_discount_percent: 5, allow_combine: false }),
    P({ name: 'Face Serum (Sample)', slug: 'sample-face-serum', images: ['assets/img/samples/serum.svg'], brand_id: B[2], category_id: C.beauty, price: 449, original_price: 599, is_popular: true, coupon_eligibility: 'selected' }),
    P({ name: 'Non-stick Pan (Sample)', slug: 'sample-non-stick-pan', images: ['assets/img/samples/pan.svg'], brand_id: B[3], category_id: C['home-kitchen'], price: 999, original_price: 1499, is_deal: true, is_trending: true }),
    P({ name: 'Fast Charger 33W (Sample)', slug: 'sample-fast-charger', images: ['assets/img/samples/charger.svg'], brand_id: B[4], category_id: C['mobile-accessories'], price: 599, original_price: 999, is_featured: true, is_popular: true }),
    P({ name: 'Bluetooth Speaker — Amazon (Sample)', slug: 'sample-amazon-speaker', images: ['assets/img/samples/speaker.svg'], brand_id: B[0], category_id: C.electronics, marketplace: 'amazon', purchase_type: 'affiliate', price: null, original_price: null, affiliate_url: 'https://www.amazon.in/', coupon_eligibility: 'no', is_trending: true, specs: { 'Listing type': 'Sample affiliate listing', Note: 'Price is shown on Amazon. Add your Amazon Associates link in Admin.' } }),
    P({ name: 'Running Shoes — Flipkart (Sample)', slug: 'sample-flipkart-shoes', images: ['assets/img/samples/shoes.svg'], brand_id: B[1], category_id: C.fashion, marketplace: 'flipkart', purchase_type: 'affiliate', price: null, original_price: null, affiliate_url: 'https://www.flipkart.com/', coupon_eligibility: 'no', is_featured: true, specs: { 'Listing type': 'Sample affiliate listing', Note: 'Price is shown on Flipkart. Add your Flipkart Affiliate link in Admin.' } }),
    P({ name: 'Phone Case (Sample)', slug: 'sample-phone-case', images: ['assets/img/samples/case.svg'], brand_id: B[4], category_id: C['mobile-accessories'], price: 249, original_price: 399, is_deal: true }),
    P({ name: 'Backpack (Sample)', slug: 'sample-backpack', images: ['assets/img/samples/bag.svg'], brand_id: B[5], category_id: C.lifestyle, price: 1099, original_price: 1799, is_popular: true, availability: 'out_of_stock', stock_qty: 0 }),
  ];
  products.forEach((p, i) => { p.created_at = new Date(Date.now() - i * 3600e3).toISOString(); });
  const videos = [['How to order on SHOPZENT (sample)', 'tutorial', 'Step-by-step: cart, coupon, UPI payment and UTR submission.'], ['How to pay by UPI & submit UTR (sample)', 'tutorial', 'Where to find the UTR number in your UPI app.'], ['Festive offers promo (sample)', 'promo', 'Promotional video placeholder.'], ['New arrivals promo (sample)', 'promo', 'Promotional video placeholder.']]
    .map(([title, kind, description], i) => ({ id: id(), title, slug: 'sample-video-' + (i + 1), description, kind, category: kind === 'tutorial' ? 'Guides' : 'Offers', video_url: '', thumbnail_url: `assets/img/samples/video${(i % 2) + 1}.svg`, duration: '', published: true, sort: i, created_at: t, updated_at: t }));
  const apps = [['SHOPZENT Helper (sample listing)', 'Shopping', false], ['Price Notes (sample listing)', 'Tools', true], ['Photo Editor Lite (sample listing)', 'Photography', true]]
    .map(([name, category, third], i) => ({ id: id(), name, slug: 'sample-app-' + (i + 1), version: '1.0.' + i, icon_url: '', description: 'Sample app listing for the preview. No file is attached. Upload a real, licensed APK from Admin → Apps; it stays "Not verified" until it is scanned.', file_size_bytes: null, platform: 'Android', download_url: null, storage_path: null, changelog: 'Initial sample listing.', category, verification_status: 'unverified', sha256: null, is_third_party: third, developer: third ? 'Third-party developer (sample)' : 'SHOPZENT', license_note: '', published: true, created_at: t, updated_at: t }));
  const ads = [{ id: id(), title: 'Have a coupon code? Apply it at checkout', image_url: 'assets/banners/promo.svg', video_url: '', link_url: 'offers.html', placement: 'home_mid', starts_at: null, ends_at: null, enabled: true, impressions: 0, clicks: 0, sort: 0, created_at: t },
    { id: id(), title: 'Best deals of the week', image_url: 'assets/banners/deals.svg', video_url: '', link_url: 'deals.html', placement: 'ads_page', starts_at: null, ends_at: null, enabled: true, impressions: 0, clicks: 0, sort: 1, created_at: t },
    { id: id(), title: 'Fashion picks', image_url: 'assets/banners/fashion.svg', video_url: '', link_url: 'products.html?category=fashion', placement: 'products_top', starts_at: null, ends_at: null, enabled: true, impressions: 0, clicks: 0, sort: 2, created_at: t }];
  // preview-mode only coupons (DEMO10/20/30); the real coupon codes live only in the database
  const coupons = [['b02bce22f1967645efc23c65c3ec47a64ff422dd527a3686904d0977bc57ecd0', 'FwJgfCDM', 10], ['046cdaf8fdeda175e3e92b08bbe85d55e983ac23f927824b549f39ffaf36f2bf', 'FwJgfCPM', 20], ['86f774b60eac0734094d4b75d2e41bc14d22d200379f5498ce393a2707b9ef7e', 'FwJgfCLM', 30]].map(([code_hash, code_enc, v]) => ({ id: id(), code_hash, code_enc, description: `${v}% off on eligible SHOPZENT direct purchases`, discount_type: 'percent', discount_value: v, min_order: 0, max_discount: null, starts_at: null, expires_at: null, usage_limit: null, per_user_limit: null, eligible_product_ids: [], eligible_category_ids: [], excluded_product_ids: [], stackable: false, is_public: false, active: true, created_at: t, updated_at: t }));
  const S = (key, value, is_public = true) => ({ key, value, is_public, updated_at: t });
  const settings = [S('brand', { name: 'SHOPZENT', tagline: 'Discover More. Shop Smarter.', logo_url: '', favicon_url: '' }),
    S('contact', { whatsapp: '9942598154', email: 'ravitechsolution.shop@gmail.com', address: '', hours: 'Mon–Sat, 10 AM – 7 PM' }),
    S('social', { instagram: '', youtube: '', facebook: '', x: '', telegram: '' }),
    S('payment', { upi_id: 'techravi@fam', payee_name: 'Ravi Kumar', qr_url: '', instructions: 'Scan the QR with any UPI app (GPay, PhonePe, Paytm, BHIM), pay the exact amount, then come back and submit the 12-digit UTR number.' }),
    S('home', { hero_title: 'Discover More. Shop Smarter.', hero_subtitle: 'Top brands, fresh deals, Amazon & Flipkart picks, apps and videos — all in one colourful place.', announcement: '🎉 Have a coupon code? Apply it at checkout for extra savings on SHOPZENT direct purchases' }),
    S('seo', { default_title: 'SHOPZENT — Discover More. Shop Smarter.', default_description: 'Multi-brand shopping, best deals, Amazon & Flipkart picks, digital apps and videos.', og_image: 'assets/og.png' }),
    S('return_policy', { window_days: 7, summary: 'Eligible direct-purchase items can be returned within 7 days of delivery if unused and in original packaging. Digital items and affiliate (Amazon/Flipkart) purchases follow their own policies.' }),
    S('delivery', { estimate_text: 'Usually dispatched within 2–3 working days after payment verification; delivery in 4–8 working days depending on your pincode.' }),
    S('seller', { name: 'SHOPZENT (Ravi Tech Solution)', address: 'Address to be added by the owner', gstin: '' }),
    S('security', { captcha_after_failures: 3, max_failed_per_minute: 10 }, false)];
  return { v: 5, users: [], profiles: [], wallets: [], wallet_ledger: [], coin_settings: { id: 1, enabled: true, total_supply: 5000000000, expiry_days: 365, rules: 'Coins are loyalty points for SHOPZENT promotions only. 1 coin is NOT ₹1. Coins have no cash value and cannot be withdrawn or transferred between customers.', updated_at: t },
    coin_ledger: [{ id: 1, txn_ref: 'SZCN-' + rnd(8), user_id: null, kind: 'mint', coins: 5000000000, note: 'Initial internal demo coin supply (loyalty points, not money)', created_by: null, created_at: t }],
    categories: cats, brands, products, product_coupons: [], videos, apps, ads, site_settings: settings, coupons, coupon_redemptions: [], wishlist: [], recently_viewed: [], orders: [], order_items: [], order_events: [],
    payment_submissions: [], duplicate_utr_attempts: [], returns: [], refunds: [], notifications: [], audit_log: [], login_attempts: [], mfa_recovery_codes: [], contact_messages: [], newsletter_subscribers: [], affiliate_clicks: [], idempotency: [], seq: 100 };
}

export function createDemoApi() {
  let db; try { db = JSON.parse(localStorage.getItem(KEY)); } catch { db = null; }
  if (!db || db.v !== 5) db = seed();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { console.warn('demo storage full', e); } };
  const sess = () => { try { return JSON.parse(localStorage.getItem(SKEY)); } catch { return null; } };
  const setSess = (s) => s ? localStorage.setItem(SKEY, JSON.stringify(s)) : localStorage.removeItem(SKEY);
  const listeners = [];
  const uid = () => sess()?.uid || null;
  const me = () => db.profiles.find((p) => p.id === uid()) || null;
  const isStaff = () => { const p = me(); return !!p && ['admin', 'super_admin'].includes(p.role) && p.status === 'active'; };
  const isAdmin = () => isStaff() && sess()?.aal === 'aal2';
  const isSuper = () => isAdmin() && me().role === 'super_admin';
  const needAdmin = () => { if (!uid()) throw err('not_authorized'); if (isStaff() && sess()?.aal !== 'aal2') throw err('mfa_required'); if (!isAdmin()) throw err('not_authorized'); };
  const needFresh = () => { const s = sess(); if (!s || Date.now() - s.iat > 15 * 60e3) throw err('fresh_auth_required'); };
  const needUser = () => { const p = me(); if (!p) throw err('not_authorized'); if (p.status !== 'active') throw err('account_suspended'); return p; };
  const audit = (action, entity, entity_id, details = {}) => db.audit_log.unshift({ id: ++db.seq, actor_id: uid(), actor_role: me()?.role || 'anon', action, entity, entity_id: entity_id ? String(entity_id) : null, details, created_at: now() });
  const notify = (user_id, audience, title, body, link = '') => db.notifications.unshift({ id: uuid(), user_id, audience, title, body, link, read_at: null, created_at: now() });
  const setting = (k) => db.site_settings.find((s) => s.key === k)?.value || {};
  const walletBal = (user_id) => { let c = 0, d = 0, p = 0; db.wallet_ledger.filter((l) => l.user_id === user_id).forEach((l) => { if (l.status === 'pending') { if (l.direction === 'credit') p += l.amount; return; } if (l.direction === 'credit') c += l.amount; else d += l.amount; }); return { available: r2(c - d), total_credits: r2(c), total_debits: r2(d), pending_credits: r2(p) }; };
  const coinBal = (user_id) => db.coin_ledger.filter((l) => l.user_id === user_id).reduce((a, l) => a + (l.kind === 'issue' ? l.coins : -l.coins), 0);
  const treasury = () => { const s = db.coin_settings; let issued = 0, reversed = 0, redeemed = 0, expired = 0; db.coin_ledger.forEach((l) => { if (l.kind === 'issue') issued += l.coins; if (l.kind === 'reversal') reversed += l.coins; if (l.kind === 'redeem') redeemed += l.coins; if (l.kind === 'expire') expired += l.coins; });
    return { enabled: s.enabled, total_supply: s.total_supply, treasury_available: s.total_supply - issued + reversed, issued, redeemed, reversed, expired, settings: s }; };
  const idem = (action, key, fn) => { if (key) { const hit = db.idempotency.find((x) => x.user_id === uid() && x.action === action && x.key === key); if (hit) return hit.result; } const res = fn(); if (key) db.idempotency.push({ key, user_id: uid(), action, result: res, created_at: now() }); return res; };
  const addEvent = (o, to, note, internal = false) => { db.order_events.push({ id: ++db.seq, order_id: o.id, from_status: o.status, to_status: to, note: note || '', actor_id: uid(), actor_role: me()?.role || 'system', is_internal: internal, created_at: now() }); if (!internal) o.status = to; o.updated_at = now(); };
  const order = (id) => { const o = db.orders.find((x) => x.id === id); if (!o) throw err('not_found'); return o; };
  const paidAmount = (o) => o.payment_status === 'verified' ? r2(o.total) : 0;
  const refunded = (o) => r2(db.refunds.filter((f) => f.order_id === o.id).reduce((a, f) => a + f.amount, 0));
  const walletRow = (user_id, direction, kind, amount, note, extra) => { const w = db.wallets.find((x) => x.user_id === user_id); const row = { id: ++db.seq, txn_ref: 'SZWT-' + rnd(10), user_id, wallet_id: w.id, direction, kind, amount: r2(amount), status: 'posted', note, created_by: uid(), created_at: now(), ...(extra || {}) }; db.wallet_ledger.unshift(row); return row; };
  const walletCredit = (user_id, kind, amount, note, extra) => walletRow(user_id, 'credit', kind, amount, note, extra);
  const walletDebit = (user_id, kind, amount, note, extra) => { if (walletBal(user_id).available < amount) throw err('insufficient_balance'); return walletRow(user_id, 'debit', kind, amount, note, extra); };
  const voidOrderExtras = (o) => { db.coupon_redemptions.filter((c) => c.order_id === o.id).forEach((c) => { c.voided = true; }); if (o.wallet_used > 0 && !o._wallet_returned) { walletCredit(o.user_id, 'reversal', o.wallet_used, 'Wallet amount returned for ' + o.order_code, { order_id: o.id }); o._wallet_returned = true; } };

  // ---------- pricing (mirror of SQL quote_cart) ----------
  async function quote(items, code, user_id) {
    if (!Array.isArray(items) || !items.length || items.length > 30) throw err('invalid_input');
    const lines = items.map((it) => { const p = db.products.find((x) => x.id === it.product_id && x.published); const qty = Math.max(1, Math.min(20, parseInt(it.qty) || 1));
      if (!p || p.purchase_type !== 'direct' || p.price == null) throw err('not_found'); if (!['in_stock', 'preorder'].includes(p.availability)) throw err('out_of_stock');
      const unit = r2(p.price), pd = r2(unit * (Number(p.product_discount_percent) || 0) / 100);
      return { product_id: p.id, name: p.name, image: (p.images || [])[0] || '', qty, unit_price: unit, original_unit_price: r2(p.original_price || p.price), line_total: r2(unit * qty), product_discount: r2(pd * qty), coupon_discount: 0, _p: p }; });
    const subtotal = r2(lines.reduce((a, l) => a + l.line_total, 0)), product_discount = r2(lines.reduce((a, l) => a + l.product_discount, 0));
    let coupon = null;
    if (code && String(code).trim()) {
      const h = await sha(String(code).trim().toUpperCase()); const c = db.coupons.find((x) => x.code_hash === h); const status = (() => {
        if (!c) return 'invalid'; if (!c.active) return 'inactive'; const n = Date.now();
        if (c.starts_at && new Date(c.starts_at) > n) return 'not_started'; if (c.expires_at && new Date(c.expires_at) < n) return 'expired';
        const used = db.coupon_redemptions.filter((r) => r.coupon_id === c.id && !r.voided);
        if (c.usage_limit && used.length >= c.usage_limit) return 'exhausted';
        if (c.per_user_limit) { if (!user_id) return 'login_required'; if (used.filter((r) => r.user_id === user_id).length >= c.per_user_limit) return 'user_limit'; }
        return 'ok'; })();
      coupon = { code: String(code).trim().toUpperCase(), valid: false, code_status: status, message: '' };
      if (status === 'ok') {
        const elig = lines.filter((l) => { const p = l._p; if (p.coupon_eligibility === 'no') return false; if (p.coupon_eligibility === 'selected' && !db.product_coupons.some((x) => x.product_id === p.id && x.coupon_id === c.id)) return false;
          if ((c.excluded_product_ids || []).includes(p.id)) return false; if ((c.eligible_product_ids || []).length && !c.eligible_product_ids.includes(p.id)) return false; if ((c.eligible_category_ids || []).length && !c.eligible_category_ids.includes(p.category_id)) return false; return true; });
        if (!elig.length) coupon.code_status = 'not_applicable';
        else if (subtotal - product_discount < Number(c.min_order || 0)) coupon.code_status = 'min_order';
        else {
          const base = elig.reduce((a, l) => a + l.line_total - l.product_discount, 0);
          let raw = c.discount_type === 'percent' ? base * c.discount_value / 100 : Math.min(c.discount_value, base); if (c.max_discount) raw = Math.min(raw, c.max_discount); raw = r2(raw);
          elig.forEach((l) => { const share = r2(raw * (l.line_total - l.product_discount) / base); let cd = share;
            if (!l._p.allow_combine && l.product_discount > 0) cd = Math.max(0, r2(share - l.product_discount));
            const cap = r2(l.line_total * (Number(l._p.max_discount_percent ?? 90)) / 100); cd = Math.max(0, Math.min(cd, r2(cap - l.product_discount))); l.coupon_discount = r2(cd); });
          coupon.valid = true; coupon.coupon_id = c.id;
        }
      }
    }
    const coupon_discount = r2(lines.reduce((a, l) => a + l.coupon_discount, 0));
    if (coupon && coupon.valid && coupon_discount === 0) { coupon.valid = false; coupon.code_status = 'not_applicable'; }
    lines.forEach((l) => delete l._p);
    return { lines, subtotal, product_discount, coupon_discount, total: r2(subtotal - product_discount - coupon_discount), coupon };
  }

  // ---------- table visibility (mirror of RLS: deny by default) ----------
  const PUBLIC_PUBLISHED = ['products', 'categories', 'brands', 'videos', 'apps'];
  const OWN = ['orders', 'order_items', 'order_events', 'payment_submissions', 'returns', 'wallet_ledger', 'notifications', 'wishlist', 'recently_viewed', 'coupon_redemptions', 'refunds'];
  const WRITABLE_ADMIN = ['products', 'product_coupons', 'categories', 'brands', 'videos', 'apps', 'ads', 'coupons', 'contact_messages', 'newsletter_subscribers'];
  function visible(table) {
    const rows = db[table]; if (!Array.isArray(rows)) throw err('not_found');
    if (table === 'coupons') return isAdmin() ? rows.map((c) => ({ ...c, code: deob(c.code_enc) })) : [];
    if (isAdmin()) return rows;
    if (PUBLIC_PUBLISHED.includes(table)) return rows.filter((r) => r.published);
    if (table === 'ads') { const n = Date.now(); return rows.filter((a) => a.enabled && (!a.starts_at || new Date(a.starts_at) <= n) && (!a.ends_at || new Date(a.ends_at) >= n)); }
    if (table === 'site_settings') return rows.filter((r) => r.is_public);
    const u = uid();
    if (OWN.includes(table)) { if (!u) return [];
      if (['order_items', 'order_events', 'refunds'].includes(table)) { const mine = new Set(db.orders.filter((o) => o.user_id === u).map((o) => o.id)); return rows.filter((r) => mine.has(r.order_id) && !(table === 'order_events' && r.is_internal)); }
      if (table === 'notifications') return rows.filter((r) => r.user_id === u && r.audience === 'user');
      return rows.filter((r) => r.user_id === u); }
    if (table === 'profiles') return rows.filter((r) => r.id === u);
    if (table === 'wallets') return rows.filter((r) => r.user_id === u);
    return [];
  }
  const clone = (x) => JSON.parse(JSON.stringify(x));
  function query(rows, o = {}) {
    let r = rows.slice();
    Object.entries(o.eq || {}).forEach(([k, v]) => { r = r.filter((x) => x[k] === v); });
    Object.entries(o.neq || {}).forEach(([k, v]) => { r = r.filter((x) => x[k] !== v); });
    Object.entries(o.in || {}).forEach(([k, v]) => { r = r.filter((x) => v.includes(x[k])); });
    Object.entries(o.is || {}).forEach(([k, v]) => { r = r.filter((x) => (x[k] ?? null) === v); });
    Object.entries(o.gte || {}).forEach(([k, v]) => { r = r.filter((x) => x[k] >= v); });
    Object.entries(o.lte || {}).forEach(([k, v]) => { r = r.filter((x) => x[k] <= v); });
    Object.entries(o.ilike || {}).forEach(([k, v]) => { const s = v.replace(/%/g, '').toLowerCase(); r = r.filter((x) => String(x[k] || '').toLowerCase().includes(s)); });
    if (o.search && o.search.text.trim()) { const s = o.search.text.trim().toLowerCase(); r = r.filter((x) => o.search.cols.some((c) => String(x[c] || '').toLowerCase().includes(s))); }
    if (o.order) { const { col, asc } = o.order; r.sort((a, b) => { const A = a[col], B = b[col]; if (A == null) return 1; if (B == null) return -1; return (A > B ? 1 : A < B ? -1 : 0) * (asc ? 1 : -1); }); }
    const total = r.length; if (o.offset) r = r.slice(o.offset); if (o.limit) r = r.slice(0, o.limit);
    const out = clone(r); if (o.count) out.total = total; return out;
  }
  const pause = (ms = 90) => new Promise((r) => setTimeout(r, ms));

  // ---------- RPCs: public + customer ----------
  const RPC = {
    public_coupons: () => [], // coupons are private: customers type a code they were given at checkout (quote_cart validates it)
    quote_cart: ({ p_items, p_coupon }) => quote(p_items, p_coupon, uid()),
    track_affiliate_click: ({ p_product_id }) => { const p = db.products.find((x) => x.id === p_product_id && x.published && x.purchase_type === 'affiliate'); if (!p || !/^https:\/\//.test(p.affiliate_url || '')) throw err('not_found'); db.affiliate_clicks.push({ id: ++db.seq, product_id: p.id, user_id: uid(), created_at: now() }); return p.affiliate_url; },
    track_ad: ({ p_ad_id, p_event }) => { const a = db.ads.find((x) => x.id === p_ad_id); if (!a) return null; if (p_event === 'click') { a.clicks++; return a.link_url; } a.impressions++; return null; },
    submit_contact: ({ p_name, p_email, p_mobile, p_subject, p_message }) => { if (!p_name || !/^\S+@\S+\.\S+$/.test(p_email || '') || !p_message || p_message.length > 4000) throw err('invalid_input'); const id = uuid(); db.contact_messages.unshift({ id, name: p_name, email: p_email, mobile: p_mobile, subject: p_subject, message: p_message, status: 'new', created_at: now() }); notify(null, 'admin', 'New contact message', `${p_name}: ${p_subject || ''}`, 'messages.html'); return id; },
    subscribe_newsletter: ({ p_email }) => { if (!/^\S+@\S+\.\S+$/.test(p_email || '')) throw err('invalid_input'); if (!db.newsletter_subscribers.some((s) => s.email === p_email.toLowerCase())) db.newsletter_subscribers.push({ email: p_email.toLowerCase(), created_at: now(), confirmed: false }); return true; },
    my_profile: () => { const p = me(); if (!p) return null; const w = db.wallets.find((x) => x.user_id === p.id); return { ...p, wallet_id: w?.wallet_id }; },
    my_role: () => me()?.role || null,
    update_my_profile: ({ p_full_name, p_mobile }) => { const p = needUser(); if (!p_full_name || p_full_name.length > 80) throw err('invalid_input'); if (p_mobile && !/^[6-9]\d{9}$/.test(p_mobile)) throw err('invalid_input'); p.full_name = p_full_name.trim(); p.mobile = p_mobile; p.updated_at = now(); return p; },
    toggle_wishlist: ({ p_product_id }) => { const p = needUser(); const i = db.wishlist.findIndex((w) => w.user_id === p.id && w.product_id === p_product_id); if (i >= 0) { db.wishlist.splice(i, 1); return false; } db.wishlist.push({ user_id: p.id, product_id: p_product_id, created_at: now() }); return true; },
    record_view: ({ p_product_id }) => { const pr = db.products.find((x) => x.id === p_product_id); if (pr) pr.view_count++; const u = uid(); if (!u) return null; db.recently_viewed = db.recently_viewed.filter((r) => !(r.user_id === u && r.product_id === p_product_id)); db.recently_viewed.unshift({ user_id: u, product_id: p_product_id, viewed_at: now() }); return null; },
    my_wallet: () => { const p = needUser(); const w = db.wallets.find((x) => x.user_id === p.id); return { wallet_id: w.wallet_id, customer_id: p.customer_id, ...walletBal(p.id) }; },
    my_coins: () => { const p = needUser(); const iss = db.coin_ledger.filter((l) => l.user_id === p.id && l.kind === 'issue').reduce((a, l) => a + l.coins, 0); const red = db.coin_ledger.filter((l) => l.user_id === p.id && l.kind === 'redeem').reduce((a, l) => a + l.coins, 0); return { enabled: db.coin_settings.enabled, balance: coinBal(p.id), issued_total: iss, redeemed_total: red, rules: db.coin_settings.rules }; },
    create_order: async ({ p_items, p_coupon, p_shipping, p_use_wallet = 0, p_idempotency_key }) => { const p = needUser();
      const prev = p_idempotency_key && db.orders.find((o) => o.user_id === p.id && o.idempotency_key === p_idempotency_key); if (prev) return { order_id: prev.id, order_code: prev.order_code, total: prev.total, status: prev.status };
      const s = p_shipping || {}; if (!s.name || !/^[6-9]\d{9}$/.test(s.phone || '') || !s.line1 || !s.city || !s.state || !/^\d{6}$/.test(s.pincode || '')) throw err('invalid_input');
      const q = await quote(p_items, p_coupon, p.id); if (p_coupon && !q.coupon.valid) throw err(q.coupon.code_status);
      const use = r2(Math.max(0, Math.min(Number(p_use_wallet) || 0, q.total, walletBal(p.id).available)));
      const d = new Date(); const code = 'SZO-' + String(d.getFullYear()).slice(2) + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '-' + rnd(5);
      const total = r2(q.total - use);
      const o = { id: uuid(), order_code: code, user_id: p.id, status: total === 0 ? 'payment_verified' : 'payment_pending', payment_status: total === 0 ? 'verified' : 'pending', subtotal: q.subtotal, product_discount: q.product_discount, coupon_discount: q.coupon_discount, wallet_used: use, total,
        coupon_codes: q.coupon?.valid ? [q.coupon.code] : [], ship_name: s.name, ship_phone: s.phone, ship_line1: s.line1, ship_line2: s.line2 || '', ship_city: s.city, ship_state: s.state, ship_pincode: s.pincode, customer_note: s.note || '', admin_notes: '', idempotency_key: p_idempotency_key, created_at: now(), updated_at: now(), paid_at: total === 0 ? now() : null };
      db.orders.unshift(o); q.lines.forEach((l) => db.order_items.push({ id: uuid(), order_id: o.id, product_id: l.product_id, product_name: l.name, product_image: l.image, unit_price: l.unit_price, original_unit_price: l.original_unit_price, qty: l.qty, line_total: l.line_total }));
      if (q.coupon?.valid) db.coupon_redemptions.push({ id: uuid(), coupon_id: q.coupon.coupon_id, user_id: p.id, order_id: o.id, discount_amount: q.coupon_discount, created_at: now(), voided: false, code: q.coupon.code });
      if (use > 0) walletDebit(p.id, 'purchase_debit', use, 'Used for ' + code, { order_id: o.id });
      db.order_events.push({ id: ++db.seq, order_id: o.id, from_status: null, to_status: o.status, note: 'Order placed', actor_id: p.id, actor_role: 'customer', is_internal: false, created_at: now() });
      notify(p.id, 'user', 'Order placed', `${code} — please complete the UPI payment of ₹${total}.`, `order.html?id=${o.id}`); audit('order_created', 'orders', o.id, { order_code: code, total });
      return { order_id: o.id, order_code: code, total, status: o.status }; },
    submit_payment: ({ p_order_id, p_utr, p_screenshot_path, p_idempotency_key }) => { const p = needUser(); const o = order(p_order_id); if (o.user_id !== p.id) throw err('not_found');
      return idem('submit_payment', p_idempotency_key, () => {
        if (!['payment_pending', 'payment_rejected'].includes(o.status)) throw err('invalid_transition');
        const n = String(p_utr || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); if (n.length < 12 || n.length > 22) throw err('invalid_utr');
        if (p_screenshot_path && !p_screenshot_path.startsWith(p.id + '/')) throw err('not_authorized');
        const dup = db.payment_submissions.find((s) => s.utr_normalized === n && s.status !== 'rejected');
        if (dup) { db.duplicate_utr_attempts.push({ id: ++db.seq, utr_normalized: n, user_id: p.id, order_id: o.id, existing_submission_id: dup.id, created_at: now() }); audit('duplicate_utr_attempt', 'orders', o.id, { utr: n }); save(); throw err('duplicate_utr'); }
        const s = { id: uuid(), submission_code: 'SZPAY-' + rnd(8), order_id: o.id, user_id: p.id, utr: String(p_utr).trim(), utr_normalized: n, amount: o.total, screenshot_path: p_screenshot_path || null, status: 'submitted', admin_notes: '', created_at: now() };
        db.payment_submissions.unshift(s); o.payment_status = 'submitted'; addEvent(o, 'payment_submitted', 'UTR submitted: ' + n);
        notify(null, 'admin', 'New payment to verify', `${o.order_code} · ₹${o.total} · UTR ${n}`, 'payments.html'); audit('payment_submitted', 'payment_submissions', s.id, { order_code: o.order_code });
        return { submission_id: s.id, submission_code: s.submission_code, status: s.status }; }); },
    request_cancellation: ({ p_order_id, p_reason }) => { const p = needUser(); const o = order(p_order_id); if (o.user_id !== p.id) throw err('not_found');
      if (['payment_pending', 'payment_submitted', 'payment_rejected'].includes(o.status) && o.payment_status !== 'verified') { o.cancel_reason = p_reason; o.cancelled_at = now(); db.payment_submissions.filter((s) => s.order_id === o.id && s.status !== 'verified').forEach((s) => { s.status = 'rejected'; s.admin_notes = 'Order cancelled by customer'; }); voidOrderExtras(o); addEvent(o, 'order_cancelled', 'Cancelled by customer: ' + (p_reason || '')); audit('order_cancelled_by_customer', 'orders', o.id); return { cancelled: true }; }
      if (['payment_verified', 'order_confirmed', 'processing'].includes(o.status)) { if (db.returns.some((r) => r.order_id === o.id && !['return_rejected', 'refund_completed', 'wallet_credited'].includes(r.status))) throw err('open_return_exists');
        const r = { id: uuid(), return_code: 'SZR-' + rnd(8), order_id: o.id, user_id: p.id, kind: 'cancellation', reason: p_reason || 'Cancellation request', description: '', photos: [], refund_preference: 'original', status: 'return_requested', created_at: now(), updated_at: now() }; db.returns.unshift(r);
        notify(null, 'admin', 'Cancellation request', `${o.order_code}: ${p_reason || ''}`, 'returns.html'); audit('cancellation_requested', 'returns', r.id); return { cancelled: false, request_id: r.id, return_code: r.return_code }; }
      throw err('invalid_transition'); },
    request_return: ({ p_order_id, p_reason, p_description, p_photos = [], p_refund_preference }) => { const p = needUser(); const o = order(p_order_id); if (o.user_id !== p.id) throw err('not_found');
      if (o.status !== 'delivered') throw err('invalid_transition'); const win = setting('return_policy').window_days || 7; if (o.delivered_at && Date.now() - new Date(o.delivered_at) > win * 864e5) throw err('return_window_closed');
      if (db.returns.some((r) => r.order_id === o.id && r.kind === 'return' && r.status !== 'return_rejected')) throw err('open_return_exists');
      if ((p_photos || []).some((x) => !x.startsWith(p.id + '/'))) throw err('not_authorized');
      const r = { id: uuid(), return_code: 'SZR-' + rnd(8), order_id: o.id, user_id: p.id, kind: 'return', reason: p_reason, description: p_description || '', photos: p_photos || [], refund_preference: p_refund_preference === 'wallet' ? 'wallet' : 'original', status: 'return_requested', eligible_amount: null, created_at: now(), updated_at: now() };
      db.returns.unshift(r); addEvent(o, 'return_requested', 'Return requested: ' + p_reason); notify(null, 'admin', 'Return request', `${o.order_code}: ${p_reason}`, 'returns.html'); audit('return_requested', 'returns', r.id);
      return { return_id: r.id, return_code: r.return_code }; },
    mark_notification_read: ({ p_id }) => { const n = db.notifications.find((x) => x.id === p_id && (x.user_id === uid() || (x.audience === 'admin' && isAdmin()))); if (n) n.read_at = now(); return null; },
    generate_recovery_codes: () => { needUser(); if (sess()?.aal !== 'aal2') throw err('mfa_required'); const codes = Array.from({ length: 10 }, () => rnd(5) + '-' + rnd(5)); db.mfa_recovery_codes = db.mfa_recovery_codes.filter((c) => c.user_id !== uid()); codes.forEach((c) => db.mfa_recovery_codes.push({ id: uuid(), user_id: uid(), code_hash: 'demo:' + btoa(c), used_at: null })); audit('recovery_codes_generated', 'profiles', uid()); return codes; },
    use_recovery_code: ({ p_code }) => { const u = db.users.find((x) => x.id === uid()); if (!u) throw err('not_authorized'); const c = db.mfa_recovery_codes.find((x) => x.user_id === u.id && !x.used_at && x.code_hash === 'demo:' + btoa(String(p_code || '').trim().toUpperCase())); if (!c) { audit('mfa_failure', 'profiles', u.id, { via: 'recovery_code' }); return false; } c.used_at = now(); u.factors = []; audit('mfa_recovery_used', 'profiles', u.id); notify(null, 'admin', 'MFA recovery code used', u.email, 'security.html'); return true; },
    log_auth_event: ({ p_action, p_details }) => { if (!['admin_login_success', 'mfa_failure', 'mfa_enrolled', 'mfa_removed', 'password_changed', 'logout_all', 'login_success'].includes(p_action)) throw err('invalid_input'); audit(p_action, 'auth', uid(), p_details || {}); return null; },
    my_coupon_history: () => { const p = needUser(); return db.coupon_redemptions.filter((r) => r.user_id === p.id).map((r) => ({ ...r, order_code: db.orders.find((o) => o.id === r.order_id)?.order_code })); },
  };

  // ---------- RPCs: admin (all require admin + aal2, money/permission ops also fresh auth) ----------
  const prof = (id) => db.profiles.find((p) => p.id === id) || {};
  Object.assign(RPC, {
    admin_stats: () => { needAdmin(); const o = db.orders; const t = treasury();
      return { users: db.profiles.length, products: db.products.length, products_published: db.products.filter((p) => p.published).length, orders: o.length, orders_pending: o.filter((x) => ['payment_pending', 'payment_submitted', 'under_verification', 'payment_verified'].includes(x.status)).length,
        orders_confirmed: o.filter((x) => ['order_confirmed', 'processing', 'shipped', 'delivered'].includes(x.status)).length, orders_rejected: o.filter((x) => x.status === 'order_rejected').length, orders_paid: o.filter((x) => x.payment_status === 'verified').length,
        payments_pending: db.payment_submissions.filter((s) => ['submitted', 'under_verification'].includes(s.status)).length, coupon_redemptions: db.coupon_redemptions.filter((c) => !c.voided).length,
        wallet_liability: r2(db.profiles.reduce((a, p) => a + walletBal(p.id).available, 0)), coins_issued: t.issued - t.reversed, coins_available: t.treasury_available, affiliate_clicks: db.affiliate_clicks.length,
        ad_impressions: db.ads.reduce((a, x) => a + x.impressions, 0), ad_clicks: db.ads.reduce((a, x) => a + x.clicks, 0), recent: db.audit_log.slice(0, 20) }; },
    admin_security_overview: () => { needAdmin(); const h24 = Date.now() - 864e5, h1 = Date.now() - 36e5; const la = db.login_attempts;
      const byKey = {}; la.filter((a) => !a.success && new Date(a.created_at) > h1).forEach((a) => { byKey[a.email_hash] = (byKey[a.email_hash] || 0) + 1; });
      return { failed_logins_24h: la.filter((a) => !a.success && new Date(a.created_at) > h24).length, failed_logins_1h: la.filter((a) => !a.success && new Date(a.created_at) > h1).length, locked_keys: Object.values(byKey).filter((n) => n >= 10).length,
        mfa_failures_24h: db.audit_log.filter((a) => a.action === 'mfa_failure' && new Date(a.created_at) > h24).length,
        suspicious: [...Object.entries(byKey).filter(([, n]) => n >= 5).map(([k, n]) => ({ type: 'many_failed_logins', detail: `${n} failed logins in the last hour for one account (${k.slice(0, 10)}…)` })), ...db.duplicate_utr_attempts.slice(0, 5).map((d) => ({ type: 'duplicate_utr', detail: `Duplicate UTR ${d.utr_normalized} tried on ${new Date(d.created_at).toLocaleString('en-IN')}` }))],
        recent_events: db.audit_log.slice(0, 30), admins: db.profiles.filter((p) => p.role !== 'customer').map((p) => ({ id: p.id, email: p.email, role: p.role, mfa_enrolled: (db.users.find((u) => u.id === p.id)?.factors || []).some((f) => f.status === 'verified') })),
        db_size_bytes: new Blob([localStorage.getItem(KEY) || '']).size, storage_bytes: 0, storage_objects: 0, config: { rls_all_tables: true, tables_without_rls: [], note: 'Preview mode: numbers come from this browser only.' } }; },
    admin_search_customers: ({ p_q }) => { needAdmin(); const q = String(p_q || '').trim().toLowerCase(); return db.profiles.filter((p) => { const w = db.wallets.find((x) => x.user_id === p.id); return !q || [p.customer_id, w?.wallet_id, p.email, p.mobile, p.full_name].some((v) => String(v || '').toLowerCase().includes(q)); })
      .slice(0, 100).map((p) => ({ id: p.id, customer_id: p.customer_id, wallet_id: db.wallets.find((x) => x.user_id === p.id)?.wallet_id, full_name: p.full_name, email: p.email, mobile: p.mobile, status: p.status, role: p.role, created_at: p.created_at, wallet_balance: walletBal(p.id).available, coin_balance: coinBal(p.id) })); },
    admin_list_orders: ({ p_q, p_status, p_limit = 50, p_offset = 0 }) => { needAdmin(); const q = String(p_q || '').trim().toLowerCase();
      return db.orders.filter((o) => { const c = prof(o.user_id); return (!p_status || o.status === p_status) && (!q || [o.order_code, c.customer_id, c.mobile, o.ship_phone, c.email].some((v) => String(v || '').toLowerCase().includes(q))); })
        .slice(p_offset, p_offset + p_limit).map((o) => { const c = prof(o.user_id); return { ...o, customer_id: c.customer_id, customer_name: c.full_name, customer_mobile: c.mobile, customer_email: c.email, latest_submission: db.payment_submissions.find((s) => s.order_id === o.id) || null, item_count: db.order_items.filter((i) => i.order_id === o.id).length }; }); },
    admin_order_detail: ({ p_order_id }) => { needAdmin(); const o = order(p_order_id); const c = db.profiles.find((p) => p.id === o.user_id); return { order: o, items: db.order_items.filter((i) => i.order_id === o.id), events: db.order_events.filter((e) => e.order_id === o.id), submissions: db.payment_submissions.filter((s) => s.order_id === o.id), returns: db.returns.filter((r) => r.order_id === o.id), refunds: db.refunds.filter((r) => r.order_id === o.id), customer: c ? { ...c, wallet_id: db.wallets.find((w) => w.user_id === c.id)?.wallet_id } : null, paid_amount: paidAmount(o), refunded_amount: refunded(o) }; },
    admin_list_payments: ({ p_status } = {}) => { needAdmin(); return db.payment_submissions.filter((s) => !p_status || s.status === p_status).map((s) => { const o = db.orders.find((x) => x.id === s.order_id) || {}; const c = prof(s.user_id); return { ...s, order_code: o.order_code, order_status: o.status, customer_id: c.customer_id, customer_name: c.full_name, customer_mobile: c.mobile, duplicate_attempts: db.duplicate_utr_attempts.filter((d) => d.utr_normalized === s.utr_normalized).length }; }); },
    admin_mark_under_verification: ({ p_submission_id }) => { needAdmin(); const s = db.payment_submissions.find((x) => x.id === p_submission_id); if (!s) throw err('not_found'); if (s.status !== 'submitted') throw err('invalid_transition'); s.status = 'under_verification'; const o = order(s.order_id); o.payment_status = 'under_verification'; addEvent(o, 'under_verification', 'Payment is being verified'); audit('payment_under_verification', 'payment_submissions', s.id); return s; },
    admin_verify_payment: ({ p_submission_id, p_note, p_idempotency_key }) => { needAdmin(); return idem('verify_payment', p_idempotency_key, () => { const s = db.payment_submissions.find((x) => x.id === p_submission_id); if (!s) throw err('not_found'); if (!['submitted', 'under_verification'].includes(s.status)) throw err('invalid_transition');
      const o = order(s.order_id); s.status = 'verified'; s.admin_notes = p_note || ''; s.reviewed_by = uid(); s.reviewed_at = now(); o.payment_status = 'verified'; o.paid_at = now(); addEvent(o, 'payment_verified', 'Payment verified by admin');
      notify(o.user_id, 'user', 'Payment verified ✅', `We received ₹${o.total} for ${o.order_code}.`, `order.html?id=${o.id}`); audit('payment_approved', 'payment_submissions', s.id, { order_code: o.order_code, utr: s.utr_normalized, amount: o.total }); return { ok: true, order_status: o.status }; }); },
    admin_reject_payment: ({ p_submission_id, p_reason, p_idempotency_key }) => { needAdmin(); if (!p_reason || p_reason.trim().length < 3) throw err('invalid_input'); return idem('reject_payment', p_idempotency_key, () => { const s = db.payment_submissions.find((x) => x.id === p_submission_id); if (!s) throw err('not_found'); if (!['submitted', 'under_verification'].includes(s.status)) throw err('invalid_transition');
      const o = order(s.order_id); s.status = 'rejected'; s.admin_notes = p_reason; s.reviewed_by = uid(); s.reviewed_at = now(); o.payment_status = 'rejected'; addEvent(o, 'payment_rejected', 'Payment rejected: ' + p_reason);
      notify(o.user_id, 'user', 'Payment could not be verified', `${o.order_code}: ${p_reason}. You can submit the correct UTR again.`, `order.html?id=${o.id}`); audit('payment_rejected', 'payment_submissions', s.id, { reason: p_reason }); return { ok: true, order_status: o.status }; }); },
    admin_set_order_status: ({ p_order_id, p_status, p_note, p_idempotency_key }) => { needAdmin(); return idem('set_status', p_idempotency_key, () => { const o = order(p_order_id);
      const T = { payment_verified: ['order_confirmed'], order_confirmed: ['processing'], processing: ['shipped'], shipped: ['delivered'] }; if (!(T[o.status] || []).includes(p_status)) throw err('invalid_transition');
      if (p_status === 'order_confirmed' && o.payment_status !== 'verified') throw err('invalid_transition');
      addEvent(o, p_status, p_note || ''); if (p_status === 'order_confirmed') o.confirmed_at = now(); if (p_status === 'shipped') o.shipped_at = now(); if (p_status === 'delivered') o.delivered_at = now();
      const msg = { order_confirmed: 'Your order is confirmed 🎉', processing: 'Your order is being packed', shipped: 'Your order has shipped 🚚', delivered: 'Your order was delivered' }[p_status];
      notify(o.user_id, 'user', msg, `${o.order_code}${p_note ? ' — ' + p_note : ''}`, `order.html?id=${o.id}`); audit('order_status_change', 'orders', o.id, { to: p_status }); return { ok: true, status: o.status }; }); },
    admin_reject_order: ({ p_order_id, p_reason, p_idempotency_key }) => { needAdmin(); if (!p_reason || p_reason.trim().length < 3) throw err('invalid_input'); return idem('reject_order', p_idempotency_key, () => { const o = order(p_order_id);
      if (['shipped', 'delivered', 'order_cancelled', 'order_rejected', 'refund_completed', 'refund_processing'].includes(o.status)) throw err('invalid_transition');
      o.reject_reason = p_reason; voidOrderExtras(o); const paid = o.payment_status === 'verified'; addEvent(o, 'order_rejected', 'Rejected: ' + p_reason);
      if (paid) db.returns.unshift({ id: uuid(), return_code: 'SZR-' + rnd(8), order_id: o.id, user_id: o.user_id, kind: 'cancellation', reason: 'Order rejected by SHOPZENT: ' + p_reason, description: 'Refund due because payment was already verified.', photos: [], refund_preference: 'original', status: 'refund_processing', eligible_amount: o.total, created_at: now(), updated_at: now() });
      db.payment_submissions.filter((s) => s.order_id === o.id && ['submitted', 'under_verification'].includes(s.status)).forEach((s) => { s.status = 'rejected'; s.admin_notes = 'Order rejected'; });
      notify(o.user_id, 'user', 'Order rejected', `${o.order_code}: ${p_reason}${paid ? ' — your refund of ₹' + o.total + ' will be processed.' : ''}`, `order.html?id=${o.id}`); audit('order_rejected', 'orders', o.id, { reason: p_reason, refund_due: paid }); return { ok: true, refund_due: paid ? o.total : 0 }; }); },
    admin_cancel_order: ({ p_order_id, p_reason, p_idempotency_key }) => { needAdmin(); if (!p_reason || p_reason.trim().length < 3) throw err('invalid_input'); return idem('cancel_order', p_idempotency_key, () => { const o = order(p_order_id);
      if (['shipped', 'delivered', 'order_cancelled', 'order_rejected', 'refund_completed', 'refund_processing'].includes(o.status)) throw err('invalid_transition');
      o.cancel_reason = p_reason; o.cancelled_at = now(); voidOrderExtras(o); const paid = o.payment_status === 'verified'; addEvent(o, 'order_cancelled', 'Cancelled by admin: ' + p_reason);
      const open = db.returns.find((r) => r.order_id === o.id && r.kind === 'cancellation' && r.status === 'return_requested'); if (open) { open.status = paid ? 'refund_processing' : 'return_approved'; open.eligible_amount = paid ? o.total : 0; }
      else if (paid) db.returns.unshift({ id: uuid(), return_code: 'SZR-' + rnd(8), order_id: o.id, user_id: o.user_id, kind: 'cancellation', reason: 'Cancelled: ' + p_reason, description: '', photos: [], refund_preference: 'original', status: 'refund_processing', eligible_amount: o.total, created_at: now(), updated_at: now() });
      notify(o.user_id, 'user', 'Order cancelled', `${o.order_code}: ${p_reason}`, `order.html?id=${o.id}`); audit('order_cancelled', 'orders', o.id, { reason: p_reason }); return { ok: true, refund_due: paid ? o.total : 0 }; }); },
    admin_update_order: ({ p_order_id, p_patch }) => { needAdmin(); const o = order(p_order_id); const allowed = ['ship_name', 'ship_phone', 'ship_line1', 'ship_line2', 'ship_city', 'ship_state', 'ship_pincode', 'admin_notes']; const fields = [];
      Object.entries(p_patch || {}).forEach(([k, v]) => { if (allowed.includes(k)) { o[k] = String(v ?? '').slice(0, 500); fields.push(k); } }); o.updated_at = now(); audit('order_edited', 'orders', o.id, { fields }); return o; },
    admin_add_order_note: ({ p_order_id, p_note }) => { needAdmin(); const o = order(p_order_id); if (!p_note) throw err('invalid_input'); addEvent(o, o.status, p_note, true); audit('order_note', 'orders', o.id); return null; },
    admin_list_returns: ({ p_status } = {}) => { needAdmin(); return db.returns.filter((r) => !p_status || r.status === p_status).map((r) => { const o = db.orders.find((x) => x.id === r.order_id) || {}; const c = prof(r.user_id); return { ...r, order_code: o.order_code, order_total: o.total, order_status: o.status, payment_status: o.payment_status, customer_id: c.customer_id, customer_name: c.full_name, refunded_amount: o.id ? refunded(o) : 0 }; }); },
    admin_review_return: ({ p_return_id, p_action, p_reason, p_eligible_amount, p_note }) => { needAdmin(); const r = db.returns.find((x) => x.id === p_return_id); if (!r) throw err('not_found'); const o = order(r.order_id);
      const map = { under_review: 'under_review', approve: 'return_approved', reject: 'return_rejected', item_awaited: 'item_awaited', item_received: 'item_received' }; const to = map[p_action]; if (!to) throw err('invalid_input');
      if (['return_rejected', 'refund_completed', 'wallet_credited'].includes(r.status)) throw err('invalid_transition'); if (p_action === 'reject' && (!p_reason || p_reason.length < 3)) throw err('invalid_input');
      if (p_eligible_amount != null && p_eligible_amount !== '') { const amt = r2(p_eligible_amount); if (amt < 0 || amt > r2(paidAmount(o) - refunded(o))) throw err('refund_exceeds_paid'); r.eligible_amount = amt; }
      r.status = to; r.updated_at = now(); if (p_note) r.admin_notes = (r.admin_notes ? r.admin_notes + '\n' : '') + p_note; if (p_action === 'reject') r.reject_reason = p_reason;
      if (r.kind === 'return') { if (to === 'return_approved') addEvent(o, 'return_approved', 'Return approved'); if (to === 'return_rejected') addEvent(o, 'delivered', 'Return rejected: ' + p_reason); }
      if (r.kind === 'cancellation' && to === 'return_approved') { o.cancel_reason = r.reason; o.cancelled_at = now(); voidOrderExtras(o); addEvent(o, 'order_cancelled', 'Cancellation approved'); if (o.payment_status === 'verified') { r.status = 'refund_processing'; r.eligible_amount = r.eligible_amount ?? o.total; } }
      notify(r.user_id, 'user', 'Return/cancellation update', `${o.order_code}: ${({ under_review: 'under review', return_approved: 'approved', return_rejected: 'rejected — ' + p_reason, item_awaited: 'please send the item back', item_received: 'item received' })[to]}`, 'returns.html');
      audit('return_' + p_action, 'returns', r.id, { reason: p_reason || null }); return r; },
    admin_issue_refund: ({ p_order_id, p_return_id, p_amount, p_method, p_external_reference, p_idempotency_key }) => { needAdmin(); needFresh(); return idem('issue_refund', p_idempotency_key, () => { const o = order(p_order_id); const amt = r2(p_amount);
      if (!(amt > 0)) throw err('invalid_input'); if (!['original_payment', 'wallet'].includes(p_method)) throw err('invalid_input'); if (amt > r2(paidAmount(o) - refunded(o))) throw err('refund_exceeds_paid');
      const r = p_return_id ? db.returns.find((x) => x.id === p_return_id) : null; if (p_method === 'wallet' && r && r.refund_preference !== 'wallet') throw err('not_authorized');
      const f = { id: uuid(), refund_ref: 'SZRF-' + rnd(8), order_id: o.id, return_id: r?.id || null, amount: amt, method: p_method, status: p_method === 'wallet' ? 'completed' : 'processing', external_reference: p_external_reference || '', created_by: uid(), created_at: now() };
      db.refunds.unshift(f); if (p_method === 'wallet') walletCredit(o.user_id, 'refund_credit', amt, 'Refund for ' + o.order_code, { order_id: o.id, return_id: r?.id || null });
      const full = refunded(o) >= paidAmount(o); if (r) { r.status = p_method === 'wallet' ? 'wallet_credited' : 'refund_processing'; r.updated_at = now(); }
      addEvent(o, p_method === 'wallet' && full ? 'refund_completed' : 'refund_processing', `Refund ${f.refund_ref} ₹${amt} via ${p_method === 'wallet' ? 'SHOPZENT wallet (store credit)' : 'original payment method'}`);
      notify(o.user_id, 'user', p_method === 'wallet' ? 'Store credit added to your wallet' : 'Refund initiated', `₹${amt} for ${o.order_code}`, p_method === 'wallet' ? 'wallet.html' : `order.html?id=${o.id}`); audit('refund_issued', 'refunds', f.id, { amount: amt, method: p_method, order_code: o.order_code }); return f; }); },
    admin_complete_refund: ({ p_refund_id, p_external_reference, p_idempotency_key }) => { needAdmin(); needFresh(); return idem('complete_refund', p_idempotency_key, () => { const f = db.refunds.find((x) => x.id === p_refund_id); if (!f) throw err('not_found'); if (f.status === 'completed') throw err('invalid_transition'); if (!p_external_reference) throw err('invalid_input');
      f.status = 'completed'; f.external_reference = p_external_reference; const o = order(f.order_id); const r = f.return_id && db.returns.find((x) => x.id === f.return_id); if (r) r.status = 'refund_completed'; addEvent(o, 'refund_completed', `Refund ${f.refund_ref} completed (ref ${p_external_reference})`);
      notify(o.user_id, 'user', 'Refund completed', `₹${f.amount} for ${o.order_code} — reference ${p_external_reference}`, `order.html?id=${o.id}`); audit('refund_completed', 'refunds', f.id); return f; }); },
    admin_list_refunds: () => { needAdmin(); return db.refunds.map((f) => ({ ...f, order_code: db.orders.find((o) => o.id === f.order_id)?.order_code })); },
    admin_wallet_adjust: ({ p_user_id, p_direction, p_kind, p_amount, p_note, p_idempotency_key }) => { needAdmin(); needFresh(); if (!p_note || p_note.length < 3) throw err('invalid_input'); const amt = r2(p_amount); if (!(amt > 0) || amt > 100000) throw err('invalid_input');
      return idem('wallet_adjust', p_idempotency_key, () => { if (!db.profiles.some((p) => p.id === p_user_id)) throw err('not_found'); const row = p_direction === 'debit' ? walletDebit(p_user_id, 'admin_adjust', amt, p_note) : walletCredit(p_user_id, ['promo_credit', 'return_credit', 'admin_adjust'].includes(p_kind) ? p_kind : 'promo_credit', amt, p_note);
        notify(p_user_id, 'user', p_direction === 'debit' ? 'Wallet adjusted' : 'Store credit added', `₹${amt} — ${p_note}`, 'wallet.html'); audit('wallet_' + (p_direction === 'debit' ? 'debit' : 'credit'), 'wallet_ledger', row.id, { amount: amt, user_id: p_user_id }); return row; }); },
    admin_wallet_ledger: ({ p_user_id, p_limit = 100 } = {}) => { needAdmin(); return db.wallet_ledger.filter((l) => !p_user_id || l.user_id === p_user_id).slice(0, p_limit).map((l) => ({ ...l, customer_id: prof(l.user_id).customer_id })); },
    admin_coin_overview: () => { needAdmin(); return treasury(); },
    admin_coin_transfer: ({ p_target, p_coins, p_note, p_idempotency_key }) => { needAdmin(); needFresh(); const coins = Math.floor(Number(p_coins)); if (!(coins > 0)) throw err('invalid_input'); if (!p_note || p_note.length < 3) throw err('invalid_input');
      return idem('coin_transfer', p_idempotency_key, () => { if (!db.coin_settings.enabled) throw err('coins_disabled'); const t = String(p_target || '').trim().toUpperCase(); const w = db.wallets.find((x) => x.wallet_id === t); const p = w ? db.profiles.find((x) => x.id === w.user_id) : db.profiles.find((x) => x.customer_id === t); if (!p) throw err('not_found');
        if (coins > treasury().treasury_available) throw err('insufficient_balance'); const exp = db.coin_settings.expiry_days ? new Date(Date.now() + db.coin_settings.expiry_days * 864e5).toISOString() : null;
        const row = { id: ++db.seq, txn_ref: 'SZCN-' + rnd(8), user_id: p.id, kind: 'issue', coins, note: p_note, expires_at: exp, created_by: uid(), created_at: now() }; db.coin_ledger.unshift(row);
        notify(p.id, 'user', 'You received SHOPZENT coins', `${coins.toLocaleString('en-IN')} loyalty coins — ${p_note}`, 'wallet.html'); audit('coin_transfer', 'coin_ledger', row.id, { coins, customer_id: p.customer_id }); return row; }); },
    admin_coin_reverse: ({ p_ledger_id, p_note, p_idempotency_key }) => { needAdmin(); needFresh(); if (!p_note) throw err('invalid_input'); return idem('coin_reverse', p_idempotency_key, () => { const l = db.coin_ledger.find((x) => x.id === Number(p_ledger_id)); if (!l || l.kind !== 'issue') throw err('not_found');
      if (db.coin_ledger.some((x) => x.reverses_id === l.id)) throw err('already_reversed'); if (coinBal(l.user_id) < l.coins) throw err('insufficient_balance');
      const row = { id: ++db.seq, txn_ref: 'SZCN-' + rnd(8), user_id: l.user_id, kind: 'reversal', coins: l.coins, note: p_note, reverses_id: l.id, created_by: uid(), created_at: now() }; db.coin_ledger.unshift(row); audit('coin_reversal', 'coin_ledger', row.id, { reverses: l.txn_ref }); return row; }); },
    admin_coin_ledger: ({ p_limit = 200 } = {}) => { needAdmin(); return db.coin_ledger.slice(0, p_limit).map((l) => ({ ...l, customer_id: prof(l.user_id).customer_id || null, wallet_id: db.wallets.find((w) => w.user_id === l.user_id)?.wallet_id || null })); },
    admin_set_coin_settings: ({ p_enabled, p_expiry_days, p_rules }) => { needAdmin(); needFresh(); Object.assign(db.coin_settings, { enabled: !!p_enabled, expiry_days: p_expiry_days ? parseInt(p_expiry_days) : null, rules: p_rules || '', updated_at: now(), updated_by: uid() }); audit('coin_settings_change', 'coin_settings', 1, { enabled: !!p_enabled }); return db.coin_settings; },
    admin_list_users: ({ p_q } = {}) => RPC.admin_search_customers({ p_q }),
    admin_set_user_role: ({ p_user_id, p_role }) => { needAdmin(); if (!isSuper()) throw err('not_authorized'); needFresh(); if (!['customer', 'admin', 'super_admin'].includes(p_role)) throw err('invalid_input'); const p = db.profiles.find((x) => x.id === p_user_id); if (!p) throw err('not_found');
      if (p.role === 'super_admin' && p_role !== 'super_admin' && db.profiles.filter((x) => x.role === 'super_admin' && x.status === 'active').length <= 1) throw err('last_super_admin'); const from = p.role; p.role = p_role; audit('permission_change', 'profiles', p.id, { from, to: p_role }); return p; },
    admin_set_user_status: ({ p_user_id, p_status, p_reason }) => { needAdmin(); if (!['active', 'suspended'].includes(p_status)) throw err('invalid_input'); if (p_user_id === uid()) throw err('not_authorized'); const p = db.profiles.find((x) => x.id === p_user_id); if (!p) throw err('not_found');
      if (p.role === 'super_admin' && !isSuper()) throw err('not_authorized'); p.status = p_status; audit('user_' + p_status, 'profiles', p.id, { reason: p_reason || '' }); return p; },
    admin_upsert_setting: ({ p_key, p_value, p_is_public }) => { needAdmin(); if (['payment', 'security'].includes(p_key)) { if (!isSuper()) throw err('not_authorized'); needFresh(); } if (p_key === 'domain') { if (!isSuper()) throw err('not_authorized'); if (!/^([a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+)?$/.test(p_value?.domain || '') || !/^([a-z0-9][a-z0-9-]{0,38})?$/.test(p_value?.github_user || '')) throw err('invalid_input'); p_is_public = true; } if (!/^[a-z_]{2,40}$/.test(p_key)) throw err('invalid_input');
      const s = db.site_settings.find((x) => x.key === p_key); if (s) { s.value = p_value; s.is_public = p_is_public ?? s.is_public; s.updated_at = now(); } else db.site_settings.push({ key: p_key, value: p_value, is_public: !!p_is_public, updated_at: now() });
      audit(['payment', 'security'].includes(p_key) ? p_key + '_settings_change' : 'settings_change', 'site_settings', p_key); return null; },
    admin_audit_log: ({ p_limit = 200, p_action } = {}) => { needAdmin(); return db.audit_log.filter((a) => !p_action || a.action === p_action).slice(0, p_limit); },
    admin_notifications: () => { needAdmin(); return db.notifications.filter((n) => n.audience === 'admin').slice(0, 50); },
  });

  // ---------- auth (demo accounts are created locally; real auth = Supabase Auth) ----------
  // Preview-mode admin: the email + PBKDF2 hash come from config.js (DEMO_ADMIN). No admin password is stored anywhere in plain text.
  const DA = (() => { const a = (typeof window !== 'undefined' && window.SHOPZENT_CONFIG && window.SHOPZENT_CONFIG.DEMO_ADMIN) || null;
    return a && a.email && a.salt_b64 && a.hash_b64 && Number(a.iterations) >= 100000 ? { email: String(a.email).trim().toLowerCase(), pbkdf2: { salt_b64: a.salt_b64, hash_b64: a.hash_b64, iterations: Number(a.iterations) } } : null; })();
  async function ensureDemoAccounts() {
    const mk = async (email, pw, name, mobile, role, pbkdf2 = null) => { const id = uuid(); db.users.push({ id, email, pw: pw == null ? null : await sha('sz:' + pw), pbkdf2, confirmed: true, factors: role !== 'customer' ? [{ id: uuid(), status: 'verified', name: 'Authenticator (preview)' }] : [], created_at: now() });
      db.profiles.push({ id, customer_id: 'SZC-' + rnd(8), full_name: name, email, mobile, role, status: 'active', created_at: now(), updated_at: now() }); db.wallets.push({ id: uuid(), user_id: id, wallet_id: 'SZW-' + rnd(8), created_at: now() }); return id; };
    if (db.users.length) { // keep the preview admin in step with config.js (e.g. after the owner changes the password hash)
      if (DA) { const u = db.users.find((x) => x.email === DA.email); if (u && JSON.stringify(u.pbkdf2) !== JSON.stringify(DA.pbkdf2)) { u.pbkdf2 = DA.pbkdf2; u.pw = null; save(); } }
      return; }
    if (DA) await mk(DA.email, null, 'SHOPZENT Super Admin', '9000000001', 'super_admin', DA.pbkdf2);
    const c = await mk('demo@shopzent.demo', 'Demo@12345', 'Demo Customer', '9000000002', 'customer');
    db.wallet_ledger.push({ id: ++db.seq, txn_ref: 'SZWT-' + rnd(10), user_id: c, wallet_id: db.wallets.find((w) => w.user_id === c).id, direction: 'credit', kind: 'promo_credit', amount: 100, status: 'posted', note: 'Demo welcome store credit (preview only)', created_by: null, created_at: now() });
    save();
  }
  const ready = ensureDemoAccounts();
  const emit = (ev) => listeners.forEach((cb) => { try { cb(ev, sess()); } catch {} });
  const auth = {
    async session() { await ready; const s = sess(); if (!s) return null; const u = db.users.find((x) => x.id === s.uid); return u ? { user: { id: u.id, email: u.email }, aal: s.aal } : null; },
    async userId() { await ready; return uid(); },
    async profile() { await ready; return clone(RPC.my_profile()); },
    async signUp({ full_name, email, mobile, password }) { await ready; await pause(200); email = String(email).trim().toLowerCase();
      if (db.users.some((u) => u.email === email)) return { needsConfirm: true }; // generic answer — no account enumeration
      const id = uuid(); db.users.push({ id, email, pw: await sha('sz:' + password), confirmed: true, factors: [], created_at: now() });
      db.profiles.push({ id, customer_id: 'SZC-' + rnd(8), full_name, email, mobile, role: 'customer', status: 'active', created_at: now(), updated_at: now() }); db.wallets.push({ id: uuid(), user_id: id, wallet_id: 'SZW-' + rnd(8), created_at: now() });
      save(); return { needsConfirm: false, demoAutoConfirmed: true }; },
    async signIn(email, password) { await ready; await pause(200); email = String(email).trim().toLowerCase(); const key = await sha('e:' + email);
      const recent = db.login_attempts.filter((a) => a.email_hash === key && !a.success && Date.now() - new Date(a.created_at) < 60e3).length;
      if (recent >= 10) { const e = err('rate_limited'); e.retry_after = 60; throw e; }
      await pause(Math.min(3000, recent * 250)); // progressive delay
      const u = db.users.find((x) => x.email === email); const ok = !!u && (u.pbkdf2 ? await pbkdf2ok(password, u.pbkdf2) : (!!u.pw && u.pw === await sha('sz:' + password)));
      db.login_attempts.unshift({ id: ++db.seq, email_hash: key, ip_hash: 'demo', success: ok, reason: ok ? null : 'invalid_credentials', created_at: now() }); db.login_attempts = db.login_attempts.slice(0, 500);
      if (!ok) { db.audit_log.unshift({ id: ++db.seq, actor_id: null, actor_role: 'anon', action: 'login_failed', entity: 'auth', entity_id: null, details: { email_hash: key.slice(0, 12) }, created_at: now() }); save(); throw err('invalid_credentials'); }
      const p = db.profiles.find((x) => x.id === u.id); if (p.status !== 'active') { save(); throw err('account_suspended'); }
      setSess({ uid: u.id, aal: 'aal1', iat: Date.now() }); save(); emit('SIGNED_IN'); return auth.mfaState(); },
    async mfaState() { const s = sess(); const u = s && db.users.find((x) => x.id === s.uid); const has = !!(u && u.factors.some((f) => f.status === 'verified')); return { current: s?.aal || null, next: has ? 'aal2' : 'aal1', mfaRequired: has && s?.aal !== 'aal2' }; },
    async signOut(all) { if (uid()) { audit(all ? 'logout_all' : 'logout', 'auth', uid()); save(); } setSess(null); emit('SIGNED_OUT'); },
    async sendReset() { await pause(300); return true; },
    async updatePassword(pw) { const u = db.users.find((x) => x.id === uid()); if (!u) throw err('not_authorized'); if (u.pbkdf2) throw err('Preview mode: the admin password is set through the hash in js/config.js (see SETUP.md). With Supabase connected you change it normally.'); u.pw = await sha('sz:' + pw); audit('password_changed', 'auth', u.id); save(); return true; },
    async factors() { const u = db.users.find((x) => x.id === uid()); return clone(u?.factors || []); },
    async enroll() { const u = db.users.find((x) => x.id === uid()); if (!u) throw err('not_authorized'); u.factors = u.factors.filter((f) => f.status === 'verified'); const f = { id: uuid(), status: 'unverified', name: 'Authenticator' }; u.factors.push(f); save();
      const qr = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200"><rect width="200" height="200" fill="#fff"/><rect x="10" y="10" width="180" height="180" fill="none" stroke="#7C3AED" stroke-width="4" stroke-dasharray="8 6"/><text x="100" y="92" text-anchor="middle" font-family="Arial" font-size="16" fill="#7C3AED" font-weight="700">PREVIEW MODE</text><text x="100" y="116" text-anchor="middle" font-family="Arial" font-size="12" fill="#374151">Real QR appears when</text><text x="100" y="132" text-anchor="middle" font-family="Arial" font-size="12" fill="#374151">Supabase is connected</text></svg>');
      return { id: f.id, qr, secret: 'PREVIEW-ONLY-NO-SECRET', uri: '' }; },
    async verify(factorId, code) { await pause(200); const u = db.users.find((x) => x.id === uid()); const f = u?.factors.find((x) => x.id === factorId); if (!f || !/^\d{6}$/.test(String(code).trim())) { audit('mfa_failure', 'auth', uid()); save(); throw new Error('Enter the 6-digit code.'); }
      f.status = 'verified'; const s = sess(); s.aal = 'aal2'; s.iat = Date.now(); setSess(s); save(); emit('MFA_CHALLENGE_VERIFIED'); return true; },
    async unenroll(factorId) { const u = db.users.find((x) => x.id === uid()); if (!u) throw err('not_authorized'); u.factors = u.factors.filter((f) => f.id !== factorId); const s = sess(); if (s && !u.factors.some((f) => f.status === 'verified')) { s.aal = 'aal1'; setSess(s); } audit('mfa_removed', 'auth', u.id); save(); return true; },
    async refresh() {},
    onChange(cb) { listeners.push(cb); },
  };
  // downscale images so the browser-only demo store doesn't overflow
  const shrink = (file) => new Promise((res) => { const fr = new FileReader(); fr.onload = () => { const img = new Image(); img.onload = () => { const k = Math.min(1, 900 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); res(c.toDataURL('image/jpeg', .82)); }; img.onerror = () => res(null); img.src = fr.result; }; fr.readAsDataURL(file); });
  db.files = db.files || {};
  return {
    mode: 'demo', auth,
    reset() { localStorage.removeItem(KEY); localStorage.removeItem(SKEY); },
    async select(table, o = {}) { await ready; await pause(60); const rows = query(visible(table), o); return o.single ? (rows[0] || null) : rows; },
    async insert(table, row) { await ready; await pause(); if (!WRITABLE_ADMIN.includes(table)) throw err('not_authorized'); needAdmin(); const r = { id: row.id || uuid(), created_at: now(), updated_at: now(), ...row };
      if (table === 'products') { if (!r.product_code) r.product_code = 'SZP-' + rnd(6); if (db.products.some((p) => p.slug === r.slug)) throw err('Slug already used — choose another.'); if (r.purchase_type === 'affiliate' && !/^https:\/\//.test(r.affiliate_url || '')) throw err('Affiliate URL must start with https://'); if (r.purchase_type === 'direct' && (r.price == null || r.price === '')) throw err('Direct products need a price.'); r.view_count = 0; }
      if (table === 'coupons') { const code = String(r.code || '').trim().toUpperCase(); if (!/^[A-Z0-9_-]{3,30}$/.test(code)) throw err('Coupon code: 3–30 letters/digits.'); r.code_hash = await sha(code); r.code_enc = obf(code); delete r.code; if (db.coupons.some((c) => c.code_hash === r.code_hash)) throw err('This coupon code already exists.'); r.is_public = false; }
      if (table === 'ads') { r.impressions = 0; r.clicks = 0; }
      if (table === 'product_coupons') { delete r.id; delete r.updated_at; if (db.product_coupons.some((x) => x.product_id === r.product_id && x.coupon_id === r.coupon_id)) return clone(r); }
      db[table].unshift(r); audit('content_insert', table, r.id || r.product_id, { name: table === 'coupons' ? 'coupon' : (r.name || r.title || '') }); save(); return clone(table === 'coupons' ? { ...r, code: deob(r.code_enc) } : r); },
    async update(table, id, patch, key = 'id') { await ready; await pause(); if (!WRITABLE_ADMIN.includes(table)) throw err('not_authorized'); needAdmin(); const r = db[table].find((x) => x[key] === id); if (!r) throw err('not_found');
      const next = { ...r, ...patch, updated_at: now() };
      if (table === 'products') { if (next.purchase_type === 'affiliate' && !/^https:\/\//.test(next.affiliate_url || '')) throw err('Affiliate URL must start with https://'); if (next.purchase_type === 'direct' && (next.price == null || next.price === '')) throw err('Direct products need a price.'); if (db.products.some((p) => p.slug === next.slug && p.id !== id)) throw err('Slug already used — choose another.'); }
      if (table === 'coupons') { if (next.code) { const code = String(next.code).trim().toUpperCase(); if (!/^[A-Z0-9_-]{3,30}$/.test(code)) throw err('Coupon code: 3–30 letters/digits.'); next.code_hash = await sha(code); next.code_enc = obf(code); if (db.coupons.some((c) => c.code_hash === next.code_hash && c.id !== r.id)) throw err('This coupon code already exists.'); } delete next.code; next.is_public = false; } Object.assign(r, next); audit('content_update', table, id, { fields: Object.keys(patch) }); save(); return clone(table === 'coupons' ? { ...r, code: deob(r.code_enc) } : r); },
    async remove(table, id, key = 'id') { await ready; await pause(); if (!WRITABLE_ADMIN.includes(table)) throw err('not_authorized'); needAdmin(); const i = db[table].findIndex((x) => x[key] === id); if (i < 0) throw err('not_found'); db[table].splice(i, 1);
      if (table === 'products') db.product_coupons = db.product_coupons.filter((x) => x.product_id !== id); audit('content_delete', table, id); save(); return true; },
    async removeWhere(table, match) { needAdmin(); db[table] = db[table].filter((x) => !Object.entries(match).every(([k, v]) => x[k] === v)); audit('content_delete', table, JSON.stringify(match)); save(); return true; },
    async rpc(name, args = {}) { await ready; await pause(); const f = RPC[name]; if (!f) throw err('not_found'); const out = await f(args || {}); save(); return clone(out ?? null); },
    async upload(bucket, file, folder = '') { await ready; const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
      if (bucket === 'public-media' || bucket === 'apk-files') needAdmin(); else { const u = needUser(); if (!folder.startsWith(u.id)) throw err('not_authorized'); }
      const path = `${folder ? folder.replace(/\/+$/, '') + '/' : ''}${Date.now()}-${uuid()}.${ext}`;
      let data = null; if (/^image\//.test(file.type)) data = await shrink(file);
      if (data) db.files[path] = data; audit('file_upload', bucket, path, { size: file.size, type: file.type }); save();
      return { path, url: bucket === 'public-media' ? (data || '') : null }; },
    async signedUrl(bucket, path) { const own = uid() && path.startsWith(uid() + '/'); if (!own && !isAdmin()) throw err('not_authorized'); return db.files[path] || ''; },
    async removeFile(bucket, path) { needAdmin(); delete db.files[path]; audit('file_delete', bucket, path); save(); return true; },
    async fn() { throw err('not_found'); },
  };
}
