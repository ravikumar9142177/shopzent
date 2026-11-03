# Testing — what was actually tested

Everything below was run on a build machine, **not** on a real Supabase project or a real phone. Honest summary at the bottom. Last full run: 4 Nov 2026.

## 1. Database (tests/db) — `bash tests/db/run.sh`
Fresh PostgreSQL 15 + a small "Supabase look-alike" (roles, `auth.uid()`/`auth.jwt()`, auth/storage tables), then all 11 migrations applied **twice** (to prove they are safe to re-run), `plpgsql_check` static analysis, then the tests. Latest run: **440** SQL checks and **34** HTTP checks passing, 0 failing (full output in `tests/db/RESULTS.txt`).
* RLS: anon/customer/admin visibility on every table, IDOR (user B cannot see user A's order), customers cannot change role/status/order status, admin without MFA (aal1) refused.
* **Private coupons:** all seeded coupons are `is_public = false`; `public_coupons()` returns nothing for anon and customers (even if a coupon is flagged public); anon/customers read 0 rows of the coupons table and cannot create coupons; anon and customers can validate one typed code through `quote_cart`; the seeded codes' SHA-256 fingerprints equal the ones the website uses. The tests never contain the codes — they read them from the seeded rows.
* Pricing: coupons (percent/fixed, min order, max cap, per-user/total limits, eligible/excluded products & categories, expiry), product discounts, max-discount cap, wallet use, stock.
* Payments: UTR format, duplicate UTR blocked + logged, verify/reject flows, idempotency.
* Refunds can never exceed verified paid amount; coins never exceed treasury; ledgers reject UPDATE/DELETE; reversals once only.
* Domain setting: only the Super Admin can save it; a domain with `https://` or a path and a bad GitHub username are refused; visitors can read the saved domain.
* HTTP layer: real PostgREST 12 with signed tokens (anon `public_coupons` → empty list, anon `quote_cart` with a typed code → correct total); Edge Functions (`login-guard`, `apk-verify`) under Deno 2 against mocked Supabase Auth/Storage — CORS allow-list, generic login errors, 10/min lockout, cooldown with no oracle, APK hashing/quarantine.

## 2. Website in the browser (tests/e2e) — demo layer
Playwright + Chromium at **iPhone size (390×844)**. Start a server in `site/` (`python3 -m http.server 8765`), then in `tests/e2e`: `npm install && npx playwright install chromium && node smoke.mjs $(cat pages.txt) && node flow.mjs`. Results: `tests/e2e/RESULTS.txt`.
* `smoke.mjs`: opens all **59 pages** (41 public + 18 admin) — **0 JavaScript console errors**.
* `flow.mjs`: **59 of 59 steps pass**, 0 console errors. New in this round:
  * no coupon code in the rendered home, offers, cart, checkout, coupon terms, terms, deals, ads and about pages; the offers page says "Have a coupon code? Apply it at checkout"; a typed 20% code (lowercase) applies exactly 20% (₹259.80 off ₹1,299); Admin → Coupons lists the 3 codes after admin login;
  * the **shipped** `config.js` holds the owner's PBKDF2 hash; with the shipped file, the admin email + a wrong password and the old demo admin credentials are both refused; the admin and customer login pages show no credentials;
  * the PBKDF2 login path with a **temporary** random password + hash created inside the test run (the owner's real password is not known to the tests and was never used): wrong password refused, other emails refused, right password → 2-step screen ("enter any 6 digits"), non-digits refused, 6 digits accepted;
  * customer login page: typing the admin email shows "Admin? Login here"; right password goes straight to the admin 2-step screen; footer "Admin login" link;
  * guest checkout → login page with "Register here" → register → log in → back to the cart → checkout;
  * payment submit opens WhatsApp by itself (wa.me/919942598154 with name, Customer ID, Order ID, amount, UTR, screenshot note), success screen with the big "Send on WhatsApp" button and the "attach your screenshot" instruction;
  * "Continue with Google" button shows the honest preview note and does nothing fake;
  * Admin → Domain: the 4 A records + www CNAME with copy buttons, the domain is cleaned (`https://www.ShopZent.in/` → `shopzent.in`), saved, and the home page canonical becomes `https://shopzent.in/`.
  * Still covered from before: search & filters, affiliate redirect, invalid coupon message, order + UPI QR with exact amount and Order ID, UTR validation, duplicate UTR blocked, cancel unpaid order, non-admin blocked from admin, verify payment → Confirm → Processing → Shipped → Delivered, coin transfer, coupon + product create, UPI ID validation, security dashboard, return request, refund to wallet, double refund blocked.
* Deploy workflow build step run locally with a `CNAME` file and dummy Supabase values: the domain becomes the site address, the CNAME file is published, every page gets a static canonical link, `sitemap.xml`/`robots.txt` get the domain, and the preview admin hash is removed from `config.js`.

## 3. NOT tested (needs the real accounts)
* The site connected to a **real Supabase project** (the Supabase adapter `api-supabase.js` was written against the same contract the database tests use, but no live request has been made) — including Google sign-in, the 7-day signed screenshot link and the admin-email redirect in real mode.
* The owner's real admin password (only its hash is in the files).
* Real emails (confirm, reset), real TOTP enrolment with a phone authenticator app, real aal2 tokens.
* Real UPI payment: whether every UPI app (GPay, PhonePe, Paytm, Fam) accepts the amount-filled QR from a personal UPI ID — some apps limit or warn on prefilled amounts to personal IDs. The owner's plain QR is offered as a fallback.
* Whether a given phone browser allows WhatsApp to open automatically after submit (the "Send on WhatsApp" button is the fallback).
* The "Check DNS" button against a real domain (it calls Google public DNS from the browser; there is no domain yet).
* GitHub Actions workflows on GitHub itself, real devices (iPhone/Android browsers), Turnstile CAPTCHA, VirusTotal scanning with a real key, large data volumes.

Before going live: do one real ₹1 order end-to-end yourself (register → order → pay → submit UTR → verify in admin) and one refund.
