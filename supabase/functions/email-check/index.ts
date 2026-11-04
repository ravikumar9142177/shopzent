// SHOPZENT email-check: MX lookup for the admin "Email check" (and "Check all signups").
//
// POST { domains: string[] }  (max 20 domains) with the ADMIN'S OWN session JWT in Authorization.
// Only an admin with a 2FA-verified session (public.is_admin(), checked by the database) gets an answer; anyone else gets 403.
// For each domain it asks a public DNS-over-HTTPS resolver (Cloudflare, then Google as a fallback) for MX records:
//   mx = "has_mx"          domain has at least one mail server (MX record)
//   mx = "no_mx"           domain resolves but publishes no mail server, or does not exist (NXDOMAIN)
//   mx = "could_not_check" both resolvers failed or timed out: we do NOT guess
// Env: SUPABASE_URL, SUPABASE_ANON_KEY (automatic), ALLOWED_ORIGINS.

import { handlePreflight, json, originRefused } from "../_shared/cors.ts";

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
const ANON_KEY = Deno.env.get("SZ_PUBLISHABLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";
const DOMAIN_RE = /^(?=.{1,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/;

type Mx = { domain: string; mx: "has_mx" | "no_mx" | "could_not_check"; mx_hosts?: string[]; resolver?: string };

async function dohMx(base: string, name: string, label: string): Promise<Mx | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(`${base}?name=${encodeURIComponent(name)}&type=MX`, {
      headers: { accept: "application/dns-json" },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const body = await res.json();
    if (body.Status === 3) return { domain: name, mx: "no_mx", resolver: label };
    if (body.Status !== 0) return null;
    const hosts = (body.Answer ?? [])
      .filter((a: { type: number }) => a.type === 15)
      .map((a: { data: string }) => String(a.data).replace(/^\d+\s+/, "").replace(/\.$/, ""))
      .filter((h: string) => h.length > 0 && h !== ".");
    if (hosts.length === 0) return { domain: name, mx: "no_mx", resolver: label };
    return { domain: name, mx: "has_mx", mx_hosts: hosts.slice(0, 3), resolver: label };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function mxFor(domain: string): Promise<Mx> {
  const a = await dohMx("https://cloudflare-dns.com/dns-query", domain, "cloudflare");
  if (a) return a;
  const b = await dohMx("https://dns.google/resolve", domain, "google");
  if (b) return b;
  return { domain, mx: "could_not_check" };
}

async function isAdmin(userJwt: string): Promise<boolean> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_admin`, {
    method: "POST",
    headers: { apikey: ANON_KEY, Authorization: userJwt, "content-type": "application/json" },
    body: "{}",
  });
  if (!res.ok) return false;
  return (await res.json()) === true;
}

Deno.serve(async (req) => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (originRefused(req)) return json(req, 403, { error: "origin_not_allowed" });
  if (req.method !== "POST") return json(req, 405, { error: "method_not_allowed" });

  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ") || auth.length < 20) return json(req, 401, { error: "sign_in_required" });
  if (!(await isAdmin(auth))) return json(req, 403, { error: "not_authorized" });

  let body: { domains?: unknown };
  try {
    body = await req.json();
  } catch {
    return json(req, 400, { error: "invalid_json" });
  }
  const list = Array.isArray(body.domains) ? body.domains : [];
  const domains = [...new Set(list.map((d) => String(d ?? "").trim().toLowerCase()).filter((d) => DOMAIN_RE.test(d)))].slice(0, 20);
  const results = await Promise.all(domains.map(mxFor));
  return json(req, 200, { results, checked_at: new Date().toISOString() });
});
