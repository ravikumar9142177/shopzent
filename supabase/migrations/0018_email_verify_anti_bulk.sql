-- 0018_email_verify_anti_bulk.sql
-- Email verification (no SMS OTP) + anti-bulk / anti-fake-order rules. Everything is enforced in the database;
-- the website only explains the rules. All numbers are editable in Admin → Settings → Order rules.
-- Owner's rule (2026-11-04): light and invisible to genuine customers. ON: email must be confirmed
-- (auth.users.email_confirmed_at) before ordering; disposable email domains blocked.
-- OFF by default (0 = off), each an admin switch in Settings → Order rules:
--  * max unpaid orders at a time (suggested 3)
--  * auto-cancel orders with NO UTR submitted after N minutes (suggested 120; pg_cron runs every 5 min and does nothing at 0);
--    cancelling returns the wallet amount + coupon use (stock is never reserved by an unpaid order)
--  * min account age (minutes), max qty of one product per order, max order value per customer per day (₹)
--  * disposable email domains blocked at signup (Before-User-Created auth hook) and again at order time
--  * Admin → Users: "Suspicious" flags (automatic + manual) and Block/Unblock (blocked = cannot log in or order)
-- Existing rules stay: orders/day limit, cancellation penalty, duplicate UTR checks, phone (+91, unique) required.

-- ---------- settings defaults ----------
update public.site_settings
   set value = jsonb_build_object('max_unpaid_orders', 0, 'unpaid_cancel_minutes', 0,
                                  'max_qty_per_product', 0, 'max_order_value_per_day', 0, 'min_account_age_minutes', 0,
                                  'block_disposable_email', true) || value
 where key = 'order_rules';
-- owner's decision 2026-11-04: only email verification + disposable-email block are on; the rest start OFF
update public.site_settings
   set value = value || jsonb_build_object('max_unpaid_orders', 0, 'unpaid_cancel_minutes', 0, 'min_account_age_minutes', 0,
                                           'max_qty_per_product', 0, 'max_order_value_per_day', 0)
 where key = 'order_rules';

insert into public.site_settings (key, value, is_public)
values ('blocked_email_domains', jsonb_build_object('domains', $DOM$mailinator.com
yopmail.com
yopmail.net
guerrillamail.com
guerrillamail.net
guerrillamail.org
guerrillamailblock.com
sharklasers.com
grr.la
pokemail.net
spam4.me
10minutemail.com
10minutemail.net
temp-mail.org
temp-mail.io
tempmail.com
tempmail.net
tempmailo.com
tempmail.plus
tmpmail.org
tmpmail.net
tempinbox.com
throwawaymail.com
trashmail.com
trashmail.de
getnada.com
nada.email
dispostable.com
maildrop.cc
mohmal.com
emailondeck.com
fakeinbox.com
mintemail.com
mailnesia.com
mytemp.email
burnermail.io
mail.tm
1secmail.com
1secmail.org
1secmail.net
emailnator.com
tempr.email
discard.email
inboxkitten.com
mailcatch.com
moakt.com
minuteinbox.com
spamgourmet.com
mailpoof.com
tempail.com
fakemail.net
emailfake.com$DOM$), false)
on conflict (key) do nothing;

-- ---------- helpers ----------
create or replace function public._rule_num(p_field text, p_default numeric)
returns numeric language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(case when public._setting('order_rules', p_field) ~ '^\d{1,9}(\.\d{1,2})?$'
                       then public._setting('order_rules', p_field)::numeric end, p_default);
$$;

create or replace function public._is_disposable_email(p_email text)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_dom text := lower(btrim(split_part(coalesce(p_email, ''), '@', 2)));
  v_list text;
begin
  if v_dom = '' then return false; end if;
  if coalesce(public._setting('order_rules', 'block_disposable_email'), 'true') = 'false' then return false; end if;
  select s.value ->> 'domains' into v_list from public.site_settings s where s.key = 'blocked_email_domains';
  return exists (
    select 1 from regexp_split_to_table(lower(coalesce(v_list, '')), '[\s,;]+') d
    where d <> '' and (v_dom = d or v_dom like '%.' || d));
end;
$$;
revoke all on function public._is_disposable_email(text) from public, anon, authenticated;
revoke all on function public._rule_num(text, numeric) from public, anon, authenticated;

-- ---------- signup: Before-User-Created auth hook (blocks disposable email domains) ----------
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if public._is_disposable_email(event -> 'user' ->> 'email') then
    return jsonb_build_object('error', jsonb_build_object('http_code', 400,
      'message', 'Temporary/disposable email addresses are not allowed. Please use your real email (Gmail etc.).'));
  end if;
  return '{}'::jsonb;
end;
$$;
revoke all on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;

-- ---------- manual suspicious flag (admin only; RLS on, no policies → only SECURITY DEFINER RPCs) ----------
create table if not exists public.user_flags (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  suspicious boolean not null default false,
  note text,
  flagged_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.user_flags enable row level security;
revoke all on public.user_flags from anon, authenticated;

-- ---------- order guard (BEFORE INSERT on orders; create_order cannot bypass it) ----------
create or replace function public._order_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $function$
declare
  v_phone text; v_ver timestamptz; v_max int; v_n int; v_status text;
  v_email text; v_confirmed timestamptz; v_created timestamptz; v_age numeric; v_cap numeric; v_today numeric;
begin
  perform pg_advisory_xact_lock(hashtextextended('order_guard|' || new.user_id::text, 0));
  select p.phone, p.phone_verified_at, p.status into v_phone, v_ver, v_status from public.profiles p where p.id = new.user_id;
  if v_status is distinct from 'active' then raise exception 'account_suspended'; end if;
  select u.email, u.email_confirmed_at, u.created_at into v_email, v_confirmed, v_created from auth.users u where u.id = new.user_id;
  if v_confirmed is null then raise exception 'email_not_confirmed'; end if;
  if public._is_disposable_email(v_email) then raise exception 'disposable_email'; end if;
  v_age := public._rule_num('min_account_age_minutes', 0);
  if v_age > 0 and v_created > now() - make_interval(mins => v_age::int) then
    raise exception 'account_too_new' using detail = ceil(extract(epoch from (v_created + make_interval(mins => v_age::int) - now())) / 60)::text;
  end if;
  if coalesce(public._setting('order_rules', 'require_phone'), 'true')::boolean then
    if v_phone is null then raise exception 'phone_required'; end if;
    if coalesce(public._setting('order_rules', 'require_phone_verified'), 'false')::boolean and v_ver is null then
      raise exception 'phone_not_verified';
    end if;
  end if;
  if exists (select 1 from public.customer_dues d where d.user_id = new.user_id and d.cleared_at is null) then
    raise exception 'dues_pending';
  end if;
  v_max := coalesce(public._setting('order_rules', 'max_orders_per_day'), '10')::int;
  select count(*) into v_n from public.orders o where o.user_id = new.user_id and o.created_at >= public._today_ist_start();
  if v_n >= v_max then raise exception 'daily_order_limit'; end if;
  if new.payment_status <> 'verified' then
    select count(*) into v_n from public.orders o
     where o.user_id = new.user_id and o.status in ('payment_pending', 'payment_rejected') and o.payment_status <> 'verified';
    if public._rule_num('max_unpaid_orders', 0) > 0 and v_n >= public._rule_num('max_unpaid_orders', 0) then
      raise exception 'too_many_unpaid_orders' using detail = public._rule_num('max_unpaid_orders', 0)::int::text;
    end if;
  end if;
  v_cap := public._rule_num('max_order_value_per_day', 0);
  if v_cap > 0 then
  select coalesce(sum(o.total + o.wallet_used), 0) into v_today from public.orders o
   where o.user_id = new.user_id and o.created_at >= public._today_ist_start()
     and o.status not in ('order_cancelled', 'order_rejected', 'payment_rejected', 'refund_completed');
  if v_today + new.total + new.wallet_used > v_cap then
    raise exception 'daily_value_limit' using detail = v_cap::text;
  end if;
  end if;
  return new;
end;
$function$;

-- ---------- quantity cap per product per order (in the shared pricing function, so cart quote and order agree) ----------
CREATE OR REPLACE FUNCTION public._price_cart(p_items jsonb, p_coupon text, p_user uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_el jsonb;
  v_pid uuid;
  v_qty int;
  v_idx int;
  a_pid uuid[] := '{}';
  a_qty int[] := '{}';
  a_base numeric[] := '{}';
  a_pd numeric[] := '{}';
  a_cd numeric[] := '{}';
  a_pd_final numeric[];
  a_elig boolean[] := '{}';
  a_combine boolean[] := '{}';
  a_maxpct numeric[] := '{}';
  a_cbase numeric[] := '{}';
  a_prod jsonb[] := '{}';
  v_p public.products;
  v_c public.coupons;
  v_n int;
  i int;
  v_subtotal numeric := 0;
  v_pd_total numeric := 0;
  v_cd_total numeric := 0;
  v_code text;
  v_status text := null;
  v_used int;
  v_sum_cbase numeric;
  v_fixed numeric;
  v_last int;
  v_alloc numeric;
  v_cap numeric;
  v_lines jsonb := '[]'::jsonb;
  v_coupon_json jsonb := null;
  v_maxq int := public._rule_num('max_qty_per_product', 0)::int;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'invalid_input';
  end if;
  if jsonb_array_length(p_items) = 0 then
    raise exception 'cart_empty';
  end if;
  if jsonb_array_length(p_items) > 50 then
    raise exception 'invalid_input';
  end if;

  -- 1) validate + merge lines
  for v_el in select e from jsonb_array_elements(p_items) e loop
    if jsonb_typeof(v_el) <> 'object' then
      raise exception 'invalid_input';
    end if;
    begin
      v_pid := (v_el ->> 'product_id')::uuid;
    exception when others then
      raise exception 'invalid_input';
    end;
    if v_pid is null or coalesce(v_el ->> 'qty', '') !~ '^[0-9]{1,3}$' then
      raise exception 'invalid_input';
    end if;
    v_qty := (v_el ->> 'qty')::int;
    if v_qty < 1 or v_qty > 20 then
      raise exception 'invalid_input';
    end if;
    v_idx := array_position(a_pid, v_pid);
    if v_idx is null then
      a_pid := a_pid || v_pid;
      a_qty := a_qty || v_qty;
    else
      a_qty[v_idx] := a_qty[v_idx] + v_qty;
      if a_qty[v_idx] > 20 then
        raise exception 'invalid_input';
      end if;
    end if;
  end loop;
  v_n := cardinality(a_pid);
  -- anti-bulk: max quantity of one product in one order (Admin → Settings → Order rules)
  for i in 1 .. v_n loop
    if v_maxq > 0 and a_qty[i] > v_maxq then
      raise exception 'max_qty_per_product' using detail = v_maxq::text;
    end if;
  end loop;

  -- 2) load products, base + product discount
  for i in 1 .. v_n loop
    select * into v_p from public.products p
    where p.id = a_pid[i] and p.published and p.purchase_type = 'direct'
      and p.availability in ('in_stock', 'preorder') and p.price is not null and p.price > 0;
    if not found then
      raise exception 'product_unavailable' using detail = a_pid[i]::text;
    end if;
    if v_p.stock_qty is not null and a_qty[i] > v_p.stock_qty then
      raise exception 'insufficient_stock' using detail = a_pid[i]::text;
    end if;
    a_base := a_base || round(v_p.price * a_qty[i], 2);
    if v_p.product_discount_percent > 0 and (v_p.offer_expires_at is null or v_p.offer_expires_at > now()) then
      a_pd := a_pd || least(round(v_p.price * a_qty[i] * v_p.product_discount_percent / 100, 2),
                            round(v_p.price * a_qty[i] * v_p.max_discount_percent / 100, 2));
    else
      a_pd := a_pd || 0::numeric;
    end if;
    a_cd := a_cd || 0::numeric;
    a_elig := a_elig || false;
    a_combine := a_combine || v_p.allow_combine;
    a_maxpct := a_maxpct || v_p.max_discount_percent;
    a_cbase := a_cbase || 0::numeric;
    a_prod := a_prod || jsonb_build_object(
      'product_id', v_p.id, 'name', v_p.name,
      'image', case when jsonb_typeof(v_p.images) = 'array' then v_p.images ->> 0 else null end,
      'unit_price', v_p.price, 'original_unit_price', coalesce(v_p.original_price, v_p.price),
      'category_id', v_p.category_id, 'coupon_eligibility', v_p.coupon_eligibility);
  end loop;

  for i in 1 .. v_n loop
    v_subtotal := v_subtotal + a_base[i];
    v_pd_total := v_pd_total + a_pd[i];
  end loop;

  -- 3) coupon
  v_code := upper(btrim(coalesce(p_coupon, '')));
  if v_code <> '' then
    select * into v_c from public.coupons c where c.code = v_code;
    if not found then
      v_status := 'invalid';
    elsif not v_c.active then
      v_status := 'inactive';
    elsif v_c.starts_at is not null and v_c.starts_at > now() then
      v_status := 'not_started';
    elsif v_c.expires_at is not null and v_c.expires_at <= now() then
      v_status := 'expired';
    end if;
    if v_status is null and v_c.usage_limit is not null then
      select count(*) into v_used from public.coupon_redemptions r where r.coupon_id = v_c.id and not r.voided;
      if v_used >= v_c.usage_limit then
        v_status := 'exhausted';
      end if;
    end if;
    if v_status is null and v_c.per_user_limit is not null then
      if p_user is null then
        v_status := 'login_required';
      else
        select count(*) into v_used from public.coupon_redemptions r
        where r.coupon_id = v_c.id and r.user_id = p_user and not r.voided;
        if v_used >= v_c.per_user_limit then
          v_status := 'user_limit';
        end if;
      end if;
    end if;
    if v_status is null then
      -- eligibility per line
      for i in 1 .. v_n loop
        a_elig[i] :=
          (a_prod[i] ->> 'coupon_eligibility') <> 'no'
          and ((a_prod[i] ->> 'coupon_eligibility') = 'yes'
               or exists (select 1 from public.product_coupons pc where pc.product_id = a_pid[i] and pc.coupon_id = v_c.id))
          and ((cardinality(v_c.eligible_product_ids) = 0 and cardinality(v_c.eligible_category_ids) = 0)
               or a_pid[i] = any (v_c.eligible_product_ids)
               or (nullif(a_prod[i] ->> 'category_id', '')::uuid = any (v_c.eligible_category_ids)))
          and not (a_pid[i] = any (v_c.excluded_product_ids));
      end loop;
      if not (true = any (a_elig)) then
        v_status := 'not_applicable';
      elsif (v_subtotal - v_pd_total) < v_c.min_order then
        v_status := 'min_order';
      end if;
    end if;

    if v_status is null then
      a_pd_final := a_pd;
      v_sum_cbase := 0;
      for i in 1 .. v_n loop
        if a_elig[i] then
          a_cbase[i] := case when a_combine[i] then a_base[i] - a_pd[i] else a_base[i] end;
          v_sum_cbase := v_sum_cbase + a_cbase[i];
          v_last := i;
        end if;
      end loop;
      if v_c.discount_type = 'percent' then
        for i in 1 .. v_n loop
          if a_elig[i] then
            a_cd[i] := round(a_cbase[i] * v_c.discount_value / 100, 2);
          end if;
        end loop;
      elsif v_sum_cbase > 0 then
        v_fixed := least(v_c.discount_value, v_sum_cbase);
        v_alloc := 0;
        for i in 1 .. v_n loop
          if a_elig[i] then
            if i = v_last then
              a_cd[i] := v_fixed - v_alloc;
            else
              a_cd[i] := round(v_fixed * a_cbase[i] / v_sum_cbase, 2);
              v_alloc := v_alloc + a_cd[i];
            end if;
          end if;
        end loop;
      end if;
      -- no combining: keep whichever discount is larger on that line
      for i in 1 .. v_n loop
        if a_elig[i] and not a_combine[i] and a_pd[i] > 0 then
          if a_cd[i] > a_pd[i] then
            a_pd_final[i] := 0;
          else
            a_cd[i] := 0;
          end if;
        end if;
      end loop;
      -- coupon max_discount (scale down proportionally)
      v_cd_total := 0;
      for i in 1 .. v_n loop v_cd_total := v_cd_total + a_cd[i]; end loop;
      if v_c.max_discount is not null and v_cd_total > v_c.max_discount then
        v_alloc := 0;
        v_last := null;
        for i in 1 .. v_n loop if a_cd[i] > 0 then v_last := i; end if; end loop;
        for i in 1 .. v_n loop
          if a_cd[i] > 0 then
            if i = v_last then
              a_cd[i] := v_c.max_discount - v_alloc;
            else
              a_cd[i] := round(a_cd[i] * v_c.max_discount / v_cd_total, 2);
              v_alloc := v_alloc + a_cd[i];
            end if;
          end if;
        end loop;
      end if;
      -- per-product cap on total discount
      for i in 1 .. v_n loop
        v_cap := round(a_base[i] * a_maxpct[i] / 100, 2);
        if a_pd_final[i] > v_cap then a_pd_final[i] := v_cap; end if;
        if a_pd_final[i] + a_cd[i] > v_cap then a_cd[i] := greatest(v_cap - a_pd_final[i], 0); end if;
      end loop;
      v_cd_total := 0;
      for i in 1 .. v_n loop v_cd_total := v_cd_total + a_cd[i]; end loop;
      if v_cd_total <= 0 then
        v_status := 'not_applicable';
        for i in 1 .. v_n loop a_cd[i] := 0; end loop;
        v_cd_total := 0;
      else
        v_status := 'ok';
        a_pd := a_pd_final;
        v_pd_total := 0;
        for i in 1 .. v_n loop v_pd_total := v_pd_total + a_pd[i]; end loop;
      end if;
    else
      for i in 1 .. v_n loop a_cd[i] := 0; end loop;
      v_cd_total := 0;
    end if;

    v_coupon_json := jsonb_build_object(
      'code', v_code,
      'valid', v_status = 'ok',
      'code_status', v_status,
      'message', public._coupon_message(v_status, v_c, v_cd_total),
      'discount_type', case when v_c.id is not null and v_status not in ('invalid') then v_c.discount_type end,
      'discount_value', case when v_c.id is not null and v_status not in ('invalid') then v_c.discount_value end,
      '_coupon_id', v_c.id);
  end if;

  for i in 1 .. v_n loop
    v_lines := v_lines || jsonb_build_object(
      'product_id', a_pid[i],
      'name', a_prod[i] ->> 'name',
      'image', a_prod[i] ->> 'image',
      'qty', a_qty[i],
      'unit_price', (a_prod[i] ->> 'unit_price')::numeric,
      'original_unit_price', (a_prod[i] ->> 'original_unit_price')::numeric,
      'line_subtotal', a_base[i],
      'product_discount', a_pd[i],
      'coupon_discount', a_cd[i],
      'line_total', a_base[i] - a_pd[i] - a_cd[i]);
  end loop;

  return jsonb_build_object(
    'lines', v_lines,
    'subtotal', round(v_subtotal, 2),
    'product_discount', round(v_pd_total, 2),
    'coupon_discount', round(v_cd_total, 2),
    'total', round(v_subtotal - v_pd_total - v_cd_total, 2),
    'coupon', v_coupon_json);
end;
$function$;

-- ---------- what the checkout page shows before the customer fills the form ----------
create or replace function public.my_order_eligibility()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid(); v_u record; v_p public.profiles; v_age numeric; v_ready timestamptz; v_unpaid int;
begin
  if v_uid is null then raise exception 'login_required'; end if;
  select u.email, u.email_confirmed_at, u.created_at into v_u from auth.users u where u.id = v_uid;
  select * into v_p from public.profiles where id = v_uid;
  v_age := public._rule_num('min_account_age_minutes', 0);
  v_ready := v_u.created_at + make_interval(mins => v_age::int);
  select count(*) into v_unpaid from public.orders o
   where o.user_id = v_uid and o.status in ('payment_pending', 'payment_rejected') and o.payment_status <> 'verified';
  return jsonb_build_object(
    'email', v_u.email,
    'email_confirmed', v_u.email_confirmed_at is not null,
    'blocked', coalesce(v_p.status, 'active') <> 'active',
    'disposable_email', public._is_disposable_email(v_u.email),
    'account_ready_at', v_ready,
    'minutes_to_wait', greatest(0, ceil(extract(epoch from (v_ready - now())) / 60))::int,
    'phone_set', v_p.phone is not null,
    'unpaid_orders', v_unpaid,
    'max_unpaid_orders', public._rule_num('max_unpaid_orders', 0)::int,
    'max_qty_per_product', public._rule_num('max_qty_per_product', 0)::int,
    'max_order_value_per_day', public._rule_num('max_order_value_per_day', 0));
end;
$$;
revoke all on function public.my_order_eligibility() from public, anon;
grant execute on function public.my_order_eligibility() to authenticated;

-- ---------- auto-cancel unpaid orders (pg_cron every 5 minutes) ----------
create or replace function public.auto_cancel_unpaid_orders()
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_o public.orders; v_n int := 0;
  v_mins numeric := public._rule_num('unpaid_cancel_minutes', 0);
  v_note text;
begin
  for v_o in
    select * from public.orders o
     where v_mins > 0
       and o.status = 'payment_pending' and o.payment_status = 'pending'
       and o.created_at < now() - make_interval(mins => greatest(v_mins, 10)::int)
       and not exists (select 1 from public.payment_submissions s where s.order_id = o.id)  -- a UTR was never submitted
     order by o.created_at
     limit 500
     for update skip locked
  loop
    v_note := 'Payment nahi mila (' || v_mins::int || ' min), isliye order apne aap cancel ho gaya. Aap dobara order kar sakte ho.';
    update public.orders set cancel_reason = v_note where id = v_o.id;
    perform public._order_release(v_o.id, 'order auto-cancelled');
    perform public._set_order_status(v_o.id, 'order_cancelled', v_note);
    perform public._audit('order_auto_cancelled', 'orders', v_o.id::text,
                          jsonb_build_object('order_code', v_o.order_code, 'user_id', v_o.user_id, 'was', v_o.status));
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.auto_cancel_unpaid_orders() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'shopzent-auto-cancel-unpaid';
select cron.schedule('shopzent-auto-cancel-unpaid', '*/5 * * * *', 'select public.auto_cancel_unpaid_orders()');

-- ---------- block = suspend in the shop + ban at login + sign out everywhere ----------
create or replace function public.admin_set_user_status(p_user_id uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $function$
declare
  v_p public.profiles;
begin
  perform public._require_admin();
  p_reason := btrim(coalesce(p_reason, ''));
  if p_status not in ('active', 'suspended') then
    raise exception 'invalid_input';
  end if;
  if char_length(p_reason) not between 3 and 500 then
    raise exception 'reason_required';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'cannot_change_self';
  end if;
  select * into v_p from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_p.role in ('admin', 'super_admin') and not public.is_super_admin() then
    raise exception 'not_authorized';
  end if;
  if p_status = 'suspended' and v_p.role = 'super_admin'
     and (select count(*) from public.profiles where role = 'super_admin' and status = 'active' and id <> p_user_id) = 0 then
    raise exception 'last_super_admin';
  end if;
  update public.profiles set status = p_status where id = p_user_id returning * into v_p;
  if p_status = 'suspended' then
    update auth.users set banned_until = 'infinity' where id = p_user_id;
    delete from auth.sessions where user_id = p_user_id;          -- signs the user out on every device
  else
    update auth.users set banned_until = null where id = p_user_id;
  end if;
  perform public._audit('user_status_change', 'profiles', p_user_id::text, jsonb_build_object('status', p_status, 'reason', p_reason));
  return jsonb_build_object('id', v_p.id, 'role', v_p.role, 'status', v_p.status);
end;
$function$;

create or replace function public.admin_flag_user(p_user_id uuid, p_suspicious boolean, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin();
  if p_suspicious is null or char_length(coalesce(p_note, '')) > 300 then raise exception 'invalid_input'; end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then raise exception 'not_found'; end if;
  insert into public.user_flags (user_id, suspicious, note, flagged_by, updated_at)
  values (p_user_id, p_suspicious, nullif(btrim(coalesce(p_note, '')), ''), auth.uid(), now())
  on conflict (user_id) do update set suspicious = excluded.suspicious, note = excluded.note, flagged_by = excluded.flagged_by, updated_at = now();
  perform public._audit('user_flag', 'profiles', p_user_id::text, jsonb_build_object('suspicious', p_suspicious, 'note', p_note));
  return jsonb_build_object('id', p_user_id, 'suspicious', p_suspicious);
end;
$$;
revoke all on function public.admin_flag_user(uuid, boolean, text) from public, anon;
grant execute on function public.admin_flag_user(uuid, boolean, text) to authenticated;

-- reasons a customer looks suspicious (computed live, never stored, so nothing can be "forgotten")
create or replace function public._user_flags(p_uid uuid)
returns text[] language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  r text[] := '{}'; v_email text; v_n int; v_f public.user_flags;
begin
  select * into v_f from public.user_flags where user_id = p_uid;
  if v_f.suspicious then r := r || ('Marked by admin' || coalesce(': ' || v_f.note, '')); end if;
  select email into v_email from auth.users where id = p_uid;
  if public._is_disposable_email(v_email) then r := r || 'Disposable email'::text; end if;
  select count(*) into v_n from public.audit_log a where a.action = 'order_auto_cancelled' and a.details ->> 'user_id' = p_uid::text
     and a.created_at > now() - interval '7 days';
  if v_n >= 3 then r := r || (v_n || ' unpaid orders auto-cancelled (7 days)'); end if;
  select count(*) into v_n from public.payment_submissions s where s.user_id = p_uid and s.status = 'rejected'
     and s.created_at > now() - interval '7 days';
  if v_n >= 2 then r := r || (v_n || ' payments rejected (7 days)'); end if;
  select count(*) into v_n from public.duplicate_utr_attempts d where d.user_id = p_uid;
  if v_n >= 1 then r := r || (v_n || ' duplicate UTR attempt(s)'); end if;
  select count(*) into v_n from public.orders o where o.user_id = p_uid and o.status = 'order_cancelled'
     and o.created_at > now() - interval '7 days';
  if v_n >= 5 then r := r || (v_n || ' cancelled orders (7 days)'); end if;
  if exists (select 1 from public.customer_dues d where d.user_id = p_uid and d.cleared_at is null) then r := r || 'Unpaid dues'::text; end if;
  return r;
end;
$$;
revoke all on function public._user_flags(uuid) from public, anon, authenticated;

drop function if exists public.admin_list_users(text, integer);
create or replace function public.admin_list_users(p_q text default null, p_limit integer default 100, p_suspicious_only boolean default false)
returns setof jsonb language plpgsql stable security definer set search_path = public, pg_temp as $function$
declare
  v_q text := btrim(coalesce(p_q, ''));
begin
  perform public._require_admin();
  return query
  select x.j from (
    select jsonb_build_object('id', p.id, 'customer_id', p.customer_id, 'wallet_id', w.wallet_id, 'full_name', p.full_name,
           'email', p.email, 'mobile', p.mobile, 'phone', p.phone, 'status', p.status, 'role', p.role, 'created_at', p.created_at,
           'email_confirmed', u.email_confirmed_at is not null,
           'orders', (select count(*) from public.orders o where o.user_id = p.id),
           'flags', to_jsonb(public._user_flags(p.id)),
           'marked', coalesce(f.suspicious, false), 'mark_note', f.note) as j, p.created_at
    from public.profiles p
    left join public.wallets w on w.user_id = p.id
    left join auth.users u on u.id = p.id
    left join public.user_flags f on f.user_id = p.id
    where v_q = '' or upper(p.customer_id) = upper(v_q) or upper(w.wallet_id) = upper(v_q)
       or p.email ilike '%' || v_q || '%' or p.mobile like '%' || v_q || '%' or p.full_name ilike '%' || v_q || '%'
  ) x
  where not coalesce(p_suspicious_only, false) or jsonb_array_length(x.j -> 'flags') > 0 or x.j ->> 'status' <> 'active'
  order by (jsonb_array_length(x.j -> 'flags') > 0) desc, x.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$function$;
revoke all on function public.admin_list_users(text, integer, boolean) from public, anon;
grant execute on function public.admin_list_users(text, integer, boolean) to authenticated;

-- ---------- settings validation for the new order rules + private disposable-domain list ----------
CREATE OR REPLACE FUNCTION public.admin_upsert_setting(p_key text, p_value jsonb, p_is_public boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform public._require_admin();
  if p_key is null or p_key !~ '^[a-z][a-z0-9_]{1,40}$' or p_value is null or pg_column_size(p_value) > 200000 then
    raise exception 'invalid_input';
  end if;
  if p_key in ('payment', 'security') then
    perform public._require_super_admin();
    perform public.require_fresh(15);
  end if;
  if p_key = 'security' then
    p_is_public := false;
  end if;
  if p_key = 'domain' then
    -- Admin → Domain: only the Super Admin; a bare domain (no scheme/path) and a GitHub username, both optional
    perform public._require_super_admin();
    if jsonb_typeof(p_value) <> 'object'
       or coalesce(p_value ->> 'domain', '') !~ '^([a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+)?$'
       or coalesce(p_value ->> 'github_user', '') !~ '^([a-z0-9][a-z0-9-]{0,38})?$' then
      raise exception 'invalid_input' using detail = 'domain must look like shopzent.in; github_user letters/digits/dashes';
    end if;
    p_is_public := true;
  end if;
  if p_key = 'payment' then
    if jsonb_typeof(p_value) <> 'object'
       or coalesce(p_value ->> 'upi_id', '') !~ '^([A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9.-]{1,63})?$'
       or coalesce(p_value ->> 'qr_url', '') !~ '^(https://[^\s]+)?$' then
      raise exception 'invalid_input' using detail = 'upi_id must look like name@bank and qr_url must be https';
    end if;
  end if;
  if p_key = 'owner_coins' then
    perform public._require_super_admin();
    perform public.require_fresh(15);
    p_is_public := false;
    if jsonb_typeof(p_value) <> 'object'
       or coalesce(p_value ->> 'monthly_amount', '0') !~ '^\d{1,13}$'
       or coalesce(p_value ->> 'opening_balance', '0') !~ '^\d{1,13}$'
       or coalesce(p_value ->> 'owner_email', 'a@b.c') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception 'invalid_input' using detail = 'monthly_amount: whole number of coins; owner_email: an email';
    end if;
  end if;
  if p_key = 'blocked_email_domains' then
    p_is_public := false;
    if jsonb_typeof(p_value) <> 'object' or char_length(coalesce(p_value ->> 'domains', '')) > 20000
       or exists (select 1 from regexp_split_to_table(lower(coalesce(p_value ->> 'domains', '')), '[\s,;]+') d
                  where d <> '' and d !~ '^[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$') then
      raise exception 'invalid_input' using detail = 'one domain per line, like mailinator.com';
    end if;
  end if;
  if p_key = 'order_rules' then
    p_is_public := true;
    if jsonb_typeof(p_value) <> 'object'
       or coalesce(p_value ->> 'max_orders_per_day', '10') !~ '^\d{1,4}$' or (p_value ->> 'max_orders_per_day')::int < 1
       or coalesce(p_value ->> 'cancel_penalty_after', '5') !~ '^\d{1,3}$'
       or coalesce(p_value ->> 'cancel_penalty_amount', '10') !~ '^\d{1,5}(\.\d{1,2})?$'
       or coalesce(p_value ->> 'require_phone', 'true') not in ('true', 'false')
       or coalesce(p_value ->> 'require_phone_verified', 'false') not in ('true', 'false')
       or coalesce(p_value ->> 'allow_negative_wallet', 'false') not in ('true', 'false')
       or coalesce(p_value ->> 'block_disposable_email', 'true') not in ('true', 'false')
       or coalesce(p_value ->> 'max_unpaid_orders', '0') !~ '^\d{1,3}$'
       or coalesce(p_value ->> 'unpaid_cancel_minutes', '0') !~ '^\d{1,5}$'
       or ((p_value ->> 'unpaid_cancel_minutes') ~ '^\d+$' and (p_value ->> 'unpaid_cancel_minutes')::int between 1 and 9)
       or coalesce(p_value ->> 'min_account_age_minutes', '0') !~ '^\d{1,5}$'
       or coalesce(p_value ->> 'max_qty_per_product', '0') !~ '^\d{1,2}$'
       or coalesce(p_value ->> 'max_order_value_per_day', '0') !~ '^\d{1,9}(\.\d{1,2})?$' then
      raise exception 'invalid_input' using detail = 'order rules: whole numbers (0 = off; orders/day at least 1; auto-cancel 0 or at least 10 minutes; qty up to 20), amounts in rupees, on/off switches';
    end if;
  end if;
  insert into public.site_settings (key, value, is_public, updated_by)
  values (p_key, p_value, coalesce(p_is_public, true), auth.uid())
  on conflict (key) do update set value = excluded.value, is_public = excluded.is_public, updated_by = excluded.updated_by;
  perform public._audit('setting_change', 'site_settings', p_key, jsonb_build_object('key', p_key, 'is_public', coalesce(p_is_public, true)));
end;
$function$;
