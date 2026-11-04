-- 0015_payment_status_and_admin_lists.sql
-- 1) Missing admin list RPCs the admin panel calls (CONTRACT.md): admin_list_payments, admin_list_returns, admin_list_refunds.
--    Without them the Payments and Returns pages could not load.
-- 2) Payment verification with three clear states and safe corrections:
--      pending  = submission 'submitted' / 'under_verification'
--      success  = 'verified'
--      rejected = 'rejected'
--    admin_set_payment_status() is the ONLY way to change it from the panel: admin + AAL2, validated transitions,
--    reason required for reject and for every correction, 7-day correction window (super admin: always),
--    idempotent (double taps are no-ops), one transaction.
--    Side effects: verifying a payment awards nothing (no coins / wallet credit / stock change); wallet use and coupon
--    redemption are recorded when the order is created and stay with the order. So a correction only flips
--    statuses and paid_at; nothing can be credited twice.
-- 3) payment_status_history: append-only log (who, when, from -> to, reason), admins only; written by a trigger so
--    every path (customer submit, old verify/reject RPCs, the new RPC) is recorded.

-- ---------- history ----------
create table if not exists public.payment_status_history (
  id bigserial primary key,
  submission_id uuid not null references public.payment_submissions(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  from_status text check (from_status is null or from_status in ('pending', 'success', 'rejected')),
  to_status text not null check (to_status in ('pending', 'success', 'rejected')),
  raw_from text,
  raw_to text not null,
  reason text,
  changed_by uuid,
  changed_by_role text,
  created_at timestamptz not null default now()
);
create index if not exists payment_status_history_order_idx on public.payment_status_history (order_id, created_at desc);
alter table public.payment_status_history enable row level security;
revoke all on public.payment_status_history from anon, authenticated;
grant select on public.payment_status_history to authenticated;
drop policy if exists payment_status_history_admin_read on public.payment_status_history;
create policy payment_status_history_admin_read on public.payment_status_history for select to authenticated using (public.is_admin());
drop trigger if exists payment_status_history_immutable on public.payment_status_history;
create trigger payment_status_history_immutable before update or delete on public.payment_status_history
  for each row execute function public._reject_ledger_change();
drop trigger if exists payment_status_history_no_truncate on public.payment_status_history;
create trigger payment_status_history_no_truncate before truncate on public.payment_status_history
  for each statement execute function public._reject_ledger_change();

create or replace function public._pay_state(p text) returns text
language sql immutable set search_path = public, pg_temp as $$
  select case when p is null then null when p = 'verified' then 'success' when p = 'rejected' then 'rejected' else 'pending' end;
$$;

create or replace function public._payment_history_trg()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_from text := case when tg_op = 'UPDATE' then public._pay_state(old.status) end;
  v_to text := public._pay_state(new.status);
  v_reason text := nullif(current_setting('shopzent.payment_reason', true), '');
begin
  if tg_op = 'UPDATE' and old.status is not distinct from new.status then
    return new;
  end if;
  if v_reason is null then
    v_reason := case
      when tg_op = 'INSERT' then 'Customer submitted UTR ending ' || right(new.utr_normalized, 4)
      when new.status = 'rejected' then new.admin_notes
      when new.status = 'verified' then coalesce(new.admin_notes, 'Verified')
      else null end;
  end if;
  insert into public.payment_status_history (submission_id, order_id, from_status, to_status, raw_from, raw_to, reason, changed_by, changed_by_role)
  values (new.id, new.order_id, v_from, v_to, case when tg_op = 'UPDATE' then old.status end, new.status, left(v_reason, 500),
          auth.uid(), coalesce(public.my_role(), 'system'));
  return new;
end;
$$;
revoke all on function public._payment_history_trg() from public, anon, authenticated;
drop trigger if exists payment_submissions_history on public.payment_submissions;
create trigger payment_submissions_history after insert or update of status on public.payment_submissions
  for each row execute function public._payment_history_trg();

-- backfill one row per existing submission (current state), so old orders show something
insert into public.payment_status_history (submission_id, order_id, from_status, to_status, raw_from, raw_to, reason, changed_by, changed_by_role, created_at)
select s.id, s.order_id, null, public._pay_state(s.status), null, s.status, 'State when history started', s.reviewed_by, 'system', coalesce(s.reviewed_at, s.created_at)
from public.payment_submissions s
where not exists (select 1 from public.payment_status_history h where h.submission_id = s.id);

-- ---------- the one RPC for approve / reject / correct ----------
create or replace function public.admin_set_payment_status(p_submission_id uuid, p_to text, p_reason text, p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_prev jsonb;
  v_s public.payment_submissions;
  v_o public.orders;
  v_from text;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_res jsonb;
begin
  perform public._require_admin();
  if p_to is null or p_to not in ('pending', 'success', 'rejected') then
    raise exception 'invalid_input' using detail = 'status must be pending, success or rejected';
  end if;
  if v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'invalid_input' using detail = 'reason too long';
  end if;
  v_prev := public._idem_begin('payment_status', p_idempotency_key);
  if v_prev is not null then
    return v_prev || jsonb_build_object('replayed', true);
  end if;

  select * into v_s from public.payment_submissions where id = p_submission_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  select * into v_o from public.orders where id = v_s.order_id for update;
  v_from := public._pay_state(v_s.status);

  if v_from = p_to then  -- double tap / already in that state: nothing to do
    v_res := jsonb_build_object('submission_id', v_s.id, 'order_id', v_o.id, 'status', p_to, 'changed', false);
    perform public._idem_store('payment_status', p_idempotency_key, v_res);
    return v_res || jsonb_build_object('replayed', false);
  end if;

  if (p_to = 'rejected' or v_from <> 'pending') and (v_reason is null or char_length(v_reason) < 3) then
    raise exception 'reason_required';
  end if;
  if v_from <> 'pending' and not public.is_super_admin()
     and coalesce(v_s.reviewed_at, v_s.created_at) < now() - interval '7 days' then
    raise exception 'change_window_closed';
  end if;
  if v_o.status not in ('payment_submitted', 'under_verification', 'payment_verified', 'payment_rejected', 'order_confirmed') then
    raise exception 'invalid_transition' using detail = 'order is already ' || v_o.status;
  end if;
  if exists (select 1 from public.payment_submissions s where s.order_id = v_o.id and s.id <> v_s.id and s.created_at > v_s.created_at) then
    raise exception 'newer_submission_exists';
  end if;
  if p_to in ('pending', 'success') and exists (
       select 1 from public.payment_submissions s where s.utr_normalized = v_s.utr_normalized and s.id <> v_s.id and s.status <> 'rejected') then
    raise exception 'duplicate_utr';
  end if;

  perform set_config('shopzent.payment_reason', coalesce(v_reason, ''), true);
  if p_to = 'success' then
    update public.payment_submissions set status = 'verified', admin_notes = coalesce(v_reason, admin_notes),
      reviewed_by = auth.uid(), reviewed_at = now() where id = v_s.id;
    update public.orders set payment_status = 'verified', paid_at = coalesce(paid_at, now()) where id = v_o.id;
    if v_o.status <> 'order_confirmed' then
      perform public._set_order_status(v_o.id, 'payment_verified', 'Payment of ₹' || v_s.amount::text || ' verified.');
    end if;
  elsif p_to = 'rejected' then
    update public.payment_submissions set status = 'rejected', admin_notes = v_reason,
      reviewed_by = auth.uid(), reviewed_at = now() where id = v_s.id;
    update public.orders set payment_status = 'rejected', paid_at = null where id = v_o.id;
    perform public._set_order_status(v_o.id, 'payment_rejected',
      'Payment could not be verified: ' || v_reason || '. Please submit the correct UTR again or contact us on WhatsApp.');
  else
    update public.payment_submissions set status = 'under_verification', reviewed_by = auth.uid(), reviewed_at = now() where id = v_s.id;
    update public.orders set payment_status = 'under_verification', paid_at = null where id = v_o.id;
    perform public._set_order_status(v_o.id, 'under_verification', 'Payment is being verified.');
  end if;
  perform set_config('shopzent.payment_reason', '', true);

  perform public._audit('payment_status_changed', 'payment_submissions', v_s.id::text,
    jsonb_build_object('order_code', v_o.order_code, 'from', v_from, 'to', p_to, 'reason', v_reason, 'amount', v_s.amount,
                       'utr_last4', right(v_s.utr_normalized, 4)));
  v_res := jsonb_build_object('submission_id', v_s.id, 'order_id', v_o.id, 'from', v_from, 'status', p_to, 'changed', true);
  perform public._idem_store('payment_status', p_idempotency_key, v_res);
  return v_res || jsonb_build_object('replayed', false);
end;
$$;

create or replace function public.admin_payment_history(p_order_id uuid)
returns setof jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin();
  return query
    select to_jsonb(h) || jsonb_build_object('submission_code', s.submission_code, 'utr_last4', right(s.utr_normalized, 4),
                                            'changed_by_name', coalesce(p.full_name, p.email, h.changed_by_role))
    from public.payment_status_history h
    join public.payment_submissions s on s.id = h.submission_id
    left join public.profiles p on p.id = h.changed_by
    where h.order_id = p_order_id
    order by h.created_at desc, h.id desc;
end;
$$;

-- ---------- admin lists ----------
create or replace function public.admin_list_payments(p_status text default null)
returns setof jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin();
  return query
    select to_jsonb(s) || jsonb_build_object(
      'order_code', o.order_code, 'order_status', o.status, 'order_total', o.total, 'payment_status', o.payment_status,
      'customer_id', p.customer_id, 'customer_name', p.full_name, 'customer_mobile', coalesce(p.mobile, o.ship_phone),
      'duplicate_attempts', (select count(*) from public.duplicate_utr_attempts d where d.utr_normalized = s.utr_normalized or d.existing_submission_id = s.id))
    from public.payment_submissions s
    join public.orders o on o.id = s.order_id
    left join public.profiles p on p.id = s.user_id
    where p_status is null or p_status = '' or s.status = p_status
    order by s.created_at desc
    limit 500;
end;
$$;

create or replace function public.admin_list_returns(p_status text default null)
returns setof jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin();
  return query
    select to_jsonb(r) || jsonb_build_object(
      'order_code', o.order_code, 'order_total', o.total, 'order_status', o.status, 'payment_status', o.payment_status,
      'customer_id', p.customer_id, 'customer_name', p.full_name,
      'refunded_amount', coalesce((select sum(f.amount) from public.refund_ledger f where f.order_id = o.id and f.status <> 'failed'), 0))
    from public.returns r
    join public.orders o on o.id = r.order_id
    left join public.profiles p on p.id = r.user_id
    where p_status is null or p_status = '' or r.status = p_status
    order by r.created_at desc
    limit 500;
end;
$$;

create or replace function public.admin_list_refunds()
returns setof jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin();
  return query
    select to_jsonb(f) || jsonb_build_object('order_code', o.order_code)
    from public.refund_ledger f
    join public.orders o on o.id = f.order_id
    order by f.created_at desc
    limit 500;
end;
$$;

revoke all on function public._pay_state(text) from public, anon;
revoke all on function public.admin_set_payment_status(uuid, text, text, text) from public, anon;
revoke all on function public.admin_payment_history(uuid) from public, anon;
revoke all on function public.admin_list_payments(text) from public, anon;
revoke all on function public.admin_list_returns(text) from public, anon;
revoke all on function public.admin_list_refunds() from public, anon;
grant execute on function public._pay_state(text) to authenticated;
grant execute on function public.admin_set_payment_status(uuid, text, text, text) to authenticated;
grant execute on function public.admin_payment_history(uuid) to authenticated;
grant execute on function public.admin_list_payments(text) to authenticated;
grant execute on function public.admin_list_returns(text) to authenticated;
grant execute on function public.admin_list_refunds() to authenticated;
notify pgrst, 'reload schema';
