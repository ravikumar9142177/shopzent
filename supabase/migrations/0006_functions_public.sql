-- SHOPZENT 0006: pricing engine + public / customer RPC functions

-- ---------------------------------------------------------------------------
-- Pricing engine (shared by quote_cart and create_order). Prices always from DB.
-- ---------------------------------------------------------------------------
create or replace function public._coupon_message(p_status text, p_coupon public.coupons, p_saving numeric)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case p_status
    when 'ok' then 'Coupon applied. You save ₹' || to_char(coalesce(p_saving, 0), 'FM999999990.00') || '.'
    when 'invalid' then 'This coupon code is not valid.'
    when 'inactive' then 'This coupon is not active right now.'
    when 'not_started' then 'This coupon is not active yet.'
    when 'expired' then 'This coupon has expired.'
    when 'exhausted' then 'This coupon has reached its usage limit.'
    when 'user_limit' then 'You have already used this coupon the maximum number of times.'
    when 'login_required' then 'Please log in to use this coupon.'
    when 'min_order' then 'This coupon needs a minimum order of ₹' || to_char(coalesce(p_coupon.min_order, 0), 'FM999999990.00') || '.'
    when 'not_applicable' then 'This coupon does not apply to the items in your cart.'
    else 'This coupon cannot be used.'
  end;
$$;

create or replace function public._price_cart(p_items jsonb, p_coupon text, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
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
$$;

create or replace function public.quote_cart(p_items jsonb, p_coupon text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  if coalesce(btrim(p_coupon), '') <> '' then
    perform public.hit_rate_limit('quote_coupon', public._client_key(), 60, 60);
  end if;
  v := public._price_cart(p_items, p_coupon, auth.uid());
  if v -> 'coupon' is not null and jsonb_typeof(v -> 'coupon') = 'object' then
    v := jsonb_set(v, '{coupon}', (v -> 'coupon') - '_coupon_id');
  end if;
  return v;
end;
$$;

create or replace function public.public_coupons()
returns table (code text, description text, discount_type text, discount_value numeric, min_order numeric, max_discount numeric, expires_at timestamptz)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select c.code, c.description, c.discount_type, c.discount_value, c.min_order, c.max_discount, c.expires_at
  from public.coupons c
  where c.active and c.is_public
    and (c.starts_at is null or c.starts_at <= now())
    and (c.expires_at is null or c.expires_at > now())
  order by c.discount_value;
$$;

-- ---------------------------------------------------------------------------
-- Small public endpoints
-- ---------------------------------------------------------------------------
create or replace function public.track_affiliate_click(p_product_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_url text;
begin
  perform public.hit_rate_limit('affiliate_click', public._client_key(), 60, 60);
  select p.affiliate_url into v_url from public.products p
  where p.id = p_product_id and p.published and p.affiliate_url ~ '^https://[^\s]+$';
  if v_url is null then
    raise exception 'not_found';
  end if;
  insert into public.affiliate_clicks (product_id, user_id) values (p_product_id, auth.uid());
  return v_url;
end;
$$;

create or replace function public.track_ad(p_ad_id uuid, p_event text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_ad public.ads;
begin
  if p_event not in ('impression', 'click') then
    raise exception 'invalid_input';
  end if;
  perform public.hit_rate_limit('ad_' || p_event, public._client_key(), 120, 60);
  select * into v_ad from public.ads a
  where a.id = p_ad_id and a.enabled
    and now() >= coalesce(a.starts_at, '-infinity'::timestamptz) and now() <= coalesce(a.ends_at, 'infinity'::timestamptz);
  if not found then
    raise exception 'not_found';
  end if;
  if p_event = 'impression' then
    update public.ads set impressions = impressions + 1 where id = p_ad_id;
    return null;
  end if;
  update public.ads set clicks = clicks + 1 where id = p_ad_id;
  return case when v_ad.link_url ~ '^https://[^\s]+$' then v_ad.link_url else null end;
end;
$$;

create or replace function public.submit_contact(p_name text, p_email text, p_mobile text, p_subject text, p_message text)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid;
begin
  p_name := btrim(coalesce(p_name, ''));
  p_email := lower(btrim(coalesce(p_email, '')));
  p_mobile := nullif(regexp_replace(coalesce(p_mobile, ''), '[\s-]', '', 'g'), '');
  p_subject := nullif(btrim(coalesce(p_subject, '')), '');
  p_message := btrim(coalesce(p_message, ''));
  if char_length(p_name) not between 2 and 100
     or p_email !~ '^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$' or char_length(p_email) > 254
     or (p_mobile is not null and p_mobile !~ '^(\+?91)?[6-9][0-9]{9}$')
     or char_length(coalesce(p_subject, '')) > 150
     or char_length(p_message) not between 5 and 5000 then
    raise exception 'invalid_input';
  end if;
  perform public.hit_rate_limit('contact', public._client_key(), 5, 3600);
  insert into public.contact_messages (name, email, mobile, subject, message)
  values (p_name, p_email, p_mobile, p_subject, p_message) returning id into v_id;
  perform public._notify(null, 'admin', 'New contact message', left(coalesce(p_subject, p_message), 120), '/admin/#messages');
  return v_id;
end;
$$;

create or replace function public.subscribe_newsletter(p_email text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  p_email := lower(btrim(coalesce(p_email, '')));
  if p_email !~ '^[^@\s]{1,64}@[^@\s]+\.[^@\s]{2,}$' or char_length(p_email) > 254 then
    raise exception 'invalid_input';
  end if;
  perform public.hit_rate_limit('newsletter', public._client_key(), 10, 3600);
  insert into public.newsletter_subscribers (email) values (p_email) on conflict (email) do nothing;
  return true; -- same answer whether new or existing (no enumeration)
end;
$$;

-- ---------------------------------------------------------------------------
-- Profile, wishlist, views, wallet, coins
-- ---------------------------------------------------------------------------
create or replace function public.my_profile()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  if auth.uid() is null then
    raise exception 'login_required';
  end if;
  select jsonb_build_object('id', p.id, 'customer_id', p.customer_id, 'wallet_id', w.wallet_id, 'full_name', p.full_name,
         'email', p.email, 'mobile', p.mobile, 'role', p.role, 'status', p.status, 'mfa_required', p.mfa_required,
         'aal', public.current_aal(), 'created_at', p.created_at)
  into v
  from public.profiles p left join public.wallets w on w.user_id = p.id
  where p.id = auth.uid();
  if v is null then
    raise exception 'not_found';
  end if;
  return v;
end;
$$;

create or replace function public.update_my_profile(p_full_name text, p_mobile text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_user();
  p_full_name := btrim(coalesce(p_full_name, ''));
  p_mobile := nullif(regexp_replace(coalesce(p_mobile, ''), '[\s-]', '', 'g'), '');
  if char_length(p_full_name) not between 2 and 100 or p_full_name ~ '[<>]'
     or (p_mobile is not null and p_mobile !~ '^(\+?91)?[6-9][0-9]{9}$') then
    raise exception 'invalid_input';
  end if;
  update public.profiles set full_name = p_full_name, mobile = p_mobile where id = auth.uid();
  return public.my_profile();
end;
$$;

create or replace function public.toggle_wishlist(p_product_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_user();
  delete from public.wishlist where user_id = auth.uid() and product_id = p_product_id;
  if found then
    return false;
  end if;
  if not exists (select 1 from public.products p where p.id = p_product_id and p.published) then
    raise exception 'not_found';
  end if;
  if (select count(*) from public.wishlist where user_id = auth.uid()) >= 500 then
    raise exception 'limit_reached';
  end if;
  insert into public.wishlist (user_id, product_id) values (auth.uid(), p_product_id);
  return true;
end;
$$;

create or replace function public.record_view(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from public.products p where p.id = p_product_id and p.published) then
    return;
  end if;
  perform public.hit_rate_limit('record_view', public._client_key(), 120, 60);
  update public.products set view_count = view_count + 1 where id = p_product_id;
  if auth.uid() is not null then
    insert into public.recently_viewed (user_id, product_id, viewed_at) values (auth.uid(), p_product_id, now())
    on conflict (user_id, product_id) do update set viewed_at = excluded.viewed_at;
    delete from public.recently_viewed rv
    where rv.user_id = auth.uid()
      and rv.product_id not in (select r2.product_id from public.recently_viewed r2 where r2.user_id = auth.uid()
                                order by r2.viewed_at desc limit 30);
  end if;
end;
$$;

create or replace function public.my_wallet()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v jsonb;
begin
  if auth.uid() is null then
    raise exception 'login_required';
  end if;
  select jsonb_build_object(
    'wallet_id', w.wallet_id,
    'customer_id', p.customer_id,
    'available', public._wallet_available(p.id),
    'total_credits', coalesce((select sum(l.amount) from public.wallet_ledger l where l.user_id = p.id and l.direction = 'credit' and l.status = 'posted'), 0),
    'total_debits', coalesce((select sum(l.amount) from public.wallet_ledger l where l.user_id = p.id and l.direction = 'debit'), 0),
    'pending_credits', coalesce((select sum(l.amount) from public.wallet_ledger l where l.user_id = p.id and l.direction = 'credit' and l.status = 'pending'), 0),
    'currency', 'INR', 'note', 'Store credit for eligible SHOPZENT purchases only. Not cash, not withdrawable.')
  into v
  from public.profiles p join public.wallets w on w.user_id = p.id
  where p.id = auth.uid();
  if v is null then
    raise exception 'not_found';
  end if;
  return v;
end;
$$;

create or replace function public.my_coins()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'login_required';
  end if;
  return jsonb_build_object(
    'enabled', coalesce((select s.enabled from public.coin_settings s where s.id = 1), false),
    'balance', public._coin_balance(auth.uid()),
    'issued_total', coalesce((select sum(l.coins) from public.coin_ledger l where l.user_id = auth.uid() and l.kind = 'issue'), 0),
    'redeemed_total', coalesce((select sum(l.coins) from public.coin_ledger l where l.user_id = auth.uid() and l.kind = 'redeem'), 0),
    'reversed_total', coalesce((select sum(l.coins) from public.coin_ledger l where l.user_id = auth.uid() and l.kind = 'reversal'), 0),
    'expired_total', coalesce((select sum(l.coins) from public.coin_ledger l where l.user_id = auth.uid() and l.kind = 'expire'), 0),
    'note', 'SHOPZENT coins are loyalty points only. They are not money and cannot be withdrawn.');
end;
$$;

create or replace function public.mark_notification_read(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'login_required';
  end if;
  update public.notifications n set read_at = coalesce(n.read_at, now())
  where n.id = p_id and ((n.audience = 'user' and n.user_id = auth.uid()) or (n.audience = 'admin' and public.is_admin()));
end;
$$;

-- ---------------------------------------------------------------------------
-- Order helpers
-- ---------------------------------------------------------------------------
create or replace function public._order_event(p_order_id uuid, p_from text, p_to text, p_note text, p_internal boolean default false)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.order_events (order_id, from_status, to_status, note, is_internal, actor_id, actor_role)
  values (p_order_id, p_from, p_to, left(p_note, 1000), coalesce(p_internal, false), auth.uid(),
          coalesce(public.my_role(), nullif(auth.role(), ''), current_user::text));
end;
$$;

create or replace function public._order_status_label(p_status text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select initcap(replace(p_status, '_', ' '));
$$;

create or replace function public._set_order_status(p_order_id uuid, p_to text, p_note text, p_notify boolean default true)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_o public.orders;
begin
  select * into v_o from public.orders where id = p_order_id;
  if v_o.status = p_to then
    return;
  end if;
  update public.orders set status = p_to,
    confirmed_at = case when p_to = 'order_confirmed' then now() else confirmed_at end,
    shipped_at = case when p_to = 'shipped' then now() else shipped_at end,
    delivered_at = case when p_to = 'delivered' then now() else delivered_at end,
    cancelled_at = case when p_to in ('order_cancelled', 'order_rejected') then now() else cancelled_at end
  where id = p_order_id;
  perform public._order_event(p_order_id, v_o.status, p_to, p_note, false);
  if p_notify then
    perform public._notify(v_o.user_id, 'user', 'Order ' || v_o.order_code || ': ' || public._order_status_label(p_to),
                           coalesce(p_note, 'Your order status was updated.'), '/order-details.html?id=' || v_o.id::text);
  end if;
end;
$$;

-- void coupon redemptions and give back wallet credit used (once)
create or replace function public._order_release(p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_o public.orders;
begin
  select * into v_o from public.orders where id = p_order_id;
  update public.coupon_redemptions set voided = true where order_id = p_order_id and not voided;
  if v_o.wallet_used > 0 and not exists (
       select 1 from public.wallet_ledger l where l.order_id = p_order_id and l.kind = 'reversal' and l.direction = 'credit') then
    perform public._wallet_post(v_o.user_id, 'credit', 'reversal', v_o.wallet_used,
                                'Wallet amount returned: ' || coalesce(p_reason, 'order closed'), p_order_id, null,
                                'order-release:' || p_order_id::text, null);
  end if;
end;
$$;

create or replace function public._order_json(p_o public.orders)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  select jsonb_build_object('order_id', p_o.id, 'order_code', p_o.order_code, 'total', p_o.total, 'status', p_o.status,
         'payment_status', p_o.payment_status, 'subtotal', p_o.subtotal, 'product_discount', p_o.product_discount,
         'coupon_discount', p_o.coupon_discount, 'wallet_used', p_o.wallet_used, 'coupon_codes', to_jsonb(p_o.coupon_codes),
         'created_at', p_o.created_at);
$$;

-- ---------------------------------------------------------------------------
-- create_order
-- ---------------------------------------------------------------------------
create or replace function public.create_order(p_items jsonb, p_coupon text, p_shipping jsonb, p_use_wallet numeric default 0,
                                               p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_o public.orders;
  v_q jsonb;
  v_line jsonb;
  v_coupon_id uuid;
  v_name text; v_phone text; v_line1 text; v_line2 text; v_city text; v_state text; v_pin text; v_note text;
  v_wallet numeric;
  v_total numeric;
  v_paid_by_wallet boolean;
begin
  v_uid := public._require_user();
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 8 and 100 then
    raise exception 'invalid_input' using detail = 'idempotency key must be 8-100 characters';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('create_order|' || v_uid::text || '|' || p_idempotency_key, 0));
  select * into v_o from public.orders o where o.user_id = v_uid and o.idempotency_key = p_idempotency_key;
  if found then
    return public._order_json(v_o) || jsonb_build_object('replayed', true);
  end if;
  perform public.hit_rate_limit('create_order', v_uid::text, 20, 600);

  -- shipping
  if p_shipping is null or jsonb_typeof(p_shipping) <> 'object' then
    raise exception 'invalid_input' using detail = 'shipping';
  end if;
  v_name := btrim(coalesce(p_shipping ->> 'name', ''));
  v_phone := regexp_replace(coalesce(p_shipping ->> 'phone', ''), '[\s-]', '', 'g');
  v_phone := regexp_replace(v_phone, '^(\+91|91|0)(?=[6-9][0-9]{9}$)', '');
  v_line1 := btrim(coalesce(p_shipping ->> 'line1', ''));
  v_line2 := nullif(btrim(coalesce(p_shipping ->> 'line2', '')), '');
  v_city := btrim(coalesce(p_shipping ->> 'city', ''));
  v_state := btrim(coalesce(p_shipping ->> 'state', ''));
  v_pin := btrim(coalesce(p_shipping ->> 'pincode', ''));
  v_note := nullif(btrim(coalesce(p_shipping ->> 'note', '')), '');
  if char_length(v_name) not between 2 and 100 or v_phone !~ '^[6-9][0-9]{9}$'
     or char_length(v_line1) not between 3 and 200 or char_length(coalesce(v_line2, '')) > 200
     or char_length(v_city) not between 2 and 80 or char_length(v_state) not between 2 and 80
     or v_pin !~ '^[1-9][0-9]{5}$' or char_length(coalesce(v_note, '')) > 500 then
    raise exception 'invalid_shipping';
  end if;

  -- lock the coupon row so usage limits cannot be raced
  if coalesce(btrim(p_coupon), '') <> '' then
    perform 1 from public.coupons c where c.code = upper(btrim(p_coupon)) for update;
  end if;

  v_q := public._price_cart(p_items, p_coupon, v_uid);
  if v_q -> 'coupon' is not null and jsonb_typeof(v_q -> 'coupon') = 'object' then
    if not (v_q -> 'coupon' ->> 'valid')::boolean then
      raise exception '%', 'coupon_' || (v_q -> 'coupon' ->> 'code_status');
    end if;
    v_coupon_id := (v_q -> 'coupon' ->> '_coupon_id')::uuid;
  end if;

  v_total := (v_q ->> 'total')::numeric;
  v_wallet := round(coalesce(p_use_wallet, 0), 2);
  if v_wallet < 0 or v_wallet > v_total then
    raise exception 'invalid_input' using detail = 'wallet amount';
  end if;
  if v_wallet > 0 then
    perform 1 from public.wallets w where w.user_id = v_uid for update;
    if public._wallet_available(v_uid) < v_wallet then
      raise exception 'insufficient_balance';
    end if;
  end if;
  v_paid_by_wallet := (v_total - v_wallet) = 0;

  insert into public.orders (order_code, user_id, status, payment_status, subtotal, product_discount, coupon_discount, wallet_used, total,
                             coupon_codes, ship_name, ship_phone, ship_line1, ship_line2, ship_city, ship_state, ship_pincode,
                             customer_note, idempotency_key, paid_at)
  values ('SZO-' || to_char(now() at time zone 'Asia/Kolkata', 'YYMMDD') || '-' || public._rand_code(5), v_uid,
          case when v_paid_by_wallet then 'payment_verified' else 'payment_pending' end,
          case when v_paid_by_wallet then 'verified' else 'pending' end,
          (v_q ->> 'subtotal')::numeric, (v_q ->> 'product_discount')::numeric, (v_q ->> 'coupon_discount')::numeric,
          v_wallet, v_total - v_wallet,
          case when v_coupon_id is not null then array[v_q -> 'coupon' ->> 'code'] else '{}'::text[] end,
          v_name, v_phone, v_line1, v_line2, v_city, v_state, v_pin, v_note, p_idempotency_key,
          case when v_paid_by_wallet then now() end)
  returning * into v_o;

  for v_line in select e from jsonb_array_elements(v_q -> 'lines') e loop
    insert into public.order_items (order_id, product_id, product_name, product_image, unit_price, original_unit_price, qty,
                                    line_total, product_discount, coupon_discount)
    values (v_o.id, (v_line ->> 'product_id')::uuid, v_line ->> 'name', v_line ->> 'image', (v_line ->> 'unit_price')::numeric,
            (v_line ->> 'original_unit_price')::numeric, (v_line ->> 'qty')::int, (v_line ->> 'line_total')::numeric,
            (v_line ->> 'product_discount')::numeric, (v_line ->> 'coupon_discount')::numeric);
  end loop;

  if v_coupon_id is not null then
    insert into public.coupon_redemptions (coupon_id, user_id, order_id, discount_amount)
    values (v_coupon_id, v_uid, v_o.id, (v_q ->> 'coupon_discount')::numeric);
  end if;

  if v_wallet > 0 then
    perform public._wallet_post(v_uid, 'debit', 'purchase_debit', v_wallet, 'Used for order ' || v_o.order_code, v_o.id, null,
                                'order-debit:' || v_o.id::text, null);
  end if;

  perform public._order_event(v_o.id, null, v_o.status, 'Order placed', false);
  perform public._audit('order_created', 'orders', v_o.id::text,
                        jsonb_build_object('order_code', v_o.order_code, 'total', v_o.total, 'wallet_used', v_wallet,
                                           'coupon', v_o.coupon_codes));
  if v_paid_by_wallet then
    perform public._notify(null, 'admin', 'New order paid by wallet: ' || v_o.order_code, 'Ready to confirm.', '/admin/#orders');
  end if;
  return public._order_json(v_o) || jsonb_build_object('replayed', false);
exception
  when unique_violation then
    -- a concurrent request with the same key won the race
    select * into v_o from public.orders o where o.user_id = auth.uid() and o.idempotency_key = p_idempotency_key;
    if found then
      return public._order_json(v_o) || jsonb_build_object('replayed', true);
    end if;
    raise;
end;
$$;

-- ---------------------------------------------------------------------------
-- submit_payment (UTR + optional screenshot). Duplicate UTR is LOGGED and answered
-- with {status:'duplicate_utr', error:'duplicate_utr'} instead of an exception,
-- because an exception would roll back the log row.
-- ---------------------------------------------------------------------------
create or replace function public.submit_payment(p_order_id uuid, p_utr text, p_screenshot_path text default null,
                                                 p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_o public.orders;
  v_s public.payment_submissions;
  v_utr text;
  v_existing uuid;
begin
  v_uid := public._require_user();
  if p_idempotency_key is not null then
    if char_length(p_idempotency_key) not between 8 and 100 then
      raise exception 'invalid_input';
    end if;
    select * into v_s from public.payment_submissions s where s.user_id = v_uid and s.idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object('submission_id', v_s.id, 'submission_code', v_s.submission_code, 'status', v_s.status, 'replayed', true);
    end if;
  end if;
  perform public.hit_rate_limit('submit_payment', v_uid::text, 10, 600);

  select * into v_o from public.orders o where o.id = p_order_id and o.user_id = v_uid for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_o.status not in ('payment_pending', 'payment_rejected') or v_o.payment_status not in ('pending', 'rejected') then
    raise exception 'invalid_transition';
  end if;
  if v_o.total <= 0 then
    raise exception 'invalid_transition';
  end if;

  v_utr := upper(regexp_replace(coalesce(p_utr, ''), '[^A-Za-z0-9]', '', 'g'));
  if v_utr !~ '^[A-Z0-9]{12,22}$' then
    raise exception 'invalid_utr';
  end if;
  if p_screenshot_path is not null then
    if p_screenshot_path not like v_uid::text || '/%' or p_screenshot_path ~ '\.\.' or char_length(p_screenshot_path) > 300
       or p_screenshot_path !~* '\.(png|jpe?g|webp)$' then
      raise exception 'invalid_input' using detail = 'screenshot path';
    end if;
  end if;

  select s.id into v_existing from public.payment_submissions s where s.utr_normalized = v_utr and s.status <> 'rejected' limit 1;
  if v_existing is not null then
    insert into public.duplicate_utr_attempts (utr_normalized, user_id, order_id, existing_submission_id)
    values (v_utr, v_uid, v_o.id, v_existing);
    perform public._audit('duplicate_utr_attempt', 'orders', v_o.id::text,
                          jsonb_build_object('order_code', v_o.order_code, 'utr_last4', right(v_utr, 4), 'existing_submission_id', v_existing));
    perform public._notify(null, 'admin', 'Duplicate UTR attempt on ' || v_o.order_code,
                           'A UTR already used on another submission was entered again.', '/admin/#payments');
    return jsonb_build_object('submission_id', null, 'submission_code', null, 'status', 'duplicate_utr', 'error', 'duplicate_utr');
  end if;

  insert into public.payment_submissions (submission_code, order_id, user_id, utr, utr_normalized, amount, screenshot_path, idempotency_key)
  values (public._unique_code('SZPAY-', 8, 'public.payment_submissions', 'submission_code'), v_o.id, v_uid, left(btrim(p_utr), 40), v_utr,
          v_o.total, p_screenshot_path, p_idempotency_key)
  returning * into v_s;

  update public.orders set payment_status = 'submitted' where id = v_o.id;
  perform public._set_order_status(v_o.id, 'payment_submitted', 'Payment details submitted (UTR ending ' || right(v_utr, 4) || '). Awaiting verification.', false);
  perform public._notify(null, 'admin', 'Payment submitted: ' || v_o.order_code,
                         '₹' || v_o.total::text || ' · UTR ending ' || right(v_utr, 4), '/admin/#payments');
  perform public._audit('payment_submitted', 'payment_submissions', v_s.id::text,
                        jsonb_build_object('order_code', v_o.order_code, 'amount', v_o.total, 'utr_last4', right(v_utr, 4)));
  return jsonb_build_object('submission_id', v_s.id, 'submission_code', v_s.submission_code, 'status', v_s.status, 'replayed', false);
exception
  when unique_violation then
    raise exception 'duplicate_utr';
end;
$$;

-- ---------------------------------------------------------------------------
-- Cancellation and returns (customer side)
-- ---------------------------------------------------------------------------
create or replace function public.request_cancellation(p_order_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_o public.orders;
  v_r public.returns;
begin
  v_uid := public._require_user();
  p_reason := btrim(coalesce(p_reason, ''));
  if char_length(p_reason) not between 3 and 500 then
    raise exception 'invalid_input';
  end if;
  select * into v_o from public.orders o where o.id = p_order_id and o.user_id = v_uid for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_o.status in ('payment_pending', 'payment_submitted', 'payment_rejected') and v_o.payment_status <> 'verified' then
    update public.payment_submissions set status = 'rejected', admin_notes = coalesce(admin_notes, 'Order cancelled by customer')
      where order_id = v_o.id and status in ('submitted', 'under_verification');
    update public.orders set cancel_reason = p_reason, payment_status = case when payment_status = 'submitted' then 'rejected' else payment_status end
      where id = v_o.id;
    perform public._order_release(v_o.id, 'order cancelled');
    perform public._set_order_status(v_o.id, 'order_cancelled', 'Cancelled by customer: ' || p_reason);
    perform public._audit('order_cancelled_by_customer', 'orders', v_o.id::text, jsonb_build_object('order_code', v_o.order_code));
    return jsonb_build_object('status', 'order_cancelled', 'order_id', v_o.id);
  elsif v_o.status in ('under_verification', 'payment_verified', 'order_confirmed', 'processing') then
    if exists (select 1 from public.returns r where r.order_id = v_o.id and r.status not in ('return_rejected', 'wallet_credited', 'refund_completed')) then
      raise exception 'already_requested';
    end if;
    insert into public.returns (return_code, order_id, user_id, kind, reason, refund_preference, prev_order_status)
    values (public._unique_code('SZR-', 8, 'public.returns', 'return_code'), v_o.id, v_uid, 'cancellation', p_reason, 'original', v_o.status)
    returning * into v_r;
    perform public._order_event(v_o.id, v_o.status, v_o.status, 'Customer requested cancellation: ' || p_reason, false);
    perform public._notify(null, 'admin', 'Cancellation requested: ' || v_o.order_code, p_reason, '/admin/#returns');
    perform public._audit('cancellation_requested', 'returns', v_r.id::text, jsonb_build_object('order_code', v_o.order_code));
    return jsonb_build_object('status', 'cancellation_requested', 'order_id', v_o.id, 'return_id', v_r.id, 'return_code', v_r.return_code);
  end if;
  raise exception 'invalid_transition';
end;
$$;

create or replace function public.request_return(p_order_id uuid, p_reason text, p_description text, p_photos text[] default '{}',
                                                 p_refund_preference text default 'original')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid;
  v_o public.orders;
  v_r public.returns;
  v_days int;
  v_p text;
begin
  v_uid := public._require_user();
  p_reason := btrim(coalesce(p_reason, ''));
  p_description := nullif(btrim(coalesce(p_description, '')), '');
  p_photos := coalesce(p_photos, '{}');
  p_refund_preference := coalesce(p_refund_preference, 'original');
  if char_length(p_reason) not between 3 and 200 or char_length(coalesce(p_description, '')) > 2000
     or cardinality(p_photos) > 5 or p_refund_preference not in ('original', 'wallet') then
    raise exception 'invalid_input';
  end if;
  foreach v_p in array p_photos loop
    if v_p not like v_uid::text || '/%' or v_p ~ '\.\.' or char_length(v_p) > 300 then
      raise exception 'invalid_input' using detail = 'photo path';
    end if;
  end loop;
  select * into v_o from public.orders o where o.id = p_order_id and o.user_id = v_uid for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_o.status <> 'delivered' then
    raise exception 'invalid_transition';
  end if;
  select coalesce(nullif(s.value ->> 'window_days', '')::int, 7) into v_days from public.site_settings s where s.key = 'return_policy';
  v_days := coalesce(v_days, 7);
  if v_o.delivered_at is null or v_o.delivered_at < now() - make_interval(days => v_days) then
    raise exception 'return_window_closed';
  end if;
  if exists (select 1 from public.returns r where r.order_id = v_o.id and r.status not in ('return_rejected', 'wallet_credited', 'refund_completed')) then
    raise exception 'already_requested';
  end if;
  insert into public.returns (return_code, order_id, user_id, kind, reason, description, photos, refund_preference, prev_order_status)
  values (public._unique_code('SZR-', 8, 'public.returns', 'return_code'), v_o.id, v_uid, 'return', p_reason, p_description, p_photos,
          p_refund_preference, v_o.status)
  returning * into v_r;
  perform public._set_order_status(v_o.id, 'return_requested', 'Return requested: ' || p_reason);
  perform public._notify(null, 'admin', 'Return requested: ' || v_o.order_code, p_reason, '/admin/#returns');
  perform public._audit('return_requested', 'returns', v_r.id::text, jsonb_build_object('order_code', v_o.order_code));
  return jsonb_build_object('return_id', v_r.id, 'return_code', v_r.return_code, 'status', v_r.status);
end;
$$;

-- ---------------------------------------------------------------------------
-- MFA recovery codes + auth event log
-- ---------------------------------------------------------------------------
create or replace function public.generate_recovery_codes()
returns text[]
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_codes text[] := '{}';
  v_code text;
  i int;
begin
  perform public._require_user();
  if public.current_aal() <> 'aal2' then
    raise exception 'mfa_required';
  end if;
  perform public.hit_rate_limit('recovery_generate', auth.uid()::text, 5, 3600);
  delete from public.mfa_recovery_codes where user_id = auth.uid();
  for i in 1 .. 10 loop
    v_code := public._rand_code(5) || '-' || public._rand_code(5);
    v_codes := v_codes || v_code;
    insert into public.mfa_recovery_codes (user_id, code_hash)
    values (auth.uid(), extensions.crypt(replace(v_code, '-', ''), extensions.gen_salt('bf', 8)));
  end loop;
  perform public._audit('mfa_recovery_codes_generated', 'profiles', auth.uid()::text, jsonb_build_object('count', 10));
  return v_codes;
end;
$$;

create or replace function public.use_recovery_code(p_code text)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_norm text;
  v_row public.mfa_recovery_codes;
  v_factors int := 0;
begin
  if auth.uid() is null then
    raise exception 'login_required';
  end if;
  perform public.hit_rate_limit('recovery_use', auth.uid()::text, 5, 900);
  v_norm := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  if char_length(v_norm) <> 10 then
    perform public._audit('mfa_recovery_failed', 'profiles', auth.uid()::text, '{}'::jsonb);
    return false;
  end if;
  for v_row in select * from public.mfa_recovery_codes c where c.user_id = auth.uid() and c.used_at is null for update loop
    if extensions.crypt(v_norm, v_row.code_hash) = v_row.code_hash then
      update public.mfa_recovery_codes set used_at = now() where id = v_row.id;
      begin
        delete from auth.mfa_factors f where f.user_id = auth.uid();
        get diagnostics v_factors = row_count;
      exception when others then
        v_factors := -1; -- could not remove factors (privileges); admin must reset via dashboard
      end;
      perform public._audit('mfa_recovery_used', 'profiles', auth.uid()::text, jsonb_build_object('factors_removed', v_factors));
      perform public._notify(null, 'admin', 'MFA recovery code used',
                             'An account used a recovery code and must re-enrol its authenticator.', '/admin/#security');
      return true;
    end if;
  end loop;
  perform public._audit('mfa_recovery_failed', 'profiles', auth.uid()::text, '{}'::jsonb);
  return false;
end;
$$;

create or replace function public.log_auth_event(p_action text, p_details jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_details jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'login_required';
  end if;
  if p_action not in ('admin_login_success', 'mfa_failure', 'mfa_enrolled', 'mfa_removed', 'password_changed', 'logout_all', 'login_success') then
    raise exception 'invalid_input';
  end if;
  if p_action = 'admin_login_success' and not public.is_staff_aal1() then
    raise exception 'not_authorized';
  end if;
  perform public.hit_rate_limit('auth_event', auth.uid()::text, 20, 60);
  -- keep only a few harmless keys; never store codes/tokens/passwords
  if p_details is not null and jsonb_typeof(p_details) = 'object' then
    select coalesce(jsonb_object_agg(k, left(p_details ->> k, 120)), '{}'::jsonb) into v_details
    from jsonb_object_keys(p_details) k
    where k in ('factor_id', 'factor_type', 'reason', 'device', 'page');
  end if;
  perform public._audit(p_action, 'auth', auth.uid()::text, v_details || jsonb_build_object('aal', public.current_aal()));
end;
$$;
