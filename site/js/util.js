// Shared helpers (no dependencies)
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => (v === null || v === undefined ? '' : String(v)).replace(/[&<>"']/g, (c) => ESC[c]);
export const inr = (n) => (n === null || n === undefined || n === '' || isNaN(n)) ? '—' :
  '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: Number(n) % 1 ? 2 : 0, maximumFractionDigits: 2 });
export const num = (n) => Number(n || 0).toLocaleString('en-IN');
export const fmtDate = (d, time = true) => { if (!d) return '—'; const x = new Date(d); if (isNaN(x)) return '—';
  return x.toLocaleString('en-IN', time ? { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' } : { day: '2-digit', month: 'short', year: 'numeric' }); };
export const param = (k) => new URLSearchParams(location.search).get(k);
export const debounce = (fn, ms = 250) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = crypto.getRandomValues(new Uint8Array(1))[0] % 16; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }));
export const idemKey = (scope) => { const k = 'sz_idem_' + scope; let v = sessionStorage.getItem(k); if (!v) { v = uuid(); sessionStorage.setItem(k, v); } return v; };
export const clearIdem = (scope) => sessionStorage.removeItem('sz_idem_' + scope);
export const slugify = (s) => String(s || '').toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_-]+/g, '-').slice(0, 80);
// Only allow https links (and same-site relative links) — blocks javascript:, data:, open redirects
export const safeUrl = (u, allowRelative = true) => {
  if (!u) return ''; const s = String(u).trim();
  if (allowRelative && /^(\.{0,2}\/)?[\w\-./?=&#%]+$/.test(s) && !/^\/\//.test(s) && !s.includes(':')) return s;
  try { const x = new URL(s); return x.protocol === 'https:' ? x.href : ''; } catch { return ''; }
};
export const safeImg = (u) => { if (!u) return ''; const s = String(u); if (s.startsWith('data:image/') && !s.startsWith('data:image/svg')) return s; return safeUrl(s); };
// HTML sanitizer for admin-edited page content (allow-list)
const OK_TAGS = new Set(['P','BR','B','STRONG','I','EM','U','UL','OL','LI','H2','H3','H4','A','BLOCKQUOTE','SPAN','DIV','HR','TABLE','THEAD','TBODY','TR','TD','TH','SMALL','CODE']);
export function sanitizeHtml(html) {
  const doc = new DOMParser().parseFromString(`<div>${html || ''}</div>`, 'text/html');
  const walk = (node) => { [...node.childNodes].forEach((n) => {
    if (n.nodeType === 1) {
      if (!OK_TAGS.has(n.tagName)) { if (['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','FORM','INPUT','TEXTAREA','SVG','MATH','LINK','META'].includes(n.tagName)) { n.remove(); return; } n.replaceWith(...n.childNodes); walk(node); return; }
      [...n.attributes].forEach((a) => { const keep = n.tagName === 'A' && a.name === 'href'; if (!keep) n.removeAttribute(a.name); });
      if (n.tagName === 'A') { const h = safeUrl(n.getAttribute('href') || '') || (/^mailto:|^tel:/.test(n.getAttribute('href')||'') ? n.getAttribute('href') : ''); if (h) { n.setAttribute('href', h); n.setAttribute('rel', 'noopener nofollow'); if (/^https:/.test(h)) n.setAttribute('target', '_blank'); } else n.removeAttribute('href'); }
      walk(n);
    } else if (n.nodeType !== 3) n.remove();
  }); };
  walk(doc.body.firstChild); return doc.body.firstChild.innerHTML;
}
// toast + modal
export function toast(msg, type = '') { let box = $('.toasts'); if (!box) { box = document.createElement('div'); box.className = 'toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
  const t = document.createElement('div'); t.className = 'toast ' + type; t.textContent = msg; box.appendChild(t); setTimeout(() => t.remove(), 4200); }
export function modal(html, { wide = false, onOpen } = {}) {
  const m = document.createElement('div'); m.className = 'modal'; m.setAttribute('role', 'dialog'); m.setAttribute('aria-modal', 'true');
  m.innerHTML = `<div class="box ${wide ? 'wide' : ''}">${html}</div>`; document.body.appendChild(m); document.body.style.overflow = 'hidden';
  const close = () => { m.remove(); document.body.style.overflow = ''; };
  m.addEventListener('click', (e) => { if (e.target === m || e.target.closest('[data-close]')) close(); });
  document.addEventListener('keydown', function k(e) { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', k); } });
  onOpen && onOpen(m.firstChild, close); const f = m.querySelector('input,select,textarea,button'); f && f.focus(); return { el: m.firstChild, close };
}
export function confirmBox(title, body, { ok = 'Confirm', danger = false, input = null } = {}) {
  return new Promise((res) => { modal(`<h3>${esc(title)}</h3><p class="muted">${esc(body)}</p>${input ? `<div class="field"><label>${esc(input)}</label><textarea id="cb-in" maxlength="1000" required></textarea><div class="err" id="cb-err"></div></div>` : ''}
    <div class="row" style="justify-content:flex-end"><button class="btn sec sm" data-close>Cancel</button><button class="btn sm ${danger ? 'danger' : ''}" id="cb-ok">${esc(ok)}</button></div>`,
    { onOpen: (el, close) => { el.querySelector('[data-close]').onclick = () => { close(); res(null); };
      el.querySelector('#cb-ok').onclick = () => { if (input) { const v = el.querySelector('#cb-in').value.trim(); if (v.length < 3) { el.querySelector('#cb-err').textContent = 'Please write a reason (min 3 characters).'; return; } close(); res(v); } else { close(); res(true); } }; } }); });
}
// friendly error text from backend codes
const ERR = { email_not_confirmed: 'Please confirm your email first — open the link we emailed you.', coupon_expired: 'This coupon has expired.', coupon_min_order: 'Your order is below this coupon\'s minimum value.', coupon_user_limit: 'You have already used this coupon the maximum number of times.', coupon_not_found: 'That coupon code is not valid.', coupon_inactive: 'This coupon is not active.', coupon_not_started: 'This coupon is not active yet.', coupon_usage_limit: 'This coupon has reached its usage limit.', coupon_not_eligible: 'This coupon does not apply to the items in your cart.',
  invalid_shipping: 'Please check your delivery address (name, mobile, pincode).', product_unavailable: 'An item in your cart is no longer available.', insufficient_stock: 'Not enough stock for an item in your cart.', cart_empty: 'Your cart is empty.', account_suspended: 'This account is suspended. Please contact support.', wallet_not_accepted: 'Store credit refund needs the customer\'s acceptance (choose original payment instead).', reason_required: 'Please enter a reason.', note_required: 'Please enter a note.', not_paid: 'This order has no verified payment.', payment_not_verified: 'Payment is not verified yet.', cancellation_pending: 'A cancellation request is already pending.', already_requested: 'You have already sent a request for this order.', already_reversed: 'This transfer was already reversed.', insufficient_treasury: 'Not enough coins left in the treasury.', coins_disabled: 'The coin system is switched off.', last_super_admin: 'You cannot remove the last Super Admin.', cannot_change_self: 'You cannot change your own role or status.', field_not_editable: 'That field cannot be edited.', return_window_closed: 'The return window for this order has closed.', limit_reached: 'Limit reached.', id_generation_failed: 'Please try again.', login_required: 'Please log in first.', '23503': 'This item is in use (for example a coupon that customers already used). Switch it off instead of deleting.',
  not_authorized: 'You are not allowed to do that.', mfa_required: 'Please complete 2-step verification (authenticator code) first.', fresh_auth_required: 'For safety, please sign in again (with your authenticator code) and retry.',
  rate_limited: 'Too many attempts. Please wait a minute and try again.', invalid_credentials: 'Email or password is incorrect.', captcha_required: 'Please complete the human verification.',
  duplicate_utr: 'This UTR / transaction reference has already been submitted for another order. Each payment can be used only once.', invalid_utr: 'Please enter a valid UTR / transaction reference (12–22 letters or digits).',
  coupon_invalid: 'This coupon code is not valid.', invalid: 'This coupon code is not valid.', expired: 'This coupon has expired.', not_started: 'This coupon is not active yet.', exhausted: 'This coupon has reached its usage limit.', user_limit: 'You have already used this coupon the maximum number of times.',
  min_order: 'Your order total is below the minimum for this coupon.', not_applicable: 'This coupon does not apply to the items in your cart.', inactive: 'This coupon is not active.', login_required: 'Please log in to use this coupon.',
  insufficient_balance: 'Not enough balance for this operation.', refund_exceeds_paid: 'Refund amount is more than the amount still refundable for this order.', invalid_transition: 'That status change is not allowed for this order right now.',
  not_found: 'Not found.', invalid_input: 'Please check the details you entered.', out_of_stock: 'One of the items is out of stock.', email_not_confirmed: 'Please confirm your email first (check your inbox).', suspended: 'This account is suspended. Please contact support.',
  account_suspended: 'This account is suspended. Please contact support.', weak_password: 'Please choose a stronger password (at least 10 characters with letters and numbers).', user_exists: 'If this email is new, your account has been created — check your inbox to confirm it.',
  last_super_admin: 'You cannot remove the last Super Admin.', coins_disabled: 'The coin system is currently disabled.', already_reversed: 'This transaction was already reversed.', return_window_closed: 'The return window for this order has closed.', open_return_exists: 'There is already an open request for this order.' };
export function errText(e) { const raw = (e && (e.code_text || e.message || e.error_description || e.error)) || String(e || 'Something went wrong');
  const k = Object.keys(ERR).find((c) => raw === c || raw.includes(c)); return k ? ERR[k] : (raw.length < 140 && !/sql|relation|column|function|syntax|permission denied/i.test(raw) ? raw : 'Something went wrong. Please try again.'); }
// files: extension + MIME + magic-byte checks before upload (server still enforces bucket rules)
const MAGIC = { png: [0x89, 0x50, 0x4e, 0x47], jpg: [0xff, 0xd8, 0xff], webp: [0x52, 0x49, 0x46, 0x46], gif: [0x47, 0x49, 0x46], apk: [0x50, 0x4b, 0x03, 0x04], mp4: null, webm: [0x1a, 0x45, 0xdf, 0xa3] };
export async function checkFile(file, kinds, maxMB) {
  if (!file) throw new Error('Please choose a file.');
  if (file.size > maxMB * 1024 * 1024) throw new Error(`File is too large (max ${maxMB} MB).`);
  const ext = (file.name.split('.').pop() || '').toLowerCase().replace('jpeg', 'jpg');
  if (!kinds.includes(ext)) throw new Error(`Allowed file types: ${kinds.join(', ')}`);
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const sig = MAGIC[ext]; if (sig && !sig.every((b, i) => head[i] === b)) throw new Error('This file does not look like a real ' + ext.toUpperCase() + ' file.');
  if (ext === 'mp4' && !(head[4] === 0x66 && head[5] === 0x74 && head[6] === 0x79 && head[7] === 0x70)) throw new Error('This file does not look like a real MP4 video.');
  return ext;
}
export const fileToDataUrl = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
export const waNumber = (n) => { const d = String(n || '').replace(/\D/g, ''); return d.length === 10 ? '91' + d : d; };
export const waLink = (n, text) => `https://wa.me/${waNumber(n)}?text=${encodeURIComponent(text || '')}`;
export const statusLabel = (s) => ({ payment_pending: 'Payment Pending', payment_submitted: 'Payment Submitted', under_verification: 'Payment Under Verification', payment_verified: 'Payment Verified', payment_rejected: 'Payment Rejected',
  order_confirmed: 'Order Confirmed', processing: 'Processing', shipped: 'Shipped', delivered: 'Delivered', return_requested: 'Return Requested', return_approved: 'Return Approved', refund_processing: 'Refund Processing', refund_completed: 'Refund Completed',
  order_cancelled: 'Order Cancelled', order_rejected: 'Order Rejected', submitted: 'Submitted', verified: 'Verified', rejected: 'Rejected', pending: 'Pending', under_review: 'Under Review', return_rejected: 'Return Rejected', item_awaited: 'Item Awaited', item_received: 'Item Received', wallet_credited: 'Wallet Credited', completed: 'Completed', posted: 'Posted', unverified: 'Not verified', scanned_clean: 'Scanned clean', quarantined: 'Quarantined', active: 'Active', suspended: 'Suspended' }[s] || s);
export const statusTag = (s) => { const c = /rejected|cancel|quarantined|suspended/.test(s) ? 'red' : /verified|confirmed|delivered|completed|credited|clean|active|posted/.test(s) ? 'green' : /shipped|processing|approved|received/.test(s) ? 'cyan' : /pending|submitted|under|requested|awaited|unverified/.test(s) ? 'orange' : 'gray';
  return `<span class="tag ${c}">${esc(statusLabel(s))}</span>`; };
export function reveal() { if (!('IntersectionObserver' in window)) { $$('.reveal').forEach((e) => e.classList.add('in')); return; }
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { threshold: .08 }); $$('.reveal:not(.in)').forEach((e) => io.observe(e)); }
