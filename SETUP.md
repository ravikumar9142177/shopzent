# SHOPZENT setup — simple steps

> **Hinglish mein short summary (custom domain):**
> 1. Hostinger / GoDaddy / Namecheap se domain kharido (jaise `shopzent.in`).
> 2. Domain ki **DNS settings** mein 4 **A records** daalo: `@` → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`.
> 3. Ek **CNAME** daalo: `www` → `<aapka-github-username>.github.io`.
> 4. GitHub repo → **Settings → Pages → Custom domain** mein domain likho → Save → green tick aane ke baad **Enforce HTTPS** tick karo.
> 5. Repo mein `CNAME` naam ki file banao jisme sirf domain likha ho (jaise `shopzent.in`). Website khud sahi address (canonical/sitemap) use karegi.
> Admin panel → **Domain** page pe saare records copy button ke saath hain, aur **Check DNS** button se ✅/❌ dikhta hai. Last GitHub wala step Tab bhi kar sakta hai.

You need: a **GitHub** account, a **Supabase** account (free), and about 1 hour. No coding needed. Do the steps in order.

**Admin email:** `ravitechsolution.shop@gmail.com` — this is the Super Admin (`bootstrap_super_admin` email, Step 7).

## Step 1 — Put the code on GitHub
1. Log in to github.com → **New repository** → name it `shopzent` → Public → **Create**.
2. Click **uploading an existing file**, drag in everything from the `shopzent` folder (including the hidden `.github` folder — if your computer hides it, upload `.github/workflows/deploy-site.yml` and `deploy-backend.yml` by creating the same folders with "Add file → Create new file" and pasting the text).
3. Press **Commit changes**.

## Step 2 — Turn on GitHub Pages
1. Repository → **Settings → Pages** → Source: **GitHub Actions**.
2. Settings → **Secrets and variables → Actions → Variables** → New variable: `SITE_URL` = `https://YOUR-GITHUB-USERNAME.github.io/shopzent` (later your own domain — see "Custom domain" below).
3. Go to the **Actions** tab → "Deploy site" → **Run workflow**. After 1–2 minutes your site is live at that address — in **demo mode** (nothing real yet).

## Step 3 — Create the Supabase project
1. supabase.com → **New project** → name `shopzent`, choose a strong database password (save it in a password manager), region **Mumbai**.
2. When it is ready: **SQL Editor → New query**. Open `supabase/migrations/0001_extensions_roles_helpers.sql`, copy everything, paste, **Run**. Repeat for 0002 … 0011 **in order**. Each must say "Success".
   (If you like command lines, `supabase db push` does the same — see `supabase/README.md`.)

## Step 4 — Auth settings (Supabase → Authentication)
* **URL Configuration → Site URL:** your site address from Step 2. Add redirect URLs `…/reset-password.html`, `…/login.html` and `…/admin/index.html` (the last one is for Google login).
* **Providers → Email:** Confirm email ON. Password minimum 10, require upper case, lower case and digits.
* **Multi-Factor:** TOTP (authenticator app) **enabled**. It stays mandatory for admins — also after Google login.
* **Sessions:** refresh-token rotation ON.
* **SMTP:** add a real email sender (for example Brevo or Zoho free tiers) — Supabase's built-in email sends only a few mails per hour.

### Google login for the admin ("Continue with Google")
1. console.cloud.google.com → create a project → **APIs & Services → OAuth consent screen** → External → app name SHOPZENT, your email → Save.
2. **Credentials → Create credentials → OAuth client ID** → type **Web application**.
   * Authorised JavaScript origins: your site address (e.g. `https://shopzent.in`).
   * Authorised redirect URI: `https://YOUR-PROJECT-REF.supabase.co/auth/v1/callback` (Supabase shows this exact URL on the Google provider page).
3. Copy the **Client ID** and **Client secret** → Supabase → **Authentication → Providers → Google** → paste both → Enable → Save.
4. Done. On `/admin/`, "Continue with Google" signs in with Google; the admin rights still come from the database (only the account made Super Admin in Step 7 gets in), and the 6-digit authenticator code is still asked every time.
   Google and email/password sign-ins with the same verified email become the same Supabase user.
   To hide the button, set `GOOGLE_LOGIN: false` in `site/js/config.js`.

## Step 5 — Connect the website
1. Supabase → **Project Settings → API**. Copy the **Project URL** and the **anon public** key. (Never copy the `service_role` key anywhere.)
2. GitHub → Settings → Secrets and variables → Actions:
   * Variables → `SUPABASE_URL` = the Project URL
   * Secrets → `SUPABASE_ANON_KEY` = the anon key
3. Actions → "Deploy site" → **Run workflow**. The demo bar disappears: the site is now real. (The deploy also removes the preview-only admin password hash from the public files.)

## Step 6 — Server functions (login protection + APK scan)
On a computer with Node installed:
```
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase functions deploy login-guard --no-verify-jwt
npx supabase functions deploy apk-verify
npx supabase secrets set ALLOWED_ORIGINS="https://YOUR-GITHUB-USERNAME.github.io"
npx supabase secrets set HASH_PEPPER="any-long-random-text"
# optional: real APK virus scanning
npx supabase secrets set VT_API_KEY="your VirusTotal API key"
```
(Or add `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `SUPABASE_PROJECT_REF` as GitHub **secrets** and run the "Deploy backend" workflow.)
If you skip this step the site still works; login just uses Supabase's normal limits.

## Step 7 — Make yourself Super Admin (once)
1. On your live site: **Register** with `ravitechsolution.shop@gmail.com` and the password you want, then confirm the email link. (Or press "Continue with Google" on `/admin/` with that Gmail.) Your admin password is whatever you set here — it is never written in any file.
2. Supabase → SQL Editor:
   ```
   select public.bootstrap_super_admin('ravitechsolution.shop@gmail.com');
   ```
   → Run. (It works only once — when no Super Admin exists yet.)
3. Open `your-site/admin/` → log in → scan the QR with Google Authenticator / Microsoft Authenticator → type the 6-digit code. **Save the recovery codes** on paper.
   Tip: if you type the admin email on the normal customer login page, it checks the password and takes you straight to the admin 2-step screen.

## Step 8 — Fill in your shop (Admin panel)
1. **Settings → UPI payment:** check UPI ID `techravi@fam` and payee name. Optionally upload your QR image (the site already has your QR as a fallback). **Only your genuine QR.**
2. **Settings → Contact / Brand / Seller / Delivery / Return window / Legal pages:** check every text. The legal pages are templates — have them checked for your business.
3. **Categories & Brands**, then **Products**: choose *Direct* (UPI checkout) or *Affiliate* (paste your Amazon Associates / Flipkart Affiliate link — use **your own** affiliate tag). Use real prices and genuine/licensed photos only.
4. **Coupons:** your 3 coupons (10%, 20%, 30%) already exist — open Admin → Coupons to see the codes, set limits/expiry, or create new ones. **Coupon codes are private:** they are never shown on the website. Only customers you tell a code to can type it at checkout.
5. Videos, Apps, Ads as needed.

## Step 9 — Daily work
* **Payments → New:** open each, check your bank/UPI app for the same **UTR and amount**, then Verify (or Reject with a reason). Then Confirm → Processing → Shipped (add courier + tracking) → Delivered.
  After submitting, the customer's WhatsApp opens with the order details to 9942598154 — they press Send and attach the screenshot. The UTR and screenshot are always in the admin panel too.
* **Returns:** approve/reject; refund to the original UPI/bank (enter your refund UTR) or store credit if the customer chose it.
* Check **Security** weekly. Follow **BACKUP.md** weekly.

## Custom domain (your own address, e.g. shopzent.in)
Do not use a domain you don't own. The Admin panel has a **Domain** page (Admin → Domain) with these exact records, copy buttons and a **Check DNS** button.

1. **Buy a domain** at Hostinger, GoDaddy or Namecheap (e.g. `shopzent.in`).
2. At the seller: your domain → **DNS / Manage DNS**. Delete any old **A** records for `@` (the "parked" page). Add:

   | Type | Name / Host | Value / Points to |
   |---|---|---|
   | A | `@` | `185.199.108.153` |
   | A | `@` | `185.199.109.153` |
   | A | `@` | `185.199.110.153` |
   | A | `@` | `185.199.111.153` |
   | CNAME | `www` | `<your-github-username>.github.io` |

   Leave TTL at the default. It can take 10 minutes to a few hours to work.
3. **GitHub → your repo → Settings → Pages → Custom domain:** type `shopzent.in` → **Save**. Wait for the green "DNS check successful", then tick **Enforce HTTPS** (the free certificate can take up to an hour the first time). Typing the domain without `www` is fine — GitHub sends `www.shopzent.in` to it automatically.
4. **CNAME file:** in the repo root, "Add file → Create new file", name it `CNAME`, content just `shopzent.in`, commit. The deploy workflow reads it: the file is published with the site, and if the `SITE_URL` variable is empty, it becomes `https://shopzent.in`. (With GitHub Actions deploys, GitHub takes the domain from step 3; the file keeps the address in your code.)
5. **Update the base URL everywhere:** GitHub variable `SITE_URL` = `https://shopzent.in` (or delete it and let the CNAME file decide). The next deploy writes this address into every page's canonical link, the share image links, `sitemap.xml` and `robots.txt`. Also save the domain in **Admin → Domain** (the site then uses it for canonical/share links even before the next deploy).
6. **Supabase:** Authentication → URL Configuration → Site URL = `https://shopzent.in`, add the redirect URLs again with the new address; Edge Function secret `ALLOWED_ORIGINS="https://shopzent.in,https://www.shopzent.in"`; Google OAuth client: add `https://shopzent.in` as an authorised origin.
7. Open `https://shopzent.in` — padlock = done.

Tab can do steps 3–5 for you once the domain is bought and the DNS records are added.

## Preview (demo) mode notes
* Before Supabase is connected the site runs in demo mode: everything is stored only in the visitor's own browser. Customers can register and log in (local test accounts); nothing is shared between phones.
* The demo admin login accepts only `ravitechsolution.shop@gmail.com`. The password is checked against a PBKDF2-SHA256 hash (600,000 rounds) in `site/js/config.js` → `DEMO_ADMIN` — the password itself is not stored anywhere. Demo 2-step screen: any 6 digits.
* **Change the preview admin password:** on any computer with Python 3 run `python3 tools/make-admin-hash.py` (it asks for the password without showing it) and paste the printed `salt_b64` / `hash_b64` into `DEMO_ADMIN` in `site/js/config.js`. With Supabase connected this is not used: the admin password is the one you set in Step 7.
