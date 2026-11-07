// Live backend adapter: Supabase (Postgres + RLS + Auth + Storage + Edge Functions).
// Uses only the public anon key; every privileged action is enforced in the database (RLS + SECURITY DEFINER functions).
import { uuid } from './util.js';
export function createSupabaseApi(cfg) {
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } });
  const fail = (error) => { if (error) { const e = new Error(error.message || error.error_description || 'error'); e.code_text = error.code === '23503' ? '23503' : error.message; e.code = error.code || ''; e.details = error.details; throw e; } };
  const applyQ = (q, o = {}) => {
    Object.entries(o.eq || {}).forEach(([k, v]) => { q = q.eq(k, v); });
    Object.entries(o.neq || {}).forEach(([k, v]) => { q = q.neq(k, v); });
    Object.entries(o.in || {}).forEach(([k, v]) => { q = q.in(k, v); });
    Object.entries(o.ilike || {}).forEach(([k, v]) => { q = q.ilike(k, v); });
    Object.entries(o.gte || {}).forEach(([k, v]) => { q = q.gte(k, v); });
    Object.entries(o.lte || {}).forEach(([k, v]) => { q = q.lte(k, v); });
    Object.entries(o.is || {}).forEach(([k, v]) => { q = q.is(k, v); });
    if (o.search) { const s = o.search.text.replace(/[%,()*]/g, ' ').trim(); if (s) q = q.or(o.search.cols.map((c) => `${c}.ilike.%${s}%`).join(',')); }
    if (o.order) q = q.order(o.order.col, { ascending: !!o.order.asc, nullsFirst: false });
    if (o.limit) q = o.offset ? q.range(o.offset, o.offset + o.limit - 1) : q.limit(o.limit);
    return q;
  };
  const api = {
    mode: 'live', client: sb,
    async select(table, o = {}) {
      // speed: identical public reads made at the same moment (or within 20 s) share one network request
      if (!o.single && !o.count && !o.noCache && ['categories', 'products', 'site_settings', 'brands', 'ads', 'apps', 'videos'].includes(table) && !location.pathname.includes('/admin/')) {
        const k = table + JSON.stringify(o); window.__szQ = window.__szQ || {}; const hit = window.__szQ[k];
        if (hit && Date.now() - hit.t < 20000) return hit.p.then((r) => r.slice ? r.slice() : r);
        const p = api._select(table, o); window.__szQ[k] = { t: Date.now(), p }; p.catch(() => { delete window.__szQ[k]; }); return p.then((r) => r.slice ? r.slice() : r);
      }
      return api._select(table, o); },
    async _select(table, o = {}) { let q = sb.from(table).select(o.select || '*', o.count ? { count: 'exact' } : undefined); q = applyQ(q, o);
      if (o.single) { const { data, error } = await q.maybeSingle(); fail(error); return data; }
      const { data, error, count } = await q; fail(error); if (o.count) data.total = count; return data; },
    async insert(table, row) { const { data, error } = await sb.from(table).insert(row).select().single(); fail(error); return data; },
    async update(table, id, patch, key = 'id') { const { data, error } = await sb.from(table).update(patch).eq(key, id).select().single(); fail(error); return data; },
    async remove(table, id, key = 'id') { const { error } = await sb.from(table).delete().eq(key, id); fail(error); return true; },
    async removeWhere(table, match) { let q = sb.from(table).delete(); Object.entries(match).forEach(([k, v]) => { q = q.eq(k, v); }); const { error } = await q; fail(error); return true; },
    async rpc(name, args = {}) { const { data, error } = await sb.rpc(name, args); fail(error);
      // some RPCs (submit_payment duplicate UTR) answer {error:'code'} instead of raising, so the attempt log is kept
      if (data && typeof data === 'object' && !Array.isArray(data) && typeof data.error === 'string' && data.error) { const e = new Error(data.error); e.code_text = data.error; throw e; }
      return data; },
    async upload(bucket, file, folder = '') { const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
      const path = `${folder ? folder.replace(/\/+$/, '') + '/' : ''}${Date.now()}-${uuid()}.${ext}`;
      const { error } = await sb.storage.from(bucket).upload(path, file, { contentType: file.type || (ext === 'apk' ? 'application/vnd.android.package-archive' : 'application/octet-stream'), upsert: false, cacheControl: '3600' }); fail(error);
      const url = bucket === 'public-media' ? sb.storage.from(bucket).getPublicUrl(path).data.publicUrl : null; return { path, url }; },
    async signedUrl(bucket, path, secs = 300) { const { data, error } = await sb.storage.from(bucket).createSignedUrl(path, secs); fail(error); return data.signedUrl; },
    async removeFile(bucket, path) { const { error } = await sb.storage.from(bucket).remove([path]); fail(error); return true; },
    async fn(name, body) { const { data, error } = await sb.functions.invoke(name, { body }); if (error) { let payload = null; try { payload = await error.context?.json(); } catch {} const e = new Error(payload?.error || error.message); e.status = error.context?.status; e.payload = payload; throw e; } return data; },
    auth: {
      async session() { const { data } = await sb.auth.getSession(); return data.session; },
      async userId() { const s = await api.auth.session(); return s?.user?.id || null; },
      async profile() { const s = await api.auth.session(); if (!s) return null; try { return await api.rpc('my_profile'); } catch { return null; } },
      async signUp({ full_name, email, mobile, password }) { const redirect = (cfg.SITE_URL || location.origin + location.pathname.replace(/[^/]*$/, '')) .replace(/\/?$/, '/') + 'login.html?confirmed=1';
        const { data, error } = await sb.auth.signUp({ email, password, options: { data: { full_name, mobile }, emailRedirectTo: redirect } });
        if (error && /disposable|temporary/i.test(error.message || '')) throw new Error('disposable_email');
        if (error && /rate|too many|security purposes/i.test(error.message || '')) throw new Error('rate_limited');
        if (error && /sending|smtp/i.test(error.message || '')) throw new Error('email_send_failed');
        fail(error); return { needsConfirm: !data.session }; },
      async resendConfirm(email) { const redirect = (cfg.SITE_URL || location.origin + location.pathname.replace(/[^/]*$/, '')).replace(/\/?$/, '/') + 'login.html?confirmed=1';
        const { error } = await sb.auth.resend({ type: 'signup', email, options: { emailRedirectTo: redirect } });
        if (error && /rate|too many|security purposes|seconds/i.test(error.message || '')) throw new Error('resend_wait');
        if (error && /sending|smtp|mail/i.test(error.message || '')) throw new Error('email_send_failed');
        fail(error); return true; },
      async signIn(email, password, captchaToken) {
        if (cfg.USE_LOGIN_GUARD) {
          let res = null, guardMissing = false;
          try { res = await api.fn('login-guard', { email, password, captcha_token: captchaToken || null }); }
          catch (e) { if (e.status === 404 || /Failed to send|FunctionsFetchError|not found/i.test(e.message)) guardMissing = true; else { const er = new Error(e.payload?.error || e.message); er.retry_after = e.payload?.retry_after; throw er; } }
          if (!guardMissing) { const { error } = await sb.auth.setSession({ access_token: res.access_token, refresh_token: res.refresh_token }); fail(error); return api.auth.mfaState(); }
        }
        const { error } = await sb.auth.signInWithPassword({ email, password, options: captchaToken ? { captchaToken } : undefined });
        if (error) { throw new Error(/confirm/i.test(error.message) ? 'email_not_confirmed' : /banned/i.test(error.message) ? 'account_blocked' : /rate/i.test(error.message) ? 'rate_limited' : 'invalid_credentials'); }
        return api.auth.mfaState();
      },
      async mfaState() { const { data } = await sb.auth.mfa.getAuthenticatorAssuranceLevel(); return { current: data?.currentLevel, next: data?.nextLevel, mfaRequired: data?.nextLevel === 'aal2' && data?.currentLevel !== 'aal2' }; },
      async signOut(all = false) { await sb.auth.signOut({ scope: all ? 'global' : 'local' }); },
      async sendReset(email) { const redirect = (cfg.SITE_URL || location.origin + location.pathname.replace(/[^/]*$/, '')).replace(/\/?$/, '/') + 'reset-password.html';
        await sb.auth.resetPasswordForEmail(email, { redirectTo: redirect }); return true; /* always generic: no account enumeration */ },
      async updatePassword(password) { const { error } = await sb.auth.updateUser({ password }); fail(error); try { await api.rpc('log_auth_event', { p_action: 'password_changed', p_details: {} }); } catch {} return true; },
      async factors() { const { data, error } = await sb.auth.mfa.listFactors(); fail(error); return (data?.totp || []).map((f) => ({ id: f.id, status: f.status, name: f.friendly_name, created_at: f.created_at })); },
      async enroll() { const { data: d0 } = await sb.auth.mfa.listFactors(); for (const f of (d0?.all || []).filter((x) => x.status === 'unverified')) await sb.auth.mfa.unenroll({ factorId: f.id });
        const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'SHOPZENT ' + new Date().toISOString().slice(0, 10) }); fail(error);
        return { id: data.id, qr: data.totp.qr_code, secret: data.totp.secret, uri: data.totp.uri }; },
      async verify(factorId, code) { const { data: ch, error: e1 } = await sb.auth.mfa.challenge({ factorId }); fail(e1);
        const { error } = await sb.auth.mfa.verify({ factorId, challengeId: ch.id, code }); if (error) { try { await api.rpc('log_auth_event', { p_action: 'mfa_failure', p_details: {} }); } catch {} throw new Error('Wrong or expired code. Please try the latest 6-digit code from your authenticator app.'); } return true; },
      async unenroll(factorId) { const { error } = await sb.auth.mfa.unenroll({ factorId }); fail(error); try { await api.rpc('log_auth_event', { p_action: 'mfa_removed', p_details: {} }); } catch {} return true; },
      async signInWithGoogle(returnPath = 'admin/index.html') { // Supabase Auth → Google provider; comes back to returnPath, then 2FA as usual
        const base = cfg.SITE_URL ? cfg.SITE_URL.replace(/\/?$/, '/') : location.href.replace(/[?#].*$/, '').replace(/[^/]*$/, '').replace(/admin\/$/, '');
        const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: base + returnPath, queryParams: { prompt: 'select_account' } } }); fail(error); return true; },
      async refresh() { await sb.auth.refreshSession(); },
      onChange(cb) { sb.auth.onAuthStateChange((ev, s) => cb(ev, s)); },
    },
  };
  return api;
}
