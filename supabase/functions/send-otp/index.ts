// SHOPZENT send-otp: sends a 6-digit OTP to the logged-in customer's profile phone (+91).
// DISABLED until an SMS provider is configured: set SMS_PROVIDER (msg91 | twilio | 2factor) and SMS_API_KEY as function secrets,
// then implement sendSms() for that provider. Until then it answers 503 {error:"otp_disabled"} and sends nothing.
// Security: OTP stored only as sha256(pepper|phone|code); 5-minute expiry; max 5 verify attempts; rate limit 3 sends / 10 min per phone
// and 10 sends / hour per IP. Never logs the code or the phone.
import { handlePreflight, json, originRefused, sha256Hex } from "../_shared/cors.ts";

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
const ANON_KEY = Deno.env.get("SZ_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";
const SERVICE_KEY = Deno.env.get("SZ_SECRET_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const PROVIDER = (Deno.env.get("SMS_PROVIDER") ?? "").toLowerCase();
const SMS_KEY = Deno.env.get("SMS_API_KEY") ?? "";
const PEPPER = Deno.env.get("HASH_PEPPER") ?? "";
const svc = (extra: Record<string, string> = {}) => ({ apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json", ...extra });

async function sendSms(_phone10: string, _code: string): Promise<boolean> {
  // Plug the provider here (e.g. MSG91 OTP API / Twilio Verify / 2Factor). Return true when the provider accepted it.
  return false;
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req); if (pre) return pre;
  if (originRefused(req)) return json(req, 403, { error: "origin_not_allowed" });
  if (req.method !== "POST") return json(req, 405, { error: "method_not_allowed" });
  if (!PROVIDER || !SMS_KEY) return json(req, 503, { error: "otp_disabled" });
  const auth = req.headers.get("authorization") ?? "";
  const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY, Authorization: auth } });
  if (!who.ok) return json(req, 401, { error: "login_required" });
  const user = await who.json();
  const prof = await (await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=phone`, { headers: svc() })).json();
  const phone = prof?.[0]?.phone; if (!phone) return json(req, 400, { error: "phone_required" });
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const ipHash = await sha256Hex(PEPPER + "|ip|" + ip);
  const since10 = new Date(Date.now() - 10 * 60_000).toISOString(), since60 = new Date(Date.now() - 60 * 60_000).toISOString();
  const cnt = async (q: string) => Number((await fetch(`${SUPABASE_URL}/rest/v1/phone_otps?select=id&${q}`, { headers: svc({ Prefer: "count=exact", Range: "0-0" }) })).headers.get("content-range")?.split("/")[1] ?? "0");
  if (await cnt(`phone=eq.${phone}&created_at=gte.${since10}`) >= 3 || await cnt(`ip_hash=eq.${ipHash}&created_at=gte.${since60}`) >= 10) return json(req, 429, { error: "rate_limited", retry_after: 600 });
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, "0");
  const ins = await fetch(`${SUPABASE_URL}/rest/v1/phone_otps`, { method: "POST", headers: svc(), body: JSON.stringify({ user_id: user.id, phone, code_hash: await sha256Hex(`${PEPPER}|${phone}|${code}`), expires_at: new Date(Date.now() + 5 * 60_000).toISOString(), ip_hash: ipHash }) });
  if (!ins.ok) return json(req, 500, { error: "server_error" });
  if (!(await sendSms(phone, code))) return json(req, 502, { error: "sms_failed" });
  return json(req, 200, { sent: true, expires_in: 300 });
});
