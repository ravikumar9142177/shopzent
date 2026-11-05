-- 0026: welcome bonus. Every NEW account gets coins automatically once (setting site_settings.coins_welcome).
-- Existing accounts get nothing. Never breaks signup: any error in the bonus is swallowed.
select set_config('sz.notice_seen', '1', true);
insert into public.site_settings (key, value)
values ('coins_welcome', '{"enabled": true, "coins": 20}'::jsonb)
on conflict (key) do nothing;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
  v_mobile text;
  v_cfg jsonb;
  v_coins bigint;
begin
  v_name := left(btrim(regexp_replace(coalesce(new.raw_user_meta_data ->> 'full_name', ''), '[<>]', '', 'g')), 100);
  v_mobile := regexp_replace(coalesce(new.raw_user_meta_data ->> 'mobile', ''), '[^0-9+ -]', '', 'g');
  if v_mobile !~ '^[0-9+ -]{7,16}$' then
    v_mobile := null;
  end if;
  insert into public.profiles (id, customer_id, full_name, email, mobile)
  values (new.id, public._unique_code('SZC-', 8, 'public.profiles', 'customer_id'),
          nullif(v_name, ''), lower(new.email), v_mobile)
  on conflict (id) do nothing;
  insert into public.wallets (user_id, wallet_id)
  values (new.id, public._unique_code('SZW-', 8, 'public.wallets', 'wallet_id'))
  on conflict (user_id) do nothing;
  -- welcome bonus (once per account, idempotent key)
  begin
    select value into v_cfg from public.site_settings where key = 'coins_welcome';
    if coalesce((v_cfg ->> 'enabled')::boolean, false) then
      v_coins := least(1000, greatest(0, coalesce((v_cfg ->> 'coins')::bigint, 0)));
      if v_coins > 0 and exists (select 1 from public.coin_settings where id = 1 and enabled) then
        perform public._referral_issue(new.id, v_coins, 'Welcome bonus', 'welcome:' || new.id::text);
      end if;
    end if;
  exception when others then
    null;
  end;
  return new;
end;
$$;
