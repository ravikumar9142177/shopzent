/* SHOPZENT configuration — the ONLY file you edit to connect your backend.
   Put your Supabase Project URL and the PUBLIC "anon" key here (Supabase → Project Settings → API).
   NEVER put the service_role key here. Leaving both empty runs the site in PREVIEW (demo) mode,
   where all data lives only in this browser and nothing is real. */
window.SHOPZENT_CONFIG = {
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
  SITE_URL: "",              // e.g. "https://www.yourdomain.in" (used for canonical links & auth redirects). Empty = current origin.
  USE_LOGIN_GUARD: true,
  GOOGLE_LOGIN: true,        // show "Continue with Google" on the admin login (enable the Google provider in Supabase first — SETUP.md)     // use the login-guard Edge Function (rate limit + captcha) when it is deployed
  CAPTCHA_SITE_KEY: "",      // optional Cloudflare Turnstile site key (public)
  ADMIN_EMAIL: "ravitechsolution.shop@gmail.com", // the customer login page sends this email to the admin login
  WHATSAPP_FALLBACK: "9942598154",
  EMAIL_FALLBACK: "ravitechsolution.shop@gmail.com",
  // PREVIEW-MODE admin login only (ignored once Supabase is connected — then the admin signs up with this
  // email in Supabase Auth and 2FA is mandatory). Only a PBKDF2-SHA256 hash is stored here, never the password.
  // To change the preview password, generate a new hash (SETUP.md → "Change the preview admin password").
  DEMO_ADMIN: {
    email: "ravitechsolution.shop@gmail.com",
    alg: "PBKDF2-SHA256",
    iterations: 600000,
    salt_b64: "57APt3blaqEAw7TSip1p1w==",
    hash_b64: "HkRjdJ10C2eGzYpTyltetkx45eI+xUhXquc9UduSzIk="
  }
};
