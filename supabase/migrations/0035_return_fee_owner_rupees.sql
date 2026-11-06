-- 0035: return charge (default Rs 50, deducted from a return's eligible refund), admin 'send remaining money' notice,
-- and a monthly Rs 5 crore store-credit sending limit for the owner. Store credit is not real money.
alter table public.returns add column if not exists return_fee numeric not null default 0;
select set_config('sz.notice_seen', '1', true);
insert into public.site_settings (key, value, is_public) values ('return_fee', '{"enabled": true, "amount": 50}'::jsonb, true) on conflict (key) do nothing;
insert into public.site_settings (key, value, is_public) values ('owner_rupees', '{"monthly_amount": 50000000}'::jsonb, false) on conflict (key) do nothing;
CREATE OR REPLACE FUNCTION public.admin_review_return(p_return_id uuid, p_action text, p_reason text DEFAULT NULL::text, p_eligible_amount numeric DEFAULT NULL::numeric, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_r public.returns;
  v_o public.orders;
  v_room jsonb;
  v_to text;
  v_amount numeric;
  v_fee numeric := 0;
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
    if v_r.kind = 'return' and coalesce(public._setting('return_fee', 'enabled'), 'true') = 'true' then
      v_fee := least(coalesce(nullif(public._setting('return_fee', 'amount'), '')::numeric, 50), (v_room ->> 'refundable')::numeric);
    end if;
    v_amount := coalesce(p_eligible_amount, (v_room ->> 'refundable')::numeric - v_fee);
    if v_amount < 0 or v_amount > (v_room ->> 'refundable')::numeric then
      raise exception 'refund_exceeds_paid';
    end if;
    update public.returns set status = 'return_approved', eligible_amount = round(v_amount, 2), return_fee = v_fee where id = v_r.id;
    v_to := 'return_approved';
    if v_r.kind = 'cancellation' then
      perform public._set_order_status(v_o.id, 'order_cancelled', 'Cancellation approved.'
        || case when v_amount > 0 then ' Eligible refund: ₹' || round(v_amount, 2)::text || '.' else '' end);
    else
      perform public._set_order_status(v_o.id, 'return_approved', 'Return approved. Eligible refund: ₹' || round(v_amount, 2)::text || case when v_fee > 0 then ' (₹' || round(v_fee, 0)::text || ' return charge deducted).' else '.' end);
      perform public._notify(null, 'admin', 'Return approved: send ₹' || round(v_amount, 2)::text || ' to customer', v_o.order_code || ' · ' || v_r.return_code || ' — remaining amount after the return charge; send it from Wallets (rupees) or Refunds.', '/admin/#returns');
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
$function$
;
CREATE OR REPLACE FUNCTION public.admin_wallet_adjust(p_user_id uuid, p_direction text, p_kind text, p_amount numeric, p_note text, p_idempotency_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_prev jsonb;
  v_row public.wallet_ledger;
  v_res jsonb;
  v_cap numeric;
  v_used numeric;
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
  if p_direction = 'credit' then   -- monthly sending limit for store credit (Admin > Settings > owner_rupees)
    v_cap := coalesce(nullif(public._setting('owner_rupees', 'monthly_amount'), '')::numeric, 50000000);
    select coalesce(sum(amount), 0) into v_used from public.wallet_ledger
     where direction = 'credit' and kind in ('promo_credit', 'return_credit', 'admin_adjust')
       and (created_at at time zone 'Asia/Kolkata') >= date_trunc('month', now() at time zone 'Asia/Kolkata');
    if v_used + p_amount > v_cap then
      raise exception 'insufficient_treasury' using detail = 'monthly rupee limit reached';
    end if;
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
$function$
;
create or replace function public.admin_rupee_overview() returns jsonb language plpgsql stable security definer set search_path to 'public','pg_temp' as $f$
declare v_cap numeric; v_used numeric;
begin
  perform public._require_admin();
  v_cap := coalesce(nullif(public._setting('owner_rupees', 'monthly_amount'), '')::numeric, 50000000);
  select coalesce(sum(amount), 0) into v_used from public.wallet_ledger
   where direction = 'credit' and kind in ('promo_credit', 'return_credit', 'admin_adjust')
     and (created_at at time zone 'Asia/Kolkata') >= date_trunc('month', now() at time zone 'Asia/Kolkata');
  return jsonb_build_object('monthly_limit', v_cap, 'sent_this_month', v_used, 'remaining', greatest(v_cap - v_used, 0));
end $f$;
grant execute on function public.admin_rupee_overview() to authenticated;
