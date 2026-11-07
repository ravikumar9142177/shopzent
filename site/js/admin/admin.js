// SHOPZENT Admin Panel. Every action here is ALSO enforced by the database (RLS + admin functions that require
// an admin role AND a 2FA-verified (aal2) session). Hiding a button is never the security boundary.
import { api, DEMO, config } from '../api.js';
import { $, $$, esc, inr, num, param, toast, modal, confirmBox, errText, fmtDate, uuid, checkFile, waLink, statusTag, statusLabel, safeUrl, slugify, sanitizeHtml } from '../util.js';
import { href, media, IC } from '../layout.js';
import { enrollMfa } from '../pages/account.js';
const MOD = document.body.dataset.module;
const NAV = [['Dashboard & orders', [['dashboard', '📊', 'Dashboard'], ['visitors', '👀', 'Visitors & users'], ['sales', '💰', 'Sales / Orders amount'], ['orders', '📦', 'Orders'], ['returns', '↩️', 'Returns & refunds']]],
  ['Shop', [['products', '🛍️', 'Products'], ['content', '🗂️', 'Categories & brands']]],
  ['Money & coins', [['payments', '💳', 'Payment verification'], ['coupons', '🎟️', 'Coupons'], ['wallet', '👛', 'Customer wallets'], ['coins', '🪙', 'Coins'], ['cointransfers', '🔁', 'Coin transfer requests'], ['referrals', '🔗', 'Share rewards'], ['game-winners', '🏆', 'Game winners']]],
  ['Content', [['festival', '🪔', 'Festival Studio'], ['videos', '🎬', 'Videos'], ['apps', '📲', 'Apps & APKs'], ['ads', '📣', 'Advertisements']]],
  ['Settings & security', [['settings', '⚙️', 'Website settings'], ['domain', '🌐', 'Domain'], ['users', '👥', 'Users'], ['emailcheck', '📧', 'Email check'], ['reviews', '⭐', 'Reviews'], ['messages', '✉️', 'Messages'], ['security', '🛡️', 'Security & audit'], ['alerts', '🚨', 'Hacker alerts']]]];
let ME = null, FACTOR = null;
const DEMO_ADMIN_EMAIL = String(window.SHOPZENT_CONFIG?.DEMO_ADMIN?.email || '').trim().toLowerCase(); // preview mode: the only admin email accepted
const main = () => $('#adm-main');
// ---------- gate ----------
async function gate() {
  const s = await api.auth.session(); if (!s) return false; ME = await api.auth.profile();
  if (!ME || !['admin', 'super_admin'].includes(ME.role) || ME.status !== 'active') return false;
  if (DEMO && String(ME.email || '').toLowerCase() !== DEMO_ADMIN_EMAIL) return false;
  const st = await api.auth.mfaState(); return st.current === 'aal2';
}
export async function loginPage() {
  const box = $('#main');
  const render = (html) => { box.innerHTML = `<div class="auth-wrap"><div class="auth-card"><div class="logo-c"><img src="../assets/logo-lockup.png" alt="SHOPZENT"></div><h1 class="center" style="font-size:1.3rem">Admin sign in</h1>${html}</div></div>`; };
  if (await gate()) { location.replace('dashboard.html'); return; }
  const step2 = async () => { ME = await api.auth.profile();
    if (!ME || !['admin', 'super_admin'].includes(ME.role) || (DEMO && String(ME.email || '').toLowerCase() !== DEMO_ADMIN_EMAIL)) { if (ME && !DEMO) { try { await api.rpc('log_security_event', { p_kind: 'admin_ui_denied', p_target: 'admin login', p_details: { page: location.pathname } }); } catch { /* */ } } await api.auth.signOut(); render('<div class="alert bad">This account does not have admin access.</div><a class="btn block" href="index.html">Try again</a>'); return; }
    if (ME.status !== 'active') { await api.auth.signOut(); render('<div class="alert bad">This admin account is suspended.</div>'); return; }
    const factors = (await api.auth.factors()).filter((f) => f.status === 'verified');
    if (!factors.length) { render(`<div class="alert warn"><b>2-step verification is required for admins.</b> Set up an authenticator app now to continue.</div><button class="btn block" id="en">Set up authenticator</button>`); $('#en').onclick = () => enrollMfa(async () => { await done(); }); return; }
    FACTOR = factors[0].id;
    render(`<div class="alert">🔐 Enter the 6-digit code from your authenticator app.</div>${DEMO ? '<div class="alert warn small">Demo mode: enter any 6 digits.</div>' : ''}<form id="mf"><div class="field"><label for="otp">Authenticator code</label><input id="otp" inputmode="numeric" maxlength="6" autocomplete="one-time-code" required></div><p class="err" id="me"></p><button class="btn block">Verify & enter</button></form><p class="small center" style="margin-top:12px"><a href="../login.html?mfa=1">Lost your phone? Use a recovery code</a></p>`);
    $('#otp').focus(); $('#mf').onsubmit = async (e) => { e.preventDefault(); try { await api.auth.verify(FACTOR, $('#otp').value.trim()); await done(); } catch (x) { $('#me').textContent = x.message; } }; };
  const done = async () => { try { await api.rpc('log_auth_event', { p_action: 'admin_login_success', p_details: {} }); } catch {} location.replace(param('next') && /^[\w-]+\.html$/.test(param('next')) ? param('next') : 'dashboard.html'); };
  const s = await api.auth.session(); if (s) { await step2(); return; }
  render(`${DEMO ? '<div class="alert warn small">Preview mode: the admin panel runs on demo data in this browser only.</div>' : ''}<form id="lf"><div class="field"><label for="em">Admin email</label><input id="em" type="email" autocomplete="username" required></div><div class="field"><label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" required></div><p class="err" id="le"></p><button class="btn block" id="lb">Continue</button></form>${window.SHOPZENT_CONFIG?.GOOGLE_LOGIN === false ? '' : `<div class="or-sep small muted center" style="margin:14px 0">or</div><button class="btn sec block" id="gg" type="button"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true" style="vertical-align:-3px;margin-right:6px"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/></svg>Continue with Google</button>${DEMO ? '<p class="tiny muted center" id="gg-note" style="margin-top:6px">Google login works after the real database is connected.</p>' : ''}`}<p class="tiny muted center" style="margin-top:12px">Only authorised administrators. 2-step verification is required after sign-in. All sign-ins are logged.</p>`);
  $('#gg')?.addEventListener('click', async () => { $('#le').textContent = '';
    if (DEMO || !api.auth.signInWithGoogle) { $('#le').textContent = 'Google login works after the real database is connected (see SETUP.md → Google login). For now use email + password.'; return; }
    try { await api.auth.signInWithGoogle('admin/index.html'); } catch (x) { $('#le').textContent = errText(x); } });
  if (param('email')) $('#em').value = String(param('email')).slice(0, 120);
  $('#lf').onsubmit = async (e) => { e.preventDefault(); $('#lb').disabled = true; $('#le').textContent = ''; $('#lb').textContent = 'Checking…'; try { const em = $('#em').value.trim().toLowerCase();
      if (DEMO && em !== DEMO_ADMIN_EMAIL) { await new Promise((r) => setTimeout(r, 700)); throw new Error('invalid_credentials'); } // preview: only the owner's admin email
      await api.auth.signIn(em, $('#pw').value); await step2(); } catch (x) { $('#le').textContent = x.message === 'rate_limited' ? 'Too many attempts. Wait a minute.' : errText(x); $('#lb').disabled = false; $('#lb').textContent = 'Continue'; } };
}
// ---------- shell ----------
function shell() {
  document.body.classList.add('admin');
  document.body.innerHTML = `${DEMO ? '<div class="demo-bar">👀 <b>Preview mode</b> — admin panel running on demo data in this browser only.</div>' : ''}<div class="adm"><aside class="adm-side" id="side"><a href="dashboard.html" style="padding:6px 8px 12px"><img src="../assets/logo-lockup.png" alt="SHOPZENT" style="height:36px"></a>
    ${NAV.flatMap((n) => n[1]).map(([k, i, l]) => `<a href="${k}.html" class="${k === MOD ? 'active' : ''}"><span aria-hidden="true">${i}</span>${l}</a>`).join('')}
    <h5>Account</h5><a href="../index.html" target="_blank">🌐 View website</a><a href="../profile.html#security">🔐 My 2FA & recovery codes</a><a href="#" id="lo">🚪 Log out (sirf is device se)</a><a href="#" id="lo-all">🚪 Sabhi devices se log out</a></aside><div class="shade-adm" id="shade"></div>
    <div><div class="adm-top"><button class="icon-btn" id="sb" style="display:grid" aria-label="Menu">${IC.menu}</button><b class="grow">${esc(NAV.flatMap((n) => n[1]).find((x) => x[0] === MOD)?.[2] || 'Admin')}</b><a class="tag" id="site-pill" href="dashboard.html" style="display:none"></a><a class="icon-btn" href="dashboard.html#notifications" aria-label="Notifications">${IC.bell}<span class="badge" id="nb"></span></a><span class="tag ${ME.role === 'super_admin' ? 'pink' : ''}">${esc(ME.role.replace('_', ' '))}</span></div>
    <main class="adm-main" id="adm-main"><div class="sk" style="height:200px"></div></main></div></div>`;
  const side = $('#side'), shade = $('#shade');
  side.querySelectorAll('[data-ag]').forEach((b) => b.onclick = () => { const wasOpen = b.parentElement.classList.contains('open'); side.querySelectorAll('.adm-ag').forEach((x) => { x.classList.remove('open'); x.querySelector('[data-ag]').setAttribute('aria-expanded', 'false'); }); if (!wasOpen) { b.parentElement.classList.add('open'); b.setAttribute('aria-expanded', 'true'); } }); // one group open at a time
  $('#sb').onclick = () => { side.classList.add('open'); shade.classList.add('open'); }; shade.onclick = () => { side.classList.remove('open'); shade.classList.remove('open'); };
  if (matchMedia('(min-width:1000px)').matches) $('#sb').style.display = 'none';
  $('#lo').onclick = async (e) => { e.preventDefault(); await api.auth.signOut(); location.href = 'index.html'; };
  $('#lo-all').onclick = async (e) => { e.preventDefault(); if (!await confirmBox('Sabhi devices se log out?', 'Aapke saare phones/computers se admin login ek saath band ho jayega.', { ok: 'Sab se log out', danger: true })) return; try { await api.rpc('log_auth_event', { p_action: 'logout_all', p_details: {} }); } catch {} await api.auth.signOut(true); location.href = 'index.html'; };
  api.rpc('admin_site_status').then((s) => { const p = $('#site-pill'); if (!p) return; p.style.display = ''; p.className = 'tag ' + (s.published ? 'green' : 'red'); p.textContent = s.published ? '● LIVE' : '● CLOSED'; }).catch(() => {});
  api.rpc('admin_security_alert_counts').then((c) => { const a = document.querySelector('.adm-side a[href="alerts.html"]'); if (a && c.new_total) a.insertAdjacentHTML('beforeend', `<span class="tag ${c.new_high ? 'red' : 'pink'}" style="margin-left:auto">${c.new_total}</span>`); }).catch(() => {});
  api.rpc('admin_game_pending_count').then((n) => { const a = document.querySelector('.adm-side a[href="game-winners.html"]'); if (a && n) a.insertAdjacentHTML('beforeend', `<span class="tag pink" style="margin-left:auto">${n}</span>`); }).catch(() => {});
  api.rpc('admin_notifications').then((n) => { const u = n.filter((x) => !x.read_at).length; $('#nb').textContent = u || ''; $('#nb').dataset.n = u; }).catch(() => {});
  api.rpc('admin_coin_transfer_pending_count').then((n) => { const a = document.querySelector('.adm-side a[href="cointransfers.html"]'); if (a && Number(n) > 0) a.insertAdjacentHTML('beforeend', `<span class="tag pink" style="margin-left:auto">${Number(n)}</span>`); }).catch(() => {});
}
// ---------- helpers ----------
const ik = () => uuid();
async function call(name, args, { fresh = false } = {}) {
  try { return await api.rpc(name, args); }
  catch (x) { if (/fresh_auth_required/.test(x.message)) { const ok = await reauth(); if (ok) return api.rpc(name, args); throw x; } throw x; }
}
function reauth() { return new Promise(async (res) => { const f = (await api.auth.factors()).find((x) => x.status === 'verified');
  modal(`<h3>Confirm it's you</h3><p class="small muted">This is a sensitive action (money, permissions, payments or security). Enter a fresh code from your authenticator app.</p>${DEMO ? '<div class="alert warn small">Demo mode: enter any 6 digits.</div>' : ''}<div class="field"><input id="ra" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6-digit code"></div><p class="err" id="rae"></p><div class="row" style="justify-content:flex-end"><button class="btn sec sm" data-close>Cancel</button><button class="btn sm" id="rab">Confirm</button></div>`,
    { onOpen: (el, close) => { el.querySelector('[data-close]').onclick = () => { close(); res(false); }; el.querySelector('#rab').onclick = async () => { try { await api.auth.verify(f.id, el.querySelector('#ra').value.trim()); close(); res(true); } catch (x) { el.querySelector('#rae').textContent = x.message; } }; } }); }); }
const ok = (m) => toast(m, 'ok'); const bad = (x) => toast(errText(x), 'bad');
const csv = (rows, name) => { if (!rows.length) return toast('Nothing to export'); const cols = Object.keys(rows[0]); const q = (v) => `"${String(typeof v === 'object' && v !== null ? JSON.stringify(v) : v ?? '').replace(/"/g, '""')}"`;
  const blob = new Blob([cols.join(',') + '\n' + rows.map((r) => cols.map((c) => q(r[c])).join(',')).join('\n')], { type: 'text/csv' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${name}-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); };
const jsonExport = (data, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); a.download = `${name}-${new Date().toISOString().slice(0, 10)}.json`; a.click(); };
const head = (title, actions = '') => `<div class="row between" style="margin-bottom:14px"><h1 style="margin:0">${esc(title)}</h1><div class="row">${actions}</div></div>`;
const tbl = (cols, rows, empty = 'Nothing here yet.') => rows.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr>${cols.map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>` : `<div class="card pad empty">${esc(empty)}</div>`;
async function uploadImage(input, folder) { const f = input.files[0]; if (!f) return null; await checkFile(f, ['png', 'jpg', 'webp', 'gif'], 8); const r = await api.upload('public-media', f, folder); return r.url; }

// Readable save/upload errors (the DB's own reason, in plain words; no SQL internals)
const rnd4 = () => Math.random().toString(36).slice(2, 6);
function saveErr(x, fields = []) { const m = String(x?.message || x?.code_text || ''); const code = x?.code || '';
  const lab = (col) => { const f = fields.find((ff) => ff.k === col); return f ? `“${f.label.replace(/\s*\(.*$/, '')}”` : 'One of the fields'; };
  const SPECIAL = { products_direct_needs_price: 'Please add a price (or choose “Affiliate product” and paste the buy link).', products_affiliate_needs_url: 'Affiliate products need the buy link (https://…).', coupons_code_check: 'Coupon code: 3–32 capital letters, digits, - or _ (no spaces).', coupons_percent_max: 'A percentage discount cannot be more than 100%.' };
  let r = m.match(/violates check constraint "([\w]+)"/); if (r) { const c = r[1]; if (SPECIAL[c]) return 'Could not save: ' + SPECIAL[c]; const f = fields.find((ff) => c.includes('_' + ff.k + '_check')); if (/slug/.test(c)) return 'Could not save: the URL slug can only use a–z, 0–9 and dashes.'; if (f && /url|image/.test(f.k)) return `Could not save: ${lab(f.k)} must be a full https:// link (or leave it empty).`; return `Could not save: ${f ? lab(f.k) : 'one of the fields'} has a value that is not allowed.`; }
  r = m.match(/null value in column "(\w+)"/); if (r) return `Could not save: ${lab(r[1])} is required.`;
  r = m.match(/unique constraint "(\w+)"/); if (r || code === '23505') { const c = r ? r[1] : ''; return 'Could not save: ' + (/slug/.test(c) ? 'this URL slug is already used by another item. Change the slug (or leave it blank).' : /code/.test(c) ? 'this code is already used. Choose a different one.' : 'an item with the same details already exists.'); }
  if (/row-level security|permission denied|not_authorized|mfa_required|42501/i.test(m + code)) return 'Not allowed: your admin session has expired or needs the authenticator code. Please log out and log in again.';
  if (/invalid input syntax|out of range|too long/i.test(m)) return 'Could not save: one of the fields has an invalid value (check numbers and dates).';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Could not save: no internet connection. Please try again.';
  const t = errText(x); return t.startsWith('Something went wrong') ? 'Could not save: ' + (m && m.length < 160 ? m : 'please try again.') : t; }
function upErr(x) { const m = String(x?.message || x || '');
  const why = /row-level|policy|unauthori|403|jwt/i.test(m) ? 'not allowed. Please log out and log in again.' : /bucket not found/i.test(m) ? 'the image storage bucket is missing.' : /size|too large|exceed/i.test(m) ? 'the file is too large.' : /mime|type|allowed/i.test(m) ? (m.length < 120 ? m : 'this file type is not allowed.') : /fetch|network/i.test(m) ? 'no internet connection.' : (m && m.length < 120 ? m : 'please try again.');
  return 'Image upload failed: ' + why; }

// ---------- generic CRUD (fields schema) ----------
// field: {k, label, type: text|textarea|number|money|select|bool|datetime|url|image|images|kv|html|multi, opts, req, hint, full, show:(row)=>bool}

// ----- sizes (fashion) -----
const SZ_PRESET_LIST = [['XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL'], ['26', '28', '30', '32', '34', '36', '38', '40', '42', '44'], ['0-3m', '3-6m', '6-12m', '1-2y', '2-3y', '3-4y', '4-5y', '6-7y', '8-9y', '10-12y'], ['75', '80', '85', '90', '95', '100'], ['Free Size']];
const SZ_PRESET_NAMES = ['Letter (XS–XXXL)', 'Pant / waist (26–44)', 'Kids age (0-3m … 10-12y)', 'Innerwear (75–100 cm)', 'Free size'];
const szRow = (label, stock) => `<div class="sz-row" data-label="${esc(label)}" style="display:flex;gap:6px;align-items:center;padding:6px 0;border-bottom:1px solid var(--line)"><b style="min-width:70px">${esc(label)}</b><input type="number" min="0" step="1" class="sz-stock" placeholder="stock (blank = unlimited)" value="${stock ?? ''}" style="flex:1;min-width:0"><button type="button" class="btn xs ghost" data-rmsz>✕</button></div>`;
function sizesEditorHtml(f, v) { const id = 'f_' + f.k;
  return `<div class="row" style="gap:6px;flex-wrap:wrap">${SZ_PRESET_NAMES.map((n, i) => `<button type="button" class="btn xs sec" data-preset="${i}">+ ${esc(n)}</button>`).join('')}</div>
  <div class="row" style="gap:6px;margin:8px 0"><input id="${id}_new" placeholder="Apna size (jaise 42, Free, 5-6y)" maxlength="30" style="flex:1;min-width:0"><button type="button" class="btn xs" id="${id}_addn">+ Add</button></div>
  <div id="${id}_list">${(Array.isArray(v) ? v : []).map((o) => szRow(o.label, o.stock)).join('')}</div>`; }
function fieldHtml(f, v) { const id = 'f_' + f.k; const req = f.req ? 'required' : ''; const lbl = `<label for="${id}">${esc(f.label)}${f.req ? ' *' : ''}</label>`; const hint = f.hint ? `<span class="hint">${f.hint}</span>` : '';
  const wrap = (inner) => `<div class="field ${f.full ? 'full' : ''}" data-fk="${f.k}">${lbl}${inner}${hint}</div>`;
  switch (f.type) {
    case 'textarea': return wrap(`<textarea id="${id}" maxlength="${f.max || 5000}" ${req}>${esc(v ?? '')}</textarea>`);
    case 'html': return wrap(`<textarea id="${id}" style="min-height:200px;font-family:monospace;font-size:.82rem" maxlength="50000">${esc(v ?? '')}</textarea>`);
    case 'number': case 'money': return wrap(`<input id="${id}" type="number" step="${f.type === 'money' ? '0.01' : f.step || '1'}" min="${f.min ?? 0}" ${f.maxv ? `max="${f.maxv}"` : ''} value="${v ?? ''}" ${req}>`);
    case 'select': return wrap(`<select id="${id}" ${req}>${f.opts.map(([o, l]) => `<option value="${esc(o)}" ${String(v ?? f.def ?? '') === String(o) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`);
    case 'bool': return `<div class="field ${f.full ? 'full' : ''}" data-fk="${f.k}"><label class="row" style="gap:8px;font-weight:600"><input type="checkbox" id="${id}" ${v ?? f.def ? 'checked' : ''}> ${esc(f.label)}</label>${hint}</div>`;
    case 'datetime': return wrap(`<input id="${id}" type="datetime-local" value="${v ? new Date(new Date(v).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : ''}">`);
    case 'image': return wrap(`<div class="row" style="flex-wrap:nowrap">${v ? `<img src="${esc(media(v))}" alt="" style="width:56px;height:56px;object-fit:cover;border-radius:10px" id="${id}_p">` : `<span id="${id}_p"></span>`}<input id="${id}_file" type="file" accept="image/png,image/jpeg,image/webp,image/gif"></div><input id="${id}" type="text" placeholder="or paste an https:// image URL" value="${esc(v ?? '')}" style="margin-top:6px">`);
    case 'images': return wrap(`<div class="img-list" id="${id}_list">${(v || []).map((u) => `<figure data-u="${esc(u)}"><img src="${esc(media(u))}" alt=""><button type="button" data-rmimg>✕</button></figure>`).join('')}</div><input id="${id}_file" type="file" accept="image/png,image/jpeg,image/webp" multiple style="margin-top:6px"><input id="${id}_url" type="text" placeholder="or paste an https:// image URL and press Enter" style="margin-top:6px">`);
    case 'kv': return wrap(`<div id="${id}_kv">${Object.entries(v || {}).map(([a, b]) => kvRow(a, b)).join('')}</div><button type="button" class="btn xs sec" id="${id}_add">+ Add row</button>`);
    case 'sizes': return wrap(sizesEditorHtml(f, v));
    case 'multi': return wrap(`<select id="${id}" multiple size="5">${f.opts.map(([o, l]) => `<option value="${esc(o)}" ${(v || []).includes(o) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`);
    default: return wrap(`<input id="${id}" type="${f.type === 'url' ? 'url' : 'text'}" maxlength="${f.max || 300}" value="${esc(v ?? '')}" ${req} ${f.ph ? `placeholder="${esc(f.ph)}"` : ''}>`);
  } }
const kvRow = (a = '', b = '') => `<div class="kv-row"><input placeholder="Name" value="${esc(a)}" maxlength="60"><input placeholder="Value" value="${esc(b)}" maxlength="300"><button type="button" class="btn xs ghost" data-rmkv>✕</button></div>`;
function bindFields(el, fields, folder) {
  fields.forEach((f) => { const id = 'f_' + f.k;
    if (f.type === 'image') el.querySelector(`#${id}_file`).onchange = async (e) => { try { const u = await uploadImage(e.target, folder); if (u) { el.querySelector('#' + id).value = u; el.querySelector(`#${id}_p`).outerHTML = `<img src="${esc(media(u))}" id="${id}_p" style="width:56px;height:56px;object-fit:cover;border-radius:10px">`; ok('Image uploaded'); } } catch (x) { toast(upErr(x), 'bad'); } };
    if (f.type === 'images') { const list = el.querySelector(`#${id}_list`); const addU = (u) => list.insertAdjacentHTML('beforeend', `<figure data-u="${esc(u)}"><img src="${esc(media(u))}" alt=""><button type="button" data-rmimg>✕</button></figure>`);
      el.querySelector(`#${id}_file`).onchange = async (e) => { for (const file of [...e.target.files].slice(0, 8)) { try { await checkFile(file, ['png', 'jpg', 'webp'], 8); const r = await api.upload('public-media', file, folder); addU(r.url); } catch (x) { toast(upErr(x), 'bad'); } } e.target.value = ''; };
      el.querySelector(`#${id}_url`).onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); const u = safeUrl(e.target.value, false); if (u) { addU(u); e.target.value = ''; } else toast('Use an https:// URL', 'bad'); } };
      list.onclick = (e) => { if (e.target.dataset.rmimg !== undefined) e.target.closest('figure').remove(); }; }
    if (f.type === 'sizes') { const list = el.querySelector(`#${id}_list`); const has = (lab) => [...list.querySelectorAll('.sz-row')].some((r) => r.dataset.label.toLowerCase() === lab.toLowerCase());
      const add = (lab) => { lab = String(lab || '').trim().slice(0, 30); if (lab && !has(lab)) list.insertAdjacentHTML('beforeend', szRow(lab, '')); };
      el.querySelectorAll(`[data-fk="${f.k}"] [data-preset]`).forEach((b) => { b.onclick = () => SZ_PRESET_LIST[+b.dataset.preset].forEach(add); });
      el.querySelector(`#${id}_addn`).onclick = () => { const x = el.querySelector(`#${id}_new`); add(x.value); x.value = ''; };
      el.querySelector(`#${id}_new`).onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); el.querySelector(`#${id}_addn`).click(); } };
      list.onclick = (e) => { if (e.target.dataset.rmsz !== undefined) e.target.closest('.sz-row').remove(); }; }
    if (f.type === 'kv') { const box = el.querySelector(`#${id}_kv`); el.querySelector(`#${id}_add`).onclick = () => box.insertAdjacentHTML('beforeend', kvRow()); box.onclick = (e) => { if (e.target.dataset.rmkv !== undefined) e.target.closest('.kv-row').remove(); }; }
  });
  const sync = () => fields.forEach((f) => { if (f.show) { const w = el.querySelector(`[data-fk="${f.k}"]`); if (w) w.style.display = f.show(readFields(el, fields, true)) ? '' : 'none'; } });
  el.addEventListener('change', sync); sync();
  // quick add: "➕ Naya brand" right under the Brand choice
  const brSel = el.querySelector('#f_brand_id');
  if (brSel && !el.querySelector('#szbr-add')) { brSel.insertAdjacentHTML('afterend', '<div style="margin-top:6px"><button type="button" class="btn xs sec" id="szbr-add">➕ Naya brand add karo</button><div id="szbr-box" style="display:none;margin-top:6px"><input id="szbr-name" maxlength="60" placeholder="Brand ka naam, jaise: boAt" style="max-width:260px"> <button type="button" class="btn xs" id="szbr-save">Save</button></div></div>');
    const bx = el.querySelector('#szbr-box'); el.querySelector('#szbr-add').onclick = () => { bx.style.display = bx.style.display === 'none' ? '' : 'none'; el.querySelector('#szbr-name').focus(); };
    el.querySelector('#szbr-save').onclick = async () => { const nm = el.querySelector('#szbr-name').value.trim(); if (nm.length < 2) return bad(new Error('Brand ka naam likho.'));
      try { const row = await api.insert('brands', { name: nm, slug: (slugify(nm) || 'brand') + '-' + rnd4(), published: true, sort: 0 }); const o = document.createElement('option'); o.value = row.id; o.textContent = row.name; brSel.appendChild(o); brSel.value = row.id; el.querySelector('#szbr-name').value = ''; bx.style.display = 'none'; ok('Brand add ho gaya ✓'); } catch (x) { bad(x); } }; }
  // a new category choice sets the Sizes toggle to that category's default (the admin can still change it per product)
  const catSel = el.querySelector('#f_category_id'), sw = el.querySelector('#f_sizes_enabled');
  if (catSel && sw) catSel.addEventListener('change', () => { const c = (window.__szCats || []).find((x) => x.id === catSel.value); if (c) { sw.checked = !!c.has_sizes; sync(); } });
}
function readFields(el, fields, loose = false) { const o = {};
  for (const f of fields) { const n = el.querySelector('#f_' + f.k);
    if (f.type === 'bool') o[f.k] = !!n?.checked;
    else if (f.type === 'number' || f.type === 'money') o[f.k] = n.value === '' ? null : Number(n.value);
    else if (f.type === 'datetime') o[f.k] = n.value ? new Date(n.value).toISOString() : null;
    else if (f.type === 'images') o[f.k] = [...el.querySelectorAll(`#f_${f.k}_list figure`)].map((x) => x.dataset.u);
    else if (f.type === 'kv') { o[f.k] = {}; el.querySelectorAll(`#f_${f.k}_kv .kv-row`).forEach((r) => { const [a, b] = r.querySelectorAll('input'); if (a.value.trim()) o[f.k][a.value.trim()] = b.value.trim(); }); }
    else if (f.type === 'multi') o[f.k] = [...n.selectedOptions].map((x) => x.value);
    else if (f.type === 'sizes') { o[f.k] = [...el.querySelectorAll(`#f_${f.k}_list .sz-row`)].map((r) => { const s = r.querySelector('.sz-stock').value.trim(); return { label: r.dataset.label, stock: s === '' ? null : Math.max(0, Math.floor(Number(s))) }; }); if (!loose && o.sizes_enabled === true && !o[f.k].length) throw new Error('Sizes ON hain to kam se kam ek size chuniye (Add at least one size).'); }
    else { o[f.k] = n ? n.value.trim() : null; if (o[f.k] === '' && (f.type === 'url' || f.type === 'image' || f.type === 'select')) o[f.k] = null; } // blank link/image/choice = none (NULL), never ""
    if (!loose && f.req && (o[f.k] === null || o[f.k] === '')) throw new Error(`“${f.label}” is required.`);
    if (!loose && (f.type === 'url' || f.type === 'image') && o[f.k] && !/^data:image\//.test(o[f.k]) && !safeUrl(o[f.k], f.type === 'image')) throw new Error(`“${f.label}” must be an https:// link.`);
  } return o; }
function formModal(title, fields, row, onSave, folder = 'misc') {
  modal(`<div class="row between"><h3 style="margin:0">${esc(title)}</h3><button class="btn ghost sm" data-close aria-label="Close">✕</button></div><form id="fm" novalidate style="margin-top:12px"><div class="form-grid">${fields.map((f) => fieldHtml(f, row?.[f.k])).join('')}</div><p class="err" id="fe"></p><div class="row" style="justify-content:flex-end"><button type="button" class="btn sec sm" data-close>Cancel</button><button class="btn sm" id="fs">Save</button></div></form>`,
    { wide: true, onOpen: (el, close) => { bindFields(el, fields, folder); el.querySelector('#fm').onsubmit = async (e) => { e.preventDefault(); const b = el.querySelector('#fs'); try { const data = readFields(el, fields); b.disabled = true; await onSave(data); close(); } catch (x) { el.querySelector('#fe').textContent = saveErr(x, fields); b.disabled = false; } }; } });
}
async function crud({ table, title, fields, cols, render, order = { col: 'created_at', asc: false }, folder, before = (d) => d, after, search, groupBy }) {
  const R = main(); let ROWS = [];
  const draw = async () => { const q = R.querySelector('.cq')?.value || ''; const rows = await api.select(table, { order, limit: 1000, ...(q && search ? { search: { text: q, cols: search } } : {}) });
    const rowHtml = (r) => `<tr>${render(r)}<td><div class="row"><button class="btn xs sec" data-ed="${esc(r.id)}">Edit</button><button class="btn xs ghost" data-del="${esc(r.id)}" aria-label="Delete">🗑️</button></div></td></tr>`;
    if (groupBy) { const gs = groupBy(rows); const qv = R.querySelector('.cq')?.value || ''; const selG = (!qv && window.__szSel != null) ? gs.find((g) => g.label === window.__szSel) : null;
      if (qv) { R.querySelector('.ct').innerHTML = `<p class="small muted" style="margin:0 0 8px">Search result: ${rows.length} product</p>` + tbl([...cols, ''], rows.map(rowHtml), 'Kuch nahi mila.'); }
      else if (selG) { R.querySelector('.ct').innerHTML = `<div class="row" style="gap:10px;align-items:center;margin-bottom:12px"><button class="btn sm sec" id="sz-back">← Saare sections</button><b style="font-size:1.1rem">${esc(selG.label)}</b><span class="tag gray">${selG.rows.length} products</span></div>` + tbl([...cols, ''], selG.rows.map(rowHtml), 'Is section me abhi koi product nahi.'); R.querySelector('#sz-back').onclick = () => { window.__szSel = null; draw(); }; }
      else { R.querySelector('.ct').innerHTML = `<p class="small muted" style="margin:0 0 10px">Section par tap karo, uske saare products khulenge. Total ${rows.length} products.</p><div class="szsec-grid">${gs.map((g, ix) => { const live = g.rows.filter((r) => r.published).length; const im0 = (g.rows.find((r) => (r.images || [])[0]) || {}).images; return `<button type="button" class="szsec" data-ix="${ix}"><span class="szsec-ic">${im0 && im0[0] ? `<img src="${esc(media(im0[0]))}" alt="" loading="lazy">` : ''}</span><b>${esc(g.label)}</b><span class="szsec-n">${g.rows.length} products</span><span class="tiny muted">${live} live${g.rows.length - live ? ' · ' + (g.rows.length - live) + ' hidden' : ''}</span></button>`; }).join('')}</div>`;
        R.querySelectorAll('.szsec').forEach((b) => b.onclick = () => { window.__szSel = gs[Number(b.dataset.ix)].label; draw(); window.scrollTo({ top: 0 }); }); } }
    else R.querySelector('.ct').innerHTML = tbl([...cols, ''], rows.map(rowHtml), 'Nothing here yet — tap “Add new”.');
    R.querySelector('.ct').onclick = async (e) => { const ed = e.target.closest('[data-ed]'), de = e.target.closest('[data-del]'); const tg = e.target.closest('[data-toggle]');
      if (ed) { const r = rows.find((x) => x.id === ed.dataset.ed); formModal('Edit ' + title.toLowerCase(), fields, r, async (d) => { await api.update(table, r.id, before(d, r)); after && await after(r.id, d); ok('Saved ✓'); draw(); }, folder); }
      if (de) { if (!await confirmBox('Delete this item?', 'This cannot be undone. It will be recorded in the audit log.', { ok: 'Delete', danger: true })) return; try { await api.remove(table, de.dataset.del); ok('Deleted'); draw(); } catch (x) { bad(x); } }
      if (tg) { try { await api.update(table, tg.dataset.toggle, { [tg.dataset.col]: tg.dataset.val === '1' }); draw(); } catch (x) { bad(x); } } };
    ROWS = rows; };
  R.innerHTML = head(title, `<button class="btn sm sec cx">Export</button><button class="btn sm cn">+ Add new</button>`) + (search ? `<input class="cq" type="search" placeholder="Search…" style="margin-bottom:12px;max-width:360px">` : '') + '<div class="ct"><div class="sk" style="height:200px"></div></div>';
  R.querySelector('.cn').onclick = () => formModal('Add ' + title.toLowerCase(), fields, null, async (d) => { const r = await api.insert(table, before(d, null)); after && await after(r.id, d); ok('Created ✓'); draw(); }, folder);
  R.querySelector('.cx').onclick = () => jsonExport(ROWS, table); let tt; R.querySelector('.cq')?.addEventListener('input', () => { clearTimeout(tt); tt = setTimeout(draw, 250); });
  await draw();
}
const pubToggle = (r, col = 'published') => `<button class="tag ${r[col] ? 'green' : 'gray'}" style="border:0;cursor:pointer" data-toggle="${esc(r.id)}" data-col="${col}" data-val="${r[col] ? '0' : '1'}" title="Tap to switch">${r[col] ? 'Live' : 'Hidden'}</button>`;

// ---------- modules ----------
const M = {};
M.dashboard = async () => {
  const s = await api.rpc('admin_stats'); const notes = await api.rpc('admin_notifications').catch(() => []);
  const k = (v, l, g) => `<div class="kpi ${g ? 'g' : ''}"><b>${v}</b><span>${l}</span></div>`;
  main().innerHTML = head('Dashboard', '<a class="btn sm" href="payments.html">Verify payments</a>') + `
  <div class="kpis">${k(num(s.payments_pending), 'Payments to verify', true)}${k(num(s.orders_pending), 'Pending orders')}${k(num(s.orders_confirmed), 'Confirmed orders')}${k(num(s.orders_paid), 'Paid orders')}${k(num(s.orders_rejected), 'Rejected orders')}${k(num(s.orders), 'Total orders')}
  ${k(num(s.users), 'Users')}${k(num(s.products_published) + ' / ' + num(s.products), 'Products live / total')}${k(num(s.coupon_redemptions), 'Coupon uses')}${k(inr(s.wallet_liability), 'Wallet liability (store credit)')}${k(num(s.affiliate_clicks), 'Affiliate clicks')}${k(num(s.ad_impressions) + ' / ' + num(s.ad_clicks), 'Ad impressions / clicks')}</div>
  <div class="grid g2" style="margin-top:16px"><div class="card pad" id="notifications"><h3>Notifications</h3>${notes.slice(0, 12).map((n) => `<div style="padding:8px 0;border-bottom:1px solid var(--line)" class="small ${n.read_at ? 'muted' : ''}"><b>${esc(n.title)}</b> — ${esc(n.body)}<div class="tiny muted">${fmtDate(n.created_at)} ${n.read_at ? '' : `<a href="#" data-nr="${esc(n.id)}">mark read</a>`} ${n.link ? `· <a href="${esc(safeUrl(n.link))}">open</a>` : ''}</div></div>`).join('') || '<p class="muted small">No notifications.</p>'}</div>
  <div class="card pad"><h3>Recent activity</h3>${(s.recent || []).map((a) => `<div class="small" style="padding:6px 0;border-bottom:1px solid var(--line)"><code class="tiny">${esc(a.action)}</code> ${esc(a.entity || '')} <span class="tiny muted">· ${esc(a.actor_role || '')} · ${fmtDate(a.created_at)}</span></div>`).join('') || '<p class="muted small">No activity yet.</p>'}</div></div>
  <div class="card pad" style="margin-top:16px"><h3>Coins (internal loyalty points — not money)</h3><p class="small">Issued: <b>${num(s.coins_issued)}</b> · Available in treasury: <b>${num(s.coins_available)}</b> · <a href="coins.html">Manage coins →</a></p></div>`;
  if (!DEMO) { const kp = main().querySelector('.kpis'); if (kp) await siteCard(kp); }
  $$('[data-nr]').forEach((a) => a.onclick = async (e) => { e.preventDefault(); await api.rpc('mark_notification_read', { p_id: a.dataset.nr }).catch(() => {}); a.closest('div').parentElement.classList.add('muted'); a.remove(); });
};
// ----- orders -----
const STATUSES = ['payment_pending', 'payment_submitted', 'under_verification', 'payment_verified', 'payment_rejected', 'order_confirmed', 'processing', 'shipped', 'delivered', 'return_requested', 'return_approved', 'refund_processing', 'refund_completed', 'order_cancelled', 'order_rejected'];
M.orders = async () => {
  main().innerHTML = head('Orders', '<button class="btn sm sec" id="ox">Export CSV</button>') + `<div class="row" style="margin-bottom:12px"><input id="oq" type="search" placeholder="Order ID, Customer ID (SZC-…), mobile or email" style="max-width:380px" value="${esc(param('q') || '')}"><select id="os" style="width:auto"><option value="">All statuses</option>${STATUSES.map((s) => `<option value="${s}">${statusLabel(s)}</option>`).join('')}</select></div><div id="ol"></div>`;
  let rows = [];
  const draw = async () => { rows = await api.rpc('admin_list_orders', { p_q: $('#oq').value.trim() || null, p_status: $('#os').value || null, p_limit: 200, p_offset: 0 });
    $('#ol').innerHTML = tbl(['Order', 'Customer', 'Amount', 'Status', 'Payment', 'Date', ''], rows.map((o) => `<tr><td><b>${esc(o.order_code)}</b><div class="tiny muted">${o.item_count || ''} item(s)</div></td><td>${esc(o.customer_name || '')}<div class="tiny muted">${esc(o.customer_id || '')} · ${esc(o.customer_mobile || o.ship_phone || '')}</div></td><td>${inr(o.total)}</td><td>${statusTag(o.status)}</td><td>${statusTag(o.payment_status)}</td><td class="tiny">${fmtDate(o.created_at)}</td><td><button class="btn xs" data-open="${esc(o.id)}">Open</button></td></tr>`), 'No orders found.');
    $('#ol').onclick = (e) => { const b = e.target.closest('[data-open]'); if (b) orderModal(b.dataset.open, draw); }; };
  $('#oq').oninput = () => { clearTimeout(window.__t); window.__t = setTimeout(draw, 300); }; $('#os').onchange = draw; $('#ox').onclick = () => csv(rows.map(({ latest_submission, ...o }) => o), 'orders');
  await draw(); if (param('id')) orderModal(param('id'), draw);
};

function changePayModal(what, current) { const L = { pending: 'PENDING (check again)', success: 'SUCCESS (money received)', rejected: 'REJECTED' };
  return new Promise((res) => { modal(`<h3>Change payment status</h3><p class="small">${esc(what)}</p><p class="small">Now: <b>${esc(L[current])}</b></p><div class="field"><label for="cp-to">New status</label><select id="cp-to">${Object.keys(L).filter((k) => k !== current).map((k) => `<option value="${k}">${esc(L[k])}</option>`).join('')}</select></div><div class="field"><label for="cp-r">Reason (required, saved in history${current === 'success' ? '' : ''})</label><textarea id="cp-r" maxlength="500"></textarea><div class="err" id="cp-e"></div></div><div class="row" style="justify-content:flex-end"><button class="btn sec sm" data-close>Cancel</button><button class="btn sm danger" id="cp-ok">Change status</button></div>`,
    { onOpen: (el, close) => { el.querySelector('[data-close]').onclick = () => { close(); res(null); }; const sel = el.querySelector('#cp-to'), okb = el.querySelector('#cp-ok'); const lab = () => { okb.textContent = 'Change to ' + sel.value.toUpperCase(); }; sel.onchange = lab; lab();
      okb.onclick = () => { const r = el.querySelector('#cp-r').value.trim(); if (r.length < 3) { el.querySelector('#cp-e').textContent = 'Please write a reason (min 3 characters).'; return; } close(); res({ to: sel.value, reason: r }); }; } }); }); }
async function orderModal(id, refresh) {
  let d; try { d = await api.rpc('admin_order_detail', { p_order_id: id }); } catch (x) { return bad(x); }
  const o = d.order, c = d.customer || {}; const subsSorted = [...d.submissions].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)); const ls = subsSorted[0];
  const pstate = ls ? ({ verified: 'success', rejected: 'rejected' }[ls.status] || 'pending') : null; const PST = { pending: ['PENDING', 'orange'], success: ['SUCCESS ✓', 'green'], rejected: ['REJECTED ✕', 'red'] };
  const next = { payment_verified: ['order_confirmed', 'Confirm order'], order_confirmed: ['processing', 'Mark processing'], processing: ['shipped', 'Mark shipped'], shipped: ['delivered', 'Mark delivered'] }[o.status];
  const closed = ['shipped', 'delivered', 'order_cancelled', 'order_rejected', 'refund_completed', 'refund_processing'].includes(o.status);
  d.paid_amount ??= d.refund_summary?.paid ?? 0; d.refunded_amount ??= d.refund_summary?.refunded ?? 0;
  const refundable = Math.max(0, (d.paid_amount || 0) - (d.refunded_amount || 0));
  const m = modal(`<div class="row between"><h3 style="margin:0">${esc(o.order_code)}</h3><button class="btn ghost sm" data-close>✕</button></div>
    <div class="row" style="margin:8px 0">${statusTag(o.status)} ${statusTag(o.payment_status)}<span class="small muted">${fmtDate(o.created_at)}</span></div>
    <div class="grid g2"><div class="card pad" style="box-shadow:none;border:1px solid var(--line)"><h4>Customer</h4><p class="small">${esc(c.full_name || '')}<br><code>${esc(c.customer_id || '')}</code> · <code>${esc(c.wallet_id || '')}</code><br>${esc(c.email || '')} · ${esc(c.mobile || '')}</p>
      <h4>Ship to</h4><p class="small">${esc(o.ship_name)}, ${esc(o.ship_phone)}<br>${esc(o.ship_line1)} ${esc(o.ship_line2 || '')}<br>${esc(o.ship_city)}, ${esc(o.ship_state)} ${esc(o.ship_pincode)}</p>${o.customer_note ? `<p class="small"><b>Note:</b> ${esc(o.customer_note)}</p>` : ''}
      <a class="btn wa xs" target="_blank" rel="noopener" href="${waLink(o.ship_phone, `Hi ${o.ship_name}, this is SHOPZENT about your order ${o.order_code}.`)}">WhatsApp customer</a></div>
    <div class="card pad" style="box-shadow:none;border:1px solid var(--line)"><h4>Items</h4>${d.items.map((i) => `<div class="small row between" style="flex-wrap:nowrap"><span>${esc(i.product_name)}${i.size ? ' <b>· Size ' + esc(i.size) + '</b>' : ''} × ${i.qty}</span><span>${inr(i.line_total)}</span></div>`).join('')}<hr class="sep"><div class="small">Subtotal ${inr(o.subtotal)} · Product disc. −${inr(o.product_discount)} · Coupon ${esc((o.coupon_codes || []).join(',') || '—')} −${inr(o.coupon_discount)} · Wallet −${inr(o.wallet_used)}</div><div><b>Total to receive by UPI: ${inr(o.total)}</b></div><div class="tiny muted">Paid (verified): ${inr(d.paid_amount)} · Refunded: ${inr(d.refunded_amount)}</div></div></div>
    <h4 style="margin-top:14px">Payment submissions</h4>${d.submissions.map((s) => `<div class="card pad" style="box-shadow:none;border:1px solid var(--line);margin-bottom:8px"><div class="row between">${statusTag(s.status)}<span class="tiny muted">${esc(s.submission_code)} · ${fmtDate(s.created_at)}</span></div><div>UTR: <code style="font-size:1rem">${esc(s.utr_normalized || s.utr)}</code> · Amount expected ${inr(s.amount)}</div>${s.screenshot_path ? `<button class="btn xs sec" data-shot="${esc(s.screenshot_path)}">View screenshot</button>` : '<span class="tiny muted">No screenshot</span>'}${s.admin_notes ? `<div class="tiny muted">Note: ${esc(s.admin_notes)}</div>` : ''}</div>`).join('') || '<p class="small muted">No payment submitted yet.</p>'}
    ${ls ? `<div class="card pad" id="paybox" style="box-shadow:none;border:2px solid var(--line);margin-top:8px"><div class="row between"><b>Payment status</b><span class="tag ${PST[pstate][1]}" id="pstate" style="font-size:.9rem">${PST[pstate][0]}</span></div>
      <div class="small" style="margin:6px 0">${esc(o.order_code)} · ${inr(ls.amount)} · UTR <code>${esc(ls.utr_normalized)}</code></div>
      ${pstate === 'pending' ? `<div class="alert warn small">Check your bank / UPI app: is there a credit of <b>${inr(ls.amount)}</b> with UTR <b>${esc(ls.utr_normalized)}</b>? Only approve if the money has actually arrived. A screenshot is not proof.</div><div class="row"><button class="btn ok sm" data-act="pay-success">✓ Approve (Success)</button><button class="btn danger sm" data-act="pay-reject">✕ Reject</button></div>`
        : `<div class="row"><button class="btn sec sm" data-act="pay-change">Change status</button><span class="tiny muted">Wrong tap? You can correct it with a reason${ME?.role === 'super_admin' ? '' : ' (within 7 days)'}.</span></div>`}
      <h4 style="margin:12px 0 4px">Payment status history</h4><ul class="timeline" id="phist"><li class="tiny muted">Loading…</li></ul></div>` : ''}
    <h4 style="margin-top:14px">Order actions</h4><div class="row">${(o.payment_status === 'verified' && !['delivered', 'order_cancelled', 'order_rejected', 'payment_rejected', 'return_requested', 'return_approved', 'refund_processing', 'refund_completed'].includes(o.status)) ? '<button class="btn sm" data-act="deliv">Delivered ✓ confirm karein</button>' : ''}${next && next[0] !== 'delivered' ? `<button class="btn sm" data-act="next">${next[1]}</button>` : ''}${!closed ? '<button class="btn danger sm" data-act="ro">Reject order</button><button class="btn sec sm" data-act="co">Cancel order</button>' : ''}<button class="btn sec sm" data-act="ed">Edit address / notes</button><button class="btn ghost sm" data-act="note">Add internal note</button>${refundable > 0 ? `<a class="btn sec sm" href="returns.html">Refunds →</a>` : ''}</div>
    ${o.admin_notes ? `<p class="small" style="margin-top:8px"><b>Note to customer:</b> ${esc(o.admin_notes)}</p>` : ''}
    <h4 style="margin-top:14px">History</h4><ul class="timeline">${d.events.map((e) => `<li><b class="small">${esc(statusLabel(e.to_status))}</b> ${e.is_internal ? '<span class="tag gray">internal</span>' : ''}<div class="tiny muted">${fmtDate(e.created_at)} · ${esc(e.actor_role || '')}</div>${e.note ? `<div class="small">${esc(e.note)}</div>` : ''}</li>`).join('')}</ul>`, { wide: true });
  const el = m.el; const reload = async () => { m.close(); await refresh?.(); orderModal(id, refresh); };
  if (ls) api.rpc('admin_payment_history', { p_order_id: o.id }).then((h) => { const L = { pending: 'Pending', success: 'Success', rejected: 'Rejected' }; const box = el.querySelector('#phist'); if (box) box.innerHTML = h.map((x) => `<li><b class="small">${x.from_status ? esc(L[x.from_status]) + ' → ' : ''}${esc(L[x.to_status])}</b><div class="tiny muted">${fmtDate(x.created_at)} · ${esc(x.changed_by_name || x.changed_by_role || '')} · ${esc(x.submission_code || '')}</div>${x.reason ? `<div class="small">${esc(x.reason)}</div>` : ''}</li>`).join('') || '<li class="tiny muted">No changes yet.</li>'; }).catch(() => { const box = el.querySelector('#phist'); if (box) box.innerHTML = '<li class="tiny muted">History not available.</li>'; });
  el.addEventListener('click', async (e) => { const sh = e.target.closest('[data-shot]'); if (sh) { try { const u = await api.signedUrl('payment-proofs', sh.dataset.shot, 120); modal(`<div class="row between"><h3 style="margin:0">Payment screenshot</h3><button class="btn ghost sm" data-close>✕</button></div><p class="tiny muted">Supporting evidence only — confirm the credit in your bank/UPI app.</p>${u ? `<img src="${esc(u)}" alt="Payment screenshot" style="max-height:70vh;margin:0 auto;border-radius:12px">` : '<p>Not available.</p>'}`); } catch (x) { bad(x); } return; }
    const a = e.target.closest('[data-act]')?.dataset.act; if (!a) return;
    try {
      if (a === 'pay-success' || a === 'pay-reject' || a === 'pay-change') { const btn = e.target.closest('[data-act]'); const what = `Order ${o.order_code} · ${inr(ls.amount)} · UTR ${ls.utr_normalized}`; let to, reason;
        if (a === 'pay-success') { if (!await confirmBox('Approve this payment?', `${what}. Only approve if this exact amount with this UTR is in your bank/UPI app.`, { ok: 'Yes, money received' })) return; to = 'success'; reason = 'Verified against bank/UPI records'; }
        if (a === 'pay-reject') { reason = await confirmBox('Reject this payment?', `${what}. The customer will see your reason.`, { ok: 'Reject payment', danger: true, input: 'Reason (customer sees this)' }); if (!reason) return; to = 'rejected'; }
        if (a === 'pay-change') { const r = await changePayModal(what, pstate); if (!r) return; ({ to, reason } = r); }
        btn.disabled = true; try { const res = await call('admin_set_payment_status', { p_submission_id: ls.id, p_to: to, p_reason: reason, p_idempotency_key: ik() }); ok(res?.changed === false ? 'Already ' + to : 'Payment ' + ({ success: 'approved ✓', rejected: 'rejected', pending: 'set back to pending' })[to]); } finally { btn.disabled = false; } }
      if (a === 'next') { let note = ''; if (next[0] === 'shipped') { note = prompt('Courier name & tracking number (shown to customer):', '') || ''; } await call('admin_set_order_status', { p_order_id: o.id, p_status: next[0], p_note: note, p_idempotency_key: ik() }); ok(statusLabel(next[0]) + ' ✓'); }
      if (a === 'ro') { const r = await confirmBox('Reject order', o.payment_status === 'verified' ? 'Payment was received — a refund obligation will be created automatically.' : 'The customer will be notified.', { ok: 'Reject order', danger: true, input: 'Reason shown to customer' }); if (!r) return; await call('admin_reject_order', { p_order_id: o.id, p_reason: r, p_idempotency_key: ik() }); ok('Order rejected'); }
      if (a === 'deliv') { const r = await confirmBox('Mark as delivered?', 'Product customer tak pahunch gaya? Ye confirm karte hi share reward (coins) customer ke wallet me release honge. Note = ticket: kisko, kab, kaise diya.', { ok: 'Yes, delivered', input: 'Ticket note (required): who / when / how' }); if (!r || !String(r).trim()) return; await call('admin_mark_delivered', { p_order_id: o.id, p_note: String(r).trim() }); ok('Delivered ✓'); reload(); return; }
      if (a === 'co') { const r = await confirmBox('Cancel order', 'The customer will be notified.', { ok: 'Cancel order', danger: true, input: 'Reason' }); if (!r) return; await call('admin_cancel_order', { p_order_id: o.id, p_reason: r, p_idempotency_key: ik() }); ok('Order cancelled'); }
      if (a === 'note') { const r = await confirmBox('Internal note', 'Visible to admins only.', { ok: 'Add note', input: 'Note' }); if (!r) return; await call('admin_add_order_note', { p_order_id: o.id, p_note: r }); ok('Note added'); }
      if (a === 'ed') { formModal('Edit order ' + o.order_code, [{ k: 'ship_name', label: 'Name', req: true }, { k: 'ship_phone', label: 'Mobile', req: true }, { k: 'ship_line1', label: 'Address line 1', req: true, full: true }, { k: 'ship_line2', label: 'Address line 2', full: true }, { k: 'ship_city', label: 'City' }, { k: 'ship_state', label: 'State' }, { k: 'ship_pincode', label: 'Pincode' }, { k: 'admin_notes', label: 'Note to customer (the customer CAN see this — use “Add internal note” for private notes)', type: 'textarea', full: true }], o, async (dd) => { await call('admin_update_order', { p_order_id: o.id, p_patch: dd }); ok('Order updated'); reload(); }); return; }
      reload();
    } catch (x) { bad(x); } });
}
// ----- payments -----
M.payments = async () => {
  main().innerHTML = head('Payment verification') + `<div class="alert warn small"><b>Golden rule:</b> verify a payment only after you see the money in your bank / UPI app with the same UTR and amount. Screenshots can be faked. One UTR = one order (duplicates are blocked automatically). WhatsApp messages from customers are not automatic proof either.</div><div class="pill-tabs" id="pt">${[['submitted', 'New'], ['under_verification', 'Under verification'], ['verified', 'Verified'], ['rejected', 'Rejected'], ['', 'All']].map(([v, l], i) => `<button class="chip ${i ? '' : 'active'}" data-ps="${v}">${l}</button>`).join('')}</div><div id="pl"></div>`;
  const draw = async (st) => { const rows = await api.rpc('admin_list_payments', { p_status: st || null });
    $('#pl').innerHTML = tbl(['Submission', 'Order', 'Customer', 'Amount', 'UTR', 'Status', 'When', ''], rows.map((s) => `<tr><td class="tiny"><code>${esc(s.submission_code)}</code></td><td><b>${esc(s.order_code || '')}</b></td><td>${esc(s.customer_name || '')}<div class="tiny muted">${esc(s.customer_id || '')}</div></td><td>${inr(s.amount)}</td><td><code>${esc(s.utr_normalized)}</code>${s.duplicate_attempts ? `<div><span class="tag red">${s.duplicate_attempts} duplicate attempt(s)</span></div>` : ''}</td><td>${statusTag(s.status)}</td><td class="tiny">${fmtDate(s.created_at)}</td><td><button class="btn xs" data-o="${esc(s.order_id)}">Review</button></td></tr>`), 'No payment submissions here.');
    $('#pl').onclick = (e) => { const b = e.target.closest('[data-o]'); if (b) orderModal(b.dataset.o, () => draw(st)); }; };
  $('#pt').onclick = (e) => { const b = e.target.closest('[data-ps]'); if (!b) return; $$('#pt .chip').forEach((c) => c.classList.toggle('active', c === b)); draw(b.dataset.ps); }; draw('submitted');
};
// ----- returns & refunds -----
M.returns = async () => {
  main().innerHTML = head('Returns, cancellations & refunds') + `<div class="alert small">Refund to the customer's <b>original payment method</b> unless they chose and accepted store credit. Every refund is recorded once; the system blocks refunds above the amount actually paid.</div><div id="rl"></div><h2 style="margin-top:22px">Refunds</h2><div id="fl"></div>`;
  const draw = async () => { const [rets, refs] = await Promise.all([api.rpc('admin_list_returns', { p_status: null }), api.rpc('admin_list_refunds')]);
    $('#rl').innerHTML = tbl(['Request', 'Order', 'Customer', 'Reason', 'Wants', 'Status', ''], rets.map((r) => `<tr><td><b>${esc(r.return_code)}</b><div class="tiny muted">${esc(r.kind)} · ${fmtDate(r.created_at)}</div></td><td>${esc(r.order_code)}<div class="tiny muted">${inr(r.order_total)} · ${statusLabel(r.payment_status)}</div></td><td>${esc(r.customer_name || '')}<div class="tiny muted">${esc(r.customer_id || '')}</div></td><td class="small">${esc(r.reason)}${r.description ? `<div class="tiny muted">${esc(r.description)}</div>` : ''}${(r.photos || []).map((p) => `<button class="btn xs ghost" data-ph="${esc(p)}">📷</button>`).join('')}</td><td class="small">${r.refund_preference === 'wallet' ? 'Store credit (accepted)' : 'Original method'}</td><td>${statusTag(r.status)}${r.eligible_amount != null ? `<div class="tiny">Eligible ${inr(r.eligible_amount)}</div>` : ''}<div class="tiny muted">Refunded ${inr(r.refunded_amount || 0)}</div></td><td><button class="btn xs" data-r="${esc(r.id)}">Act</button></td></tr>`), 'No return or cancellation requests.');
    $('#fl').innerHTML = tbl(['Refund', 'Order', 'Amount', 'Method', 'Status', 'Reference', ''], refs.map((f) => `<tr><td class="tiny"><code>${esc(f.refund_ref)}</code><div>${fmtDate(f.created_at)}</div></td><td>${esc(f.order_code || '')}</td><td>${inr(f.amount)}</td><td class="small">${f.method === 'wallet' ? 'Store credit' : 'Original payment'}</td><td>${statusTag(f.status)}</td><td class="tiny">${esc(f.external_reference || '—')}</td><td>${f.status !== 'completed' ? `<button class="btn xs ok" data-fc="${esc(f.id)}">Mark completed</button>` : ''}</td></tr>`), 'No refunds yet.');
    $('#rl').onclick = async (e) => { const ph = e.target.closest('[data-ph]'); if (ph) { const u = await api.signedUrl('return-photos', ph.dataset.ph, 120).catch(() => ''); modal(`<button class="btn ghost sm" data-close style="float:right">✕</button>${u ? `<img src="${esc(u)}" alt="" style="max-height:70vh;margin:0 auto">` : 'Not available'}`); return; }
      const b = e.target.closest('[data-r]'); if (!b) return; const r = rets.find((x) => x.id === b.dataset.r); returnModal(r, draw); };
    $('#fl').onclick = async (e) => { const b = e.target.closest('[data-fc]'); if (!b) return; const ref = prompt('Bank / UPI refund reference number (UTR of your refund transfer):'); if (!ref) return; try { await call('admin_complete_refund', { p_refund_id: b.dataset.fc, p_external_reference: ref.trim(), p_idempotency_key: ik() }); ok('Refund marked completed'); draw(); } catch (x) { bad(x); } }; };
  await draw();
};
function returnModal(r, refresh) {
  const remaining = Math.max(0, (r.payment_status === 'verified' ? r.order_total : 0) - (r.refunded_amount || 0));
  const m = modal(`<div class="row between"><h3 style="margin:0">${esc(r.return_code)} · ${esc(r.order_code)}</h3><button class="btn ghost sm" data-close>✕</button></div><p class="small">${statusTag(r.status)} ${esc(r.kind)} · ${esc(r.reason)}</p>${r.kind === 'return' ? `<div class="alert small">Return charge ${inr(r.return_fee != null && r.status !== 'return_requested' && r.status !== 'under_review' ? r.return_fee : 50)} (double delivery) is cut from the refund when you Approve. After approving you get a notice to send the remaining amount to the customer (rupees from Wallets, coins from Coins).</div>` : ''}
    <h4>Review</h4><div class="row"><button class="btn sec sm" data-a="under_review">Under review</button><button class="btn ok sm" data-a="approve">Approve</button><button class="btn danger sm" data-a="reject">Reject (with reason)</button>${r.kind === 'return' ? '<button class="btn sec sm" data-a="item_awaited">Item awaited</button><button class="btn sec sm" data-a="item_received">Item received</button>' : ''}</div>
    <div class="field" style="margin-top:10px"><label>Eligible refund amount (max ${inr(remaining)})</label><input id="ea" type="number" step="0.01" min="0" max="${remaining}" value="${r.eligible_amount ?? ''}"></div><div class="field"><label>Internal note</label><input id="en" maxlength="500"></div>
    <hr class="sep"><h4>Issue refund</h4>${remaining <= 0 ? '<p class="small muted">Nothing refundable (no verified payment, or already fully refunded).</p>' : `<div class="form-grid"><div class="field"><label>Amount</label><input id="ra" type="number" step="0.01" min="1" max="${remaining}" value="${r.eligible_amount ?? remaining}"></div><div class="field"><label>Method</label><select id="rm"><option value="original_payment">Original payment method (UPI/bank)</option>${r.refund_preference === 'wallet' ? '<option value="wallet">Store credit (customer accepted)</option>' : ''}</select></div><div class="field full"><label>Bank/UPI refund reference (if already sent)</label><input id="rr" maxlength="60"></div></div><button class="btn sm" id="rb">Issue refund</button><p class="tiny muted">You'll be asked for a fresh authenticator code.</p>`}`, { wide: true });
  m.el.addEventListener('click', async (e) => { const a = e.target.closest('[data-a]')?.dataset.a;
    try { if (a) { let reason = null; if (a === 'reject') { reason = await confirmBox('Reject request', 'The customer will see this reason.', { ok: 'Reject', danger: true, input: 'Reason' }); if (!reason) return; }
        await call('admin_review_return', { p_return_id: r.id, p_action: a, p_reason: reason, p_eligible_amount: m.el.querySelector('#ea').value === '' ? null : Number(m.el.querySelector('#ea').value), p_note: m.el.querySelector('#en').value.trim() || null }); ok('Updated'); m.close(); refresh(); }
      if (e.target.id === 'rb') { const amt = Number(m.el.querySelector('#ra').value); if (!(amt > 0)) return toast('Enter an amount', 'bad'); if (!await confirmBox('Issue refund?', `${inr(amt)} via ${m.el.querySelector('#rm').selectedOptions[0].text}. This is recorded permanently.`, { ok: 'Issue refund' })) return;
        await call('admin_issue_refund', { p_order_id: r.order_id, p_return_id: r.id, p_amount: amt, p_method: m.el.querySelector('#rm').value, p_external_reference: m.el.querySelector('#rr').value.trim() || null, p_idempotency_key: ik() }); ok('Refund recorded ✓'); m.close(); refresh(); }
    } catch (x) { bad(x); } });
}

// ----- coupons -----
M.coupons = async () => {
  const [prods, cats, cust] = await Promise.all([api.select('products', { order: { col: 'name', asc: true }, limit: 1000 }), api.select('categories', { order: { col: 'sort', asc: true } }), api.rpc('admin_coupon_customers_all').catch(() => [])]);
  const po = prods.map((p) => [p.id, p.name]), co = cats.map((c) => [c.id, c.name]);
  const CUST = {}; (cust || []).forEach((x) => { CUST[x.coupon_id] = x.customer_ids || []; });
  const fields = [{ k: 'code', label: 'Code', req: true, hint: 'Letters/digits, e.g. DIWALI25 (saved in CAPITALS)' }, { k: 'description', label: 'Description (internal note)' },
    { k: 'visibility', label: 'Visibility — PUBLIC ya PRIVATE', type: 'select', def: 'private', opts: [['private', 'PRIVATE — sirf chune hue customers ko milega'], ['public', 'PUBLIC — storefront par dikh sakta hai (neeche window)']], hint: 'Private: koi aur customer code lagaye to “invalid code” dikhega.' },
    { k: 'show_from', label: 'PUBLIC: page par kab se dikhe (IST)', type: 'datetime', hint: 'Sirf PUBLIC ke liye. Khali = turant.' }, { k: 'show_until', label: 'PUBLIC: page par kab tak dikhe (IST)', type: 'datetime', hint: 'Iske baad coupon page se hat jayega. Khali = band nahi hoga.' },
    { k: '_customers', label: 'PRIVATE: customers (Customer ID SZC-… ya email, comma se)', type: 'textarea', full: true, hint: 'Har customer ka ID ya email likhein. Ye list pura replace hoti hai. Public ke liye khali chhod sakte hain.' },
    { k: 'discount_type', label: 'Discount type', type: 'select', opts: [['percent', 'Percentage %'], ['fixed', 'Fixed amount ₹']] }, { k: 'discount_value', label: 'Discount value', type: 'money', req: true },
    { k: 'min_order', label: 'Minimum order value ₹', type: 'money' }, { k: 'max_discount', label: 'Maximum discount ₹ (blank = no cap)', type: 'money' },
    { k: 'starts_at', label: 'Starts', type: 'datetime' }, { k: 'expires_at', label: 'Expires', type: 'datetime' }, { k: 'usage_limit', label: 'Total usage limit (blank = unlimited)', type: 'number' }, { k: 'per_user_limit', label: 'Per-customer limit (blank = unlimited)', type: 'number' },
    { k: 'eligible_product_ids', label: 'Only these products (none selected = all)', type: 'multi', opts: po, full: true }, { k: 'eligible_category_ids', label: 'Only these categories (none = all)', type: 'multi', opts: co }, { k: 'excluded_product_ids', label: 'Exclude these products', type: 'multi', opts: po },
    { k: 'active', label: 'Active', type: 'bool', def: true }];
  const parseKeys = (t) => String(t || '').split(/[,\n;]+/).map((x) => x.trim()).filter(Boolean);
  setTimeout(async () => { try { const rr = await api.select('site_settings', { eq: { key: 'coupon_rotation' }, single: true }); const v = rr?.value || {}; const last = v.rotated_at ? new Date(v.rotated_at) : null; const nxt = last ? new Date(last.getTime() + 5 * 864e5) : null; const fm = (d) => d ? d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-';
    const codes = Object.entries(v.codes || {}).sort((x, y) => Number(x[1]) - Number(y[1])).map(([c, p]) => `${Number(p)}% - <b>${esc(c)}</b>`).join(' · ');
    const box = document.createElement('div'); box.className = 'alert small'; box.style.margin = '0 0 12px'; box.innerHTML = `🔄 <b>Auto code change:</b> har 5 din me sab % wale coupon ke code naye ban jate hain (discount wahi rehta hai). ${v.codes && Object.keys(v.codes).length ? 'Pichhli baar: ' + fm(last) + '. ' : 'Pehla change ' + fm(nxt) + ' ke baad (raat ~12:05 baje). '}${v.codes && Object.keys(v.codes).length ? 'Agla: ' + fm(nxt) + ' ke baad.' : ''}${codes ? '<div style="margin-top:6px;line-height:1.7">' + codes + '</div>' : ''}`; const q = main().querySelector('.cq'); (q || main().firstElementChild)?.insertAdjacentElement('beforebegin', box); } catch {} }, 600);
  await crud({ table: 'coupons', title: 'Coupons', fields, folder: 'coupons', search: ['code', 'description'],
    cols: ['Code', 'Discount', 'Rules', 'Visibility', 'Window', 'Status'],
    before: (d) => { const code = d.code.toUpperCase().replace(/\s+/g, ''); if (!/^[A-Z0-9_-]{3,32}$/.test(code)) throw new Error('Coupon code: 3–32 letters, digits, - or _ (no spaces).'); if (!(d.discount_value > 0)) throw new Error('Discount value must be more than 0.');
      if (d.show_from && d.show_until && new Date(d.show_until) <= new Date(d.show_from)) throw new Error('“Page par kab tak” baad ka hona chahiye.');
      const { _customers, visibility, ...rest } = d; return { ...rest, code, min_order: d.min_order || 0, is_public: visibility === 'public', show_from: d.show_from || null, show_until: d.show_until || null }; },
    after: async (id, d) => { if (d._customers === undefined) return; const r = await api.rpc('admin_coupon_set_customers', { p_coupon: id, p_keys: parseKeys(d._customers) });
      if (r && r.not_found && r.not_found.length) toast('Ye customer nahi mile (ID/email check karein): ' + r.not_found.join(', '), 'bad'); },
    render: (c) => { c.visibility = c.is_public ? 'public' : 'private'; c._customers = (CUST[c.id] || []).join(', ');
      const win = c.is_public ? (c.show_from || c.show_until ? `${c.show_from ? fmtDate(c.show_from, false) : 'turant'} → ${c.show_until ? fmtDate(c.show_until, false) : 'no end'}` : 'Hamesha (window nahi)') : '';
      return `<td><b><code>${esc(c.code)}</code></b><div class="tiny muted">${esc(c.description || '')}</div></td><td>${c.discount_type === 'percent' ? Number(c.discount_value) + '%' : inr(c.discount_value)}</td><td class="tiny">${c.min_order > 0 ? 'Min ' + inr(c.min_order) + '<br>' : ''}${c.max_discount ? 'Max ' + inr(c.max_discount) + '<br>' : ''}${c.usage_limit ? 'Limit ' + c.usage_limit + '<br>' : ''}${c.per_user_limit ? c.per_user_limit + '/customer' : ''}</td><td>${c.is_public ? '<span class="tag green">PUBLIC</span>' : `<span class="tag gray">PRIVATE</span><div class="tiny muted">${(CUST[c.id] || []).length} customer(s)</div>`}</td><td class="tiny">${c.is_public ? esc(win) + '<br>' : ''}${c.starts_at ? fmtDate(c.starts_at, false) : 'now'} → ${c.expires_at ? fmtDate(c.expires_at, false) : 'no expiry'}</td><td>${pubToggle(c, 'active')}</td>`; } });
  main().insertAdjacentHTML('afterbegin', '<div class="alert small">🔒 PRIVATE coupon: sirf chune hue customers lagayenge. 🌐 PUBLIC coupon: storefront par “Aaj ka coupon” me dikh sakta hai (show from / until IST ke hisab se). Purane coupons PRIVATE hain.</div>');
  main().insertAdjacentHTML('beforeend', '<h2 style="margin-top:24px">Coupon usage history</h2><div id="cu"></div>');
  try { const red = await api.select('coupon_redemptions', { order: { col: 'created_at', asc: false }, limit: 300 }); const cps = await api.select('coupons', { limit: 1000 });
    $('#cu').innerHTML = tbl(['Code', 'Order', 'Discount', 'When', ''], red.map((r) => `<tr><td><code>${esc(cps.find((c) => c.id === r.coupon_id)?.code || r.code || '')}</code></td><td class="tiny"><a href="orders.html?id=${esc(r.order_id)}">${esc(r.order_id.slice(0, 8))}…</a></td><td>${inr(r.discount_amount)}</td><td class="tiny">${fmtDate(r.created_at)}</td><td>${r.voided ? '<span class="tag gray">voided</span>' : ''}</td></tr>`), 'No coupon uses yet.'); } catch { $('#cu').innerHTML = '<p class="muted small">—</p>'; }
};
// ----- customer wallets -----
M.wallet = async () => {
  main().innerHTML = head('Customer wallets (store credit)') + `<div class="alert small">Store credit is an internal ledger for SHOPZENT purchases only — not money, not withdrawable. Every change is a permanent ledger entry; mistakes are fixed with a new opposite entry, never by editing.</div>
  <div class="row" style="margin-bottom:12px"><input id="wq" type="search" placeholder="Search Customer ID, Wallet ID, email, mobile, name" style="max-width:420px"></div><div id="rov" class="alert small"></div><div id="wl"></div><h2 style="margin-top:22px">All wallet transactions</h2><div id="wt"></div>`;
  const draw = async () => { const rows = await api.rpc('admin_search_customers', { p_q: $('#wq').value.trim() || null });
    api.rpc('admin_rupee_overview').then((o) => { $('#rov').innerHTML = `💵 <b>Send RUPEES</b> (store credit) from the button on each customer below. Monthly sending limit ${inr(o.monthly_limit)} · sent this month ${inr(o.sent_this_month)} · left ${inr(o.remaining)}. &nbsp;🪙 To send <b>COINS</b> use <a href="coins.html">Coins →</a> (separate section).`; }).catch(() => { $('#rov').innerHTML = '💵 Send <b>RUPEES</b> from the button on each customer below. 🪙 To send <b>COINS</b> use <a href="coins.html">Coins →</a>.'; });
    $('#wl').innerHTML = tbl(['Customer', 'IDs', 'Contact', 'Store credit', 'Coins', ''], rows.map((u) => `<tr><td>${esc(u.full_name || '')}${u.status !== 'active' ? ' ' + statusTag(u.status) : ''}</td><td class="tiny"><code>${esc(u.customer_id)}</code><br><code>${esc(u.wallet_id || '')}</code></td><td class="tiny">${esc(u.email || '')}<br>${esc(u.mobile || '')}</td><td><b>${inr(u.wallet_balance)}</b></td><td>${num(u.coin_balance)}</td><td><div class="row"><button class="btn xs" data-cr="${esc(u.id)}">Send ₹ rupees</button><button class="btn xs sec" data-hi="${esc(u.id)}">History</button></div></td></tr>`), 'No customers found.');
    $('#wl').onclick = async (e) => { const cr = e.target.closest('[data-cr]'), hi = e.target.closest('[data-hi]');
      if (hi) { const led = await api.rpc('admin_wallet_ledger', { p_user_id: hi.dataset.hi, p_limit: 200 }); modal(`<div class="row between"><h3 style="margin:0">Wallet history</h3><button class="btn ghost sm" data-close>✕</button></div>${ledTbl(led)}`, { wide: true }); }
      if (cr) { const u = rows.find((x) => x.id === cr.dataset.cr); formModal(`Store credit · ${u.customer_id}`, [{ k: 'direction', label: 'Type', type: 'select', opts: [['credit', 'Add credit'], ['debit', 'Deduct credit']] }, { k: 'kind', label: 'Reason type', type: 'select', opts: [['promo_credit', 'Promotional credit'], ['return_credit', 'Approved return credit'], ['admin_adjust', 'Correction / adjustment']] }, { k: 'amount', label: 'Amount ₹', type: 'money', req: true }, { k: 'note', label: 'Internal note (required)', req: true, full: true }], null,
        async (d) => { await call('admin_wallet_adjust', { p_user_id: u.id, p_direction: d.direction, p_kind: d.kind, p_amount: d.amount, p_note: d.note, p_idempotency_key: ik() }); ok('Wallet updated ✓'); draw(); }); } };
    $('#wt').innerHTML = ledTbl(await api.rpc('admin_wallet_ledger', { p_user_id: null, p_limit: 100 })); };
  const ledTbl = (led) => tbl(['When', 'Customer', 'Type', 'Amount', 'Ref', 'Note'], led.map((l) => `<tr><td class="tiny">${fmtDate(l.created_at)}</td><td class="tiny"><code>${esc(l.customer_id || '')}</code></td><td class="small">${esc(l.kind)}</td><td style="font-weight:700;color:${l.direction === 'credit' ? 'var(--ok)' : 'var(--bad)'}">${l.direction === 'credit' ? '+' : '−'}${inr(l.amount)}</td><td class="tiny"><code>${esc(l.txn_ref)}</code></td><td class="tiny">${esc(l.note || '')}</td></tr>`), 'No transactions yet.');
  $('#wq').oninput = () => { clearTimeout(window.__t); window.__t = setTimeout(draw, 300); }; await draw();
};
// ----- coins -----
M.coins = async () => {
  const draw = async () => { const o = await api.rpc('admin_coin_overview'); const led = await api.rpc('admin_coin_ledger', { p_limit: 200 });
    main().innerHTML = head('Coins & loyalty credits') + `<div class="alert warn small"><b>Coins are internal loyalty points</b> for promotions. They are NOT money, NOT rupees, NOT UPI funds and NOT withdrawable. The 5,000,000,000 supply is an internal display figure for issuing promotions.</div>
    <div class="coin-hero"><span class="small" style="opacity:.8">Available promotional coin balance (treasury)</span><b>🪙 ${num(o.treasury_available)}</b><div class="row small" style="gap:18px;opacity:.9;margin-top:6px"><span>Total supply ${num(o.total_supply)}</span><span>Issued ${num(o.issued)}</span><span>Reversed ${num(o.reversed)}</span><span>Redeemed ${num(o.redeemed)}</span><span>Expired ${num(o.expired)}</span></div><div style="margin-top:8px">${o.enabled ? '<span class="tag green">Coin system ON</span>' : '<span class="tag red">Coin system OFF</span>'}</div></div>
    <div class="grid g2" style="margin-top:16px"><form class="card pad" id="ct"><h3>Send coins to a customer</h3><div class="field"><label for="tg">Customer ID or Wallet ID</label><div class="row" style="flex-wrap:nowrap"><input id="tg" placeholder="SZC-XXXXXXXX or SZW-XXXXXXXX" required><button type="button" class="btn sec sm" id="fd">Find</button></div><div id="fdr" class="small muted"></div></div>
      <div class="field"><label for="cn">Number of coins</label><input id="cn" type="number" min="1" step="1" required></div><div class="field"><label for="cnote">Internal note (required)</label><input id="cnote" maxlength="300" required></div><p class="err" id="ce"></p><button class="btn">Confirm transfer</button><p class="tiny muted">Asks for a fresh authenticator code. Recorded permanently.</p></form>
    <form class="card pad" id="cs"><h3>Coin settings</h3><div class="field"><label class="row" style="gap:8px"><input type="checkbox" id="se" ${o.settings.enabled ? 'checked' : ''}> Coin system enabled</label></div><div class="field"><label for="sx">Coin expiry (days after issue, blank = never)</label><input id="sx" type="number" min="1" value="${o.settings.expiry_days ?? ''}"></div><div class="field"><label for="sr">Promotional coin rules (shown to customers)</label><textarea id="sr" maxlength="2000">${esc(o.settings.rules || '')}</textarea></div><button class="btn sec">Save settings</button></form></div>
    <h2 style="margin-top:22px">Transfer history</h2>${tbl(['When', 'Ref', 'Customer', 'Type', 'Coins', 'Note', ''], led.map((l) => `<tr><td class="tiny">${fmtDate(l.created_at)}</td><td class="tiny"><code>${esc(l.txn_ref)}</code></td><td class="tiny">${l.customer_id ? `<code>${esc(l.customer_id)}</code><br><code>${esc(l.wallet_id || '')}</code>` : '<i>Treasury</i>'}</td><td>${esc(l.kind)}</td><td style="font-weight:700">${num(l.coins)}</td><td class="tiny">${esc(l.note || '')}${l.expires_at ? '<br>expires ' + fmtDate(l.expires_at, false) : ''}</td><td>${l.kind === 'issue' && !led.some((x) => x.reverses_id === l.id) ? `<button class="btn xs ghost" data-rev="${l.id}">Reverse</button>` : ''}</td></tr>`), 'No coin transactions yet.')}`;
    $('#fd').onclick = async () => { const r = await api.rpc('admin_search_customers', { p_q: $('#tg').value.trim() }); const u = r.find((x) => x.customer_id === $('#tg').value.trim().toUpperCase() || x.wallet_id === $('#tg').value.trim().toUpperCase()) || (r.length === 1 ? r[0] : null);
      $('#fdr').innerHTML = u ? `✓ ${esc(u.full_name)} · ${esc(u.customer_id)} · ${esc(u.wallet_id)} · current coins ${num(u.coin_balance)}` : r.length ? `${r.length} matches — type the full ID` : 'No customer found'; if (u) $('#tg').value = u.customer_id; };
    $('#ct').onsubmit = async (e) => { e.preventDefault(); const coins = parseInt($('#cn').value); const t = $('#tg').value.trim().toUpperCase(), note = $('#cnote').value.trim(); if (!t || !(coins > 0) || note.length < 3) { $('#ce').textContent = 'Fill the customer ID, coins and a note.'; return; }
      if (!await confirmBox('Confirm coin transfer', `Send ${num(coins)} loyalty coins to ${t}? (Coins are not money.)`, { ok: 'Send coins' })) return;
      try { await call('admin_coin_transfer', { p_target: t, p_coins: coins, p_note: note, p_idempotency_key: ik() }); ok('Coins sent ✓'); draw(); } catch (x) { $('#ce').textContent = errText(x); } };
    $('#cs').onsubmit = async (e) => { e.preventDefault(); try { await call('admin_set_coin_settings', { p_enabled: $('#se').checked, p_expiry_days: $('#sx').value ? parseInt($('#sx').value) : null, p_rules: $('#sr').value.trim() }); ok('Coin settings saved'); draw(); } catch (x) { bad(x); } };
    main().querySelectorAll('[data-rev]').forEach((b) => b.onclick = async () => { const n = await confirmBox('Reverse this transfer?', 'Creates an opposite ledger entry (the original stays visible). Only possible once.', { ok: 'Reverse', danger: true, input: 'Reason' }); if (!n) return; try { await call('admin_coin_reverse', { p_ledger_id: Number(b.dataset.rev), p_note: n, p_idempotency_key: ik() }); ok('Reversed'); draw(); } catch (x) { bad(x); } });
  }; await draw();
};
// ----- security -----
M.security = async () => {
  const s = await api.rpc('admin_security_overview'); const log = await api.rpc('admin_audit_log', { p_limit: 300, p_action: null });
  const kb = (b) => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : (b / 1024).toFixed(0) + ' KB';
  main().innerHTML = head('Security dashboard', '<button class="btn sm sec" id="ax">Export audit log</button>') + `
  <div class="kpis"><div class="kpi ${s.failed_logins_1h > 20 ? 'g' : ''}"><b>${num(s.failed_logins_1h)}</b><span>Failed logins (1 h)</span></div><div class="kpi"><b>${num(s.failed_logins_24h)}</b><span>Failed logins (24 h)</span></div><div class="kpi"><b>${num(s.locked_keys)}</b><span>Accounts in cooldown</span></div><div class="kpi"><b>${num(s.mfa_failures_24h)}</b><span>2FA failures (24 h)</span></div><div class="kpi"><b>${kb(s.db_size_bytes || 0)}</b><span>Database size (free tier 500 MB)</span></div><div class="kpi"><b>${kb(s.storage_bytes || 0)}</b><span>Storage used · ${num(s.storage_objects || 0)} files (free 1 GB)</span></div></div>
  <div class="grid g2" style="margin-top:16px"><div class="card pad"><h3>Suspicious activity</h3>${(s.suspicious || []).map((x) => `<div class="alert warn small">${esc(x.detail || ({ failed_login_burst: `Many failed logins from one source (${x.key || ''}): ${x.count || ''} attempts`, admin_without_mfa: `Admin without 2FA: ${x.email || ''}`, duplicate_utr_attempts: `Repeated duplicate-UTR attempts: ${x.count || ''}` })[x.kind] || [x.kind, x.count, x.key || x.email].filter(Boolean).join(' · '))}</div>`).join('') || '<p class="small muted">Nothing suspicious detected.</p>'}</div>
  <div class="card pad"><h3>Security configuration</h3><ul class="small"><li>${s.config?.rls_all_tables ? '✅' : '❌'} Row Level Security on every table ${(s.config?.tables_without_rls || []).length ? '— missing: ' + esc(s.config.tables_without_rls.join(', ')) : ''}</li>${(s.admins || []).map((a) => `<li>${a.mfa_enrolled ? '✅' : '❌'} ${esc(a.email)} (${esc(a.role)}) — 2FA ${a.mfa_enrolled ? 'on' : 'NOT enrolled'}</li>`).join('')}<li>✅ Admin actions require a 2FA-verified session (enforced in the database)</li><li>✅ Payment, refund, wallet, coin and permission actions require a fresh 2FA code</li><li>ℹ️ Active sessions are managed by Supabase Auth — use “Sign out everywhere” below after a suspected compromise.</li></ul>${s.config?.note ? `<p class="tiny muted">${esc(s.config.note)}</p>` : ''}
    <button class="btn danger sm" id="sa">Sign out of all my sessions</button></div></div>
  <h2 style="margin-top:22px">Audit log</h2><div class="row" style="margin-bottom:10px"><input id="af" placeholder="Filter by action (e.g. payment_approved)" style="max-width:320px"></div><div id="al"></div>`;
  const draw = () => { const f = $('#af').value.trim(); const rows = log.filter((a) => !f || a.action.includes(f));
    $('#al').innerHTML = tbl(['When', 'Action', 'Entity', 'Actor', 'Details'], rows.slice(0, 300).map((a) => `<tr><td class="tiny">${fmtDate(a.created_at)}</td><td><code class="tiny">${esc(a.action)}</code></td><td class="tiny">${esc(a.entity || '')} ${esc((a.entity_id || '').slice(0, 12))}</td><td class="tiny">${esc(a.actor_role || '')}</td><td class="tiny" style="max-width:280px;word-break:break-word">${esc(JSON.stringify(a.details || {})).slice(0, 200)}</td></tr>`), 'No events.'); };
  $('#af').oninput = draw; draw(); $('#ax').onclick = () => csv(log, 'audit-log');
  $('#sa').onclick = async () => { if (!await confirmBox('Sign out everywhere?', 'All your sessions (all devices) end now.', { ok: 'Sign out all', danger: true })) return; try { await api.rpc('log_auth_event', { p_action: 'logout_all', p_details: {} }); } catch {} await api.auth.signOut(true); location.href = 'index.html'; };
};
// ----- users -----
M.users = async () => {
  main().innerHTML = head('Users') + `<div class="row" style="gap:10px;margin-bottom:12px;flex-wrap:wrap"><input id="uq" type="search" placeholder="Search name, email, mobile, Customer ID" style="max-width:380px"><label class="small row" style="gap:6px;flex-wrap:nowrap"><input type="checkbox" id="usus"> ⚠️ Only suspicious / blocked</label></div><p class="small muted">⚠️ <b>Suspicious</b> = automatic warning signs (temporary email, duplicate UTR, many rejected payments or cancellations, unpaid dues) or marked by you. <b>Block</b> = the customer is signed out everywhere and cannot log in or order. Unblock any time.</p><div id="ul"></div>${ME.role !== 'super_admin' ? '<p class="small muted">Only a Super Admin can change roles.</p>' : ''}`;
  const draw = async () => { const rows = await api.rpc('admin_list_users', { p_q: $('#uq').value.trim() || null, p_limit: 200, p_suspicious_only: $('#usus').checked });
    $('#ul').innerHTML = tbl(['User', 'IDs', 'Role', 'Status', 'Joined', ''], rows.map((u) => { const fl = Array.isArray(u.flags) ? u.flags : []; const blocked = u.status !== 'active';
      return `<tr${fl.length || blocked ? ' style="background:#FFF7ED"' : ''}><td>${esc(u.full_name || '')}<div class="tiny muted">${esc(u.email || '')} · ${esc(u.mobile || '')}${u.email_confirmed === false ? ' · <span style="color:var(--bad)">email not verified</span>' : ''}</div>${fl.length ? `<div class="tiny" style="margin-top:4px">${fl.map((f) => `<span class="tag" style="background:#FEF3C7;color:#92400E;margin:2px 4px 0 0;display:inline-block">⚠️ ${esc(f)}</span>`).join('')}</div>` : ''}</td><td class="tiny"><code>${esc(u.customer_id)}</code><br><code>${esc(u.wallet_id || '')}</code></td><td>${ME.role === 'super_admin' && u.id !== ME.id ? `<select data-role="${esc(u.id)}" style="width:auto;padding:4px 8px">${['customer', 'admin', 'super_admin'].map((r) => `<option ${u.role === r ? 'selected' : ''} value="${r}">${r.replace('_', ' ')}</option>`).join('')}</select>` : `<span class="tag">${esc(u.role)}</span>`}</td><td>${blocked ? '<span class="tag" style="background:#FEE2E2;color:#991B1B">⛔ Blocked</span>' : statusTag(u.status)}</td><td class="tiny">${fmtDate(u.created_at, false)}</td><td>${u.id !== ME.id ? `<div class="row" style="gap:6px;flex-wrap:wrap"><button class="btn xs ${blocked ? 'ok' : 'danger'}" data-st="${esc(u.id)}" data-to="${blocked ? 'active' : 'suspended'}">${blocked ? 'Unblock' : '⛔ Block'}</button><button class="btn xs sec" data-fl="${esc(u.id)}" data-on="${u.marked ? '0' : '1'}">${u.marked ? 'Unmark' : '⚠️ Mark suspicious'}</button></div>` : '<span class="tiny muted">you</span>'}</td></tr>`; }), 'No users.');
    $('#ul').onchange = async (e) => { const s = e.target.closest('[data-role]'); if (!s) return; if (!await confirmBox('Change role?', `Set this user to “${s.value}”. ${s.value !== 'customer' ? 'They must set up 2FA before they can use the admin panel.' : ''}`, { ok: 'Change role' })) { draw(); return; } try { await call('admin_set_user_role', { p_user_id: s.dataset.role, p_role: s.value }); ok('Role changed'); } catch (x) { bad(x); } draw(); };
    $('#ul').onclick = async (e) => { const f = e.target.closest('[data-fl]');
      if (f) { const on = f.dataset.on === '1'; const note = on ? await confirmBox('Mark as suspicious?', 'Only admins see this. It does not block the customer.', { ok: 'Mark', input: 'Why? (short note)' }) : true; if (note === false || note === null) return;
        try { await call('admin_flag_user', { p_user_id: f.dataset.fl, p_suspicious: on, p_note: typeof note === 'string' ? note : null }); ok(on ? 'Marked suspicious' : 'Unmarked'); draw(); } catch (x) { bad(x); } return; }
      const b = e.target.closest('[data-st]'); if (!b) return; const blk = b.dataset.to === 'suspended'; const r = await confirmBox(blk ? 'Block this customer?' : 'Unblock this customer?', blk ? 'They will be signed out on every device and cannot log in or place orders until you unblock them. Recorded in the audit log.' : 'They can log in and order again. Recorded in the audit log.', { ok: blk ? 'Block' : 'Unblock', danger: blk, input: 'Reason' }); if (!r) return; try { await call('admin_set_user_status', { p_user_id: b.dataset.st, p_status: b.dataset.to, p_reason: r }); ok(blk ? 'Blocked' : 'Unblocked'); draw(); } catch (x) { bad(x); } }; };
  $('#uq').oninput = () => { clearTimeout(window.__t); window.__t = setTimeout(draw, 300); }; $('#usus').onchange = draw; await draw();
};
// ----- messages -----
M.messages = async () => {
  const [msgs, subs] = await Promise.all([api.select('contact_messages', { order: { col: 'created_at', asc: false }, limit: 300 }), api.select('newsletter_subscribers', { order: { col: 'created_at', asc: false }, limit: 2000 })]);
  main().innerHTML = head('Messages', '<button class="btn sm sec" id="nx">Export subscribers</button>') + tbl(['From', 'Message', 'When', 'Status'], msgs.map((m) => `<tr><td>${esc(m.name)}<div class="tiny muted"><a href="mailto:${esc(m.email)}">${esc(m.email)}</a> ${esc(m.mobile || '')}</div></td><td class="small"><b>${esc(m.subject || '')}</b><div style="white-space:pre-line">${esc(m.message)}</div></td><td class="tiny">${fmtDate(m.created_at)}</td><td><select data-ms="${esc(m.id)}" style="width:auto;padding:4px 8px">${['new', 'read', 'closed'].map((s) => `<option ${m.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select></td></tr>`), 'No contact messages yet.') + `<h2 style="margin-top:22px">Newsletter subscribers (${subs.length})</h2>` + tbl(['Email', 'Since'], subs.slice(0, 200).map((s) => `<tr><td>${esc(s.email)}</td><td class="tiny">${fmtDate(s.created_at)}</td></tr>`), 'No subscribers yet.');
  main().onchange = async (e) => { const s = e.target.closest('[data-ms]'); if (s) { try { await api.update('contact_messages', s.dataset.ms, { status: s.value }); ok('Updated'); } catch (x) { bad(x); } } };
  $('#nx').onclick = () => csv(subs, 'subscribers');
};

// ----- products -----
M.products = async () => {
  window.__szSel = null;
  const [cats, brs, cps] = await Promise.all([api.select('categories', { order: { col: 'sort', asc: true } }), api.select('brands', { order: { col: 'sort', asc: true } }), api.select('coupons', { order: { col: 'code', asc: true } })]);
  const isAff = (r) => r.purchase_type === 'affiliate';
  const fields = [
    { k: 'purchase_type', label: 'What kind of product is this?', type: 'select', opts: [['direct', '1. Direct SHOPZENT Purchase (UPI checkout)'], ['affiliate', '2. Affiliate Product (Amazon / Flipkart link)']], full: true, def: 'direct' },
    { k: 'name', label: 'Product name', req: true, full: true, max: 160 }, { k: 'slug', label: 'URL slug (auto from name if blank)', hint: 'e.g. boat-airdopes-141' }, { k: 'product_code', label: 'Product ID (auto if blank)' },
    { k: 'category_id', label: 'Category', type: 'select', opts: [['', '—'], ...cats.map((c) => [c.id, c.name])] }, { k: 'brand_id', label: 'Brand', type: 'select', opts: [['', '—'], ...brs.map((b) => [b.id, b.name])] },
    { k: 'marketplace', label: 'Marketplace', type: 'select', opts: [['shopzent', 'SHOPZENT'], ['amazon', 'Amazon India'], ['flipkart', 'Flipkart'], ['other', 'Other approved network']] },
    { k: 'affiliate_url', label: 'Affiliate URL (https://, your tracking link)', type: 'url', full: true, show: isAff },
    { k: 'price', label: 'Current price ₹', type: 'money', hint: 'Enter the real, verified price. Affiliate: optional.' }, { k: 'original_price', label: 'Original price / MRP ₹', type: 'money' },
    { k: 'price_verified_at', label: 'Price last verified on', type: 'datetime', show: isAff }, { k: 'offer_expires_at', label: 'Offer expiry', type: 'datetime' },
    { k: 'availability', label: 'Availability', type: 'select', opts: [['in_stock', 'In stock'], ['out_of_stock', 'Out of stock'], ['preorder', 'Pre-order'], ['discontinued', 'Discontinued']] }, { k: 'stock_qty', label: 'Stock quantity', type: 'number', show: (r) => !isAff(r) },
    { k: 'coupon_eligibility', label: 'Coupon Eligible?', type: 'select', opts: [['yes', 'Yes'], ['no', 'No'], ['selected', 'Selected Coupons Only']], show: (r) => !isAff(r) },
    { k: '_coupons', label: 'Allowed coupons (for “Selected Coupons Only”)', type: 'multi', opts: cps.map((c) => [c.id, c.code]), show: (r) => !isAff(r) && r.coupon_eligibility === 'selected' },
    { k: 'product_discount_percent', label: 'Product-specific discount %', type: 'number', step: '0.01', maxv: 90, show: (r) => !isAff(r) }, { k: 'max_discount_percent', label: 'Maximum allowed total discount %', type: 'number', step: '0.01', maxv: 100, show: (r) => !isAff(r) },
    { k: 'allow_combine', label: 'Allow coupon on top of the product discount', type: 'bool', def: true, show: (r) => !isAff(r) },
    { k: 'sizes_enabled', label: 'Sizes enabled: customer ko size chunna padega (kapde ke liye ON)', type: 'bool', def: false, full: true },
    { k: 'size_options', label: 'Sizes available (chip chuno; stock blank = unlimited, 0 = khatam)', type: 'sizes', full: true, show: (r) => r.sizes_enabled === true },
    { k: 'description', label: 'Description', type: 'textarea', full: true }, { k: 'images', label: 'Product images (first = main). Use genuine/licensed photos.', type: 'images', full: true }, { k: 'video_url', label: 'Product video / link (YouTube, Instagram, Facebook, MP4, any https website)', type: 'url', full: true },
    { k: 'specs', label: 'Specifications', type: 'kv', full: true },
    { k: 'is_featured', label: 'Featured', type: 'bool' }, { k: 'is_trending', label: 'Trending', type: 'bool' }, { k: 'is_deal', label: 'Deal', type: 'bool' }, { k: 'is_popular', label: 'Popular', type: 'bool' },
    { k: 'referral_rate', label: 'Share reward % (5-8, blank = default). Sirf SHOPZENT ka apna product: dost kharide to sharer ko itne % coins (deliver hone par)', type: 'number', full: true },
    { k: 'seo_title', label: 'SEO title', full: true, max: 70 }, { k: 'seo_description', label: 'SEO description', type: 'textarea', full: true, max: 170 }, { k: 'is_sample', label: 'This is a sample/placeholder listing', type: 'bool' }, { k: 'published', label: 'Published (visible on the website)', type: 'bool' }];
  window.__szCats = cats;
  let pcMap = {}; try { (await api.select('product_coupons', { limit: 5000 })).forEach((x) => { (pcMap[x.product_id] ||= []).push(x.coupon_id); }); } catch {}
  const before = (d, row) => { const o = { ...d }; delete o._coupons; delete o.referral_rate; o.slug = d.slug ? (slugify(d.slug) || row?.slug || 'product-' + rnd4()) : row?.slug || ((slugify(o.name) || 'product') + '-' + rnd4()); if (!o.product_code) delete o.product_code; ['category_id', 'brand_id', 'video_url', 'affiliate_url'].forEach((k) => { if (!o[k]) o[k] = null; });
    if (o.purchase_type === 'affiliate') { o.coupon_eligibility = 'no'; if (o.marketplace === 'shopzent') o.marketplace = /amazon\.|amzn\./i.test(o.affiliate_url || '') ? 'amazon' : /flipkart\.|fkrt\.|fktr\./i.test(o.affiliate_url || '') ? 'flipkart' : 'other'; } else { o.affiliate_url = null; if (o.marketplace !== 'shopzent') o.marketplace = 'shopzent'; } if (!Array.isArray(o.images)) o.images = []; if (!o.specs || typeof o.specs !== 'object') o.specs = {};
    if (o.original_price != null && o.price != null && o.original_price < o.price) throw new Error('Original price cannot be lower than the current price.'); o.product_discount_percent = o.product_discount_percent || 0; o.max_discount_percent = o.max_discount_percent ?? 90; return o; };
  const after = async (id, d) => { if (d.purchase_type !== 'affiliate' && d.referral_rate !== undefined) { try { await call('admin_set_product_referral_rate', { p_product_id: id, p_rate: d.referral_rate === null ? null : Number(d.referral_rate) }); } catch (x) { if (!/not_own_product/.test(x.message)) throw x; } }
    const want = d.coupon_eligibility === 'selected' ? d._coupons || [] : []; const have = pcMap[id] || [];
    for (const c of have.filter((x) => !want.includes(x))) await api.removeWhere('product_coupons', { product_id: id, coupon_id: c }); for (const c of want.filter((x) => !have.includes(x))) await api.insert('product_coupons', { product_id: id, coupon_id: c }); pcMap[id] = want; };
  await crud({ table: 'products', title: 'Products', groupBy: (rows) => { const g = []; for (const c of cats) { const rs = rows.filter((r) => r.category_id === c.id); if (rs.length) g.push({ label: (c.emoji || c.icon || '') + ' ' + c.name, rows: rs }); } const rs0 = rows.filter((r) => !cats.some((c) => c.id === r.category_id)); if (rs0.length) g.push({ label: 'No category', rows: rs0 }); return g; }, fields: fields.map((f) => f.k === '_coupons' ? { ...f } : f), folder: 'products', before, after, search: ['name', 'product_code', 'slug'],
    cols: ['Product', 'Type', 'Price', 'Flags', 'Status'], render: (p) => { p._coupons = pcMap[p.id] || []; return `<td><div class="row" style="flex-wrap:nowrap"><img src="${esc(media((p.images || [])[0]) || '../assets/img/placeholder.svg')}" alt="" style="width:44px;height:44px;border-radius:10px;object-fit:cover"><div><b class="small">${esc(p.name)}</b><div class="tiny muted">${esc(p.product_code || '')} ${p.is_sample ? '<span class="tag dark">sample</span>' : ''}</div></div></div></td><td class="small">${p.purchase_type === 'affiliate' ? `Affiliate · ${esc(p.marketplace)}` : 'Direct'}</td><td class="small">${p.price != null ? inr(p.price) : '—'}${p.original_price ? `<div class="tiny muted"><s>${inr(p.original_price)}</s></div>` : ''}</td><td class="tiny">${[p.is_featured && 'featured', p.is_trending && 'trending', p.is_deal && 'deal', p.is_popular && 'popular'].filter(Boolean).join(', ')}<div>${esc(p.availability)}</div></td><td>${pubToggle(p)}</td>`; } });
};
// ----- categories & brands -----
M.content = async () => {
  main().innerHTML = '<div id="c1"></div><div id="c2" style="margin-top:30px"></div>';
  const host = main(); const real = (id) => { const tmp = document.createElement('div'); tmp.id = 'adm-main'; return tmp; };
  // render categories into its own container by temporarily swapping main
  const run = async (target, cfg) => { const holder = $('#' + target); const orig = host.id; host.id = 'adm-main-x'; holder.id = 'adm-main'; try { await crud(cfg); } finally { holder.id = target; host.id = orig; } };
  await run('c1', { table: 'categories', title: 'Categories', order: { col: 'sort', asc: true }, folder: 'banners', fields: [{ k: 'name', label: 'Name', req: true }, { k: 'has_sizes', label: 'Sizes ON by default for new products in this category (kapde / fashion)', type: 'bool', def: false, full: true }, { k: 'slug', label: 'Slug (auto)' }, { k: 'icon', label: 'Icon (emoji like 🎧, or image URL)' }, { k: 'sort', label: 'Order', type: 'number' }, { k: 'banner_url', label: 'Banner image', type: 'image', full: true }, { k: 'description', label: 'Description', type: 'textarea', full: true }, { k: 'published', label: 'Published', type: 'bool', def: true }],
    before: (d, row) => ({ ...d, slug: slugify(d.slug || d.name) || row?.slug || 'category-' + rnd4(), sort: d.sort || 0 }), cols: ['Category', 'Order', 'Status'], render: (c) => `<td>${esc(c.icon || '')} <b>${esc(c.name)}</b><div class="tiny muted">${esc(c.slug)}</div></td><td>${c.sort}</td><td>${pubToggle(c)}</td>` });
  await run('c2', { table: 'brands', title: 'Brands', order: { col: 'sort', asc: true }, folder: 'brand', fields: [{ k: 'name', label: 'Name', req: true }, { k: 'slug', label: 'Slug (auto)' }, { k: 'logo_url', label: 'Logo', type: 'image', full: true }, { k: 'sort', label: 'Order', type: 'number' }, { k: 'description', label: 'Description', type: 'textarea', full: true }, { k: 'published', label: 'Published', type: 'bool', def: true }],
    before: (d, row) => ({ ...d, slug: slugify(d.slug || d.name) || row?.slug || 'brand-' + rnd4(), sort: d.sort || 0 }), cols: ['Brand', 'Order', 'Status'], render: (b) => `<td><b>${esc(b.name)}</b><div class="tiny muted">${esc(b.slug)}</div></td><td>${b.sort}</td><td>${pubToggle(b)}</td>` });
};
// ----- videos -----
M.videos = async () => crud({ table: 'videos', title: 'Videos', order: { col: 'sort', asc: true }, folder: 'videos', search: ['title'],
  fields: [{ k: 'title', label: 'Title', req: true, full: true }, { k: 'kind', label: 'Type', type: 'select', opts: [['tutorial', 'Video tutorial'], ['promo', 'Promotional video']] }, { k: 'category', label: 'Video category (e.g. Guides)' }, { k: 'video_url', label: 'Video link (YouTube, Instagram, Facebook, Vimeo, MP4, screenapp or any https link)', type: 'url', req: true, full: true, hint: 'Or upload an MP4 below (max 50 MB on the free plan).' }, { k: 'thumbnail_url', label: 'Thumbnail', type: 'image', full: true }, { k: 'description', label: 'Description', type: 'textarea', full: true }, { k: 'duration', label: 'Duration (e.g. 3:20)' }, { k: 'sort', label: 'Order', type: 'number' }, { k: 'published', label: 'Published', type: 'bool' }],
  before: (d, row) => ({ ...d, slug: row?.slug || (slugify(d.title) || 'video') + '-' + rnd4(), sort: d.sort || 0 }),
  cols: ['Video', 'Type', 'Status'], render: (v) => `<td><b class="small">${esc(v.title)}</b><div class="tiny muted">${esc(v.category || '')} ${v.video_url ? '· has link' : '· <span style="color:var(--warn)">no video yet</span>'}</div></td><td>${esc(v.kind)}</td><td>${pubToggle(v)}</td>` })
  .then(() => main().insertAdjacentHTML('afterbegin', `<div class="card pad" style="margin-bottom:14px"><b>Upload an MP4</b> <span class="small muted">(gets an https link you can paste into a video)</span><div class="row" style="margin-top:8px"><input type="file" id="vu" accept="video/mp4,video/webm" style="max-width:320px"><span id="vur" class="small"></span></div></div>`)).then(() => { $('#vu').onchange = async (e) => { const f = e.target.files[0]; try { const ext = await checkFile(f, ['mp4', 'webm'], 50); const r = await api.upload('public-media', f, 'videos'); $('#vur').innerHTML = r.url ? `Uploaded ✓ <input value="${esc(r.url)}" readonly style="width:260px">` : 'Uploaded (preview mode keeps no video files)'; } catch (x) { bad(x); } }; });
// ----- apps -----
M.apps = async () => {
  await crud({ table: 'apps', title: 'Apps & APKs', order: { col: 'updated_at', asc: false }, folder: 'apps', search: ['name'],
    fields: [{ k: 'name', label: 'App name', req: true }, { k: 'version', label: 'Version' }, { k: 'icon_url', label: 'Icon', type: 'image', full: true }, { k: 'platform', label: 'Platform', type: 'select', opts: [['Android', 'Android'], ['Windows', 'Windows'], ['iOS', 'iOS (store link only)'], ['Web', 'Web']] }, { k: 'category', label: 'Category' },
      { k: 'download_url', label: 'Download link (https) — Drive, Mediafire, store ya koi bhi link. Upload ki jagah ye use hoga', type: 'url', full: true }, { k: 'file_size_bytes', label: 'File size (bytes) — filled automatically on upload', type: 'number' }, { k: 'developer', label: 'Developer / owner' }, { k: 'is_third_party', label: 'Third-party app (not made by SHOPZENT)', type: 'bool' }, { k: 'license_note', label: 'Licence / distribution permission', full: true },
      { k: 'description', label: 'Description', type: 'textarea', full: true }, { k: 'changelog', label: 'Changelog', type: 'textarea', full: true }, { k: 'published', label: 'Published', type: 'bool' }],
    before: (d, row) => ({ ...d, slug: row?.slug || (slugify(d.name) || 'app') + '-' + rnd4() }),
    cols: ['App', 'File', 'Verification', 'Status'], render: (a) => `<td><b class="small">${esc(a.name)}</b><div class="tiny muted">v${esc(a.version || '—')} · ${esc(a.platform || '')}</div></td><td class="tiny">${a.storage_path ? '📦 APK uploaded' + (a.file_size_bytes ? ' · ' + (a.file_size_bytes / 1048576).toFixed(1) + ' MB' : '') : a.download_url ? '🔗 external link' : '—'}<div class="row" style="gap:6px;flex-wrap:wrap;margin-top:4px"><button class="btn xs sec" data-apk="${esc(a.id)}">⬆️ Upload file</button><button class="btn xs ghost" data-link="${esc(a.id)}">🔗 Link</button></div>${a.download_url && !a.storage_path ? `<div class="tiny muted" style="word-break:break-all">🔗 ${esc(a.download_url)}</div>` : ''}</td><td>${statusTag(a.verification_status)}${a.storage_path ? `<div><button class="btn xs ghost" data-scan="${esc(a.id)}">Run scan</button></div>` : ''}</td><td>${pubToggle(a)}</td>` });
  main().insertAdjacentHTML('afterbegin', '<div class="alert warn small">APK files are stored in a <b>private</b> bucket and stay <b>not downloadable</b> until a real scan marks them clean (“Run scan” uses the apk-verify function with a VirusTotal key, if you set one). Never mark an app safe without scanning. Only upload apps you have the right to distribute.</div>');
  if (main()._appsH) main().removeEventListener('click', main()._appsH); // one listener only (M.apps re-renders after each upload)
  main()._appsH = async (e) => { const up = e.target.closest('[data-apk]'), sc = e.target.closest('[data-scan]'), lk = e.target.closest('[data-link]');
    if (up) { const inp = document.createElement('input'); inp.type = 'file'; inp.onchange = async () => { const f = inp.files[0]; try { if (f && f.size > 50 * 1048576) throw new Error('Is plan par file ki upload limit 50 MB hai. Badi APK/file ke liye “Link” button se Drive/Mediafire ka https link lagayein.'); await checkFile(f, null, 50); const r = await api.upload('apk-files', f, 'apk'); await api.update('apps', up.dataset.apk, { storage_path: r.path, file_size_bytes: f.size, verification_status: 'unverified', sha256: null }); ok('File uploaded — status: not verified until scanned'); M.apps(); } catch (x) { bad(x); } }; inp.click(); }
    if (lk) { const cur = (await api.select('apps', { limit: 1000 }).catch(() => [])).find((x) => x.id === lk.dataset.link); const v = window.prompt('Download link (https://…) — Google Drive, Mediafire, store ya koi bhi https link. Upload ki jagah ye link use hoga.', cur?.download_url || ''); if (v === null) return; const u = v.trim();
      if (u && !/^https:\/\/\S+$/.test(u)) { bad(new Error('Link https:// se shuru hona chahiye.')); return; }
      try { await api.update('apps', lk.dataset.link, { download_url: u || null, storage_path: null, file_size_bytes: null, verification_status: 'unverified', sha256: null }); ok(u ? 'Link save ho gaya. Download button ab ye link use karega.' : 'Link hata diya.'); M.apps(); } catch (x) { bad(x); } }
    if (sc) { try { const r = await api.fn('apk-verify', { app_id: sc.dataset.scan }); ok('Scan result: ' + (r.verification_status || 'done')); M.apps(); } catch (x) { toast(DEMO ? 'Scanning needs the live backend (apk-verify function). In preview mode nothing is scanned.' : 'Scan failed: ' + errText(x), 'bad'); } } };
  main().addEventListener('click', main()._appsH);
};
// ----- ads -----
M.ads = async () => crud({ table: 'ads', title: 'Advertisements', order: { col: 'sort', asc: true }, folder: 'ads', search: ['title'],
  fields: [{ k: 'title', label: 'Title', req: true, full: true }, { k: 'placement', label: 'Placement', type: 'select', opts: [['home_mid', 'Homepage (middle)'], ['home_hero', 'Homepage (top)'], ['home_bottom', 'Homepage (bottom)'], ['products_top', 'Products page (top)'], ['sidebar', 'Sidebar'], ['ads_page', 'Advertisements page only']] }, { k: 'image_url', label: 'Banner image (1200×500 recommended)', type: 'image', full: true }, { k: 'video_url', label: 'Promotional video link (optional)', type: 'url', full: true }, { k: 'link_url', label: 'Click goes to (full https:// link)', type: 'url', full: true }, { k: 'starts_at', label: 'Start', type: 'datetime' }, { k: 'ends_at', label: 'Expiry', type: 'datetime' }, { k: 'sort', label: 'Order', type: 'number' }, { k: 'enabled', label: 'Enabled', type: 'bool', def: true }],
  before: (d) => { if (d.link_url && !/^https:\/\/\S+$/.test(d.link_url)) throw new Error('Link must start with https://'); return { ...d, sort: d.sort || 0 }; },
  cols: ['Ad', 'Placement', 'Dates', 'Performance', 'Status'], render: (a) => `<td><div class="row" style="flex-wrap:nowrap">${a.image_url ? `<img src="${esc(media(a.image_url))}" alt="" style="width:80px;height:34px;object-fit:cover;border-radius:6px">` : ''}<b class="small">${esc(a.title)}</b></div></td><td class="tiny">${esc(a.placement)}</td><td class="tiny">${a.starts_at ? fmtDate(a.starts_at, false) : 'now'} → ${a.ends_at ? fmtDate(a.ends_at, false) : '∞'}</td><td class="tiny">${num(a.impressions)} views · ${num(a.clicks)} clicks${a.impressions ? ' · ' + (a.clicks / a.impressions * 100).toFixed(1) + '% CTR' : ''}</td><td>${pubToggle(a, 'enabled')}</td>` });

// ----- website settings -----
M.settings = async () => {
  const rows = await api.select('site_settings'); const S = Object.fromEntries(rows.map((r) => [r.key, r.value || {}]));
  const sup = ME.role === 'super_admin';
  const sections = [
    ['payment', '💳 UPI payment (Super Admin, needs fresh 2FA)', [{ k: 'upi_id', label: 'UPI ID (e.g. yourname@okaxis)', hint: 'Exactly as in your UPI app. Leave blank until you have it.' }, { k: 'payee_name', label: 'Payee name shown to customers' }, { k: 'qr_url', label: 'Official UPI QR code image (upload the real QR from your UPI/bank app)', type: 'image', full: true }, { k: 'instructions', label: 'Extra payment instructions', type: 'textarea', full: true }], true],
    ['contact', '📞 Contact details', [{ k: 'whatsapp', label: 'WhatsApp number (10 digits)' }, { k: 'email', label: 'Email' }, { k: 'hours', label: 'Support hours' }, { k: 'address', label: 'Address', full: true }], true],
    ['brand', '🎨 Brand', [{ k: 'name', label: 'Site name' }, { k: 'tagline', label: 'Tagline' }, { k: 'logo_url', label: 'Logo (optional override; default is the SHOPZENT logo)', type: 'image', full: true }, { k: 'favicon_url', label: 'Favicon (optional)', type: 'image', full: true }], true],
    ['home', '🏠 Homepage', [{ k: 'hero_title', label: 'Hero title', full: true }, { k: 'hero_subtitle', label: 'Hero subtitle', type: 'textarea', full: true }, { k: 'announcement', label: 'Top announcement bar (blank = hidden)', full: true }], true],
    ['social', '🔗 Social links (https)', [{ k: 'instagram', label: 'Instagram', type: 'url' }, { k: 'youtube', label: 'YouTube', type: 'url' }, { k: 'facebook', label: 'Facebook', type: 'url' }, { k: 'x', label: 'X / Twitter', type: 'url' }, { k: 'telegram', label: 'Telegram', type: 'url' }], true],
    ['seo', '🔎 SEO', [{ k: 'default_title', label: 'Default title', full: true }, { k: 'default_description', label: 'Default description', type: 'textarea', full: true }, { k: 'og_image', label: 'Share image (1200×630)', type: 'image', full: true }], true],
    ['seller', '🏷️ Seller identity (shown at checkout)', [{ k: 'name', label: 'Business / seller name' }, { k: 'gstin', label: 'GSTIN (if registered)' }, { k: 'address', label: 'Business address', type: 'textarea', full: true }], true],
    ['app', '📱 Android app: icon', [{ k: 'icon', label: 'App icon on customers\' phones (changes when they open the app)', type: 'select', opts: [['auto', 'Automatic (follows the festival)'], ['default', 'Normal logo'], ['diwali', 'Diwali / Dhanteras'], ['holi', 'Holi'], ['christmas', 'Christmas'], ['navratri', 'Navratri / Dussehra']] }], true],
    ['app_push', '🔔 Android app: send a notification (saving sends it to everyone with the app, within ~15 min)', [{ k: 'title', label: 'Title', max: 60 }, { k: 'body', label: 'Message', type: 'textarea', full: true, max: 200 }], true],
    ['delivery_charge', '🚚 Delivery charge (per order)', [{ k: 'enabled', label: 'Charge delivery', type: 'bool', def: true }, { k: 'amount', label: 'Amount (₹)', type: 'number', step: '1' }, { k: 'first_free', label: 'First order free', type: 'bool', def: true }], true],
    ['delivery', '🚚 Delivery estimate', [{ k: 'estimate_text', label: 'Text shown on product & checkout pages', type: 'textarea', full: true }], true],
    ['return_policy', '↩️ Return window', [{ k: 'window_days', label: 'Return window (days after delivery)', type: 'number' }, { k: 'summary', label: 'Short summary shown before checkout', type: 'textarea', full: true }], true],
    ['page_about', '📄 About Us page', [{ k: 'html', label: 'Content (simple HTML: <p>, <h2>, <ul><li>, <b>, <a>) — blank uses the default text', type: 'html', full: true }], true],
    ['page_contact', '📄 Contact page extra text', [{ k: 'html', label: 'Content (simple HTML)', type: 'html', full: true }], true],
    ...['privacy', 'terms', 'refund', 'shipping', 'affiliate', 'wallet', 'coupon', 'downloads'].map((k) => ['legal_' + k, `⚖️ Legal page: ${k}`, [{ k: 'html', label: 'Replace the default page text (simple HTML). Blank = keep the default template.', type: 'html', full: true }], true]),
    ['order_rules', '🛡️ Order rules & anti-abuse', [{ k: 'require_phone', label: 'Customers must add an Indian mobile number before ordering (asked once, saved to profile)', type: 'bool', def: true }, { k: 'block_disposable_email', label: 'Block temporary / disposable email addresses (signup + order)', type: 'bool', def: true }, { k: 'max_orders_per_day', label: 'Max orders per customer per day', type: 'number', min: 1 }, { k: 'cancel_penalty_after', label: 'Penalty starts after this many cancellations in a day', type: 'number' }, { k: 'cancel_penalty_amount', label: 'Penalty per extra cancelled PAID order (₹, from wallet)', type: 'money' }, { k: 'allow_negative_wallet', label: 'Allow wallet to go negative (otherwise unpaid penalties become dues that block new orders)', type: 'bool' }, { k: 'max_unpaid_orders', label: 'Extra (0 = off): max unpaid orders at one time (suggested 3)', type: 'number' }, { k: 'unpaid_cancel_minutes', label: 'Extra (0 = off): auto-cancel orders with NO UTR after this many minutes (suggested 120, minimum 10)', type: 'number' }, { k: 'max_qty_per_product', label: 'Extra (0 = off): max quantity of one product per order (up to 20)', type: 'number' }, { k: 'max_order_value_per_day', label: 'Extra (0 = off): max order value per customer per day (₹)', type: 'money' }, { k: 'min_account_age_minutes', label: 'Extra (0 = off): new accounts must wait this many minutes before ordering', type: 'number' }], true],
    ['blocked_email_domains', '📧 Blocked temporary email domains', [{ k: 'domains', label: 'One domain per line (e.g. mailinator.com). Signups and orders from these are refused.', type: 'textarea', full: true, max: 20000 }], false],
    ['owner_coins', '🪙 Owner coins (Super Admin, needs fresh 2FA)', [{ k: 'monthly_amount', label: 'Coins credited to the owner on the 1st of every month (00:05 IST)', type: 'number' }, { k: 'opening_balance', label: 'Owner opening balance (already applied once)', type: 'number' }, { k: 'owner_email', label: 'Owner account email' }], false],
    ['security', '🛡️ Security settings (Super Admin, needs fresh 2FA)', [{ k: 'captcha_after_failures', label: 'Ask for CAPTCHA after N failed logins', type: 'number' }, { k: 'max_failed_per_minute', label: 'Max failed logins per minute (per account+IP)', type: 'number', maxv: 10 }], false]];
  main().innerHTML = head('Website settings') + '<a class="btn sec sm" href="domain.html" style="margin-bottom:10px">🌐 Domain — connect your own domain →</a><p class="small muted">Everything customers see can be edited here — no code changes needed. HTML is cleaned automatically (scripts are removed).</p>' + sections.map(([key, title, fields], i) => `<details class="card pad" style="margin-bottom:10px" ${i === 0 ? 'open' : ''}><summary style="cursor:pointer;font-weight:700">${esc(title)}</summary><form data-key="${key}" style="margin-top:12px"><div class="form-grid">${fields.map((f) => fieldHtml({ ...f, k: key + '__' + f.k }, S[key]?.[f.k])).join('')}</div>${key === 'payment' ? `<div class="alert warn small">Upload only your <b>genuine</b> UPI QR. Never use a sample or someone else's QR. ${S.payment?.qr_url ? '<button type="button" class="btn xs danger" id="rmqr">Remove QR</button>' : ''}</div>` : ''}<p class="err"></p><button class="btn sm" ${['payment', 'security'].includes(key) && !sup ? 'disabled title="Super Admin only"' : ''}>Save</button></form></details>`).join('');
  sections.forEach(([key, , fields]) => { const form = main().querySelector(`form[data-key="${key}"]`); const fs = fields.map((f) => ({ ...f, k: key + '__' + f.k })); bindFields(form, fs, 'settings');
    form.onsubmit = async (e) => { e.preventDefault(); try { const raw = readFields(form, fs); const val = {}; fields.forEach((f) => { val[f.k] = raw[key + '__' + f.k]; });
      if (key.startsWith('legal_') || key.startsWith('page_')) val.html = val.html ? sanitizeHtml(val.html) : '';
      if (key === 'contact' && val.whatsapp && !/^\d{10,13}$/.test(val.whatsapp.replace(/\D/g, ''))) throw new Error('WhatsApp number should be 10 digits.');
      if (key === 'payment' && val.upi_id && !/^[\w.\-]{2,}@[\w.\-]{2,}$/.test(val.upi_id)) throw new Error('That does not look like a UPI ID (name@bank).');
      await call('admin_upsert_setting', { p_key: key, p_value: { ...(S[key] || {}), ...val }, p_is_public: !['security', 'blocked_email_domains', 'update_notice'].includes(key) }); S[key] = { ...(S[key] || {}), ...val }; ok('Saved ✓'); form.querySelector('.err').textContent = ''; } catch (x) { form.querySelector('.err').textContent = errText(x); } }; });
  if (!DEMO) await noticeCard(main().querySelector('details'));
  $('#rmqr')?.addEventListener('click', async () => { if (!await confirmBox('Remove the UPI QR?', 'Customers will see “QR not available — contact us” until you upload a new one.', { ok: 'Remove', danger: true })) return; try { await call('admin_upsert_setting', { p_key: 'payment', p_value: { ...S.payment, qr_url: '' }, p_is_public: true }); ok('QR removed'); M.settings(); } catch (x) { bad(x); } });
};
// ----- domain (guide + DNS check; a static site cannot attach a domain to itself) -----
const GH_IPS = ['185.199.108.153', '185.199.109.153', '185.199.110.153', '185.199.111.153'];
const cleanDomain = (v) => String(v || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^www\./, '').replace(/\.$/, '');
M.domain = async () => {
  const rows = await api.select('site_settings'); const cur = rows.find((r) => r.key === 'domain')?.value || {};
  const sup = ME.role === 'super_admin';
  main().innerHTML = head('Domain') + `<p class="small muted">Apni website ko apne domain (jaise <b>shopzent.in</b>) pe chalane ke liye. Connect your own domain here.</p>
  <div class="alert warn small"><b>Honest note:</b> a static website cannot attach a domain to itself. This page shows you exactly what to add at your domain seller and <b>checks</b> it. The final switch happens in GitHub (step 3).</div>
  <div class="card pad" style="margin-bottom:12px"><h3>1 · Your domain</h3><form id="df"><div class="form-grid">
    <div class="field"><label for="d_dom">Domain (bina www) / Domain without www</label><input id="d_dom" placeholder="shopzent.in" value="${esc(cur.domain || '')}" autocomplete="off" autocapitalize="none" spellcheck="false" ${sup ? '' : 'disabled'}></div>
    <div class="field"><label for="d_gh">GitHub username</label><input id="d_gh" placeholder="your-github-username" value="${esc(cur.github_user || 'ravikumar9142177')}" autocomplete="off" autocapitalize="none" spellcheck="false" ${sup ? '' : 'disabled'}><span class="hint">Used for the www record. Example: if your site is <b>ravikumar9142177.github.io</b>, type <b>ravikumar9142177</b>.</span></div></div>
    <p class="err" id="de"></p>${sup ? '<button class="btn" id="ds">Save domain</button>' : '<p class="small muted">Only the Super Admin can change the domain.</p>'}</form></div>
  <div class="card pad" style="margin-bottom:12px"><h3>2 · DNS records — add these at your domain seller</h3><p class="small muted">Hostinger / GoDaddy / Namecheap → your domain → <b>DNS / Manage DNS</b>. Delete any old A records for <b>@</b> (parking page), then add these. Changes take 10 min to a few hours.</p><div id="drec"></div>
    <button class="btn sec" id="dchk" style="margin-top:12px">🔍 Check DNS</button><p class="tiny muted" id="dchk-at"></p></div>
  <div class="card pad"><h3>3 · Last step (GitHub)</h3><ol class="small"><li>GitHub → your repository → <b>Settings → Pages</b>.</li><li><b>Custom domain</b> me apna domain likho (<b id="dname">${esc(cur.domain || 'yourdomain.in')}</b>) → <b>Save</b>. GitHub checks the DNS.</li><li>DNS check green hone ke baad <b>Enforce HTTPS</b> tick karo (the certificate can take up to ~1 hour the first time).</li><li>The repository also keeps a <b>CNAME</b> file containing your domain, so the deploy uses the right address.</li></ol>
    <div class="alert small" id="dstat">Tab can do this GitHub step for you once the domain is added — just message Tab on WhatsApp. No GitHub password or token is ever put in this website.</div></div>`;
  const recs = () => { const d = cleanDomain($('#d_dom').value) || 'yourdomain.in', gh = String($('#d_gh').value || '').trim().toLowerCase() || '<github-username>';
    return [...GH_IPS.map((ip) => ({ type: 'A', host: '@', value: ip, id: 'a' + ip })), { type: 'CNAME', host: 'www', value: gh + '.github.io', id: 'cname' }].map((r) => ({ ...r, d })); };
  const drawRecs = (res = {}) => { $('#drec').innerHTML = `<table class="tbl"><tr><th>Type</th><th>Name / Host</th><th>Value / Points to</th><th></th><th></th></tr>${recs().map((r) => `<tr><td><b>${r.type}</b></td><td><code>${esc(r.host)}</code></td><td><code>${esc(r.value)}</code></td><td><button class="btn xs sec" type="button" data-cp="${esc(r.value)}">Copy</button></td><td data-res="${esc(r.id)}">${res[r.id] == null ? '' : res[r.id] ? '✅' : '❌'}</td></tr>`).join('')}</table><p class="tiny muted">TTL: leave the default (or 1 hour).</p>`; $('#dname').textContent = cleanDomain($('#d_dom').value) || 'yourdomain.in'; };
  drawRecs(); $('#d_dom').addEventListener('input', () => drawRecs()); $('#d_gh').addEventListener('input', () => drawRecs());
  main().addEventListener('click', (e) => { const b = e.target.closest('[data-cp]'); if (!b) return; navigator.clipboard?.writeText(b.dataset.cp).then(() => ok('Copied: ' + b.dataset.cp), () => toast(b.dataset.cp)); });
  $('#ds')?.addEventListener('click', async (e) => { e.preventDefault(); $('#de').textContent = ''; const d = cleanDomain($('#d_dom').value), gh = String($('#d_gh').value || '').trim().toLowerCase();
    if (d && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d)) { $('#de').textContent = 'That does not look like a domain (e.g. shopzent.in).'; return; }
    if (gh && !/^[a-z0-9](?:[a-z0-9-]{0,38})$/.test(gh)) { $('#de').textContent = 'GitHub usernames use letters, numbers and dashes only.'; return; }
    try { await call('admin_upsert_setting', { p_key: 'domain', p_value: { domain: d, github_user: gh }, p_is_public: true }); $('#d_dom').value = d; drawRecs(); ok('Saved ✓ — canonical/share links now use ' + (d ? 'https://' + d : 'this site’s address')); } catch (x) { $('#de').textContent = errText(x); } });
  $('#dchk').addEventListener('click', async () => { const d = cleanDomain($('#d_dom').value), gh = String($('#d_gh').value || '').trim().toLowerCase();
    if (!d) { $('#dchk-at').textContent = 'Enter your domain first.'; return; } $('#dchk').disabled = true; $('#dchk-at').textContent = 'Checking…';
    const q = async (name, type) => { const r = await fetch(`https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`, { headers: { accept: 'application/dns-json' } }); if (!r.ok) throw new Error('DNS lookup failed'); return (await r.json()).Answer || []; };
    try { const [a, c] = await Promise.all([q(d, 'A'), q('www.' + d, 'CNAME')]); const ips = a.filter((x) => x.type === 1).map((x) => x.data); const cn = c.filter((x) => x.type === 5).map((x) => String(x.data).toLowerCase().replace(/\.$/, ''));
      const res = Object.fromEntries(GH_IPS.map((ip) => ['a' + ip, ips.includes(ip)])); res.cname = !!gh && cn.includes(gh + '.github.io'); drawRecs(res);
      const extra = ips.filter((ip) => !GH_IPS.includes(ip)); const allOk = Object.values(res).every(Boolean) && !extra.length;
      $('#dchk-at').innerHTML = `${allOk ? '✅ All records are correct.' : '❌ Not ready yet.'} ${extra.length ? `Remove these old A records: <b>${extra.map(esc).join(', ')}</b>.` : ''} ${!gh ? 'Add your GitHub username to check the www record.' : ''} <span class="muted">Checked ${new Date().toLocaleTimeString('en-IN')} via Google public DNS. New records can take a few hours to appear.</span>`;
      $('#dstat').innerHTML = allOk ? `✅ DNS is ready. Last step: GitHub → Settings → Pages → Custom domain <b>${esc(d)}</b> → Save → tick <b>Enforce HTTPS</b>, and the CNAME file. Tab can do this step for you — just message Tab.` : 'DNS is not ready yet. Once all rows show ✅, do the GitHub step (Tab can do it for you — just message Tab). No GitHub password or token is ever put in this website.'; }
    catch (x) { $('#dchk-at').textContent = 'Could not reach the DNS checker right now — try again in a minute.'; } finally { $('#dchk').disabled = false; } });
  if (cur.domain) $('#dchk').click();
};

// ----- publish / unpublish (maintenance mode) -----
async function siteCard(before) {
  let st; try { st = await api.rpc('admin_site_status'); } catch { return; }
  const live = st.published !== false;
  before.insertAdjacentHTML('beforebegin', `<div class="card pad" id="site-card" style="margin-bottom:16px;border:2px solid ${live ? '#10B981' : '#EF4444'};background:${live ? '#F0FDF4' : '#FEF2F2'}">
    <div class="row between" style="gap:12px;align-items:center;flex-wrap:wrap"><div style="min-width:220px;flex:1"><div style="font-size:1.25rem;font-weight:700">${live ? '🟢 Website is LIVE' : '🔴 Website is CLOSED (maintenance)'}</div>
    <div class="small muted" style="margin-top:4px">${live ? 'Customers can browse and order.' : 'Customers see the “Website abhi thodi der ke liye band hai” page and cannot order. This admin panel works as normal.'}${st.updated_at ? ' · last changed ' + esc(fmtDate(st.updated_at)) : ''}</div></div>
    <button class="btn" id="site-toggle" style="width:100%;max-width:280px;height:54px;font-size:1.02rem;background:${live ? '#DC2626' : '#16A34A'}">${live ? '⏸️ Unpublish website' : '▶️ Publish website'}</button></div></div>`);
  $('#site-toggle').onclick = () => {
    modal(live
      ? `<h3 style="margin-top:0">Unpublish the website?</h3><p class="small">Customers will immediately see the “thodi der ke liye band hai” page and <b>cannot browse or place orders</b> (also blocked on the server). You and this admin panel keep working. Publish again from the Dashboard.</p><div class="field"><label for="sm">Extra message for customers (optional, max 300 characters)</label><textarea id="sm" maxlength="300" rows="3" placeholder="e.g. Aaj raat 11 baje tak maintenance chal raha hai"></textarea></div><p class="err" id="se"></p><div class="row" style="justify-content:flex-end"><button class="btn sec sm" data-close>Cancel</button><button class="btn sm danger" id="sy">Yes, unpublish</button></div>`
      : `<h3 style="margin-top:0">Publish the website?</h3><p class="small">Customers will be able to browse and order again right away.</p><p class="err" id="se"></p><div class="row" style="justify-content:flex-end"><button class="btn sec sm" data-close>Cancel</button><button class="btn sm" id="sy" style="background:#16A34A">Yes, publish</button></div>`,
      { onOpen: (el, close) => { el.querySelector('#sy').onclick = async () => { el.querySelector('#sy').disabled = true; try { await call('admin_set_site_published', { p_published: !live, p_message: live ? (el.querySelector('#sm').value.trim() || null) : null }); close(); ok(live ? 'Website is now CLOSED' : 'Website is LIVE again'); M.dashboard(); const p = $('#site-pill'); if (p) { p.className = 'tag ' + (live ? 'red' : 'green'); p.textContent = live ? '● CLOSED' : '● LIVE'; } } catch (x) { el.querySelector('#se').textContent = errText(x); el.querySelector('#sy').disabled = false; } }; } });
  };
}

// ----- customer "new update" notices (Settings card) -----
async function noticeCard(before) {
  if (!before) return;
  let s; try { s = await api.rpc('admin_update_notice_status'); } catch { return; }
  before.insertAdjacentHTML('beforebegin', `<div class="card pad" id="notice-card" style="margin-bottom:12px"><h3 style="margin-top:0">🔔 Customer update notices</h3>
    <p class="small muted">When you change the website (products, prices, banners, settings…), every customer gets a bell message “Website me naya update hua hai. Dekhne ke liye refresh karein.” — it never says <i>what</i> changed. In-app only; nothing goes out by email, SMS or WhatsApp.</p>
    <form id="nf" class="grid g2" style="gap:12px"><label class="row" style="gap:8px;align-items:center"><input type="checkbox" id="n-on" ${s.enabled ? 'checked' : ''}> <b>Send update notices automatically</b></label>
    <div class="field" style="margin:0"><label for="n-cd">At most one notice every … hours</label><input id="n-cd" type="number" min="0.25" max="720" step="0.25" value="${esc(Number(s.cooldown_hours))}"></div>
    <label class="row small" style="gap:8px;align-items:center;opacity:.6"><input type="checkbox" disabled> Also send by email (not available — always OFF, nothing is ever emailed)</label>
    <div class="small muted">Last notice: <b>${s.last_sent_at ? esc(fmtDate(s.last_sent_at)) : 'never'}</b>${s.last_recipients != null ? ` (${num(s.last_recipients)} customers)` : ''}<br>${s.pending ? 'Edits are waiting — one notice goes out when the wait is over.' : 'No edits waiting.'} · Customers now: <b>${num(s.customers)}</b></div>
    <p class="err" id="ne" style="grid-column:1/-1;margin:0"></p><div class="row" style="grid-column:1/-1;gap:10px;flex-wrap:wrap"><button class="btn sm" id="n-save">Save</button><button class="btn sec sm" type="button" id="n-now">📣 Send update notice now</button></div></form></div>`);
  $('#nf').onsubmit = async (e) => { e.preventDefault(); try { await call('admin_upsert_setting', { p_key: 'update_notice', p_value: { enabled: $('#n-on').checked, cooldown_hours: Number($('#n-cd').value), send_email: false }, p_is_public: false }); ok('Saved ✓'); $('#ne').textContent = ''; } catch (x) { $('#ne').textContent = errText(x); } };
  $('#n-now').onclick = async () => { if (!await confirmBox('Send update notice now?', `All ${num(s.customers)} customers get the “naya update” bell message right away (ignores the wait time).`, { ok: 'Send now' })) return;
    try { const r = await call('admin_send_update_notice', {}); ok(`Sent to ${num(r.recipients)} customers ✓`); } catch (x) { bad(x.message === 'too_soon' || /too_soon/.test(x.message) ? new Error('Just sent — wait a minute.') : x); } };
}

// ----- hacker alerts -----
const KIND = { login_locked: 'Login locked: too many wrong passwords', login_locked_retry: 'Keeps trying a locked login', wrong_password_burst: 'Many wrong passwords', admin_login_failed: 'ADMIN login failed',
  mfa_failure: 'Wrong 2-step code', disposable_signup: 'Fake / temporary email signup', duplicate_utr: 'Used payment reference (UTR) again', bulk_orders: 'Many orders in a short time',
  frame_bust: 'Site shown inside another website', injection_payload: 'Script / SQL-looking text', admin_ui_denied: 'Customer opened the admin panel' };
const SEV = { low: ['gray', '#9CA3AF'], medium: ['orange', '#F97316'], high: ['red', '#EF4444'], critical: ['dark', '#7F1D1D'] };
// ----- Tap Rush (migration 0027): weekly target + prizes, winners' photo and name approval -----
const gwCompress = async (file) => {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const sc = Math.min(1, 300 / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas'); c.width = Math.max(1, Math.round(img.naturalWidth * sc)); c.height = Math.max(1, Math.round(img.naturalHeight * sc));
    const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
    for (const q of [0.85, 0.75, 0.65, 0.55, 0.45]) { const b = await new Promise((r) => c.toBlob(r, 'image/jpeg', q)); if (b && b.size <= 300 * 1024) return b; }
    throw new Error('Photo bahut badi hai, dusri photo lo.');
  } finally { URL.revokeObjectURL(url); }
};
const gwPublic = async (file) => (await api.upload('public-media', new File([await gwCompress(file)], 'photo.jpg', { type: 'image/jpeg' }), 'settings/game-winners')).path;
M.visitors = async () => {
  const BIHAR = ["Araria", "Arwal", "Aurangabad", "Banka", "Begusarai", "Bhagalpur", "Bhojpur", "Buxar", "Darbhanga", "East Champaran", "Gaya", "Gopalganj", "Jamui", "Jehanabad", "Kaimur", "Katihar", "Khagaria", "Kishanganj", "Lakhisarai", "Madhepura", "Madhubani", "Munger", "Muzaffarpur", "Nalanda", "Nawada", "Patna", "Purnia", "Rohtas", "Saharsa", "Samastipur", "Saran", "Sheikhpura", "Sheohar", "Sitamarhi", "Siwan", "Supaul", "Vaishali", "West Champaran"], STATES = ["Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh", "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka", "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram", "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu", "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal", "Delhi", "Jammu and Kashmir", "Ladakh", "Chandigarh", "Puducherry", "Andaman and Nicobar Islands", "Dadra and Nagar Haveli and Daman and Diu", "Lakshadweep"];
  const ist = (d) => new Date(d.getTime() + 330 * 6e4).toISOString().slice(0, 10); const today = ist(new Date()), d30 = ist(new Date(Date.now() - 29 * 864e5));
  main().innerHTML = head('Visitors & users') + `<div class="card pad" style="margin-bottom:14px"><div class="row" style="gap:8px;flex-wrap:wrap;align-items:flex-end"><label class="small">Se (date)<input type="date" id="vf" value="${d30}" max="${today}"></label><label class="small">Tak (date)<input type="date" id="vt" value="${today}" max="${today}"></label><button class="btn sm" id="vg">Dikhao</button><button class="btn sm sec" data-q="0">Aaj</button><button class="btn sm sec" data-q="29">30 din</button><button class="btn sm sec" data-q="89">90 din</button></div></div><div id="vs">Loading…</div>`;
  const n = (v) => num(v || 0); const pct = (a, b) => b ? (Math.round(a / b * 1000) / 10).toFixed(1) + '%' : '0%'; const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const bar = (rows, total) => rows.map((r) => `<div class="row" style="gap:8px;flex-wrap:nowrap;margin:3px 0"><span class="small" style="width:150px;flex:none">${esc(r.name)}</span><div style="flex:1;background:#F1ECFE;border-radius:8px;height:16px"><div style="width:${r.n ? Math.max(2, Math.round(r.n / Math.max(1, total) * 100)) : 0}%;background:var(--grad);height:16px;border-radius:8px"></div></div><span class="tiny" style="width:92px;flex:none;text-align:right">${n(r.n)} · ${pct(r.n, total)}</span></div>`).join('');
  const load = async () => {
    const from = $('#vf').value, to = $('#vt').value; let s; try { s = await call('admin_visit_stats', { p_from: from || null, p_to: to || null }); } catch (x) { return bad(x); }
    const P = s.periods || {}, c = s.custom || {}, lab = { 1: 'Aaj', 7: '7 din', 30: '30 din', 90: '90 din' };
    const row = (d) => { const p = P[String(d)] || {}; return `<tr><td><b>${lab[d]}</b></td><td>${n(p.visitors)}</td><td>${n(p.visits)}</td><td>${n(p.logged_visitors)}</td><td>${n(p.anon_visitors)}</td><td>${n(p.registered_new)}</td><td>${n(p.app_visitors)}</td></tr>`; };
    const gv = c.geo_visitors || 0; const stMap = {}; (c.states || []).forEach((x) => { stMap[norm(x.name)] = x.n; });
    const stRows = STATES.map((nm) => ({ name: nm, n: stMap[norm(nm)] || 0 })); const known = new Set(STATES.map(norm)); (c.states || []).filter((x) => !known.has(norm(x.name))).forEach((x) => stRows.push({ name: x.name, n: x.n })); stRows.sort((a, b) => b.n - a.n);
    const biMap = {}; (c.districts || []).forEach((x) => { biMap[norm(x.name)] = (biMap[norm(x.name)] || 0) + x.n; }); const bRows = BIHAR.map((nm) => ({ name: nm, n: biMap[norm(nm)] || 0 })); const bk = new Set(BIHAR.map(norm)); (c.districts || []).filter((x) => !bk.has(norm(x.name))).forEach((x) => bRows.push({ name: x.name + ' (other)', n: x.n })); bRows.sort((a, b) => b.n - a.n);
    const bTot = (c.districts || []).reduce((t, x) => t + x.n, 0), mx = Math.max(1, ...(c.daily || []).map((x) => Number(x.visits)));
    main().querySelector('#vs').innerHTML = `<div class="kpis"><div class="kpi g"><b>${n(s.new_today)}</b><span>Aaj naye register hue</span></div><div class="kpi"><b>${n(s.old_users)}</b><span>Purane registered (aaj se pehle)</span></div><div class="kpi"><b>${n(s.users_total)}</b><span>Total registered users</span></div></div>
    <div class="card pad" style="margin-top:14px"><h3 style="margin-top:0">Chune hue din: ${esc(String(c.from))} se ${esc(String(c.to))}</h3><div class="kpis"><div class="kpi g"><b>${n(c.visitors)}</b><span>Total visitors (bina login wale bhi)</span></div><div class="kpi"><b>${n(c.visits)}</b><span>Total visits</span></div><div class="kpi"><b>${n(c.logged_visitors)}</b><span>Login wale visitors</span></div><div class="kpi"><b>${n(c.anon_visitors)}</b><span>Bina login wale</span></div><div class="kpi"><b>${n(c.registered_new)}</b><span>In dino me naye register</span></div></div></div>
    <div class="card pad" style="margin-top:14px"><h3 style="margin-top:0">Aaj / 7 / 30 / 90 din</h3><div style="overflow:auto"><table class="tbl" style="width:100%"><thead><tr><th>Period</th><th>Visitors</th><th>Visits</th><th>Login wale</th><th>Bina login</th><th>Naye register</th><th>APK se</th></tr></thead><tbody>${[1, 7, 30, 90].map(row).join('')}</tbody></table></div>
    <p class="tiny muted" style="margin:8px 0 0">Visitor = ek phone/browser (din me ek hi baar ginta hai), login ho ya na ho. Visit = page khulna. Ginti ${s.tracking_since ? esc(String(s.tracking_since)) + ' se' : 'abhi se'} shuru hui, isse pehle ka data nahi hai.</p></div>
    <div class="card pad" style="margin-top:14px"><h3 style="margin-top:0">Jagah ke hisaab se: Rajya → Jila → Gaon</h3><p class="tiny muted" style="margin:0 0 8px">Sirf unhi visitors ki jagah ginti hai jinhone browser ka “Allow” dabaya: ${n(gv)} / ${n(c.visitors)} visitors (${pct(gv, c.visitors)}). Percent in ${n(gv)} ka hai. Ye ginti hai, kisi ek insaan ka naam/pata/live location nahi dikhta. Border ke paas jagah thodi galat ho sakti hai.</p><div id="vplace"></div></div>
    <div class="card pad" style="margin-top:14px"><h3 style="margin-top:0">Roz ka graph (chune hue din, max 31)</h3>${(c.daily || []).length ? c.daily.map((x) => `<div class="row" style="gap:8px;flex-wrap:nowrap;margin:4px 0"><span class="tiny" style="width:64px">${esc(String(x.day).slice(5))}</span><div style="flex:1;background:#F1ECFE;border-radius:8px;height:18px"><div style="width:${Math.max(3, Math.round(Number(x.visits) / mx * 100))}%;background:var(--grad);height:18px;border-radius:8px"></div></div><span class="tiny" style="width:150px">${n(x.visitors)} log · ${n(x.visits)} visits</span></div>`).join('') : '<p class="muted small">Is range me data nahi.</p>'}</div>`;
  };

  const placeRender = async () => { const box = main().querySelector('#vplace'); if (!box) return; let pr; try { pr = await call('admin_visit_places', { p_from: $('#vf').value || null, p_to: $('#vt').value || null }); } catch (x) { box.innerHTML = '<p class="muted small">Jagah ka data nahi aa paya.</p>'; return; }
    const rows = pr.rows || []; let st = null, di = null;
    const sum = (arr) => arr.reduce((t, x) => t + x.n, 0);
    const draw = () => {
      if (!rows.length) { box.innerHTML = '<p class="muted small">Abhi kisi ne location allow nahi ki.</p>'; return; }
      if (st === null) { const m = {}; rows.forEach((r) => { m[r.state] = (m[r.state] || 0) + r.n; }); const list = STATES.map((nm) => ({ name: nm, n: Object.keys(m).filter((k) => norm(k) === norm(nm)).reduce((t, k) => t + m[k], 0) })); const kn = new Set(STATES.map(norm)); Object.keys(m).filter((k) => !kn.has(norm(k))).forEach((k) => list.push({ name: k, n: m[k] })); list.sort((a2, b2) => b2.n - a2.n);
        const tot = sum(list); box.innerHTML = `<b class="small">India ke rajya (tap karo)</b>` + list.map((r) => `<button type="button" class="vp-row" data-s="${esc(r.name)}"><span>${esc(r.name)}</span><i style="flex:1;background:#F1ECFE;border-radius:8px;height:14px;margin:0 8px"><u style="display:block;width:${r.n ? Math.max(2, Math.round(r.n / Math.max(1, tot) * 100)) : 0}%;background:var(--grad);height:14px;border-radius:8px"></u></i><em>${n(r.n)} · ${pct(r.n, tot)}</em></button>`).join(''); box.querySelectorAll('[data-s]').forEach((b) => b.onclick = () => { st = b.dataset.s; di = null; draw(); }); return; }
      const inS = rows.filter((r) => norm(r.state) === norm(st));
      if (di === null) { const m = {}; inS.forEach((r) => { const k = r.district || '(jila pata nahi)'; m[k] = (m[k] || 0) + r.n; }); let list = Object.keys(m).map((k) => ({ name: k, n: m[k] }));
        if (norm(st) === 'bihar') { const have = new Set(list.map((x) => norm(x.name))); BIHAR.filter((b2) => !have.has(norm(b2))).forEach((b2) => list.push({ name: b2, n: 0 })); }
        list.sort((a2, b2) => b2.n - a2.n); const tot = sum(list); box.innerHTML = `<button type="button" class="btn sm sec" id="vp-b">← Saare rajya</button> <b>${esc(st)}</b> <span class="tag gray">${n(tot)} visitors</span><div style="margin-top:8px">` + list.map((r) => `<button type="button" class="vp-row" data-d="${esc(r.name)}"><span>${esc(r.name)}</span><i style="flex:1;background:#F1ECFE;border-radius:8px;height:14px;margin:0 8px"><u style="display:block;width:${r.n ? Math.max(2, Math.round(r.n / Math.max(1, tot) * 100)) : 0}%;background:var(--grad);height:14px;border-radius:8px"></u></i><em>${n(r.n)} · ${pct(r.n, tot)}</em></button>`).join('') + '</div>';
        box.querySelector('#vp-b').onclick = () => { st = null; draw(); }; box.querySelectorAll('[data-d]').forEach((b) => b.onclick = () => { di = b.dataset.d; draw(); }); return; }
      const inD = inS.filter((r) => (r.district || '(jila pata nahi)') === di); const m = {}; const last = {}; inD.forEach((r) => { const k = r.village || '(gaon pata nahi)'; m[k] = (m[k] || 0) + r.n; if (!last[k] || r.last > last[k]) last[k] = r.last; });
      const list = Object.keys(m).map((k) => ({ name: k, n: m[k], last: last[k] })).sort((a2, b2) => b2.n - a2.n); const tot = sum(list);
      box.innerHTML = `<button type="button" class="btn sm sec" id="vp-b">← ${esc(st)}</button> <b>${esc(di)}</b> <span class="tag gray">${n(tot)} visitors</span><div style="margin-top:8px">` + (list.length ? list.map((r) => `<div class="vp-row" style="cursor:default"><span>${esc(r.name)}</span><i style="flex:1;background:#F1ECFE;border-radius:8px;height:14px;margin:0 8px"><u style="display:block;width:${Math.max(2, Math.round(r.n / Math.max(1, tot) * 100))}%;background:var(--grad);height:14px;border-radius:8px"></u></i><em>${n(r.n)} · ${pct(r.n, tot)} · aakhri: ${esc(String(r.last || '').slice(5))}</em></div>`).join('') : '<p class="muted small">Is jile me abhi koi nahi.</p>') + '</div><p class="tiny muted">Gaon/shehar ka naam sirf naye visitors se aata hai. Ye sirf ginti hai, live location nahi.</p>';
      box.querySelector('#vp-b').onclick = () => { di = null; draw(); }; };
    draw(); };
  const loadAll = async () => { await load(); await placeRender(); };
  $('#vg').onclick = loadAll; $$('[data-q]').forEach((b) => b.onclick = () => { $('#vf').value = ist(new Date(Date.now() - Number(b.dataset.q) * 864e5)); $('#vt').value = today; loadAll(); });
  await loadAll();
};
M.festival = async () => (await import('./festival-studio.js')).renderFestivalStudio({ main, head, call, ok, bad });
M['game-winners'] = async () => {
  main().innerHTML = head('Game winners (Tap Rush)') + `<div class="alert small">Tap Rush: har hafte pehle 3 alag accounts jo <b>target score</b> tak pahunchein, unhe 1st/2nd/3rd prize coins milte hain (coins points hain, cash nahi). Winner ki photo aur naam <b>aap approve karoge</b>; tabhi game ke neeche dikhenge. Har action audit me jaata hai.</div>
  <div class="card pad" style="margin-bottom:14px"><h3 style="margin-top:0">Game settings</h3><div id="gw-set" class="row" style="gap:10px;flex-wrap:wrap">Loading…</div></div>
  <div class="card pad" style="margin-bottom:14px"><h3 style="margin-top:0">Podium me khud ka naam + photo (jab koi na jeete)</h3><p class="small muted" style="margin:0 0 8px">Jab 1st/2nd/3rd par koi winner nahi hota, yahan se aap apna naam aur photo laga sakte ho. Jab asli winner aayega (aur aap approve karoge) to wo uski jagah dikhega. Asli winner ki photo 7 din baad apne aap hat jati hai.</p><div id="gw-pod">Loading…</div></div>
  <div class="card pad"><div class="row between" style="flex-wrap:wrap;gap:8px"><h3 style="margin:0">Winners</h3><span class="small muted" id="gw-tot"></span></div><div id="gw-list" style="margin-top:10px">Loading…</div></div>`;
  let st = {}; try { const row = await api.select('site_settings', { eq: { key: 'game_weekly' }, single: true }); st = row?.value || {}; } catch {}
  const pr = Array.isArray(st.prizes) ? st.prizes : [30, 20, 10];
  $('#gw-set').innerHTML = `<label class="small row" style="gap:6px"><input type="checkbox" id="gw-en" ${st.enabled !== false ? 'checked' : ''}> Game on</label>
    <label class="small">Target score <input id="gw-t" type="number" min="100" max="1000000" value="${esc(st.target_score || 3600)}" style="width:110px"></label>
    <label class="small">1st <input id="gw-p1" type="number" min="0" max="30" value="${esc(pr[0])}" style="width:70px"></label>
    <label class="small">2nd <input id="gw-p2" type="number" min="0" max="30" value="${esc(pr[1])}" style="width:70px"></label>
    <label class="small">3rd <input id="gw-p3" type="number" min="0" max="30" value="${esc(pr[2])}" style="width:70px"></label>
    <button class="btn sm" id="gw-save">Save settings</button><span class="tiny muted" style="width:100%">Prize har place ke liye 0–30, teeno ka total 60 se zyada nahi. Target 3600 default hai: simulated player (97% hits, ~215 ms reaction) reaches it ~1 in 5 runs, 90% hits almost never. Simulation, not real player data; admin badal sakta hai.</span>`;
  $('#gw-save').onclick = async () => {
    try { await call('admin_set_game_settings', { p_enabled: $('#gw-en').checked, p_target: Number($('#gw-t').value), p_prizes: [Number($('#gw-p1').value), Number($('#gw-p2').value), Number($('#gw-p3').value)] }); ok('Game settings saved ✓'); }
    catch (x) { bad(x); }
  };
  const podLoad = async () => { let cur = {}; try { cur = await call('admin_get_game_podium', {}); } catch {}
    $('#gw-pod').innerHTML = [1, 2, 3].map((pl) => { const c = cur[String(pl)] || {}; return `<div class="row" style="gap:8px;flex-wrap:wrap;align-items:flex-end;margin-bottom:10px;border-bottom:1px solid var(--line);padding-bottom:10px"><b style="width:46px">${pl === 1 ? '🥇 1st' : pl === 2 ? '🥈 2nd' : '🥉 3rd'}</b>${c.photo_path ? `<img src="${esc(media(c.photo_path))}" alt="" style="width:44px;height:44px;border-radius:50%;object-fit:cover">` : ''}<input class="pd-n" data-p="${pl}" maxlength="30" placeholder="Naam" value="${esc(c.name || '')}" style="width:150px"><input type="file" accept="image/*" class="pd-f" data-p="${pl}" style="max-width:190px"><button class="btn sm pd-s" data-p="${pl}">Save</button><button class="btn sm sec pd-c" data-p="${pl}">Hatao</button></div>`; }).join('');
    $$('.pd-s').forEach((b) => b.onclick = async () => { const pl = Number(b.dataset.p), nm = $(`.pd-n[data-p="${pl}"]`).value.trim(), fl = $(`.pd-f[data-p="${pl}"]`).files[0]; if (nm.length < 2) return bad(new Error('Naam likho (2+ letters).'));
      try { b.disabled = true; let path = (cur[String(pl)] || {}).photo_path || null; if (fl) path = await gwPublic(fl); await call('admin_set_game_podium', { p_place: pl, p_name: nm, p_public_path: path }); ok('Podium saved ✓'); podLoad(); } catch (x) { bad(x); } b.disabled = false; });
    $$('.pd-c').forEach((b) => b.onclick = async () => { try { await call('admin_set_game_podium', { p_place: Number(b.dataset.p), p_name: '', p_public_path: null }); ok('Hata diya'); podLoad(); } catch (x) { bad(x); } }); };
  podLoad();
  const load = async () => {
    let d; try { d = await call('admin_game_winners_list', { p_weeks: 8 }); } catch (x) { return bad(x); }
    $('#gw-tot').textContent = `Pending: ${d.pending || 0} · this week ${d.week_key || ''}`;
    const rows = d.rows || [];
    if (!rows.length) { $('#gw-list').innerHTML = '<p class="small muted">Abhi koi winner nahi.</p>'; return; }
    $('#gw-list').innerHTML = rows.map((r) => {
      const pending = r.submit_status === 'pending', approved = r.submit_status === 'approved';
      const nameVal = approved ? (r.name_approved || '') : (r.name_submitted || '');
      return `<div class="card pad" style="box-shadow:none;border:1px solid var(--line);margin-bottom:10px" data-id="${esc(r.id)}">
      <div class="row between" style="flex-wrap:wrap;gap:6px"><b class="small">${esc(r.week_key)} · #${esc(r.place)} · ${esc(r.customer_id || '')}</b>
        <span class="tag ${approved ? 'green' : r.submit_status === 'rejected' ? 'red' : pending ? 'pink' : 'orange'}">${esc(r.submit_status === 'none' ? 'no photo / name yet' : r.submit_status)}</span></div>
      <div class="tiny muted">${esc(r.full_name || '—')} · score ${num(r.score)} · ${num(r.coins)} coins · won ${fmtDate(r.won_at)}</div>
      ${r.submit_status === 'rejected' ? `<div class="tiny muted">Reject reason: ${esc(r.reject_reason || '')}</div>` : ''}
      <div class="row" style="gap:12px;align-items:flex-start;margin-top:8px;flex-wrap:wrap">
        <div data-prev style="width:120px;height:120px;border-radius:12px;background:#f3f4f6;display:grid;place-items:center;overflow:hidden"><span class="tiny muted">loading…</span></div>
        <div style="flex:1;min-width:220px;display:grid;gap:8px">
          <label class="small">Edit name (2–30, bina link ke)<input data-name value="${esc(nameVal)}" maxlength="30" placeholder="Winner ka naam"></label>
          <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
            <label class="btn sec sm" style="position:relative;cursor:pointer">📷 Upload photo<input type="file" accept="image/*" data-file style="position:absolute;width:1px;height:1px;opacity:0;pointer-events:none"></label>
            <span class="tiny muted" data-fname>${pending ? 'Customer ki bheji photo (badalna ho to upload karo)' : 'JPG/PNG, 300 px me compress hoga'}</span>
          </div>
          <div class="row" style="gap:6px;flex-wrap:wrap">
            <button class="btn sm" data-save data-mode="${pending ? 'approve' : 'save'}">${pending ? 'Approve' : 'Save name / photo'}</button>
            ${pending ? '<button class="btn danger sm" data-rj>Reject</button>' : ''}
            ${approved ? '<button class="btn danger sm" data-rj>Remove from game</button>' : ''}
          </div>
          <p class="tiny muted" style="margin:0">${pending ? 'Customer ne bheja hai. Approve karte hi ye naam aur photo game ke neeche live ho jayenge.' : 'Admin ka set kiya naam aur photo turant game ke podium par dikhega (koi customer submission nahi chahiye).'}</p>
        </div></div></div>`;
    }).join('');
    // previews: pending photo from the private bucket (signed link), approved photo from the public bucket
    for (const r of rows) {
      const box = document.querySelector(`#gw-list [data-id="${CSS.escape(String(r.id))}"] [data-prev]`); if (!box) continue;
      try {
        if (r.submit_status === 'pending' && r.photo_pending_path) { const u = await api.signedUrl('game-photos', r.photo_pending_path, 600); box.innerHTML = `<img src="${esc(u)}" alt="" style="width:100%;height:100%;object-fit:cover">`; }
        else if (r.submit_status === 'approved' && r.photo_public_path) { const base = String(config.SUPABASE_URL || '').replace(/\/+$/, ''); box.innerHTML = `<img src="${esc(base + '/storage/v1/object/public/public-media/' + r.photo_public_path.split('/').map(encodeURIComponent).join('/'))}" alt="" style="width:100%;height:100%;object-fit:cover">`; }
        else box.innerHTML = '<span class="tiny muted">no photo</span>';
      } catch { box.innerHTML = '<span class="tiny muted">photo not loading</span>'; }
    }
  };
  $('#gw-list').addEventListener('change', (e) => {
    const f = e.target.closest('[data-file]'); if (!f) return;
    const card = f.closest('[data-id]'); const file = f.files && f.files[0]; if (!card || !file) return;
    if (!/^image\//.test(file.type)) { f.value = ''; return bad('Sirf photo (JPG/PNG) chuno.'); }
    card.querySelector('[data-fname]').textContent = `${file.name.slice(0, 40)} · ${Math.round(file.size / 1024)} KB (save par compress hoga)`;
    card.querySelector('[data-prev]').innerHTML = `<img src="${URL.createObjectURL(file)}" alt="" style="width:100%;height:100%;object-fit:cover">`;
  });
  $('#gw-list').addEventListener('click', async (e) => {
    const card = e.target.closest('[data-id]'); if (!card) return;
    const b = e.target.closest('button'); if (!b) return;
    const id = Number(card.dataset.id), name = card.querySelector('[data-name]').value.trim();
    if (b.matches('[data-save]')) {
      const fileIn = card.querySelector('[data-file]'); const file = fileIn && fileIn.files[0];
      const pend = b.dataset.mode === 'approve';
      if (name.length < 2 || name.length > 30 || /(:\/\/|www\.|@|[<>]|\.(com|in|net|org|shop|co|io|me|xyz|info|app|ru|tk)\b)/i.test(name) || /[\x00-\x1f\x7f]/.test(name)) return bad('Naam 2–30 characters ka ho, bina link, @ ya < > ke.');
      const c = await confirmBox(pend ? 'Approve this photo and name?' : 'Save this name / photo?', pend ? 'Ye photo aur naam game ke neeche live ho jayega.' : 'Game ke neeche ye naam aur photo dikhegi (turant live).', { ok: pend ? 'Approve' : 'Save' });
      if (!c) return;
      try {
        b.disabled = true;
        const rowsNow = await call('admin_game_winners_list', { p_weeks: 8 });
        const cur = (rowsNow.rows || []).find((x) => x.id === id);
        if (!cur) throw new Error('not_found');
        let publicPath = cur.photo_public_path || null;
        let copiedPending = false;
        if (file) publicPath = await gwPublic(file);
        else if (cur.submit_status === 'pending' && cur.photo_pending_path) {
          const u = await api.signedUrl('game-photos', cur.photo_pending_path, 300);
          const blob = await (await fetch(u)).blob();
          publicPath = await gwPublic(new File([blob], 'pending.jpg', { type: blob.type || 'image/jpeg' }));
          copiedPending = true;
        }
        const old = cur.photo_public_path;
        await call('admin_game_approve', { p_win_id: id, p_name: name, p_public_path: publicPath });
        if (cur.photo_pending_path && (copiedPending || file)) await api.removeFile('game-photos', cur.photo_pending_path).catch(() => {});
        if (old && old !== publicPath) await api.removeFile('public-media', old).catch(() => {});
        ok('Saved ✓'); await load();
      } catch (x) { bad(x); b.disabled = false; }
    }
    if (b.matches('[data-rj]')) {
      const removing = /Remove/.test(b.textContent);
      const reason = await confirmBox(removing ? 'Remove from the game?' : 'Reject this submission?', 'Winner ko ye reason dikhega. Photo aur naam game se hat jayenge.', { ok: removing ? 'Remove' : 'Reject', danger: true, input: 'Reason (3+ characters)' });
      if (!reason || String(reason).trim().length < 3) return;
      try {
        const out = await call('admin_game_reject', { p_win_id: id, p_reason: String(reason).trim() });
        if (out.delete_pending) await api.removeFile('game-photos', out.delete_pending).catch(() => {});
        if (out.delete_public) await api.removeFile('public-media', out.delete_public).catch(() => {});
        ok('Done ✓'); await load();
      } catch (x) { bad(x); }
    }
  });
  await load();
};
M.alerts = async () => {
  const F = { severity: '', status: '', from: '', to: '', ip: '' };
  main().innerHTML = head('Hacker alerts', '<button class="btn sec sm" id="al-blocked">🚫 Blocked IPs</button><button class="btn sec sm" id="al-ackall">✔ Acknowledge all</button>') + `
  <div class="kpis" id="al-kpi"></div>
  <div class="card pad" id="al-filters" style="margin-bottom:12px"><div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px"><style>#al-filters input,#al-filters select{min-width:0;width:100%;box-sizing:border-box}</style>
    <div class="field" style="margin:0"><label for="f-sev">Severity</label><select id="f-sev"><option value="">All</option><option value="critical">Critical</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></div>
    <div class="field" style="margin:0"><label for="f-st">Status</label><select id="f-st"><option value="">All</option><option value="new">New</option><option value="acknowledged">Acknowledged</option><option value="handled">Handled</option></select></div>
    <div class="field" style="margin:0"><label for="f-from">From date</label><input id="f-from" type="date"></div>
    <div class="field" style="margin:0"><label for="f-to">To date</label><input id="f-to" type="date"></div>
    <div class="field" style="margin:0"><label for="f-ip">IP address</label><input id="f-ip" placeholder="e.g. 203.0.113.7" maxlength="45"></div></div></div>
  <div id="al-list"><div class="sk" style="height:120px"></div></div>
  <details class="card pad" style="margin-top:14px"><summary><b>What this can and cannot catch</b></summary><div class="small" style="margin-top:8px;line-height:1.6">
    <b>Caught and recorded (with time, IP, device, target):</b> too many wrong passwords and login lockouts; repeated failed ADMIN logins; wrong 2-step codes; fake/temporary-email signups (many from one IP = High); re-used payment references (UTR); many orders in a short time; other websites framing yours; script/SQL-looking text in forms.<br>
    <b>Block this IP</b> is enforced on login, signup and ordering. Phone networks share IPs, so prefer “24 hours”.<br>
    <b>Cannot be caught on a static site + Supabase:</b> someone calling the database API directly with a customer login (the database refuses it, but a refused call cannot write a log); DDoS / traffic floods (use Cloudflare); attacks that never reach our login, signup or order code; a stolen password used correctly (looks like a normal login). The real protection is the lock itself: 2-step codes for admins, strict database rules, rate limits.</div></details>`;
  const load = async () => {
    $('#al-list').innerHTML = '<div class="sk" style="height:120px"></div>';
    try {
      const day = (v, add = 0) => v ? new Date(new Date(v + 'T00:00:00').getTime() + add * 864e5).toISOString() : null;
      const [rows, c] = await Promise.all([call('admin_list_security_alerts', { p_severity: F.severity || null, p_status: F.status || null, p_from: day(F.from), p_to: day(F.to, 1), p_ip: F.ip.trim() || null, p_limit: 200 }), api.rpc('admin_security_alert_counts')]);
      $('#al-kpi').innerHTML = `<div class="kpi ${c.new_total ? 'g' : ''}"><b>${num(c.new_total)}</b><span>New alerts</span></div><div class="kpi ${c.new_high ? 'g' : ''}"><b>${num(c.new_high)}</b><span>New High / Critical</span></div><div class="kpi"><b>${num(c.last_24h)}</b><span>Last 24 hours</span></div>`;
      $('#al-list').innerHTML = rows.map((r) => `<div class="card pad" data-id="${esc(r.id)}" style="margin-bottom:10px;cursor:pointer;border-left:6px solid ${(SEV[r.severity] || SEV.low)[1]};${r.status === 'new' ? '' : 'opacity:.7'}">
        <div class="row" style="gap:6px;flex-wrap:wrap;align-items:center"><span class="tag ${(SEV[r.severity] || SEV.low)[0]}">${esc(r.severity.toUpperCase())}</span><span class="tag ${r.status === 'new' ? 'pink' : r.status === 'handled' ? 'green' : 'cyan'}">${esc(r.status)}</span>${r.count > 1 ? `<span class="tag dark">× ${num(r.count)}</span>` : ''}${r.ip_blocked ? '<span class="tag red">IP blocked</span>' : ''}</div>
        <div style="font-weight:600;margin-top:6px">${esc(KIND[r.kind] || r.kind)}</div><div class="small">${esc(r.summary)}</div>
        <div class="tiny muted" style="margin-top:4px">🌐 ${esc(r.ip || 'IP unknown')} · ${esc(fmtDate(r.last_seen_at))}${r.target ? ' · ' + esc(r.target) : ''}</div></div>`).join('') || '<div class="card pad center muted">No alerts for these filters. 🎉</div>';
      $$('#al-list [data-id]').forEach((el) => el.onclick = () => detail(rows.find((x) => x.id === el.dataset.id)));
    } catch (x) { $('#al-list').innerHTML = `<div class="alert bad">${esc(errText(x))}</div>`; }
  };
  const detail = (r) => {
    const row = (k, v) => `<div style="padding:7px 0;border-bottom:1px solid var(--line)"><div class="tiny muted">${k}</div><div class="small" style="word-break:break-word">${v}</div></div>`;
    modal(`<h3 style="margin-top:0">${esc(KIND[r.kind] || r.kind)}</h3><div class="row" style="gap:6px;flex-wrap:wrap;margin-bottom:6px"><span class="tag ${(SEV[r.severity] || SEV.low)[0]}">${esc(r.severity.toUpperCase())}</span><span class="tag ${r.status === 'new' ? 'pink' : 'green'}">${esc(r.status)}</span>${r.ip_blocked ? '<span class="tag red">IP blocked</span>' : ''}</div>
      <div style="max-height:52vh;overflow:auto">${row('What happened', esc(r.summary))}${row('Times seen', num(r.count) + (r.count > 1 ? ' (same IP, grouped)' : ''))}${row('First seen', esc(fmtDate(r.created_at)))}${row('Last seen', esc(fmtDate(r.last_seen_at)))}${row('IP address', `<code>${esc(r.ip || 'unknown')}</code>`)}${row('Device / browser (user agent)', esc(r.user_agent || 'not available'))}${row('Target (page / endpoint)', esc(r.target || '—'))}${r.user_email ? row('Customer account', esc(r.user_email)) : ''}${row('Extra details', `<pre style="white-space:pre-wrap;margin:0;font-size:.74rem">${esc(JSON.stringify(r.details || {}, null, 2))}</pre>`)}${r.handled_at ? row('Handled', esc(fmtDate(r.handled_at))) : ''}${row('Your note', `<textarea id="al-note" rows="2" maxlength="500" style="width:100%" placeholder="optional">${esc(r.note || '')}</textarea>`)}</div>
      <p class="err" id="al-err"></p><div class="row" style="gap:8px;flex-wrap:wrap;justify-content:flex-end;margin-top:10px"><button class="btn sec sm" data-close>Close</button>
      ${r.ip ? `<button class="btn sec sm" id="al-same">Same IP</button><button class="btn sm ${r.ip_blocked ? 'sec' : 'danger'}" id="al-block">${r.ip_blocked ? 'Unblock IP' : '🚫 Block this IP'}</button>` : ''}
      ${r.status !== 'new' ? '<button class="btn sec sm" id="al-new">Reopen</button>' : '<button class="btn sec sm" id="al-ack">Acknowledge</button>'}${r.status !== 'handled' ? '<button class="btn sm" id="al-done">✔ Mark handled</button>' : ''}</div>`,
      { wide: true, onOpen: (el, close) => {
        const set = (st) => async () => { try { await call('admin_set_security_alert_status', { p_id: r.id, p_status: st, p_note: el.querySelector('#al-note').value.trim() || null }); close(); ok('Saved ✓'); load(); } catch (x) { el.querySelector('#al-err').textContent = errText(x); } };
        el.querySelector('#al-ack')?.addEventListener('click', set('acknowledged')); el.querySelector('#al-done')?.addEventListener('click', set('handled')); el.querySelector('#al-new')?.addEventListener('click', set('new'));
        el.querySelector('#al-same')?.addEventListener('click', () => { close(); F.ip = r.ip; $('#f-ip').value = r.ip; load(); });
        el.querySelector('#al-block')?.addEventListener('click', async () => { if (r.ip_blocked) { try { await call('admin_unblock_ip', { p_ip: r.ip }); close(); ok('IP unblocked'); load(); } catch (x) { el.querySelector('#al-err').textContent = errText(x); } } else { close(); blockModal(r.ip, r.summary); } });
      } });
  };
  const blockModal = (ip, why) => modal(`<h3 style="margin-top:0">🚫 Block ${esc(ip)}?</h3><p class="small">This address will be refused at <b>login, signup and ordering</b>. Real customers on the same phone network could be blocked too, so a short block is safer.</p>
    <div class="field"><label for="bl-h">For how long</label><select id="bl-h"><option value="24">24 hours</option><option value="168">7 days</option><option value="">Until I unblock it</option></select></div><p class="err" id="bl-err"></p>
    <div class="row" style="justify-content:flex-end"><button class="btn sec sm" data-close>Cancel</button><button class="btn sm danger" id="bl-ok">Block</button></div>`,
    { onOpen: (el, close) => { el.querySelector('#bl-ok').onclick = async () => { try { const h = el.querySelector('#bl-h').value; await call('admin_block_ip', { p_ip: ip, p_reason: String(why || '').slice(0, 200), p_hours: h ? Number(h) : null }); close(); ok('IP blocked'); load(); } catch (x) { el.querySelector('#bl-err').textContent = /cannot_block_own_ip/.test(x.message) ? 'That is your own IP address — not blocked.' : errText(x); } }; } });
  $('#al-blocked').onclick = async () => { try { const b = await call('admin_list_blocked_ips', {});
    modal(`<h3 style="margin-top:0">🚫 Blocked IPs</h3><div style="max-height:55vh;overflow:auto">${b.map((x) => `<div class="row between" style="padding:8px 0;border-bottom:1px solid var(--line);gap:8px"><div><code>${esc(x.ip)}</code><div class="tiny muted">${esc(x.reason || '')} · ${x.expires_at ? 'until ' + esc(fmtDate(x.expires_at)) : 'until unblocked'}</div></div><button class="btn sec sm" data-ub="${esc(x.ip)}">Unblock</button></div>`).join('') || '<p class="muted small">No IPs are blocked.</p>'}</div><div class="row" style="justify-content:flex-end;margin-top:10px"><button class="btn sec sm" data-close>Close</button></div>`,
      { onOpen: (el, close) => el.querySelectorAll('[data-ub]').forEach((bt) => bt.onclick = async () => { try { await call('admin_unblock_ip', { p_ip: bt.dataset.ub }); close(); ok('Unblocked'); load(); } catch (x) { bad(x); } }) }); } catch (x) { bad(x); } };
  $('#al-ackall').onclick = async () => { if (!await confirmBox('Acknowledge all new alerts?', 'They stay in the list (marked acknowledged). Use this after you have looked through them.', { ok: 'Acknowledge all' })) return; try { const n = await call('admin_acknowledge_all_alerts', {}); ok(`${n} alerts acknowledged`); load(); } catch (x) { bad(x); } };
  [['f-sev', 'severity'], ['f-st', 'status'], ['f-from', 'from'], ['f-to', 'to'], ['f-ip', 'ip']].forEach(([id, k]) => $('#' + id).addEventListener('change', (e) => { F[k] = e.target.value; load(); }));
  await load();
};


// ----- email check (migration 0020 + the email-check function) -----
// The DATABASE decides who may read or change anything here (admin + 2FA). The MX lookup runs in the email-check function.
const EC_TAG = { disposable: ['red', '🚫 DISPOSABLE — temp / fake email'], suspicious: ['pink', '⚠️ SUSPICIOUS — shak wala (guess)'], ok: ['green', '✅ LOOKS OK — theek lag raha hai'], unknown: ['', '❔ COULD NOT CHECK — pakka nahi'], bad: ['red', '❌ Sahi email/domain nahi hai'] };
const ec_random = (dom) => { const lab = String(dom || '').split('.')[0]; return /\d{4,}/.test(lab) || (lab.length >= 8 && !/[aeiou]/.test(lab)); };
const ec_mx = async (domains) => { const out = {}; const list = [...new Set(domains.filter(Boolean))]; for (let i = 0; i < list.length; i += 20) { try { const res = await api.fn('email-check', { domains: list.slice(i, i + 20) }); (res.results || []).forEach((x) => { out[x.domain] = x; }); } catch { /* not checked: shown as could-not-check */ } } return out; };
function ec_verdict(r, mx) {
  if (!r.valid) return { kind: 'bad', why: ['Example: abc@gmail.com ya sirf domain jaise mailinator.com'] };
  if (r.major) return { kind: 'ok', why: [`${r.domain} bada provider hai — yahan temp email nahi hota`] };
  if (r.blocked) return { kind: 'disposable', why: [`${r.domain} already aapki “Blocked email domains” list me hai`] };
  if (r.on_list) return { kind: 'disposable', why: [`${r.domain} temp / disposable email domains ki list me hai`] };
  if (!mx || mx.mx === 'could_not_check') return { kind: 'unknown', why: ['Mail server (MX) abhi check nahi ho paya, aur domain list me bhi nahi hai. Pakka nahi keh sakte — dobara try karo'] };
  if (mx.mx === 'no_mx') return { kind: 'suspicious', why: [`${r.domain} par koi mail server (MX) nahi hai — shayad fake ya throwaway domain. Ye ek guess hai`] };
  if (ec_random(r.domain)) return { kind: 'suspicious', why: [`${r.domain} ka naam random lag raha hai — ye bhi ek guess hai`] };
  return { kind: 'ok', why: ['Mail server hai aur domain kisi temp list me nahi hai. Guarantee nahi, sirf ek achha sanket'] };
}
const ec_custTxt = (c) => c ? `${esc(c.full_name || 'Naam nahi')} · ID ${esc(c.customer_id || '')} · ${num(c.orders)} orders · joined ${esc(fmtDate(c.created_at))} · ${c.status === 'active' ? 'active' : '<b style="color:var(--bad)">' + esc(c.status) + '</b>'}` : 'Is email se koi registered customer nahi';
async function ec_block(t, mode) {
  // t = { domain, customer_id(uuid), email }, mode = 'dom' | 'user' | 'both'
  const what = mode === 'both' ? `Domain “${t.domain}” aur customer ${t.email} dono block honge` : mode === 'dom' ? `Domain “${t.domain}” block hoga — is domain se naya signup aur order nahi hoga` : `Customer ${t.email} block hoga — wo login nahi kar payega`;
  if (!await confirmBox('Block karein?', `${what}. Ye audit log me jayega. Customers ko koi notice nahi jayega.`, { ok: 'Haan, block karo', danger: true })) return false;
  await call('admin_block_email_target', { p_domain: t.domain, p_user_id: mode !== 'dom' ? t.customer_id : null, p_reason: 'blocked from Email check', p_block_domain: mode !== 'user', p_block_user: mode !== 'dom' });
  ok('Blocked ✓'); return true;
}
// ----- share rewards (migration 0022): reward list, reverse, settings -----
// ---------- coin transfer requests (customer -> customer, admin approval; coins are points only) ----------
const CTA_TONE = { pending: 'orange', approved: 'green', rejected: 'red', cancelled: '' };
M.cointransfers = async () => {
  main().innerHTML = head('Coin transfer requests') + `<div class="alert warn small"><b>Coins are points only.</b> Approve karne par sender ke coins kam hote hain aur receiver ko milte hain (ek hi baar). Coins kabhi cash, UPI ya bank me nahi jaate. Har action audit log me jata hai.</div>
  <div class="card pad" style="margin-bottom:14px"><h3 style="margin-top:0">Transfer settings</h3><div id="cta-set" class="row" style="gap:10px;flex-wrap:wrap">Loading…</div></div>
  <div class="card pad"><div class="row between" style="flex-wrap:wrap;gap:8px"><h3 style="margin:0">Requests <span class="tag pink" id="cta-pc"></span></h3><select id="cta-st" aria-label="Status"><option value="pending">Pending</option><option value="">All</option><option value="approved">Approved</option><option value="rejected">Rejected</option><option value="cancelled">Cancelled</option></select></div><div id="cta-list" style="margin-top:10px">Loading…</div></div>`;
  const drawSettings = (s = {}) => { $('#cta-set').innerHTML = `<label class="small row" style="gap:6px"><input type="checkbox" id="cta-en" ${s.enabled !== false ? 'checked' : ''}> On</label>
    <label class="small">Min coins <input id="cta-min" type="number" min="1" max="1000" value="${Number(s.min_coins) || 1}" style="width:90px"></label>
    <label class="small">Max per request <input id="cta-max" type="number" min="1" max="100000" value="${Number(s.max_per_request) || 5000}" style="width:110px"></label>
    <label class="small">Max pending per sender <input id="cta-pend" type="number" min="1" max="20" value="${Number(s.max_pending) || 3}" style="width:80px"></label>
    <label class="small">Daily cap per sender <input id="cta-cap" type="number" min="1" max="1000000" value="${Number(s.daily_cap) || 2000}" style="width:110px"></label>
    <button class="btn sm" id="cta-save">Save settings</button>`;
    $('#cta-save').onclick = async () => { try { await call('admin_set_coin_transfer_settings', { p_enabled: $('#cta-en').checked, p_min_coins: Number($('#cta-min').value), p_max_per_request: Number($('#cta-max').value), p_max_pending: Number($('#cta-pend').value), p_daily_cap: Number($('#cta-cap').value) }); ok('Settings saved ✓'); } catch (x) { bad(x); } }; };
  const load = async () => {
    let d; try { d = await call('admin_list_coin_transfers', { p_status: $('#cta-st').value || null, p_limit: 200 }); } catch (x) { return bad(x); }
    drawSettings(d.settings); $('#cta-pc').textContent = `${d.pending_count || 0} pending`;
    const rows = d.rows || [];
    $('#cta-list').innerHTML = rows.length ? rows.map((r) => `<div class="card pad" style="box-shadow:none;border:1px solid var(--line);margin-bottom:8px">
      <div class="row between"><b>${num(r.coins)} coins</b><span class="tag ${CTA_TONE[r.status] || ''}">${esc(r.status)}</span></div>
      <div class="small">From <b>${esc(r.sender_customer_id)}</b> ${esc(r.sender_name || '')} → to <b>${esc(r.receiver_customer_id)}</b> ${esc(r.receiver_name || '')}</div>
      <div class="tiny muted">Sender ka balance ${num(r.sender_balance)} · on hold ${num(r.sender_held)} · requested ${fmtDate(r.created_at)}${r.decided_at ? ' · decided ' + fmtDate(r.decided_at) : ''}</div>
      ${r.note ? `<div class="tiny">Note: ${esc(r.note)}</div>` : ''}${r.decision_reason ? `<div class="tiny muted">Reason: ${esc(r.decision_reason)}</div>` : ''}
      ${r.status === 'pending' ? `<div class="row" style="margin-top:8px;gap:8px"><button class="btn sm" data-cta-ok="${esc(r.id)}" data-c="${esc(r.coins)}" data-s="${esc(r.sender_customer_id)}" data-r="${esc(r.receiver_customer_id)}">Approve</button><button class="btn danger sm" data-cta-no="${esc(r.id)}">Reject</button></div>` : ''}
      <div class="tiny muted" style="margin-top:4px">${esc(r.request_ref)}</div></div>`).join('') : '<div class="card pad empty">Is filter me koi request nahi.</div>';
    $$('[data-cta-ok]').forEach((b) => { b.onclick = async () => {
      const yes = await confirmBox('Transfer approve karein?', `${b.dataset.c} coins ${b.dataset.s} se ${b.dataset.r} ko jayenge. Ye wapas nahi hoga (sirf reversal se).`, { ok: 'Haan, approve & transfer' });
      if (!yes) return;
      try { await call('admin_approve_coin_transfer', { p_id: Number(b.dataset.ctaOk) }); ok('Coins transfer ho gaye ✓'); await load(); } catch (x) { bad(x); } }; });
    $$('[data-cta-no]').forEach((b) => { b.onclick = async () => {
      const reason = await confirmBox('Request reject karein?', 'Sender ke coins free ho jayenge. Reason sender ko dikhega.', { ok: 'Reject', danger: true, input: 'Reason (3+ characters)' });
      if (!reason) return;
      try { await call('admin_reject_coin_transfer', { p_id: Number(b.dataset.ctaNo), p_reason: reason }); ok('Rejected ✓'); await load(); } catch (x) { bad(x); } }; });
  };
  $('#cta-st').onchange = load;
  await load();
};

M.referrals = async () => {
  main().innerHTML = head('Share rewards') + `<div class="alert small">Customer ne SHOPZENT ka product share kiya, dost ne kharida. Reward default <b>5%</b> (product par 8% tak). Coins <b>tabhi</b> milte hain jab order <b>DELIVERED</b> ho aur payment verified ho. Cancel, return ya refund par reverse ho jate hain. Apne aap ko share karne par nahi milta.</div>
  <div class="card pad" style="margin-bottom:14px"><h3 style="margin-top:0">Reward settings</h3><div id="rf-set" class="row" style="gap:10px;flex-wrap:wrap">Loading…</div></div>
  <div class="card pad"><div class="row between" style="flex-wrap:wrap;gap:8px"><h3 style="margin:0">Rewards</h3><select id="rf-st" aria-label="Status"><option value="">All</option><option value="pending">Pending</option><option value="paid">Paid</option><option value="reversed">Reversed</option></select></div>
    <div id="rf-tot" class="small" style="margin:10px 0"></div><div id="rf-list">Loading…</div></div>`;
  let st = {}; try { const row = await api.select('site_settings', { eq: { key: 'referral' }, single: true }); st = row?.value || {}; } catch {}
  const v = { enabled: st.enabled !== false, default_rate: Number(st.default_rate) || 5, daily_cap_coins: Number(st.daily_cap_coins ?? 500), attribution_days: Number(st.attribution_days) || 7 };
  $('#rf-set').innerHTML = `<label class="small row" style="gap:6px"><input type="checkbox" id="rf-en" ${v.enabled ? 'checked' : ''}> On</label>
    <label class="small">Default rate % <select id="rf-rate">${[5, 6, 7, 8].map((n) => `<option value="${n}" ${n === v.default_rate ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <label class="small">Daily cap (coins per sharer) <input id="rf-cap" type="number" min="0" max="1000000" value="${v.daily_cap_coins}" style="width:110px"></label>
    <label class="small">Attribution days <input id="rf-days" type="number" min="1" max="30" value="${v.attribution_days}" style="width:80px"></label>
    <button class="btn sm" id="rf-save">Save settings</button>`;
  $('#rf-save').onclick = async () => { try { await call('admin_set_referral_settings', { p_enabled: $('#rf-en').checked, p_default_rate: Number($('#rf-rate').value), p_daily_cap_coins: Number($('#rf-cap').value), p_attribution_days: Number($('#rf-days').value) }); ok('Settings saved ✓'); } catch (x) { bad(x); } };
  const load = async () => { let d; try { d = await call('admin_list_referral_rewards', { p_status: $('#rf-st').value || null, p_limit: 200 }); } catch (x) { return bad(x); }
    const T = d.totals || {}; const tt = (k) => `${k}: ${T[k]?.count || 0} (${T[k]?.coins || 0} coins)`;
    $('#rf-tot').innerHTML = ['pending', 'paid', 'reversed'].map(tt).join(' · ');
    $('#rf-list').innerHTML = (d.rows || []).length ? (d.rows || []).map((r) => `<div class="card pad" style="box-shadow:none;border:1px solid var(--line);margin-bottom:8px"><div class="row between"><b class="small">${esc(r.order_code)} · ${esc(r.product)}</b><span class="tag ${r.status === 'paid' ? 'green' : r.status === 'reversed' ? 'red' : 'orange'}">${esc(r.status)}</span></div>
      <div class="tiny muted">Sharer ${esc(r.sharer || '')} ${esc(r.sharer_name || '')} · buyer ${esc(r.buyer || '')} · line ${inr(r.line_total)} · ${Number(r.rate)}% = <b>${num(r.coins)} coins</b> · order ${esc(r.order_status)} / ${esc(r.payment_status)} · ${fmtDate(r.created_at)}</div>
      ${r.reverse_reason ? `<div class="tiny muted">Reversed: ${esc(r.reverse_reason)}</div>` : ''}
      ${r.status !== 'reversed' ? `<div class="row" style="margin-top:6px"><button class="btn danger sm" data-rv="${r.id}">Reverse</button></div>` : ''}</div>`).join('') : '<p class="small muted">Abhi koi reward nahi.</p>';
  };
  $('#rf-st').onchange = load;
  $('#rf-list').addEventListener('click', async (e) => { const b = e.target.closest('[data-rv]'); if (!b) return; const r = await confirmBox('Reverse this reward?', 'Customer ke coins wapas le liye jayenge (jitne balance me hain). Reason customer ko bhi dikhega.', { ok: 'Reverse', danger: true, input: 'Reason (3+ characters)' }); if (!r || String(r).trim().length < 3) return; try { await call('admin_reverse_referral_reward', { p_id: Number(b.dataset.rv), p_reason: String(r).trim(), p_idempotency_key: ik() }); ok('Reversed'); load(); } catch (x) { bad(x); } });
  load();
};
// ----- reviews (migration 0024): moderation -----
M.reviews = async () => {
  main().innerHTML = head('Reviews') + `<div class="alert small">Review sirf wahi customer de sakta hai jiska order DELIVERED hua ho. Galat ya bura review hide karo: product page par nahi dikhega.</div>
    <div class="card pad"><select id="rv-st" aria-label="Status"><option value="">All</option><option value="visible">Visible</option><option value="hidden">Hidden</option></select><div id="rv-list" style="margin-top:10px">Loading…</div></div>`;
  const load = async () => { let rows; try { rows = await call('admin_list_reviews', { p_status: $('#rv-st').value || null, p_limit: 200 }); } catch (x) { return bad(x); }
    $('#rv-list').innerHTML = rows.length ? rows.map((r) => `<div class="card pad" style="box-shadow:none;border:1px solid var(--line);margin-bottom:8px"><div class="row between"><b class="small">${esc(r.product)}</b><span class="tag ${r.status === 'hidden' ? 'red' : 'green'}">${esc(r.status)}</span></div>
      <div class="tiny muted">${'★'.repeat(Number(r.rating))} · ${esc(r.name || '')} · ${esc(r.customer || '')} · order ${esc(r.order_code)} · ${fmtDate(r.created_at)}</div>
      ${r.body ? `<p class="small" style="white-space:pre-wrap">${esc(r.body)}</p>` : ''}${r.hidden_reason ? `<div class="tiny muted">Hidden: ${esc(r.hidden_reason)}</div>` : ''}
      <div class="row" style="margin-top:6px"><button class="btn ${r.status === 'hidden' ? 'sec' : 'danger'} sm" data-rv="${r.id}" data-to="${r.status === 'hidden' ? 'visible' : 'hidden'}">${r.status === 'hidden' ? 'Show again' : 'Hide'}</button></div></div>`).join('') : '<p class="small muted">Abhi koi review nahi.</p>';
  };
  $('#rv-st').onchange = load;
  $('#rv-list').addEventListener('click', async (e) => { const b = e.target.closest('[data-rv]'); if (!b) return; let reason = '';
    if (b.dataset.to === 'hidden') { reason = await confirmBox('Hide this review?', 'Product page se hat jayega.', { ok: 'Hide', danger: true, input: 'Reason (3+ characters)' }); if (!reason || String(reason).trim().length < 3) return; reason = String(reason).trim(); }
    else if (!await confirmBox('Show this review again?', 'Ye review product page par dikhega.', { ok: 'Show' })) return;
    try { await call('admin_set_review_status', { p_id: Number(b.dataset.rv), p_status: b.dataset.to, p_reason: reason }); ok('Done ✓'); load(); } catch (x) { bad(x); } });
  load();
};
M.emailcheck = async () => {
  main().innerHTML = head('Email check') + `<div class="alert small">Email ya domain daalo, turant pata chal jayega temp/fake hai ya nahi. <b>Ye guess hai, pakka nahi</b>: koi bhi checker 100% sahi nahi hota.</div>
  <div class="card pad" style="margin-bottom:14px"><div class="row" style="gap:8px;flex-wrap:wrap"><input id="ec-in" type="text" autocapitalize="none" autocomplete="off" spellcheck="false" placeholder="abc@xyz.com ya xyz.com" style="flex:1;min-width:180px;max-width:520px"><button class="btn" id="ec-go">Check karo</button></div><div id="ec-out" style="margin-top:12px"></div></div>
  <div class="card pad"><div class="row between" style="flex-wrap:wrap;gap:8px"><h3 style="margin:0">Check all signups</h3><label class="small row" style="gap:6px"><input type="checkbox" id="ec-all"> Sab dikhao</label></div><p class="tiny muted">Recent customers. Temp list wale aur mail server na wale pehle dikhte hain (mail server wala flag ek guess hai).</p><div id="ec-list"><div class="sk" style="height:120px"></div></div></div>`;
  const runCheck = async () => {
    const v = $('#ec-in').value.trim().toLowerCase(); const out = $('#ec-out'); if (!v) return;
    out.innerHTML = '<div class="sk" style="height:90px"></div>';
    try {
      const r = await api.rpc('admin_email_check_db', { p_input: v });
      const mx = r.valid && !r.major ? (await ec_mx([r.domain]))[r.domain] || null : null;
      const V = ec_verdict(r, mx); const [cls, label] = EC_TAG[V.kind];
      const mxTxt = r.major ? '— (bada provider)' : !mx || mx.mx === 'could_not_check' ? '⚠️ check nahi ho paya' : mx.mx === 'has_mx' ? '✅ haan' + (mx.mx_hosts ? ' (' + esc(mx.mx_hosts[0]) + ')' : '') : '❌ nahi';
      const t = r.valid ? { domain: r.domain, customer_id: r.customer?.id, email: r.customer?.email || r.email || r.domain } : null;
      const canDom = t && !r.major && !r.blocked; const canUser = t && r.customer && r.customer.status === 'active'; const canUn = t && r.blocked && !r.major;
      out.innerHTML = `<div><span class="tag ${cls}" style="font-size:15px;padding:6px 10px">${label}</span></div>${V.why.map((w) => `<p class="small" style="margin:8px 0 0">${esc(w)}</p>`).join('')}
      ${r.valid ? `<div class="small" style="margin-top:10px;line-height:1.8"><div><b>Domain:</b> ${esc(r.domain)}</div><div><b>Mail server (MX):</b> ${mxTxt}</div><div><b>Temp list me:</b> ${r.on_list ? '✅ haan' : '❌ nahi'} <span class="tiny muted">(list me ${num(r.list_size)} domains)</span></div><div><b>Domain already blocked:</b> ${r.blocked ? '🚫 haan' : 'nahi'}</div><div><b>Is domain ke customers:</b> ${num(r.customers_on_domain)}</div>${r.email ? `<div><b>Customer:</b> ${ec_custTxt(r.customer)}</div>` : ''}</div>` : ''}
      <div class="row" style="gap:8px;flex-wrap:wrap;margin-top:12px">${canDom ? '<button class="btn danger sm" data-b="dom">🚫 Yeh domain block karo</button>' : ''}${canUser ? '<button class="btn danger sm" data-b="user">👤 Yeh customer block karo</button>' : ''}${canDom && canUser ? '<button class="btn danger sm" data-b="both">Dono block karo</button>' : ''}${canUn ? '<button class="btn sec sm" data-b="un">🔓 Domain unblock karo</button>' : ''}</div>`;
      out.querySelectorAll('[data-b]').forEach((b) => b.onclick = async () => { try { if (b.dataset.b === 'un') { if (await confirmBox('Domain unblock karein?', `“${r.domain}” blocked list se hat jayega — is domain se signup aur order phir se ho payenge. Audit log me jayega.`, { ok: 'Haan, unblock karo' })) { await call('admin_unblock_email_domain', { p_domain: r.domain }); ok('Unblocked ✓'); runCheck(); } return; } if (await ec_block(t, b.dataset.b)) runCheck(); } catch (x) { bad(x); } });
    } catch (x) { out.innerHTML = `<div class="alert bad">${esc(errText(x))}</div>`; }
  };
  $('#ec-go').onclick = runCheck; $('#ec-in').addEventListener('keydown', (e) => { if (e.key === 'Enter') runCheck(); });
  const loadList = async () => {
    const rows = await api.rpc('admin_recent_signups', { p_limit: 150 });
    const mxMap = await ec_mx(rows.filter((x) => x.domain && !x.major).map((x) => x.domain));
    const items = rows.map((x) => { const mx = mxMap[x.domain] || null; const V = ec_verdict({ valid: true, domain: x.domain, major: x.major, on_list: x.on_list, blocked: x.blocked_domain }, mx); return { x, V }; });
    const show = $('#ec-all').checked ? items : items.filter((i) => i.V.kind !== 'ok');
    $('#ec-list').innerHTML = `<p class="tiny muted">${num(items.filter((i) => i.V.kind !== 'ok').length)} of ${num(items.length)} flagged</p>` + (show.map((i, n) => { const [cls, label] = EC_TAG[i.V.kind]; const r = i.x;
      return `<div class="row between" style="padding:10px 0;border-bottom:1px solid var(--line);gap:8px;flex-wrap:wrap"><div style="min-width:0;flex:1"><span class="tag ${cls}" style="font-size:11px">${esc(label.replace(/^\S+ /, ''))}</span><div style="margin-top:4px;word-break:break-all"><b>${esc(r.email)}</b></div><div class="tiny muted">${esc(r.full_name || 'Naam nahi')} · ${num(r.orders)} orders · ${esc(fmtDate(r.created_at))}${r.status !== 'active' ? ' · <b style="color:var(--bad)">' + esc(r.status) + '</b>' : ''}</div></div>
      <div class="row" style="gap:6px;flex-wrap:wrap">${r.major ? '' : (r.blocked_domain ? '<span class="tiny muted">domain blocked</span>' : `<button class="btn sec sm" data-d="${n}">Domain block</button>`)}${r.status === 'active' ? `<button class="btn sec sm" data-u="${n}">Customer block</button>` : ''}</div></div>`; }).join('') || '<div class="muted small">Koi flagged signup nahi mila 👍</div>');
    const tgt = (n) => { const r = show[n].x; return { domain: r.domain, customer_id: r.id, email: r.email }; };
    $('#ec-list').querySelectorAll('[data-d]').forEach((b) => b.onclick = async () => { try { if (await ec_block({ ...tgt(+b.dataset.d) }, 'dom')) loadList(); } catch (x) { bad(x); } });
    $('#ec-list').querySelectorAll('[data-u]').forEach((b) => b.onclick = async () => { try { if (await ec_block(tgt(+b.dataset.u), 'user')) loadList(); } catch (x) { bad(x); } });
  };
  $('#ec-all').onchange = loadList;
  await loadList().catch((x) => { $('#ec-list').innerHTML = `<div class="alert bad">${esc(errText(x))}</div>`; });
};

// ----- sales / orders amount (migration 0023: admin_sales_summary, read-only: no writes, no notices, no audit rows) -----
const SL_WIN = [['today', 'Aaj', 'IST 12 baje se'], ['d7', 'Pichhle 7 din', 'Last 7 days'], ['d30', 'Pichhle 30 din', 'Last 30 days'], ['all', 'Sab time', 'All time']];
M.sales = async () => {
  main().innerHTML = head('Sales / Orders amount', '<button class="btn sec sm" id="sl-ref" type="button">Refresh</button>') + `
  <div class="alert small">Sirf dekhne ke liye, ye page kuch change nahi karta. Rakam = order ka total (₹), ginti = orders ki.</div>
  <div id="sl-out"><div class="sk" style="height:300px"></div></div>
  <div class="card pad sl-help" style="margin-top:12px"><h3 style="margin:0 0 6px">Ye numbers kya hain (exact)</h3><ul class="small" style="padding-left:18px;margin:0">
    <li><b>Total placed</b> (kul order): har order jo kabhi bana, kisi bhi status me. Rakam = order ka <code>total</code>, jaisa database me stored hai (discount aur wallet ke baad).</li>
    <li><b>Confirmed</b> (✅ payment verified): admin ne payment verify kar diya, yani <code>payment_status = verified</code>, aur order cancel ya reject nahi hua.</li>
    <li><b>Pending payment</b> (⏳): payment abhi verify nahi hua (<code>pending</code>, <code>submitted</code>, <code>under_verification</code>, ya <code>rejected</code> jo customer dobara bhej sakta hai), aur order cancel nahi hua.</li>
    <li><b>Cancelled</b> (❌): order status <code>order_cancelled</code> ya <code>order_rejected</code>, payment chahe jo ho. Pehle verify hua ho to bhi yahin jata hai.</li>
    <li>Confirmed + Pending + Cancelled = Total placed. Har order ek hi bucket me.</li>
    <li><b>Samay</b>: Aaj = aaj 12:00 AM IST se. Pichhle 7 / 30 din = abhi se 7 / 30 × 24 ghante pehle tak (order banne ka time). Sab time = shuru se.</li>
    <li>Returns aur refunds abhi minus nahi hote. Ye order ki value hai, cash ka hisab nahi.</li>
  </ul></div>`;
  const load = async () => {
    const out = $('#sl-out'); out.innerHTML = '<div class="sk" style="height:300px"></div>';
    try {
      const s = await call('admin_sales_summary', {});
      const W = s.windows || {};
      const row = (k) => W[k] || { placed: {}, confirmed: {}, pending: {}, cancelled: {} };
      const amt = (r, b) => Number(r[b]?.amount || 0);
      const cnt = (r, b) => Number(r[b]?.count || 0);
      const maxPlaced = Math.max(0, ...SL_WIN.map(([k]) => amt(row(k), 'placed')));
      const pct = (a, t) => (t > 0 ? Math.max(0, Math.min(100, (Number(a) / t) * 100)) : 0);
      const orders = (n) => `${num(n)} order${n === 1 ? '' : 's'}`;
      const chart = SL_WIN.map(([k, lab]) => { const r = row(k); const P = amt(r, 'placed'); const seg = (b) => `<i class="sl-${b === 'confirmed' ? 'c' : b === 'pending' ? 'p' : 'x'}" style="height:${pct(amt(r, b), P)}%"></i>`;
        return `<div class="sl-col"><small>${esc(inr(P))}</small><div class="sl-plot"><div class="sl-stack" style="height:${pct(P, maxPlaced)}%">${seg('confirmed')}${seg('pending')}${seg('cancelled')}</div></div><span>${esc(lab)}</span></div>`; }).join('');
      const line = (r, b, label, cls) => `<div class="sl-row"><span><i class="sl-dot sl-${cls}"></i>${label}</span><b>${esc(inr(amt(r, b)))}</b><em>${orders(cnt(r, b))}</em></div>`;
      const cards = SL_WIN.map(([k, lab, sub]) => { const r = row(k); const P = amt(r, 'placed');
        return `<div class="card pad sl-card"><div class="sl-head"><h3 style="margin:0">${esc(lab)}</h3><span class="tiny muted">${esc(sub)}</span></div>
          <div class="sl-total"><b>${esc(inr(P))}</b><span>Total placed · ${esc(orders(cnt(r, 'placed')))}</span></div>
          <div class="sl-bar">${['confirmed', 'pending', 'cancelled'].map((b) => `<i class="sl-${b === 'confirmed' ? 'c' : b === 'pending' ? 'p' : 'x'}" style="width:${pct(amt(r, b), P)}%"></i>`).join('')}</div>
          <div class="sl-rows">${line(r, 'confirmed', 'Confirmed (payment verified)', 'c')}${line(r, 'pending', 'Pending payment', 'p')}${line(r, 'cancelled', 'Cancelled', 'x')}</div></div>`; }).join('');
      out.innerHTML = `<div class="card pad"><h3 style="margin:0 0 4px">Chart: order ki rakam</h3><p class="tiny muted" style="margin:0 0 8px">Bar ki height = total placed. Hara = confirmed, peela = pending, laal = cancelled.</p><div class="sl-chart">${chart}</div></div>${cards}<div class="tiny muted" style="margin-top:10px">Data ka time: ${esc(fmtDate(s.generated_at))}. Refresh karne par naya data aata hai.</div>`;
    } catch (x) { out.innerHTML = `<div class="alert bad">${esc(errText(x))}</div>`; }
  };
  $('#sl-ref').onclick = load;
  await load();
};

// ---------- boot ----------
(async () => {
  if (MOD === 'login') { await loginPage(); return; }
  if (!(await gate())) { if (ME && !['admin', 'super_admin'].includes(ME.role)) { try { await api.rpc('log_security_event', { p_kind: 'admin_ui_denied', p_target: MOD || 'admin', p_details: { page: location.pathname } }); } catch { /* */ } } location.replace('index.html?next=' + encodeURIComponent(location.pathname.split('/').pop())); return; }
  shell(); try { await (M[MOD] || M.dashboard)(); } catch (x) { console.error(x); main().insertAdjacentHTML('afterbegin', `<div class="alert bad">${esc(errText(x))}</div>`); }
})();
