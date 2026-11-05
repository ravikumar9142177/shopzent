-- 0031 festival studio tests. Run as ONE transaction: migration 0031 then this block. Ends with a raise (rolls back) and prints TESTLOG.
do $t$
declare
  U1 uuid := '00000000-0000-4000-8000-0000000000f1'; UA uuid := '00000000-0000-4000-8000-0000000000f2';
  v_fail int := 0; v_err text; v_row jsonb; v_n0 int; v_n1 int; v_sn0 timestamptz; v_sn1 timestamptz; v_cnt int;
begin
  perform set_config('tr.log', '', true);
  insert into auth.users (id, email) values (U1, 'f1@example.test'), (UA, 'fa@example.test');
  update public.profiles set role = 'admin' where id = UA;
  -- anon can read the public row (the storefront reads it)
  set local role anon;
  select count(*) into v_cnt from public.site_settings where key = 'festival' and is_public;
  reset role;
  perform set_config('tr.log', current_setting('tr.log') || E'\n0 anon reads festival row -> ' || v_cnt, true);
  if v_cnt <> 1 then v_fail := v_fail + 1; end if;

  -- 1) customer (aal1) refused
  perform set_config('request.jwt.claims', json_build_object('sub', U1, 'role', 'authenticated', 'aal', 'aal1', 'iat', extract(epoch from now())::bigint)::text, true);
  begin perform public.admin_set_festival('{"enabled":false}'::jsonb); v_err := 'no_error'; exception when others then v_err := sqlerrm; end;
  perform set_config('tr.log', current_setting('tr.log') || E'\n1 customer -> ' || v_err, true);
  if v_err not like '%not_authorized%' then v_fail := v_fail + 1; end if;

  -- 2) admin without aal2 refused
  perform set_config('request.jwt.claims', json_build_object('sub', UA, 'role', 'authenticated', 'aal', 'aal1', 'iat', extract(epoch from now())::bigint)::text, true);
  begin perform public.admin_set_festival('{"enabled":false}'::jsonb); v_err := 'no_error'; exception when others then v_err := sqlerrm; end;
  perform set_config('tr.log', current_setting('tr.log') || E'\n2 admin aal1 -> ' || v_err, true);
  if v_err not like '%mfa_required%' then v_fail := v_fail + 1; end if;

  -- 3) admin aal2 but stale sign-in refused
  perform set_config('request.jwt.claims', json_build_object('sub', UA, 'role', 'authenticated', 'aal', 'aal2', 'iat', extract(epoch from now() - interval '2 hours')::bigint)::text, true);
  begin perform public.admin_set_festival('{"enabled":false}'::jsonb); v_err := 'no_error'; exception when others then v_err := sqlerrm; end;
  perform set_config('tr.log', current_setting('tr.log') || E'\n3 stale -> ' || v_err, true);
  if v_err not like '%fresh_auth_required%' then v_fail := v_fail + 1; end if;

  -- admin aal2 fresh from here on
  perform set_config('request.jwt.claims', json_build_object('sub', UA, 'role', 'authenticated', 'aal', 'aal2', 'iat', extract(epoch from now())::bigint)::text, true);
  select last_sent_at, pending_since into v_sn0, v_sn1 from public.site_notice_state where id = 1;  -- v_sn0 = last_sent_at, v_sn1 = pending_since
  select count(*) into v_n0 from public.audit_log where action = 'festival_updated';

  -- 4) valid Diwali save: stored, normalised, audited, no customer update notice
  v_row := public.admin_set_festival(jsonb_build_object('enabled', true, 'theme', 'diwali', 'title', 'Happy <b>Diwali</b>', 'greeting', 'Shubh Deepawali 🪔',
            'intensity', 'high', 'accent', '#f59e0b', 'starts_at', '2026-11-08T00:00:00+05:30', 'ends_at', '2026-11-12T23:59:00+05:30',
            'offer', jsonb_build_object('enabled', true, 'headline', '20% OFF', 'text', 'Diwali sale', 'link', 'products.html', 'code', 'DIWALI20', 'show_code', false)));
  perform set_config('tr.log', current_setting('tr.log') || E'\n4 saved -> ' || (v_row->>'theme') || ' title=' || (v_row->>'title'), true);
  if v_row->>'theme' <> 'diwali' or v_row->>'title' like '%<%' or (v_row->'offer'->>'show_code')::boolean then v_fail := v_fail + 1; end if;
  if (select (value->>'enabled')::boolean from public.site_settings where key = 'festival') is not true then v_fail := v_fail + 1; end if;
  select count(*) into v_n1 from public.audit_log where action = 'festival_updated';
  if v_n1 <> v_n0 + 1 then v_fail := v_fail + 1; end if;
  declare v_after1 timestamptz; v_after2 timestamptz; begin
    select last_sent_at, pending_since into v_after1, v_after2 from public.site_notice_state where id = 1;
    if v_after1 is distinct from v_sn0 or v_after2 is distinct from v_sn1 then v_fail := v_fail + 1; end if;
  end;
  perform set_config('tr.log', current_setting('tr.log') || E'\n4b audit +' || (v_n1 - v_n0) || ', notice state unchanged', true);

  -- 5) invalid inputs refused
  begin perform public.admin_set_festival('{"enabled":true,"theme":"xmas-party"}'::jsonb); v_err := 'no_error'; exception when others then v_err := sqlerrm; end;
  if v_err not like '%invalid_input%' then v_fail := v_fail + 1; end if;
  begin perform public.admin_set_festival('{"enabled":true,"accent":"red"}'::jsonb); v_err := 'no_error'; exception when others then v_err := sqlerrm; end;
  if v_err not like '%invalid_input%' then v_fail := v_fail + 1; end if;
  begin perform public.admin_set_festival('{"enabled":true,"offer":{"link":"javascript:alert(1)"}}'::jsonb); v_err := 'no_error'; exception when others then v_err := sqlerrm; end;
  if v_err not like '%invalid_input%' then v_fail := v_fail + 1; end if;
  begin perform public.admin_set_festival('{"enabled":true,"starts_at":"2026-11-12T00:00:00+05:30","ends_at":"2026-11-10T00:00:00+05:30"}'::jsonb); v_err := 'no_error'; exception when others then v_err := sqlerrm; end;
  if v_err not like '%invalid_input%' then v_fail := v_fail + 1; end if;
  begin perform public.admin_set_festival('{"enabled":"yes"}'::jsonb); v_err := 'no_error'; exception when others then v_err := sqlerrm; end;
  if v_err not like '%invalid_input%' then v_fail := v_fail + 1; end if;
  begin perform public.admin_set_festival('{"enabled":true,"intensity":"extreme"}'::jsonb); v_err := 'no_error'; exception when others then v_err := sqlerrm; end;
  if v_err not like '%invalid_input%' then v_fail := v_fail + 1; end if;
  begin perform public.admin_set_festival('{"enabled":true,"offer":{"code":"A B"}}'::jsonb); v_err := 'no_error'; exception when others then v_err := sqlerrm; end;
  if v_err not like '%invalid_input%' then v_fail := v_fail + 1; end if;
  perform set_config('tr.log', current_setting('tr.log') || E'\n5 invalid inputs refused (7 cases)', true);

  -- 6) reset to normal: off, storefront loads nothing
  v_row := public.admin_reset_festival();
  perform set_config('tr.log', current_setting('tr.log') || E'\n6 reset -> enabled=' || (v_row->>'enabled') || ' theme=' || (v_row->>'theme'), true);
  if (v_row->>'enabled')::boolean is not false or v_row->>'theme' <> 'none' then v_fail := v_fail + 1; end if;

  -- 7) customer cannot reset either
  perform set_config('request.jwt.claims', json_build_object('sub', U1, 'role', 'authenticated', 'aal', 'aal1', 'iat', extract(epoch from now())::bigint)::text, true);
  begin perform public.admin_reset_festival(); v_err := 'no_error'; exception when others then v_err := sqlerrm; end;
  if v_err not like '%not_authorized%' then v_fail := v_fail + 1; end if;
  perform set_config('tr.log', current_setting('tr.log') || E'\n7 customer reset -> ' || v_err, true);

  perform set_config('tr.log', current_setting('tr.log') || E'\nFAILS=' || v_fail, true);
  raise exception 'TESTLOG %', current_setting('tr.log');
end;
$t$;
