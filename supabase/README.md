# SHOPZENT — Supabase backend

This folder is the whole server side of SHOPZENT: the database (tables, security rules, business logic), file storage rules, and two small server functions. The website itself (in `site/`) only ever uses the public **Project URL** and **anon key**. Everything that matters (prices, coupons, payments, refunds, wallet, coins, admin powers) is checked here, inside the database, not in the browser.

## What is in here

| Path | What it is |
|---|---|
| `migrations/0001_extensions_roles_helpers.sql` | Turns on `pgcrypto` and adds helpers: secure random IDs (`SZC-…`, `SZW-…`, `SZO-…`, `SZPAY-…`, `SZR-…`, `SZRF-…`), the caller's MFA level, and the caller's IP for rate limits. |
| `migrations/0002_core_tables.sql` | Profiles (Customer ID), wallets (Wallet ID), security tables (rate limits, idempotency, login attempts, recovery codes), notifications, site settings, audit log. Also adds role checks (`is_admin()` needs MFA/aal2), the fresh-login check, the rate limiter, and the sign-up trigger that creates a profile + wallet for every new user. |
| `migrations/0003_commerce.sql` | Categories, brands, products, coupons, videos, apps/APKs, ads, wishlist, recently viewed, orders, order items, order history, payment submissions (one UTR can never back two orders), duplicate-UTR log, returns, contact messages, newsletter, affiliate clicks. |
| `migrations/0004_wallet_coins_refunds.sql` | Ledgers that can only be added to, never edited or deleted: wallet (rupee store credit), coins (loyalty points, **not money**), refunds (rupees), refund events, order events. |
| `migrations/0005_rls_policies.sql` | Row Level Security on **every** table, deny by default. Visitors read published content only; customers see only their own data; admins (with MFA) manage content. Also adds automatic audit rows for every admin content change. |
| `migrations/0006_functions_public.sql` | The pricing engine and the functions the website calls: `quote_cart`, `create_order`, `submit_payment`, `request_cancellation`, `request_return`, wallet/coins views, recovery codes, contact form, newsletter, click tracking. |
| `migrations/0007_functions_admin.sql` | Admin functions: dashboard stats, security overview, order search, payment verify/reject, order status, reject/cancel, returns, refunds, wallet credit/debit, coin transfers/reversals, users and roles, settings, audit log, and `bootstrap_super_admin`. |
| `migrations/0008_storage.sql` | Storage buckets (`public-media`, `payment-proofs`, `return-photos`, `apk-files`) with size and file-type limits, plus who may upload or read what. |
| `migrations/0009_seed.sql` | Starting data: site settings (WhatsApp 9942598154, email ravitechsolution.shop@gmail.com, brand, placeholder legal pages), 6 categories, the 3 private coupons (10%, 20%, 30% — codes written base64-encoded, see Admin → Coupons), and the 5,000,000,000-coin treasury. **No products and no uploaded QR.** The payment setting starts with the owner's real UPI ID `techravi@fam` (payee Ravi Kumar); the website draws a QR from it with the exact amount and order ID. You can change it, or upload your own QR, in Admin → Settings. |
| `migrations/0011_private_coupons.sql` | Coupons are private: every coupon `is_public = false`, `public_coupons()` always returns an empty list. Customers validate only the one code they type (`quote_cart` / `create_order`). |
| `migrations/0010_function_grants.sql` | Locks down who may call which function (Supabase lets everyone call new functions by default; this removes that). |
| `functions/login-guard/` | Login endpoint with brute-force protection (10 failures/minute per email+IP, cooldowns of 1, 2, 5 and 15 min, a growing delay, optional CAPTCHA, the same generic error for every failure). |
| `functions/apk-verify/` | Admin-only: hashes an uploaded APK (SHA-256), checks it is a real APK/ZIP, and looks it up on VirusTotal if you add a key. It never marks a file safe without a real scan. |
| `functions/_shared/cors.ts` | Strict CORS: only the website addresses you list in `ALLOWED_ORIGINS`. |
| `config.toml` | Supabase CLI config with the recommended Auth settings (also listed below for the dashboard). |
| `../tests/db/` | The automated test suite (see "Testing" below). |

## 1. Create the database (choose ONE way)

### Way A — SQL Editor (no installs)
1. Create a project at https://supabase.com (free plan is fine to start). Choose region **Mumbai (ap-south-1)**.
2. Open **SQL Editor → New query**.
3. Open `migrations/0001_extensions_roles_helpers.sql`, copy all of it, paste, press **Run**. Wait for "Success".
4. Do the same for `0002`, `0003`, … up to `0010`, **in that order**, one file at a time.
5. If a file stops with an error, fix the problem and run that same file again. Every file is safe to run twice.

### Way B — Supabase CLI
```bash
npm i -g supabase          # or: brew install supabase/tap/supabase
supabase login
supabase link --project-ref YOUR_PROJECT_REF     # Settings → General → Reference ID
supabase db push                                  # applies migrations/0001 … 0011 in order
```

## 2. Auth settings (Dashboard → Authentication)
- **URL Configuration**: Site URL = your live site (for example `https://shopzent.in` or `https://USERNAME.github.io/REPO`). Add these redirect URLs: `…/reset-password.html` and `…/login.html`.
- **Providers → Email**: Confirm email **ON**, Secure password change **ON**. Minimum password length **10**, and require lower case, upper case and digits.
- **Multi-Factor**: TOTP (App Authenticator) **Enabled**, for both enrol and verify.
- **Sessions**: JWT expiry 3600 s. Detect and revoke compromised refresh tokens (refresh token rotation) **ON**, reuse interval 10 s.
- **Attack Protection** (optional): Cloudflare Turnstile CAPTCHA. If you turn it on, the website also needs the Turnstile site key.
- **Rate Limits**: keep the defaults or lower them. Also set up custom SMTP (Settings → Auth → SMTP), because the built-in mailer only sends a few emails per hour.

## 3. Deploy the two server functions
```bash
supabase functions deploy login-guard --no-verify-jwt
supabase functions deploy apk-verify
supabase secrets set ALLOWED_ORIGINS="https://shopzent.in,https://www.shopzent.in,https://USERNAME.github.io"
# optional:
supabase secrets set CAPTCHA_PROVIDER=turnstile CAPTCHA_SECRET=your-turnstile-secret
supabase secrets set VT_API_KEY=your-virustotal-key        # enables real APK scanning
supabase secrets set VT_UPLOAD=true                         # also upload unknown APKs (≤32 MB) to VirusTotal
supabase secrets set HASH_PEPPER=any-long-random-string     # makes stored email/IP hashes un-guessable
```
`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are provided to functions automatically. **Never** put the service-role key in the website or in GitHub.
If `login-guard` is not deployed, the website falls back to normal Supabase login, which has Supabase's own rate limits but not the per-email+IP lockout.

## 4. Create the first Super Admin (once)
1. Register on your website with the owner's email and click the confirmation link.
2. In **SQL Editor**, run:
   ```sql
   select public.bootstrap_super_admin('ravitechsolution.shop@gmail.com');
   ```
   This only works while there is no super admin. After that it refuses, so nobody can use it to take over.
3. Log in on the website. The admin area makes you add an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, …) and then shows 10 recovery codes **once**. Save them offline.
4. Add more admins later from Admin → Users. That needs the super admin with a fresh login.

## 5. How the important rules work
- **Admins need MFA.** `is_admin()` is true only for an active admin/super_admin whose session is **aal2**, meaning the authenticator code was entered. With the password alone, every admin function answers `mfa_required` and every admin write is blocked by RLS.
- **Fresh login for money and permission actions.** Refunds, wallet credits/debits, coin transfers/reversals, coin settings, role changes, and payment/security settings need a password or MFA check from the last 15 minutes. The check reads the time of the newest authentication in the session (the JWT `amr` claim), so a silent token refresh does not count. If the website gets `fresh_auth_required`, it asks for the authenticator code again and retries.
- **Prices are never trusted from the browser.** `quote_cart` and `create_order` read every price, discount and coupon rule from the database.
- **Payments.** A UTR + screenshot only means "submitted". An order is "paid" only when an admin presses Verify after checking the bank/UPI app. One UTR can back only one live submission. Repeated attempts are logged in `duplicate_utr_attempts`, audited, and shown on the security dashboard.
- **Refunds can never exceed what was paid.** The order row is locked, then every refund is checked against UPI paid + wallet used − already refunded − wallet already returned. The same idempotency key returns the first result instead of refunding twice.
- **Wallet = store credit; coins = loyalty points.** Neither is money, and neither can be withdrawn. Balances are always calculated from the ledgers, which nobody can edit.
- **Ledgers and the audit log cannot be changed or deleted, even by admins or the database owner** (wallet_ledger, coin_ledger, refund_events, order_events, audit_log; refund_ledger allows only "processing → completed/failed"). For a genuine emergency repair, an operator connected directly as `postgres` can run `set local shopzent.ledger_maintenance = 'on';` inside a transaction. Do this only with a backup and a written reason.
- **Deleting users with orders is blocked** (orders keep a foreign key to the customer), because financial records must be kept. Suspend the account instead. **Deleting a coupon that was already used is blocked** for the same reason (error 23503). Deactivate it instead.
- **Files.** Payment proofs and return photos go in private buckets, in a folder named after the customer's user ID. Only that customer and admins can read them. There are no edits, and only admins can delete. APK files can be downloaded (via signed URL) only when a published app points at them and its status is `scanned_clean` or `verified`.

## 6. Free-plan limits to know
- Database 500 MB, file storage 1 GB, 50 MB maximum per file (so APKs above 50 MB need the Pro plan; the `apk-files` bucket allows 200 MB for that case), 500k function calls a month.
- Free projects **pause after 7 days without activity**. Open the dashboard to resume.
- The free plan has **no automatic backups**. Run `supabase db dump -f backup.sql` (or `pg_dump`) regularly and keep the file safe. Download storage files from the dashboard or with the CLI.

## 7. Testing
`tests/db/run.sh` builds a brand-new local PostgreSQL 15 database. It loads a small Supabase look-alike (`tests/db/00_supabase_shim.sql`: the anon/authenticated/service_role roles, `auth.uid()`/`auth.jwt()` written exactly as Supabase writes them, `auth.users`, `auth.mfa_factors`, storage tables, and Supabase's default privileges). Then it applies all ten migrations unchanged, applies them a second time (they must be re-runnable), checks every plpgsql function with `plpgsql_check`, and runs the SQL tests in `tests/db/tests/` as anon, two customers, an admin without MFA, an admin with MFA, and the super admin. If PostgREST and Deno are available, it also runs `tests/db/http/http_test.py`. That script tests the real PostgREST HTTP API with signed JWTs, and runs both Edge Functions under Deno against a small mock of the Supabase login and storage endpoints. Results: `tests/db/RESULTS.txt`.

### What could NOT be tested here (needs the real Supabase project)
- Supabase Auth itself: sign-up emails, email confirmation, password reset emails and expiry, refresh-token rotation, session revocation.
- Real MFA. The tests fake the `aal`/`amr` claims that Supabase puts in the JWT after TOTP enrolment/verification; Supabase's own TOTP enrol/challenge/verify flow and its QR codes were not run.
- That the `postgres` role on a hosted project may delete from `auth.mfa_factors` (used by `use_recovery_code`). If it can't, the code is still marked used, the event is audited, and `factors_removed` comes back as `-1`; an admin then removes the factor in Dashboard → Authentication → Users.
- Supabase Storage's HTTP API: real uploads, bucket MIME/size enforcement, and signed URLs. The storage *policies* were tested directly on `storage.objects`.
- The Supabase Edge Runtime and API gateway. The functions were type-checked (`deno check`) and run under plain Deno 2 against a mock; GoTrue's token endpoint and Storage downloads were mocked. VirusTotal and Turnstile/hCaptcha were not called.
- Supabase's dashboard SQL Editor paste-in flow and `supabase db push` against a hosted project. `config.toml` was parsed by Supabase CLI 3.0 (no errors), but `supabase start` was not run (no Docker on the test machine).
- Performance under load and concurrent requests racing each other. Locking is in place: order, coupon, wallet and coin-treasury rows are locked with `FOR UPDATE`, plus advisory locks for idempotency keys. Only sequential behaviour was tested.

## Payment screenshot link in the WhatsApp message (real mode)
After `submit_payment`, the website asks Supabase Storage for a signed link to the screenshot that is valid for **7 days** (`createSignedUrl('payment-proofs', path, 604800)`). Storage policies on `payment-proofs` (migration 0008) let only the customer who uploaded the file (their own folder) and admins create that link; anyone holding the link can open the image until it expires. Not tested against a live Supabase project (see TESTING.md).
