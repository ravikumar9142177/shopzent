-- SHOPZENT 0009: seed data. NO fake products, NO UPI ID / QR (the owner adds the real ones in Admin).
-- Safe to re-run: existing rows are left as they are.

insert into public.site_settings (key, value, is_public) values
  ('brand', '{"name": "SHOPZENT", "tagline": "Discover More. Shop Smarter.", "logo_url": "", "favicon_url": ""}'::jsonb, true),
  ('contact', '{"whatsapp": "9942598154", "email": "ravitechsolution.shop@gmail.com", "address": "", "hours": ""}'::jsonb, true),
  ('social', '{"instagram": "", "youtube": "", "facebook": "", "x": "", "telegram": ""}'::jsonb, true),
  ('payment', '{"upi_id": "techravi@fam", "payee_name": "Ravi Kumar", "qr_url": "", "instructions": "Scan the SHOPZENT UPI QR or pay to the UPI ID shown, enter the exact amount, then come back and submit your UTR / transaction reference number. Your order is confirmed only after we verify the payment in our bank records."}'::jsonb, true),
  ('home', '{"hero_title": "Discover More. Shop Smarter.", "hero_subtitle": "Deals, top brands, digital apps and tutorials in one place.", "hero_cta": "Shop now", "sections": ["categories", "trending", "deals", "featured", "popular", "latest", "brands", "offers", "videos", "apps", "why", "about", "newsletter"], "announcement": ""}'::jsonb, true),
  ('nav', '[{"label": "Home", "href": "/"}, {"label": "Products", "href": "/products.html"}, {"label": "Deals", "href": "/deals.html"}, {"label": "Apps", "href": "/apps.html"}, {"label": "Videos", "href": "/videos.html"}, {"label": "Contact", "href": "/contact.html"}]'::jsonb, true),
  ('seo', '{"default_title": "SHOPZENT — Discover More. Shop Smarter.", "default_description": "Multi-brand deals, affiliate picks from Amazon India and Flipkart, digital apps and tutorials.", "og_image": ""}'::jsonb, true),
  ('page_about', '{"html": "<p>SHOPZENT is a multi-brand shopping, deals and digital apps platform for India. The owner can edit this page from the Admin Panel.</p>"}'::jsonb, true),
  ('page_contact', '{"html": "<p>WhatsApp: 9942598154<br>Email: ravitechsolution.shop@gmail.com</p>"}'::jsonb, true),
  ('legal_privacy', '{"html": "<p>Privacy Policy — placeholder. The site owner must replace this text from Admin → Website → Legal pages before going live.</p>"}'::jsonb, true),
  ('legal_terms', '{"html": "<p>Terms and Conditions — placeholder. The site owner must replace this text from Admin → Website → Legal pages before going live.</p>"}'::jsonb, true),
  ('legal_refund', '{"html": "<p>Refund and Return Policy — placeholder. Returns are accepted within the window shown at checkout. Refunds go to the original payment method unless you choose SHOPZENT store credit where permitted.</p>"}'::jsonb, true),
  ('legal_shipping', '{"html": "<p>Shipping Policy — placeholder. Delivery estimates are shown at checkout.</p>"}'::jsonb, true),
  ('legal_affiliate', '{"html": "<p>SHOPZENT participates in affiliate marketing programs. Some links on this website are affiliate links. We may earn a commission from qualifying purchases made through these links, at no additional cost to you.</p>"}'::jsonb, true),
  ('legal_wallet', '{"html": "<p>Wallet and Store Credit Terms — placeholder. SHOPZENT wallet balance is store credit for eligible SHOPZENT purchases only. It is not a bank account, deposit or payment instrument and cannot be withdrawn as cash. SHOPZENT coins are loyalty points, not money.</p>"}'::jsonb, true),
  ('legal_coupon', '{"html": "<p>Coupon Terms — placeholder. Coupons are validated at checkout; one coupon per order unless stated otherwise.</p>"}'::jsonb, true),
  ('legal_downloads', '{"html": "<p>Digital Downloads Policy — placeholder. Third-party apps belong to their developers. An app is marked verified only after an actual scan or review.</p>"}'::jsonb, true),
  ('return_policy', '{"window_days": 7, "summary": "Returns can be requested within 7 days of delivery for eligible items."}'::jsonb, true),
  ('delivery', '{"estimate_text": "Usually delivered in 5–7 business days after payment verification."}'::jsonb, true),
  ('seller', '{"name": "SHOPZENT", "address": "", "gstin": ""}'::jsonb, true),
  ('security', '{"captcha_after_failures": 3, "login_max_failures_per_minute": 10, "fresh_auth_minutes": 15}'::jsonb, false)
on conflict (key) do nothing;

insert into public.categories (name, slug, icon, sort, published) values
  ('Electronics', 'electronics', '📱', 1, true),
  ('Fashion', 'fashion', '👗', 2, true),
  ('Beauty', 'beauty', '💄', 3, true),
  ('Home & Kitchen', 'home-kitchen', '🏠', 4, true),
  ('Mobile Accessories', 'mobile-accessories', '🎧', 5, true),
  ('Lifestyle', 'lifestyle', '✨', 6, true)
on conflict (slug) do nothing;

-- Starting coupons are NOT stored in this public repository (they would be readable here).
-- Create your private coupons in Admin → Coupons (is_public stays false, so they are never listed).

insert into public.coin_settings (id, enabled, total_supply, expiry_days, rules)
values (1, true, 5000000000, null, 'SHOPZENT coins are internal loyalty points. They are not money, cannot be withdrawn and are not a bank or UPI balance.')
on conflict (id) do nothing;

-- one-time treasury mint of 5,000,000,000 loyalty coins
insert into public.coin_ledger (txn_ref, user_id, kind, coins, note, idempotency_key)
select 'SZCN-GENESIS', null, 'mint', 5000000000, 'Initial internal loyalty coin supply (not money)', 'genesis-mint'
where not exists (select 1 from public.coin_ledger where kind = 'mint');

-- the products table is intentionally left EMPTY: add real products from Admin → Products.
