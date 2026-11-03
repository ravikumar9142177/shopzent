# Backups

**What to back up:** the database (orders, payments, ledgers, settings) and the storage buckets (product images, payment screenshots, return photos, APKs). The code is already safe on GitHub.

## Database
* **Free plan:** Supabase free projects do not include downloadable automatic backups. Make your own weekly:
  ```
  npx supabase db dump --linked -f backup-schema.sql
  npx supabase db dump --linked --data-only -f backup-data-$(date +%F).sql
  ```
  Keep the files somewhere private (they contain customer names, addresses and phone numbers) — e.g. an encrypted drive, **not** a public GitHub repo.
* **Pro plan:** daily automatic backups (7 days) and optional Point-in-Time Recovery.
* Quick exports: the admin panel has **CSV / JSON export** buttons on Orders, Coupons, Products and other lists, plus the audit log export in Security.

## Storage files
Supabase → Storage → each bucket → download, or use the Storage API / `rclone` (S3-compatible endpoint in Project Settings → Storage). Payment proofs and return photos are private — store them privately.

## Restore (test this once!)
1. Create a fresh Supabase project.
2. Run the migrations 0001–0010 (SETUP Step 3).
3. `psql "<new connection string>" -f backup-data-YYYY-MM-DD.sql`
4. Re-upload storage files, redo Auth settings, deploy functions, update `SUPABASE_URL`/`SUPABASE_ANON_KEY` in GitHub.

## Good habits
* Free projects **pause after ~1 week without visits** — open the site or admin at least weekly (an Uptime monitor ping also helps).
* Before big changes, take a dump first.
* Ledgers (wallet, coins, refunds, order history, audit log) cannot be edited or deleted by design — keep that in mind when restoring partial data.
