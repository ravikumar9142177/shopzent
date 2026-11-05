-- Ran against the live DB inside begin; ... rollback;
do $t$
declare v_buyer uuid := gen_random_uuid(); v_admin uuid := gen_random_uuid(); v_prod uuid; v_res jsonb; v_oid uuid; v_out text := ''; v_ship jsonb; v_sum jsonb; v_pid2 uuid;
begin
  select id into v_prod from public.products where purchase_type='direct' and marketplace='shopzent' and published and price > 200 and availability='in_stock' order by price limit 1;
  select id into v_pid2 from public.products where purchase_type='direct' and marketplace='shopzent' and published and id <> v_prod and availability='in_stock' limit 1;
  insert into auth.users (id, email, email_confirmed_at, aud, role, raw_app_meta_data, raw_user_meta_data)
  values (v_buyer, 'zz-rv-buyer-'||v_buyer::text||'@example.com', now(), 'authenticated', 'authenticated', '{}', '{"full_name":"Ravi Kumar"}'),
         (v_admin, 'zz-rv-admin-'||v_admin::text||'@example.com', now(), 'authenticated', 'authenticated', '{}', '{"full_name":"ZZ Admin"}');
  update public.profiles set phone='9'||lpad(floor(random()*1e9)::text,9,'0'), status='active' where id = v_buyer;
  update public.profiles set phone='8'||lpad(floor(random()*1e9)::text,9,'0'), status='active', role='super_admin' where id = v_admin;
  select jsonb_build_object('name','ZZ Buyer','phone',phone,'line1','Test street 1','city','Patna','state','Bihar','pincode','800001') into v_ship from public.profiles where id=v_buyer;
  perform set_config('request.jwt.claims', json_build_object('sub', v_buyer, 'role','authenticated','aal','aal1','iat', extract(epoch from now())::bigint)::text, true);
  set local role authenticated;
  v_res := public.create_order(jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 1)), null, v_ship, 0, 'rv-test-order-01', null, null);
  v_oid := (v_res->>'order_id')::uuid;
  begin v_out := v_out || 'review before delivered: ' || public.submit_review(v_prod, 5, 'x')::text || E'\n'; exception when others then v_out := v_out || 'review before delivered blocked: ' || sqlerrm || E'\n'; end;
  reset role;
  update public.orders set payment_status='verified' where id=v_oid;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated','aal','aal2','iat', extract(epoch from now())::bigint)::text, true);
  set local role authenticated;
  begin v_res := public.admin_mark_delivered(v_oid, 'handed to courier, photo in drive'); v_out := v_out || 'mark delivered status=' || (v_res->>'status') || ' replayed=' || (v_res->>'replayed') || E'\n';
  exception when others then v_out := v_out || 'mark err ' || sqlerrm || E'\n'; end;
  begin v_res := public.admin_mark_delivered(v_oid, 'again'); v_out := v_out || 'mark again replayed=' || (v_res->>'replayed') || E'\n';
  exception when others then v_out := v_out || 'mark again err ' || sqlerrm || E'\n'; end;
  perform set_config('request.jwt.claims', json_build_object('sub', v_buyer, 'role','authenticated','aal','aal1','iat', extract(epoch from now())::bigint)::text, true);
  begin v_out := v_out || 'customer admin mark: ALLOWED (BAD)' || E'\n'; perform public.admin_mark_delivered(v_oid, 'x');
  exception when others then v_out := v_out || 'customer admin mark blocked: ' || sqlerrm || E'\n'; end;
  begin v_res := public.submit_review(v_prod, 4, '<img src=x onerror=alert(1)>Great <b>bag</b>'); v_out := v_out || 'review ok: ' || (v_res->>'saved') || E'\n';
  exception when others then v_out := v_out || 'review err ' || sqlerrm || E'\n'; end;
  begin v_res := public.submit_review(v_prod, 3, 'again'); v_out := v_out || 'second review ALLOWED (BAD)' || E'\n';
  exception when others then v_out := v_out || 'second review blocked: ' || sqlerrm || E'\n'; end;
  begin v_res := public.submit_review(v_pid2, 3, 'not bought'); v_out := v_out || 'not-bought review ALLOWED (BAD)' || E'\n';
  exception when others then v_out := v_out || 'not-bought blocked: ' || sqlerrm || E'\n'; end;
  begin v_res := public.submit_review(v_prod, 9, 'bad'); v_out := v_out || 'rating 9 ALLOWED (BAD)' || E'\n';
  exception when others then v_out := v_out || 'rating 9 blocked: ' || sqlerrm || E'\n'; end;
  reset role;
  v_sum := public.product_reviews_summary(v_prod, 20);
  v_out := v_out || 'summary (as postgres): ' || v_sum::text || E'\n';
  raise exception E'RESULTS\n%', v_out;
end $t$;
