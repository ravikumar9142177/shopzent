-- 0038: rotate active percent coupon codes every 5 days (codes only; discount, visibility and limits stay)
create or replace function public._rand_coupon_code() returns text language plpgsql as $$
declare a text := 'ABCDEFGHJKLMNPQRSTUVWXYZ'; d text := '23456789'; r text := ''; i int;
begin
  for i in 1..3 loop r := r || substr(a, 1 + floor(random()*length(a))::int, 1); end loop;
  for i in 1..2 loop r := r || substr(d, 1 + floor(random()*length(d))::int, 1); end loop;
  r := r || substr(a, 1 + floor(random()*length(a))::int, 1) || substr(a||d, 1 + floor(random()*length(a||d))::int, 1);
  return r;
end $$;

create or replace function public.rotate_coupon_codes(p_force boolean default false) returns int
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare last_at timestamptz; n int := 0; r record; nc text; f jsonb; map jsonb := '{}'::jsonb;
begin
  select (value->>'rotated_at')::timestamptz into last_at from site_settings where key = 'coupon_rotation';
  if not p_force and last_at is not null and now() - last_at < interval '4 days 23 hours' then return 0; end if;
  perform set_config('sz.notice_seen','1',true);
  for r in select id, code, discount_value from coupons where active and discount_type = 'percent' order by discount_value loop
    loop nc := _rand_coupon_code(); exit when not exists (select 1 from coupons where code = nc); end loop;
    update coupons set code = nc where id = r.id;
    map := map || jsonb_build_object(nc, r.discount_value);
    select value into f from site_settings where key = 'festival';
    if f is not null and f #>> '{offer,code}' = r.code then
      update site_settings set value = jsonb_set(value, '{offer,code}', to_jsonb(nc)) where key = 'festival';
    end if;
    n := n + 1;
  end loop;
  insert into site_settings(key, value, is_public) values ('coupon_rotation', jsonb_build_object('rotated_at', now(), 'every_days', 5, 'codes', map), false)
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return n;
end $$;
revoke all on function public.rotate_coupon_codes(boolean) from public, anon, authenticated;

select cron.schedule('shopzent-rotate-coupons', '35 18 * * *', $$select public.rotate_coupon_codes(false)$$);
