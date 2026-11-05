// SHOPZENT share, save and reviews helpers.
// Share-and-earn applies only to SHOPZENT's own products (purchase_type direct, marketplace shopzent). The link carries the
// sharer's customer code (SZC-…) and the product id; the server checks everything again at checkout.
import { api } from './api.js';
import { $, esc, toast, inr, fmtDate, safeUrl } from './util.js';
import { profile, settings, IC } from './layout.js';

const SITE = 'https://qeuika.shop';
const REF_KEY = 'sz_ref';
const WEEK = 7 * 24 * 3600 * 1000;

export const isOwnProduct = (p) => p && p.purchase_type !== 'affiliate' && (p.marketplace || 'shopzent') === 'shopzent';

// keep the referral from a share link (product page with ?ref=&pid=) for the shared product only
export function captureRef(p) {
  const q = new URLSearchParams(location.search);
  const code = (q.get('ref') || '').toUpperCase(); const pid = q.get('pid') || '';
  if (!/^SZC-[A-Z0-9]{8}$/.test(code) || !p || pid !== p.id) return;
  localStorage.setItem(REF_KEY, JSON.stringify({ code, pid, t: Date.now() }));
}

// the referral to send with an order: only if the shared product is in the cart and the link is at most 7 days old
export function attributionFor(items) {
  try {
    const r = JSON.parse(localStorage.getItem(REF_KEY) || 'null');
    if (!r || !r.code || !r.pid || !r.t || Date.now() - r.t > WEEK) return null;
    if (!(items || []).some((i) => i.product_id === r.pid)) return null;
    return { code: r.code, pid: r.pid, t: r.t };
  } catch { return null; }
}

export async function shareContext(p) {
  const pr = await profile().catch(() => null);
  const s = await settings();
  const own = isOwnProduct(p);
  const rate = Number(p.referral_rate) || Number(s.referral?.default_rate) || 5;
  const enabled = s.referral?.enabled !== false;
  return { pr, own, rate, enabled, loggedIn: !!pr };
}

// the share block under the product: Save, Share (with reward when own + logged in), Copy link
export function shareBlockHtml(p, ctx, saved) {
  const reward = !ctx.own
    ? 'Ye affiliate / partner product hai. Share kar sakte ho, par iska koi reward nahi.'
    : !ctx.enabled ? 'Share ka reward abhi band hai.'
    : ctx.loggedIn ? `Dost ye product share karke kharide to aapko ${ctx.rate}% coins milenge (product deliver hone ke baad). Apne aap ko share karke nahi milega.`
    : `Login karke share karo: dost kharide to aapko ${ctx.rate}% coins milenge.`;
  return `<div class="share-block" style="margin:14px 0">
    <div class="row" style="gap:8px;flex-wrap:wrap">
      <button class="btn sec sm save-btn" type="button" data-save="${esc(p.id)}" aria-pressed="${saved ? 'true' : 'false'}">${saved ? IC.heartF : IC.heart} <span>${saved ? 'Saved' : 'Save'}</span></button>
      <button class="btn sm" type="button" id="share-btn">Share</button>
      <button class="btn ghost sm" type="button" id="copy-btn">Copy link</button>
    </div>
    <p class="tiny muted" style="margin:8px 0 0">${esc(reward)}</p></div>`;
}

export function productShareUrl(p, ctx) {
  const u = new URL(`${SITE}/product.html`); u.searchParams.set('slug', p.slug);
  if (ctx.own && ctx.enabled && ctx.loggedIn && ctx.pr?.customer_id) { u.searchParams.set('ref', ctx.pr.customer_id); u.searchParams.set('pid', p.id); }
  return u.toString();
}

export function wireShare(p, ctx) {
  const url = productShareUrl(p, ctx); const text = `${p.name} — SHOPZENT`;
  $('#share-btn')?.addEventListener('click', async () => {
    try { if (navigator.share) { await navigator.share({ title: p.name, text, url }); return; } } catch { return; }
    window.open(`https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}`, '_blank', 'noopener');
  });
  $('#copy-btn')?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(url); toast('Link copy ho gaya 🔗', 'ok'); } catch { toast(url); }
  });
}

// the share-website button (no reward) for the footer and menu
export function shareWebsiteHtml() {
  return `<button class="btn ghost sm" type="button" data-share-site>Share website (no reward)</button>`;
}
export function wireShareWebsite(root = document) {
  root.querySelectorAll('[data-share-site]').forEach((b) => b.addEventListener('click', async () => {
    const text = 'SHOPZENT — shopping ka naya address'; const url = SITE + '/';
    try { if (navigator.share) { await navigator.share({ title: 'SHOPZENT', text, url }); return; } } catch { return; }
    window.open(`https://wa.me/?text=${encodeURIComponent(text + ' ' + url)}`, '_blank', 'noopener');
  }));
}

// reviews under the product (only visible reviews; written by customers with a delivered order)
export async function loadReviews(p, el) {
  if (!el) return;
  try {
    const r = await api.rpc('product_reviews_summary', { p_product_id: p.id, p_limit: 20 });
    const stars = (n) => '★'.repeat(Math.round(n)) + '☆'.repeat(5 - Math.round(n));
    el.innerHTML = `<h3 style="margin-top:20px">Customer reviews</h3>${r.count
      ? `<p class="small"><b style="color:var(--ink)">${stars(r.avg)}</b> ${Number(r.avg).toFixed(1)} · ${r.count} review${r.count === 1 ? '' : 's'}</p>`
      : '<p class="small muted">Abhi koi review nahi. Product deliver hone ke baad aap likh sakte ho.</p>'}
      ${(r.items || []).map((x) => `<div class="card pad" style="margin:8px 0;padding:10px 12px"><div class="row between small"><b>${esc(x.by)}</b><span class="tiny muted">${fmtDate(x.created_at, false)}</span></div>
        <div style="color:var(--ink);letter-spacing:1px">${stars(x.rating)}</div>${x.body ? `<p class="small" style="margin:4px 0 0;white-space:pre-wrap">${esc(x.body)}</p>` : ''}</div>`).join('')}`;
  } catch { el.innerHTML = ''; }
}

// My orders: write one review for a delivered product (rating 1-5, short text; once per product)
export function reviewFormHtml(productId) {
  return `<details class="review-box" style="margin-top:8px"><summary class="btn sec sm" style="display:inline-block;cursor:pointer">Review likhein</summary>
    <div class="row" style="gap:8px;margin-top:8px;flex-wrap:wrap"><select data-rv-rating aria-label="Rating"><option value="5">★★★★★ 5</option><option value="4">★★★★☆ 4</option><option value="3">★★★☆☆ 3</option><option value="2">★★☆☆☆ 2</option><option value="1">★☆☆☆☆ 1</option></select></div>
    <textarea data-rv-body maxlength="500" rows="2" placeholder="Kaisa laga? (optional, 500 characters)" style="width:100%;margin-top:6px"></textarea>
    <button class="btn sm" type="button" data-rv-send="${esc(productId)}" style="margin-top:6px">Review bhejein</button><span class="tiny muted" data-rv-msg></span></details>`;
}
export function wireReviewForms(root) {
  root.querySelectorAll('[data-rv-send]').forEach((b) => b.addEventListener('click', async (e) => {
    e.preventDefault(); e.stopPropagation();
    const box = b.closest('.review-box'); const msg = box.querySelector('[data-rv-msg]');
    b.disabled = true; msg.textContent = 'Bhej rahe hain…';
    try {
      await api.rpc('submit_review', { p_product_id: b.dataset.rvSend, p_rating: Number(box.querySelector('[data-rv-rating]').value), p_body: box.querySelector('[data-rv-body]').value.trim() || null });
      box.outerHTML = '<p class="tiny" style="color:var(--ok);margin:6px 0 0">Review save ho gaya, shukriya ✅</p>';
    } catch (x) {
      const m = String(x?.message || x || '');
      msg.textContent = /already_reviewed/.test(m) ? 'Aap ye product pehle hi review kar chuke ho.' : /not_delivered/.test(m) ? 'Review tab likh sakte ho jab product deliver ho jaye.' : 'Abhi review save nahi hua, dobara try karein.';
      b.disabled = false;
    }
  }));
}
