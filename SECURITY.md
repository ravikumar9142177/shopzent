# Security

## What protects the shop
* **Row Level Security on every table, deny by default.** Visitors read published content only; customers read only their own orders, wallet, coins, returns; admin rights need an MFA-verified (aal2) session — enforced inside the database, not just hidden in the UI. Tested: user B cannot read user A's order (IDOR), users cannot change their own role or order status.
* **Admin 2-step verification (TOTP) is compulsory.** Admins are forced to enrol an authenticator app; every admin action is refused with `mfa_required` otherwise. Money-type actions (verify/reject payment, refunds, wallet credit/debit, coin transfers, role changes, payment & security settings) also need a **fresh** authenticator code from the last 15 minutes. Recovery codes are stored only as hashes.
* **Server-side pricing.** Totals, product discounts, coupon rules (min order, max discount, per-user and total limits, product/category eligibility, expiry) and wallet use are computed in Postgres. The browser's numbers are ignored.
* **Payments:** one UTR can back only one order (unique index + logged duplicate attempts). Payments are verified by a human against bank/UPI records. Idempotency keys stop double-clicks from double-applying.
* **Ledgers are append-only** (wallet, coins, refunds, order events, audit log): UPDATE/DELETE are rejected by triggers. Refunds can never exceed the verified paid amount; coin transfers can never exceed the treasury (row locks).
* **Login protection** (`login-guard` function): 10 failures/minute per email+IP, growing cooldowns (1, 2, 5, 15 min), same generic error for every failure, optional Cloudflare Turnstile CAPTCHA, attempts stored as hashes.
* **Uploads:** type/size checked in the browser (including file "magic bytes") **and** by bucket rules on the server. Payment screenshots and return photos are private (owner + admin only, short signed links). APKs are private and downloadable only after a real scan marks them clean.
* **Browser hardening:** Content-Security-Policy meta tag on every page (`script-src 'self'`, no inline scripts, no `eval`), all user text HTML-escaped, admin-edited HTML sanitised, only `https://` links allowed for affiliate/ads/videos, `rel="noopener noreferrer sponsored"` on affiliate links, `noindex` on private pages.
* **Coupons are private:** visitors and customers cannot list coupons (the coupons table is admin-only; `public_coupons()` always returns nothing). A customer can only validate the one code they type, at checkout (`quote_cart` / `create_order`). Tested for anon and customers.
* **Admin login:** only the Super Admin made with `bootstrap_super_admin('ravitechsolution.shop@gmail.com')` gets admin rights (role stored in the database). Email+password or Google sign-in, then a mandatory authenticator code (aal2) — nothing in the admin panel works without it. The admin password is never stored in any file. Preview mode checks a PBKDF2-SHA256 hash (600,000 rounds); the live deploy removes it.
* **Secrets:** the website contains only the public anon key. The GitHub workflow refuses to deploy if a `service_role` key is put there by mistake. No passwords or keys are stored in this code.

## Limits of GitHub Pages (honest)
GitHub Pages cannot send custom HTTP headers. So: CSP is a `<meta>` tag (it cannot set `frame-ancestors`, so the site could be framed by another site — clickjacking protection is partial); no `X-Frame-Options`, `Permissions-Policy` or HSTS preload control (GitHub sends its own HSTS on github.io). For full headers put **Cloudflare** (free) in front of your domain and add a Transform Rule with:
```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self' https://*.supabase.co wss://*.supabase.co; frame-src https://www.youtube-nocookie.com https://player.vimeo.com https://challenges.cloudflare.com; media-src 'self' https: blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
Strict-Transport-Security: max-age=31536000; includeSubDomains
```

## Your checklist
* Use a long unique password + authenticator app for every admin. Keep recovery codes offline.
* Never share the `service_role` key, database password or Supabase access token. Never paste them in chat, GitHub files or the website.
* Verify payments only in your bank/UPI app — never from a screenshot or a WhatsApp message.
* Review **Admin → Security** weekly (failed logins, admins without 2FA, duplicate-UTR attempts, audit log).
* Remove admin rights from anyone who no longer needs them. After a suspected compromise: "Sign out of all my sessions", change password, re-enrol 2FA.
* Keep `ALLOWED_ORIGINS` limited to your real site addresses.
