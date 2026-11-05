-- SHOPZENT 0030: friend-to-friend coin transfers are switched OFF (Suraj, 2026-11-06: customers must not send coins to friends).
-- Nothing is deleted: existing coin_transfer_requests rows, their holds, the admin approve/reject/history RPCs and the
-- coin_transfer settings all stay as they were. The customer request-creation RPC now refuses first, unless the flag below
-- is turned on (site_settings key coin_transfer_enabled, value {"enabled": true}). Default: off. Idempotent.
-- Pending requests that already exist can still be approved, rejected or cancelled by the admin / the sender.
select set_config('sz.notice_seen', '1', false);

insert into public.site_settings (key, value, is_public)
values ('coin_transfer_enabled', '{"enabled": false}'::jsonb, false)
on conflict (key) do nothing;

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
  -- 0030: friend-to-friend coin transfer is OFF (Suraj's request). Checked first; flip site_settings.coin_transfer_enabled to true to turn it back on.
  if not coalesce((select (s.value ->> 'enabled')::boolean from public.site_settings s where s.key = 'coin_transfer_enabled'), false) then
    raise exception 'coin_transfer_disabled';
  end if;
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

notify pgrst, 'reload schema';
