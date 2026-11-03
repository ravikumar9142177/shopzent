-- SHOPZENT 0001: extensions, helper functions (ids, auth/role checks, rate limit, idempotency, audit)
-- Runs as the `postgres` role in the Supabase SQL editor or via `supabase db push`.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Random, unbiased, URL-safe codes (32-char alphabet, no 0/O/1/I ambiguity).
-- ---------------------------------------------------------------------------
create or replace function public._rand_code(p_len int)
returns text
language plpgsql
volatile
set search_path = public, pg_temp
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; -- 32 symbols: 256 % 32 = 0, no modulo bias
  v_bytes bytea;
  v_out text := '';
  i int;
begin
  if p_len is null or p_len < 1 or p_len > 64 then
    raise exception 'invalid_input';
  end if;
  v_bytes := extensions.gen_random_bytes(p_len);
  for i in 0 .. p_len - 1 loop
    v_out := v_out || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  return v_out;
end;
$$;

-- prefix || random code, retried until it does not exist in tbl.col (unique index is the final guard)
create or replace function public._unique_code(p_prefix text, p_len int, p_tbl regclass, p_col text)
returns text
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v text;
  v_exists boolean;
  i int;
begin
  for i in 1 .. 20 loop
    v := p_prefix || public._rand_code(p_len);
    execute format('select exists (select 1 from %s where %I = $1)', p_tbl, p_col) into v_exists using v;
    if not v_exists then
      return v;
    end if;
  end loop;
  raise exception 'id_generation_failed';
end;
$$;

-- ---------------------------------------------------------------------------
-- Request context helpers
-- ---------------------------------------------------------------------------
create or replace function public.current_aal()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1');
$$;

-- first hop of x-forwarded-for as PostgREST exposes it (null outside PostgREST)
create or replace function public._client_ip()
returns inet
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v text;
begin
  begin
    v := nullif(current_setting('request.headers', true), '')::json ->> 'x-forwarded-for';
    v := btrim(split_part(v, ',', 1));
    if v is null or v = '' then
      v := nullif(current_setting('request.headers', true), '')::json ->> 'cf-connecting-ip';
    end if;
    return v::inet;
  exception when others then
    return null;
  end;
end;
$$;

create or replace function public._user_agent()
returns text
language plpgsql
stable
set search_path = public, pg_temp
as $$
begin
  return left(nullif(current_setting('request.headers', true), '')::json ->> 'user-agent', 300);
exception when others then
  return null;
end;
$$;

-- key used for rate limiting: the user id, else the client IP, else a shared anon bucket
create or replace function public._client_key()
returns text
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce('u:' || auth.uid()::text, 'ip:' || host(public._client_ip()), 'anon');
$$;
