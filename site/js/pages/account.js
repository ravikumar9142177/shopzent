// Auth + customer account + cart/checkout/payment pages
import { api, DEMO, config } from '../api.js';
import { $, $$, esc, inr, num, param, toast, modal, confirmBox, errText, fmtDate, idemKey, clearIdem, checkFile, waLink, statusTag, statusLabel, safeUrl } from '../util.js';
import { href, media, IC, cart, settings, profile, resetProfile, requireLogin, renderProducts, skeletonCards } from '../layout.js';
import { attributionFor, wireReviewForms, reviewFormHtml } from '../share.js';
const main = () => $('#main');
const safeNext = (n) => (n && /^[\w\-./?=&%]+$/.test(n) && !n.startsWith('/') && !n.includes('//') && !n.includes(':')) ? n : 'dashboard.html';
const strength = (pw) => { let s = 0; if (pw.length >= 10) s++; if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++; if (/\d/.test(pw)) s++; if (/[^\w]/.test(pw)) s++; if (pw.length >= 14) s++; return s; };
const pwOk = (pw) => pw.length >= 10 && /[a-zA-Z]/.test(pw) && /\d/.test(pw);
const demoNote = (html) => DEMO ? `<div class="alert warn small">${html}</div>` : '';

// ---------- auth ----------
// one-tap "resend verification email" box (login page, register success, checkout gate)
const verifyBox = (email, lead) => `<div class="alert" id="vbox"><b>📧 Email verify karo</b><div class="small" style="margin:6px 0 10px">${lead || 'Order karne se pehle bas ek baar email verify karna hai.'} <b>${esc(email || '')}</b> pe bheja gaya link kholo (Inbox ya Spam folder dekho).</div><button type="button" class="btn sm" id="vres">Verify link dobara bhejo</button> <span class="small" id="vmsg" aria-live="polite"></span></div>`;
const bindVerify = (email) => { const b = $('#vres'); if (!b) return; b.onclick = async () => { b.disabled = true; $('#vmsg').textContent = 'Bhej rahe hain…';
  try { await api.auth.resendConfirm(email); $('#vmsg').textContent = '✓ Link bhej diya. Inbox / Spam check karo.'; setTimeout(() => { b.disabled = false; }, 60000); }
  catch (x) { $('#vmsg').textContent = errText(x); setTimeout(() => { b.disabled = false; }, 15000); } }; };
export async function login() {
  const p = await profile(); if (p && !param('mfa')) { location.replace(safeNext(param('next'))); return; }
  main().innerHTML = `<div class="auth-wrap"><div class="auth-card"><div class="logo-c"><img src="assets/logo-lockup.png?v=6" alt="SHOPZENT"></div><h1 class="center" style="font-size:1.4rem">Welcome back</h1>
  ${param('confirmed') ? '<div class="alert ok">Email confirmed — you can log in now.</div>' : ''}
  ${param('next') ? `<div class="alert small">🛒 Please log in to continue. <b>New to SHOPZENT? <a href="register.html?next=${encodeURIComponent(safeNext(param('next')))}">Register here</a></b> — it takes a minute, then you come straight back to your cart.</div>` : ''}
  <form id="lf" novalidate><div class="field"><label for="em">Email</label><input id="em" type="email" autocomplete="username" required maxlength="120"></div>
  <div class="field"><label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" required maxlength="128"></div>
  <div id="captcha"></div><p class="err" id="le" role="alert"></p><div id="vwrap"></div><div id="adm-hint" class="alert small" hidden>🔐 This is the admin account. <b>Admin? <a href="admin/index.html" id="adm-link">Login here →</a></b></div><button class="btn block" id="lb">Log in</button></form>
  <form id="mf" hidden novalidate><div class="alert">🔐 Enter the 6-digit code from your authenticator app.</div>${demoNote('Demo mode: enter any 6 digits.')}<div class="field"><label for="otp">Authenticator code</label><input id="otp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="\\d{6}" required></div>
  <p class="err" id="me" role="alert"></p><button class="btn block">Verify</button><p class="small center" style="margin-top:10px"><a href="#" id="use-rc">Lost your phone? Use a recovery code</a></p></form>
  <p class="small center" style="margin-top:14px"><a href="forgot-password.html">Forgot password?</a> · New here? <a href="register.html${param('next') ? '?next=' + encodeURIComponent(safeNext(param('next'))) : ''}">Create account</a></p></div></div>`;
  let factorId = null;
  const toMfa = async () => { const f = (await api.auth.factors()).find((x) => x.status === 'verified'); factorId = f?.id; $('#lf').hidden = true; $('#mf').hidden = false; $('#otp').focus(); };
  if (param('mfa') && p) await toMfa();
  const ADMIN_EMAIL = String(config.ADMIN_EMAIL || config.DEMO_ADMIN?.email || '').trim().toLowerCase();
  const isAdminEmail = (v) => !!ADMIN_EMAIL && String(v || '').trim().toLowerCase() === ADMIN_EMAIL;
  const admHint = () => { const on = isAdminEmail($('#em').value); $('#adm-hint').hidden = !on; $('#adm-link').href = 'admin/index.html' + (on ? '?email=' + encodeURIComponent($('#em').value.trim()) : ''); };
  $('#em').addEventListener('input', admHint); $('#em').addEventListener('change', admHint);
  $('#lf').addEventListener('submit', async (e) => { e.preventDefault(); const em = $('#em').value.trim(), pw = $('#pw').value; $('#le').textContent = '';
    if (!/^\S+@\S+\.\S+$/.test(em) || !pw) { $('#le').textContent = 'Please enter your email and password.'; return; }
    $('#lb').disabled = true; $('#lb').textContent = 'Checking…';
    if (isAdminEmail(em)) { // the admin signs in here too: password checked, then straight to the admin panel's 2-step verification
      try { await api.auth.signIn(em, pw); resetProfile(); location.href = 'admin/index.html'; return; }
      catch (er) { admHint(); $('#le').textContent = er.message === 'rate_limited' ? 'Too many attempts. Please wait a minute and try again.' : errText(er); $('#lb').disabled = false; $('#lb').textContent = 'Log in'; return; } }
    try { const st = await api.auth.signIn(em, pw); resetProfile(); if (st.mfaRequired) { await toMfa(); return; } await afterLogin(); }
    catch (er) { if (er.message === 'email_not_confirmed') { $('#le').textContent = ''; $('#vwrap').innerHTML = verifyBox(em, 'Aapka account ban gaya hai, bas email verify karna baaki hai.'); bindVerify(em); return; }
      $('#le').textContent = er.message === 'rate_limited' ? `Too many attempts. Please wait ${er.retry_after || 60} seconds and try again.` : errText(er); }
    finally { $('#lb').disabled = false; $('#lb').textContent = 'Log in'; } });
  $('#mf').addEventListener('submit', async (e) => { e.preventDefault(); $('#me').textContent = ''; try { await api.auth.verify(factorId, $('#otp').value.trim()); resetProfile(); await afterLogin(); } catch (er) { $('#me').textContent = er.message; $('#otp').select(); } });
  $('#use-rc').onclick = async (e) => { e.preventDefault(); const code = prompt('Enter one of your recovery codes (e.g. ABCDE-FGHJK):'); if (!code) return;
    try { const ok = await api.rpc('use_recovery_code', { p_code: code.trim().toUpperCase() }); if (!ok) { $('#me').textContent = 'That recovery code is not valid or was already used.'; return; } toast('Recovery code accepted. Your old authenticator was removed — please set up a new one now.', 'ok'); setTimeout(() => location.href = 'profile.html#security', 1200); } catch (er) { $('#me').textContent = errText(er); } };
  async function afterLogin() { const pr = await profile(); try { await api.rpc('log_auth_event', { p_action: 'login_success', p_details: {} }); } catch {} location.replace(safeNext(param('next'))); }
}
export async function register() {
  main().innerHTML = `<div class="auth-wrap"><div class="auth-card"><div class="logo-c"><img src="assets/logo-lockup.png?v=6" alt="SHOPZENT"></div><h1 class="center" style="font-size:1.4rem">Create your account</h1>
  ${demoNote('Preview mode: accounts are saved only in this browser and are confirmed instantly.')}
  <form id="rf" novalidate><div class="field"><label for="fn">Full name</label><input id="fn" required maxlength="80" autocomplete="name"></div>
  <div class="field"><label for="em">Email</label><input id="em" type="email" required maxlength="120" autocomplete="email"></div>
  <div class="field"><label for="mo">Mobile number</label><input id="mo" inputmode="numeric" required maxlength="10" placeholder="10-digit mobile" autocomplete="tel-national"></div>
  <div class="field"><label for="pw">Password</label><input id="pw" type="password" required maxlength="128" autocomplete="new-password"><div class="pw-meter"><i id="pm"></i></div><span class="hint">At least 10 characters with letters and numbers.</span></div>
  <div class="field"><label for="pw2">Confirm password</label><input id="pw2" type="password" required maxlength="128" autocomplete="new-password"></div>
  <label class="small row" style="gap:8px;margin-bottom:12px;flex-wrap:nowrap"><input type="checkbox" id="agree"> <span>I agree to the <a href="terms.html" target="_blank">Terms</a> and <a href="privacy.html" target="_blank">Privacy Policy</a>.</span></label>
  <p class="err" id="re" role="alert"></p><button class="btn block" id="rb">Create account</button></form>
  <p class="small center" style="margin-top:14px">Already have an account? <a href="login.html${param('next') ? '?next=' + encodeURIComponent(safeNext(param('next'))) : ''}">Log in</a></p></div></div>`;
  $('#pw').addEventListener('input', () => { const s = strength($('#pw').value); $('#pm').style.width = s * 20 + '%'; $('#pm').style.background = ['#DC2626', '#DC2626', '#F97316', '#EAB308', '#22C55E', '#059669'][s]; });
  $('#rf').addEventListener('submit', async (e) => { e.preventDefault(); const d = { full_name: $('#fn').value.trim(), email: $('#em').value.trim().toLowerCase(), mobile: $('#mo').value.trim(), password: $('#pw').value };
    const er = !d.full_name ? 'Please enter your name.' : !/^\S+@\S+\.\S+$/.test(d.email) ? 'Please enter a valid email.' : !/^[6-9]\d{9}$/.test(d.mobile) ? 'Please enter a valid 10-digit Indian mobile number.' : !pwOk(d.password) ? 'Password must be at least 10 characters with letters and numbers.' : d.password !== $('#pw2').value ? 'Passwords do not match.' : !$('#agree').checked ? 'Please accept the Terms and Privacy Policy.' : '';
    if (er) { $('#re').textContent = er; return; } $('#rb').disabled = true;
    const lg = 'login.html' + (param('next') ? '?next=' + encodeURIComponent(safeNext(param('next'))) : '');
    try { const r = await api.auth.signUp(d); $('#rf').outerHTML = r.demoAutoConfirmed ? `<div class="alert ok">Account created (preview). You can log in now.</div><a class="btn block" href="${lg}">Log in</a>` : r.needsConfirm === false ? `<div class="alert ok">Account ban gaya! 🎉 Aap login ho chuke ho. <span class="small">(Account created.)</span></div><a class="btn block" href="${safeNext(param('next'))}">Shopping continue karo</a>` : `<div class="alert ok">Account ban gaya! 🎉 Bas ek step: <b>${esc(d.email)}</b> pe humne verify link bheja hai. Link kholo, phir login karo. <span class="small">(Account created: open the link we emailed you, then log in.)</span></div><p class="small muted">Email nahi aaya? Spam folder dekho, ya: <button type="button" class="btn xs sec" id="vres">Link dobara bhejo</button> <span id="vmsg" class="small" aria-live="polite"></span></p><a class="btn block" href="${lg}">Login pe jao</a>`; if (!r.demoAutoConfirmed && r.needsConfirm !== false) bindVerify(d.email); resetProfile(); }
    catch (x) { $('#re').textContent = errText(x); $('#rb').disabled = false; } });
}
export async function forgot() {
  main().innerHTML = `<div class="auth-wrap"><div class="auth-card"><div class="logo-c"><img src="assets/logo-lockup.png?v=6" alt="SHOPZENT"></div><h1 class="center" style="font-size:1.4rem">Forgot password</h1><p class="muted center small">Enter your email and we'll send a reset link (valid for a limited time).</p>
  <form id="ff"><div class="field"><label for="em">Email</label><input id="em" type="email" required maxlength="120" autocomplete="email"></div><button class="btn block">Send reset link</button></form><p class="small center" style="margin-top:14px"><a href="login.html">Back to login</a></p></div></div>`;
  $('#ff').addEventListener('submit', async (e) => { e.preventDefault(); const em = $('#em').value.trim(); if (!/^\S+@\S+\.\S+$/.test(em)) return; try { await api.auth.sendReset(em); } catch {}
    $('#ff').outerHTML = '<div class="alert ok">If an account exists for that email, a password reset link is on its way. Check your inbox and spam folder.</div>'; });
}
export async function reset() {
  main().innerHTML = `<div class="auth-wrap"><div class="auth-card"><div class="logo-c"><img src="assets/logo-lockup.png?v=6" alt="SHOPZENT"></div><h1 class="center" style="font-size:1.4rem">Set a new password</h1><div id="rs"></div></div></div>`;
  await new Promise((r) => setTimeout(r, 600)); const s = await api.auth.session();
  if (!s) { $('#rs').innerHTML = `<div class="alert bad">This reset link is invalid or has expired. Please request a new one.</div><a class="btn block" href="forgot-password.html">Request new link</a>`; return; }
  $('#rs').innerHTML = `<form id="nf"><div class="field"><label for="pw">New password</label><input id="pw" type="password" required maxlength="128" autocomplete="new-password"><span class="hint">At least 10 characters with letters and numbers.</span></div><div class="field"><label for="pw2">Confirm</label><input id="pw2" type="password" required maxlength="128" autocomplete="new-password"></div><p class="err" id="ne"></p><button class="btn block">Update password</button></form>`;
  $('#nf').addEventListener('submit', async (e) => { e.preventDefault(); const pw = $('#pw').value; if (!pwOk(pw)) { $('#ne').textContent = 'Password must be at least 10 characters with letters and numbers.'; return; } if (pw !== $('#pw2').value) { $('#ne').textContent = 'Passwords do not match.'; return; }
    try { await api.auth.updatePassword(pw); await api.auth.signOut(true); $('#rs').innerHTML = '<div class="alert ok">Password updated and you were signed out on all devices. Please log in with your new password.</div><a class="btn block" href="login.html">Log in</a>'; } catch (x) { $('#ne').textContent = errText(x); } });
}
// ---------- account shell ----------
const ACC = [['dashboard.html', 'Dashboard'], ['orders.html', 'My Orders'], ['wallet.html', 'Wallet & Coins'], ['wishlist.html', 'Wishlist'], ['returns.html', 'Return / Refund'], ['profile.html', 'Profile & Security']];
function shell(title, inner) { const here = location.pathname.split('/').pop();
  // every account section gets the time-of-day greeting + name + SHOPZENT ID mark (filled after render; pages that already show one are skipped)
  const slot = inner.includes('sz-greet') ? '' : '<div class="sz-hello-slot"></div>';
  setTimeout(szFillSlots, 0);
  return `<div class="phead"><div class="container"><div class="crumbs"><a href="index.html">Home</a> / <a href="dashboard.html">My account</a> / ${esc(title)}</div><h1>${esc(title)}</h1></div></div>
  <div class="container acc"><nav class="acc-nav" aria-label="Account">${ACC.map(([h, l]) => `<a href="${h}" class="${h === here ? 'active' : ''}">${l}</a>`).join('')}<a href="#" data-logout>Log out</a><a href="#" data-logout-all>Log out all devices</a></nav><div id="acc-body">${slot}${inner}</div></div>`; }
async function szFillSlots() { const els = document.querySelectorAll('.sz-hello-slot'); if (!els.length) return; const p = await profile().catch(() => null); els.forEach((el) => { if (p) el.outerHTML = szHello(p); else el.remove(); }); }
export async function dashboard() {
  const p = await requireLogin(); const hr = new Date().getHours();
  const gr = hr >= 5 && hr < 12 ? 'Good morning ☀️' : hr >= 12 && hr < 17 ? 'Good afternoon 🌤️' : hr >= 17 && hr < 21 ? 'Good evening 🌆' : 'Good night 💤';
  const hasName = !!(p.full_name && p.full_name.trim());
  const badge = `<span class="sz-badge" title="SHOPZENT ID" aria-hidden="true"><svg viewBox="0 0 64 64" width="46" height="46"><defs><linearGradient id="szg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff7ad9"/><stop offset=".55" stop-color="#ff2e97"/><stop offset="1" stop-color="#ffb347"/></linearGradient><filter id="szf" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.2" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><path d="M10 14 L40 4 L54 16 L46 34 L58 50 L24 60 L6 44 L18 30 Z" fill="url(#szg)" filter="url(#szf)"/><path d="M24 22 L38 18 L34 28 L44 30 L28 46 L32 36 L22 34 Z" fill="#fff" opacity=".92"/></svg></span>`;
  main().innerHTML = shell('Dashboard', `<div class="idcard sz-greet"><div class="small" style="opacity:.9">${gr}</div><h2 style="color:#fff;margin:0 0 10px;display:flex;align-items:center;gap:10px;flex-wrap:wrap">${hasName ? esc(p.full_name) : 'Shopper'} ${hasName ? badge : ''}</h2>${hasName ? '' : `<div class="small" style="margin:0 0 10px">Apna naam set karke apna SHOPZENT ID lo — <a href="profile.html" style="color:#fff;text-decoration:underline">Profile me naam daalo</a></div>`}
    <div class="row" style="gap:18px"><div><div class="tiny" style="opacity:.8">Customer ID</div><code>${esc(p.customer_id || '—')}</code></div><div><div class="tiny" style="opacity:.8">Wallet ID</div><code>${esc(p.wallet_id || '—')}</code></div></div></div>
    <div class="kpis" style="margin:14px 0" id="kp">${'<div class="kpi sk" style="height:70px"></div>'.repeat(4)}</div>
    <div class="grid g2"><div class="card pad"><div class="row between"><h3 style="margin:0">Recent orders</h3><a class="small" href="orders.html">All →</a></div><div id="ro" class="small" style="margin-top:10px">Loading…</div></div>
    <div class="card pad"><h3>Notifications</h3><div id="nt" class="small">Loading…</div></div></div>
    <div class="card pad" style="margin-top:14px"><h3>Coupon history</h3><div id="ch" class="small">Loading…</div></div>
    <h3 style="margin-top:20px">Recently viewed</h3><div class="scroller" id="rv"></div>`);
  bindLogout();
  const [orders, w, coins, notes] = await Promise.all([api.select('orders', { order: { col: 'created_at', asc: false }, limit: 50 }), api.rpc('my_wallet').catch(() => null), api.rpc('my_coins').catch(() => null), api.select('notifications', { order: { col: 'created_at', asc: false }, limit: 8 }).catch(() => [])]);
  $('#kp').innerHTML = `<div class="kpi g"><b>${orders.length}</b><span>Orders</span></div><div class="kpi"><b>${orders.filter((o) => !['delivered', 'order_cancelled', 'order_rejected', 'refund_completed'].includes(o.status)).length}</b><span>Active orders</span></div><div class="kpi"><b>${inr(w?.available || 0)}</b><span>Store credit</span></div><div class="kpi"><b>${num(coins?.balance || 0)}</b><span>Loyalty coins</span></div>`;
  $('#ro').innerHTML = orders.slice(0, 5).map((o) => `<a class="row between" href="order.html?id=${esc(o.id)}" style="padding:8px 0;border-bottom:1px solid var(--line);color:inherit"><span><b>${esc(o.order_code)}</b><br><span class="muted tiny">${fmtDate(o.created_at)}</span></span><span class="right">${inr(o.total)}<br>${statusTag(o.status)}</span></a>`).join('') || '<p class="muted">No orders yet. <a href="products.html">Start shopping</a></p>';
  $('#nt').innerHTML = notes.map((n) => `<div style="padding:8px 0;border-bottom:1px solid var(--line)" class="${n.read_at ? 'muted' : ''}"><b>${esc(n.title)}</b><br>${esc(n.body)}<br><span class="tiny muted">${fmtDate(n.created_at)}</span> ${n.link ? `<a class="tiny" href="${esc(safeUrl(n.link))}" data-nread="${esc(n.id)}">View</a>` : ''}</div>`).join('') || '<p class="muted">No notifications.</p>';
  $$('[data-nread]').forEach((a) => a.addEventListener('click', () => api.rpc('mark_notification_read', { p_id: a.dataset.nread }).catch(() => {})));
  try { const ch = await api.rpc('my_coupon_history'); $('#ch').innerHTML = ch.length ? `<table class="tbl"><tr><th>Code</th><th>Order</th><th>Saved</th><th>Date</th></tr>${ch.map((c) => `<tr><td><code>${esc(c.code)}</code></td><td>${esc(c.order_code || '')}</td><td>${inr(c.discount_amount)}${c.voided ? ' <span class="tag gray">voided</span>' : ''}</td><td>${fmtDate(c.created_at, false)}</td></tr>`).join('')}</table>` : '<p class="muted">You have not used a coupon yet. <a href="offers.html">See offers</a></p>'; } catch { $('#ch').innerHTML = '<p class="muted">—</p>'; }
  const rv = await api.select('recently_viewed', { order: { col: 'viewed_at', asc: false }, limit: 10 }).catch(() => []); const ids = rv.map((r) => r.product_id);
  const prods = ids.length ? (await api.select('products', { in: { id: ids }, eq: { published: true } })).sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)) : []; await renderProducts($('#rv'), prods, 'Products you view will show up here.');
}
function bindLogout() { $$('[data-logout]').forEach((a) => a.addEventListener('click', async (e) => { e.preventDefault(); await api.auth.signOut(); resetProfile(); location.href = 'index.html'; }));
  $$('[data-logout-all]').forEach((a) => a.addEventListener('click', async (e) => { e.preventDefault(); if (!confirm('Sabhi devices se log out? Aapke saare phones/browsers se login band ho jayega.')) return; try { await api.rpc('log_auth_event', { p_action: 'logout_all', p_details: {} }); } catch {} await api.auth.signOut(true); resetProfile(); location.href = 'index.html'; })); }

export async function profilePage() {
  const p = await requireLogin(); const factors = await api.auth.factors().catch(() => []); const mfaOn = factors.some((f) => f.status === 'verified');
  main().innerHTML = shell('Profile & Security', `<div class="grid g2"><form class="card pad" id="pf"><h3>Profile</h3><div class="field"><label>Customer ID</label><input value="${esc(p.customer_id || '')}" disabled></div><div class="field"><label>Email</label><input value="${esc(p.email || '')}" disabled></div>
    <div class="field"><label for="fn">Full name</label><input id="fn" value="${esc(p.full_name || '')}" maxlength="80" required></div><div class="field"><label for="mo">Mobile</label><input id="mo" value="${esc(p.mobile || '')}" inputmode="numeric" maxlength="10"></div><p class="err" id="pe"></p><button class="btn">Save profile</button></form>
    <form class="card pad" id="cp"><h3>Change password</h3><div class="field"><label for="np">New password</label><input id="np" type="password" maxlength="128" autocomplete="new-password"><span class="hint">At least 10 characters with letters and numbers.</span></div><div class="field"><label for="np2">Confirm</label><input id="np2" type="password" maxlength="128" autocomplete="new-password"></div><p class="err" id="ce"></p><button class="btn sec">Update password</button></form></div>
    <div class="card pad" id="security" style="margin-top:14px"><h3>${IC.shield.replace('<svg', '<svg width="20" height="20" style="display:inline;vertical-align:-4px"')} Two-step verification (2FA)</h3>
    <p class="small muted">Protect your account with an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 2FAS…). ${['admin', 'super_admin'].includes(p.role) ? '<b>Required for admins.</b>' : 'Optional for customers.'}</p>
    <div id="mfa-box">${mfaOn ? `<div class="alert ok">2FA is ON ✓</div><div class="row"><button class="btn sec sm" id="rc">Generate recovery codes</button><button class="btn danger sm" id="mfa-off">Turn off 2FA</button></div>` : `<div class="alert warn">2FA is off.</div><button class="btn sm" id="mfa-on">Turn on 2FA</button>`}</div></div>
    <div class="card pad" style="margin-top:14px"><h3>Sessions</h3><p class="small muted">Signed in somewhere you don't recognise? Sign out everywhere — every device will need to log in again.</p><button class="btn danger sm" id="out-all">Sign out of all devices</button></div>`);
  bindLogout();
  $('#pf').addEventListener('submit', async (e) => { e.preventDefault(); const fn = $('#fn').value.trim(), mo = $('#mo').value.trim(); if (!fn) { $('#pe').textContent = 'Name is required.'; return; } if (mo && !/^[6-9]\d{9}$/.test(mo)) { $('#pe').textContent = 'Enter a valid 10-digit mobile.'; return; }
    try { await api.rpc('update_my_profile', { p_full_name: fn, p_mobile: mo }); resetProfile(); toast('Profile saved ✓', 'ok'); $('#pe').textContent = ''; } catch (x) { $('#pe').textContent = errText(x); } });
  $('#cp').addEventListener('submit', async (e) => { e.preventDefault(); const pw = $('#np').value; if (!pwOk(pw)) { $('#ce').textContent = 'At least 10 characters with letters and numbers.'; return; } if (pw !== $('#np2').value) { $('#ce').textContent = 'Passwords do not match.'; return; }
    try { await api.auth.updatePassword(pw); toast('Password updated ✓', 'ok'); e.target.reset(); $('#ce').textContent = ''; } catch (x) { $('#ce').textContent = errText(x); } });
  $('#out-all').onclick = async () => { if (!await confirmBox('Sign out everywhere?', 'You will be logged out on every device, including this one.', { ok: 'Sign out all', danger: true })) return; try { await api.rpc('log_auth_event', { p_action: 'logout_all', p_details: {} }); } catch {} await api.auth.signOut(true); location.href = 'login.html'; };
  $('#mfa-on')?.addEventListener('click', () => enrollMfa(() => location.reload()));
  $('#mfa-off')?.addEventListener('click', async () => { if (['admin', 'super_admin'].includes(p.role)) { toast('Admins must keep 2FA on. Add a new authenticator first if you changed phones.', 'bad'); return; } if (!await confirmBox('Turn off 2FA?', 'Your account will be protected by password only.', { ok: 'Turn off', danger: true })) return; try { for (const f of factors) await api.auth.unenroll(f.id); toast('2FA turned off'); location.reload(); } catch (x) { toast(errText(x), 'bad'); } });
  $('#rc')?.addEventListener('click', async () => { try { const codes = await api.rpc('generate_recovery_codes'); modal(`<h3>Your recovery codes</h3><p class="small muted">Each code works <b>once</b> if you lose your phone. Save them somewhere safe (not in this phone). They will not be shown again — generating new codes cancels the old ones.</p><pre style="background:#F5F3FF;padding:14px;border-radius:12px;font-size:1rem;line-height:1.8;text-align:center">${codes.map(esc).join('\n')}</pre><div class="row"><button class="btn sec sm" id="cpy">Copy</button><button class="btn sm" data-close>I saved them</button></div>`, { onOpen: (el) => { el.querySelector('#cpy').onclick = () => navigator.clipboard?.writeText(codes.join('\n')).then(() => toast('Copied')); } }); } catch (x) { toast(errText(x), 'bad'); } });
}
export async function enrollMfa(done) {
  let en; try { en = await api.auth.enroll(); } catch (x) { toast(errText(x), 'bad'); return; }
  const qrSrc = en.qr && en.qr.startsWith('data:') ? en.qr : (en.qr ? 'data:image/svg+xml;utf8,' + encodeURIComponent(en.qr) : '');
  modal(`<h3>Set up your authenticator</h3><ol class="small"><li>Open Google Authenticator / Microsoft Authenticator / Authy.</li><li>Scan this QR code (or type the key).</li><li>Enter the 6-digit code it shows.</li></ol>
    <div class="qr-box" style="margin:10px 0">${qrSrc ? `<img src="${qrSrc}" alt="Authenticator QR code" style="width:200px;height:200px">` : ''}<div class="tiny muted" style="margin-top:8px;word-break:break-all">Key: <code>${esc(en.secret)}</code></div></div>
    ${DEMO ? '<div class="alert warn small">Demo mode: enter any 6 digits.</div>' : ''}<div class="field"><label for="ec">6-digit code</label><input id="ec" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></div><p class="err" id="ee"></p><div class="row" style="justify-content:flex-end"><button class="btn sec sm" data-close>Cancel</button><button class="btn sm" id="ev">Verify & turn on</button></div>`,
    { onOpen: (el, close) => { el.querySelector('#ev').onclick = async () => { try { await api.auth.verify(en.id, el.querySelector('#ec').value.trim()); try { await api.rpc('log_auth_event', { p_action: 'mfa_enrolled', p_details: {} }); } catch {} close(); toast('2FA is ON ✓ Now generate and save your recovery codes.', 'ok'); done && done(); } catch (x) { el.querySelector('#ee').textContent = x.message; } }; } });
}
// ---------- cart ----------
export async function cartPage() {
  main().innerHTML = `<div class="phead"><div class="container"><div class="crumbs"><a href="index.html">Home</a> / Cart</div><h1>Your cart</h1></div></div><div class="container layout2"><div id="ci">${skeletonCards(2)}</div><aside class="side"><div class="summary" id="cs"></div></aside></div>`;
  const draw = async () => { const items = cart.get();
    if (!items.length) { $('#ci').innerHTML = `<div class="empty card"><img src="assets/img/empty.svg" alt=""><h3>Your cart is empty</h3><p>Find something you love.</p><a class="btn" href="products.html">Shop now</a></div>`; $('#cs').innerHTML = '<p class="muted small">Add products to see your total.</p>'; return; }
    const prods = await api.select('products', { in: { id: items.map((i) => i.product_id) } }); const valid = items.filter((i) => prods.find((p) => p.id === i.product_id && p.purchase_type === 'direct'));
    if (valid.length !== items.length) cart.set(valid);
    let q = null; try { q = await api.rpc('quote_cart', { p_items: valid }); } catch (x) { $('#cs').innerHTML = `<div class="alert bad">${esc(errText(x))}</div>`; }
    $('#ci').innerHTML = valid.map((i) => { const p = prods.find((x) => x.id === i.product_id); const l = q?.lines.find((x) => x.product_id === i.product_id && (x.size || '') === (i.size || '')); const sz = esc(i.size || ''); return `<div class="cart-item"><img src="${esc(media((p.images || [])[0]) || 'assets/img/placeholder.svg')}" alt=""><div><a href="product.html?slug=${esc(p.slug)}" style="color:inherit;font-weight:600">${esc(p.name)}</a>${i.size ? ` <span class="tag cyan">Size ${sz}</span>` : ''}
      <div class="price" style="margin:4px 0"><b>${inr(p.price)}</b>${p.original_price > p.price ? `<s>${inr(p.original_price)}</s>` : ''}</div>${p.availability === 'out_of_stock' ? '<span class="tag red">Out of stock — remove to continue</span>' : ''}
      <div class="row between"><div class="qty"><button data-dec="${esc(p.id)}" data-sz="${sz}" aria-label="Less">−</button><input value="${i.qty}" data-q="${esc(p.id)}" data-sz="${sz}" inputmode="numeric" aria-label="Quantity"><button data-inc="${esc(p.id)}" data-sz="${sz}" aria-label="More">+</button></div><button class="btn ghost xs" data-rm="${esc(p.id)}" data-sz="${sz}">Remove</button></div>${l ? `<div class="tiny muted" style="margin-top:4px">Line total ${inr(l.line_total)}</div>` : ''}</div></div>`; }).join('');
    if (q) $('#cs').innerHTML = `<h3>Order summary</h3><div class="ln"><span>Subtotal</span><span>${inr(q.subtotal)}</span></div>${q.product_discount > 0 ? `<div class="ln" style="color:var(--ok)"><span>Product discount</span><span>−${inr(q.product_discount)}</span></div>` : ''}<div class="ln"><span>Delivery</span><span>${q.delivery_charge > 0 ? inr(q.delivery_charge) : '<b style="color:var(--ok)">FREE</b>'}</span></div><div class="ln total"><span>Total</span><span>${inr(q.total)}</span></div><p class="tiny muted">Your first order ships free; after that a small delivery charge applies. Coupons and store credit can be applied at checkout. Prices are always calculated by our server.</p>${(q.min_order > 0 && q.subtotal - q.product_discount < q.min_order) ? `<div class="alert bad small">⚠️ Minimum order ${inr(q.min_order)} (products). Aapke cart me ${inr(q.subtotal - q.product_discount)} hai — ${inr(q.min_order - (q.subtotal - q.product_discount))} aur ka saman jodein, tabhi order aage badhega. (Delivery ${inr(25)} alag, sirf pehla order free.)</div><button class="btn block" disabled>Proceed to checkout</button>` : '<a class="btn block" href="checkout.html">Proceed to checkout</a>'}<a class="btn ghost block sm" href="products.html" style="margin-top:6px">Continue shopping</a>`;
  };
  $('#ci').addEventListener('click', (e) => { const t = e.target; const c = cart.get(); const sz = t.dataset.sz || ''; const g = (id) => c.find((x) => x.product_id === id && (x.size || '') === sz)?.qty || 1;
    if (t.dataset.inc) { cart.qty(t.dataset.inc, g(t.dataset.inc) + 1, sz); draw(); } if (t.dataset.dec) { cart.qty(t.dataset.dec, g(t.dataset.dec) - 1, sz); draw(); } if (t.dataset.rm) { cart.remove(t.dataset.rm, sz); draw(); } });
  $('#ci').addEventListener('change', (e) => { if (e.target.dataset.q) { cart.qty(e.target.dataset.q, parseInt(e.target.value) || 1, e.target.dataset.sz || ''); draw(); } });
  draw();
}
// ---------- checkout ----------
export async function checkout() {
  const p = await requireLogin(); const s = await settings(); const items = cart.get();
  if (!items.length) { main().innerHTML = `<div class="container empty"><img src="assets/img/empty.svg" alt=""><h2>Your cart is empty</h2><a class="btn" href="products.html">Shop now</a></div>`; return; }
  const rules = s.order_rules || {};
  const el = await api.rpc('my_order_eligibility').catch(() => null);
  if (el && (!el.email_confirmed || el.blocked || el.disposable_email || el.minutes_to_wait > 0)) {
    const msg = el.blocked ? `<h2 style="margin-top:0">🙏 Order abhi nahi ho sakta</h2><p class="small">${esc(errText('account_suspended'))}</p>${s.contact?.whatsapp ? `<a class="btn block" href="${waLink(s.contact.whatsapp, 'Hi SHOPZENT, mujhe order karne me madad chahiye.')}" target="_blank" rel="noopener">WhatsApp pe baat karein</a>` : ''}`
      : el.disposable_email ? `<h2 style="margin-top:0">📧 Asli email chahiye</h2><p class="small">${esc(errText('disposable_email'))}</p>`
      : !el.email_confirmed ? verifyBox(el.email) + '<button class="btn block sec" id="vdone" style="margin-top:10px">Maine verify kar liya ✓</button>'
      : `<h2 style="margin-top:0">⏳ Thoda sa ruko</h2><p class="small">Naya account hai, ${el.minutes_to_wait} min baad order kar paoge. Tab tak cart me items safe hain.</p>`;
    main().innerHTML = `<div class="container" style="max-width:520px;padding:24px 16px"><div class="card pad" id="emailgate">${msg}</div></div>`;
    bindVerify(el.email); $('#vdone')?.addEventListener('click', () => location.reload());
    return; }
  if (rules.require_phone !== false) { const me = (await api.select('profiles', { eq: { id: p.id }, single: true }).catch(() => null)) || {};
    if (!me.phone || (rules.require_phone_verified && !me.phone_verified_at)) {
      main().innerHTML = `<div class="container" style="max-width:520px;padding:24px 16px"><div class="card pad" id="phonegate"><h2 style="margin-top:0">📱 Mobile number</h2><p class="small">Delivery ke liye apna mobile number ek baar add kar do (10 digits). Ye profile me save ho jayega, agli baar nahi poochenge.</p><form id="phf"><div class="field"><label for="ph">Mobile number</label><input id="ph" inputmode="numeric" maxlength="14" placeholder="98XXXXXXXX" value="${esc(me.mobile || '')}" required></div><p class="err" id="phe"></p><button class="btn block">Save &amp; continue</button></form></div></div>`;
      $('#phf').onsubmit = async (e) => { e.preventDefault(); $('#phe').textContent = ''; try { await api.rpc('update_my_profile', { p_full_name: (me.full_name || p.full_name || 'Customer').slice(0, 100), p_mobile: $('#ph').value.trim() }); location.reload(); } catch (x) { $('#phe').textContent = errText(x); } };
      return; } }
  const w = await api.rpc('my_wallet').catch(() => ({ available: 0 })); const last = JSON.parse(localStorage.getItem('sz_ship') || '{}');
  // coins at checkout: internal points, own products only, at most max_percent of each line, 1 coin = rupee_per_coin
  const cc = s.coins_checkout || {}; const coinRate = Number(cc.rupee_per_coin) > 0 ? Number(cc.rupee_per_coin) : 1; const coinPct = Number(cc.max_percent_per_line) > 0 ? Number(cc.max_percent_per_line) : 5;
  const mcoins = cc.enabled === false ? null : await api.rpc('my_coins').catch(() => null); const coinBal = mcoins && mcoins.enabled !== false ? Math.max(0, Math.floor(Number(mcoins.available ?? mcoins.balance) || 0)) : 0; // held coins (pending transfer) are not spendable
  let coinsOn = false; let cur = { useW: 0, coinAlloc: [], coinRs: 0 };
  main().innerHTML = `<div class="phead"><div class="container"><div class="crumbs"><a href="cart.html">Cart</a> / Checkout</div><h1>Checkout</h1></div></div>
  <div class="container"><div class="steps"><span class="on">1 · Address</span><span class="on">2 · Coupon</span><span>3 · Pay by UPI</span><span>4 · Submit UTR</span></div></div>
  <div class="container layout2" style="padding-top:0"><form class="card pad" id="sf" novalidate><h3>Delivery address</h3><div class="form-grid">
    <div class="field"><label for="s-name">Full name</label><input id="s-name" required maxlength="80" value="${esc(last.name || p.full_name || '')}" autocomplete="name"></div><div class="field"><label for="s-phone">Mobile</label><input id="s-phone" required inputmode="numeric" maxlength="10" value="${esc(last.phone || p.phone || p.mobile || '')}" autocomplete="tel-national"></div>
    <div class="field full"><label for="s-l1">House / street</label><input id="s-l1" required maxlength="150" value="${esc(last.line1 || '')}" autocomplete="address-line1"></div><div class="field full"><button type="button" class="btn sec sm" id="s-loc">📍 Meri current location use karein</button> <span class="tiny muted" id="s-locm">(optional — ya neeche address khud likhein)</span></div><div class="field full"><label for="s-l2">Area / landmark (optional)</label><input id="s-l2" maxlength="150" value="${esc(last.line2 || '')}" autocomplete="address-line2"></div>
    <div class="field"><label for="s-city">City</label><input id="s-city" required maxlength="60" value="${esc(last.city || '')}" autocomplete="address-level2"></div><div class="field"><label for="s-state">State</label><input id="s-state" required maxlength="60" value="${esc(last.state || '')}" autocomplete="address-level1"></div>
    <div class="field"><label for="s-pin">Pincode</label><input id="s-pin" required inputmode="numeric" maxlength="6" value="${esc(last.pincode || '')}" autocomplete="postal-code"></div><div class="field"><label for="s-note">Note (optional)</label><input id="s-note" maxlength="200"></div></div>
    <hr class="sep"><h3>Before you pay</h3><div class="small"><p>🚚 <b>Delivery:</b> ${esc(s.delivery?.estimate_text || '')}</p><p>↩️ <b>Returns:</b> ${esc(s.return_policy?.summary || '')} <a href="refund-policy.html" target="_blank">Full policy</a></p><p>💳 <b>Payment:</b> You'll pay by UPI on the next screen and submit your UTR number. Your order is confirmed only after our team verifies the payment in our bank/UPI records — a screenshot alone does not confirm payment.</p><p>🏷️ <b>Seller:</b> ${esc(s.seller?.name || 'SHOPZENT')} · ${esc(s.contact.email)} · +91 ${esc(s.contact.whatsapp)}</p></div>
    <label class="small row" style="gap:8px;flex-wrap:nowrap"><input type="checkbox" id="agree"> <span>I have read the return/refund terms and agree to the <a href="terms.html" target="_blank">Terms</a>.</span></label></form>
  <aside class="side"><div class="summary"><h3>Order summary</h3><div id="lines" class="small"></div>
    <div class="row" style="margin:10px 0;flex-wrap:nowrap"><input id="cc" placeholder="Coupon code" maxlength="30" style="text-transform:uppercase" aria-label="Coupon code"><button class="btn sec sm" id="ca" type="button">Apply</button></div><div id="cmsg" class="small" aria-live="polite"></div>
    ${w.available > 0 ? `<label class="small row" style="gap:8px;margin:8px 0"><input type="checkbox" id="uw"> Use store credit (${inr(w.available)} available)</label>` : ''}
    <div id="cbox"></div><div id="tot"></div><p class="err" id="oe" role="alert"></p><button class="btn block" id="po">Place order & pay by UPI</button><p class="tiny muted center" style="margin-top:8px">Final amount is calculated and locked by our server.</p></div></aside></div>`;
  let coupon = sessionStorage.getItem('sz_coupon') || ''; $('#cc').value = coupon; let q = null;
  const recalc = async () => { try { q = await api.rpc('quote_cart', { p_items: items, p_coupon: coupon || null }); } catch (x) { $('#tot').innerHTML = `<div class="alert bad">${esc(errText(x))}</div>`; $('#po').disabled = true; return; }
    $('#lines').innerHTML = q.lines.map((l) => `<div class="row between" style="padding:6px 0;border-bottom:1px solid var(--line);flex-wrap:nowrap"><span>${esc(l.name)} × ${l.qty}</span><span>${inr(l.line_total)}</span></div>`).join('');
    const cm = q.coupon; $('#cmsg').innerHTML = !cm ? '' : cm.valid ? `<span style="color:var(--ok);font-weight:600">✓ ${esc(cm.code)} applied — you save ${inr(q.coupon_discount)}</span> <a href="#" id="crm">remove</a>` : `<span style="color:var(--bad)">${esc(errText(cm.code_status))}</span>`;
    $('#crm')?.addEventListener('click', (e) => { e.preventDefault(); coupon = ''; $('#cc').value = ''; sessionStorage.removeItem('sz_coupon'); recalc(); });
    // coins: fill each line up to its cap until the balance runs out (the server re-checks every number)
    const coinAlloc = []; let coinRs = 0;
    if (coinsOn && coinBal > 0) { let left = coinBal; for (const l of q.lines) { if (left <= 0) break; const capPaise = Math.floor(Math.round(Number(l.line_total) * 100) * coinPct / 100); const cap = Math.floor(capPaise / Math.round(coinRate * 100)); /* integer paise, same rule as the server */ const give = Math.min(cap, left); if (give > 0) { coinAlloc.push({ product_id: l.product_id, size: l.size || '', coins: give, name: l.name }); left -= give; coinRs += give * coinRate; } } }
    coinRs = Math.round(coinRs * 100) / 100; const useW = $('#uw')?.checked ? Math.max(0, Math.min(w.available, q.total - coinRs)) : 0; cur = { useW, coinAlloc, coinRs };
    $('#cbox').innerHTML = coinBal > 0 ? `<label class="small row" style="gap:8px;margin:8px 0"><input type="checkbox" id="uc" ${coinsOn ? 'checked' : ''}> Coins use karein (${num(coinBal)} available) · har product ka max ${coinPct}%, 1 coin = ${inr(coinRate)}</label>${coinAlloc.length ? `<div class="tiny muted">${num(coinAlloc.reduce((a, c) => a + c.coins, 0))} coins = −${inr(coinRs)} (${coinAlloc.map((c) => esc(c.name) + ' ' + c.coins).join(', ')})</div>` : ''}` : '<div class="tiny muted">Coins: abhi balance 0 hai</div>';
    $('#uc')?.addEventListener('change', (e) => { coinsOn = e.target.checked; recalc(); });
    $('#tot').innerHTML = `<div class="ln"><span>Subtotal (MRP-based price)</span><span>${inr(q.subtotal)}</span></div>${q.product_discount > 0 ? `<div class="ln" style="color:var(--ok)"><span>Product discount</span><span>−${inr(q.product_discount)}</span></div>` : ''}${q.coupon_discount > 0 ? `<div class="ln" style="color:var(--ok)"><span>Coupon (${esc(q.coupon.code)})</span><span>−${inr(q.coupon_discount)}</span></div>` : ''}${coinRs > 0 ? `<div class="ln" style="color:var(--ok)"><span>Coins</span><span>−${inr(coinRs)}</span></div>` : ''}${useW > 0 ? `<div class="ln" style="color:var(--ok)"><span>Store credit</span><span>−${inr(useW)}</span></div>` : ''}<div class="ln"><span>Delivery${q.delivery_charge > 0 ? '' : ' (first order free)'}</span><span>${q.delivery_charge > 0 ? inr(q.delivery_charge) : 'Free'}</span></div><div class="ln total"><span>Pay by UPI</span><span>${inr(Math.max(0, q.total - useW - coinRs))}</span></div>`;
    const _below = q.min_order > 0 && q.subtotal - q.product_discount - q.coupon_discount < q.min_order; $('#oe').textContent = _below ? `Minimum order ${inr(q.min_order)} chahiye (delivery alag). Cart me aur saman jodein.` : ''; $('#po').disabled = _below; };
  $('#ca').onclick = () => { coupon = $('#cc').value.trim().toUpperCase(); if (coupon) sessionStorage.setItem('sz_coupon', coupon); else sessionStorage.removeItem('sz_coupon'); recalc(); };
  $('#cc').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('#ca').click(); } }); $('#uw')?.addEventListener('change', recalc);
  await recalc();
  $('#s-loc')?.addEventListener('click', () => { const m = $('#s-locm'); if (!navigator.geolocation) { m.textContent = 'Is phone me location available nahi hai, address khud likhein.'; return; } m.textContent = 'Location le raha hu…';
    navigator.geolocation.getCurrentPosition((pos) => { const link = `https://maps.google.com/?q=${pos.coords.latitude.toFixed(6)},${pos.coords.longitude.toFixed(6)}`; const l2 = $('#s-l2'); l2.value = (l2.value.replace(/\s*📍 https:\/\/maps\.google\.com\/\S+/g, '') + ' 📍 ' + link).trim().slice(0, 150); m.textContent = '✓ Location jod di gayi. House/street, city aur pincode khud bharein.'; }, () => { m.textContent = 'Location allow nahi hui — address khud likhein.'; }, { enableHighAccuracy: true, timeout: 12000 }); });
  $('#po').onclick = async () => { $('#oe').textContent = ''; const ship = { name: $('#s-name').value.trim(), phone: $('#s-phone').value.trim(), line1: $('#s-l1').value.trim(), line2: $('#s-l2').value.trim(), city: $('#s-city').value.trim(), state: $('#s-state').value.trim(), pincode: $('#s-pin').value.trim(), note: $('#s-note').value.trim() };
    const er = !ship.name ? 'Enter the receiver name.' : !/^[6-9]\d{9}$/.test(ship.phone) ? 'Enter a valid 10-digit mobile.' : !ship.line1 ? 'Enter the house / street.' : !ship.city || !ship.state ? 'Enter city and state.' : !/^\d{6}$/.test(ship.pincode) ? 'Enter a valid 6-digit pincode.' : !$('#agree').checked ? 'Please accept the terms to continue.' : '';
    if (er) { $('#oe').textContent = er; return; } if (q?.coupon && !q.coupon.valid) { $('#oe').textContent = 'Remove the invalid coupon first.'; return; }
    $('#po').disabled = true; $('#po').textContent = 'Placing order…';
    try { const r = await api.rpc('create_order', { p_items: items, p_coupon: q?.coupon?.valid ? q.coupon.code : null, p_shipping: ship, p_use_wallet: cur.useW, p_use_coins: cur.coinAlloc.length ? cur.coinAlloc.map((c) => ({ product_id: c.product_id, size: c.size, coins: c.coins })) : null, p_ref: attributionFor(items), p_idempotency_key: idemKey('order') });
      localStorage.setItem('sz_ship', JSON.stringify(ship)); cart.clear(); sessionStorage.removeItem('sz_coupon'); clearIdem('order'); location.href = r.status === 'payment_verified' ? `order.html?id=${r.order_id}&placed=1` : `payment.html?order=${r.order_id}`; }
    catch (x) { $('#oe').textContent = errText(x); $('#po').disabled = false; $('#po').textContent = 'Place order & pay by UPI'; } };
}

// ---------- payment instructions ----------
async function loadOrder(id) { const o = id && await api.select('orders', { eq: { id }, single: true }); if (!o) return null; const items = await api.select('order_items', { eq: { order_id: o.id } }); return { o, items }; }
export async function payment() {
  const p = await requireLogin(); const s = await settings(); const d = await loadOrder(param('order'));
  if (!d) { main().innerHTML = '<div class="container empty"><h2>Order not found</h2><a class="btn" href="orders.html">My orders</a></div>'; return; }
  const { o, items } = d; const pay = s.payment || {}; const upi = (pay.upi_id || '').trim(); const qr = media(pay.qr_url) || (upi.toLowerCase() === 'techravi@fam' ? 'assets/img/upi-qr-techravi.png' : ''); // bundled QR = owner's real QR, decoded payload pa=techravi@fam
  if (!['payment_pending', 'payment_rejected'].includes(o.status)) { location.replace(`order.html?id=${o.id}`); return; }
  const upiLink = upi && /^[\w.\-]{2,}@[\w.\-]{2,}$/.test(upi) ? `upi://pay?pa=${upi}&pn=${encodeURIComponent(pay.payee_name || 'SHOPZENT')}&am=${Number(o.total).toFixed(2)}&cu=INR&tn=${encodeURIComponent(o.order_code)}` : '';
  main().innerHTML = `<div class="phead"><div class="container"><div class="crumbs"><a href="orders.html">My orders</a> / Payment</div><h1>Pay by UPI</h1><p class="muted" style="margin:0">Order <b>${esc(o.order_code)}</b></p></div></div>
  <div class="container"><div class="steps"><span class="on">1 · Address</span><span class="on">2 · Coupon</span><span class="on">3 · Pay by UPI</span><span>4 · Submit UTR</span></div></div>
  <div class="container layout2" style="padding-top:0"><div>
    ${o.status === 'payment_rejected' ? '<div class="alert bad">Your previous payment details could not be verified. Please check and submit the correct UTR again.</div>' : ''}
    <div class="card pad"><h3>Order ${esc(o.order_code)}</h3>${items.map((i) => `<div class="row" style="flex-wrap:nowrap;padding:8px 0;border-bottom:1px solid var(--line)"><img src="${esc(media(i.product_image) || 'assets/img/placeholder.svg')}" alt="" style="width:56px;height:56px;border-radius:10px;object-fit:cover"><div class="grow"><b class="small">${esc(i.product_name)}${i.size ? ' <span class="tag cyan">Size ' + esc(i.size) + '</span>' : ''}</b><div class="tiny muted">Qty ${i.qty} × ${inr(i.unit_price)}${i.original_unit_price > i.unit_price ? ` <s>${inr(i.original_unit_price)}</s>` : ''}</div></div><b class="small">${inr(i.line_total)}</b></div>`).join('')}
    <div class="summary" style="box-shadow:none;padding:10px 0 0"><div class="ln"><span>Price</span><span>${inr(o.subtotal)}</span></div>${o.product_discount > 0 ? `<div class="ln"><span>Product discount</span><span>−${inr(o.product_discount)}</span></div>` : ''}${o.coupon_discount > 0 ? `<div class="ln"><span>Coupon ${esc((o.coupon_codes || []).join(', '))}</span><span>−${inr(o.coupon_discount)}</span></div>` : ''}${o.delivery_charge > 0 ? `<div class="ln"><span>Delivery charge</span><span>${inr(o.delivery_charge)}</span></div>` : ''}${o.wallet_used > 0 ? `<div class="ln"><span>Store credit</span><span>−${inr(o.wallet_used)}</span></div>` : ''}<div class="ln total"><span>Amount to pay</span><span class="gtext" style="font-size:1.4rem">${inr(o.total)}</span></div></div></div>
    <div class="card pad" style="margin-top:14px"><h3>How to pay</h3><ol class="small"><li>Open any UPI app (Google Pay, PhonePe, Paytm, BHIM, your bank app).</li><li>Scan the QR code${upi ? ' or pay to the UPI ID shown' : ''}.</li><li>Pay <b>exactly ${inr(o.total)}</b>. Add <b>${esc(o.order_code)}</b> in the note/remarks if your app allows.</li><li>After paying, copy the <b>12-digit UTR / UPI reference number</b> from the payment receipt.</li><li>Come back here and tap <b>“I have paid — submit UTR”</b>.</li></ol>${pay.instructions ? `<p class="small muted">${esc(pay.instructions)}</p>` : ''}</div></div>
  <aside class="side"><div class="qr-box">${upiLink && window.qrcode ? `<div class="small" style="font-weight:700;margin-bottom:6px">Scan to pay ${inr(o.total)}</div><div id="gen-qr" style="max-width:240px;margin:0 auto" role="img" aria-label="UPI QR code for ${inr(o.total)} to ${esc(upi)}"></div><div class="tiny muted" style="margin-top:6px">QR made from our UPI ID with the exact amount and your order ID filled in.</div>` : qr ? `<img src="${esc(qr)}" alt="SHOPZENT UPI QR code">` : `<div class="alert warn" style="text-align:left">The store owner has not set up the UPI payment details yet. Please contact us on WhatsApp before paying.</div>`}
    ${upi ? `<p style="margin:12px 0 4px" class="small muted">UPI ID</p><div class="row" style="justify-content:center"><code style="font-size:1.05rem;font-weight:700">${esc(upi)}</code><button class="btn xs sec" data-copy="${esc(upi)}">Copy</button></div>` : ''}
    <p class="small" style="margin-top:10px">Payee: <b>${esc(pay.payee_name || 'SHOPZENT')}</b> · Amount: <b>${inr(o.total)}</b></p>
    ${upiLink ? `<a class="btn block sec" href="${esc(upiLink)}" style="margin-bottom:8px">📱 Pay with UPI app</a><p class="tiny muted" style="margin-top:-2px">Works on phones with a UPI app installed.</p>` : ''}
    ${upiLink && qr ? `<details style="margin:8px 0;text-align:left"><summary class="small" style="cursor:pointer">QR not working? Use our regular QR (type the amount yourself)</summary><img src="${esc(qr)}" alt="SHOPZENT UPI QR code (no amount)" style="max-width:220px;margin:10px auto 4px"><p class="tiny muted center">Enter exactly ${inr(o.total)} and write ${esc(o.order_code)} in the note.</p></details>` : ''}
    <a class="btn block" href="payment-submit.html?order=${esc(o.id)}">I have paid — submit UTR</a>
    <a class="btn ghost block sm" target="_blank" rel="noopener" href="${waLink(s.contact.whatsapp, `Hi SHOPZENT, I need help paying for order ${o.order_code} (₹${o.total}).`)}" style="margin-top:6px">Need help? WhatsApp</a>
    <p class="tiny muted" style="margin-top:10px">🔒 Never share your UPI PIN or OTP with anyone. SHOPZENT will never ask for it.</p></div></aside></div>`;
  const box = $('#gen-qr'); if (box && upiLink) { try { const q = window.qrcode(0, 'M'); q.addData(upiLink); q.make(); box.innerHTML = q.createSvgTag({ cellSize: 6, margin: 4, scalable: true }); const svg = box.querySelector('svg'); if (svg) { svg.style.width = '100%'; svg.style.height = 'auto'; svg.setAttribute('focusable', 'false'); } } catch (e) { box.outerHTML = qr ? `<img src="${esc(qr)}" alt="SHOPZENT UPI QR code">` : ''; } }
}
document.addEventListener('click', (e) => { const b = e.target.closest('[data-copy]'); if (b && !b.closest('.coupon')) navigator.clipboard?.writeText(b.dataset.copy).then(() => toast('Copied ✓', 'ok')); });
// ---------- payment submission ----------
export async function paymentSubmit() {
  const p = await requireLogin(); const s = await settings(); const d = await loadOrder(param('order'));
  if (!d) { main().innerHTML = '<div class="container empty"><h2>Order not found</h2><a class="btn" href="orders.html">My orders</a></div>'; return; }
  const { o, items } = d;
  // Message for the owner's WhatsApp. A website cannot send WhatsApp messages or images by itself (that needs the paid
  // WhatsApp Business API): it opens the customer's WhatsApp with everything filled in, and the customer taps Send.
  const shotLink = async (path) => { if (!path || DEMO || !api.signedUrl) return null; try { return await api.signedUrl('payment-proofs', path, 7 * 24 * 3600); } catch { return null; } }; // 7-day link; storage rules allow only the owner of the proof and admins
  const waMsg = (sub, utr, link, hadShot) => `SHOPZENT Payment Details\nCustomer: ${p.full_name}\nCustomer ID: ${p.customer_id}\nOrder ID: ${o.order_code}\nProduct: ${items.map((i) => `${i.product_name}${i.size ? ' (Size ' + i.size + ')' : ''} x${i.qty}`).join(', ')}\nAmount: ₹${o.total}\nUTR / Ref: ${utr}\nScreenshot: ${link ? link : hadShot ? 'attached in this chat' : 'not uploaded'}\nStatus: Payment submitted on website${sub ? ' (' + sub + ')' : ''} — awaiting verification`;
  const shareShot = async (path, text) => { const u = await api.signedUrl('payment-proofs', path, 300); const b = await (await fetch(u)).blob(); const f = new File([b], 'payment.jpg', { type: b.type || 'image/jpeg' });
    if (window.SZ && SZ.shareImage) { const b64 = await new Promise((res) => { const rd = new FileReader(); rd.onload = () => res(String(rd.result).split(',')[1]); rd.readAsDataURL(b); }); SZ.shareImage(b64, text, f.type); return true; }
    if (navigator.canShare && navigator.canShare({ files: [f] })) { await navigator.share({ files: [f], text }); return true; } return false; };
  const done = (sub, utr, waUrl, opened, shotPath) => { main().querySelector('#ps-body').innerHTML = `<div class="alert ok"><b>Payment details submitted ✓</b><br>Reference ${esc(sub)}. Our team will verify your payment against our UPI/bank records and confirm your order. You'll see the update in <a href="order.html?id=${esc(o.id)}">your order</a>.</div>
    <div class="alert small">📲 <b>Last step: send the details on WhatsApp.</b> ${opened ? 'WhatsApp should have opened with your message ready — just tap <b>Send</b>.' : 'Tap the green button — WhatsApp opens with your message ready, then tap <b>Send</b>.'} <b>Also attach your payment screenshot image</b> in the WhatsApp chat.</div>
    ${shotPath ? `<button type="button" class="btn wa block" id="wa-shot" style="font-size:1.05rem;padding:15px;margin-bottom:8px">📎 Screenshot ke saath WhatsApp me bhejo</button><p class="tiny muted" id="wa-shot-m" style="margin:0 0 10px">Ye button message + payment screenshot dono WhatsApp me khol dega. Bas Send dabana hai.</p>` : ''}
    <a class="btn ${shotPath ? 'sec' : 'wa'} block" id="wa-send" target="_blank" rel="noopener" href="${esc(waUrl)}" style="font-size:1.05rem;padding:15px">${IC.wa.replace('<svg', '<svg width="22" height="22"')} ${shotPath ? 'Sirf message bhejo (screenshot link ke saath)' : 'Send on WhatsApp'}</a>
    <p class="tiny muted" style="margin-top:8px">Goes to SHOPZENT on WhatsApp +91 ${esc(s.contact.whatsapp)}. The website can't send WhatsApp messages or images for you — you press <b>Send</b> yourself. Your UTR${DEMO ? '' : ' and screenshot'} already reached our admin team either way.</p>
    <a class="btn sec block" href="order.html?id=${esc(o.id)}" style="margin-top:10px">View order status</a>`;
    const wb = main().querySelector('#wa-shot'); if (wb) wb.onclick = async () => { wb.disabled = true; try { const ok2 = await shareShot(shotPath, waMsg(sub, utr, null, true)); if (!ok2) { $('#wa-shot-m').textContent = 'Is browser me photo share nahi ho sakti. Neeche wale button se message bhejo, aur WhatsApp me apna screenshot khud attach kar do.'; } } catch (x) { $('#wa-shot-m').textContent = 'Share nahi ho paya. Neeche wale button se message bhejo aur screenshot khud attach kar do.'; } wb.disabled = false; }; };
  main().innerHTML = `<div class="phead"><div class="container"><div class="crumbs"><a href="payment.html?order=${esc(o.id)}">Payment</a> / Submit UTR</div><h1>Submit payment details</h1><p class="muted" style="margin:0">Order <b>${esc(o.order_code)}</b> · ${inr(o.total)}</p></div></div>
  <div class="container"><div class="steps"><span class="on">1 · Address</span><span class="on">2 · Coupon</span><span class="on">3 · Pay by UPI</span><span class="on">4 · Submit UTR</span></div></div>
  <div class="container" style="max-width:640px;padding-bottom:30px"><div class="card pad" id="ps-body"></div></div>`;
  if (!['payment_pending', 'payment_rejected'].includes(o.status)) { const sub = (await api.select('payment_submissions', { eq: { order_id: o.id }, order: { col: 'created_at', asc: false }, limit: 1 }))[0]; if (sub) { const link = await shotLink(sub.screenshot_path); done(sub.submission_code, sub.utr, waLink(s.contact.whatsapp, waMsg(sub.submission_code, sub.utr, link, !!sub.screenshot_path)), false, sub.screenshot_path); } else location.replace(`order.html?id=${o.id}`); return; }
  $('#ps-body').innerHTML = `<form id="pf" novalidate><div class="field"><label for="utr">UTR / UPI transaction reference number</label><input id="utr" required maxlength="30" inputmode="text" autocomplete="off" placeholder="e.g. 412345678901"><span class="hint">Find it in your UPI app → payment history → this payment (“UTR”, “UPI Ref No.” or “Transaction ID”).</span></div>
    <div class="field"><label for="shot">Payment screenshot (supporting proof)</label><input id="shot" type="file" accept="image/png,image/jpeg,image/webp"><span class="hint">PNG / JPG / WEBP, max 5 MB. A screenshot alone does not confirm payment — we check our bank/UPI records.</span></div>
    <img id="prev" alt="" style="max-height:220px;border-radius:12px;margin:0 auto 12px;display:none">
    <label class="small row" style="gap:8px;flex-wrap:nowrap;margin-bottom:12px"><input type="checkbox" id="conf"> <span>I confirm I paid ${inr(o.total)} for order ${esc(o.order_code)} and the details are correct.</span></label>
    <p class="err" id="pe" role="alert"></p><button class="btn block" id="pb">Submit for verification</button></form>`;
  $('#shot').addEventListener('change', () => { const f = $('#shot').files[0]; if (f) { $('#prev').src = URL.createObjectURL(f); $('#prev').style.display = 'block'; } });
  $('#pf').addEventListener('submit', async (e) => { e.preventDefault(); $('#pe').textContent = ''; const utr = $('#utr').value.trim(); const n = utr.toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (n.length < 12 || n.length > 22) { $('#pe').textContent = errText('invalid_utr'); return; } if (!$('#conf').checked) { $('#pe').textContent = 'Please tick the confirmation box.'; return; }
    const file = $('#shot').files[0]; $('#pb').disabled = true; $('#pb').textContent = 'Submitting…';
    // open the WhatsApp tab now, inside the tap, so phones don't block it; it is pointed at WhatsApp once the submission is saved
    let win = null; try { win = window.open('', '_blank'); if (win) { win.opener = null; win.document.write('<p style="font:16px sans-serif;padding:20px">Opening WhatsApp…</p>'); } } catch { win = null; }
    try { let path = null; if (file) { await checkFile(file, ['png', 'jpg', 'webp'], 5); path = (await api.upload('payment-proofs', file, p.id)).path; }
      const r = await api.rpc('submit_payment', { p_order_id: o.id, p_utr: utr, p_screenshot_path: path, p_idempotency_key: idemKey('pay-' + o.id) }); clearIdem('pay-' + o.id);
      const url = waLink(s.contact.whatsapp, waMsg(r.submission_code, n, await shotLink(path), !!file));
      let opened = false; try { if (win && !win.closed) { win.location.href = url; opened = true; } } catch { opened = false; }
      done(r.submission_code, n, url, opened, path); }
    catch (x) { try { win?.close(); } catch {} $('#pe').textContent = errText(x); $('#pb').disabled = false; $('#pb').textContent = 'Submit for verification'; } });
}
// ---------- orders ----------
export async function orders() {
  await requireLogin(); main().innerHTML = shell('My Orders', `<div class="pill-tabs" id="ot"></div><div id="ol">${skeletonCards(2)}</div><div id="rvbox"></div>`); bindLogout();
  const list = await api.select('orders', { order: { col: 'created_at', asc: false }, limit: 200 });
  // delivered products without a review yet: 'Review likhein' (one review per product, after delivery only)
  let rvHtml = ''; const dlv = list.filter((o) => o.status === 'delivered');
  if (dlv.length) { const ids = new Set(dlv.map((o) => o.id)); const its = (await api.select('order_items', { limit: 500 }).catch(() => [])).filter((i) => ids.has(i.order_id));
    const done = new Set((await api.rpc('my_reviews').catch(() => [])).map((m) => m.product_id)); const seen = new Set();
    const rows = its.filter((i) => { if (done.has(i.product_id) || seen.has(i.product_id)) return false; seen.add(i.product_id); return true; });
    if (rows.length) rvHtml = `<div class="card pad" style="margin-top:14px"><h3 style="margin-top:0">Delivered · review likhein</h3><p class="tiny muted">Jo product deliver ho gaya, uspar ek baar review likh sakte ho (1-5 stars).</p>${rows.map((i) => `<div style="padding:8px 0;border-top:1px solid var(--line)"><b class="small">${esc(i.product_name)}</b>${reviewFormHtml(i.product_id)}</div>`).join('')}</div>`; } const groups = { All: () => true, 'To pay': (o) => ['payment_pending', 'payment_rejected'].includes(o.status), Verifying: (o) => ['payment_submitted', 'under_verification', 'payment_verified'].includes(o.status), Active: (o) => ['order_confirmed', 'processing', 'shipped'].includes(o.status), Delivered: (o) => o.status === 'delivered', Closed: (o) => /cancel|reject|refund|return/.test(o.status) };
  const draw = (g) => { $$('#ot .chip').forEach((c) => c.classList.toggle('active', c.dataset.g === g)); const r = list.filter(groups[g]);
    $('#ol').innerHTML = r.map((o) => `<a class="card pad" href="order.html?id=${esc(o.id)}" style="display:block;color:inherit;margin-bottom:10px"><div class="row between"><b>${esc(o.order_code)}</b>${statusTag(o.status)}</div><div class="row between small muted" style="margin-top:6px"><span>${fmtDate(o.created_at)}</span><b style="color:var(--ink)">${inr(o.total)}</b></div>${['payment_pending', 'payment_rejected'].includes(o.status) ? '<span class="btn xs" style="margin-top:8px">Pay now →</span>' : ''}</a>`).join('') || `<div class="empty card"><img src="assets/img/empty.svg" alt=""><p>No orders here.</p><a class="btn sm" href="products.html">Shop now</a></div>`; };
  $('#ot').innerHTML = Object.keys(groups).map((g) => `<button class="chip" data-g="${g}">${g} (${list.filter(groups[g]).length})</button>`).join(''); $('#ot').onclick = (e) => { if (e.target.dataset.g) draw(e.target.dataset.g); }; draw('All');
  $('#rvbox').innerHTML = rvHtml; wireReviewForms($('#rvbox'));
}
const FLOW = ['payment_pending', 'payment_submitted', 'payment_verified', 'order_confirmed', 'processing', 'shipped', 'delivered'];
export async function orderDetail() {
  const p = await requireLogin(); const s = await settings(); const d = await loadOrder(param('id'));
  if (!d) { main().innerHTML = shell('Order', '<div class="empty card"><h3>Order not found</h3></div>'); bindLogout(); return; }
  const { o, items } = d; const [events, subs, rets, refs] = await Promise.all([api.select('order_events', { eq: { order_id: o.id }, order: { col: 'created_at', asc: true } }), api.select('payment_submissions', { eq: { order_id: o.id }, order: { col: 'created_at', asc: false } }), api.select('returns', { eq: { order_id: o.id } }), api.select('refund_ledger', { eq: { order_id: o.id } }).catch(() => [])]);
  const idx = FLOW.indexOf(o.status === 'under_verification' ? 'payment_submitted' : o.status);
  main().innerHTML = shell('Order ' + o.order_code, `${param('placed') ? '<div class="alert ok">Order placed and paid fully with store credit ✓</div>' : ''}
    <div class="card pad"><div class="row between"><div><b>${esc(o.order_code)}</b><div class="tiny muted">Placed ${fmtDate(o.created_at)}</div></div>${statusTag(o.status)}</div>
    ${idx >= 0 ? `<div class="steps">${['Pay', 'Submitted', 'Verified', 'Confirmed', 'Packing', 'Shipped', 'Delivered'].map((l, i) => `<span class="${i <= idx ? 'on' : ''}">${l}</span>`).join('')}</div>` : ''}
${(() => { const ls = subs[0]; if (!ls) return ''; const wa = waLink(s.contact?.whatsapp, `Hi SHOPZENT, my payment for order ${o.order_code} (UTR ${ls.utr_normalized || ls.utr}) was rejected. Please help.`);
      if (ls.status === 'verified') return '<div class="alert ok" id="paystate" style="margin-top:10px"><b>Payment successful ✅</b><div class="small">We received your payment. Your order is being processed.</div></div>';
      if (ls.status === 'rejected') return `<div class="alert bad" id="paystate" style="margin-top:10px"><b>Payment rejected ❌</b><div class="small">Reason: ${esc(ls.admin_notes || 'payment not found')}. Please submit the correct UTR again or contact us on WhatsApp.</div><a class="btn wa xs" style="margin-top:6px" target="_blank" rel="noopener" href="${esc(wa)}">WhatsApp us</a></div>`;
      return '<div class="alert warn" id="paystate" style="margin-top:10px"><b>Payment pending verification ⏳</b><div class="small">We are checking your UTR with our bank records. This usually takes a few hours.</div></div>'; })()}
    ${o.reject_reason ? `<div class="alert bad">Reason: ${esc(o.reject_reason)}</div>` : ''}${o.cancel_reason && o.status === 'order_cancelled' ? `<div class="alert">Cancelled: ${esc(o.cancel_reason)}</div>` : ''}
    <div class="row" id="oa" style="margin-top:10px"></div></div>
    <div class="grid g2" style="margin-top:14px"><div class="card pad"><h3>Items</h3>${items.map((i) => `<div class="row" style="flex-wrap:nowrap;padding:8px 0;border-bottom:1px solid var(--line)"><img src="${esc(media(i.product_image) || 'assets/img/placeholder.svg')}" alt="" style="width:52px;height:52px;border-radius:10px;object-fit:cover"><div class="grow small"><b>${esc(i.product_name)}${i.size ? ' <span class="tag cyan">Size ' + esc(i.size) + '</span>' : ''}</b><div class="muted tiny">Qty ${i.qty} × ${inr(i.unit_price)}</div></div><b class="small">${inr(i.line_total)}</b></div>`).join('')}
      <div class="summary" style="box-shadow:none;padding:8px 0 0"><div class="ln"><span>Subtotal</span><span>${inr(o.subtotal)}</span></div>${o.product_discount > 0 ? `<div class="ln"><span>Product discount</span><span>−${inr(o.product_discount)}</span></div>` : ''}${o.coupon_discount > 0 ? `<div class="ln"><span>Coupon</span><span>−${inr(o.coupon_discount)}</span></div>` : ''}${o.delivery_charge > 0 ? `<div class="ln"><span>Delivery charge</span><span>${inr(o.delivery_charge)}</span></div>` : ''}${o.wallet_used > 0 ? `<div class="ln"><span>Store credit</span><span>−${inr(o.wallet_used)}</span></div>` : ''}<div class="ln total"><span>Total paid by UPI</span><span>${inr(o.total)}</span></div></div></div>
    <div class="card pad"><h3>Delivery address</h3><p class="small">${esc(o.ship_name)}<br>${esc(o.ship_line1)}${o.ship_line2 ? ', ' + esc(o.ship_line2) : ''}<br>${esc(o.ship_city)}, ${esc(o.ship_state)} – ${esc(o.ship_pincode)}<br>📞 ${esc(o.ship_phone)}</p>
      <h3>Payment</h3>${subs.map((x) => `<div class="small" style="padding:6px 0;border-bottom:1px solid var(--line)">${statusTag(x.status)} UTR <code>${esc(x.utr_normalized || x.utr)}</code><div class="tiny muted">${esc(x.submission_code)} · ${fmtDate(x.created_at)}${x.status === 'rejected' && x.admin_notes ? ' · ' + esc(x.admin_notes) : ''}</div></div>`).join('') || '<p class="small muted">No payment submitted yet.</p>'}
      ${refs.length ? `<h3 style="margin-top:12px">Refunds</h3>${refs.map((f) => `<div class="small">${statusTag(f.status)} ${inr(f.amount)} via ${f.method === 'wallet' ? 'store credit' : 'original payment method'} ${f.external_reference ? '· ref ' + esc(f.external_reference) : ''}</div>`).join('')}` : ''}
      ${rets.length ? `<h3 style="margin-top:12px">Requests</h3>${rets.map((r) => `<div class="small">${esc(r.kind === 'cancellation' ? 'Cancellation' : 'Return')} ${esc(r.return_code)} ${statusTag(r.status)}${r.reject_reason ? '<br><span class="muted">' + esc(r.reject_reason) + '</span>' : ''}</div>`).join('')}` : ''}</div></div>
    <div class="card pad" style="margin-top:14px"><h3>Order history</h3><ul class="timeline">${events.map((e) => `<li><b class="small">${esc(statusLabel(e.to_status))}</b><div class="tiny muted">${fmtDate(e.created_at)}</div>${e.note ? `<div class="small">${esc(e.note)}</div>` : ''}</li>`).join('')}</ul></div>`);
  bindLogout(); const oa = $('#oa');
  if (['payment_pending', 'payment_rejected'].includes(o.status)) oa.insertAdjacentHTML('beforeend', `<a class="btn sm" href="payment.html?order=${esc(o.id)}">Pay now</a>`);
  if (['payment_pending', 'payment_submitted', 'payment_rejected', 'payment_verified', 'order_confirmed', 'processing'].includes(o.status) && !rets.some((r) => r.kind === 'cancellation' && !['return_rejected'].includes(r.status))) oa.insertAdjacentHTML('beforeend', '<button class="btn sec sm" id="cx">Cancel order</button>');
  if (o.status === 'delivered') { const _w = Number((await settings()).return_policy?.window_days || 7); const _in = o.delivered_at && (Date.now() - new Date(o.delivered_at).getTime()) <= _w * 86400000; oa.insertAdjacentHTML('beforeend', _in ? `<a class="btn sec sm" href="returns.html?order=${esc(o.id)}">Request return (₹50 charge, within ${_w} days)</a>` : `<span class="tiny muted">Return window (${_w} days) closed</span>`); }
  oa.insertAdjacentHTML('beforeend', `<a class="btn ghost sm" target="_blank" rel="noopener" href="${waLink(s.contact.whatsapp, `Hi SHOPZENT, about my order ${o.order_code} (Customer ID ${p.customer_id}).`)}">WhatsApp support</a>`);
  $('#cx')?.addEventListener('click', async () => { const reason = await confirmBox('Cancel this order?', o.payment_status === 'verified' ? `Your payment is already verified, so this sends a cancellation request to our team. Any eligible refund follows our refund policy. ⚠️ Note: after ${s.order_rules?.cancel_penalty_after ?? 5} cancellations in one day, each further cancelled paid order costs ₹${s.order_rules?.cancel_penalty_amount ?? 10} from your wallet.` : 'This order has not been paid/verified yet, so it will be cancelled right away.', { ok: 'Cancel order', danger: true, input: 'Reason' }); if (!reason) return;
    try { const r = await api.rpc('request_cancellation', { p_order_id: o.id, p_reason: reason }); toast(r.cancelled ? 'Order cancelled' : 'Cancellation request sent to our team', 'ok'); setTimeout(() => location.reload(), 700); } catch (x) { toast(errText(x), 'bad'); } });
}

// ---------- wallet & coins ----------

// Time-of-day greeting with the name on file + SHOPZENT ID mark (account pages only)
export function szHello(p) {
  const hr = new Date().getHours();
  const gr = hr >= 5 && hr < 12 ? 'Good morning ☀️' : hr >= 12 && hr < 17 ? 'Good afternoon 🌤️' : hr >= 17 && hr < 21 ? 'Good evening 🌆' : 'Good night 💤';
  const nm = p && p.full_name && String(p.full_name).trim();
  if (!nm) return `<div class="card pad sz-greet" style="margin-bottom:14px"><div class="small" style="opacity:.9">${gr}</div><div class="small">Apna naam set karke SHOPZENT ID lo — <a href="profile.html" style="color:#fff;text-decoration:underline">Profile me naam daalo</a></div></div>`;
  return `<div class="card pad sz-greet" style="margin-bottom:14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap"><div class="small" style="opacity:.9;width:100%">${gr}</div><b style="font-size:1.15rem;color:#fff">${esc(nm)}</b><span class="sz-badge" aria-hidden="true"><svg viewBox="0 0 64 64" width="34" height="34"><defs><linearGradient id="szg2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff7ad9"/><stop offset=".55" stop-color="#ff2e97"/><stop offset="1" stop-color="#ffb347"/></linearGradient></defs><path d="M10 14 L40 4 L54 16 L46 34 L58 50 L24 60 L6 44 L18 30 Z" fill="url(#szg2)"/><path d="M24 22 L38 18 L34 28 L44 30 L28 46 L32 36 L22 34 Z" fill="#fff" opacity=".92"/></svg></span></div>`;
}

export async function walletPage() {
  const pf = await profile();
  if (!pf) { // logged-out visitors see a wallet preview; the number is display-only (no account, nothing can be spent)
    main().innerHTML = `<div class="phead"><div class="container"><div class="crumbs"><a href="index.html">Home</a> / Wallet</div><h1>Wallet &amp; Coins</h1></div></div><div class="container" style="padding:18px 0 30px"><div class="idcard"><div class="tiny" style="opacity:.85">🪙 SHOPZENT coins</div><div style="font-size:2.4rem;font-weight:800">10,649</div><div class="tiny" style="opacity:.85;margin-top:6px">Login karke apne asli coins dekhein</div></div>
      <div class="card pad" style="margin-top:14px"><p class="small">Naye member ko <b>20 coins free</b> welcome bonus milta hai, sign up karte hi wallet me. Login ke baad yahan sirf aapke asli coins dikhenge.</p><div class="row" style="margin-top:10px"><a class="btn" href="login.html?next=wallet.html" style="color:#fff">Log in</a><a class="btn sec" href="register.html">Sign up</a></div></div></div>`;
    return;
  }
  await requireLogin(); main().innerHTML = shell('Wallet & Coins', `${szHello(pf)}<div id="wb">Loading…</div>`); bindLogout();
  const [w, c, led, coinsLed] = await Promise.all([api.rpc('my_wallet'), api.rpc('my_coins').catch(() => null), api.select('wallet_ledger', { order: { col: 'created_at', asc: false }, limit: 200 }), api.select('coin_ledger', { order: { col: 'created_at', asc: false }, limit: 100 }).catch(() => [])]);
  const kindName = { return_credit: 'Return credit', promo_credit: 'Promotional credit', admin_adjust: 'Adjustment', purchase_debit: 'Used on order', reversal: 'Reversal / returned', refund_credit: 'Refund as store credit' };
  const WKIND = { return_credit: '↩️', promo_credit: '🎁', admin_adjust: '⚙️', purchase_debit: '🛍️', reversal: '↩️', refund_credit: '💸' };
  const coinsN = Number(c?.balance || 0); const avail = Number(c?.available ?? c?.balance ?? 0); const held = Number(c?.held) || 0;
  const coinRows = coinsLed.map((l) => ({ l, k: coinKind(l) }));
  $('#wb').innerHTML = `<div class="wl-top-row"><a class="btn sec sm" href="profile.html">✏️ Edit profile</a><a class="tiny" href="wallet-terms.html">Wallet & coins terms</a></div>
    <div class="wl-stage" id="wl-stage">
      <div class="wl-card" id="wl-card" aria-label="SHOPZENT store credit card">
        <span class="wl-shine" aria-hidden="true"></span><span class="wl-orb" aria-hidden="true"></span>
        <div class="wl-head"><span class="wl-brand">SHOPZENT</span><span class="wl-chip" aria-hidden="true"></span></div>
        <div class="wl-lbl">Store credit</div>
        <div class="wl-amt" id="wl-credit" data-val="${Number(w.available) || 0}" data-money="1">${inr(w.available)}</div>
        <div class="wl-ids"><div><span>Wallet ID</span><code>${esc(w.wallet_id)}</code></div><div><span>Customer ID</span><code>${esc(w.customer_id)}</code></div></div>
      </div>
      <div class="wl-coin-card" role="group" aria-label="Loyalty coins">
        <span class="wl-shine" aria-hidden="true"></span>
        <div class="wl-coin3d" aria-hidden="true"><span>🪙</span></div>
        <div class="wl-coin-tx"><span class="wl-lbl">Loyalty coins</span><b class="wl-count" id="wl-coins" data-val="${avail}">${num(avail)}</b><span class="tiny muted">${held ? `on hold: ${num(held)} · ` : ''}1 coin = ₹0.80</span></div>
      </div>
    </div>
    <nav class="wl-quick" aria-label="Quick actions">
      <a class="wl-qa" href="products.html"><span aria-hidden="true">🛍️</span>Shop</a>
      <a class="wl-qa" href="#share-earn"><span aria-hidden="true">🔗</span>Share &amp; Earn</a>
      <a class="wl-qa" href="games.html"><span aria-hidden="true">🎮</span>Play Games</a>
    </nav>
    <div class="kpis wl-kpis" style="margin:14px 0"><div class="kpi"><b>${inr(w.total_credits)}</b><span>Total credits</span></div><div class="kpi"><b>${inr(w.total_debits)}</b><span>Total used</span></div><div class="kpi"><b>${inr(w.pending_credits)}</b><span>Pending credits</span></div><div class="kpi"><b>${num(coinsN)}</b><span>Coins total</span></div></div>
    <div class="alert small">Store credit can be used only for eligible SHOPZENT purchases at checkout. It is <b>not</b> a bank account or money transfer service, cannot be withdrawn as cash and cannot be sent to other people. <a href="wallet-terms.html">Wallet & coins terms</a></div>
    <div class="card pad wl-panel"><h3>Wallet history</h3>${led.length ? `<div class="tbl-wrap wl-tbl" style="box-shadow:none"><table class="tbl"><tr><th>Date</th><th>Type</th><th>Amount</th><th>Ref</th></tr>${led.map((l) => `<tr><td class="tiny">${fmtDate(l.created_at)}</td><td><span class="wl-ic" aria-hidden="true">${WKIND[l.kind] || '💼'}</span>${esc(kindName[l.kind] || l.kind)}${l.status === 'pending' ? ' <span class="tag orange">pending</span>' : ''}<div class="tiny muted">${esc(l.note || '')}</div></td><td style="color:${l.direction === 'credit' ? 'var(--ok)' : 'var(--bad)'};font-weight:700;white-space:nowrap">${l.direction === 'credit' ? '+' : '−'}${inr(l.amount)}</td><td class="tiny"><code>${esc(l.txn_ref)}</code></td></tr>`).join('')}</table></div>` : '<div class="wl-empty"><span aria-hidden="true">🧾</span><p class="small">Abhi wallet me koi entry nahi. Order par store credit use hoga, ya refund aayega to yahan dikhega.</p></div>'}</div>
    <div class="card pad wl-panel" style="margin-top:14px"><h3>🪙 Loyalty coins</h3><p class="small muted">${esc(c?.rules || 'Coins are loyalty points for SHOPZENT promotions. They are not money and have no cash value.')}</p>${c && !c.enabled ? '<div class="alert warn small">The coin programme is paused right now.</div>' : ''}
    ${coinRows.length ? `<ul class="wl-list">${coinRows.map(({ l, k }) => `<li class="wl-row"><span class="wl-ic" aria-hidden="true">${k.icon}</span><div class="wl-row-tx"><b>${esc(k.label)}</b><span class="tiny muted">${fmtDate(l.created_at)}${l.note ? ' · ' + esc(l.note) : ''}${l.expires_at ? ' · expires ' + fmtDate(l.expires_at, false) : ''}</span></div><b class="wl-amt-s ${k.sign === '+' ? 'pos' : 'neg'}">${k.sign}${num(l.coins)}</b></li>`).join('')}</ul>` : `<div class="wl-empty"><span aria-hidden="true">🪙</span><p class="small">Abhi koi coin nahi. Game khelo, dost ke saath share karo, ya order par coins use karo, sab yahan dikhega.</p><div class="row" style="gap:8px;flex-wrap:wrap;justify-content:center"><a class="btn sm" href="games.html">Play Games</a><a class="btn sec sm" href="products.html">Shop</a></div></div>`}</div>`;
  countUpWallet();
  await appendShareEarnings();
}

// Coin history: one icon + plain label per kind of entry (classified from the ledger kind and its note; amounts are the server's)
function coinKind(l) {
  const n = String(l.note || '').toLowerCase(); const plus = l.kind === 'issue' || l.kind === 'transfer_in';
  if (plus && /welcome/.test(n)) return { icon: '🎁', label: 'Welcome bonus', sign: '+' };
  if (plus && /tap rush|game/.test(n)) return { icon: '🏆', label: 'Game prize', sign: '+' };
  if (/share reward/.test(n)) return plus ? { icon: '🔗', label: 'Share reward', sign: '+' } : { icon: '🔗', label: 'Share reward reversed', sign: '−' };
  if (l.kind === 'redeem') return { icon: '🛍️', label: 'Used at checkout', sign: '−' };
  if (plus && /return|refund|cancel/.test(n)) return { icon: '↩️', label: 'Refund / returned', sign: '+' };
  if (l.kind === 'reversal') return { icon: '↩️', label: 'Reversed', sign: '−' };
  if (l.kind === 'transfer_in') return { icon: '📥', label: 'Received from a customer', sign: '+' };
  if (l.kind === 'transfer_out') return { icon: '📤', label: 'Sent to a customer', sign: '−' };
  if (l.kind === 'expire') return { icon: '⌛', label: 'Expired', sign: '−' };
  return plus ? { icon: '🪙', label: 'Coins added', sign: '+' } : { icon: '🪙', label: 'Coins used', sign: '−' };
}

// count-up for the wallet numbers (skipped for reduced motion). Pure display: the numbers come from the server.
function countUpWallet() {
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const card = document.getElementById('wl-card'); const coinsEl = document.getElementById('wl-coins'); const creditEl = document.getElementById('wl-credit');
  if (card && !reduce) { card.onpointermove = (ev) => { const r = card.getBoundingClientRect(); const x = (ev.clientX - r.left) / r.width - 0.5, y = (ev.clientY - r.top) / r.height - 0.5; card.style.transform = `rotateX(${(-y * 8).toFixed(2)}deg) rotateY(${(x * 10).toFixed(2)}deg)`; }; card.onpointerleave = () => { card.style.transform = ''; }; }
  if (reduce) return;
  const run = (el, fmt) => { const to = Number(el.dataset.val) || 0; const t0 = performance.now(), dur = 900; const final0 = el.textContent; el.dataset.final = final0; const step = (now) => { const k = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - k, 3); el.textContent = k < 1 ? fmt(Math.round(to * e)) : final0; if (k < 1) requestAnimationFrame(step); }; requestAnimationFrame(step); };
  if (coinsEl) run(coinsEl, (n) => n.toLocaleString('en-IN'));
  if (creditEl) run(creditEl, (n) => '₹' + n.toLocaleString('en-IN'));
}

// My share earnings: rewards for products the customer shared (pending until delivered, then paid or reversed)
const RW = { pending: 'Pending · delivery ke baad milega', paid: 'Paid · wallet me aa gaya', reversed: 'Reversed · order cancel/refund hua' };
async function appendShareEarnings() {
  const sh = await api.rpc('my_referral_summary').catch(() => null); if (!sh || !sh.enabled && !(sh.rewards || []).length) return;
  const rows = (sh.rewards || []).map((r) => `<tr><td class="tiny">${fmtDate(r.created_at, false)}</td><td>${esc(r.product)}<div class="tiny muted">${esc(RW[r.status] || r.status)}${r.reverse_reason && r.status === 'reversed' ? ' · ' + esc(r.reverse_reason) : ''}</div></td><td style="font-weight:700">${num(r.coins)} coins</td></tr>`).join('');
  $('#wb').insertAdjacentHTML('beforeend', `<div class="card pad" style="margin-top:14px" id="share-earn"><h3>🔗 My share earnings</h3>
    <p class="small muted">Dost aapka share kiya SHOPZENT product kharide to aapko ${Number(sh.default_rate)}% tak coins milenge (product ka amount, admin product-wise 8% tak). Coins product <b>deliver</b> hone ke baad hi wallet me aate hain. Cancel, return ya refund hone par nahi milte. Apne aap ko share karne par nahi milega.</p>
    <div class="kpis" style="margin:10px 0"><div class="kpi"><b>${num(sh.pending_coins)}</b><span>Pending</span></div><div class="kpi"><b>${num(sh.paid_coins)}</b><span>Paid</span></div><div class="kpi"><b>${num(sh.reversed_coins)}</b><span>Reversed</span></div></div>
    <p class="tiny muted">Aapka share code: <code>${esc(sh.code || '')}</code> · Product page ke Share button se link bhejiye.</p>
    ${rows ? `<table class="tbl">${rows}</table>` : '<p class="small muted">Abhi koi share reward nahi.</p>'}</div>`);
}
export async function wishlistPage() {
  await requireLogin(); main().innerHTML = shell('Wishlist', `<div class="grid" id="wl">${skeletonCards(4)}</div>`); bindLogout();
  const ids = (await api.select('wishlist', { order: { col: 'created_at', asc: false } })).map((x) => x.product_id); const prods = ids.length ? await api.select('products', { in: { id: ids }, eq: { published: true } }) : [];
  await renderProducts($('#wl'), prods, 'Your wishlist is empty. Tap ♡ on any product to save it.');
}
// ---------- returns ----------
export async function returnsPage() {
  const p = await requireLogin(); const s = await settings(); main().innerHTML = shell('Return / Refund requests', '<div id="rb">Loading…</div>'); bindLogout();
  const [rets, delivered] = await Promise.all([api.select('returns', { order: { col: 'created_at', asc: false } }), api.select('orders', { eq: { status: 'delivered' }, order: { col: 'created_at', asc: false } }).then((l) => l.filter((o) => o.delivered_at && Date.now() - new Date(o.delivered_at).getTime() <= Number(s.return_policy?.window_days || 7) * 86400000))]);
  const pre = param('order');
  $('#rb').innerHTML = `<div class="alert small">↩️ ${esc(s.return_policy?.summary || '')} Window: <b>${esc(s.return_policy?.window_days || 7)} days</b> from delivery — uske baad return nahi hoga. Return par ₹50 (double delivery) refund se katega. <a href="refund-policy.html">Full policy</a></div>
  <form class="card pad" id="rf" ${delivered.length ? '' : 'hidden'}><h3>Request a return</h3><div class="field"><label for="ro">Order</label><select id="ro">${delivered.map((o) => `<option value="${esc(o.id)}" ${o.id === pre ? 'selected' : ''}>${esc(o.order_code)} · ${inr(o.total)} · delivered ${fmtDate(o.delivered_at, false)}</option>`).join('')}</select></div>
    <div class="field"><label for="rr">Reason</label><select id="rr"><option>Damaged or defective item</option><option>Wrong item received</option><option>Item not as described</option><option>Size / fit issue</option><option>Missing parts or accessories</option><option>Other</option></select></div>
    <div class="field"><label for="rd">Describe the problem</label><textarea id="rd" maxlength="2000" placeholder="Tell us what happened"></textarea></div>
    <div class="field"><label for="rp">Photos (optional, up to 3)</label><input id="rp" type="file" accept="image/png,image/jpeg,image/webp" multiple></div>
    <div class="field"><label>Refund preference</label><label class="small row" style="gap:8px"><input type="radio" name="pref" value="original" checked> Refund to my original payment method (UPI/bank)</label><label class="small row" style="gap:8px"><input type="radio" name="pref" value="wallet"> I accept SHOPZENT store credit (wallet) instead</label></div>
    <p class="err" id="re"></p><button class="btn">Submit request</button></form>
  ${delivered.length ? '' : '<p class="small muted">Returns can be requested for delivered orders. To cancel an order before delivery, open the order and tap “Cancel order”.</p>'}
  <h3 style="margin-top:18px">My requests</h3>${rets.map((r) => `<div class="card pad" style="margin-bottom:10px"><div class="row between"><b>${esc(r.return_code)}</b>${statusTag(r.status)}</div><div class="small muted">${esc(r.kind === 'cancellation' ? 'Cancellation' : 'Return')} · ${fmtDate(r.created_at)} · ${esc(r.reason)}</div>${r.eligible_amount != null ? `<div class="small">Eligible refund: <b>${inr(r.eligible_amount)}</b> (${r.refund_preference === 'wallet' ? 'store credit' : 'original payment method'})</div>` : ''}${r.reject_reason ? `<div class="alert bad small" style="margin:8px 0 0">${esc(r.reject_reason)}</div>` : ''}<a class="small" href="order.html?id=${esc(r.order_id)}">View order →</a></div>`).join('') || '<p class="muted small">No requests yet.</p>'}`;
  $('#rf').addEventListener('submit', async (e) => { e.preventDefault(); $('#re').textContent = ''; const files = [...$('#rp').files].slice(0, 3); const btn = e.target.querySelector('button'); btn.disabled = true;
    try { const paths = []; for (const f of files) { await checkFile(f, ['png', 'jpg', 'webp'], 5); paths.push((await api.upload('return-photos', f, p.id)).path); }
      const r = await api.rpc('request_return', { p_order_id: $('#ro').value, p_reason: $('#rr').value, p_description: $('#rd').value.trim(), p_photos: paths, p_refund_preference: e.target.pref.value }); toast('Return request ' + r.return_code + ' submitted', 'ok'); setTimeout(() => location.reload(), 800); }
    catch (x) { $('#re').textContent = errText(x); btn.disabled = false; } });
}
