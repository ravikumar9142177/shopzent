# SHOPZENT — Discover More. Shop Smarter.

A colourful, mobile-first shopping website for India: direct products paid by **manual UPI** (with UTR verification by the admin), **Amazon / Flipkart affiliate** products, digital apps/APKs, video tutorials, ads, coupons, a store-credit wallet and a loyalty-coin system — with a secure admin panel protected by 2-step verification (authenticator app).

* **Live preview (demo mode):** https://shopzent.sites.tab.bot/ — sample data only, stored in your own browser; nothing is real and no money moves. Customers register first (a local test account in demo mode), then log in and check out.
* **Super Admin email:** `ravitechsolution.shop@gmail.com` — used for `bootstrap_super_admin` (SETUP.md Step 7). Admin login at `/admin/` (email + password, or "Continue with Google" once Supabase is connected), then a mandatory 6-digit authenticator code. No admin password is written in any file: demo mode checks a PBKDF2 hash, real mode uses Supabase Auth.
* **Coupons are private:** no coupon code is shown anywhere on the website. Customers type a code you gave them at checkout; the server validates it. Manage codes in Admin → Coupons.
* **Payment → WhatsApp:** after the customer submits the UTR + screenshot, WhatsApp opens with the order details for 9942598154; the customer taps Send and attaches the screenshot. The admin panel always has both.
* **Own domain:** Admin → Domain shows the DNS records and checks them; SETUP.md → "Custom domain".
* **Contact used on the site:** WhatsApp 9942598154 (click-to-chat), ravitechsolution.shop@gmail.com
* **UPI:** `techravi@fam` (Ravi Kumar). The payment page draws a real UPI QR from this ID with the exact order amount and Order ID filled in, plus a "Pay with UPI app" button; the owner's own QR image is the fallback.

## Folder map

| Folder / file | What it is |
|---|---|
| `site/` | The whole website (plain HTML + CSS + JavaScript). This is what GitHub Pages serves. |
| `site/js/config.js` | The **only** file to edit to connect your Supabase project (URL + public anon key). Empty = demo mode. Also holds the admin email and the preview-only admin password hash. |
| `site/admin/` | Admin panel (orders, payment verification, returns/refunds, products, categories & brands, videos, apps/APKs, ads, coupons, wallets, coins, settings, users, messages, security). |
| `supabase/` | Database migrations (tables, Row Level Security, business logic), storage rules, Edge Functions (`login-guard`, `apk-verify`). See `supabase/README.md`. |
| `.github/workflows/` | `deploy-site.yml` (auto-deploy the site to GitHub Pages) and `deploy-backend.yml` (manual: push migrations + functions). |
| `tests/db/` | Database tests (SQL + HTTP). `tests/e2e/` | Browser tests (Playwright) on the demo layer. |
| `SETUP.md` | Step-by-step setup in simple English — **start here**. Includes the custom-domain guide (with a Hinglish summary) and Google login. |
| `tools/make-admin-hash.py` | Makes a new preview-mode admin password hash (the password is never saved). |
| `CNAME` (you add it) | One line with your domain; the deploy workflow publishes it and uses it as the site address. |
| `SECURITY.md`, `BACKUP.md`, `TESTING.md`, `LIMITATIONS.md` | How it is protected, how to back up, what was tested, what it cannot do. |

## How it works (short)

* The browser never decides prices, discounts, coupon validity, wallet balances, refunds or admin rights. All of that is computed and checked **inside the database** (Postgres functions + Row Level Security). The website only holds the public anon key.
* An order is confirmed **only** after an admin checks the bank/UPI app and presses "Verify payment". A screenshot or WhatsApp message is never treated as proof. One UTR can back only one order.
* Coins are internal loyalty points (5,000,000,000 treasury). **They are not money**, not rupees, and cannot be withdrawn.
* Sample products/brands in the demo are clearly labelled "(sample)". No real prices, ratings or reviews were invented.

## Pages

40 public pages + a 404 page: Home, Products, Product details, Featured, Trending, Deals, Offers & coupons, Categories, Brands, Apps, App details, APK downloads, Videos, Promotional videos, Advertisements, About, Contact, Login, Register, Forgot password, Reset password, Dashboard, Profile & security (2FA), Cart, Checkout, Payment, Payment submit (UTR), My orders, Order details/tracking, Wallet & coins, Wishlist, Returns, and 8 legal pages (Privacy, Terms, Refund, Shipping, Affiliate disclosure, Wallet terms, Coupon terms, Downloads policy).

Admin (18 pages under `/admin/`): Login, Dashboard, Orders, Payment verification, Returns & refunds, Products, Categories & brands, Videos, Apps & APKs, Ads, Coupons, Wallets, Coins, Settings, Domain, Users, Messages, Security.
