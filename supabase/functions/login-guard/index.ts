// SHOPZENT login-guard: server-side brute-force protection in front of Supabase Auth password login.
//
// POST { email, password, captcha_token? }
//  200 { access_token, refresh_token, expires_in, expires_at, token_type, user:{id,email}, mfa_required }
//  401 { error: "invalid_credentials" }            (generic, same for unknown email and wrong password)
//  403 { error: "captcha_required" }               (after 3 failures in 15 min, only when CAPTCHA_SECRET is set)
//  403 { error: "email_not_confirmed" }            (only reachable with the correct password)
//  403 { error: "account_blocked" }                (admin blocked this account; GoTrue reports the ban)
//  403 { error: "ip_blocked" }                   (the admin blocked this IP in Hacker alerts)
//  429 { error: "rate_limited", retry_after }      (10 failures / 60 s per email+IP -> cooldown 60 s, 2 min, 5 min, 15 min)
//
// Env (Supabase sets the first three automatically):
//  SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY
//  ALLOWED_ORIGINS (required for browsers), CAPTCHA_PROVIDER ("turnstile" | "hcaptcha"), CAPTCHA_SECRET (optional), HASH_PEPPER (optional)
// The password is never logged or stored. Only sha256 hashes of email and IP are stored.

import { handlePreflight, json, originRefused, sha256Hex } from "../_shared/cors.ts";

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
// New API keys (publishable/secret) first; the legacy JWT keys are disabled.
const ANON_KEY = Deno.env.get("SZ_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";
const SERVICE_KEY = Deno.env.get("SZ_SECRET_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CAPTCHA_PROVIDER = (Deno.env.get("CAPTCHA_PROVIDER") ?? "turnstile").toLowerCase();
const CAPTCHA_SECRET = Deno.env.get("CAPTCHA_SECRET") ?? "";
const PEPPER = Deno.env.get("HASH_PEPPER") ?? "";

const MAX_FAILURES_PER_MINUTE = 10;
const CAPTCHA_AFTER_FAILURES = 3;
const COOLDOWNS_SECONDS = [60, 120, 300, 900];

type Attempt = { success: boolean; reason: string | null; created_at: string };

function serviceHeaders(extra: Record<string, string> = {}): Record<string, string> {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...extra };
}

function clientIp(req: Request): string {
  const cf = req.headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

async function recentAttempts(emailHash: string, ipHash: string): Promise<Attempt[]> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const url = `${SUPABASE_URL}/rest/v1/login_attempts?select=success,reason,created_at` +
    `&email_hash=eq.${emailHash}&ip_hash=eq.${ipHash}&created_at=gte.${encodeURIComponent(since)}&order=created_at.desc&limit=500`;
  const res = await fetch(url, { headers: serviceHeaders() });
  if (!res.ok) throw new Error(`login_attempts read failed: ${res.status}`);
  return await res.json() as Attempt[];
}

async function recordAttempt(emailHash: string, ipHash: string, success: boolean, reason: string): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/login_attempts`, {
    method: "POST",
    headers: serviceHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify({ email_hash: emailHash, ip_hash: ipHash, success, reason }),
  });
  if (!res.ok) console.error("login-guard: could not record attempt", res.status);
}

async function audit(action: string, actorId: string | null, details: Record<string, unknown>, req: Request): Promise<void> {
  const ip = clientIp(req);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/audit_log`, {
    method: "POST",
    headers: serviceHeaders({ Prefer: "return=minimal" }),
    body: JSON.stringify({
      actor_id: actorId,
      actor_role: "login-guard",
      action,
      entity: "auth",
      entity_id: actorId,
      details,
      ip: /^[0-9a-fA-F:.]+$/.test(ip) ? ip : null,
      user_agent: (req.headers.get("user-agent") ?? "").slice(0, 300),
    }),
  });
  if (!res.ok) console.error("login-guard: could not write audit row", res.status);
}

async function verifyCaptcha(token: string, ip: string): Promise<boolean> {
  const endpoint = CAPTCHA_PROVIDER === "hcaptcha"
    ? "https://api.hcaptcha.com/siteverify"
    : "https://challenges.cloudflare.com/turnstile/v0/siteverify";
  const form = new URLSearchParams({ secret: CAPTCHA_SECRET, response: token });
  if (ip !== "unknown") form.set("remoteip", ip);
  try {
    const res = await fetch(endpoint, { method: "POST", body: form });
    const out = await res.json() as { success?: boolean };
    return out.success === true;
  } catch {
    return false;
  }
}

// Security alerts for the admin's "Hacker alerts" page. Never throws and never delays a login by more than 2 s.
async function rpc(name: string, args: Record<string, unknown>): Promise<unknown> {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, { method: "POST", headers: serviceHeaders(), body: JSON.stringify(args), signal: AbortSignal.timeout(2000) });
    return res.ok ? await res.json() : null;
  } catch { return null; }
}
async function alertSec(req: Request, kind: string, severity: string, summary: string, details: Record<string, unknown>, ip: string, dedupe?: string): Promise<void> {
  await rpc("service_log_security_alert", { p_kind: kind, p_severity: severity, p_target: "login", p_summary: summary, p_details: details, p_ip: ip, p_user_agent: (req.headers.get("user-agent") ?? "").slice(0, 300), p_dedupe: dedupe ?? null });
}

function lockState(attempts: Attempt[]): { lockedFor: number; lockoutsLastHour: number } {
  const now = Date.now();
  const lockouts = attempts.filter((a) => a.reason?.startsWith("lockout_"));
  for (const l of lockouts) {
    const seconds = Number(l.reason!.slice("lockout_".length)) || 60;
    const until = Date.parse(l.created_at) + seconds * 1000;
    if (until > now) return { lockedFor: Math.ceil((until - now) / 1000), lockoutsLastHour: lockouts.length };
  }
  return { lockedFor: 0, lockoutsLastHour: lockouts.length };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (originRefused(req)) return json(req, 403, { error: "origin_not_allowed" });
  if (req.method !== "POST") return json(req, 405, { error: "method_not_allowed" });
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) return json(req, 500, { error: "server_not_configured" });

  let email = "", password = "", captchaToken = "";
  try {
    const raw = await req.text();
    if (raw.length > 4096) return json(req, 413, { error: "invalid_input" });
    const body = JSON.parse(raw);
    email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
    password = typeof body.password === "string" ? body.password : "";
    captchaToken = typeof body.captcha_token === "string" ? body.captcha_token : "";
  } catch {
    return json(req, 400, { error: "invalid_input" });
  }
  if (!email || email.length > 254 || !email.includes("@") || !password || password.length > 200) {
    return json(req, 401, { error: "invalid_credentials" });
  }

  const ip = clientIp(req);
  const emailHash = await sha256Hex(PEPPER + email);
  const ipHash = await sha256Hex(PEPPER + ip);

  let attempts: Attempt[];
  let isAdminAccount = false;
  try {
    const [att, info] = await Promise.all([recentAttempts(emailHash, ipHash), rpc("service_login_info", { p_email: email, p_ip: ip })]);
    attempts = att;
    const i = (info ?? {}) as { blocked?: boolean; is_admin?: boolean };
    isAdminAccount = i.is_admin === true;
    if (i.blocked === true) return json(req, 403, { error: "ip_blocked" });
  } catch (e) {
    console.error("login-guard:", (e as Error).message);
    return json(req, 503, { error: "temporarily_unavailable" });
  }

  const { lockedFor, lockoutsLastHour } = lockState(attempts);
  if (lockedFor > 0) {
    await alertSec(req, "login_locked_retry", isAdminAccount ? "medium" : "low", "Keeps trying to log in while locked out", { account: isAdminAccount ? "admin" : "customer", email_hash: emailHash.slice(0, 12) }, ip);
    return json(req, 429, { error: "rate_limited", retry_after: lockedFor }, { "Retry-After": String(lockedFor) });
  }

  const now = Date.now();
  const failures = attempts.filter((a) => !a.success && a.reason === "invalid_credentials");
  const failures15m = failures.filter((a) => Date.parse(a.created_at) > now - 15 * 60 * 1000).length;

  if (CAPTCHA_SECRET && failures15m >= CAPTCHA_AFTER_FAILURES) {
    if (!captchaToken || !(await verifyCaptcha(captchaToken, ip))) {
      return json(req, 403, { error: "captcha_required" });
    }
  }

  // progressive delay: 250 ms per recent failure, max 3 s
  if (failures15m > 0) await sleep(Math.min(250 * failures15m, 3000));

  const gotrue = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  password = ""; // drop the reference as early as possible

  if (gotrue.ok) {
    const session = await gotrue.json() as {
      access_token: string; refresh_token: string; expires_in: number; expires_at?: number; token_type: string;
      user?: { id: string; email?: string; factors?: { status: string; factor_type: string }[] };
    };
    await recordAttempt(emailHash, ipHash, true, "ok");
    const userId = session.user?.id ?? null;
    const mfaRequired = (session.user?.factors ?? []).some((f) => f.status === "verified");
    if (userId) {
      const prof = await fetch(`${SUPABASE_URL}/rest/v1/profiles?select=role&id=eq.${userId}`, { headers: serviceHeaders() });
      const rows = prof.ok ? await prof.json() as { role: string }[] : [];
      if (rows[0] && (rows[0].role === "admin" || rows[0].role === "super_admin")) {
        await audit("admin_login_success", userId, { stage: "password", mfa_enrolled: mfaRequired }, req);
      }
    }
    return json(req, 200, {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      expires_at: session.expires_at,
      token_type: session.token_type,
      user: { id: userId, email: session.user?.email },
      mfa_required: mfaRequired,
    });
  }

  let errText = "";
  try {
    const e = await gotrue.json() as { error_code?: string; msg?: string; error_description?: string; error?: string };
    errText = `${e.error_code ?? ""} ${e.msg ?? ""} ${e.error_description ?? ""} ${e.error ?? ""}`.toLowerCase();
  } catch { /* ignore */ }

  if (gotrue.status === 429) {
    return json(req, 429, { error: "rate_limited", retry_after: 60 }, { "Retry-After": "60" });
  }
  if (errText.includes("email_not_confirmed") || errText.includes("email not confirmed")) {
    await recordAttempt(emailHash, ipHash, false, "email_not_confirmed");
    return json(req, 403, { error: "email_not_confirmed" });
  }
  if (errText.includes("user_banned") || errText.includes("banned")) {
    await recordAttempt(emailHash, ipHash, false, "account_blocked");
    return json(req, 403, { error: "account_blocked" });
  }
  if (gotrue.status >= 500) {
    return json(req, 503, { error: "temporarily_unavailable" });
  }

  await recordAttempt(emailHash, ipHash, false, "invalid_credentials");
  const failuresLastMinute = failures.filter((a) => Date.parse(a.created_at) > now - 60 * 1000).length + 1;
  if (isAdminAccount) {
    await alertSec(req, "admin_login_failed", failures15m + 1 >= 3 ? "high" : "low", "Wrong password on an ADMIN account", { account: "admin", failures_15m: failures15m + 1, email_hash: emailHash.slice(0, 12) }, ip);
  } else if (failuresLastMinute >= 5 && failuresLastMinute < MAX_FAILURES_PER_MINUTE) {
    await alertSec(req, "wrong_password_burst", "medium", "Many wrong passwords in one minute", { failures_last_minute: failuresLastMinute, email_hash: emailHash.slice(0, 12) }, ip);
  }
  if (failuresLastMinute >= MAX_FAILURES_PER_MINUTE) {
    const cooldown = COOLDOWNS_SECONDS[Math.min(lockoutsLastHour, COOLDOWNS_SECONDS.length - 1)];
    await recordAttempt(emailHash, ipHash, false, `lockout_${cooldown}`);
    await alertSec(req, "login_locked", isAdminAccount ? "high" : "medium", isAdminAccount ? "ADMIN login locked after too many wrong passwords" : "Login locked after too many wrong passwords", { account: isAdminAccount ? "admin" : "customer", cooldown_seconds: cooldown, email_hash: emailHash.slice(0, 12) }, ip);
    await audit("login_locked", null, { email_hash: emailHash.slice(0, 12), ip_hash: ipHash.slice(0, 12), cooldown_seconds: cooldown }, req);
    return json(req, 429, { error: "rate_limited", retry_after: cooldown }, { "Retry-After": String(cooldown) });
  }
  return json(req, 401, { error: "invalid_credentials" });
});
