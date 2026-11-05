-- 0023_admin_sales.sql
-- Admin "Sales / Orders amount" page (read-only). One SECURITY DEFINER function, idempotent.
-- Definitions (also shown in the page's help text):
--   placed    = every row in public.orders (any status), amount = orders.total as stored (rupees)
--   cancelled = orders.status in ('order_cancelled', 'order_rejected'), whatever the payment state
--   confirmed = orders.payment_status = 'verified' AND not cancelled (payment verified by admin)
--   pending   = everything else: payment not yet verified (pending / submitted / under_verification /
--               rejected) and not cancelled
--   placed = confirmed + pending + cancelled (a partition, nothing counted twice)
-- Periods are by orders.created_at: today = since 00:00 Asia/Kolkata today; d7 / d30 = last 7 / 30 x 24 h;
-- all = all time. Pure read: writes no notifications, no customer rows, no audit rows.
-- Guard: public._require_admin() (admin role + AAL2; 'mfa_required' / 'not_authorized' otherwise).

create or replace function public.admin_sales_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_now timestamptz := now();
  v_today timestamptz := (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata');
  v_res jsonb;
begin
  perform public._require_admin();
  with w(k, since) as (values
      ('today', v_today),
      ('d7', v_now - interval '7 days'),
      ('d30', v_now - interval '30 days'),
      ('all', '-infinity'::timestamptz)),
  o as (
    select x.id, x.total, x.created_at,
      case when x.status in ('order_cancelled', 'order_rejected') then 'cancelled'
           when x.payment_status = 'verified' then 'confirmed'
           else 'pending' end as bucket
    from public.orders x
    where x.created_at <= v_now),
  agg as (
    select w.k,
      count(o.id) as placed_c, coalesce(sum(o.total), 0) as placed_a,
      count(o.id) filter (where o.bucket = 'confirmed') as confirmed_c,
      coalesce(sum(o.total) filter (where o.bucket = 'confirmed'), 0) as confirmed_a,
      count(o.id) filter (where o.bucket = 'pending') as pending_c,
      coalesce(sum(o.total) filter (where o.bucket = 'pending'), 0) as pending_a,
      count(o.id) filter (where o.bucket = 'cancelled') as cancelled_c,
      coalesce(sum(o.total) filter (where o.bucket = 'cancelled'), 0) as cancelled_a
    from w
    left join o on o.created_at >= w.since
    group by w.k)
  select jsonb_object_agg(agg.k, jsonb_build_object(
      'placed', jsonb_build_object('amount', agg.placed_a, 'count', agg.placed_c),
      'confirmed', jsonb_build_object('amount', agg.confirmed_a, 'count', agg.confirmed_c),
      'pending', jsonb_build_object('amount', agg.pending_a, 'count', agg.pending_c),
      'cancelled', jsonb_build_object('amount', agg.cancelled_a, 'count', agg.cancelled_c)))
  into v_res
  from agg;

  return jsonb_build_object(
    'generated_at', v_now,
    'timezone', 'Asia/Kolkata',
    'today_since', v_today,
    'windows', coalesce(v_res, '{}'::jsonb));
end $$;

revoke all on function public.admin_sales_summary() from public, anon;
grant execute on function public.admin_sales_summary() to authenticated;
