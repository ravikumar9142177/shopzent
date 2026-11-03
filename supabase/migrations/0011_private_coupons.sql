-- 0011 — Coupons are private (owner's decision, 4 Nov 2026).
-- No coupon code may be listed to visitors or customers. Customers only know a code the owner tells them and
-- type it at checkout, where quote_cart / create_order validate that ONE typed code server-side.
--   * every coupon is set is_public = false (existing projects that ran an older seed are fixed too);
--   * public_coupons() is kept for API compatibility but always returns an empty list;
--   * the coupons table itself stays readable/writable by admins only (RLS policy coupons_admin, aal2).
-- Safe to re-run.

update public.coupons set is_public = false where is_public;
alter table public.coupons alter column is_public set default false;

create or replace function public.public_coupons()
returns table (code text, description text, discount_type text, discount_value numeric, min_order numeric, max_discount numeric, expires_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- Coupons are private: nothing is ever listed. (Kept so older frontends don't break.)
  select c.code, c.description, c.discount_type, c.discount_value, c.min_order, c.max_discount, c.expires_at
  from public.coupons c
  where false;
$$;
revoke all on function public.public_coupons() from public;
grant execute on function public.public_coupons() to anon, authenticated;
