-- 0025: coin transfers between customers, admin-approved (never instant). Idempotent.
-- A request puts the sender's coins on HOLD (pending requests count against 'available').
-- Only an admin Approve moves coins: one transfer_out row (sender) and one transfer_in row (receiver).
-- Treasury accounting is untouched (transfer rows are user-to-user, not mint/issue). Coins are points: never money.

-- 1) ledger kinds: transfer_out / transfer_in
alter table public.coin_ledger drop constraint if exists coin_ledger_kind_check;
alter table public.coin_ledger add constraint coin_ledger_kind_check
  check (kind in ('mint', 'issue', 'redeem', 'reversal', 'expire', 'transfer_out', 'transfer_in'));

-- 2) balance now includes transfers (treasury helper deliberately unchanged)
create or replace function public._coin_balance(p_user_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(case when l.kind in ('issue', 'transfer_in') then l.coins else -l.coins end), 0)::bigint
  from public.coin_ledger l
  where l.user_id = p_user_id and l.kind in ('issue', 'redeem', 'reversal', 'expire', 'transfer_out', 'transfer_in');
$$;

-- 3) requests table
create table if not exists public.coin_transfer_requests (
  id bigserial primary key,
  request_ref text not null unique,
  sender_id uuid not null references public.profiles (id),
  receiver_id uuid not null references public.profiles (id),
  coins bigint not null check (coins > 0 and coins <= 1000000),
  note text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decision_reason text,
  decided_by uuid,
  decided_at timestamptz,
  sender_ledger_id bigint references public.coin_ledger (id),
  receiver_ledger_id bigint references public.coin_ledger (id),
  created_at timestamptz not null default now(),
  check (sender_id <> receiver_id)
);
create index if not exists coin_transfer_sender_idx on public.coin_transfer_requests (sender_id, created_at desc);
create index if not exists coin_transfer_status_idx on public.coin_transfer_requests (status, created_at desc);
alter table public.coin_transfer_requests enable row level security;
drop policy if exists coin_transfer_own_read on public.coin_transfer_requests;
create policy coin_transfer_own_read on public.coin_transfer_requests for select to authenticated using (sender_id = auth.uid());
revoke all on public.coin_transfer_requests from public, anon, authenticated;
grant select on public.coin_transfer_requests to authenticated;

-- settings (admin only, not public). Defaults: 1..5000 per request, 3 pending per sender, 2000 coins per sender per day
insert into public.site_settings (key, value, is_public)
values ('coin_transfer', '{"enabled": true, "min_coins": 1, "max_per_request": 5000, "max_pending": 3, "daily_cap": 2000}'::jsonb, false)
on conflict (key) do nothing;

-- 4) helpers
create or replace function public._coin_held(p_user_id uuid)
returns bigint language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(r.coins), 0)::bigint from public.coin_transfer_requests r where r.sender_id = p_user_id and r.status = 'pending';
$$;

create or replace function public._coin_available(p_user_id uuid)
returns bigint language sql stable security definer set search_path = public, pg_temp as $$
  select public._coin_balance(p_user_id) - public._coin_held(p_user_id);
$$;

create or replace function public._coin_transfer_cfg(p_field text, p_default bigint)
returns bigint language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select nullif(s.value ->> p_field, '')::bigint from public.site_settings s where s.key = 'coin_transfer'), p_default);
$$;

-- every debit (checkout redeem) must fit in what is AVAILABLE, i.e. not on hold for a pending transfer
create or replace function public._coin_redeem_guard()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if new.kind = 'redeem' and new.user_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('coins|' || new.user_id::text, 0));
    if public._coin_available(new.user_id) < new.coins then
      raise exception 'insufficient_coins';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists coin_ledger_redeem_guard on public.coin_ledger;
create trigger coin_ledger_redeem_guard before insert on public.coin_ledger
  for each row execute function public._coin_redeem_guard();

-- 5) customer: send a request (never instant)
create or replace function public.coin_transfer_request(p_receiver_code text, p_coins bigint, p_note text, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_uid uuid := auth.uid();
  v_me public.profiles%rowtype;
  v_recv public.profiles%rowtype;
  v_prev jsonb;
  v_code text := upper(btrim(coalesce(p_receiver_code, '')));
  v_note text := left(btrim(coalesce(p_note, '')), 200);
  v_min bigint; v_max bigint; v_maxpend bigint; v_cap bigint; v_today bigint; v_pending bigint; v_avail bigint;
  v_row public.coin_transfer_requests%rowtype;
  v_res jsonb;
begin
  if v_uid is null then raise exception 'login_required'; end if;
  select * into v_me from public.profiles where id = v_uid;
  if not found or v_me.status <> 'active' or v_me.role <> 'customer' then raise exception 'not_allowed'; end if;
  if not coalesce((select s.enabled from public.coin_settings s where s.id = 1), false)
     or coalesce((select (s.value ->> 'enabled')::boolean from public.site_settings s where s.key = 'coin_transfer'), true) is not true then
    raise exception 'coins_disabled';
  end if;
  v_prev := public._idem_begin('coin_transfer_request', p_idempotency_key);
  if v_prev is not null then return v_prev || jsonb_build_object('replayed', true); end if;

  v_min := public._coin_transfer_cfg('min_coins', 1);
  v_max := least(public._coin_transfer_cfg('max_per_request', 5000), 1000000);
  v_maxpend := public._coin_transfer_cfg('max_pending', 3);
  v_cap := public._coin_transfer_cfg('daily_cap', 2000);
  if p_coins is null or p_coins < greatest(v_min, 1) or p_coins > v_max then raise exception 'invalid_amount'; end if;
  if v_code !~ '^SZ[CW]-[A-Z0-9]{8}$' then raise exception 'receiver_not_found'; end if;

  select p.* into v_recv from public.profiles p left join public.wallets w on w.user_id = p.id
  where upper(p.customer_id) = v_code or upper(w.wallet_id) = v_code limit 1;
  if not found or v_recv.status <> 'active' or v_recv.role <> 'customer' then raise exception 'receiver_not_found'; end if;
  if v_recv.id = v_uid then raise exception 'self_transfer'; end if;

  perform pg_advisory_xact_lock(hashtextextended('coins|' || v_uid::text, 0));
  select count(*) into v_pending from public.coin_transfer_requests r where r.sender_id = v_uid and r.status = 'pending';
  if v_pending >= v_maxpend then raise exception 'too_many_pending'; end if;
  select coalesce(sum(r.coins), 0) into v_today from public.coin_transfer_requests r
    where r.sender_id = v_uid and r.status in ('pending', 'approved') and r.created_at >= public._today_ist_start();
  if v_today + p_coins > v_cap then raise exception 'daily_cap'; end if;
  v_avail := public._coin_available(v_uid);
  if p_coins > v_avail then raise exception 'insufficient_coins'; end if;

  insert into public.coin_transfer_requests (request_ref, sender_id, receiver_id, coins, note, status)
  values (public._unique_code('SZCT-', 8, 'public.coin_transfer_requests', 'request_ref'), v_uid, v_recv.id, p_coins,
          nullif(v_note, ''), 'pending')
  returning * into v_row;

  perform set_config('sz.notice_seen', '1', true);
  perform public._notify(v_uid, 'user', 'Coin transfer requested',
    p_coins::text || ' coins to ' || v_recv.customer_id || ' are waiting for admin approval. They stay on hold until then.', '/wallet.html');
  perform public._notify(v_recv.id, 'user', 'Coins may be coming to you',
    p_coins::text || ' coins from another SHOPZENT customer are waiting for admin approval. You will be told when they are added.', '/wallet.html');
  perform public._audit('coin_transfer_requested', 'coin_transfer_requests', v_row.id::text,
    jsonb_build_object('request_ref', v_row.request_ref, 'receiver', v_recv.customer_id, 'coins', p_coins));

  v_res := jsonb_build_object('id', v_row.id, 'request_ref', v_row.request_ref, 'status', v_row.status, 'coins', p_coins,
                              'receiver_customer_id', v_recv.customer_id, 'available_after', v_avail - p_coins);
  perform public._idem_store('coin_transfer_request', p_idempotency_key, v_res);
  return v_res || jsonb_build_object('replayed', false);
end;
$$;

-- 6) customer: cancel own pending request (releases the hold)
create or replace function public.coin_transfer_cancel(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare r public.coin_transfer_requests%rowtype;
begin
  if auth.uid() is null then raise exception 'login_required'; end if;
  select * into r from public.coin_transfer_requests where id = p_id and sender_id = auth.uid() for update;
  if not found then raise exception 'not_found'; end if;
  if r.status = 'cancelled' then return jsonb_build_object('id', r.id, 'status', r.status, 'replayed', true); end if;
  if r.status <> 'pending' then raise exception 'not_pending'; end if;
  update public.coin_transfer_requests set status = 'cancelled', decision_reason = 'Cancelled by sender', decided_at = now() where id = r.id;
  perform set_config('sz.notice_seen', '1', true);
  perform public._notify(r.sender_id, 'user', 'Coin transfer cancelled', 'Your request was cancelled. Those coins are free to use again.', '/wallet.html');
  perform public._audit('coin_transfer_cancelled', 'coin_transfer_requests', r.id::text, jsonb_build_object('request_ref', r.request_ref));
  return jsonb_build_object('id', r.id, 'status', 'cancelled', 'replayed', false);
end;
$$;

-- 7) customer: own balance, holds, available, limits and own requests (receiver shown only as customer ID)
create or replace function public.my_coin_transfers()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'login_required'; end if;
  return jsonb_build_object(
    'enabled', coalesce((select (s.value ->> 'enabled')::boolean from public.site_settings s where s.key = 'coin_transfer'), true)
               and coalesce((select c.enabled from public.coin_settings c where c.id = 1), false),
    'balance', public._coin_balance(v_uid),
    'held', public._coin_held(v_uid),
    'available', public._coin_available(v_uid),
    'limits', jsonb_build_object('min_coins', public._coin_transfer_cfg('min_coins', 1),
                                 'max_per_request', least(public._coin_transfer_cfg('max_per_request', 5000), 1000000),
                                 'max_pending', public._coin_transfer_cfg('max_pending', 3),
                                 'daily_cap', public._coin_transfer_cfg('daily_cap', 2000)),
    'used_today', coalesce((select sum(r.coins) from public.coin_transfer_requests r
                            where r.sender_id = v_uid and r.status in ('pending', 'approved') and r.created_at >= public._today_ist_start()), 0),
    'requests', coalesce((select jsonb_agg(x order by x.created_at desc) from (
        select r.id, r.request_ref, r.coins, r.status, r.decision_reason, r.created_at, r.decided_at, rp.customer_id as receiver_customer_id
        from public.coin_transfer_requests r join public.profiles rp on rp.id = r.receiver_id
        where r.sender_id = v_uid order by r.created_at desc limit 50) x), '[]'::jsonb),
    'note', 'Coins are points only. They cannot be withdrawn or turned into cash. They move to another customer only after admin approval.');
end;
$$;

-- my_coins: add held and available (keeps every existing key)
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
    'held', public._coin_held(auth.uid()),
    'available', public._coin_available(auth.uid()),
    'issued_total', coalesce((select sum(l.coins) from public.coin_ledger l where l.user_id = auth.uid() and l.kind = 'issue'), 0),
    'redeemed_total', coalesce((select sum(l.coins) from public.coin_ledger l where l.user_id = auth.uid() and l.kind = 'redeem'), 0),
    'reversed_total', coalesce((select sum(l.coins) from public.coin_ledger l where l.user_id = auth.uid() and l.kind = 'reversal'), 0),
    'expired_total', coalesce((select sum(l.coins) from public.coin_ledger l where l.user_id = auth.uid() and l.kind = 'expire'), 0),
    'transfer_in_total', coalesce((select sum(l.coins) from public.coin_ledger l where l.user_id = auth.uid() and l.kind = 'transfer_in'), 0),
    'transfer_out_total', coalesce((select sum(l.coins) from public.coin_ledger l where l.user_id = auth.uid() and l.kind = 'transfer_out'), 0),
    'note', 'SHOPZENT coins are loyalty points only. They are not money and cannot be withdrawn.');
end;
$$;

-- 8) admin: list, badge count, approve, reject, settings (AAL2 via _require_admin; writes set sz.notice_seen; audited)
create or replace function public.admin_coin_transfer_pending_count()
returns int language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin();
  return (select count(*)::int from public.coin_transfer_requests where status = 'pending');
end;
$$;

create or replace function public.admin_list_coin_transfers(p_status text default null, p_limit int default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_admin();
  return jsonb_build_object(
    'pending_count', (select count(*) from public.coin_transfer_requests where status = 'pending'),
    'settings', coalesce((select s.value from public.site_settings s where s.key = 'coin_transfer'), '{}'::jsonb),
    'rows', coalesce((select jsonb_agg(x) from (
        select r.id, r.request_ref, r.coins, r.status, r.note, r.decision_reason, r.created_at, r.decided_at,
               sp.customer_id as sender_customer_id, sp.full_name as sender_name,
               public._coin_balance(r.sender_id) as sender_balance, public._coin_held(r.sender_id) as sender_held,
               rp.customer_id as receiver_customer_id, rp.full_name as receiver_name
        from public.coin_transfer_requests r
          join public.profiles sp on sp.id = r.sender_id
          join public.profiles rp on rp.id = r.receiver_id
        where p_status is null or r.status = p_status
        order by (r.status = 'pending') desc, r.created_at desc
        limit least(greatest(coalesce(p_limit, 200), 1), 500)) x), '[]'::jsonb));
end;
$$;

create or replace function public.admin_approve_coin_transfer(p_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare r public.coin_transfer_requests%rowtype; v_out bigint; v_in bigint; v_bal bigint;
begin
  perform public._require_admin();
  perform public.require_fresh(15);
  select * into r from public.coin_transfer_requests where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if r.status = 'approved' then
    return jsonb_build_object('id', r.id, 'status', r.status, 'replayed', true, 'sender_ledger_id', r.sender_ledger_id, 'receiver_ledger_id', r.receiver_ledger_id);
  end if;
  if r.status <> 'pending' then raise exception 'not_pending'; end if;
  perform 1 from public.coin_settings where id = 1 for update;
  if not coalesce((select s.enabled from public.coin_settings s where s.id = 1), false) then raise exception 'coins_disabled'; end if;
  perform pg_advisory_xact_lock(hashtextextended('coins|' || r.sender_id::text, 0));
  v_bal := public._coin_balance(r.sender_id);
  if v_bal < r.coins then raise exception 'insufficient_coins'; end if;   -- e.g. coins expired since the request

  perform set_config('sz.notice_seen', '1', true);
  insert into public.coin_ledger (txn_ref, user_id, kind, coins, note, created_by, idempotency_key)
  values (public._unique_code('SZCN-', 10, 'public.coin_ledger', 'txn_ref'), r.sender_id, 'transfer_out', r.coins,
          'Coins sent to ' || (select customer_id from public.profiles where id = r.receiver_id) || ' (' || r.request_ref || ')',
          auth.uid(), 'coin-transfer-out:' || r.id::text)
  returning id into v_out;
  insert into public.coin_ledger (txn_ref, user_id, kind, coins, note, created_by, idempotency_key)
  values (public._unique_code('SZCN-', 10, 'public.coin_ledger', 'txn_ref'), r.receiver_id, 'transfer_in', r.coins,
          'Coins received (' || r.request_ref || ')', auth.uid(), 'coin-transfer-in:' || r.id::text)
  returning id into v_in;

  update public.coin_transfer_requests set status = 'approved', decided_by = auth.uid(), decided_at = now(),
         sender_ledger_id = v_out, receiver_ledger_id = v_in where id = r.id;
  perform public._notify(r.sender_id, 'user', 'Coin transfer approved', r.coins::text || ' coins were sent to the other customer.', '/wallet.html');
  perform public._notify(r.receiver_id, 'user', 'Coins added to your wallet', r.coins::text || ' coins from another SHOPZENT customer were added. Coins are points, not money.', '/wallet.html');
  perform public._audit('coin_transfer_approved', 'coin_transfer_requests', r.id::text,
    jsonb_build_object('request_ref', r.request_ref, 'coins', r.coins, 'sender_ledger_id', v_out, 'receiver_ledger_id', v_in));
  return jsonb_build_object('id', r.id, 'status', 'approved', 'replayed', false, 'sender_ledger_id', v_out, 'receiver_ledger_id', v_in);
end;
$$;

create or replace function public.admin_reject_coin_transfer(p_id bigint, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare r public.coin_transfer_requests%rowtype; v_reason text := left(btrim(coalesce(p_reason, '')), 300);
begin
  perform public._require_admin();
  perform public.require_fresh(15);
  if char_length(v_reason) < 3 then raise exception 'invalid_input' using detail = 'reason'; end if;
  select * into r from public.coin_transfer_requests where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if r.status = 'rejected' then return jsonb_build_object('id', r.id, 'status', r.status, 'replayed', true); end if;
  if r.status <> 'pending' then raise exception 'not_pending'; end if;
  perform set_config('sz.notice_seen', '1', true);
  update public.coin_transfer_requests set status = 'rejected', decision_reason = v_reason, decided_by = auth.uid(), decided_at = now() where id = r.id;
  perform public._notify(r.sender_id, 'user', 'Coin transfer not approved', 'Reason: ' || v_reason || '. Your coins are free to use again.', '/wallet.html');
  perform public._notify(r.receiver_id, 'user', 'Coin transfer not approved', 'A pending coin transfer to you was not approved.', '/wallet.html');
  perform public._audit('coin_transfer_rejected', 'coin_transfer_requests', r.id::text, jsonb_build_object('request_ref', r.request_ref, 'coins', r.coins, 'reason', v_reason));
  return jsonb_build_object('id', r.id, 'status', 'rejected', 'replayed', false);
end;
$$;

create or replace function public.admin_set_coin_transfer_settings(p_enabled boolean, p_min_coins bigint, p_max_per_request bigint, p_max_pending int, p_daily_cap bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v jsonb;
begin
  perform public._require_admin();
  perform public.require_fresh(15);
  if p_min_coins is null or p_min_coins < 1 or p_min_coins > 1000 then raise exception 'invalid_input' using detail = 'min_coins'; end if;
  if p_max_per_request is null or p_max_per_request < p_min_coins or p_max_per_request > 100000 then raise exception 'invalid_input' using detail = 'max_per_request'; end if;
  if p_max_pending is null or p_max_pending < 1 or p_max_pending > 20 then raise exception 'invalid_input' using detail = 'max_pending'; end if;
  if p_daily_cap is null or p_daily_cap < 1 or p_daily_cap > 1000000 then raise exception 'invalid_input' using detail = 'daily_cap'; end if;
  v := jsonb_build_object('enabled', coalesce(p_enabled, true), 'min_coins', p_min_coins, 'max_per_request', p_max_per_request,
                          'max_pending', p_max_pending, 'daily_cap', p_daily_cap);
  perform set_config('sz.notice_seen', '1', true);
  insert into public.site_settings (key, value, is_public, updated_by) values ('coin_transfer', v, false, auth.uid())
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;
  perform public._audit('coin_transfer_settings_updated', 'site_settings', 'coin_transfer', v);
  return v;
end;
$$;

-- 9) grants: helpers closed; customer and admin RPCs to authenticated only
revoke all on function public._coin_held(uuid), public._coin_available(uuid), public._coin_transfer_cfg(text, bigint),
  public._coin_redeem_guard() from public, anon, authenticated;
revoke all on function public.coin_transfer_request(text, bigint, text, text), public.coin_transfer_cancel(bigint), public.my_coin_transfers(),
  public.admin_coin_transfer_pending_count(), public.admin_list_coin_transfers(text, int), public.admin_approve_coin_transfer(bigint),
  public.admin_reject_coin_transfer(bigint, text), public.admin_set_coin_transfer_settings(boolean, bigint, bigint, int, bigint), public.my_coins()
  from public, anon;
grant execute on function public.coin_transfer_request(text, bigint, text, text), public.coin_transfer_cancel(bigint), public.my_coin_transfers(), public.my_coins() to authenticated;
grant execute on function public.admin_coin_transfer_pending_count(), public.admin_list_coin_transfers(text, int), public.admin_approve_coin_transfer(bigint),
  public.admin_reject_coin_transfer(bigint, text), public.admin_set_coin_transfer_settings(boolean, bigint, bigint, int, bigint) to authenticated;
notify pgrst, 'reload schema';
