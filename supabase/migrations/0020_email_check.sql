-- SHOPZENT 0020: "Email check" for the admin (disposable / temporary email detector) + "Check all signups"
-- Idempotent, no secrets. Does not touch auth SMTP config or mailer_autoconfirm.
--
--  * table disposable_domains  (seeded from supabase/seed/disposable_domains.sql; admin-only, never sent to visitors)
--  * public._is_disposable_email() now ALSO checks that table (signup hook + order check + Users "Suspicious" flag use it)
--  * admin RPCs (admin + 2FA/AAL2 checked inside the database; customers/anon cannot call any of them):
--      admin_email_check_db, admin_domains_db, admin_recent_signups,
--      admin_block_email_domain, admin_unblock_email_domain, admin_block_email_target
--  * every action is written to the audit log; NOT a "website update", so customers get no update notice
--    (blocked_email_domains is private and excluded from the update-notice trigger; the new table is not watched).

create table if not exists public.disposable_domains (
  domain   text primary key check (domain = lower(domain) and char_length(domain) between 4 and 253),
  source   text not null default 'seed',
  added_at timestamptz not null default now()
);
alter table public.disposable_domains enable row level security;   -- no policies: only security-definer functions read it
revoke all on public.disposable_domains from public, anon, authenticated;

-- ---------- helpers (internal only) ----------
create or replace function public._email_domain(p text)
returns text language plpgsql immutable set search_path = public, pg_temp as $$
declare v text := lower(btrim(coalesce(p, '')));
begin
  v := regexp_replace(v, '^.*@', '');
  v := regexp_replace(v, '[.]+$', '');
  if v ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?([.][a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$' and char_length(v) <= 253 then return v; end if;
  return null;
end $$;

create or replace function public._is_major_email_domain(p text)
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select lower(coalesce(p, '')) = any (array['gmail.com','googlemail.com','outlook.com','hotmail.com','live.com','msn.com','yahoo.com',
    'yahoo.in','yahoo.co.in','ymail.com','icloud.com','me.com','mac.com','proton.me','protonmail.com','aol.com','rediffmail.com','zoho.com']);
$$;

-- the listed domain that matches p (the domain itself or a parent such as a.b.example.com -> example.com), else null
create or replace function public._disposable_match(p text)
returns text language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v text := p; r text;
begin
  if v is null then return null; end if;
  while position('.' in v) > 0 loop
    select d.domain into r from public.disposable_domains d where d.domain = v;
    if found then return r; end if;
    v := substr(v, position('.' in v) + 1);
  end loop;
  return null;
end $$;

create or replace function public._blocked_list_match(p text)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select d from (
    select btrim(x) as d from regexp_split_to_table(lower(coalesce((select s.value ->> 'domains' from public.site_settings s where s.key = 'blocked_email_domains'), '')), '[\s,;]+') x
  ) t where d <> '' and (p = d or p like '%.' || d) limit 1;
$$;

revoke all on function public._email_domain(text), public._is_major_email_domain(text), public._disposable_match(text), public._blocked_list_match(text)
  from public, anon, authenticated;

-- signup hook / order check / Users flag: manual blocked list OR the bundled list (major providers are never blocked)
create or replace function public._is_disposable_email(p_email text)
returns boolean language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_dom text := public._email_domain(p_email);
begin
  if v_dom is null then return false; end if;
  if coalesce(public._setting('order_rules', 'block_disposable_email'), 'true') = 'false' then return false; end if;
  if public._is_major_email_domain(v_dom) then return false; end if;
  if public._blocked_list_match(v_dom) is not null then return true; end if;
  return public._disposable_match(v_dom) is not null;
end;
$$;
revoke all on function public._is_disposable_email(text) from public, anon, authenticated;

-- ---------- admin RPCs ----------
-- domain facts for one or many inputs (an email or a bare domain each); max 60
create or replace function public.admin_domains_db(p_inputs text[])
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_out jsonb := '[]'::jsonb; i text; d text; m text;
begin
  perform public._require_admin();
  foreach i in array (coalesce(p_inputs, '{}'::text[]))[1:60] loop
    d := public._email_domain(i);
    if d is null then
      v_out := v_out || jsonb_build_array(jsonb_build_object('input', left(coalesce(i, ''), 200), 'valid', false));
    else
      m := public._disposable_match(d);
      v_out := v_out || jsonb_build_array(jsonb_build_object('input', left(i, 200), 'valid', true, 'domain', d,
        'major', public._is_major_email_domain(d), 'on_list', m is not null, 'list_match', m,
        'blocked', public._blocked_list_match(d) is not null));
    end if;
  end loop;
  return v_out;
end $$;

-- one email / domain: database side of the check (the DNS side runs in the email-check function)
create or replace function public.admin_email_check_db(p_input text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_in text := btrim(coalesce(p_input, '')); v_email text; d text; v_p public.profiles; v_m text; v_orders int; v_cust jsonb := null; v_n int;
begin
  perform public._require_admin();
  if char_length(v_in) > 254 then raise exception 'invalid_input'; end if;
  d := public._email_domain(v_in);
  if d is null then return jsonb_build_object('valid', false, 'input', v_in); end if;
  if position('@' in v_in) > 0 then v_email := lower(v_in); end if;
  v_m := public._disposable_match(d);
  if v_email is not null then
    select * into v_p from public.profiles where lower(email) = v_email limit 1;
    if found then
      select count(*) into v_orders from public.orders o where o.user_id = v_p.id;
      v_cust := jsonb_build_object('id', v_p.id, 'customer_id', v_p.customer_id, 'full_name', v_p.full_name, 'email', v_p.email,
        'status', v_p.status, 'role', v_p.role, 'created_at', v_p.created_at, 'orders', v_orders);
    end if;
  end if;
  select count(*) into v_n from public.profiles where lower(email) like '%@' || d;
  return jsonb_build_object('valid', true, 'input', v_in, 'email', v_email, 'domain', d,
    'major', public._is_major_email_domain(d), 'on_list', v_m is not null, 'list_match', v_m,
    'blocked', public._blocked_list_match(d) is not null, 'customer', v_cust, 'customers_on_domain', v_n,
    'list_size', (select count(*) from public.disposable_domains));
end $$;

-- recent customer signups with domain flags (the "Check all signups" view)
create or replace function public.admin_recent_signups(p_limit int default 150)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin();
  return coalesce((select jsonb_agg(x order by (x ->> 'created_at') desc) from (
    select jsonb_build_object('id', p.id, 'customer_id', p.customer_id, 'full_name', p.full_name, 'email', p.email, 'status', p.status,
      'created_at', p.created_at, 'orders', (select count(*) from public.orders o where o.user_id = p.id),
      'domain', public._email_domain(p.email), 'major', public._is_major_email_domain(public._email_domain(p.email)),
      'on_list', public._disposable_match(public._email_domain(p.email)) is not null,
      'blocked_domain', public._blocked_list_match(public._email_domain(p.email)) is not null) as x
    from public.profiles p where p.role = 'customer' order by p.created_at desc
    limit least(greatest(coalesce(p_limit, 150), 1), 500)) s), '[]'::jsonb);
end $$;

create or replace function public._clean_reason(p text, p_default text)
returns text language sql immutable as $$ select left(coalesce(nullif(btrim(coalesce(p, '')), ''), p_default), 300) $$;
revoke all on function public._clean_reason(text, text) from public, anon, authenticated;

create or replace function public.admin_block_email_domain(p_domain text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare d text := public._email_domain(p_domain); v_list text; v_new text;
begin
  perform public._require_admin();
  if d is null then raise exception 'invalid_input' using detail = 'domain like mailinator.com'; end if;
  if public._is_major_email_domain(d) then raise exception 'major_provider' using detail = 'gmail, outlook, yahoo etc. cannot be blocked'; end if;
  insert into public.site_settings (key, value, is_public) values ('blocked_email_domains', jsonb_build_object('domains', ''), false) on conflict (key) do nothing;
  select s.value ->> 'domains' into v_list from public.site_settings s where s.key = 'blocked_email_domains' for update;
  if exists (select 1 from regexp_split_to_table(lower(coalesce(v_list, '')), '[\s,;]+') x where x = d) then
    return jsonb_build_object('domain', d, 'already_blocked', true);
  end if;
  v_new := rtrim(coalesce(v_list, ''), E'\n\r ,;') || E'\n' || d;
  if char_length(v_new) > 20000 then raise exception 'list_full'; end if;
  update public.site_settings set value = jsonb_set(coalesce(value, '{}'::jsonb), '{domains}', to_jsonb(ltrim(v_new, E'\n')), true),
         updated_at = now(), updated_by = auth.uid() where key = 'blocked_email_domains';
  perform public._audit('email_domain_blocked', 'site_settings', 'blocked_email_domains',
    jsonb_build_object('domain', d, 'reason', public._clean_reason(p_reason, 'blocked from Email check')));
  return jsonb_build_object('domain', d, 'blocked', true);
end $$;

create or replace function public.admin_unblock_email_domain(p_domain text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare d text := public._email_domain(p_domain); v_list text; v_new text;
begin
  perform public._require_admin();
  if d is null then raise exception 'invalid_input'; end if;
  select s.value ->> 'domains' into v_list from public.site_settings s where s.key = 'blocked_email_domains' for update;
  if not exists (select 1 from regexp_split_to_table(lower(coalesce(v_list, '')), '[\s,;]+') x where x = d) then
    return jsonb_build_object('domain', d, 'was_blocked', false);
  end if;
  select coalesce(string_agg(x, E'\n'), '') into v_new from regexp_split_to_table(lower(coalesce(v_list, '')), '[\s,;]+') x where x <> '' and x <> d;
  update public.site_settings set value = jsonb_set(value, '{domains}', to_jsonb(v_new), true), updated_at = now(), updated_by = auth.uid()
   where key = 'blocked_email_domains';
  perform public._audit('email_domain_unblocked', 'site_settings', 'blocked_email_domains', jsonb_build_object('domain', d));
  return jsonb_build_object('domain', d, 'unblocked', true);
end $$;

-- "both together": domain and/or customer in ONE transaction (customer block = the existing Block user feature)
create or replace function public.admin_block_email_target(p_domain text, p_user_id uuid, p_reason text, p_block_domain boolean, p_block_user boolean)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_r text := public._clean_reason(p_reason, 'blocked from Email check'); v_out jsonb := '{}'::jsonb;
begin
  perform public._require_admin();
  if not coalesce(p_block_domain, false) and not coalesce(p_block_user, false) then raise exception 'invalid_input'; end if;
  if coalesce(p_block_user, false) and p_user_id is null then raise exception 'invalid_input'; end if;
  if coalesce(p_block_domain, false) then v_out := v_out || jsonb_build_object('domain', public.admin_block_email_domain(p_domain, v_r)); end if;
  if coalesce(p_block_user, false) then
    if char_length(v_r) < 3 then v_r := 'blocked from Email check'; end if;
    v_out := v_out || jsonb_build_object('user', public.admin_set_user_status(p_user_id, 'suspended', v_r));
  end if;
  return v_out;
end $$;

do $$
declare f text;
begin
  foreach f in array array[
    'admin_domains_db(text[])', 'admin_email_check_db(text)', 'admin_recent_signups(int)', 'admin_block_email_domain(text, text)',
    'admin_unblock_email_domain(text)', 'admin_block_email_target(text, uuid, text, boolean, boolean)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
