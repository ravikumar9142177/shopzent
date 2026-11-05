-- Ran against the live DB inside begin; ... rollback; (as a real customer via set local role authenticated). Expected output: see the final report.
do $t$
declare
  v_buyer uuid := gen_random_uuid(); v_sharer uuid := gen_random_uuid(); v_admin uuid := gen_random_uuid();
  v_prod uuid; v_price numeric; v_code text; v_ref jsonb; v_items jsonb; v_ship jsonb; v_res jsonb; v_oid uuid;
  v_out text := ''; v_n int; v_bal bigint; v_bal2 bigint; v_rw bigint; v_ok boolean; v_err text;
  v_shcode text;
begin
  select id, price into v_prod, v_price from public.products where purchase_type='direct' and marketplace='shopzent' and published and price > 200 and availability='in_stock' order by price limit 1;
  v_out := v_out || 'prod price=' || v_price || E'\n';
  insert into auth.users (id, email, email_confirmed_at, aud, role, raw_app_meta_data, raw_user_meta_data)
  values (v_buyer, 'zz-test-buyer-w@example.com', now(), 'authenticated', 'authenticated', '{}', '{"full_name":"ZZ Buyer"}'),
         (v_sharer, 'zz-test-sharer-w@example.com', now(), 'authenticated', 'authenticated', '{}', '{"full_name":"ZZ Sharer"}'),
         (v_admin, 'zz-test-admin-w@example.com', now(), 'authenticated', 'authenticated', '{}', '{"full_name":"ZZ Admin"}');
  update public.profiles set phone=case when id=v_buyer then '9' || lpad(floor(random()*1e9)::text,9,'0') else '8' || lpad(floor(random()*1e9)::text,9,'0') end, status='active' where id in (v_buyer, v_sharer);
  update public.profiles set phone='7' || lpad(floor(random()*1e9)::text,9,'0'), status='active', role='super_admin' where id = v_admin;
  select customer_id into v_shcode from public.profiles where id = v_sharer;
  v_out := v_out || 'sharer code ok=' || (v_shcode ~ '^SZC-[A-Z0-9]{8}$') || E'\n';
  v_ship := jsonb_build_object('name','ZZ Buyer','phone',(select phone from public.profiles where id=v_buyer),'line1','Test street 1','city','Patna','state','Bihar','pincode','800001');
  v_items := jsonb_build_array(jsonb_build_object('product_id', v_prod, 'qty', 1));
  v_ref := jsonb_build_object('code', v_shcode, 'pid', v_prod::text, 't', (extract(epoch from now())*1000)::bigint::text);
  -- buyer context
  perform set_config('request.jwt.claims', json_build_object('sub', v_buyer, 'role','authenticated','aal','aal1','iat', extract(epoch from now())::bigint)::text, true);
  execute 'set local role authenticated';
  -- A: self-referral (sharer buys their own share link) -> no reward
  begin
    perform set_config('request.jwt.claims', json_build_object('sub', v_sharer, 'role','authenticated','aal','aal1','iat', extract(epoch from now())::bigint)::text, true);
    v_res := public.create_order(v_items, null, v_ship, 0, 'test-self-ref-0001', null, v_ref);
    reset role; select count(*) into v_n from public.referral_rewards where order_id = (v_res->>'order_id')::uuid; execute 'set local role authenticated';
    v_out := v_out || 'A self-ref rewards=' || v_n || E'\n';
  exception when others then v_out := v_out || 'A err ' || sqlerrm || E'\n'; end;
  -- B: different buyer with valid ref -> pending reward
  perform set_config('request.jwt.claims', json_build_object('sub', v_buyer, 'role','authenticated','aal','aal1','iat', extract(epoch from now())::bigint)::text, true);
  begin
    v_res := public.create_order(v_items, null, v_ship, 0, 'test-ref-buy-0001', null, v_ref);
    v_oid := (v_res->>'order_id')::uuid;
    reset role; select coalesce(max(coins),0), coalesce(max(status),'none') into v_rw, v_err from public.referral_rewards where order_id = v_oid; execute 'set local role authenticated';
    v_out := v_out || 'B ref reward coins=' || coalesce(v_rw::text,'none') || ' status=' || coalesce(v_err,'-') || ' expect floor(' || v_price || '*5/100)=' || floor(v_price*5/100) || E'\n';
  exception when others then v_out := v_out || 'B err ' || sqlerrm || E'\n'; end;
  -- B2: customer cannot read rewards table or call admin RPCs
  begin perform 1 from public.referral_rewards limit 1; v_out := v_out || 'B2 direct read: allowed (BAD)' || E'\n'; exception when others then v_out := v_out || 'B2 direct read blocked: ' || sqlerrm || E'\n'; end;
  begin perform public.admin_list_referral_rewards(null, 10); v_out := v_out || 'B3 customer admin list: allowed (BAD)' || E'\n'; exception when others then v_out := v_out || 'B3 customer admin list blocked: ' || sqlerrm || E'\n'; end;
  begin v_res := public.my_referral_summary(); v_out := v_out || 'B4 my summary pending=' || coalesce(v_res->>'pending_coins','?') || E'\n'; exception when others then v_out := v_out || 'B4 err ' || sqlerrm || E'\n'; end;
  -- C: pay out only when delivered + verified (run as the DB owner, the same way the admin RPCs do)
  reset role;
  update public.orders set payment_status='verified' where id = v_oid;
  select count(*) into v_n from public.referral_rewards where order_id = v_oid and status='pending';
  v_out := v_out || 'C after verify (not delivered) still pending=' || v_n || E'\n';
  update public.orders set status='delivered' where id = v_oid;
  select coalesce(max(status),'none'), coalesce(max(coins),0) into v_err, v_rw from public.referral_rewards where order_id = v_oid;
  v_bal := public._coin_balance(v_sharer);
  v_out := v_out || 'C after delivered: reward status=' || v_err || ' sharer balance=' || v_bal || E'\n';
  -- D: cancellation reverses the reward
  update public.orders set status='order_cancelled' where id = v_oid;
  select coalesce(max(status),'none') into v_err from public.referral_rewards where order_id = v_oid;
  v_bal2 := public._coin_balance(v_sharer);
  v_out := v_out || 'D after cancel: reward=' || v_err || ' sharer balance=' || v_bal2 || E'\n';
  -- E: coins at checkout (buyer gets 200 coins from the treasury first)
  perform public._referral_issue(v_buyer, 200, 'test grant', 'test-grant-'||v_buyer::text);
  perform set_config('request.jwt.claims', json_build_object('sub', v_buyer, 'role','authenticated','aal','aal1','iat', extract(epoch from now())::bigint)::text, true);
  execute 'set local role authenticated';
  begin
    v_res := public.create_order(v_items, null, v_ship, 0, 'test-coins-over-0001', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'size', '', 'coins', floor(v_price*5/100)+1)), null);
    v_out := v_out || 'E over-cap ACCEPTED (BAD)' || E'\n';
  exception when others then v_out := v_out || 'E over-cap blocked: ' || sqlerrm || E'\n'; end;
  begin
    v_res := public.create_order(v_items, null, v_ship, 0, 'test-coins-ok-0001', jsonb_build_array(jsonb_build_object('product_id', v_prod, 'size', '', 'coins', floor(v_price*5/100))), null);
    reset role; v_out := v_out || 'E coins_used col=' || coalesce((select coins_used::text from public.orders where id=(v_res->>'order_id')::uuid),'?') || ' disc=' || coalesce((select coin_discount::text from public.orders where id=(v_res->>'order_id')::uuid),'?') || ' total_db=' || coalesce((select total::text from public.orders where id=(v_res->>'order_id')::uuid),'?') || E'\n'; execute 'set local role authenticated';
    v_out := v_out || 'E in-cap total=' || coalesce(v_res->>'total','?') || ' coins_used=' || coalesce(v_res->>'coins_used','?') || ' discount=' || coalesce(v_res->>'coin_discount','?') || E'\n';
    v_oid := (v_res->>'order_id')::uuid;
  exception when others then v_out := v_out || 'E in-cap err ' || sqlerrm || E'\n'; end;
  reset role;
  v_out := v_out || 'E balance after redeem=' || public._coin_balance(v_buyer) || E'\n';
  update public.orders set status='order_cancelled' where id = v_oid;
  v_out := v_out || 'E balance after cancel (coins returned)=' || public._coin_balance(v_buyer) || E'\n';
  -- F: admin RPC as admin without fresh auth vs with
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated','aal','aal2','iat', extract(epoch from now())::bigint)::text, true);
  execute 'set local role authenticated';
  begin v_res := public.admin_list_referral_rewards(null, 50); v_out := v_out || 'F admin list totals=' || (v_res->'totals')::text || E'\n';
  exception when others then v_out := v_out || 'F admin err ' || sqlerrm || E'\n'; end;
  begin v_res := public.admin_set_product_referral_rate(v_prod, 9); v_out := v_out || 'F rate 9 ACCEPTED (BAD)' || E'\n';
  exception when others then v_out := v_out || 'F rate 9 blocked: ' || sqlerrm || E'\n'; end;
  begin v_res := public.admin_set_product_referral_rate(v_prod, 7); v_out := v_out || 'F rate 7 eff=' || coalesce(v_res->>'effective_rate','?') || E'\n';
  exception when others then v_out := v_out || 'F rate err ' || sqlerrm || E'\n'; end;
  reset role;
  raise exception E'RESULTS\n%', v_out;
end $t$;
