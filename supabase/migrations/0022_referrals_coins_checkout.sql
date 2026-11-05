-- SHOPZENT 0022: share-and-earn (SHOPZENT's own products only), coins at checkout, referral + coin ledger wiring.
-- Coins are internal loyalty points (see coin_settings.rules). The checkout rate (rupee_per_coin, default 1) and the
-- reward rate (5-8 %, default 5 %) are admin settings; both are documented in the Settings page.
-- Idempotent. Admin writes set sz.notice_seen so they never fire the customer update notice.

insert into public.site_settings (key, value, is_public) values
  ('referral', '{"enabled": true, "default_rate": 5, "daily_cap_coins": 500, "attribution_days": 7}'::jsonb, true),
  ('coins_checkout', '{"enabled": true, "max_percent_per_line": 5, "rupee_per_coin": 1}'::jsonb, true)
on conflict (key) do nothing;

alter table public.products add column if not exists referral_rate numeric(4,2);
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'products_referral_rate_range') then
    alter table public.products add constraint products_referral_rate_range check (referral_rate is null or referral_rate between 5 and 8);
  end if;
end $$;

alter table public.orders add column if not exists coins_used bigint not null default 0;
alter table public.orders add column if not exists coin_discount numeric(12,2) not null default 0;
alter table public.orders add column if not exists referrer_id uuid references public.profiles (id);
alter table public.order_items add column if not exists coins_used bigint not null default 0;
alter table public.order_items add column if not exists coin_discount numeric(12,2) not null default 0;

create table if not exists public.referral_rewards (
  id bigserial primary key,
  order_id uuid not null references public.orders (id),
  order_item_id uuid not null unique references public.order_items (id),
  sharer_id uuid not null references public.profiles (id),
  buyer_id uuid not null references public.profiles (id),
  product_id uuid not null references public.products (id),
  line_total numeric(12,2) not null,
  rate numeric(4,2) not null check (rate between 5 and 8),
  coins bigint not null check (coins > 0),
  status text not null default 'pending' check (status in ('pending', 'paid', 'reversed')),
  issue_ledger_id bigint references public.coin_ledger (id),
  reversal_ledger_id bigint references public.coin_ledger (id),
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  reversed_at timestamptz,
  reverse_reason text
);
create index if not exists referral_rewards_sharer_idx on public.referral_rewards (sharer_id, created_at desc);
create index if not exists referral_rewards_order_idx on public.referral_rewards (order_id);
alter table public.referral_rewards enable row level security;
-- no table grants and no policies: customers and admins read it only through the SECURITY DEFINER functions below
revoke all on public.referral_rewards from public, anon, authenticated;

-- ---------- helpers ----------
create or replace function public._referral_rate(p_product_id uuid) returns numeric
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v numeric; d numeric;
begin
  select referral_rate into v from public.products where id = p_product_id;
  d := coalesce(nullif(public._setting('referral', 'default_rate'), '')::numeric, 5);
  return least(8, greatest(5, coalesce(v, d)));
end $$;

-- coins issued to a user as a reward (treasury mints the shortfall, as the owner credit does); once per key
create or replace function public._referral_issue(p_user uuid, p_coins bigint, p_note text, p_key text) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_s public.coin_settings; v_short bigint; v_id bigint; v_exp timestamptz;
begin
  if p_coins is null or p_coins <= 0 then return null; end if;
  select id into v_id from public.coin_ledger where idempotency_key = p_key;
  if found then return v_id; end if;
  select * into v_s from public.coin_settings where id = 1 for update;
  v_short := p_coins - public._coin_treasury_available();
  if v_short > 0 then
    insert into public.coin_ledger (txn_ref, user_id, kind, coins, note, idempotency_key)
    values (public._unique_code('SZCN-', 10, 'public.coin_ledger', 'txn_ref'), null, 'mint', v_short, p_note || ' (mint)', p_key || ':mint');
    update public.coin_settings set total_supply = total_supply + v_short where id = 1;
  end if;
  v_exp := case when v_s.expiry_days is not null then now() + make_interval(days => v_s.expiry_days) end;
  insert into public.coin_ledger (txn_ref, user_id, kind, coins, note, expires_at, idempotency_key)
  values (public._unique_code('SZCN-', 10, 'public.coin_ledger', 'txn_ref'), p_user, 'issue', p_coins, p_note, v_exp, p_key)
  returning id into v_id;
  return v_id;
end $$;

-- take back a reward issue (at most once; never more than the user's balance)
create or replace function public._coin_reverse_issue(p_issue_id bigint, p_key text, p_note text) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.coin_ledger%rowtype; v_amt bigint; v_id bigint;
begin
  select * into r from public.coin_ledger where id = p_issue_id;
  if not found or r.kind <> 'issue' then return null; end if;
  if exists (select 1 from public.coin_ledger x where x.reverses_id = p_issue_id and x.kind = 'reversal') then return null; end if;
  v_amt := greatest(least(r.coins, public._coin_balance(r.user_id)), 0);
  if v_amt <= 0 then return null; end if;
  insert into public.coin_ledger (txn_ref, user_id, kind, coins, note, reverses_id, created_by, idempotency_key)
  values (public._unique_code('SZCN-', 10, 'public.coin_ledger', 'txn_ref'), r.user_id, 'reversal', v_amt, p_note, p_issue_id, null, p_key)
  returning id into v_id;
  return v_id;
end $$;

-- delivered + payment confirmed -> pay pending rewards; cancelled / refunded -> reverse rewards; cancelled or rejected -> return checkout coins
create or replace function public._referral_on_order_change() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.referral_rewards%rowtype; v_iss bigint; v_rev bigint; v_ret_key text := 'coin-return:' || new.id::text;
begin
  -- reward is released only when the product is DELIVERED and the payment is confirmed (either order of the two events)
  if new.status = 'delivered' and new.payment_status = 'verified'
     and (old.status is distinct from 'delivered' or old.payment_status is distinct from 'verified') then
    for r in select * from public.referral_rewards x where x.order_id = new.id and x.status = 'pending' for update loop
      v_iss := public._referral_issue(r.sharer_id, r.coins, 'Share reward for order ' || new.order_code, 'referral-pay:' || r.id::text);
      update public.referral_rewards set status = 'paid', issue_ledger_id = v_iss, paid_at = now() where id = r.id;
      perform public._notify(r.sharer_id, 'user', 'Share reward added: ' || r.coins || ' coins',
        'The product you shared was delivered. The coins are in your wallet.', '/wallet.html');
    end loop;
  end if;
  if new.status is distinct from old.status then
    if new.status in ('order_cancelled', 'order_rejected', 'payment_rejected', 'return_approved', 'refund_processing', 'refund_completed') then
      for r in select * from public.referral_rewards x where x.order_id = new.id and x.status in ('pending', 'paid') for update loop
        v_rev := null;
        if r.status = 'paid' and r.issue_ledger_id is not null then
          v_rev := public._coin_reverse_issue(r.issue_ledger_id, 'referral-reverse:' || r.id::text, 'Share reward reversed: order ' || new.order_code);
        end if;
        update public.referral_rewards set status = 'reversed', reversed_at = now(), reverse_reason = new.status, reversal_ledger_id = v_rev where id = r.id;
        perform public._notify(r.sharer_id, 'user', 'Share reward reversed',
          'The order for a product you shared was cancelled or refunded, so its reward was taken back.', '/wallet.html');
      end loop;
    end if;
    if new.status in ('order_cancelled', 'order_rejected') and new.coins_used > 0
       and not exists (select 1 from public.coin_ledger x where x.idempotency_key = v_ret_key) then
      insert into public.coin_ledger (txn_ref, user_id, kind, coins, note, idempotency_key)
      values (public._unique_code('SZCN-', 10, 'public.coin_ledger', 'txn_ref'), new.user_id, 'issue', new.coins_used,
              'Coins returned: order ' || new.order_code || ' was cancelled', v_ret_key);
    end if;
  end if;
  return null;
end $$;

drop trigger if exists orders_referral_flow on public.orders;
create trigger orders_referral_flow after update of status, payment_status on public.orders
  for each row execute function public._referral_on_order_change();

-- ---------- create_order (7 args): adds p_use_coins and p_ref ----------
drop function if exists public.create_order(jsonb, text, jsonb, numeric, text);

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

  insert into public.orders (order_code, user_id, status, payment_status, subtotal, product_discount, coupon_discount, wallet_used, total, coins_used, coin_discount,
                             coupon_codes, ship_name, ship_phone, ship_line1, ship_line2, ship_city, ship_state, ship_pincode,
                             customer_note, idempotency_key, paid_at)
  values ('SZO-' || to_char(now() at time zone 'Asia/Kolkata', 'YYMMDD') || '-' || public._rand_code(5), v_uid,
          case when v_paid_by_wallet then 'payment_verified' else 'payment_pending' end,
          case when v_paid_by_wallet then 'verified' else 'pending' end,
          (v_q ->> 'subtotal')::numeric, (v_q ->> 'product_discount')::numeric, (v_q ->> 'coupon_discount')::numeric,
          v_wallet, v_total - v_wallet, v_coins_total, v_coin_rs,
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
$function$;

-- ---------- customer: my share earnings (own rows only; no buyer identity) ----------
create or replace function public.my_referral_summary() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_uid uuid := public._require_user(); v_out jsonb;
begin
  select jsonb_build_object(
    'code', (select p.customer_id from public.profiles p where p.id = v_uid),
    'enabled', coalesce(public._setting('referral', 'enabled'), 'true') = 'true',
    'default_rate', coalesce(nullif(public._setting('referral', 'default_rate'), '')::numeric, 5),
    'attribution_days', coalesce(nullif(public._setting('referral', 'attribution_days'), '')::int, 7),
    'daily_cap_coins', coalesce(nullif(public._setting('referral', 'daily_cap_coins'), '')::bigint, 500),
    'pending_coins', coalesce(sum(r.coins) filter (where r.status = 'pending'), 0),
    'paid_coins', coalesce(sum(r.coins) filter (where r.status = 'paid'), 0),
    'reversed_coins', coalesce(sum(r.coins) filter (where r.status = 'reversed'), 0),
    'rewards', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('product', p.name, 'coins', rr.coins, 'rate', rr.rate, 'status', rr.status,
                                  'created_at', rr.created_at, 'paid_at', rr.paid_at, 'reversed_at', rr.reversed_at,
                                  'reverse_reason', rr.reverse_reason) x
        from public.referral_rewards rr join public.products p on p.id = rr.product_id
        where rr.sharer_id = v_uid order by rr.created_at desc limit 50) s), '[]'::jsonb))
  into v_out
  from public.referral_rewards r where r.sharer_id = v_uid;
  return v_out;
end $$;

-- ---------- admin (admin + AAL2 checked inside; customers and anon cannot run these) ----------
create or replace function public.admin_set_referral_settings(p_enabled boolean, p_default_rate numeric, p_daily_cap_coins int, p_attribution_days int)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v jsonb;
begin
  perform public._require_admin();
  perform public.require_fresh(15);
  if p_default_rate is null or p_default_rate < 5 or p_default_rate > 8 then raise exception 'invalid_input' using detail = 'default_rate 5-8'; end if;
  if p_daily_cap_coins is null or p_daily_cap_coins < 0 or p_daily_cap_coins > 1000000 then raise exception 'invalid_input' using detail = 'daily_cap'; end if;
  if p_attribution_days is null or p_attribution_days < 1 or p_attribution_days > 30 then raise exception 'invalid_input' using detail = 'attribution_days'; end if;
  v := jsonb_build_object('enabled', coalesce(p_enabled, true), 'default_rate', p_default_rate,
                          'daily_cap_coins', p_daily_cap_coins, 'attribution_days', p_attribution_days);
  perform set_config('sz.notice_seen', '1', true);
  insert into public.site_settings (key, value, is_public, updated_by) values ('referral', v, true, auth.uid())
  on conflict (key) do update set value = excluded.value, is_public = true, updated_at = now(), updated_by = excluded.updated_by;
  perform public._audit('referral_settings_updated', 'site_settings', 'referral', v);
  return v;
end $$;

create or replace function public.admin_set_product_referral_rate(p_product_id uuid, p_rate numeric)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r record;
begin
  perform public._require_admin();
  if p_rate is not null and (p_rate < 5 or p_rate > 8) then raise exception 'invalid_input' using detail = 'rate 5-8'; end if;
  select purchase_type, marketplace into r from public.products where id = p_product_id;
  if not found then raise exception 'not_found'; end if;
  if r.purchase_type <> 'direct' or r.marketplace <> 'shopzent' then raise exception 'not_own_product'; end if;
  perform set_config('sz.notice_seen', '1', true);
  update public.products set referral_rate = round(p_rate, 2) where id = p_product_id;
  perform public._audit('product_referral_rate', 'products', p_product_id::text, jsonb_build_object('rate', p_rate));
  return jsonb_build_object('id', p_product_id, 'referral_rate', p_rate, 'effective_rate', public._referral_rate(p_product_id));
end $$;

create or replace function public.admin_list_referral_rewards(p_status text default null, p_limit int default 200)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin();
  return jsonb_build_object(
    'totals', coalesce((select jsonb_object_agg(t.status, jsonb_build_object('count', t.n, 'coins', t.c))
                        from (select r.status, count(*) n, sum(r.coins) c from public.referral_rewards r group by r.status) t), '{}'::jsonb),
    'rows', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('id', r.id, 'order_code', o.order_code, 'order_status', o.status, 'payment_status', o.payment_status,
                 'product', p.name, 'sharer', sp.customer_id, 'sharer_name', sp.full_name, 'buyer', bp.customer_id,
                 'line_total', r.line_total, 'rate', r.rate, 'coins', r.coins, 'status', r.status,
                 'created_at', r.created_at, 'paid_at', r.paid_at, 'reversed_at', r.reversed_at, 'reverse_reason', r.reverse_reason) x
        from public.referral_rewards r
          join public.orders o on o.id = r.order_id
          join public.products p on p.id = r.product_id
          join public.profiles sp on sp.id = r.sharer_id
          join public.profiles bp on bp.id = r.buyer_id
        where p_status is null or r.status = p_status
        order by r.created_at desc
        limit least(greatest(coalesce(p_limit, 200), 1), 500)) s), '[]'::jsonb));
end $$;

create or replace function public.admin_reverse_referral_reward(p_id bigint, p_reason text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.referral_rewards%rowtype; v_rev bigint; v_reason text := left(btrim(coalesce(p_reason, '')), 200);
begin
  perform public._require_admin();
  perform public.require_fresh(15);
  if char_length(v_reason) < 3 then raise exception 'invalid_input' using detail = 'reason'; end if;
  select * into r from public.referral_rewards where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if r.status = 'reversed' then
    return jsonb_build_object('id', r.id, 'status', r.status, 'replayed', true);
  end if;
  if r.status = 'paid' and r.issue_ledger_id is not null then
    v_rev := public._coin_reverse_issue(r.issue_ledger_id, 'referral-reverse:' || r.id::text, 'Share reward reversed by admin: ' || v_reason);
  end if;
  update public.referral_rewards set status = 'reversed', reversed_at = now(), reverse_reason = v_reason, reversal_ledger_id = v_rev where id = r.id;
  perform public._notify(r.sharer_id, 'user', 'Share reward reversed', 'A share reward of yours was taken back: ' || v_reason, '/wallet.html');
  perform public._audit('referral_reward_reversed', 'referral_rewards', r.id::text,
                        jsonb_build_object('coins', r.coins, 'was', r.status, 'coins_reversed', coalesce(v_rev, 0), 'reason', v_reason));
  return jsonb_build_object('id', r.id, 'status', 'reversed', 'coins_reversed', coalesce(v_rev, 0));
end $$;

-- ---------- grants ----------
revoke all on function public._referral_rate(uuid), public._referral_issue(uuid, bigint, text, text),
  public._coin_reverse_issue(bigint, text, text), public._referral_on_order_change() from public, anon, authenticated;
revoke all on function public.create_order(jsonb, text, jsonb, numeric, text, jsonb, jsonb) from public, anon;
grant execute on function public.create_order(jsonb, text, jsonb, numeric, text, jsonb, jsonb) to authenticated;
grant execute on function public.my_referral_summary() to authenticated;
revoke all on function public.admin_set_referral_settings(boolean, numeric, int, int), public.admin_set_product_referral_rate(uuid, numeric),
  public.admin_list_referral_rewards(text, int), public.admin_reverse_referral_reward(bigint, text, text), public.my_referral_summary()
  from public, anon;
grant execute on function public.admin_set_referral_settings(boolean, numeric, int, int), public.admin_set_product_referral_rate(uuid, numeric),
  public.admin_list_referral_rewards(text, int), public.admin_reverse_referral_reward(bigint, text, text) to authenticated;
