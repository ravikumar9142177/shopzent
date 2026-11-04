// SHOPZENT verify-otp: checks the 6-digit code for the logged-in customer and sets profiles.phone_verified_at.
// DISABLED (503 otp_disabled) until SMS_PROVIDER and SMS_API_KEY are set. Max 5 attempts per code, 5-minute expiry, single use.
import { handlePreflight, json, originRefused, sha256Hex } from "../_shared/cors.ts";

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
const ANON_KEY = Deno.env.get("SZ_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";
const SERVICE_KEY = Deno.env.get("SZ_SECRET_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const PROVIDER = (Deno.env.get("SMS_PROVIDER") ?? "").toLowerCase();
const SMS_KEY = Deno.env.get("SMS_API_KEY") ?? "";
const PEPPER = Deno.env.get("HASH_PEPPER") ?? "";
const svc = (extra: Record<string, string> = {}) => ({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...extra });

Deno.serve(async (req) => {
  const pre = handlePreflight(req); if (pre) return pre;
  if (originRefused(req)) return json(req, 403, { error: "origin_not_allowed" });
  if (req.method !== "POST") return json(req, 405, { error: "method_not_allowed" });
  if (!PROVIDER || !SMS_KEY) return json(req, 503, { error: "otp_disabled" });
  const auth = req.headers.get("authorization") ?? "";
  const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY, Authorization: auth } });
  if (!who.ok) return json(req, 401, { error: "login_required" });
  const user = await who.json();
  let body: { code?: string } = {}; try { body = await req.json(); } catch { /* empty */ }
  const code = String(body.code ?? "").replace(/\D/g, ""); if (code.length !== 6) return json(req, 400, { error: "invalid_code" });
  const rows = await (await fetch(`${SUPABASE_URL}/rest/v1/phone_otps?user_id=eq.${user.id}&consumed_at=is.null&order=created_at.desc&limit=1&select=id,phone,code_hash,attempts,expires_at`, { headers: svc() })).json();
  const otp = rows?.[0];
  if (!otp || new Date(otp.expires_at).getTime() < Date.now()) return json(req, 400, { error: "otp_expired" });
  if (otp.attempts >= 5) return json(req, 429, { error: "too_many_attempts" });
  await fetch(`${SUPABASE_URL}/rest/v1/phone_otps?id=eq.${otp.id}`, { method: "PATCH", headers: svc(), body: JSON.stringify({ attempts: otp.attempts + 1 }) });
  if ((await sha256Hex(`${PEPPER}|${otp.phone}|${code}`)) !== otp.code_hash) return json(req, 400, { error: "wrong_code", attempts_left: Math.max(0, 4 - otp.attempts) });
  await fetch(`${SUPABASE_URL}/rest/v1/phone_otps?id=eq.${otp.id}`, { method: "PATCH", headers: svc(), body: JSON.stringify({ consumed_at: new Date().toISOString() }) });
  const up = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&phone=eq.${otp.phone}`, { method: "PATCH", headers: svc({ Prefer: "return=minimal" }), body: JSON.stringify({ phone_verified_at: new Date().toISOString() }) });
  if (!up.ok) return json(req, 500, { error: "server_error" });
  return json(req, 200, { verified: true });
});
