-- SHOPZENT 0003: catalogue, content, coupons, orders, payments, returns, misc public tables

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,99}$'),
  icon text,
  banner_url text,
  description text,
  sort int not null default 0,
  published boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 100),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,99}$'),
  logo_url text,
  description text,
  published boolean not null default true,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  product_code text not null unique,
  name text not null check (char_length(name) between 1 and 200),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,159}$'),
  description text,
  images jsonb not null default '[]'::jsonb check (jsonb_typeof(images) = 'array'),
  video_url text check (video_url is null or video_url ~ '^https://'),
  brand_id uuid references public.brands (id) on delete set null,
  category_id uuid references public.categories (id) on delete set null,
  marketplace text not null default 'shopzent' check (marketplace in ('shopzent', 'amazon', 'flipkart', 'other')),
  purchase_type text not null default 'direct' check (purchase_type in ('direct', 'affiliate')),
  price numeric(12,2) check (price is null or price >= 0),
  original_price numeric(12,2) check (original_price is null or original_price >= 0),
  discount_percent numeric generated always as (
    case when original_price > 0 and price > 0 and original_price > price
         then round((original_price - price) / original_price * 100) else null end
  ) stored,
  specs jsonb not null default '{}'::jsonb check (jsonb_typeof(specs) = 'object'),
  affiliate_url text check (affiliate_url is null or affiliate_url ~ '^https://[^\s]+$'),
  availability text not null default 'in_stock' check (availability in ('in_stock', 'out_of_stock', 'preorder', 'discontinued')),
  stock_qty int check (stock_qty is null or stock_qty >= 0),
  is_featured boolean not null default false,
  is_trending boolean not null default false,
  is_deal boolean not null default false,
  is_popular boolean not null default false,
  coupon_eligibility text not null default 'yes' check (coupon_eligibility in ('yes', 'no', 'selected')),
  product_discount_percent numeric(5,2) not null default 0 check (product_discount_percent between 0 and 100),
  max_discount_percent numeric(5,2) not null default 90 check (max_discount_percent between 0 and 100),
  allow_combine boolean not null default true,
  offer_expires_at timestamptz,
  price_verified_at timestamptz,
  seo_title text,
  seo_description text,
  is_sample boolean not null default false,
  published boolean not null default false,
  view_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint products_affiliate_needs_url check (purchase_type <> 'affiliate' or affiliate_url is not null),
  constraint products_direct_needs_price check (purchase_type <> 'direct' or price is not null)
);
create index if not exists products_pub_idx on public.products (published, created_at desc);
create index if not exists products_category_idx on public.products (category_id);
create index if not exists products_brand_idx on public.products (brand_id);

create or replace function public._products_before()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.product_code is null or new.product_code = '' then
      new.product_code := public._unique_code('SZP-', 6, 'public.products', 'product_code');
    end if;
  else
    new.product_code := old.product_code; -- immutable once assigned
    new.updated_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists products_before on public.products;
create trigger products_before before insert or update on public.products
  for each row execute function public._products_before();

create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9_-]{3,32}$'),
  description text,
  discount_type text not null default 'percent' check (discount_type in ('percent', 'fixed')),
  discount_value numeric(12,2) not null check (discount_value > 0),
  min_order numeric(12,2) not null default 0 check (min_order >= 0),
  max_discount numeric(12,2) check (max_discount is null or max_discount > 0),
  starts_at timestamptz,
  expires_at timestamptz,
  usage_limit int check (usage_limit is null or usage_limit > 0),
  per_user_limit int check (per_user_limit is null or per_user_limit > 0),
  eligible_product_ids uuid[] not null default '{}',
  eligible_category_ids uuid[] not null default '{}',
  excluded_product_ids uuid[] not null default '{}',
  stackable boolean not null default false,
  is_public boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint coupons_percent_max check (discount_type <> 'percent' or discount_value <= 100)
);

create or replace function public._coupons_before()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.code := upper(btrim(new.code));
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists coupons_before on public.coupons;
create trigger coupons_before before insert or update on public.coupons
  for each row execute function public._coupons_before();

create table if not exists public.product_coupons (
  product_id uuid not null references public.products (id) on delete cascade,
  coupon_id uuid not null references public.coupons (id) on delete cascade,
  primary key (product_id, coupon_id)
);

create table if not exists public.videos (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 200),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,159}$'),
  description text,
  kind text not null default 'tutorial' check (kind in ('tutorial', 'promo')),
  category text,
  video_url text not null check (video_url ~ '^https://'),
  thumbnail_url text,
  duration text,
  published boolean not null default false,
  sort int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.apps (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 150),
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{0,159}$'),
  version text,
  icon_url text,
  description text,
  file_size_bytes bigint check (file_size_bytes is null or file_size_bytes >= 0),
  platform text default 'Android',
  download_url text check (download_url is null or download_url ~ '^https://'),
  storage_path text check (storage_path is null or (storage_path !~ '\.\.' and storage_path !~ '^/')),
  changelog text,
  category text,
  verification_status text not null default 'unverified' check (verification_status in ('unverified', 'scanned_clean', 'verified', 'quarantined')),
  sha256 text check (sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),
  is_third_party boolean not null default false,
  developer text,
  license_note text,
  published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ads (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 200),
  image_url text,
  video_url text,
  link_url text check (link_url is null or link_url ~ '^https://[^\s]+$'),
  placement text not null default 'home_mid' check (placement in ('home_hero', 'home_mid', 'home_bottom', 'products_top', 'sidebar', 'ads_page')),
  starts_at timestamptz,
  ends_at timestamptz,
  enabled boolean not null default true,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  sort int not null default 0,
  created_at timestamptz not null default now()
);

drop trigger if exists videos_touch on public.videos;
create trigger videos_touch before update on public.videos for each row execute function public._touch_updated_at();
drop trigger if exists apps_touch on public.apps;
create trigger apps_touch before update on public.apps for each row execute function public._touch_updated_at();

create table if not exists public.wishlist (
  user_id uuid not null references public.profiles (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

create table if not exists public.recently_viewed (
  user_id uuid not null references public.profiles (id) on delete cascade,
  product_id uuid not null references public.products (id) on delete cascade,
  viewed_at timestamptz not null default now(),
  primary key (user_id, product_id)
);

-- ---------------------------------------------------------------------------
-- Orders
-- ---------------------------------------------------------------------------
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  order_code text not null unique,
  user_id uuid not null references public.profiles (id),
  status text not null default 'payment_pending' check (status in (
    'payment_pending', 'payment_submitted', 'under_verification', 'payment_verified', 'order_confirmed',
    'processing', 'shipped', 'delivered', 'return_requested', 'return_approved', 'refund_processing',
    'refund_completed', 'order_cancelled', 'order_rejected', 'payment_rejected')),
  payment_status text not null default 'pending' check (payment_status in ('pending', 'submitted', 'under_verification', 'verified', 'rejected')),
  subtotal numeric(12,2) not null default 0,
  product_discount numeric(12,2) not null default 0,
  coupon_discount numeric(12,2) not null default 0,
  wallet_used numeric(12,2) not null default 0 check (wallet_used >= 0),
  total numeric(12,2) not null default 0 check (total >= 0),
  coupon_codes text[] not null default '{}',
  ship_name text,
  ship_phone text,
  ship_line1 text,
  ship_line2 text,
  ship_city text,
  ship_state text,
  ship_pincode text,
  customer_note text,
  admin_notes text,
  reject_reason text,
  cancel_reason text,
  paid_at timestamptz,
  confirmed_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  cancelled_at timestamptz,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
create index if not exists orders_user_idx on public.orders (user_id, created_at desc);
create index if not exists orders_status_idx on public.orders (status, created_at desc);

create table if not exists public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  product_id uuid references public.products (id) on delete set null,
  product_name text not null,
  product_image text,
  unit_price numeric(12,2) not null,
  original_unit_price numeric(12,2),
  qty int not null check (qty between 1 and 20),
  line_total numeric(12,2) not null,
  product_discount numeric(12,2) not null default 0,
  coupon_discount numeric(12,2) not null default 0
);
create index if not exists order_items_order_idx on public.order_items (order_id);

create table if not exists public.order_events (
  id bigserial primary key,
  order_id uuid not null references public.orders (id),
  from_status text,
  to_status text,
  note text,
  is_internal boolean not null default false,
  actor_id uuid,
  actor_role text,
  created_at timestamptz not null default now()
);
create index if not exists order_events_order_idx on public.order_events (order_id, id);

create table if not exists public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.coupons (id),
  user_id uuid not null references public.profiles (id),
  order_id uuid not null references public.orders (id),
  discount_amount numeric(12,2) not null default 0,
  created_at timestamptz not null default now(),
  voided boolean not null default false
);
create index if not exists coupon_redemptions_coupon_idx on public.coupon_redemptions (coupon_id) where not voided;
create index if not exists coupon_redemptions_user_idx on public.coupon_redemptions (user_id, coupon_id) where not voided;

-- ---------------------------------------------------------------------------
-- Payments
-- ---------------------------------------------------------------------------
create table if not exists public.payment_submissions (
  id uuid primary key default gen_random_uuid(),
  submission_code text not null unique,
  order_id uuid not null references public.orders (id),
  user_id uuid not null references public.profiles (id),
  utr text not null,
  utr_normalized text not null check (utr_normalized ~ '^[A-Z0-9]{12,22}$'),
  amount numeric(12,2) not null,
  screenshot_path text,
  status text not null default 'submitted' check (status in ('submitted', 'under_verification', 'verified', 'rejected')),
  admin_notes text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  idempotency_key text,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);
-- one UTR can never back two live submissions
create unique index if not exists payment_submissions_utr_live_uidx
  on public.payment_submissions (utr_normalized) where status <> 'rejected';
create index if not exists payment_submissions_order_idx on public.payment_submissions (order_id, created_at desc);
create index if not exists payment_submissions_status_idx on public.payment_submissions (status, created_at desc);

create table if not exists public.duplicate_utr_attempts (
  id bigserial primary key,
  utr_normalized text not null,
  user_id uuid,
  order_id uuid,
  existing_submission_id uuid,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Returns / cancellations
-- ---------------------------------------------------------------------------
create table if not exists public.returns (
  id uuid primary key default gen_random_uuid(),
  return_code text not null unique,
  order_id uuid not null references public.orders (id),
  user_id uuid not null references public.profiles (id),
  kind text not null default 'return' check (kind in ('return', 'cancellation')),
  reason text,
  description text,
  photos text[] not null default '{}',
  refund_preference text not null default 'original' check (refund_preference in ('original', 'wallet')),
  status text not null default 'return_requested' check (status in (
    'return_requested', 'under_review', 'return_approved', 'return_rejected', 'item_awaited',
    'item_received', 'refund_processing', 'wallet_credited', 'refund_completed')),
  eligible_amount numeric(12,2) check (eligible_amount is null or eligible_amount >= 0),
  reject_reason text,
  admin_notes text,
  prev_order_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists returns_one_open_per_order
  on public.returns (order_id) where status not in ('return_rejected', 'wallet_credited', 'refund_completed');
drop trigger if exists returns_touch on public.returns;
create trigger returns_touch before update on public.returns for each row execute function public._touch_updated_at();

-- ---------------------------------------------------------------------------
-- Contact, newsletter, affiliate clicks
-- ---------------------------------------------------------------------------
create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  mobile text,
  subject text,
  message text not null,
  status text not null default 'new' check (status in ('new', 'read', 'closed')),
  created_at timestamptz not null default now()
);

create table if not exists public.newsletter_subscribers (
  email text primary key,
  created_at timestamptz not null default now(),
  confirmed boolean not null default false
);

create table if not exists public.affiliate_clicks (
  id bigserial primary key,
  product_id uuid references public.products (id) on delete set null,
  user_id uuid,
  created_at timestamptz not null default now()
);

drop trigger if exists orders_touch on public.orders;
create trigger orders_touch before update on public.orders for each row execute function public._touch_updated_at();
