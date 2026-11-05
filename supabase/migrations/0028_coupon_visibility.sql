-- SHOPZENT 0028: coupon visibility (PUBLIC / PRIVATE), private coupon customer list, public coupon show window.
-- * coupons.is_public = true -> PUBLIC (may be shown on the storefront inside show_from .. show_until, IST as entered)
-- * coupons.is_public = false -> PRIVATE: only customers in coupon_customers can apply it; for everyone else quote and
--   create_order answer code_status 'invalid' (enforced in _price_cart, the one place a code is looked up).
-- * existing coupons are set PRIVATE once (the first time this migration runs).
-- * admin writes here never fire the customer update notice (sz.notice_seen, like 0022/0025/0027).
-- Idempotent. No secrets. No coupon codes are inserted.

-- 1) existing coupons -> private (only the first run: later public choices are never reset by a re-run)
do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'coupons' and column_name = 'show_from') then
    update public.coupons set is_public = false where is_public;
  end if;
end $$;
alter table public.coupons add column if not exists show_from timestamptz;
alter table public.coupons add column if not exists show_until timestamptz;
alter table public.coupons alter column is_public set default false;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'coupons_show_window_chk') then
    alter table public.coupons add constraint coupons_show_window_chk
      check (show_from is null or show_until is null or show_until > show_from);
  end if;
end $$;

-- 2) private coupon customers
create table if not exists public.coupon_customers (
  coupon_id uuid not null references public.coupons (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  added_by uuid,
  created_at timestamptz not null default now(),
  primary key (coupon_id, user_id)
);
create index if not exists coupon_customers_user_idx on public.coupon_customers (user_id);
alter table public.coupon_customers enable row level security;
drop policy if exists coupon_customers_admin on public.coupon_customers;
create policy coupon_customers_admin on public.coupon_customers for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
revoke all on public.coupon_customers from anon;
grant select, insert, update, delete on public.coupon_customers to authenticated;

-- 3) admin writes on coupons never fire the customer update notice
create or replace function public._coupon_admin_quiet()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform set_config('sz.notice_seen', '1', true);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function public._coupon_admin_quiet() from public, anon, authenticated;
drop trigger if exists coupons_quiet on public.coupons;
create trigger coupons_quiet before insert or update or delete on public.coupons
  for each row execute function public._coupon_admin_quiet();
drop trigger if exists coupon_customers_quiet on public.coupon_customers;
create trigger coupon_customers_quiet before insert or update or delete on public.coupon_customers
  for each row execute function public._coupon_admin_quiet();

-- 4) the storefront: the one public coupon to show right now (inside its window), or null. Never a private code.
create or replace function public.featured_coupon()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select (
    select jsonb_build_object('code', c.code, 'description', c.description, 'discount_type', c.discount_type,
           'discount_value', c.discount_value, 'min_order', c.min_order, 'max_discount', c.max_discount,
           'show_until', c.show_until, 'expires_at', c.expires_at)
    from public.coupons c
    where c.is_public and c.active
      and (c.show_from is null or c.show_from <= now())
      and (c.show_until is null or c.show_until > now())
      and (c.starts_at is null or c.starts_at <= now())
      and (c.expires_at is null or c.expires_at > now())
      and (c.usage_limit is null or (select count(*) from public.coupon_redemptions r where r.coupon_id = c.id and not r.voided) < c.usage_limit)
    order by c.show_from desc nulls last, c.created_at desc
    limit 1
  );
$$;
revoke all on function public.featured_coupon() from public;
grant execute on function public.featured_coupon() to anon, authenticated;

-- 5) admin: who has a private coupon (customer ids only, for the admin form)
create or replace function public.admin_coupon_customers_all()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_admin();
  return coalesce((
    select jsonb_agg(jsonb_build_object('coupon_id', x.coupon_id, 'customer_ids', x.ids) order by x.coupon_id)
    from (select cc.coupon_id, jsonb_agg(p.customer_id order by p.customer_id) as ids
          from public.coupon_customers cc join public.profiles p on p.id = cc.user_id
          group by cc.coupon_id) x
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.admin_coupon_customers_all() from public, anon;
grant execute on function public.admin_coupon_customers_all() to authenticated;

-- 6) admin: set the customers of a private coupon. Keys are customer IDs (SZC-...) or emails; the list is replaced.
create or replace function public.admin_coupon_set_customers(p_coupon uuid, p_keys text[])
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare k text; v_uid uuid; v_ids uuid[] := '{}'; v_missing text[] := '{}'; v_n int;
begin
  perform public._require_admin();
  perform public.require_fresh(15);
  perform set_config('sz.notice_seen', '1', true);
  if not exists (select 1 from public.coupons where id = p_coupon) then raise exception 'not_found'; end if;
  if cardinality(coalesce(p_keys, '{}')) > 500 then raise exception 'invalid_input' using detail = 'too many customers'; end if;
  foreach k in array coalesce(p_keys, '{}') loop
    k := btrim(coalesce(k, ''));
    continue when k = '';
    if char_length(k) > 120 then raise exception 'invalid_input' using detail = 'key'; end if;
    select p.id into v_uid from public.profiles p
      where upper(p.customer_id) = upper(k) or lower(p.email) = lower(k)
      order by (upper(p.customer_id) = upper(k)) desc limit 1;
    if v_uid is null then
      v_missing := array_append(v_missing, k);
    elsif not (v_uid = any (v_ids)) then
      v_ids := array_append(v_ids, v_uid);
    end if;
  end loop;
  delete from public.coupon_customers where coupon_id = p_coupon and not (user_id = any (v_ids));
  insert into public.coupon_customers (coupon_id, user_id, added_by)
    select p_coupon, u, auth.uid() from unnest(v_ids) u
    on conflict (coupon_id, user_id) do nothing;
  get diagnostics v_n = row_count;
  perform public._audit('coupon_customers_set', 'coupons', p_coupon::text,
    jsonb_build_object('customers', cardinality(v_ids), 'not_found', cardinality(v_missing)));
  return jsonb_build_object('coupon_id', p_coupon, 'customers', cardinality(v_ids), 'not_found', to_jsonb(v_missing));
end;
$$;
revoke all on function public.admin_coupon_set_customers(uuid, text[]) from public, anon;
grant execute on function public.admin_coupon_set_customers(uuid, text[]) to authenticated;

-- 7) quote and create_order use the new visibility rule (the function body is the 0021 body plus the private check)
create or replace function public._price_cart(p_items jsonb, p_coupon text, p_user uuid)
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
  a_size text[] := '{}';
  v_sz text;
  v_sizes_on boolean;
  v_sobj jsonb;
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
    v_sz := nullif(btrim(coalesce(v_el ->> 'size', '')), '');
    v_idx := null;
    for i in 1 .. coalesce(cardinality(a_pid), 0) loop
      if a_pid[i] = v_pid and coalesce(a_size[i], '') = coalesce(v_sz, '') then
        v_idx := i; exit;
      end if;
    end loop;
    if v_idx is null then
      a_pid := a_pid || v_pid;
      a_qty := a_qty || v_qty;
      a_size := a_size || v_sz;
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
    -- sizes (fashion): a size is required when the product has sizes on; per-size stock blank = unlimited
    v_sizes_on := public._product_sizes_on(v_p);
    if v_sizes_on then
      if a_size[i] is null then
        raise exception 'size_required' using detail = a_pid[i]::text;
      end if;
      select e into v_sobj from jsonb_array_elements(coalesce(v_p.size_options, '[]'::jsonb)) e
        where lower(e ->> 'label') = lower(a_size[i]) limit 1;
      if v_sobj is null then
        raise exception 'size_not_available' using detail = a_pid[i]::text;
      end if;
      if (v_sobj ->> 'stock') is not null and (v_sobj ->> 'stock')::int < a_qty[i] then
        raise exception 'size_out_of_stock' using detail = a_pid[i]::text;
      end if;
      a_size[i] := v_sobj ->> 'label';
    else
      a_size[i] := null;
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
    select * into v_c from public.coupons c where c.code = v_code
      and (c.is_public or exists (select 1 from public.coupon_customers cc where cc.coupon_id = c.id and cc.user_id = p_user));  -- 0028: private coupons only for chosen customers (others: invalid)
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
      'size', a_size[i],
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
