-- SHOPZENT 0005: Row Level Security (deny by default), table grants, content audit triggers

-- 1) RLS on for every table in public; start from zero table privileges for API roles.
do $$
declare
  r record;
begin
  for r in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p') loop
    execute format('alter table public.%I enable row level security', r.relname);
    execute format('revoke all on table public.%I from anon, authenticated', r.relname);
  end loop;
end;
$$;
revoke all on all sequences in schema public from anon, authenticated;

-- 2) Table privileges (RLS below decides which rows)
-- public catalogue: read for everyone, writes for authenticated (admins only, by RLS)
grant select on public.categories, public.brands, public.products, public.videos, public.apps, public.ads to anon, authenticated;
grant insert, update, delete on public.categories, public.brands, public.products, public.videos, public.apps, public.ads,
  public.product_coupons, public.coupons to authenticated;
grant select on public.product_coupons, public.coupons to authenticated;
grant select on public.site_settings to anon, authenticated;

-- own data (customers) + admin reads
grant select on public.profiles to authenticated;
grant update (full_name, mobile) on public.profiles to authenticated;
grant select on public.wallets, public.wallet_ledger, public.coin_ledger, public.orders, public.order_items,
  public.order_events, public.payment_submissions, public.returns, public.refund_ledger, public.notifications,
  public.coupon_redemptions to authenticated;
grant select, insert, delete on public.wishlist, public.recently_viewed to authenticated;
grant select on public.audit_log, public.contact_messages, public.newsletter_subscribers, public.affiliate_clicks,
  public.duplicate_utr_attempts, public.coin_settings, public.refund_events to authenticated;
grant update (status) on public.contact_messages to authenticated;
-- no grants at all (service role / definer functions only): rate_limits, idempotency, login_attempts, mfa_recovery_codes

-- 3) Policies (dropped first so this file can be re-run safely)
do $$
declare
  r record;
begin
  for r in select policyname, tablename from pg_policies where schemaname = 'public' loop
    execute format('drop policy if exists %I on public.%I', r.policyname, r.tablename);
  end loop;
end;
$$;
-- catalogue / content
create policy categories_public_read on public.categories for select to anon, authenticated using (published or public.is_admin());
create policy categories_admin_write on public.categories for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy brands_public_read on public.brands for select to anon, authenticated using (published or public.is_admin());
create policy brands_admin_write on public.brands for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy products_public_read on public.products for select to anon, authenticated using (published or public.is_admin());
create policy products_admin_write on public.products for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy product_coupons_admin on public.product_coupons for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy videos_public_read on public.videos for select to anon, authenticated using (published or public.is_admin());
create policy videos_admin_write on public.videos for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy apps_public_read on public.apps for select to anon, authenticated using (published or public.is_admin());
create policy apps_admin_write on public.apps for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy ads_public_read on public.ads for select to anon, authenticated
  using ((enabled and now() >= coalesce(starts_at, '-infinity'::timestamptz) and now() <= coalesce(ends_at, 'infinity'::timestamptz)) or public.is_admin());
create policy ads_admin_write on public.ads for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy coupons_admin on public.coupons for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy site_settings_public_read on public.site_settings for select to anon, authenticated using (is_public or public.is_admin());

-- profiles
create policy profiles_own_read on public.profiles for select to authenticated using (id = auth.uid() or public.is_admin());
create policy profiles_own_update on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- wallet / coins
create policy wallets_own_read on public.wallets for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy wallet_ledger_own_read on public.wallet_ledger for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy coin_ledger_own_read on public.coin_ledger for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy coin_settings_admin_read on public.coin_settings for select to authenticated using (public.is_admin());

-- orders & co.
create policy orders_own_read on public.orders for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy order_items_own_read on public.order_items for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_id and (o.user_id = auth.uid() or public.is_admin())));
create policy order_events_own_read on public.order_events for select to authenticated
  using (public.is_admin() or (not is_internal and exists (select 1 from public.orders o where o.id = order_id and o.user_id = auth.uid())));
create policy payment_submissions_own_read on public.payment_submissions for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy returns_own_read on public.returns for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy refund_ledger_own_read on public.refund_ledger for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy refund_events_admin_read on public.refund_events for select to authenticated using (public.is_admin());
create policy coupon_redemptions_own_read on public.coupon_redemptions for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy duplicate_utr_admin_read on public.duplicate_utr_attempts for select to authenticated using (public.is_admin());

-- notifications
create policy notifications_read on public.notifications for select to authenticated
  using ((audience = 'user' and user_id = auth.uid()) or (audience = 'admin' and public.is_admin()));

-- wishlist / recently viewed (own rows only)
create policy wishlist_own on public.wishlist for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy recently_viewed_own on public.recently_viewed for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- admin-only reads
create policy audit_log_admin_read on public.audit_log for select to authenticated using (public.is_admin());
create policy contact_admin_read on public.contact_messages for select to authenticated using (public.is_admin());
create policy contact_admin_update on public.contact_messages for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy newsletter_admin_read on public.newsletter_subscribers for select to authenticated using (public.is_admin());
create policy affiliate_clicks_admin_read on public.affiliate_clicks for select to authenticated using (public.is_admin());

-- 4) Automatic audit rows for admin content changes
create or replace function public._audit_content()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_changed text[];
  v_id text;
  v_action text;
begin
  if tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    v_action := 'content_insert';
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    select coalesce(array_agg(k order by k), '{}') into v_changed
    from jsonb_object_keys(v_new) k
    where v_new -> k is distinct from v_old -> k
      and k not in ('updated_at', 'view_count', 'impressions', 'clicks');
    if cardinality(v_changed) = 0 then
      return new; -- counters only (views, ad impressions): not an admin edit
    end if;
    v_action := 'content_update';
  else
    v_old := to_jsonb(old);
    v_action := 'content_delete';
  end if;
  v_id := coalesce(v_new ->> 'id', v_old ->> 'id', v_new ->> 'key', v_old ->> 'key',
                   (v_new ->> 'product_id') || ':' || (v_new ->> 'coupon_id'),
                   (v_old ->> 'product_id') || ':' || (v_old ->> 'coupon_id'));
  perform public._audit(v_action, tg_table_name, v_id, jsonb_strip_nulls(jsonb_build_object(
    'changed', v_changed,
    'name', coalesce(v_new ->> 'name', v_new ->> 'title', v_new ->> 'code', v_old ->> 'name', v_old ->> 'title', v_old ->> 'code'),
    'published', v_new -> 'published')));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['products', 'product_coupons', 'categories', 'brands', 'videos', 'apps', 'ads', 'coupons', 'site_settings', 'contact_messages'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public._audit_content()', t || '_audit', t);
  end loop;
end;
$$;
