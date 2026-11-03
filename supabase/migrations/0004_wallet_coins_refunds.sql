-- SHOPZENT 0004: wallet ledger (rupee store credit), coin ledger (loyalty points, NOT money),
-- refund ledger (rupees), refund events. All append-only.

create table if not exists public.wallet_ledger (
  id bigserial primary key,
  txn_ref text not null unique,
  user_id uuid not null references public.profiles (id),
  wallet_id uuid not null references public.wallets (id),
  direction text not null check (direction in ('credit', 'debit')),
  kind text not null check (kind in ('return_credit', 'promo_credit', 'admin_adjust', 'purchase_debit', 'reversal', 'refund_credit')),
  amount numeric(12,2) not null check (amount > 0),
  status text not null default 'posted' check (status in ('pending', 'posted')),
  order_id uuid references public.orders (id),
  return_id uuid references public.returns (id),
  note text,
  created_by uuid,
  idempotency_key text unique,
  reverses_id bigint references public.wallet_ledger (id),
  created_at timestamptz not null default now()
);
create index if not exists wallet_ledger_user_idx on public.wallet_ledger (user_id, id desc);
create index if not exists wallet_ledger_order_idx on public.wallet_ledger (order_id);

create table if not exists public.coin_settings (
  id int primary key default 1 check (id = 1),
  enabled boolean not null default true,
  total_supply bigint not null default 5000000000 check (total_supply >= 0),
  expiry_days int check (expiry_days is null or expiry_days between 1 and 3650),
  rules text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table if not exists public.coin_ledger (
  id bigserial primary key,
  txn_ref text not null unique,
  user_id uuid references public.profiles (id),          -- null = treasury
  kind text not null check (kind in ('mint', 'issue', 'redeem', 'reversal', 'expire')),
  coins bigint not null check (coins > 0),
  note text,
  expires_at timestamptz,
  reverses_id bigint references public.coin_ledger (id),
  created_by uuid,
  idempotency_key text unique,
  created_at timestamptz not null default now(),
  check ((kind = 'mint') = (user_id is null))
);
create index if not exists coin_ledger_user_idx on public.coin_ledger (user_id, id desc);
-- an issue can be reversed at most once
create unique index if not exists coin_ledger_one_reversal
  on public.coin_ledger (reverses_id) where kind = 'reversal';
create unique index if not exists coin_ledger_one_expiry
  on public.coin_ledger (reverses_id) where kind = 'expire';

-- refunds (rupees). Amount/order/method never change; status may only move
-- processing -> completed|failed (guarded by trigger). Every change is also
-- written to the fully immutable refund_events table.
create table if not exists public.refund_ledger (
  id bigserial primary key,
  refund_ref text not null unique,
  order_id uuid not null references public.orders (id),
  return_id uuid references public.returns (id),
  user_id uuid not null references public.profiles (id),
  amount numeric(12,2) not null check (amount > 0),
  method text not null check (method in ('original_payment', 'wallet')),
  status text not null default 'processing' check (status in ('processing', 'completed', 'failed')),
  external_reference text,
  note text,
  created_by uuid,
  idempotency_key text not null unique,
  completed_by uuid,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists refund_ledger_order_idx on public.refund_ledger (order_id);

create table if not exists public.refund_events (
  id bigserial primary key,
  refund_id bigint not null references public.refund_ledger (id),
  order_id uuid not null,
  event text not null,
  amount numeric(12,2),
  external_reference text,
  actor_id uuid,
  created_at timestamptz not null default now()
);

create or replace function public._refund_ledger_guard()
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
  if tg_op = 'DELETE' then
    raise exception 'immutable_ledger';
  end if;
  if new.id <> old.id or new.refund_ref <> old.refund_ref or new.order_id <> old.order_id
     or new.return_id is distinct from old.return_id or new.user_id <> old.user_id
     or new.amount <> old.amount or new.method <> old.method or new.created_by is distinct from old.created_by
     or new.idempotency_key <> old.idempotency_key or new.created_at <> old.created_at
     or new.note is distinct from old.note then
    raise exception 'immutable_ledger';
  end if;
  if old.status <> 'processing' or new.status not in ('completed', 'failed') then
    raise exception 'immutable_ledger';
  end if;
  return new;
end;
$$;

drop trigger if exists refund_ledger_guard on public.refund_ledger;
create trigger refund_ledger_guard before update or delete on public.refund_ledger
  for each row execute function public._refund_ledger_guard();

do $$
declare
  t text;
begin
  foreach t in array array['wallet_ledger', 'coin_ledger', 'refund_events', 'order_events'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_immutable', t);
    execute format('create trigger %I before update or delete on public.%I for each row execute function public._reject_ledger_change()', t || '_immutable', t);
  end loop;
  foreach t in array array['wallet_ledger', 'coin_ledger', 'refund_events', 'order_events', 'refund_ledger'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_no_truncate', t);
    execute format('create trigger %I before truncate on public.%I for each statement execute function public._reject_ledger_change()', t || '_no_truncate', t);
  end loop;
end;
$$;

-- balances (derived, never stored)
create or replace function public._wallet_available(p_user_id uuid)
returns numeric
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(case when l.direction = 'credit' then l.amount else -l.amount end)
                  filter (where l.status = 'posted' or l.direction = 'debit'), 0)::numeric(12,2)
  from public.wallet_ledger l where l.user_id = p_user_id;
$$;

create or replace function public._coin_treasury_available()
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(case l.kind when 'mint' then l.coins when 'issue' then -l.coins when 'reversal' then l.coins else 0 end), 0)::bigint
  from public.coin_ledger l;
$$;

create or replace function public._coin_balance(p_user_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(case l.kind when 'issue' then l.coins else -l.coins end), 0)::bigint
  from public.coin_ledger l where l.user_id = p_user_id and l.kind in ('issue', 'redeem', 'reversal', 'expire');
$$;

create or replace function public._wallet_post(p_user_id uuid, p_direction text, p_kind text, p_amount numeric,
                                               p_note text, p_order_id uuid default null, p_return_id uuid default null,
                                               p_idem text default null, p_reverses bigint default null)
returns public.wallet_ledger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_wallet public.wallets;
  v_row public.wallet_ledger;
begin
  select * into v_wallet from public.wallets w where w.user_id = p_user_id for update;
  if not found then
    raise exception 'not_found';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'invalid_input';
  end if;
  if p_direction = 'debit' and public._wallet_available(p_user_id) < round(p_amount, 2) then
    raise exception 'insufficient_balance';
  end if;
  insert into public.wallet_ledger (txn_ref, user_id, wallet_id, direction, kind, amount, status, order_id, return_id, note, created_by, idempotency_key, reverses_id)
  values (public._unique_code('SZWT-', 10, 'public.wallet_ledger', 'txn_ref'), p_user_id, v_wallet.id, p_direction, p_kind,
          round(p_amount, 2), 'posted', p_order_id, p_return_id, left(p_note, 500), auth.uid(), p_idem, p_reverses)
  returning * into v_row;
  return v_row;
end;
$$;
