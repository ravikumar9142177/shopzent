-- 0016_phone_abuse_owner_coins.sql
-- Server-side rules (RPC/trigger + RLS; the UI only explains them):
--  1. Indian mobile required to order: profiles.phone (normalised 10 digits, 6-9 start, ONE account per phone),
--     phone_verified_at (set by the verify-otp edge function once an SMS provider is configured), email must be confirmed.
--     Enforced by a BEFORE INSERT trigger on orders (so create_order cannot be bypassed).
--  2. Anti-abuse: max orders per customer per day (IST), cancellation penalty on PAID orders after N cancellations today,
--     wallet never negative unless allowed: unpaid penalties become dues that block new orders until an admin clears them.
--  3. Owner coins: opening balance top-up to 5,000,000,000 and a monthly credit (default 50,000,000) on the 1st at 00:05 IST
--     via pg_cron, idempotent per month. Coins are loyalty points (bigint), not money.
-- Settings (admin-editable in Admin -> Settings): order_rules (public), owner_coins (private).

insert into public.site_settings (key, value, is_public) values
  ('order_rules', '{"require_phone": true, "require_phone_verified": false, "max_orders_per_day": 10, "cancel_penalty_amount": 10, "cancel_penalty_after": 5, "allow_negative_wallet": false}'::jsonb, true)
on conflict (key) do nothing;
insert into public.site_settings (key, value, is_public) values
  ('owner_coins', '{"owner_email": "ravitechsolution.shop@gmail.com", "opening_balance": 5000000000, "monthly_amount": 50000000}'::jsonb, false)
on conflict (key) do nothing;

create or replace function public._setting(p_key text, p_field text) returns text
language sql stable security definer set search_path = public, pg_temp as $$
  select s.value ->> p_field from public.site_settings s where s.key = p_key;
$$;
create or replace function public._today_ist_start() returns timestamptz
language sql stable set search_path = public, pg_temp as $$
  select (date_trunc('day', now() at time zone 'Asia/Kolkata')) at time zone 'Asia/Kolkata';
$$;

-- ---------- 1. phone ----------
alter table public.profiles add column if not exists phone text;
alter table public.profiles add column if not exists phone_verified_at timestamptz;
create unique index if not exists profiles_phone_uidx on public.profiles (phone) where phone is not null;

create or replace function public._norm_in_phone(p text) returns text
language plpgsql immutable set search_path = public, pg_temp as $$
declare v text := regexp_replace(coalesce(p, ''), '\D', '', 'g');
begin
  if v ~ '^(91|0)?[6-9][0-9]{9}$' then return right(v, 10); end if;
  return null;
end;
$$;

create or replace function public._profiles_phone() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare v text := public._norm_in_phone(new.mobile);
begin
  if tg_op = 'UPDATE' and v is not distinct from old.phone then
    new.phone := old.phone; new.phone_verified_at := old.phone_verified_at;
    return new;
  end if;
  if v is not null and exists (select 1 from public.profiles p where p.phone = v and p.id <> new.id) then
    if tg_op = 'INSERT' then
      new.phone := null;            -- never block a signup; the customer must add a free number before ordering
    else
      raise exception 'phone_in_use';
    end if;
  else
    new.phone := v;
  end if;
  new.phone_verified_at := null;    -- a new number has to be verified again
  return new;
end;
$$;
drop trigger if exists profiles_phone on public.profiles;
create trigger profiles_phone before insert or update of mobile on public.profiles
  for each row execute function public._profiles_phone();

do $$
declare r record;
begin
  for r in select id, mobile from public.profiles where phone is null and public._norm_in_phone(mobile) is not null order by created_at loop
    begin
      update public.profiles set phone = public._norm_in_phone(r.mobile) where id = r.id
        and not exists (select 1 from public.profiles p where p.phone = public._norm_in_phone(r.mobile));
    exception when unique_violation then null;
    end;
  end loop;
end $$;

-- OTP store for the send-otp / verify-otp edge functions (service role only; no policies = no client access)
create table if not exists public.phone_otps (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  phone text not null,
  code_hash text not null,
  attempts int not null default 0,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  ip_hash text,
  created_at timestamptz not null default now()
);
create index if not exists phone_otps_user_idx on public.phone_otps (user_id, created_at desc);
create index if not exists phone_otps_phone_idx on public.phone_otps (phone, created_at desc);
alter table public.phone_otps enable row level security;
revoke all on public.phone_otps from anon, authenticated;

-- ---------- 2. dues + penalty ----------
alter table public.wallet_ledger drop constraint if exists wallet_ledger_kind_check;
alter table public.wallet_ledger add constraint wallet_ledger_kind_check check (kind = any (array['return_credit', 'promo_credit', 'admin_adjust', 'purchase_debit', 'reversal', 'refund_credit', 'penalty_debit']));

create table if not exists public.customer_dues (
  id bigserial primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  reason text not null,
  order_id uuid references public.orders(id) on delete set null,
  return_id uuid unique,
  created_at timestamptz not null default now(),
  cleared_at timestamptz,
  cleared_by uuid,
  cleared_note text
);
alter table public.customer_dues enable row level security;
revoke all on public.customer_dues from anon, authenticated;
grant select on public.customer_dues to authenticated;
drop policy if exists customer_dues_read on public.customer_dues;
create policy customer_dues_read on public.customer_dues for select to authenticated using (user_id = auth.uid() or public.is_admin());

create or replace function public._order_guard() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_phone text; v_ver timestamptz; v_max int; v_n int;
begin
  perform pg_advisory_xact_lock(hashtextextended('order_guard|' || new.user_id::text, 0));
  if coalesce(public._setting('order_rules', 'require_phone'), 'true')::boolean then
    select p.phone, p.phone_verified_at into v_phone, v_ver from public.profiles p where p.id = new.user_id;
    if v_phone is null then raise exception 'phone_required'; end if;
    if coalesce(public._setting('order_rules', 'require_phone_verified'), 'false')::boolean and v_ver is null then
      raise exception 'phone_not_verified';
    end if;
  end if;
  if not exists (select 1 from auth.users u where u.id = new.user_id and u.email_confirmed_at is not null) then
    raise exception 'email_not_confirmed';
  end if;
  if exists (select 1 from public.customer_dues d where d.user_id = new.user_id and d.cleared_at is null) then
    raise exception 'dues_pending';
  end if;
  v_max := coalesce(public._setting('order_rules', 'max_orders_per_day'), '10')::int;
  select count(*) into v_n from public.orders o where o.user_id = new.user_id and o.created_at >= public._today_ist_start();
  if v_n >= v_max then raise exception 'daily_order_limit'; end if;
  return new;
end;
$$;
drop trigger if exists orders_guard on public.orders;
create trigger orders_guard before insert on public.orders for each row execute function public._order_guard();

create or replace function public._cancel_penalty() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_o public.orders; v_after int; v_amt numeric; v_n int; v_reason text; v_wallet public.wallets;
begin
  if new.kind <> 'cancellation' then return new; end if;
  select * into v_o from public.orders where id = new.order_id;
  if v_o.payment_status <> 'verified' then return new; end if;            -- only PAID orders
  v_after := coalesce(public._setting('order_rules', 'cancel_penalty_after'), '5')::int;
  v_amt := round(coalesce(public._setting('order_rules', 'cancel_penalty_amount'), '10')::numeric, 2);
  if v_amt <= 0 then return new; end if;
  select count(*) into v_n from public.audit_log a
  where a.actor_id = new.user_id and a.action in ('order_cancelled_by_customer', 'cancellation_requested') and a.created_at >= public._today_ist_start();
  if v_n <= v_after then return new; end if;                             -- already MORE than N cancellations today
  v_reason := 'Cancellation penalty: more than ' || v_after || ' cancellations today (order ' || v_o.order_code || ')';
  if public._wallet_available(new.user_id) >= v_amt then
    perform public._wallet_post(new.user_id, 'debit', 'penalty_debit', v_amt, v_reason, new.order_id, new.id, 'penalty:' || new.id::text);
  elsif coalesce(public._setting('order_rules', 'allow_negative_wallet'), 'false')::boolean then
    select * into v_wallet from public.wallets w where w.user_id = new.user_id for update;
    insert into public.wallet_ledger (txn_ref, user_id, wallet_id, direction, kind, amount, status, order_id, return_id, note, created_by, idempotency_key)
    values (public._unique_code('SZWT-', 10, 'public.wallet_ledger', 'txn_ref'), new.user_id, v_wallet.id, 'debit', 'penalty_debit', v_amt, 'posted',
            new.order_id, new.id, v_reason, auth.uid(), 'penalty:' || new.id::text);
  else
    insert into public.customer_dues (user_id, amount, reason, order_id, return_id) values (new.user_id, v_amt, v_reason, new.order_id, new.id)
    on conflict (return_id) do nothing;
  end if;
  perform public._notify(new.user_id, 'user', 'Cancellation penalty ₹' || v_amt::text, v_reason, '/wallet.html');
  perform public._audit('cancel_penalty', 'returns', new.id::text, jsonb_build_object('order_code', v_o.order_code, 'amount', v_amt, 'cancellations_today', v_n));
  return new;
end;
$$;
drop trigger if exists returns_cancel_penalty on public.returns;
create trigger returns_cancel_penalty after insert on public.returns for each row execute function public._cancel_penalty();

create or replace function public.admin_clear_dues(p_due_id bigint, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.customer_dues;
begin
  perform public._require_admin();
  p_note := btrim(coalesce(p_note, ''));
  if char_length(p_note) not between 3 and 500 then raise exception 'note_required'; end if;
  update public.customer_dues set cleared_at = now(), cleared_by = auth.uid(), cleared_note = p_note
  where id = p_due_id and cleared_at is null returning * into v;
  if not found then raise exception 'not_found'; end if;
  perform public._audit('dues_cleared', 'customer_dues', v.id::text, jsonb_build_object('user_id', v.user_id, 'amount', v.amount, 'note', p_note));
  return to_jsonb(v);
end;
$$;
create or replace function public.admin_list_dues()
returns setof jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin();
  return query select to_jsonb(d) || jsonb_build_object('customer_id', p.customer_id, 'customer_name', p.full_name)
    from public.customer_dues d left join public.profiles p on p.id = d.user_id order by d.cleared_at nulls first, d.created_at desc limit 500;
end;
$$;

-- ---------- 3. owner coins ----------
create or replace function public._owner_id() returns uuid
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id from public.profiles p
  where lower(p.email) = lower(coalesce(public._setting('owner_coins', 'owner_email'), 'ravitechsolution.shop@gmail.com')) and p.role = 'super_admin'
  limit 1;
$$;

create or replace function public._owner_coin_credit(p_coins bigint, p_note text, p_key text) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_owner uuid := public._owner_id(); v_s public.coin_settings; v_short bigint;
begin
  if v_owner is null or p_coins is null or p_coins <= 0 then return 0; end if;
  if exists (select 1 from public.coin_ledger where idempotency_key = p_key) then return 0; end if;   -- once per key
  select * into v_s from public.coin_settings where id = 1 for update;                               -- serialise treasury
  v_short := p_coins - public._coin_treasury_available();
  if v_short > 0 then                                    -- mint only what the treasury lacks, and record the new supply
    insert into public.coin_ledger (txn_ref, user_id, kind, coins, note, idempotency_key)
    values (public._unique_code('SZCN-', 10, 'public.coin_ledger', 'txn_ref'), null, 'mint', v_short, p_note || ' (mint)', p_key || ':mint');
    update public.coin_settings set total_supply = total_supply + v_short where id = 1;
  end if;
  insert into public.coin_ledger (txn_ref, user_id, kind, coins, note, idempotency_key)
  values (public._unique_code('SZCN-', 10, 'public.coin_ledger', 'txn_ref'), v_owner, 'issue', p_coins, p_note, p_key);
  perform public._audit('owner_coin_credit', 'coin_ledger', p_key, jsonb_build_object('coins', p_coins, 'note', p_note));
  return p_coins;
end;
$$;

create or replace function public.owner_monthly_coins(p_force boolean default false) returns bigint
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ist timestamp := now() at time zone 'Asia/Kolkata'; v_amt bigint;
begin
  if not p_force and extract(day from v_ist) <> 1 then return 0; end if;
  v_amt := coalesce(public._setting('owner_coins', 'monthly_amount'), '50000000')::bigint;
  return public._owner_coin_credit(v_amt, 'owner monthly credit ' || to_char(v_ist, 'YYYY-MM'), 'owner-monthly-' || to_char(v_ist, 'YYYY-MM'));
end;
$$;
revoke all on function public.owner_monthly_coins(boolean) from public, anon, authenticated;
revoke all on function public._owner_coin_credit(bigint, text, text) from public, anon, authenticated;

-- opening balance: top up only the difference
do $$
declare v_owner uuid := public._owner_id(); v_target bigint; v_need bigint;
begin
  if v_owner is null then raise notice 'owner not found; opening balance skipped'; return; end if;
  v_target := coalesce(public._setting('owner_coins', 'opening_balance'), '5000000000')::bigint;
  v_need := v_target - public._coin_balance(v_owner);
  if v_need > 0 then perform public._owner_coin_credit(v_need, 'owner opening balance', 'owner-opening-balance'); end if;
end $$;

create extension if not exists pg_cron;
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'shopzent-owner-monthly-coins';
  perform cron.schedule('shopzent-owner-monthly-coins', '35 18 * * *', 'select public.owner_monthly_coins()');  -- 00:05 IST daily; acts only on the 1st
end $$;

-- grants
revoke all on function public._setting(text, text) from public, anon, authenticated;
revoke all on function public._norm_in_phone(text) from public, anon;
revoke all on function public.admin_clear_dues(bigint, text) from public, anon;
revoke all on function public.admin_list_dues() from public, anon;
grant execute on function public.admin_clear_dues(bigint, text) to authenticated;
grant execute on function public.admin_list_dues() to authenticated;
notify pgrst, 'reload schema';
