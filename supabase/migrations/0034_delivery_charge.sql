-- 0034: delivery charge. Flat per order (site_settings delivery_charge.amount, default 25), free on a customer's first order.
alter table public.orders add column if not exists delivery_charge numeric not null default 0;
select set_config('sz.notice_seen', '1', true);
insert into public.site_settings (key, value, is_public) values ('delivery_charge', '{"enabled": true, "amount": 25, "first_free": true}'::jsonb, true)
  on conflict (key) do nothing;
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
  v_dc numeric := 0;
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

  -- delivery charge: flat per order; free on the customer's first order (site_settings delivery_charge: enabled, amount, first_free)
  if coalesce(public._setting('delivery_charge', 'enabled'), 'true') = 'true' then
    v_dc := coalesce(nullif(public._setting('delivery_charge', 'amount'), '')::numeric, 25);
    if p_user is null or (coalesce(public._setting('delivery_charge', 'first_free'), 'true') = 'true'
       and not exists (select 1 from public.orders o where o.user_id = p_user and o.status not in ('order_cancelled', 'order_rejected', 'payment_rejected'))) then
      v_dc := 0;
    end if;
  end if;
  return jsonb_build_object(
    'lines', v_lines,
    'subtotal', round(v_subtotal, 2),
    'product_discount', round(v_pd_total, 2),
    'coupon_discount', round(v_cd_total, 2),
    'delivery_charge', round(v_dc, 2),
    'total', round(v_subtotal - v_pd_total - v_cd_total + v_dc, 2),
    'coupon', v_coupon_json);
end;
$function$
;
CREATE OR REPLACE FUNCTION public.create_order(p_items jsonb, p_coupon text, p_shipping jsonb, p_use_wallet numeric DEFAULT 0, p_idempotency_key text DEFAULT NULL::text, p_use_coins jsonb DEFAULT NULL::jsonb, p_ref jsonb DEFAULT NULL::jsonb)
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
  v_coin_map jsonb := '{}'::jsonb; v_coins_total bigint := 0; v_coin_rs numeric := 0; v_rate numeric; v_maxpct numeric;
  v_c jsonb; v_cpid uuid; v_csize text; v_ccoins bigint; v_icoins bigint; v_icoin_rs numeric;
  v_ref_pid uuid; v_sharer uuid; v_ref_t timestamptz; v_oi public.order_items%rowtype; v_reward bigint; v_used bigint; v_cap bigint; v_pct numeric; v_days int;
  v_buyer_phone text; v_sh_phone text;
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
  -- coins at checkout: internal points, own SHOPZENT products only, at most max_percent of a line's payable amount
  v_rate := coalesce(nullif(public._setting('coins_checkout', 'rupee_per_coin'), '')::numeric, 1);
  v_maxpct := coalesce(nullif(public._setting('coins_checkout', 'max_percent_per_line'), '')::numeric, 5);
  if p_use_coins is not null and jsonb_typeof(p_use_coins) = 'array' and jsonb_array_length(p_use_coins) > 0 then
    if not coalesce((select cs.enabled from public.coin_settings cs where cs.id = 1), false)
       or coalesce(public._setting('coins_checkout', 'enabled'), 'true') <> 'true' then
      raise exception 'coins_disabled';
    end if;
    for v_c in select e from jsonb_array_elements(p_use_coins) e loop
      if jsonb_typeof(v_c) <> 'object' or (v_c ->> 'coins') !~ '^[0-9]{1,12}(\.[0-9]+)?$' then
        raise exception 'invalid_input' using detail = 'coins';
      end if;
      v_cpid := (v_c ->> 'product_id')::uuid;
      v_csize := nullif(btrim(coalesce(v_c ->> 'size', '')), '');
      v_ccoins := floor((v_c ->> 'coins')::numeric)::bigint;
      if v_ccoins = 0 then continue; end if;
      select e into v_line from jsonb_array_elements(v_q -> 'lines') e
        where (e ->> 'product_id')::uuid = v_cpid and coalesce(e ->> 'size', '') = coalesce(v_csize, '') limit 1;
      if v_line is null then raise exception 'invalid_input' using detail = 'coin line'; end if;
      if v_coin_map ? (v_cpid::text || '|' || coalesce(v_csize, '')) then
        raise exception 'invalid_input' using detail = 'coin line repeated';
      end if;
      if not exists (select 1 from public.products p where p.id = v_cpid and p.purchase_type = 'direct' and p.marketplace = 'shopzent') then
        raise exception 'coins_not_allowed';
      end if;
      if v_ccoins * v_rate > trunc((v_line ->> 'line_total')::numeric * v_maxpct / 100, 2) then
        raise exception 'coins_over_cap';
      end if;
      v_coin_map := v_coin_map || jsonb_build_object(v_cpid::text || '|' || coalesce(v_csize, ''), v_ccoins);
      v_coins_total := v_coins_total + v_ccoins;
    end loop;
    if v_coins_total > 0 then
      perform pg_advisory_xact_lock(hashtextextended('coins|' || v_uid::text, 0));
      if public._coin_balance(v_uid) < v_coins_total then raise exception 'insufficient_coins'; end if;
      v_coin_rs := round(v_coins_total * v_rate, 2);
      if v_coin_rs > v_total then raise exception 'coins_over_total'; end if;
      v_total := v_total - v_coin_rs;
    end if;
  end if;
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

  insert into public.orders (order_code, user_id, status, payment_status, subtotal, product_discount, coupon_discount, wallet_used, total, coins_used, coin_discount, delivery_charge,
                             coupon_codes, ship_name, ship_phone, ship_line1, ship_line2, ship_city, ship_state, ship_pincode,
                             customer_note, idempotency_key, paid_at)
  values ('SZO-' || to_char(now() at time zone 'Asia/Kolkata', 'YYMMDD') || '-' || public._rand_code(5), v_uid,
          case when v_paid_by_wallet then 'payment_verified' else 'payment_pending' end,
          case when v_paid_by_wallet then 'verified' else 'pending' end,
          (v_q ->> 'subtotal')::numeric, (v_q ->> 'product_discount')::numeric, (v_q ->> 'coupon_discount')::numeric,
          v_wallet, v_total - v_wallet, v_coins_total, v_coin_rs, coalesce((v_q ->> 'delivery_charge')::numeric, 0),
          case when v_coupon_id is not null then array[v_q -> 'coupon' ->> 'code'] else '{}'::text[] end,
          v_name, v_phone, v_line1, v_line2, v_city, v_state, v_pin, v_note, p_idempotency_key,
          case when v_paid_by_wallet then now() end)
  returning * into v_o;

  for v_line in select e from jsonb_array_elements(v_q -> 'lines') e loop
    v_icoins := coalesce((v_coin_map ->> (((v_line ->> 'product_id')::uuid)::text || '|' || coalesce(v_line ->> 'size', '')))::bigint, 0);
    v_icoin_rs := round(v_icoins * v_rate, 2);
    insert into public.order_items (order_id, product_id, product_name, product_image, unit_price, original_unit_price, qty,
                                    line_total, product_discount, coupon_discount, size, coins_used, coin_discount)
    values (v_o.id, (v_line ->> 'product_id')::uuid, v_line ->> 'name', v_line ->> 'image', (v_line ->> 'unit_price')::numeric,
            (v_line ->> 'original_unit_price')::numeric, (v_line ->> 'qty')::int, (v_line ->> 'line_total')::numeric,
            (v_line ->> 'product_discount')::numeric, (v_line ->> 'coupon_discount')::numeric, nullif(v_line ->> 'size', ''), v_icoins, v_icoin_rs);
    if nullif(v_line ->> 'size', '') is not null then
      perform public._size_stock_adjust((v_line ->> 'product_id')::uuid, v_line ->> 'size', -((v_line ->> 'qty')::int));
    end if;
  end loop;

  -- coins used at checkout leave the buyer's balance now (returned if the order is cancelled or rejected)
  if v_coins_total > 0 then
    insert into public.coin_ledger (txn_ref, user_id, kind, coins, note, created_by, idempotency_key)
    values (public._unique_code('SZCN-', 10, 'public.coin_ledger', 'txn_ref'), v_uid, 'redeem', v_coins_total,
            'Used at checkout for order ' || v_o.order_code, v_uid, 'coin-redeem:' || v_o.id::text);
  end if;

  -- share-and-earn: a different real account buys a shared SHOPZENT product through a share link.
  -- Reward = referral rate of the line amount, in coins, pending until payment is confirmed. Invalid ref data is ignored, never fails the order.
  if p_ref is not null and jsonb_typeof(p_ref) = 'object' and coalesce(public._setting('referral', 'enabled'), 'true') = 'true'
     and coalesce(p_ref ->> 'code', '') ~ '^SZC-[A-Z0-9]{8}$'
     and coalesce(p_ref ->> 'pid', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     and coalesce(p_ref ->> 't', '') ~ '^[0-9]{10,16}$' then
    v_ref_pid := (p_ref ->> 'pid')::uuid;
    v_days := coalesce(nullif(public._setting('referral', 'attribution_days'), '')::int, 7);
    v_ref_t := to_timestamp((p_ref ->> 't')::numeric / 1000);
    select s.id into v_sharer from public.profiles s where s.customer_id = p_ref ->> 'code' and s.status = 'active';
    select right(regexp_replace(coalesce(s.phone, ''), '\D', '', 'g'), 10) into v_sh_phone from public.profiles s where s.id = v_sharer;
    select right(regexp_replace(coalesce(b.phone, ''), '\D', '', 'g'), 10) into v_buyer_phone from public.profiles b where b.id = v_uid;
    if v_sharer is not null and v_sharer <> v_uid
       and v_ref_t <= now() + interval '5 minutes' and v_ref_t >= now() - make_interval(days => v_days)
       and not (coalesce(v_sh_phone, '') <> '' and v_sh_phone in (coalesce(v_buyer_phone, ''), right(v_phone, 10)))
       and exists (select 1 from public.products p where p.id = v_ref_pid and p.purchase_type = 'direct' and p.marketplace = 'shopzent') then
      v_pct := public._referral_rate(v_ref_pid);
      v_cap := coalesce(nullif(public._setting('referral', 'daily_cap_coins'), '')::bigint, 500);
      select coalesce(sum(r.coins), 0) into v_used from public.referral_rewards r
        where r.sharer_id = v_sharer and r.status <> 'reversed' and r.created_at >= public._today_ist_start();
      for v_oi in select * from public.order_items where order_id = v_o.id and product_id = v_ref_pid loop
        v_reward := floor(v_oi.line_total * v_pct / 100 / v_rate);
        v_reward := least(v_reward, greatest(v_cap - v_used, 0));
        if v_reward > 0 then
          insert into public.referral_rewards (order_id, order_item_id, sharer_id, buyer_id, product_id, line_total, rate, coins, status)
          values (v_o.id, v_oi.id, v_sharer, v_uid, v_ref_pid, v_oi.line_total, v_pct, v_reward, 'pending');
          v_used := v_used + v_reward;
          perform public._notify(v_sharer, 'user', 'Share reward pending',
            'Someone bought a product you shared. ' || v_reward || ' coins will be added once the product is delivered.', '/wallet.html');
        end if;
      end loop;
      update public.orders set referrer_id = v_sharer
        where id = v_o.id and exists (select 1 from public.referral_rewards r where r.order_id = v_o.id);
    end if;
  end if;

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
$function$
;
CREATE OR REPLACE FUNCTION public._order_json(p_o orders)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select jsonb_build_object('order_id', p_o.id, 'order_code', p_o.order_code, 'total', p_o.total, 'status', p_o.status,
         'payment_status', p_o.payment_status, 'subtotal', p_o.subtotal, 'product_discount', p_o.product_discount,
         'coupon_discount', p_o.coupon_discount, 'wallet_used', p_o.wallet_used, 'coupon_codes', to_jsonb(p_o.coupon_codes),
         'created_at', p_o.created_at, 'coins_used', p_o.coins_used, 'coin_discount', p_o.coin_discount, 'delivered_at', p_o.delivered_at, 'delivery_charge', p_o.delivery_charge);
$function$
;
