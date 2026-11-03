-- SHOPZENT 0002: profiles, wallets, security tables, settings, notifications, audit log + role helpers

-- ---------------------------------------------------------------------------
-- Generic trigger helpers
-- ---------------------------------------------------------------------------
create or replace function public._touch_updated_at()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Ledger tables are append-only. The only escape hatch is a documented manual
-- maintenance session run directly as postgres/supabase_admin (never via the API):
--   set local shopzent.ledger_maintenance = 'on';
create or replace function public._reject_ledger_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if coalesce(current_setting('shopzent.ledger_maintenance', true), '') = 'on'
     and session_user in ('postgres', 'supabase_admin') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  raise exception 'immutable_ledger' using detail = tg_table_name || ' rows cannot be ' || lower(tg_op) || 'd';
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  customer_id text not null unique check (customer_id ~ '^SZC-[A-Z0-9]{8}$'),
  full_name text check (full_name is null or char_length(full_name) <= 100),
  email text,
  mobile text check (mobile is null or mobile ~ '^[0-9+ -]{7,16}$'),
  role text not null default 'customer' check (role in ('customer', 'admin', 'super_admin')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  mfa_required boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists profiles_email_idx on public.profiles (lower(email));
create index if not exists profiles_mobile_idx on public.profiles (mobile);

create table if not exists public.wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  wallet_id text not null unique check (wallet_id ~ '^SZW-[A-Z0-9]{8}$'),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Role helpers (SECURITY DEFINER so RLS policies can call them)
-- ---------------------------------------------------------------------------
create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.role from public.profiles p where p.id = auth.uid();
$$;

create or replace function public.is_staff_aal1()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin', 'super_admin') and p.status = 'active'
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_aal() = 'aal2' and public.is_staff_aal1();
$$;

create or replace function public.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.current_aal() = 'aal2' and exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'super_admin' and p.status = 'active'
  );
$$;

-- raises not_authorized (not staff) or mfa_required (staff without aal2)
create or replace function public._require_admin()
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if public.is_admin() then
    return;
  end if;
  if public.is_staff_aal1() then
    raise exception 'mfa_required';
  end if;
  raise exception 'not_authorized';
end;
$$;

create or replace function public._require_super_admin()
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_admin();
  if not public.is_super_admin() then
    raise exception 'not_authorized';
  end if;
end;
$$;

-- signed-in, active customer (any role)
create or replace function public._require_user()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_status text;
begin
  if auth.uid() is null then
    raise exception 'login_required';
  end if;
  select p.status into v_status from public.profiles p where p.id = auth.uid();
  if v_status is null then
    raise exception 'not_found';
  end if;
  if v_status <> 'active' then
    raise exception 'account_suspended';
  end if;
  return auth.uid();
end;
$$;

-- "Fresh authentication": the newest sign-in / MFA verification recorded in the
-- JWT `amr` claim (GoTrue keeps the original timestamps across token refreshes)
-- must be within p_minutes. Falls back to `iat` when no amr claim is present.
create or replace function public.require_fresh(p_minutes int default 15)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_claims jsonb := auth.jwt();
  v_ts bigint;
begin
  select max((e ->> 'timestamp')::bigint) into v_ts
  from jsonb_array_elements(case when jsonb_typeof(v_claims -> 'amr') = 'array' then v_claims -> 'amr' else '[]'::jsonb end) e
  where (e ->> 'timestamp') ~ '^[0-9]+$';
  if v_ts is null then
    v_ts := nullif(v_claims ->> 'iat', '')::bigint;
  end if;
  if v_ts is null or to_timestamp(v_ts) < now() - make_interval(mins => coalesce(p_minutes, 15)) then
    raise exception 'fresh_auth_required';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Security tables
-- ---------------------------------------------------------------------------
create table if not exists public.rate_limits (
  bucket text not null,
  key text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (bucket, key, window_start)
);

create table if not exists public.idempotency (
  key text not null,
  user_id uuid not null,
  action text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, action, key)
);

create table if not exists public.login_attempts (
  id bigserial primary key,
  email_hash text,
  ip_hash text,
  success boolean not null,
  reason text,
  created_at timestamptz not null default now()
);
create index if not exists login_attempts_key_idx on public.login_attempts (email_hash, ip_hash, created_at desc);
create index if not exists login_attempts_time_idx on public.login_attempts (created_at desc);

create table if not exists public.mfa_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  code_hash text not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists mfa_recovery_codes_user_idx on public.mfa_recovery_codes (user_id);

create table if not exists public.audit_log (
  id bigserial primary key,
  actor_id uuid,
  actor_role text,
  action text not null,
  entity text,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  ip inet,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_time_idx on public.audit_log (created_at desc);
create index if not exists audit_log_action_idx on public.audit_log (action, created_at desc);

drop trigger if exists audit_log_immutable on public.audit_log;
create trigger audit_log_immutable before update or delete on public.audit_log
  for each row execute function public._reject_ledger_change();
drop trigger if exists audit_log_no_truncate on public.audit_log;
create trigger audit_log_no_truncate before truncate on public.audit_log
  for each statement execute function public._reject_ledger_change();

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete cascade,
  audience text not null default 'user' check (audience in ('user', 'admin')),
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  check (audience = 'admin' or user_id is not null)
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_admin_idx on public.notifications (audience, created_at desc);

create table if not exists public.site_settings (
  key text primary key check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  value jsonb not null default '{}'::jsonb,
  is_public boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- ---------------------------------------------------------------------------
-- Internal helpers that write security/audit rows
-- ---------------------------------------------------------------------------
create or replace function public._audit(p_action text, p_entity text, p_entity_id text, p_details jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.audit_log (actor_id, actor_role, action, entity, entity_id, details, ip, user_agent)
  values (auth.uid(), coalesce(public.my_role(), nullif(auth.role(), ''), current_user::text), p_action, p_entity, p_entity_id,
          coalesce(p_details, '{}'::jsonb), public._client_ip(), public._user_agent());
end;
$$;

create or replace function public._notify(p_user_id uuid, p_audience text, p_title text, p_body text, p_link text default null)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.notifications (user_id, audience, title, body, link)
  values (p_user_id, p_audience, left(p_title, 200), left(p_body, 1000), p_link);
end;
$$;

-- Fixed-window rate limit. Raises 'rate_limited' when the window count exceeds p_max.
create or replace function public.hit_rate_limit(p_bucket text, p_key text, p_max int, p_window_seconds int)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_window timestamptz;
  v_count int;
begin
  if p_bucket is null or p_key is null or p_max is null or p_max < 1 or p_window_seconds is null or p_window_seconds < 1 then
    raise exception 'invalid_input';
  end if;
  v_window := to_timestamp(floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds);
  insert into public.rate_limits as r (bucket, key, window_start, count)
  values (p_bucket, left(p_key, 200), v_window, 1)
  on conflict (bucket, key, window_start) do update set count = r.count + 1
  returning r.count into v_count;
  if v_count > p_max then
    raise exception 'rate_limited';
  end if;
  -- opportunistic cleanup of old windows (cheap, bounded)
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;
  return v_count;
end;
$$;

-- Idempotency: serialise on (user, action, key) and return a stored result if present.
create or replace function public._idem_begin(p_action text, p_key text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_result jsonb;
begin
  if p_key is null or char_length(p_key) < 8 or char_length(p_key) > 100 then
    raise exception 'invalid_input' using detail = 'idempotency key must be 8-100 characters';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(coalesce(auth.uid()::text, '-') || '|' || p_action || '|' || p_key, 0));
  select i.result into v_result from public.idempotency i
  where i.user_id = coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid)
    and i.action = p_action and i.key = p_key;
  return v_result;
end;
$$;

create or replace function public._idem_store(p_action text, p_key text, p_result jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.idempotency (key, user_id, action, result)
  values (p_key, coalesce(auth.uid(), '00000000-0000-0000-0000-000000000000'::uuid), p_action, p_result)
  on conflict do nothing;
  return p_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- New auth user -> profile + wallet (customer_id SZC-XXXXXXXX, wallet_id SZW-XXXXXXXX)
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_name text;
  v_mobile text;
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
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = lower(new.email), updated_at = now() where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_changed on auth.users;
create trigger on_auth_user_email_changed after update of email on auth.users
  for each row execute function public.handle_user_email_change();

-- Customers may only change full_name / mobile on their own row (also enforced by column grants).
create or replace function public._profiles_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if current_user in ('anon', 'authenticated') then
    if new.id is distinct from old.id
       or new.customer_id is distinct from old.customer_id
       or new.email is distinct from old.email
       or new.role is distinct from old.role
       or new.status is distinct from old.status
       or new.mfa_required is distinct from old.mfa_required
       or new.created_at is distinct from old.created_at then
      raise exception 'not_authorized';
    end if;
    if new.full_name ~ '[<>]' or char_length(btrim(coalesce(new.full_name, ''))) > 100 then
      raise exception 'invalid_input';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_guard on public.profiles;
create trigger profiles_guard before update on public.profiles
  for each row execute function public._profiles_guard();

drop trigger if exists site_settings_touch on public.site_settings;
create trigger site_settings_touch before update on public.site_settings
  for each row execute function public._touch_updated_at();
