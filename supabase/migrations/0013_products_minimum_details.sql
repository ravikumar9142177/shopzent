-- 0013_products_minimum_details.sql
-- A product saves with only a Name. Price, buy link, image, description, category, brand,
-- video, slug and flags are all optional.
--  * Drop the two rules that forced a price (direct) or a buy link (affiliate). Checkout stays
--    safe: _price_cart already refuses any product with no price (price is not null and > 0),
--    so a product without a price can never be ordered; the storefront shows "See price".
--  * Blank links are stored as NULL, never "" (an empty video/affiliate link used to break saving).
--  * The slug is generated from the name when blank and made unique with a short suffix.
-- RLS is unchanged: only is_admin() (aal2) may write products; anon reads published rows only.

alter table public.products drop constraint if exists products_direct_needs_price;
alter table public.products drop constraint if exists products_affiliate_needs_url;

create or replace function public._products_before()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_base text;
  v_try int := 0;
begin
  new.video_url := nullif(btrim(coalesce(new.video_url, '')), '');
  new.affiliate_url := nullif(btrim(coalesce(new.affiliate_url, '')), '');
  new.images := coalesce(new.images, '[]'::jsonb);
  new.specs := coalesce(new.specs, '{}'::jsonb);

  if new.slug is null or btrim(new.slug) = '' then
    if tg_op = 'UPDATE' and old.slug is not null then
      new.slug := old.slug;
    else
      v_base := left(regexp_replace(regexp_replace(lower(coalesce(new.name, '')), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'), 150);
      if v_base = '' then v_base := 'product'; end if;
      new.slug := v_base;
      while exists (select 1 from public.products p where p.slug = new.slug and p.id <> new.id) and v_try < 20 loop
        new.slug := v_base || '-' || substr(md5(random()::text || clock_timestamp()::text), 1, 4);
        v_try := v_try + 1;
      end loop;
    end if;
  end if;

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

revoke all on function public._products_before() from public, anon, authenticated;
