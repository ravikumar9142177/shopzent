
-- 0030 coin-transfer-off tests. Run as ONE transaction: migration 0030 then this block. Ends with a raise (rolls back) and prints TESTLOG.
do $t$
declare
  U1 uuid := '00000000-0000-4000-8000-0000000000d1'; U2 uuid := '00000000-0000-4000-8000-0000000000d2';
  v_claims_u1 text; v_err text; v_fail int := 0; v_n int; v_keep jsonb;
begin
  perform set_config('tr.log', '', true);
  insert into auth.users (id, email) values (U1,'d1@example.test'),(U2,'d2@example.test');
  v_claims_u1 := json_build_object('sub', U1, 'role', 'authenticated', 'aal', 'aal1')::text;
  perform set_config('request.jwt.claims', v_claims_u1, true);

  -- 1) default: flag is stored as false, transfer request refused FIRST
  if (select (value->>'enabled')::boolean from public.site_settings where key = 'coin_transfer_enabled') is distinct from false then v_fail := v_fail + 1; end if;
  begin
    perform public.coin_transfer_request('SZC-ZZZZZZZZ', 1, 'test', 'k-0030-a');
    v_err := 'no_error';
  exception when others then v_err := sqlerrm; end;
  perform set_config('tr.log', current_setting('tr.log') || E'\n1 flag off -> ' || v_err, true);
  if v_err <> 'coin_transfer_disabled' then v_fail := v_fail + 1; end if;

  -- 2) the existing coin_transfer settings row and its values are untouched by the migration
  select value into v_keep from public.site_settings where key = 'coin_transfer';
  perform set_config('tr.log', current_setting('tr.log') || E'\n2 coin_transfer settings -> ' || coalesce(v_keep::text, 'null'), true);
  if v_keep is null then v_fail := v_fail + 1; end if;

  -- 3) flag turned on: the gate passes (the call then fails on its own rules, not on the flag)
  update public.site_settings set value = '{"enabled": true}'::jsonb where key = 'coin_transfer_enabled';
  begin
    perform public.coin_transfer_request('SZC-ZZZZZZZZ', 1, 'test', 'k-0030-b');
    v_err := 'no_error';
  exception when others then v_err := sqlerrm; end;
  perform set_config('tr.log', current_setting('tr.log') || E'\n3 flag on -> ' || v_err, true);
  if v_err = 'coin_transfer_disabled' or v_err = 'no_error' then v_fail := v_fail + 1; end if;

  -- 4) flag back off: refused again
  update public.site_settings set value = '{"enabled": false}'::jsonb where key = 'coin_transfer_enabled';
  begin
    perform public.coin_transfer_request('SZC-ZZZZZZZZ', 1, 'test', 'k-0030-c');
    v_err := 'no_error';
  exception when others then v_err := sqlerrm; end;
  perform set_config('tr.log', current_setting('tr.log') || E'\n4 flag off again -> ' || v_err, true);
  if v_err <> 'coin_transfer_disabled' then v_fail := v_fail + 1; end if;

  -- 5) admin RPCs and cancel still exist (history, approve, reject, cancel untouched)
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname in ('admin_list_coin_transfers','admin_approve_coin_transfer','admin_reject_coin_transfer','coin_transfer_cancel','my_coin_transfers');
  perform set_config('tr.log', current_setting('tr.log') || E'\n5 rpcs present -> ' || v_n, true);
  if v_n <> 5 then v_fail := v_fail + 1; end if;

  perform set_config('tr.log', current_setting('tr.log') || E'\nFAILS=' || v_fail, true);
  raise exception 'TESTLOG %', current_setting('tr.log');
end;
$t$;
