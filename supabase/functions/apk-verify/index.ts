// SHOPZENT apk-verify: hash an uploaded APK and (optionally) look it up on VirusTotal.
//
// POST { app_id }  with the admin's own session JWT in Authorization (admin + aal2 required, checked by public.is_admin()).
// - downloads apps.storage_path from the private bucket apk-files (service role, server side only)
// - computes sha256, checks it is a ZIP/APK container, stores sha256 + file_size_bytes
// - with VT_API_KEY: looks the hash up; clean verdict -> 'scanned_clean', any malicious/suspicious -> 'quarantined'
// - without a real scan the status stays 'unverified' (never marked safe without a scan); 'verified' is only set by a human admin
// - optional VT_UPLOAD=true submits unknown files (<= 32 MB) to VirusTotal; run again later to read the verdict
// Env: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY (automatic), ALLOWED_ORIGINS, VT_API_KEY (optional), VT_UPLOAD (optional)

import { handlePreflight, json, originRefused, sha256Hex } from "../_shared/cors.ts";

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const VT_API_KEY = Deno.env.get("VT_API_KEY") ?? "";
const VT_UPLOAD = (Deno.env.get("VT_UPLOAD") ?? "").toLowerCase() === "true";
const MAX_BYTES = 100 * 1024 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function service(extra: Record<string, string> = {}): Record<string, string> {
  return { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, ...extra };
}

type VtResult = { checked: boolean; status?: string; malicious?: number; suspicious?: number; harmless?: number; undetected?: number; note?: string };

async function virusTotal(sha256: string, bytes: Uint8Array, fileName: string): Promise<VtResult> {
  if (!VT_API_KEY) return { checked: false, note: "VT_API_KEY not set; file hashed only" };
  const res = await fetch(`https://www.virustotal.com/api/v3/files/${sha256}`, { headers: { "x-apikey": VT_API_KEY } });
  if (res.status === 404) {
    if (VT_UPLOAD && bytes.byteLength <= 32 * 1024 * 1024) {
      const form = new FormData();
      form.append("file", new Blob([bytes as BlobPart]), fileName);
      const up = await fetch("https://www.virustotal.com/api/v3/files", { method: "POST", headers: { "x-apikey": VT_API_KEY }, body: form });
      return { checked: false, status: up.ok ? "submitted" : "submit_failed", note: up.ok ? "Submitted to VirusTotal; run verify again in a few minutes" : `upload failed (${up.status})` };
    }
    return { checked: false, status: "unknown_to_virustotal", note: "File not known to VirusTotal" };
  }
  if (!res.ok) return { checked: false, status: "lookup_failed", note: `VirusTotal answered ${res.status}` };
  const body = await res.json() as { data?: { attributes?: { last_analysis_stats?: Record<string, number> } } };
  const s = body.data?.attributes?.last_analysis_stats ?? {};
  return {
    checked: true,
    malicious: s.malicious ?? 0,
    suspicious: s.suspicious ?? 0,
    harmless: s.harmless ?? 0,
    undetected: s.undetected ?? 0,
  };
}

Deno.serve(async (req: Request): Promise<Response> => {
  const pre = handlePreflight(req);
  if (pre) return pre;
  if (originRefused(req)) return json(req, 403, { error: "origin_not_allowed" });
  if (req.method !== "POST") return json(req, 405, { error: "method_not_allowed" });
  if (!SUPABASE_URL || !ANON_KEY || !SERVICE_KEY) return json(req, 500, { error: "server_not_configured" });

  const auth = req.headers.get("authorization") ?? "";
  if (!/^Bearer\s+\S+$/i.test(auth)) return json(req, 401, { error: "not_authorized" });

  // 1) caller must be an admin with MFA (aal2): ask the database with the caller's own JWT
  const adminCheck = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_admin`, {
    method: "POST",
    headers: { apikey: ANON_KEY, Authorization: auth, "Content-Type": "application/json" },
    body: "{}",
  });
  if (!adminCheck.ok || (await adminCheck.json()) !== true) return json(req, 403, { error: "not_authorized" });
  const who = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON_KEY, Authorization: auth } });
  const actorId = who.ok ? ((await who.json()) as { id?: string }).id ?? null : null;

  let appId = "";
  try {
    const body = await req.json();
    appId = typeof body.app_id === "string" ? body.app_id : "";
  } catch {
    return json(req, 400, { error: "invalid_input" });
  }
  if (!UUID_RE.test(appId)) return json(req, 400, { error: "invalid_input" });

  // 2) load the app row (service role)
  const appRes = await fetch(`${SUPABASE_URL}/rest/v1/apps?id=eq.${appId}&select=id,name,storage_path,verification_status`, { headers: service() });
  const apps = appRes.ok ? await appRes.json() as { id: string; name: string; storage_path: string | null }[] : [];
  if (!apps[0]) return json(req, 404, { error: "not_found" });
  const path = apps[0].storage_path;
  if (!path || path.includes("..") || path.startsWith("/")) return json(req, 400, { error: "no_storage_object" });

  // 3) download from the private bucket
  const objectUrl = `${SUPABASE_URL}/storage/v1/object/apk-files/${path.split("/").map(encodeURIComponent).join("/")}`;
  const file = await fetch(objectUrl, { headers: service() });
  if (!file.ok) return json(req, 404, { error: "object_not_found" });
  const declared = Number(file.headers.get("content-length") ?? "0");
  if (declared > MAX_BYTES) return json(req, 413, { error: "file_too_large_to_scan" });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) return json(req, 413, { error: "file_too_large_to_scan" });

  const sha256 = await sha256Hex(bytes);
  const isZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;

  // 4) verdict
  let status = "unverified";
  let vt: VtResult = { checked: false };
  if (!isZip) {
    status = "quarantined";
    vt = { checked: false, note: "Not a ZIP/APK container" };
  } else {
    vt = await virusTotal(sha256, bytes, path.split("/").pop() ?? "app.apk");
    if (vt.checked) {
      if ((vt.malicious ?? 0) > 0 || (vt.suspicious ?? 0) > 0) status = "quarantined";
      else if ((vt.harmless ?? 0) + (vt.undetected ?? 0) > 0) status = "scanned_clean";
    }
  }

  // 5) store result (never downgrade a human 'verified' unless the scan found something)
  const current = (apps[0] as { verification_status?: string }).verification_status;
  const finalStatus = current === "verified" && status !== "quarantined" ? "verified" : status;
  const upd = await fetch(`${SUPABASE_URL}/rest/v1/apps?id=eq.${appId}`, {
    method: "PATCH",
    headers: service({ "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify({ sha256, verification_status: finalStatus, file_size_bytes: bytes.byteLength }),
  });
  if (!upd.ok) return json(req, 500, { error: "update_failed" });

  await fetch(`${SUPABASE_URL}/rest/v1/audit_log`, {
    method: "POST",
    headers: service({ "Content-Type": "application/json", Prefer: "return=minimal" }),
    body: JSON.stringify({
      actor_id: actorId,
      actor_role: "apk-verify",
      action: "apk_verified",
      entity: "apps",
      entity_id: appId,
      details: { sha256, status: finalStatus, vt_checked: vt.checked, malicious: vt.malicious ?? null, suspicious: vt.suspicious ?? null },
    }),
  });

  return json(req, 200, { app_id: appId, sha256, size_bytes: bytes.byteLength, verification_status: finalStatus, scan: vt });
});
