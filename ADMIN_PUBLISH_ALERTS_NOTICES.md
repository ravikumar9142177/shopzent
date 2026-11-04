# Admin additions — publish switch, Hacker alerts, customer update notices (migration 0019)

## 1. Publish / Unpublish (maintenance mode)
* Admin → Dashboard: big green/red card with a confirm dialog (optional message for customers). A LIVE / CLOSED pill shows in every admin page.
* Closed = visitors see "Website abhi thodi der ke liye band hai, jaldi wapas aayenge" (Hinglish + English, WhatsApp 9942598154). Admin pages and admin login keep working; a logged-in admin who opens the storefront sees it with a red "UNPUBLISHED" banner.
* Server side: `site_control` table (no public access). Visitors can read only `public_site_status()` -> `{published, message}`. Orders are refused by a trigger on `orders` (error `site_unpublished`), so `create_order` cannot bypass it. Every switch is written to the audit log (`site_published` / `site_unpublished`).
* Browsing is hidden by the page, not by the database: product data is public by design, so someone calling the read API directly can still read the catalogue. Ordering cannot be done.

## 2. Hacker alerts (Admin → Site & people → Hacker alerts)
Table `security_alerts` (RLS: admins with 2FA only), IP block list `blocked_ips`. Same attack from the same IP inside 30 minutes = one alert with a counter (a flood is one row). Medium+ alerts ring the admin bell (max 10/hour); an alert that grows to High also rings it.
Wired sources: login-guard (wrong-password bursts, lockouts, hammering a locked login, admin-account failures), wrong 2-step codes, disposable-email signups per IP (the signup hook), re-used UTR, 5+ orders in 30 minutes, framing by other sites, script/SQL-looking text (contact form, profile name, signup, and any form in the browser), a customer opening the admin panel.
Block this IP: enforced in login-guard, the signup hook and order creation. Refuses to block the admin's own IP. 24 h / 7 d / until unblocked.
Not detectable here: direct API calls to admin RPCs by a customer (the database refuses, but a refused call rolls back its own log row), DDoS/traffic floods, a stolen password used correctly.

## 3. Customer update notices
Triggers on products, categories, brands, videos, apps, ads and public site settings. A meaningful edit by an admin sends ONE in-app notification to every active customer with a single set-based INSERT (title "Naya update", no details). Cooldown (default 6 h) and master switch live in Admin -> Settings -> Customer update notices, plus a manual "Send update notice now" button. Edits during the cooldown are remembered and one notice goes out when it ends (pg_cron every 10 min). Not triggered by: drafts, view/impression counters, orders/payments/order-rule/payment settings, security actions, publish toggles. The email flag is stored but forced OFF; nothing is ever emailed, texted or sent on WhatsApp.
Customers get a bell in the header (unread count, last 20 messages, mark-all-read).

## Tests
`tests/db/tests/10_publish_alerts_notices.sql` (83 checks, also run on the live database inside a rolled-back transaction) and `tests/e2e/admin2*.mjs` (phone-size browser runs against https://qeuika.shop).
