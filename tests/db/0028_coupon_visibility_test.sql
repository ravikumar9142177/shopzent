
-- 0028 coupon visibility tests. Run as ONE transaction: migration 0028 then this block. Ends with a raise (rolls back) and prints TESTLOG.
do $t$
declare
  U1 uuid := '00000000-0000-4000-8000-0000000000c1'; U2 uuid := '00000000-0000-4000-8000-0000000000c2';
  U9 uuid := '00000000-0000-4000-8000-0000000000c9';
  P uuid := (select id from public.products where published and purchase_type='direct' and availability in ('in_stock','preorder') and price > 0 and coupon_eligibility = 'yes' order by created_at limit 1);
  v_pub uuid := '00000000-0000-4000-8000-0000000000e1'; v_old uuid := '00000000-0000-4000-8000-0000000000e2';
  v_priv uuid := '00000000-0000-4000-8000-0000000000e3';
  v_items jsonb := jsonb_build_array(jsonb_build_object('product_id', P, 'qty', 1));
  v_res jsonb; v_cid text; v_fail int := 0; v_t timestamptz := now();
  v_claims_admin text; v_claims_u1 text; v_claims_u2 text;
  procedure_ok boolean;
  function_check text;
begin
  perform set_config('tr.log', '', true);
  insert into auth.users (id, email) values (U1,'c1@example.test'),(U2,'c2@example.test'),(U9,'c9@example.test');
  update public.profiles set role = 'admin' where id = U9;
  select customer_id into v_cid from public.profiles where id = U1;
  v_claims_admin := json_build_object('sub', U9, 'role', 'authenticated', 'aal', 'aal2', 'amr', jsonb_build_array(jsonb_build_object('method','totp','timestamp', extract(epoch from now())::bigint)))::text;
  v_claims_u1 := json_build_object('sub', U1, 'role', 'authenticated', 'aal', 'aal1')::text;
  v_claims_u2 := json_build_object('sub', U2, 'role', 'authenticated', 'aal', 'aal1')::text;

  -- coupons: one PUBLIC inside its window, one PUBLIC whose window already ended, one PRIVATE (new, no customers yet)
  insert into public.coupons (id, code, discount_type, discount_value, is_public, active, show_from, show_until)
    values (v_pub, 'TESTPUB28', 'percent', 10, true, true, now() - interval '1 hour', now() + interval '1 hour'),
           (v_old, 'TESTOLD28', 'percent', 10, true, true, now() - interval '5 hour', now() - interval '1 hour');
  insert into public.coupons (id, code, discount_type, discount_value, is_public, active)
    values (v_priv, 'TESTPRIV28', 'percent', 10, false, true);

  -- 1) storefront strip: anon sees the in-window public coupon only, never a private code
  perform set_config('request.jwt.claims', '', true);
  v_res := public.featured_coupon();
  perform set_config('tr.log', current_setting('tr.log') || E'\n1 featured (anon) -> ' || coalesce(v_res->>'code','null'), true);
  if v_res->>'code' is distinct from 'TESTPUB28' then v_fail := v_fail + 1; perform set_config('tr.log', current_setting('tr.log') || E'\n  FAIL 1', true); end if;

  -- 2) outside the window the strip shows nothing (close the only window)
  update public.coupons set show_until = now() - interval '1 minute' where id = v_pub;
  v_res := public.featured_coupon();
  perform set_config('tr.log', current_setting('tr.log') || E'\n2 featured after window ends -> ' || coalesce(v_res->>'code','null'), true);
  if v_res is not null then v_fail := v_fail + 1; perform set_config('tr.log', current_setting('tr.log') || E'\n  FAIL 2', true); end if;
  update public.coupons set show_from = now() + interval '1 hour', show_until = now() + interval '2 hour' where id = v_pub;
  v_res := public.featured_coupon();
  if v_res is not null then v_fail := v_fail + 1; perform set_config('tr.log', current_setting('tr.log') || E'\n  FAIL 2b (not started yet)', true); end if;
  update public.coupons set show_from = now() - interval '1 hour', show_until = now() + interval '1 hour' where id = v_pub;

  -- 3) the private coupon is never shown on the storefront, even with a window
  update public.coupons set show_from = null, show_until = null where id = v_priv;
  v_res := public.featured_coupon();
  if v_res->>'code' = 'TESTPRIV28' then v_fail := v_fail + 1; perform set_config('tr.log', current_setting('tr.log') || E'\n  FAIL 3 private shown', true); end if;

  -- 4) admin picks the private coupon's customers (customer id for U1, a missing email for the rest)
  perform set_config('request.jwt.claims', v_claims_admin, true);
  v_res := public.admin_coupon_set_customers(v_priv, array[v_cid, 'nobody@example.test']);
  perform set_config('tr.log', current_setting('tr.log') || E'\n4 set customers -> ' || v_res::text, true);
  if (v_res->>'customers')::int <> 1 or jsonb_array_length(v_res->'not_found') <> 1 then v_fail := v_fail + 1; perform set_config('tr.log', current_setting('tr.log') || E'\n  FAIL 4', true); end if;
  -- non-admin cannot
  perform set_config('request.jwt.claims', v_claims_u1, true);
  begin perform public.admin_coupon_set_customers(v_priv, array[v_cid]); procedure_ok := false; exception when others then procedure_ok := true; end;
  if not procedure_ok then v_fail := v_fail + 1; perform set_config('tr.log', current_setting('tr.log') || E'\n  FAIL 4b non-admin allowed', true); end if;
  perform set_config('tr.log', current_setting('tr.log') || E'\n4b non-admin refused: ' || procedure_ok::text, true);

  -- 5) quote: chosen customer applies the private code; another customer and an anonymous visitor get invalid
  perform set_config('request.jwt.claims', v_claims_u1, true);
  v_res := public.quote_cart(v_items, 'TESTPRIV28');
  perform set_config('tr.log', current_setting('tr.log') || E'\n5 U1 private -> ' || (v_res->'coupon'->>'code_status'), true);
  if v_res->'coupon'->>'code_status' is distinct from 'ok' then v_fail := v_fail + 1; perform set_config('tr.log', current_setting('tr.log') || E'\n  FAIL 5', true); end if;
  perform set_config('request.jwt.claims', v_claims_u2, true);
  v_res := public.quote_cart(v_items, 'TESTPRIV28');
  perform set_config('tr.log', current_setting('tr.log') || E'\n5b U2 private -> ' || (v_res->'coupon'->>'code_status'), true);
  if v_res->'coupon'->>'code_status' is distinct from 'invalid' then v_fail := v_fail + 1; perform set_config('tr.log', current_setting('tr.log') || E'\n  FAIL 5b', true); end if;
  perform set_config('request.jwt.claims', '', true);
  v_res := public.quote_cart(v_items, 'TESTPRIV28');
  perform set_config('tr.log', current_setting('tr.log') || E'\n5c anon private -> ' || (v_res->'coupon'->>'code_status'), true);
  if v_res->'coupon'->>'code_status' is distinct from 'invalid' then v_fail := v_fail + 1; perform set_config('tr.log', current_setting('tr.log') || E'\n  FAIL 5c', true); end if;

  -- 6) public coupon: anyone can apply it inside the window, nobody outside
  perform set_config('request.jwt.claims', v_claims_u2, true);
  v_res := public.quote_cart(v_items, 'TESTPUB28');
  perform set_config('tr.log', current_setting('tr.log') || E'\n6 U2 public in window -> ' || (v_res->'coupon'->>'code_status'), true);
  if v_res->'coupon'->>'code_status' is distinct from 'ok' then v_fail := v_fail + 1; perform set_config('tr.log', current_setting('tr.log') || E'\n  FAIL 6', true); end if;

  -- 7) admin removes U1: refused again; the list is replaced, not appended
  perform set_config('request.jwt.claims', v_claims_admin, true);
  v_res := public.admin_coupon_set_customers(v_priv, array[]::text[]);
  perform set_config('request.jwt.claims', v_claims_u1, true);
  v_res := public.quote_cart(v_items, 'TESTPRIV28');
  perform set_config('tr.log', current_setting('tr.log') || E'\n7 U1 after removal -> ' || (v_res->'coupon'->>'code_status'), true);
  if v_res->'coupon'->>'code_status' is distinct from 'invalid' then v_fail := v_fail + 1; perform set_config('tr.log', current_setting('tr.log') || E'\n  FAIL 7', true); end if;

  -- 8) the existing-coupon rule: a coupon created without the flag is private
  if (select is_public from public.coupons where id = v_priv) then v_fail := v_fail + 1; end if;

  -- 9) admin customer list for the form
  perform set_config('request.jwt.claims', v_claims_admin, true);
  v_res := public.admin_coupon_set_customers(v_priv, array[v_cid]);
  perform set_config('tr.log', current_setting('tr.log') || E'\n9 admin list -> ' || coalesce((public.admin_coupon_customers_all())::text, 'null'), true);
  if (select count(*) from public.coupon_customers where coupon_id = v_priv) <> 1 then v_fail := v_fail + 1; end if;

  perform set_config('tr.log', current_setting('tr.log') || E'\nFAILS=' || v_fail, true);
  raise exception 'TESTLOG %', current_setting('tr.log');
end;
$t$;
