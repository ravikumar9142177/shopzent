// Strict CORS for SHOPZENT Edge Functions.
// ALLOWED_ORIGINS = comma-separated exact origins, e.g. "https://shopzent.in,https://www.shopzent.in,https://username.github.io"
// Requests from any other browser origin get no CORS headers (the browser blocks them) and preflights get 403.

const allowedOrigins: string[] = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((o) => o.trim().replace(/\/+$/, ""))
  .filter((o) => o.length > 0);

export function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;
  return allowedOrigins.includes(origin.replace(/\/+$/, ""));
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin");
  const base: Record<string, string> = {
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": "no-store",
  };
  if (origin && isOriginAllowed(origin)) {
    base["Access-Control-Allow-Origin"] = origin;
    base["Access-Control-Allow-Methods"] = "POST, OPTIONS";
    base["Access-Control-Allow-Headers"] = "authorization, x-client-info, apikey, content-type";
    base["Access-Control-Max-Age"] = "600";
  }
  return base;
}

/** Answers OPTIONS preflights. Returns null for every other method. */
export function handlePreflight(req: Request): Response | null {
  if (req.method !== "OPTIONS") return null;
  const origin = req.headers.get("origin");
  if (!isOriginAllowed(origin)) {
    return new Response(null, { status: 403, headers: { "Vary": "Origin" } });
  }
  return new Response(null, { status: 204, headers: corsHeaders(req) });
}

/** A browser request from a non-allowed origin is refused outright. Requests with no Origin (curl, server) pass. */
export function originRefused(req: Request): boolean {
  const origin = req.headers.get("origin");
  return origin !== null && !isOriginAllowed(origin);
}

export function json(req: Request, status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json; charset=utf-8", ...extra },
  });
}

export async function sha256Hex(input: string | Uint8Array | ArrayBuffer): Promise<string> {
  const data = typeof input === "string" ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest("SHA-256", data as BufferSource);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
