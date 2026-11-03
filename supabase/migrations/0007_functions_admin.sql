-- SHOPZENT 0007: admin RPC functions (is_admin() = admin/super_admin + active + aal2)

create or replace function public.admin_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_admin();
  return jsonb_build_object(
    'users', (select count(*) from public.profiles),
    'products', (select count(*) from public.products),
    'products_published', (select count(*) from public.products where published),
    'orders', (select count(*) from public.orders),
    'orders_pending', (select count(*) from public.orders where status in ('payment_pending', 'payment_submitted', 'under_verification', 'payment_verified')),
    'orders_confirmed', (select count(*) from public.orders where status in ('order_confirmed', 'processing', 'shipped', 'delivered')),
    'orders_rejected', (select count(*) from public.orders where status = 'order_rejected'),
    'orders_cancelled', (select count(*) from public.orders where status = 'order_cancelled'),
    'orders_paid', (select count(*) from public.orders where payment_status = 'verified'),
    'payments_pending', (select count(*) from public.payment_submissions where status in ('submitted', 'under_verification')),
    'returns_open', (select count(*) from public.returns where status not in ('return_rejected', 'wallet_credited', 'refund_completed')),
    'coupon_redemptions', (select count(*) from public.coupon_redemptions where not voided),
    'wallet_liability', (select coalesce(sum(case when direction = 'credit' then amount else -amount end) filter (where status = 'posted' or direction = 'debit'), 0) from public.wallet_ledger),
    'coins_issued', (select coalesce(sum(coins), 0) from public.coin_ledger where kind = 'issue') - (select coalesce(sum(coins), 0) from public.coin_ledger where kind = 'reversal'),
    'coins_available', public._coin_treasury_available(),
    'affiliate_clicks', (select count(*) from public.affiliate_clicks),
    'ad_impressions', (select coalesce(sum(impressions), 0) from public.ads),
    'ad_clicks', (select coalesce(sum(clicks), 0) from public.ads),
    'unread_admin_notifications', (select count(*) from public.notifications where audience = 'admin' and read_at is null),
    'recent', coalesce((select jsonb_agg(to_jsonb(a) order by a.id desc) from (select * from public.audit_log order by id desc limit 20) a), '[]'::jsonb));
end;
$$;

create or replace function public.admin_security_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_admins jsonb;
  v_storage_bytes bigint := null;
  v_storage_objects bigint := null;
  v_no_rls jsonb;
begin
  perform public._require_admin();
  begin
    select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'email', p.email, 'role', p.role, 'status', p.status,
             'mfa_enrolled', exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status::text = 'verified'))
             order by p.role desc, p.email), '[]'::jsonb)
      into v_admins from public.profiles p where p.role in ('admin', 'super_admin');
  exception when others then
    select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'email', p.email, 'role', p.role, 'status', p.status, 'mfa_enrolled', null)), '[]'::jsonb)
      into v_admins from public.profiles p where p.role in ('admin', 'super_admin');
  end;
  begin
    select coalesce(sum(nullif(o.metadata ->> 'size', '')::bigint), 0), count(*) into v_storage_bytes, v_storage_objects from storage.objects o;
  exception when others then
    v_storage_bytes := null;
  end;
  select coalesce(jsonb_agg(c.relname order by c.relname), '[]'::jsonb) into v_no_rls
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relkind in ('r', 'p') and not c.relrowsecurity;

  return jsonb_build_object(
    'failed_logins_24h', (select count(*) from public.login_attempts where not success and created_at > now() - interval '24 hours'),
    'failed_logins_1h', (select count(*) from public.login_attempts where not success and created_at > now() - interval '1 hour'),
    'locked_keys', (select count(*) from (select email_hash, ip_hash from public.login_attempts
                     where not success and created_at > now() - interval '60 seconds' group by 1, 2 having count(*) >= 10) x),
    'mfa_failures_24h', (select count(*) from public.audit_log where action = 'mfa_failure' and created_at > now() - interval '24 hours'),
    'duplicate_utr_attempts_7d', (select count(*) from public.duplicate_utr_attempts where created_at > now() - interval '7 days'),
    'suspicious', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('kind', 'failed_logins_by_ip', 'ip_hash', left(ip_hash, 12), 'count', count(*)) as x
        from public.login_attempts where not success and created_at > now() - interval '24 hours'
        group by ip_hash having count(*) >= 20
        union all
        select jsonb_build_object('kind', 'failed_logins_by_account', 'email_hash', left(email_hash, 12), 'count', count(*))
        from public.login_attempts where not success and created_at > now() - interval '24 hours'
        group by email_hash having count(*) >= 10
        union all
        select jsonb_build_object('kind', 'duplicate_utr', 'utr_last4', right(utr_normalized, 4), 'user_id', user_id, 'at', created_at)
        from public.duplicate_utr_attempts where created_at > now() - interval '7 days'
        union all
        select jsonb_build_object('kind', 'mfa_recovery_used', 'actor_id', actor_id, 'at', created_at)
        from public.audit_log where action = 'mfa_recovery_used' and created_at > now() - interval '7 days'
      ) s), '[]'::jsonb),
    'recent_events', coalesce((select jsonb_agg(to_jsonb(a) order by a.id desc) from (
        select * from public.audit_log
        where action in ('admin_login_success', 'login_failed', 'login_locked', 'mfa_failure', 'mfa_enrolled', 'mfa_removed', 'password_changed',
                         'logout_all', 'permission_change', 'user_status_change', 'setting_change', 'mfa_recovery_used', 'mfa_recovery_failed',
                         'duplicate_utr_attempt', 'bootstrap_super_admin', 'mfa_recovery_codes_generated', 'apk_verified')
        order by id desc limit 50) a), '[]'::jsonb),
    'admins', v_admins,
    'db_size_bytes', pg_database_size(current_database()),
    'storage_bytes', v_storage_bytes,
    'storage_objects', v_storage_objects,
    'config', jsonb_build_object(
      'rls_all_tables', jsonb_array_length(v_no_rls) = 0,
      'tables_without_rls', v_no_rls,
      'coins_enabled', (select enabled from public.coin_settings where id = 1),
      'upi_configured', coalesce((select coalesce(value ->> 'upi_id', '') <> '' from public.site_settings where key = 'payment'), false),
      'super_admins', (select count(*) from public.profiles where role = 'super_admin' and status = 'active'),
      'admins_without_mfa', (select count(*) from jsonb_array_elements(v_admins) e where (e ->> 'mfa_enrolled') = 'false')));
end;
$$;

create or replace function public.admin_search_customers(p_q text)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_q text := btrim(coalesce(p_q, ''));
begin
  perform public._require_admin();
  return query
  select jsonb_build_object('id', p.id, 'customer_id', p.customer_id, 'wallet_id', w.wallet_id, 'full_name', p.full_name,
         'email', p.email, 'mobile', p.mobile, 'status', p.status, 'role', p.role, 'created_at', p.created_at,
         'wallet_balance', public._wallet_available(p.id), 'coin_balance', public._coin_balance(p.id))
  from public.profiles p left join public.wallets w on w.user_id = p.id
  where v_q = ''
     or upper(p.customer_id) = upper(v_q) or upper(w.wallet_id) = upper(v_q)
     or p.email ilike '%' || v_q || '%' or p.mobile like '%' || v_q || '%' or p.full_name ilike '%' || v_q || '%'
  order by p.created_at desc
  limit 50;
end;
$$;

create or replace function public.admin_list_users(p_q text default null, p_limit int default 100)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_q text := btrim(coalesce(p_q, ''));
begin
  perform public._require_admin();
  return query
  select jsonb_build_object('id', p.id, 'customer_id', p.customer_id, 'wallet_id', w.wallet_id, 'full_name', p.full_name,
         'email', p.email, 'mobile', p.mobile, 'status', p.status, 'role', p.role, 'created_at', p.created_at,
         'orders', (select count(*) from public.orders o where o.user_id = p.id))
  from public.profiles p left join public.wallets w on w.user_id = p.id
  where v_q = '' or upper(p.customer_id) = upper(v_q) or upper(w.wallet_id) = upper(v_q)
     or p.email ilike '%' || v_q || '%' or p.mobile like '%' || v_q || '%' or p.full_name ilike '%' || v_q || '%'
  order by p.created_at desc
  limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;

create or replace function public.admin_list_orders(p_q text default null, p_status text default null, p_limit int default 50, p_offset int default 0)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_q text := btrim(coalesce(p_q, ''));
begin
  perform public._require_admin();
  return query
  select to_jsonb(o) || jsonb_build_object(
           'customer_id', p.customer_id, 'customer_name', p.full_name, 'customer_mobile', p.mobile, 'customer_email', p.email,
           'latest_submission', (select to_jsonb(s) from public.payment_submissions s where s.order_id = o.id order by s.created_at desc limit 1),
           'item_count', (select coalesce(sum(i.qty), 0) from public.order_items i where i.order_id = o.id))
  from public.orders o join public.profiles p on p.id = o.user_id
  where (p_status is null or p_status = '' or o.status = p_status)
    and (v_q = '' or upper(o.order_code) = upper(v_q) or upper(o.order_code) like upper(v_q) || '%'
         or upper(p.customer_id) = upper(v_q) or p.mobile like '%' || v_q || '%' or o.ship_phone like '%' || v_q || '%'
         or p.email ilike '%' || v_q || '%')
  order by o.created_at desc
  limit least(greatest(coalesce(p_limit, 50), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
end;
$$;

create or replace function public.admin_order_detail(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_o public.orders;
begin
  perform public._require_admin();
  select * into v_o from public.orders where id = p_order_id;
  if not found then
    raise exception 'not_found';
  end if;
  return jsonb_build_object(
    'order', to_jsonb(v_o),
    'items', coalesce((select jsonb_agg(to_jsonb(i)) from public.order_items i where i.order_id = v_o.id), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.id) from public.order_events e where e.order_id = v_o.id), '[]'::jsonb),
    'submissions', coalesce((select jsonb_agg(to_jsonb(s) order by s.created_at desc) from public.payment_submissions s where s.order_id = v_o.id), '[]'::jsonb),
    'returns', coalesce((select jsonb_agg(to_jsonb(r) order by r.created_at desc) from public.returns r where r.order_id = v_o.id), '[]'::jsonb),
    'refunds', coalesce((select jsonb_agg(to_jsonb(f) order by f.id) from public.refund_ledger f where f.order_id = v_o.id), '[]'::jsonb),
    'wallet_entries', coalesce((select jsonb_agg(to_jsonb(l) order by l.id) from public.wallet_ledger l where l.order_id = v_o.id), '[]'::jsonb),
    'refund_summary', public._refund_room(v_o.id),
    'customer', (select jsonb_build_object('id', p.id, 'customer_id', p.customer_id, 'wallet_id', w.wallet_id, 'full_name', p.full_name,
                        'email', p.email, 'mobile', p.mobile, 'status', p.status)
                 from public.profiles p left join public.wallets w on w.user_id = p.id where p.id = v_o.user_id));
end;
$$;

-- paid / refunded / room for one order
create or replace function public._refund_room(p_order_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_o public.orders;
  v_paid numeric := 0;
  v_refunded numeric;
  v_cash_refunded numeric;
  v_wallet_returned numeric;
begin
  select * into v_o from public.orders where id = p_order_id;
  if v_o.payment_status = 'verified' then
    v_paid := v_o.total + v_o.wallet_used;
  end if;
  select coalesce(sum(amount), 0) into v_refunded from public.refund_ledger where order_id = p_order_id and status <> 'failed';
  select coalesce(sum(amount), 0) into v_cash_refunded from public.refund_ledger
    where order_id = p_order_id and status <> 'failed' and method = 'original_payment';
  select coalesce(sum(amount), 0) into v_wallet_returned from public.wallet_ledger
    where order_id = p_order_id and kind = 'reversal' and direction = 'credit';
  return jsonb_build_object(
    'paid', v_paid,
    'paid_upi', case when v_o.payment_status = 'verified' then v_o.total else 0 end,
    'paid_wallet', case when v_o.payment_status = 'verified' then v_o.wallet_used else 0 end,
    'refunded', v_refunded,
    'wallet_returned', v_wallet_returned,
    'refundable', greatest(v_paid - v_refunded - v_wallet_returned, 0),
    'refundable_to_original', greatest(least(case when v_o.payment_status = 'verified' then v_o.total else 0 end - v_cash_refunded,
                                             v_paid - v_refunded - v_wallet_returned), 0));
end;
$$;

-- ---------------------------------------------------------------------------
-- Payment verification
-- ---------------------------------------------------------------------------
create or replace function public.admin_mark_under_verification(p_submission_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_s public.payment_submissions;
  v_o public.orders;
begin
  perform public._require_admin();
  select * into v_s from public.payment_submissions where id = p_submission_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  select * into v_o from public.orders where id = v_s.order_id for update;
  if v_s.status = 'under_verification' then
    return jsonb_build_object('submission_id', v_s.id, 'status', v_s.status, 'order_status', v_o.status);
  end if;
  if v_s.status <> 'submitted' or v_o.status <> 'payment_submitted' then
    raise exception 'invalid_transition';
  end if;
  update public.payment_submissions set status = 'under_verification', reviewed_by = auth.uid(), reviewed_at = now() where id = v_s.id;
  update public.orders set payment_status = 'under_verification' where id = v_o.id;
  perform public._set_order_status(v_o.id, 'under_verification', 'Payment is being verified.');
  perform public._audit('payment_under_verification', 'payment_submissions', v_s.id::text, jsonb_build_object('order_code', v_o.order_code));
  return jsonb_build_object('submission_id', v_s.id, 'status', 'under_verification', 'order_status', 'under_verification');
end;
$$;

create or replace function public.admin_verify_payment(p_submission_id uuid, p_note text, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev jsonb;
  v_s public.payment_submissions;
  v_o public.orders;
  v_res jsonb;
begin
  perform public._require_admin();
  v_prev := public._idem_begin('verify_payment', p_idempotency_key);
  if v_prev is not null then
    return v_prev || jsonb_build_object('replayed', true);
  end if;
  select * into v_s from public.payment_submissions where id = p_submission_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  select * into v_o from public.orders where id = v_s.order_id for update;
  if v_s.status not in ('submitted', 'under_verification') or v_o.status not in ('payment_submitted', 'under_verification')
     or v_o.payment_status = 'verified' then
    raise exception 'invalid_transition';
  end if;
  update public.payment_submissions set status = 'verified', admin_notes = nullif(btrim(coalesce(p_note, '')), ''),
    reviewed_by = auth.uid(), reviewed_at = now() where id = v_s.id;
  update public.orders set payment_status = 'verified', paid_at = now() where id = v_o.id;
  perform public._set_order_status(v_o.id, 'payment_verified', 'Payment of ₹' || v_s.amount::text || ' verified.');
  perform public._audit('payment_verified', 'payment_submissions', v_s.id::text,
                        jsonb_build_object('order_code', v_o.order_code, 'amount', v_s.amount, 'utr_last4', right(v_s.utr_normalized, 4)));
  v_res := jsonb_build_object('submission_id', v_s.id, 'status', 'verified', 'order_id', v_o.id, 'order_status', 'payment_verified',
                              'payment_status', 'verified');
  perform public._idem_store('verify_payment', p_idempotency_key, v_res);
  return v_res || jsonb_build_object('replayed', false);
end;
$$;

create or replace function public.admin_reject_payment(p_submission_id uuid, p_reason text, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev jsonb;
  v_s public.payment_submissions;
  v_o public.orders;
  v_res jsonb;
begin
  perform public._require_admin();
  p_reason := btrim(coalesce(p_reason, ''));
  if char_length(p_reason) not between 3 and 500 then
    raise exception 'reason_required';
  end if;
  v_prev := public._idem_begin('reject_payment', p_idempotency_key);
  if v_prev is not null then
    return v_prev || jsonb_build_object('replayed', true);
  end if;
  select * into v_s from public.payment_submissions where id = p_submission_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  select * into v_o from public.orders where id = v_s.order_id for update;
  if v_s.status not in ('submitted', 'under_verification') or v_o.payment_status = 'verified' then
    raise exception 'invalid_transition';
  end if;
  update public.payment_submissions set status = 'rejected', admin_notes = p_reason, reviewed_by = auth.uid(), reviewed_at = now()
    where id = v_s.id;
  update public.orders set payment_status = 'rejected' where id = v_o.id;
  perform public._set_order_status(v_o.id, 'payment_rejected', 'Payment could not be verified: ' || p_reason || '. You can submit the correct details again.');
  perform public._audit('payment_rejected', 'payment_submissions', v_s.id::text,
                        jsonb_build_object('order_code', v_o.order_code, 'reason', p_reason, 'utr_last4', right(v_s.utr_normalized, 4)));
  v_res := jsonb_build_object('submission_id', v_s.id, 'status', 'rejected', 'order_id', v_o.id, 'order_status', 'payment_rejected');
  perform public._idem_store('reject_payment', p_idempotency_key, v_res);
  return v_res || jsonb_build_object('replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Order lifecycle
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_order_status(p_order_id uuid, p_status text, p_note text default null, p_idempotency_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev jsonb;
  v_o public.orders;
  v_res jsonb;
  v_ok boolean;
begin
  perform public._require_admin();
  if p_idempotency_key is not null then
    v_prev := public._idem_begin('set_order_status', p_idempotency_key);
    if v_prev is not null then
      return v_prev || jsonb_build_object('replayed', true);
    end if;
  end if;
  select * into v_o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  v_ok := (v_o.status, p_status) in (('payment_verified', 'order_confirmed'), ('order_confirmed', 'processing'),
                                     ('processing', 'shipped'), ('shipped', 'delivered'));
  if not v_ok then
    raise exception 'invalid_transition';
  end if;
  if p_status = 'order_confirmed' and v_o.payment_status <> 'verified' then
    raise exception 'payment_not_verified';
  end if;
  if exists (select 1 from public.returns r where r.order_id = v_o.id and r.kind = 'cancellation'
             and r.status not in ('return_rejected', 'wallet_credited', 'refund_completed')) then
    raise exception 'cancellation_pending';
  end if;
  perform public._set_order_status(v_o.id, p_status, coalesce(nullif(btrim(coalesce(p_note, '')), ''), public._order_status_label(p_status)));
  perform public._audit('order_status_change', 'orders', v_o.id::text,
                        jsonb_build_object('order_code', v_o.order_code, 'from', v_o.status, 'to', p_status));
  v_res := jsonb_build_object('order_id', v_o.id, 'from_status', v_o.status, 'status', p_status);
  if p_idempotency_key is not null then
    perform public._idem_store('set_order_status', p_idempotency_key, v_res);
  end if;
  return v_res || jsonb_build_object('replayed', false);
end;
$$;

-- shared body of reject / cancel
create or replace function public._admin_close_order(p_action text, p_order_id uuid, p_reason text, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev jsonb;
  v_o public.orders;
  v_r public.returns;
  v_to text := case when p_action = 'reject_order' then 'order_rejected' else 'order_cancelled' end;
  v_res jsonb;
  v_refund_due numeric := 0;
begin
  perform public._require_admin();
  p_reason := btrim(coalesce(p_reason, ''));
  if char_length(p_reason) not between 3 and 500 then
    raise exception 'reason_required';
  end if;
  v_prev := public._idem_begin(p_action, p_idempotency_key);
  if v_prev is not null then
    return v_prev || jsonb_build_object('replayed', true);
  end if;
  select * into v_o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_o.status not in ('payment_pending', 'payment_submitted', 'under_verification', 'payment_rejected', 'payment_verified',
                        'order_confirmed', 'processing') then
    raise exception 'invalid_transition';
  end if;
  -- pending submissions are closed with the order
  update public.payment_submissions set status = 'rejected', admin_notes = coalesce(admin_notes, 'Order closed: ' || p_reason),
    reviewed_by = auth.uid(), reviewed_at = now()
    where order_id = v_o.id and status in ('submitted', 'under_verification');
  if v_o.payment_status in ('submitted', 'under_verification') then
    update public.orders set payment_status = 'rejected' where id = v_o.id;
  end if;
  if p_action = 'reject_order' then
    update public.orders set reject_reason = p_reason where id = v_o.id;
  else
    update public.orders set cancel_reason = p_reason where id = v_o.id;
  end if;
  perform public._order_release(v_o.id, p_reason);
  -- money already received by UPI -> refund obligation
  if v_o.payment_status = 'verified' and v_o.total > 0 then
    v_refund_due := v_o.total;
    select * into v_r from public.returns r where r.order_id = v_o.id
      and r.status not in ('return_rejected', 'wallet_credited', 'refund_completed') for update;
    if found then
      update public.returns set status = 'refund_processing', eligible_amount = v_o.total,
        admin_notes = coalesce(admin_notes || E'\n', '') || 'Order ' || v_to || ': ' || p_reason where id = v_r.id;
    else
      insert into public.returns (return_code, order_id, user_id, kind, reason, refund_preference, status, eligible_amount, prev_order_status, admin_notes)
      values (public._unique_code('SZR-', 8, 'public.returns', 'return_code'), v_o.id, v_o.user_id, 'cancellation', p_reason, 'original',
              'refund_processing', v_o.total, v_o.status, 'Refund obligation created by ' || p_action)
      returning * into v_r;
    end if;
  end if;
  perform public._set_order_status(v_o.id, v_to, case when p_action = 'reject_order' then 'Order rejected: ' else 'Order cancelled: ' end || p_reason
                                                 || case when v_refund_due > 0 then ' A refund of ₹' || v_refund_due::text || ' will be processed.' else '' end);
  perform public._audit(case when p_action = 'reject_order' then 'order_rejected' else 'order_cancelled' end, 'orders', v_o.id::text,
                        jsonb_build_object('order_code', v_o.order_code, 'reason', p_reason, 'refund_due', v_refund_due, 'return_id', v_r.id));
  v_res := jsonb_build_object('order_id', v_o.id, 'status', v_to, 'refund_due', v_refund_due, 'return_id', v_r.id,
                              'return_code', v_r.return_code, 'wallet_returned', v_o.wallet_used);
  perform public._idem_store(p_action, p_idempotency_key, v_res);
  return v_res || jsonb_build_object('replayed', false);
end;
$$;

create or replace function public.admin_reject_order(p_order_id uuid, p_reason text, p_idempotency_key text)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select public._admin_close_order('reject_order', p_order_id, p_reason, p_idempotency_key);
$$;

create or replace function public.admin_cancel_order(p_order_id uuid, p_reason text, p_idempotency_key text)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select public._admin_close_order('cancel_order', p_order_id, p_reason, p_idempotency_key);
$$;

create or replace function public.admin_update_order(p_order_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_o public.orders;
  v_k text;
  v_bad text[];
begin
  perform public._require_admin();
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'invalid_input';
  end if;
  select array_agg(k) into v_bad from jsonb_object_keys(p_patch) k
  where k not in ('ship_name', 'ship_phone', 'ship_line1', 'ship_line2', 'ship_city', 'ship_state', 'ship_pincode', 'admin_notes');
  if v_bad is not null then
    raise exception 'field_not_editable' using detail = array_to_string(v_bad, ',');
  end if;
  select * into v_o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if p_patch ? 'ship_phone' and (p_patch ->> 'ship_phone') !~ '^[6-9][0-9]{9}$' then
    raise exception 'invalid_shipping';
  end if;
  if p_patch ? 'ship_pincode' and (p_patch ->> 'ship_pincode') !~ '^[1-9][0-9]{5}$' then
    raise exception 'invalid_shipping';
  end if;
  for v_k in select k from jsonb_object_keys(p_patch) k loop
    if char_length(coalesce(p_patch ->> v_k, '')) > 2000 then
      raise exception 'invalid_input';
    end if;
  end loop;
  update public.orders set
    ship_name = case when p_patch ? 'ship_name' then p_patch ->> 'ship_name' else ship_name end,
    ship_phone = case when p_patch ? 'ship_phone' then p_patch ->> 'ship_phone' else ship_phone end,
    ship_line1 = case when p_patch ? 'ship_line1' then p_patch ->> 'ship_line1' else ship_line1 end,
    ship_line2 = case when p_patch ? 'ship_line2' then p_patch ->> 'ship_line2' else ship_line2 end,
    ship_city = case when p_patch ? 'ship_city' then p_patch ->> 'ship_city' else ship_city end,
    ship_state = case when p_patch ? 'ship_state' then p_patch ->> 'ship_state' else ship_state end,
    ship_pincode = case when p_patch ? 'ship_pincode' then p_patch ->> 'ship_pincode' else ship_pincode end,
    admin_notes = case when p_patch ? 'admin_notes' then p_patch ->> 'admin_notes' else admin_notes end
  where id = v_o.id returning * into v_o;
  perform public._order_event(v_o.id, v_o.status, v_o.status, 'Order details edited: ' || (select string_agg(k, ', ') from jsonb_object_keys(p_patch) k), true);
  perform public._audit('order_edited', 'orders', v_o.id::text, jsonb_build_object('order_code', v_o.order_code,
                        'fields', (select jsonb_agg(k) from jsonb_object_keys(p_patch) k)));
  return to_jsonb(v_o);
end;
$$;

create or replace function public.admin_add_order_note(p_order_id uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_o public.orders;
begin
  perform public._require_admin();
  p_note := btrim(coalesce(p_note, ''));
  if char_length(p_note) not between 1 and 1000 then
    raise exception 'invalid_input';
  end if;
  select * into v_o from public.orders where id = p_order_id;
  if not found then
    raise exception 'not_found';
  end if;
  perform public._order_event(v_o.id, v_o.status, v_o.status, p_note, true);
  perform public._audit('order_note', 'orders', v_o.id::text, jsonb_build_object('order_code', v_o.order_code));
end;
$$;

-- ---------------------------------------------------------------------------
-- Returns review
-- ---------------------------------------------------------------------------
create or replace function public.admin_review_return(p_return_id uuid, p_action text, p_reason text default null,
                                                      p_eligible_amount numeric default null, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_r public.returns;
  v_o public.orders;
  v_room jsonb;
  v_to text;
  v_amount numeric;
begin
  perform public._require_admin();
  if p_action not in ('under_review', 'approve', 'reject', 'item_awaited', 'item_received') then
    raise exception 'invalid_input';
  end if;
  select * into v_r from public.returns where id = p_return_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  select * into v_o from public.orders where id = v_r.order_id for update;
  p_note := nullif(btrim(coalesce(p_note, '')), '');
  if p_note is not null then
    update public.returns set admin_notes = coalesce(admin_notes || E'\n', '') || p_note where id = v_r.id;
  end if;

  if p_action = 'under_review' then
    if v_r.status <> 'return_requested' then raise exception 'invalid_transition'; end if;
    update public.returns set status = 'under_review' where id = v_r.id;
    v_to := 'under_review';
    perform public._order_event(v_o.id, v_o.status, v_o.status, initcap(v_r.kind) || ' request is under review.', false);

  elsif p_action = 'reject' then
    if v_r.status not in ('return_requested', 'under_review') then raise exception 'invalid_transition'; end if;
    p_reason := btrim(coalesce(p_reason, ''));
    if char_length(p_reason) not between 3 and 500 then raise exception 'reason_required'; end if;
    update public.returns set status = 'return_rejected', reject_reason = p_reason where id = v_r.id;
    v_to := 'return_rejected';
    if v_r.kind = 'return' and v_o.status = 'return_requested' then
      perform public._set_order_status(v_o.id, coalesce(v_r.prev_order_status, 'delivered'), 'Return request rejected: ' || p_reason);
    else
      perform public._order_event(v_o.id, v_o.status, v_o.status, initcap(v_r.kind) || ' request rejected: ' || p_reason, false);
      perform public._notify(v_o.user_id, 'user', 'Request rejected for ' || v_o.order_code, p_reason, '/returns.html');
    end if;

  elsif p_action = 'approve' then
    if v_r.status not in ('return_requested', 'under_review') then raise exception 'invalid_transition'; end if;
    if v_r.kind = 'cancellation' then
      if v_o.status in ('shipped', 'delivered') then raise exception 'invalid_transition'; end if;
      update public.payment_submissions set status = 'rejected', admin_notes = coalesce(admin_notes, 'Order cancelled')
        where order_id = v_o.id and status in ('submitted', 'under_verification');
      update public.orders set cancel_reason = v_r.reason,
        payment_status = case when payment_status in ('submitted', 'under_verification') then 'rejected' else payment_status end
        where id = v_o.id;
      perform public._order_release(v_o.id, 'cancellation approved');
    end if;
    v_room := public._refund_room(v_o.id);
    v_amount := coalesce(p_eligible_amount, (v_room ->> 'refundable')::numeric);
    if v_amount < 0 or v_amount > (v_room ->> 'refundable')::numeric then
      raise exception 'refund_exceeds_paid';
    end if;
    update public.returns set status = 'return_approved', eligible_amount = round(v_amount, 2) where id = v_r.id;
    v_to := 'return_approved';
    if v_r.kind = 'cancellation' then
      perform public._set_order_status(v_o.id, 'order_cancelled', 'Cancellation approved.'
        || case when v_amount > 0 then ' Eligible refund: ₹' || round(v_amount, 2)::text || '.' else '' end);
    else
      perform public._set_order_status(v_o.id, 'return_approved', 'Return approved. Eligible refund: ₹' || round(v_amount, 2)::text || '.');
    end if;

  elsif p_action = 'item_awaited' then
    if v_r.kind <> 'return' or v_r.status <> 'return_approved' then raise exception 'invalid_transition'; end if;
    update public.returns set status = 'item_awaited' where id = v_r.id;
    v_to := 'item_awaited';
    perform public._order_event(v_o.id, v_o.status, v_o.status, 'Waiting for the returned item.', false);

  elsif p_action = 'item_received' then
    if v_r.kind <> 'return' or v_r.status not in ('return_approved', 'item_awaited') then raise exception 'invalid_transition'; end if;
    update public.returns set status = 'item_received' where id = v_r.id;
    v_to := 'item_received';
    perform public._order_event(v_o.id, v_o.status, v_o.status, 'Returned item received.', false);
  end if;

  perform public._audit('return_' || p_action, 'returns', v_r.id::text,
                        jsonb_build_object('return_code', v_r.return_code, 'order_code', v_o.order_code, 'reason', p_reason, 'eligible_amount', v_amount));
  select * into v_r from public.returns where id = p_return_id;
  return to_jsonb(v_r);
end;
$$;

-- ---------------------------------------------------------------------------
-- Refunds (rupees). Order row lock + checks: refunds can never exceed what was paid.
-- ---------------------------------------------------------------------------
create or replace function public.admin_issue_refund(p_order_id uuid, p_return_id uuid, p_amount numeric, p_method text,
                                                     p_external_reference text, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev jsonb;
  v_o public.orders;
  v_r public.returns;
  v_room jsonb;
  v_amount numeric := round(coalesce(p_amount, 0), 2);
  v_f public.refund_ledger;
  v_res jsonb;
  v_already_for_return numeric;
  v_fully boolean;
begin
  perform public._require_admin();
  perform public.require_fresh(15);
  v_prev := public._idem_begin('issue_refund', p_idempotency_key);
  if v_prev is not null then
    return v_prev || jsonb_build_object('replayed', true);
  end if;
  if p_method not in ('original_payment', 'wallet') or v_amount <= 0 then
    raise exception 'invalid_input';
  end if;
  select * into v_o from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_o.payment_status <> 'verified' then
    raise exception 'not_paid';
  end if;
  if p_return_id is not null then
    select * into v_r from public.returns where id = p_return_id and order_id = v_o.id for update;
    if not found then
      raise exception 'not_found';
    end if;
    if v_r.status not in ('return_approved', 'item_awaited', 'item_received', 'refund_processing') then
      raise exception 'invalid_transition';
    end if;
    if v_r.eligible_amount is not null then
      select coalesce(sum(amount), 0) into v_already_for_return from public.refund_ledger where return_id = v_r.id and status <> 'failed';
      if v_amount > v_r.eligible_amount - v_already_for_return then
        raise exception 'refund_exceeds_paid' using detail = 'more than the approved eligible amount';
      end if;
    end if;
  end if;
  if p_method = 'wallet' then
    if p_return_id is not null and v_r.refund_preference <> 'wallet' then
      raise exception 'wallet_not_accepted';
    end if;
    if p_return_id is null and char_length(btrim(coalesce(p_external_reference, ''))) < 3 then
      raise exception 'wallet_not_accepted' using detail = 'note the customer''s acceptance in p_external_reference';
    end if;
  end if;
  v_room := public._refund_room(v_o.id);
  if v_amount > (v_room ->> 'refundable')::numeric then
    raise exception 'refund_exceeds_paid';
  end if;
  if p_method = 'original_payment' and v_amount > (v_room ->> 'refundable_to_original')::numeric then
    raise exception 'refund_exceeds_paid' using detail = 'more than was paid by UPI';
  end if;

  insert into public.refund_ledger (refund_ref, order_id, return_id, user_id, amount, method, status, external_reference, note,
                                    created_by, idempotency_key, completed_by, completed_at)
  values (public._unique_code('SZRF-', 8, 'public.refund_ledger', 'refund_ref'), v_o.id, p_return_id, v_o.user_id, v_amount, p_method,
          case when p_method = 'wallet' then 'completed' else 'processing' end,
          nullif(btrim(coalesce(p_external_reference, '')), ''), null, auth.uid(), auth.uid()::text || ':' || p_idempotency_key,
          case when p_method = 'wallet' then auth.uid() end, case when p_method = 'wallet' then now() end)
  returning * into v_f;
  insert into public.refund_events (refund_id, order_id, event, amount, external_reference, actor_id)
  values (v_f.id, v_o.id, case when p_method = 'wallet' then 'wallet_credited' else 'refund_initiated' end, v_amount, v_f.external_reference, auth.uid());

  v_fully := (v_amount >= (v_room ->> 'refundable')::numeric);
  if p_method = 'wallet' then
    perform public._wallet_post(v_o.user_id, 'credit', case when p_return_id is not null and v_r.kind = 'return' then 'return_credit' else 'refund_credit' end,
                                v_amount, 'Refund ' || v_f.refund_ref || ' for order ' || v_o.order_code, v_o.id, p_return_id,
                                'refund:' || v_f.id::text, null);
    if p_return_id is not null then
      update public.returns set status = 'wallet_credited' where id = v_r.id;
    end if;
    perform public._set_order_status(v_o.id, case when v_fully then 'refund_completed' else 'refund_processing' end,
                                     '₹' || v_amount::text || ' credited to your SHOPZENT wallet (store credit).');
  else
    if p_return_id is not null then
      update public.returns set status = 'refund_processing' where id = v_r.id;
    end if;
    perform public._set_order_status(v_o.id, 'refund_processing', 'Refund of ₹' || v_amount::text || ' to your original payment method is being processed.');
  end if;
  perform public._audit('refund_issued', 'refund_ledger', v_f.id::text,
                        jsonb_build_object('order_code', v_o.order_code, 'amount', v_amount, 'method', p_method, 'refund_ref', v_f.refund_ref));
  v_res := jsonb_build_object('refund_id', v_f.id, 'refund_ref', v_f.refund_ref, 'amount', v_amount, 'method', p_method,
                              'status', v_f.status, 'order_status', (select status from public.orders where id = v_o.id),
                              'refundable_after', greatest((v_room ->> 'refundable')::numeric - v_amount, 0));
  perform public._idem_store('issue_refund', p_idempotency_key, v_res);
  return v_res || jsonb_build_object('replayed', false);
end;
$$;

create or replace function public.admin_complete_refund(p_refund_id bigint, p_external_reference text, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev jsonb;
  v_f public.refund_ledger;
  v_o public.orders;
  v_res jsonb;
begin
  perform public._require_admin();
  perform public.require_fresh(15);
  p_external_reference := btrim(coalesce(p_external_reference, ''));
  if char_length(p_external_reference) not between 3 and 100 then
    raise exception 'invalid_input' using detail = 'bank/UPI refund reference required';
  end if;
  v_prev := public._idem_begin('complete_refund', p_idempotency_key);
  if v_prev is not null then
    return v_prev || jsonb_build_object('replayed', true);
  end if;
  select * into v_f from public.refund_ledger where id = p_refund_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_f.status <> 'processing' then
    raise exception 'invalid_transition';
  end if;
  select * into v_o from public.orders where id = v_f.order_id for update;
  update public.refund_ledger set status = 'completed', external_reference = p_external_reference, completed_by = auth.uid(), completed_at = now()
    where id = v_f.id;
  insert into public.refund_events (refund_id, order_id, event, amount, external_reference, actor_id)
  values (v_f.id, v_f.order_id, 'refund_completed', v_f.amount, p_external_reference, auth.uid());
  if v_f.return_id is not null then
    update public.returns set status = 'refund_completed' where id = v_f.return_id;
  end if;
  if not exists (select 1 from public.refund_ledger where order_id = v_o.id and status = 'processing') then
    perform public._set_order_status(v_o.id, 'refund_completed', 'Refund of ₹' || v_f.amount::text || ' completed (reference ' || p_external_reference || ').');
  end if;
  perform public._audit('refund_completed', 'refund_ledger', v_f.id::text,
                        jsonb_build_object('order_code', v_o.order_code, 'amount', v_f.amount, 'refund_ref', v_f.refund_ref));
  v_res := jsonb_build_object('refund_id', v_f.id, 'refund_ref', v_f.refund_ref, 'status', 'completed',
                              'order_status', (select status from public.orders where id = v_o.id));
  perform public._idem_store('complete_refund', p_idempotency_key, v_res);
  return v_res || jsonb_build_object('replayed', false);
end;
$$;

-- ---------------------------------------------------------------------------
-- Wallet (store credit, rupees)
-- ---------------------------------------------------------------------------
create or replace function public.admin_wallet_adjust(p_user_id uuid, p_direction text, p_kind text, p_amount numeric, p_note text,
                                                      p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev jsonb;
  v_row public.wallet_ledger;
  v_res jsonb;
begin
  perform public._require_admin();
  perform public.require_fresh(15);
  p_note := btrim(coalesce(p_note, ''));
  if p_direction not in ('credit', 'debit') or p_kind not in ('promo_credit', 'admin_adjust', 'return_credit')
     or (p_direction = 'debit' and p_kind <> 'admin_adjust')
     or p_amount is null or round(p_amount, 2) <= 0 or p_amount > 100000 then
    raise exception 'invalid_input';
  end if;
  if char_length(p_note) not between 3 and 500 then
    raise exception 'note_required';
  end if;
  v_prev := public._idem_begin('wallet_adjust', p_idempotency_key);
  if v_prev is not null then
    return v_prev || jsonb_build_object('replayed', true);
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'not_found';
  end if;
  v_row := public._wallet_post(p_user_id, p_direction, p_kind, p_amount, p_note, null, null,
                               auth.uid()::text || ':' || p_idempotency_key, null);
  perform public._notify(p_user_id, 'user', case when p_direction = 'credit' then 'Wallet credited' else 'Wallet adjusted' end,
                         '₹' || v_row.amount::text || ' ' || case when p_direction = 'credit' then 'added to' else 'deducted from' end
                         || ' your SHOPZENT store credit. ' || p_note, '/wallet.html');
  perform public._audit('wallet_' || p_direction, 'wallet_ledger', v_row.id::text,
                        jsonb_build_object('user_id', p_user_id, 'amount', v_row.amount, 'kind', p_kind, 'txn_ref', v_row.txn_ref, 'note', p_note));
  v_res := jsonb_build_object('ledger_id', v_row.id, 'txn_ref', v_row.txn_ref, 'direction', p_direction, 'amount', v_row.amount,
                              'balance', public._wallet_available(p_user_id));
  perform public._idem_store('wallet_adjust', p_idempotency_key, v_res);
  return v_res || jsonb_build_object('replayed', false);
end;
$$;

create or replace function public.admin_wallet_ledger(p_user_id uuid default null, p_limit int default 100)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_admin();
  return query
  select to_jsonb(l) || jsonb_build_object('customer_id', p.customer_id, 'customer_name', p.full_name, 'wallet_code', w.wallet_id)
  from public.wallet_ledger l join public.profiles p on p.id = l.user_id join public.wallets w on w.id = l.wallet_id
  where p_user_id is null or l.user_id = p_user_id
  order by l.id desc
  limit least(greatest(coalesce(p_limit, 100), 1), 1000);
end;
$$;

-- ---------------------------------------------------------------------------
-- Coins (loyalty points, NOT money)
-- ---------------------------------------------------------------------------
create or replace function public.admin_coin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_s public.coin_settings;
begin
  perform public._require_admin();
  select * into v_s from public.coin_settings where id = 1;
  return jsonb_build_object(
    'enabled', v_s.enabled,
    'total_supply', coalesce((select sum(coins) from public.coin_ledger where kind = 'mint'), 0),
    'treasury_available', public._coin_treasury_available(),
    'issued', coalesce((select sum(coins) from public.coin_ledger where kind = 'issue'), 0),
    'redeemed', coalesce((select sum(coins) from public.coin_ledger where kind = 'redeem'), 0),
    'reversed', coalesce((select sum(coins) from public.coin_ledger where kind = 'reversal'), 0),
    'expired', coalesce((select sum(coins) from public.coin_ledger where kind = 'expire'), 0),
    'in_circulation', coalesce((select sum(case kind when 'issue' then coins else -coins end) from public.coin_ledger
                                where kind in ('issue', 'redeem', 'reversal', 'expire')), 0),
    'settings', to_jsonb(v_s),
    'note', 'Internal loyalty points only. Not money, not withdrawable, not a bank or UPI balance.');
end;
$$;

create or replace function public.admin_coin_transfer(p_target text, p_coins bigint, p_note text, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev jsonb;
  v_s public.coin_settings;
  v_uid uuid;
  v_row public.coin_ledger;
  v_res jsonb;
  v_target text := upper(btrim(coalesce(p_target, '')));
begin
  perform public._require_admin();
  perform public.require_fresh(15);
  p_note := btrim(coalesce(p_note, ''));
  if p_coins is null or p_coins <= 0 then
    raise exception 'invalid_input';
  end if;
  if char_length(p_note) not between 3 and 500 then
    raise exception 'note_required';
  end if;
  v_prev := public._idem_begin('coin_transfer', p_idempotency_key);
  if v_prev is not null then
    return v_prev || jsonb_build_object('replayed', true);
  end if;
  select * into v_s from public.coin_settings where id = 1 for update;  -- serialises all treasury movements
  if not coalesce(v_s.enabled, false) then
    raise exception 'coins_disabled';
  end if;
  select p.id into v_uid from public.profiles p left join public.wallets w on w.user_id = p.id
  where upper(p.customer_id) = v_target or upper(w.wallet_id) = v_target;
  if v_uid is null then
    raise exception 'not_found';
  end if;
  if p_coins > public._coin_treasury_available() then
    raise exception 'insufficient_treasury';
  end if;
  insert into public.coin_ledger (txn_ref, user_id, kind, coins, note, expires_at, created_by, idempotency_key)
  values (public._unique_code('SZCN-', 10, 'public.coin_ledger', 'txn_ref'), v_uid, 'issue', p_coins, p_note,
          case when v_s.expiry_days is not null then now() + make_interval(days => v_s.expiry_days) end,
          auth.uid(), auth.uid()::text || ':' || p_idempotency_key)
  returning * into v_row;
  perform public._notify(v_uid, 'user', 'You received SHOPZENT coins',
                         p_coins::text || ' loyalty coins were added to your account. Coins are loyalty points, not money.', '/wallet.html');
  perform public._audit('coin_transfer', 'coin_ledger', v_row.id::text,
                        jsonb_build_object('user_id', v_uid, 'coins', p_coins, 'txn_ref', v_row.txn_ref, 'note', p_note));
  v_res := jsonb_build_object('ledger_id', v_row.id, 'txn_ref', v_row.txn_ref, 'user_id', v_uid, 'coins', p_coins,
                              'expires_at', v_row.expires_at, 'treasury_available', public._coin_treasury_available());
  perform public._idem_store('coin_transfer', p_idempotency_key, v_res);
  return v_res || jsonb_build_object('replayed', false);
end;
$$;

create or replace function public.admin_coin_reverse(p_ledger_id bigint, p_note text, p_idempotency_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_prev jsonb;
  v_orig public.coin_ledger;
  v_row public.coin_ledger;
  v_res jsonb;
begin
  perform public._require_admin();
  perform public.require_fresh(15);
  p_note := btrim(coalesce(p_note, ''));
  if char_length(p_note) not between 3 and 500 then
    raise exception 'note_required';
  end if;
  v_prev := public._idem_begin('coin_reverse', p_idempotency_key);
  if v_prev is not null then
    return v_prev || jsonb_build_object('replayed', true);
  end if;
  perform 1 from public.coin_settings where id = 1 for update;
  select * into v_orig from public.coin_ledger where id = p_ledger_id;
  if not found then
    raise exception 'not_found';
  end if;
  if v_orig.kind <> 'issue' then
    raise exception 'invalid_transition';
  end if;
  if exists (select 1 from public.coin_ledger where reverses_id = v_orig.id and kind = 'reversal') then
    raise exception 'already_reversed';
  end if;
  if public._coin_balance(v_orig.user_id) < v_orig.coins then
    raise exception 'insufficient_balance';
  end if;
  insert into public.coin_ledger (txn_ref, user_id, kind, coins, note, reverses_id, created_by, idempotency_key)
  values (public._unique_code('SZCN-', 10, 'public.coin_ledger', 'txn_ref'), v_orig.user_id, 'reversal', v_orig.coins, p_note, v_orig.id,
          auth.uid(), auth.uid()::text || ':' || p_idempotency_key)
  returning * into v_row;
  perform public._audit('coin_reversal', 'coin_ledger', v_row.id::text,
                        jsonb_build_object('reverses', v_orig.id, 'user_id', v_orig.user_id, 'coins', v_orig.coins, 'note', p_note));
  v_res := jsonb_build_object('ledger_id', v_row.id, 'txn_ref', v_row.txn_ref, 'reverses_id', v_orig.id, 'coins', v_orig.coins,
                              'treasury_available', public._coin_treasury_available());
  perform public._idem_store('coin_reverse', p_idempotency_key, v_res);
  return v_res || jsonb_build_object('replayed', false);
end;
$$;

-- expire issued coins whose expires_at has passed (what is left of them, capped by the balance)
create or replace function public.admin_expire_coins()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_i public.coin_ledger;
  v_amt bigint;
  v_n int := 0;
  v_total bigint := 0;
begin
  perform public._require_admin();
  perform 1 from public.coin_settings where id = 1 for update;
  for v_i in select * from public.coin_ledger l where l.kind = 'issue' and l.expires_at is not null and l.expires_at <= now()
             and not exists (select 1 from public.coin_ledger x where x.reverses_id = l.id and x.kind in ('reversal', 'expire'))
             order by l.id loop
    v_amt := least(v_i.coins, public._coin_balance(v_i.user_id));
    if v_amt > 0 then
      insert into public.coin_ledger (txn_ref, user_id, kind, coins, note, reverses_id, created_by)
      values (public._unique_code('SZCN-', 10, 'public.coin_ledger', 'txn_ref'), v_i.user_id, 'expire', v_amt, 'Coins expired', v_i.id, auth.uid());
      v_n := v_n + 1;
      v_total := v_total + v_amt;
    end if;
  end loop;
  perform public._audit('coins_expired', 'coin_ledger', null, jsonb_build_object('entries', v_n, 'coins', v_total));
  return jsonb_build_object('entries', v_n, 'coins', v_total);
end;
$$;

create or replace function public.admin_coin_ledger(p_limit int default 200)
returns setof jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_admin();
  return query
  select to_jsonb(l) || jsonb_build_object('customer_id', p.customer_id, 'customer_name', p.full_name, 'wallet_code', w.wallet_id)
  from public.coin_ledger l left join public.profiles p on p.id = l.user_id left join public.wallets w on w.user_id = l.user_id
  order by l.id desc
  limit least(greatest(coalesce(p_limit, 200), 1), 1000);
end;
$$;

create or replace function public.admin_set_coin_settings(p_enabled boolean, p_expiry_days int, p_rules text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_s public.coin_settings;
begin
  perform public._require_admin();
  perform public.require_fresh(15);
  if p_enabled is null or (p_expiry_days is not null and p_expiry_days not between 1 and 3650) or char_length(coalesce(p_rules, '')) > 5000 then
    raise exception 'invalid_input';
  end if;
  update public.coin_settings set enabled = p_enabled, expiry_days = p_expiry_days, rules = p_rules, updated_at = now(), updated_by = auth.uid()
  where id = 1 returning * into v_s;
  perform public._audit('setting_change', 'coin_settings', '1',
                        jsonb_build_object('enabled', p_enabled, 'expiry_days', p_expiry_days));
  return to_jsonb(v_s);
end;
$$;

-- ---------------------------------------------------------------------------
-- Users, roles, settings, audit
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_user_role(p_user_id uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_p public.profiles;
begin
  perform public._require_super_admin();
  perform public.require_fresh(15);
  if p_role not in ('customer', 'admin', 'super_admin') then
    raise exception 'invalid_input';
  end if;
  perform 1 from public.profiles where role = 'super_admin' for update;
  select * into v_p from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if v_p.role = 'super_admin' and p_role <> 'super_admin'
     and (select count(*) from public.profiles where role = 'super_admin' and status = 'active' and id <> p_user_id) = 0 then
    raise exception 'last_super_admin';
  end if;
  update public.profiles set role = p_role, mfa_required = (p_role in ('admin', 'super_admin')) where id = p_user_id returning * into v_p;
  perform public._audit('permission_change', 'profiles', p_user_id::text, jsonb_build_object('role', p_role, 'customer_id', v_p.customer_id));
  perform public._notify(p_user_id, 'user', 'Your account role changed', 'Your role is now ' || p_role || '.', '/dashboard.html');
  return jsonb_build_object('id', v_p.id, 'role', v_p.role, 'status', v_p.status);
end;
$$;

create or replace function public.admin_set_user_status(p_user_id uuid, p_status text, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_p public.profiles;
begin
  perform public._require_admin();
  p_reason := btrim(coalesce(p_reason, ''));
  if p_status not in ('active', 'suspended') then
    raise exception 'invalid_input';
  end if;
  if char_length(p_reason) not between 3 and 500 then
    raise exception 'reason_required';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'cannot_change_self';
  end if;
  select * into v_p from public.profiles where id = p_user_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  -- only a super admin may suspend / reactivate staff
  if v_p.role in ('admin', 'super_admin') and not public.is_super_admin() then
    raise exception 'not_authorized';
  end if;
  if p_status = 'suspended' and v_p.role = 'super_admin'
     and (select count(*) from public.profiles where role = 'super_admin' and status = 'active' and id <> p_user_id) = 0 then
    raise exception 'last_super_admin';
  end if;
  update public.profiles set status = p_status where id = p_user_id returning * into v_p;
  perform public._audit('user_status_change', 'profiles', p_user_id::text, jsonb_build_object('status', p_status, 'reason', p_reason));
  return jsonb_build_object('id', v_p.id, 'role', v_p.role, 'status', v_p.status);
end;
$$;

create or replace function public.admin_upsert_setting(p_key text, p_value jsonb, p_is_public boolean default true)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_admin();
  if p_key is null or p_key !~ '^[a-z][a-z0-9_]{1,40}$' or p_value is null or pg_column_size(p_value) > 200000 then
    raise exception 'invalid_input';
  end if;
  if p_key in ('payment', 'security') then
    perform public._require_super_admin();
    perform public.require_fresh(15);
  end if;
  if p_key = 'security' then
    p_is_public := false;
  end if;
  if p_key = 'domain' then
    -- Admin → Domain: only the Super Admin; a bare domain (no scheme/path) and a GitHub username, both optional
    perform public._require_super_admin();
    if jsonb_typeof(p_value) <> 'object'
       or coalesce(p_value ->> 'domain', '') !~ '^([a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+)?$'
       or coalesce(p_value ->> 'github_user', '') !~ '^([a-z0-9][a-z0-9-]{0,38})?$' then
      raise exception 'invalid_input' using detail = 'domain must look like shopzent.in; github_user letters/digits/dashes';
    end if;
    p_is_public := true;
  end if;
  if p_key = 'payment' then
    if jsonb_typeof(p_value) <> 'object'
       or coalesce(p_value ->> 'upi_id', '') !~ '^([A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9.-]{1,63})?$'
       or coalesce(p_value ->> 'qr_url', '') !~ '^(https://[^\s]+)?$' then
      raise exception 'invalid_input' using detail = 'upi_id must look like name@bank and qr_url must be https';
    end if;
  end if;
  insert into public.site_settings (key, value, is_public, updated_by)
  values (p_key, p_value, coalesce(p_is_public, true), auth.uid())
  on conflict (key) do update set value = excluded.value, is_public = excluded.is_public, updated_by = excluded.updated_by;
  perform public._audit('setting_change', 'site_settings', p_key, jsonb_build_object('key', p_key, 'is_public', coalesce(p_is_public, true)));
end;
$$;

create or replace function public.admin_audit_log(p_limit int default 200, p_action text default null)
returns setof public.audit_log
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_admin();
  return query
  select * from public.audit_log a
  where p_action is null or a.action = p_action
  order by a.id desc
  limit least(greatest(coalesce(p_limit, 200), 1), 2000);
end;
$$;

-- ---------------------------------------------------------------------------
-- First super admin: run ONCE from the SQL editor (as postgres). Refuses afterwards.
-- ---------------------------------------------------------------------------
create or replace function public.bootstrap_super_admin(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_p public.profiles;
begin
  if coalesce(auth.role(), '') in ('anon', 'authenticated') then
    raise exception 'not_authorized';
  end if;
  lock table public.profiles in share row exclusive mode;
  if exists (select 1 from public.profiles where role = 'super_admin') then
    raise exception 'super_admin_exists';
  end if;
  select * into v_p from public.profiles where lower(email) = lower(btrim(p_email));
  if not found then
    raise exception 'not_found' using detail = 'register on the website and confirm the email first';
  end if;
  update public.profiles set role = 'super_admin', status = 'active', mfa_required = true where id = v_p.id returning * into v_p;
  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, details)
  values (null, current_user::text, 'bootstrap_super_admin', 'profiles', v_p.id::text, jsonb_build_object('customer_id', v_p.customer_id));
  return jsonb_build_object('id', v_p.id, 'email', v_p.email, 'customer_id', v_p.customer_id, 'role', v_p.role,
                            'next_step', 'Log in on the website, enrol an authenticator app (TOTP) and save your recovery codes.');
end;
$$;
