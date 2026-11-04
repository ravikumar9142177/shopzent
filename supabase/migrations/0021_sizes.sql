-- SHOPZENT 0021: SIZES for fashion products. Idempotent, no secrets. Migration 0020 (email check) is separate.
--  * categories.has_sizes (default ON for fashion-like names, editable in admin), products.sizes_enabled (null = follow the category),
--    products.size_options = [{"label":"M","stock":5}] (stock null = unlimited, 0 = out of stock)
--  * order_items.size (the size the customer chose), size_released (per-size stock is returned once, on cancel/auto-cancel)
--  * _price_cart: one cart line per product+size; a size is REQUIRED for sized products (size_required / size_not_available /
--    size_out_of_stock); products without sizes behave exactly as before (a size sent for them is ignored)
--  * create_order: takes the per-size stock (refuses if short, the whole order rolls back); _order_release gives it back
alter table public.categories add column if not exists has_sizes boolean not null default false;
alter table public.products add column if not exists sizes_enabled boolean;
alter table public.products add column if not exists size_options jsonb not null default '[]'::jsonb;
alter table public.order_items add column if not exists size text;
alter table public.order_items add column if not exists size_released boolean not null default false;

update public.categories set has_sizes = true
 where has_sizes = false and (name ~* '(fashion|cloth|kapd|apparel|garment|men|women|kids|kid|innerwear|wear|shirt|kurta|saree|dress|frock|bundi|pant|jeans)');

create or replace function public._product_sizes_on(p public.products)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(p.sizes_enabled, (select c.has_sizes from public.categories c where c.id = p.category_id), false);
$$;
revoke all on function public._product_sizes_on(public.products) from public, anon, authenticated;

-- shape guard for size_options (admin writes products through the table; this keeps the stored shape sane)
create or replace function public._products_sizes_guard()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare e jsonb; n int := 0;
begin
  if new.size_options is null then new.size_options := '[]'::jsonb; end if;
  if jsonb_typeof(new.size_options) <> 'array' or jsonb_array_length(new.size_options) > 60 then
    raise exception 'invalid_input' using detail = 'size_options';
  end if;
  for e in select x from jsonb_array_elements(new.size_options) x loop
    n := n + 1;
    if jsonb_typeof(e) <> 'object' or char_length(coalesce(e ->> 'label', '')) not between 1 and 30 then
      raise exception 'invalid_input' using detail = 'size label';
    end if;
    if (e ->> 'stock') is not null and ((e ->> 'stock') !~ '^[0-9]{1,6}$') then
      raise exception 'invalid_input' using detail = 'size stock';
    end if;
  end loop;
  return new;
end $$;
drop trigger if exists products_sizes_guard on public.products;
create trigger products_sizes_guard before insert or update of size_options on public.products
  for each row execute function public._products_sizes_guard();

-- take (negative delta) or give back (positive delta) one size's stock; refuses to go below zero
create or replace function public._size_stock_adjust(p_pid uuid, p_label text, p_delta int)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_so jsonb; v_new jsonb := '[]'::jsonb; e jsonb; v_hit boolean := false;
begin
  if p_label is null or coalesce(p_delta, 0) = 0 then return; end if;
  select size_options into v_so from public.products where id = p_pid for update;
  if not found or jsonb_typeof(v_so) <> 'array' then return; end if;
  for e in select x from jsonb_array_elements(v_so) x loop
    if lower(e ->> 'label') = lower(p_label) and (e ->> 'stock') is not null then
      if (e ->> 'stock')::int + p_delta < 0 then
        raise exception 'size_out_of_stock' using detail = p_pid::text;
      end if;
      e := jsonb_set(e, '{stock}', to_jsonb((e ->> 'stock')::int + p_delta));
      v_hit := true;
    end if;
    v_new := v_new || jsonb_build_array(e);
  end loop;
  if v_hit then
    update public.products set size_options = v_new where id = p_pid;
  end if;
end $$;
revoke all on function public._size_stock_adjust(uuid, text, int) from public, anon, authenticated;

create or replace function public._order_release(p_order_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_o public.orders; r record;
begin
  select * into v_o from public.orders where id = p_order_id;
  update public.coupon_redemptions set voided = true where order_id = p_order_id and not voided;
  if v_o.wallet_used > 0 and not exists (
       select 1 from public.wallet_ledger l where l.order_id = p_order_id and l.kind = 'reversal' and l.direction = 'credit') then
    perform public._wallet_post(v_o.user_id, 'credit', 'reversal', v_o.wallet_used,
                                'Wallet amount returned: ' || coalesce(p_reason, 'order closed'), p_order_id, null,
                                'order-release:' || p_order_id::text, null);
  end if;
  -- per-size stock goes back once
  for r in select i.product_id, i.size, i.qty from public.order_items i
           where i.order_id = p_order_id and i.size is not null and not i.size_released loop
    perform public._size_stock_adjust(r.product_id, r.size, r.qty);
  end loop;
  update public.order_items set size_released = true where order_id = p_order_id and size is not null and not size_released;
end $$;

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
$function$
;

CREATE OR REPLACE FUNCTION public.create_order(p_items jsonb, p_coupon text, p_shipping jsonb, p_use_wallet numeric DEFAULT 0, p_idempotency_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
                                    line_total, product_discount, coupon_discount, size)
    values (v_o.id, (v_line ->> 'product_id')::uuid, v_line ->> 'name', v_line ->> 'image', (v_line ->> 'unit_price')::numeric,
            (v_line ->> 'original_unit_price')::numeric, (v_line ->> 'qty')::int, (v_line ->> 'line_total')::numeric,
            (v_line ->> 'product_discount')::numeric, (v_line ->> 'coupon_discount')::numeric, nullif(v_line ->> 'size', ''));
    if nullif(v_line ->> 'size', '') is not null then
      perform public._size_stock_adjust((v_line ->> 'product_id')::uuid, v_line ->> 'size', -((v_line ->> 'qty')::int));
    end if;
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
$function$;

-- existing products keep working exactly as before: sizes are OFF until the admin turns them on for a product
update public.products set sizes_enabled = false where sizes_enabled is null;
-- (one-time cleanup of the first materialisation, if it ran)
update public.products set sizes_enabled = false where sizes_enabled is true and size_options = '[]'::jsonb;
