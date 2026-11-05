-- 0032 festival variants tests. Run as ONE transaction after migrations 0031 and 0032 (and the 0031 test, optional). Ends with a raise (rolls back).
do $t$
declare
  UA uuid := '00000000-0000-4000-8000-0000000000f3'; v_fail int := 0; v_err text; v_row jsonb; v_n int;
begin
  perform set_config('tr.log', '', true);
  insert into auth.users (id, email) values (UA, 'fb@example.test');
  update public.profiles set role = 'admin' where id = UA;
  perform set_config('request.jwt.claims', json_build_object('sub', UA, 'role', 'authenticated', 'aal', 'aal2', 'iat', extract(epoch from now())::bigint)::text, true);
  -- 1) a non-Diwali festival with variant 7 and tune off, custom tune link
  v_row := public.admin_set_festival('{"enabled":true,"theme":"chhath","variant":7,"tune":false,"tune_url":"https://example.supabase.co/storage/v1/object/public/public-media/settings/festival-audio/a.mp3"}'::jsonb);
  perform set_config('tr.log', current_setting('tr.log') || E'\n1 chhath v7 tune off saved: ' || (v_row->>'theme') || ' ' || (v_row->>'variant') || ' ' || (v_row->>'tune'), true);
  if v_row->>'theme' <> 'chhath' or (v_row->>'variant')::int <> 7 or (v_row->>'tune')::boolean is not false or v_row->>'tune_url' is null then v_fail := v_fail + 1; end if;
  -- 2) every festival id in the list is accepted
  v_n := 0;
  for v_err in select unnest(array['diwali', 'dhanteras', 'bhai-dooj', 'chhath', 'dussehra', 'navratri', 'durga-puja', 'karwa-chauth', 'holi', 'eid-ul-fitr', 'eid-ul-adha', 'christmas', 'new-year', 'republic-day', 'independence-day', 'raksha-bandhan', 'ganesh-chaturthi', 'janmashtami', 'makar-sankranti', 'lohri', 'pongal', 'baisakhi', 'onam', 'ram-navami', 'maha-shivratri', 'guru-nanak-jayanti', 'hanuman-jayanti', 'vasant-panchami', 'teej', 'ugadi', 'sale', 'none']) loop
    begin perform public.admin_set_festival(jsonb_build_object('enabled', false, 'theme', v_err)); v_n := v_n + 1; exception when others then null; end;
  end loop;
  perform set_config('tr.log', current_setting('tr.log') || E'\n2 festival ids accepted: ' || v_n, true);
  if v_n <> 32 then v_fail := v_fail + 1; end if;
  -- 3) refusals
  begin perform public.admin_set_festival('{"enabled":true,"theme":"chhath","variant":10}'::jsonb); v_err := 'no_error'; exception when others then v_err := sqlerrm; end;
  if v_err not like '%invalid_input%' then v_fail := v_fail + 1; end if;
  begin perform public.admin_set_festival('{"enabled":true,"theme":"nope"}'::jsonb); v_err := 'no_error'; exception when others then v_err := sqlerrm; end;
  if v_err not like '%invalid_input%' then v_fail := v_fail + 1; end if;
  begin perform public.admin_set_festival('{"enabled":true,"theme":"diwali","tune_url":"javascript:alert(1)"}'::jsonb); v_err := 'no_error'; exception when others then v_err := sqlerrm; end;
  if v_err not like '%invalid_input%' then v_fail := v_fail + 1; end if;
  begin perform public.admin_set_festival('{"enabled":true,"theme":"diwali","tune_url":"https://x.example/a.exe"}'::jsonb); v_err := 'no_error'; exception when others then v_err := sqlerrm; end;
  if v_err not like '%invalid_input%' then v_fail := v_fail + 1; end if;
  begin perform public.admin_set_festival('{"enabled":true,"theme":"diwali","tune":"maybe"}'::jsonb); v_err := 'no_error'; exception when others then v_err := sqlerrm; end;
  if v_err not like '%invalid_input%' then v_fail := v_fail + 1; end if;
  perform set_config('tr.log', current_setting('tr.log') || E'\n3 refusals (variant 10, unknown festival, javascript/exe tune link, bad tune flag) ok', true);
  -- 4) default tune is on, no custom file
  v_row := public.admin_set_festival('{"enabled":true,"theme":"diwali"}'::jsonb);
  if (v_row->>'tune')::boolean is not true or v_row->>'tune_url' is not null or (v_row->>'variant')::int <> 0 then v_fail := v_fail + 1; end if;
  perform set_config('tr.log', current_setting('tr.log') || E'\n4 defaults: tune=' || (v_row->>'tune') || ' custom=' || coalesce(v_row->>'tune_url', 'none'), true);
  perform set_config('tr.log', current_setting('tr.log') || E'\nFAILS=' || v_fail, true);
  raise exception 'TESTLOG %', current_setting('tr.log');
end;
$t$;
