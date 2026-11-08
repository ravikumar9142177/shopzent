-- 0043: PostgREST rejects 'DELETE requires a WHERE clause'; the game score check cleared its temp table without one, so every real finish failed.
CREATE OR REPLACE FUNCTION public._game_judge(p_seed bigint, p_events jsonb, p_elapsed_ms bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  delete from _tr_taps where true;
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
end $function$
;
