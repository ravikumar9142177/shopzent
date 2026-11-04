-- 0017_settings_guards.sql
-- order_rules (public, validated numbers/switches) and owner_coins (Super Admin + fresh 2FA, private, validated) in admin_upsert_setting.
CREATE OR REPLACE FUNCTION public.admin_upsert_setting(p_key text, p_value jsonb, p_is_public boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  if p_key = 'owner_coins' then
    perform public._require_super_admin();
    perform public.require_fresh(15);
    p_is_public := false;
    if jsonb_typeof(p_value) <> 'object'
       or coalesce(p_value ->> 'monthly_amount', '0') !~ '^\d{1,13}$'
       or coalesce(p_value ->> 'opening_balance', '0') !~ '^\d{1,13}$'
       or coalesce(p_value ->> 'owner_email', 'a@b.c') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception 'invalid_input' using detail = 'monthly_amount: whole number of coins; owner_email: an email';
    end if;
  end if;
  if p_key = 'order_rules' then
    p_is_public := true;
    if jsonb_typeof(p_value) <> 'object'
       or coalesce(p_value ->> 'max_orders_per_day', '10') !~ '^\d{1,4}$' or (p_value ->> 'max_orders_per_day')::int < 1
       or coalesce(p_value ->> 'cancel_penalty_after', '5') !~ '^\d{1,3}$'
       or coalesce(p_value ->> 'cancel_penalty_amount', '10') !~ '^\d{1,5}(\.\d{1,2})?$'
       or coalesce(p_value ->> 'require_phone', 'true') not in ('true', 'false')
       or coalesce(p_value ->> 'require_phone_verified', 'false') not in ('true', 'false')
       or coalesce(p_value ->> 'allow_negative_wallet', 'false') not in ('true', 'false') then
      raise exception 'invalid_input' using detail = 'order rules: whole numbers (orders/day at least 1), amount in rupees, on/off switches';
    end if;
  end if;
  insert into public.site_settings (key, value, is_public, updated_by)
  values (p_key, p_value, coalesce(p_is_public, true), auth.uid())
  on conflict (key) do update set value = excluded.value, is_public = excluded.is_public, updated_by = excluded.updated_by;
  perform public._audit('setting_change', 'site_settings', p_key, jsonb_build_object('key', p_key, 'is_public', coalesce(p_is_public, true)));
end;
$function$
;
