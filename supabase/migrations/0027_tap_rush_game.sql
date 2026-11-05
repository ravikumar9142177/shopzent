-- SHOPZENT 0027: Tap Rush (weekly game, server-validated runs, first-3 weekly prizes, winner photo + name with admin approval).
-- Week = Monday 00:00 to next Monday 00:00, Asia/Calcutta. Prize coins are internal points (never money).
-- Idempotent. Admin writes set sz.notice_seen so they never fire the customer update notice.

insert into public.site_settings (key, value, is_public) values
  ('game_weekly', '{"enabled": true, "target_score": 3600, "prizes": [30, 20, 10]}'::jsonb, false)
on conflict (key) do nothing;

-- ---------- tables ----------
create table if not exists public.game_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id),
  week_key date not null,
  seed bigint not null,
  target int not null,
  prize_run boolean not null default false,
  status text not null default 'started' check (status in ('started', 'finished', 'rejected')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  score int,
  hits int,
  best_combo int,
  taps int,
  reject_reason text
);
create index if not exists game_runs_user_started_idx on public.game_runs (user_id, started_at desc);
alter table public.game_runs enable row level security;
drop policy if exists game_runs_own_read on public.game_runs;
create policy game_runs_own_read on public.game_runs for select to authenticated using (user_id = auth.uid());
revoke all on public.game_runs from public, anon, authenticated;
grant select on public.game_runs to authenticated;

create table if not exists public.game_winners (
  id bigserial primary key,
  week_key date not null,
  place int not null check (place between 1 and 3),
  user_id uuid not null references public.profiles (id),
  run_id uuid references public.game_runs (id),
  score int not null,
  coins bigint not null default 0 check (coins >= 0),
  won_at timestamptz not null default now(),
  coin_ledger_id bigint,
  unique (week_key, place),
  unique (week_key, user_id),
  name_submitted text,
  photo_pending_path text,
  submit_status text not null default 'none' check (submit_status in ('none', 'pending', 'approved', 'rejected')),
  submitted_at timestamptz,
  reviewed_at timestamptz,
  reject_reason text,
  name_approved text,
  photo_public_path text
);
alter table public.game_winners enable row level security;
-- no policies and no grants: customers and admins reach it only through the SECURITY DEFINER functions below
revoke all on public.game_winners from public, anon, authenticated;

-- ---------- helpers ----------
create or replace function public._game_week_start() returns date
language sql stable set search_path = public, pg_temp as $$
  select (date_trunc('week', now() at time zone 'Asia/Calcutta'))::date
$$;

-- LCG step, exact in bigint: s' = (1664525 * s + 1013904223) mod 2^32. Tap Rush's JavaScript twin uses the same integers.
create or replace function public._game_next(p_s bigint) returns bigint
language sql immutable set search_path = public, pg_temp as $$
  select (1664525::bigint * p_s + 1013904223::bigint) % 4294967296::bigint
$$;

-- The target schedule of one run, a pure function of the seed (integer ms, integer per-mille positions).
-- kind: 0 normal (10 pts), 1 gold (30 pts, shorter life), 2 bomb (tap = combo reset and -15). Must match site/js/game/core.js.
create or replace function public._game_schedule(p_seed bigint)
returns table (k int, t int, life int, kind int, x int, y int)
language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v_s bigint := p_seed; v_t int := 800; v_k int := 0; v_r int; v_kind int; v_bl int; v_life int; v_x int; v_y int; v_iv int;
begin
  while v_t < 30000 loop
    v_s := public._game_next(v_s); v_r := ((v_s >> 16) % 100)::int;
    v_kind := case when v_r < 7 then (case when v_t >= 4000 then 2 else 0 end) when v_r < 16 then 1 else 0 end;
    v_bl := 1250 - (v_t * 700 / 30000);
    v_life := case when v_kind = 1 then greatest(380, v_bl - 220) else v_bl end;
    v_s := public._game_next(v_s); v_x := 80 + ((v_s >> 16) % 840)::int;
    v_s := public._game_next(v_s); v_y := 120 + ((v_s >> 16) % 760)::int;
    k := v_k; t := v_t; life := v_life; kind := v_kind; x := v_x; y := v_y;
    return next;
    v_k := v_k + 1;
    v_s := public._game_next(v_s);
    v_iv := 720 - (v_t * 430 / 30000) + ((v_s >> 16) % 200)::int - 100;
    v_t := v_t + greatest(230, v_iv);
  end loop;
  return;
end $$;

-- Re-plays a run from its seed and the client's tap list. Pure: returns {ok, score, hits, best_combo, taps} or {ok:false, reason}.
-- Tap list items: {"t": ms since the first countdown-free frame, "k": target index or -1 for an empty tap}.
create or replace function public._game_judge(p_seed bigint, p_events jsonb, p_elapsed_ms bigint)
returns jsonb language plpgsql set search_path = public, pg_temp as $$
declare
  v_n int; v_ok int; v_score int := 0; v_combo int := 0; v_best int := 0; v_hits int := 0; v_mult int; v_pts int;
  v_min_gap int; v_win int; v_sd numeric; v_gaps int; v_bad int; v_last int; v_r record;
begin
  if p_events is null or jsonb_typeof(p_events) <> 'array' then return jsonb_build_object('ok', false, 'reason', 'bad_events'); end if;
  v_n := jsonb_array_length(p_events);
  if v_n > 400 then return jsonb_build_object('ok', false, 'reason', 'too_many_taps'); end if;
  if p_elapsed_ms is null or p_elapsed_ms < 29500 or p_elapsed_ms > 900000 then
    return jsonb_build_object('ok', false, 'reason', 'bad_duration');
  end if;
  if v_n = 0 then return jsonb_build_object('ok', true, 'score', 0, 'hits', 0, 'best_combo', 0, 'taps', 0); end if;

  create temporary table if not exists _tr_taps (n int primary key, t int not null, k int not null) on commit drop;
  delete from _tr_taps;
  insert into _tr_taps (n, t, k)
  select a.n::int, (a.e->>'t')::int, (a.e->>'k')::int
  from jsonb_array_elements(p_events) with ordinality as a(e, n)
  where jsonb_typeof(a.e) = 'object' and coalesce(a.e->>'t', '') ~ '^[0-9]{1,7}$' and coalesce(a.e->>'k', '') ~ '^-?[0-9]{1,3}$';
  get diagnostics v_ok = row_count;
  if v_ok <> v_n then return jsonb_build_object('ok', false, 'reason', 'bad_event'); end if;
  if exists (select 1 from _tr_taps where t > 30100 or k < -1 or k > 200) then return jsonb_build_object('ok', false, 'reason', 'bad_event'); end if;

  -- timing rules: ordered, not faster than a human can tap, not bursts above the rate, not machine-regular
  select count(*) into v_bad from (select t, lag(t) over (order by n) as pt from _tr_taps) x where pt > t;
  if v_bad > 0 then return jsonb_build_object('ok', false, 'reason', 'time_order'); end if;
  select min(g), stddev_samp(g), count(g) into v_min_gap, v_sd, v_gaps
  from (select t - lag(t) over (order by n) as g from _tr_taps) x;
  if v_gaps > 0 and v_min_gap < 35 then return jsonb_build_object('ok', false, 'reason', 'too_fast'); end if;
  select coalesce(max(c), 0) into v_win from (select (select count(*) from _tr_taps b where b.t <= a.t and b.t > a.t - 1000) as c from _tr_taps a) s;
  if v_win > 14 then return jsonb_build_object('ok', false, 'reason', 'rate_limit'); end if;
  if v_gaps >= 25 and v_sd < 8 then return jsonb_build_object('ok', false, 'reason', 'too_regular'); end if;
  select max(t) into v_last from _tr_taps;
  if v_last > p_elapsed_ms + 1000 then return jsonb_build_object('ok', false, 'reason', 'tap_after_finish'); end if;
  if exists (select 1 from _tr_taps where k >= 0 group by k having count(*) > 1) then
    return jsonb_build_object('ok', false, 'reason', 'duplicate_tap');
  end if;

  -- every target tap must hit a target that was alive at that moment (80 ms latency slack)
  select count(*) into v_bad from _tr_taps o
  left join lateral (select * from public._game_schedule(p_seed) s where s.k = o.k) s on true
  where o.k >= 0 and (s.k is null or o.t < s.t - 80 or o.t > s.t + s.life + 80);
  if v_bad > 0 then return jsonb_build_object('ok', false, 'reason', 'tap_off_target'); end if;

  -- replay: taps and misses in time order (a miss = an untapped normal/gold target that expired inside the run)
  for v_r in
    select o.t as tm, 0 as typ, o.k, s.kind
    from _tr_taps o left join public._game_schedule(p_seed) s on s.k = o.k
    union all
    select s.t + s.life + 80, 1, s.k, s.kind
    from public._game_schedule(p_seed) s
    where s.kind <> 2 and s.t + s.life + 80 <= 30000
      and not exists (select 1 from _tr_taps o where o.k = s.k)
    order by 1, 2
  loop
    if v_r.typ = 1 then
      v_combo := 0;
    elsif v_r.k = -1 then
      v_combo := 0;
    elsif v_r.kind = 2 then
      v_combo := 0; v_score := greatest(0, v_score - 15);
    else
      v_combo := v_combo + 1; v_hits := v_hits + 1; v_best := greatest(v_best, v_combo);
      v_mult := least(8, 1 + v_combo / 5);
      v_pts := case when v_r.kind = 1 then 30 else 10 end;
      v_score := v_score + v_pts * v_mult;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'score', v_score, 'hits', v_hits, 'best_combo', v_best, 'taps', v_n);
end $$;

-- prize coins for a place from the settings, clamped to 0..30 and to the weekly total of 60 (never more)
create or replace function public._game_prize_coins(p_week date, p_place int) returns bigint
language plpgsql stable set search_path = public, pg_temp as $$
declare v_cfg jsonb; v_v bigint; v_paid bigint;
begin
  v_cfg := coalesce((select value from public.site_settings where key = 'game_weekly'), '{}'::jsonb);
  v_v := coalesce((v_cfg #>> array['prizes', (p_place - 1)::text])::bigint, case p_place when 1 then 30 when 2 then 20 else 10 end);
  v_v := greatest(0, least(30, v_v));
  select coalesce(sum(coins), 0) into v_paid from public.game_winners where week_key = p_week;
  return greatest(0, least(v_v, 60 - v_paid));
end $$;

-- a signed-in account whose recent runs were rejected loses prize eligibility (the run still plays for fun)
create or replace function public._game_prize_ok(p_uid uuid) returns boolean
language sql stable set search_path = public, pg_temp as $$
  select (select count(*) from public.game_runs r
          where r.user_id = p_uid and r.status = 'rejected' and r.started_at > now() - interval '1 day') < 10
$$;

create or replace function public._game_is_winner(p_uid uuid) returns boolean
language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from public.game_winners w where w.user_id = p_uid)
$$;

revoke all on function public._game_week_start() from public, anon, authenticated;
revoke all on function public._game_next(bigint) from public, anon, authenticated;
revoke all on function public._game_schedule(bigint) from public, anon, authenticated;
revoke all on function public._game_judge(bigint, jsonb, bigint) from public, anon, authenticated;
revoke all on function public._game_prize_coins(date, int) from public, anon, authenticated;
revoke all on function public._game_prize_ok(uuid) from public, anon, authenticated;
revoke all on function public._game_is_winner(uuid) from public, anon;
grant execute on function public._game_is_winner(uuid) to authenticated;

-- ---------- customer RPCs ----------
create or replace function public.game_start() returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid; v_week date := public._game_week_start(); v_cfg jsonb; v_enabled boolean; v_target int;
  v_winners int; v_won boolean; v_prize boolean; v_prize_today int; v_all_today int; v_seed bigint; v_id uuid;
begin
  v_uid := public._require_user();
  perform public.hit_rate_limit('game_start', v_uid::text, 30, 600);
  v_cfg := coalesce((select value from public.site_settings where key = 'game_weekly'), '{}'::jsonb);
  v_enabled := coalesce((v_cfg ->> 'enabled')::boolean, false);
  v_target := greatest(100, least(1000000, coalesce((v_cfg ->> 'target_score')::int, 3600)));
  select count(*) into v_winners from public.game_winners where week_key = v_week;
  select exists (select 1 from public.game_winners w where w.week_key = v_week and w.user_id = v_uid) into v_won;
  v_prize := v_enabled and v_winners < 3 and not v_won and public._game_prize_ok(v_uid);
  select count(*) filter (where prize_run), count(*) into v_prize_today, v_all_today
  from public.game_runs where user_id = v_uid and started_at >= (date_trunc('day', now() at time zone 'Asia/Calcutta') at time zone 'Asia/Calcutta');
  if v_all_today >= 400 then raise exception 'daily_limit'; end if;
  if v_prize and v_prize_today >= 60 then raise exception 'daily_prize_limit'; end if;
  v_seed := floor(random() * 4294967296)::bigint;
  insert into public.game_runs (user_id, week_key, seed, target, prize_run)
  values (v_uid, v_week, v_seed, v_target, v_prize) returning id into v_id;
  return jsonb_build_object('run_id', v_id, 'seed', v_seed, 'duration_ms', 30000, 'prize_run', v_prize,
    'target', v_target, 'week_key', v_week, 'week_ends_at', ((v_week::timestamp + interval '7 days') at time zone 'Asia/Calcutta'));
end $$;

create or replace function public.game_finish(p_run_id uuid, p_events jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid; r public.game_runs%rowtype; v_now timestamptz := now(); v_el bigint; v_j jsonb; v_score int;
  v_winners int; v_already boolean; v_place int; v_coins bigint; v_led bigint; v_key text;
begin
  v_uid := public._require_user();
  perform public.hit_rate_limit('game_finish', v_uid::text, 60, 600);
  select * into r from public.game_runs where id = p_run_id for update;
  if not found or r.user_id <> v_uid then raise exception 'not_found'; end if;
  if r.status <> 'started' then raise exception 'run_already_finished'; end if;
  v_el := floor(extract(epoch from (v_now - r.started_at)) * 1000)::bigint;
  v_j := public._game_judge(r.seed, p_events, v_el);
  if not coalesce((v_j ->> 'ok')::boolean, false) then
    update public.game_runs set status = 'rejected', finished_at = v_now, reject_reason = v_j ->> 'reason' where id = r.id;
    perform public._audit('game_run_rejected', 'game_run', r.id::text, jsonb_build_object('reason', v_j ->> 'reason'));
    return jsonb_build_object('ok', false, 'reason', v_j ->> 'reason');
  end if;
  v_score := (v_j ->> 'score')::int;
  update public.game_runs set status = 'finished', finished_at = v_now, score = v_score, hits = (v_j ->> 'hits')::int,
    best_combo = (v_j ->> 'best_combo')::int, taps = (v_j ->> 'taps')::int where id = r.id;
  if not r.prize_run then
    return jsonb_build_object('ok', true, 'score', v_score, 'best_combo', (v_j ->> 'best_combo')::int, 'hits', (v_j ->> 'hits')::int,
      'prize', jsonb_build_object('eligible', false));
  end if;

  -- prize decision: one at a time per week, so the order of places is the order of verified finishes
  perform pg_advisory_xact_lock(hashtextextended('game-week|' || r.week_key::text, 0));
  if r.week_key <> public._game_week_start() then
    return jsonb_build_object('ok', true, 'score', v_score, 'best_combo', (v_j ->> 'best_combo')::int, 'hits', (v_j ->> 'hits')::int,
      'prize', jsonb_build_object('eligible', true, 'won', false, 'reason', 'week_closed'));
  end if;
  if v_score < r.target then
    return jsonb_build_object('ok', true, 'score', v_score, 'best_combo', (v_j ->> 'best_combo')::int, 'hits', (v_j ->> 'hits')::int,
      'prize', jsonb_build_object('eligible', true, 'won', false, 'reason', 'below_target', 'target', r.target));
  end if;
  select count(*) into v_winners from public.game_winners where week_key = r.week_key;
  select exists (select 1 from public.game_winners w where w.week_key = r.week_key and w.user_id = v_uid) into v_already;
  if v_already then
    return jsonb_build_object('ok', true, 'score', v_score, 'best_combo', (v_j ->> 'best_combo')::int, 'hits', (v_j ->> 'hits')::int,
      'prize', jsonb_build_object('eligible', true, 'won', false, 'reason', 'already_won_this_week'));
  end if;
  if v_winners >= 3 then
    return jsonb_build_object('ok', true, 'score', v_score, 'best_combo', (v_j ->> 'best_combo')::int, 'hits', (v_j ->> 'hits')::int,
      'prize', jsonb_build_object('eligible', true, 'won', false, 'reason', 'winners_decided'));
  end if;
  v_place := v_winners + 1;
  v_coins := public._game_prize_coins(r.week_key, v_place);
  perform set_config('sz.notice_seen', '1', true);
  insert into public.game_winners (week_key, place, user_id, run_id, score, coins)
  values (r.week_key, v_place, v_uid, r.id, v_score, v_coins);
  v_key := 'game:' || r.week_key::text || ':' || v_place::text;
  if v_coins > 0 then
    v_led := public._referral_issue(v_uid, v_coins, 'Tap Rush prize #' || v_place, v_key);
    update public.game_winners set coin_ledger_id = v_led where week_key = r.week_key and place = v_place;
  end if;
  perform public._notify(v_uid, 'user', 'Tap Rush: you are #' || v_place || ' this week!',
    v_coins || ' coins wallet me aa gaye hain. Apni photo aur naam game page par add karein.', '/game.html');
  perform public._audit('game_winner_awarded', 'game_winner', r.week_key::text || ':' || v_place::text,
    jsonb_build_object('place', v_place, 'coins', v_coins, 'score', v_score));
  return jsonb_build_object('ok', true, 'score', v_score, 'best_combo', (v_j ->> 'best_combo')::int, 'hits', (v_j ->> 'hits')::int,
    'prize', jsonb_build_object('eligible', true, 'won', true, 'place', v_place, 'coins', v_coins));
end $$;

-- public-safe state. Anyone may call it; the personal block is filled only for a signed-in account.
create or replace function public.game_state() returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid := auth.uid(); v_week date := public._game_week_start(); v_cfg jsonb; v_enabled boolean; v_target int;
  v_prizes jsonb; v_winners int; v_pweek date; v_podium jsonb; v_me jsonb := null; v_today int := 0; v_prize_today int := 0;
  v_won_place int; v_decided boolean; v_my_wins jsonb := '[]'::jsonb; v_seen boolean;
begin
  v_cfg := coalesce((select value from public.site_settings where key = 'game_weekly'), '{}'::jsonb);
  v_enabled := coalesce((v_cfg ->> 'enabled')::boolean, false);
  v_target := greatest(100, least(1000000, coalesce((v_cfg ->> 'target_score')::int, 3600)));
  v_prizes := coalesce(v_cfg -> 'prizes', '[30, 20, 10]'::jsonb);
  select count(*) into v_winners from public.game_winners where week_key = v_week;
  v_decided := v_winners >= 3;
  v_pweek := coalesce(case when v_winners > 0 then v_week end, (select max(week_key) from public.game_winners));
  select coalesce(jsonb_agg(jsonb_build_object(
      'place', w.place,
      'name', coalesce(nullif(w.name_approved, ''), nullif(left(split_part(btrim(p.full_name), ' ', 1), 20), ''), 'Winner'),
      'photo_path', case when w.submit_status = 'approved' then w.photo_public_path end,
      'coins', w.coins) order by w.place), '[]'::jsonb)
    into v_podium
  from public.game_winners w join public.profiles p on p.id = w.user_id
  where w.week_key = v_pweek;
  if v_uid is not null and exists (select 1 from public.profiles where id = v_uid and status = 'active') then
    select count(*) filter (where prize_run), count(*) into v_prize_today, v_today
    from public.game_runs where user_id = v_uid and started_at >= (date_trunc('day', now() at time zone 'Asia/Calcutta') at time zone 'Asia/Calcutta');
    select place into v_won_place from public.game_winners where week_key = v_week and user_id = v_uid;
    select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'week_key', w.week_key, 'place', w.place, 'coins', w.coins,
        'submit_status', w.submit_status, 'name_submitted', w.name_submitted, 'reject_reason', w.reject_reason,
        'photo_public_path', case when w.submit_status = 'approved' then w.photo_public_path end) order by w.week_key desc), '[]'::jsonb)
      into v_my_wins from (select * from public.game_winners where user_id = v_uid order by week_key desc limit 6) w;
    v_me := jsonb_build_object(
      'won_place', v_won_place,
      'prize_plays_left', greatest(0, 60 - v_prize_today),
      'plays_today', v_today,
      'prize_eligible_now', v_enabled and not v_decided and v_won_place is null and public._game_prize_ok(v_uid),
      'wins', v_my_wins);
  end if;
  return jsonb_build_object(
    'enabled', v_enabled,
    'week_key', v_week,
    'week_ends_at', ((v_week::timestamp + interval '7 days') at time zone 'Asia/Calcutta'),
    'target', v_target,
    'prizes', v_prizes,
    'winners_count', v_winners,
    'decided', v_decided,
    'podium_week', v_pweek,
    'podium', v_podium,
    'logged_in', v_uid is not null,
    'me', v_me);
end $$;

-- a winner adds a photo (already uploaded to their own folder of the private game-photos bucket) and a display name.
-- It stays PENDING until an admin approves it; nothing shows publicly before that.
create or replace function public.game_submit_winner(p_win_id bigint, p_name text, p_photo_path text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_uid uuid; w public.game_winners%rowtype; v_name text;
begin
  v_uid := public._require_user();
  perform public.hit_rate_limit('game_submit_winner', v_uid::text, 10, 3600);
  select * into w from public.game_winners where id = p_win_id and user_id = v_uid for update;
  if not found then raise exception 'not_found'; end if;
  if w.submit_status = 'approved' then raise exception 'already_approved'; end if;
  v_name := btrim(coalesce(p_name, ''));
  if char_length(v_name) not between 2 and 30 or v_name ~* '(://|www\.|@|[<>]|\.(com|in|net|org|shop|co|io|me|xyz|info|app|ru|tk)\y)'
     or v_name ~ '[[:cntrl:]]' then
    raise exception 'invalid_name';
  end if;
  if coalesce(p_photo_path, '') !~ ('^' || v_uid::text || '/[A-Za-z0-9._-]{1,120}\.jpe?g$') or p_photo_path ~ '\.\.'
     or not exists (select 1 from storage.objects o where o.bucket_id = 'game-photos' and o.name = p_photo_path) then
    raise exception 'invalid_photo';
  end if;
  update public.game_winners set name_submitted = v_name, photo_pending_path = p_photo_path, submit_status = 'pending',
    submitted_at = now(), reviewed_at = null, reject_reason = null
  where id = w.id;
  perform public._audit('game_winner_submitted', 'game_winner', w.id::text, jsonb_build_object('week', w.week_key, 'place', w.place));
  return jsonb_build_object('ok', true, 'submit_status', 'pending');
end $$;

-- ---------- admin RPCs (AAL2, audited, never fire the customer update notice) ----------
create or replace function public.admin_game_pending_count() returns int
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin();
  return (select count(*)::int from public.game_winners where submit_status = 'pending');
end $$;

create or replace function public.admin_game_winners_list(p_weeks int default 8) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_rows jsonb;
begin
  perform public._require_admin();
  select coalesce(jsonb_agg(x order by x->>'week_key' desc, (x->>'place')::int), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object('id', w.id, 'week_key', w.week_key, 'place', w.place, 'customer_id', p.customer_id,
      'full_name', p.full_name, 'score', w.score, 'coins', w.coins, 'won_at', w.won_at,
      'submit_status', w.submit_status, 'name_submitted', w.name_submitted, 'name_approved', w.name_approved,
      'photo_pending_path', w.photo_pending_path, 'photo_public_path', w.photo_public_path,
      'reject_reason', w.reject_reason, 'submitted_at', w.submitted_at, 'reviewed_at', w.reviewed_at) as x
    from public.game_winners w join public.profiles p on p.id = w.user_id
    where w.week_key >= public._game_week_start() - (greatest(1, least(p_weeks, 52)) * 7)
  ) s;
  return jsonb_build_object('rows', v_rows, 'pending', (select count(*) from public.game_winners where submit_status = 'pending'),
    'week_key', public._game_week_start());
end $$;

create or replace function public.admin_game_approve(p_win_id bigint, p_name text, p_public_path text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare w public.game_winners%rowtype; v_name text;
begin
  perform public._require_admin();
  select * into w from public.game_winners where id = p_win_id for update;
  if not found then raise exception 'not_found'; end if;
  v_name := btrim(coalesce(p_name, ''));
  if char_length(v_name) not between 2 and 30 or v_name ~* '(://|www\.|@|[<>]|\.(com|in|net|org|shop|co|io|me|xyz|info|app|ru|tk)\y)'
     or v_name ~ '[[:cntrl:]]' then
    raise exception 'invalid_name';
  end if;
  if p_public_path is not null and (p_public_path !~ '^settings/game-winners/[A-Za-z0-9._-]{1,160}\.jpe?g$' or p_public_path ~ '\.\.') then
    raise exception 'invalid_photo';
  end if;
  perform set_config('sz.notice_seen', '1', true);
  update public.game_winners set submit_status = 'approved', name_approved = v_name, photo_public_path = p_public_path,
    reviewed_at = now(), reject_reason = null
  where id = w.id;
  perform public._audit('game_winner_approved', 'game_winner', w.id::text, jsonb_build_object('week', w.week_key, 'place', w.place, 'photo', p_public_path is not null));
  return jsonb_build_object('ok', true, 'submit_status', 'approved');
end $$;

-- reject a pending submission, or take an approved entry down (returns the paths to delete from storage)
create or replace function public.admin_game_reject(p_win_id bigint, p_reason text) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare w public.game_winners%rowtype; v_reason text;
begin
  perform public._require_admin();
  v_reason := btrim(coalesce(p_reason, ''));
  if char_length(v_reason) < 3 then raise exception 'reason_required'; end if;
  select * into w from public.game_winners where id = p_win_id for update;
  if not found then raise exception 'not_found'; end if;
  perform set_config('sz.notice_seen', '1', true);
  update public.game_winners set submit_status = 'rejected', reject_reason = left(v_reason, 300), reviewed_at = now(),
    name_approved = null, photo_public_path = null
  where id = w.id;
  perform public._audit('game_winner_rejected', 'game_winner', w.id::text, jsonb_build_object('week', w.week_key, 'place', w.place));
  return jsonb_build_object('ok', true, 'submit_status', 'rejected', 'delete_public', w.photo_public_path, 'delete_pending', w.photo_pending_path);
end $$;

create or replace function public.admin_set_game_settings(p_enabled boolean, p_target int, p_prizes jsonb) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare v_p jsonb; v_sum int := 0; v_i int; v_v int;
begin
  perform public._require_admin();
  if p_target is null or p_target < 100 or p_target > 1000000 then raise exception 'invalid_target'; end if;
  if p_prizes is null or jsonb_typeof(p_prizes) <> 'array' or jsonb_array_length(p_prizes) <> 3 then raise exception 'invalid_prizes'; end if;
  for v_i in 0..2 loop
    v_p := p_prizes -> v_i;
    if jsonb_typeof(v_p) <> 'number' then raise exception 'invalid_prizes'; end if;
    v_v := (v_p #>> '{}')::int;
    if v_v < 0 or v_v > 30 then raise exception 'invalid_prizes'; end if;
    v_sum := v_sum + v_v;
  end loop;
  if v_sum > 60 then raise exception 'prize_total_over_60'; end if;
  perform set_config('sz.notice_seen', '1', true);
  insert into public.site_settings (key, value, is_public, updated_by)
  values ('game_weekly', jsonb_build_object('enabled', coalesce(p_enabled, false), 'target_score', p_target, 'prizes', p_prizes), false, auth.uid())
  on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by;
  perform public._audit('game_settings_changed', 'site_settings', 'game_weekly', jsonb_build_object('enabled', p_enabled, 'target', p_target, 'prizes', p_prizes));
  return jsonb_build_object('ok', true);
end $$;

revoke all on function public.game_start() from public, anon;
revoke all on function public.game_finish(uuid, jsonb) from public, anon;
revoke all on function public.game_submit_winner(bigint, text, text) from public, anon;
grant execute on function public.game_start() to authenticated;
grant execute on function public.game_finish(uuid, jsonb) to authenticated;
grant execute on function public.game_submit_winner(bigint, text, text) to authenticated;
grant execute on function public.game_state() to anon, authenticated;
revoke all on function public.admin_game_pending_count() from public, anon;
revoke all on function public.admin_game_winners_list(int) from public, anon;
revoke all on function public.admin_game_approve(bigint, text, text) from public, anon;
revoke all on function public.admin_game_reject(bigint, text) from public, anon;
revoke all on function public.admin_set_game_settings(boolean, int, jsonb) from public, anon;
grant execute on function public.admin_game_pending_count() to authenticated;
grant execute on function public.admin_game_winners_list(int) to authenticated;
grant execute on function public.admin_game_approve(bigint, text, text) to authenticated;
grant execute on function public.admin_game_reject(bigint, text) to authenticated;
grant execute on function public.admin_set_game_settings(boolean, int, jsonb) to authenticated;

-- ---------- storage: winners' pending photos are PRIVATE; only an approved copy goes to public-media (settings/game-winners/) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('game-photos', 'game-photos', false, 400000, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 400000, allowed_mime_types = array['image/jpeg'];

drop policy if exists shopzent_game_photo_insert on storage.objects;
drop policy if exists shopzent_game_photo_read on storage.objects;
drop policy if exists shopzent_game_photo_delete on storage.objects;
create policy shopzent_game_photo_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'game-photos' and (storage.foldername(name))[1] = auth.uid()::text and name !~ '\.\.'
              and public._game_is_winner(auth.uid()));
create policy shopzent_game_photo_read on storage.objects for select to authenticated
  using (bucket_id = 'game-photos' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
create policy shopzent_game_photo_delete on storage.objects for delete to authenticated
  using (bucket_id = 'game-photos' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
