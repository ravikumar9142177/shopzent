-- 0012: the customer's own coupon history (Dashboard → "Coupons used").
-- Returns only the caller's own redemptions. A customer only ever sees codes they typed themselves.
create or replace function public.my_coupon_history()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'login_required';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'code', c.code,
             'order_code', o.order_code,
             'discount_amount', r.discount_amount,
             'voided', r.voided,
             'created_at', r.created_at) order by r.created_at desc)
      from public.coupon_redemptions r
      join public.coupons c on c.id = r.coupon_id
      left join public.orders o on o.id = r.order_id
     where r.user_id = auth.uid()
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.my_coupon_history() from public, anon;
grant execute on function public.my_coupon_history() to authenticated;
