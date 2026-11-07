-- 0039: game podium: admin-set winners when nobody wins, real winners' photo/name reset after 7 days
CREATE OR REPLACE FUNCTION public.game_state()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid := auth.uid(); v_week date := public._game_week_start(); v_cfg jsonb; v_enabled boolean; v_target int;
  v_prizes jsonb; v_winners int; v_pweek date; v_podium jsonb; v_me jsonb := null; v_today int := 0; v_prize_today int := 0;
  v_won_place int; v_decided boolean; v_my_wins jsonb := '[]'::jsonb; v_seen boolean; v_adm jsonb;
begin
  v_cfg := coalesce((select value from public.site_settings where key = 'game_weekly'), '{}'::jsonb);
  v_enabled := coalesce((v_cfg ->> 'enabled')::boolean, false);
  v_target := greatest(100, least(1000000, coalesce((v_cfg ->> 'target_score')::int, 3600)));
  v_prizes := coalesce(v_cfg -> 'prizes', '[30, 20, 10]'::jsonb);
  select count(*) into v_winners from public.game_winners where week_key = v_week;
  v_decided := v_winners >= 3;
  v_pweek := coalesce(case when v_winners > 0 then v_week end, (select max(week_key) from public.game_winners));
  v_adm := coalesce((select value from public.site_settings where key = 'game_podium_admin'), '{}'::jsonb);
  select coalesce(jsonb_agg(x.j order by (x.j ->> 'place')::int), '[]'::jsonb) into v_podium from (
    select jsonb_build_object('place', pl.place, 'name', coalesce(rw.name, am.name), 'photo_path', coalesce(rw.photo, am.photo), 'coins', rw.coins, 'manual', rw.place is null) j
    from generate_series(1, 3) pl(place)
    left join lateral (select w.place, w.coins,
        coalesce(nullif(w.name_approved, ''), nullif(left(split_part(btrim(p.full_name), ' ', 1), 20), ''), 'Winner') as name,
        case when w.submit_status = 'approved' then w.photo_public_path end as photo
      from public.game_winners w join public.profiles p on p.id = w.user_id
      where w.week_key = v_pweek and w.place = pl.place
        and coalesce(case when w.submit_status = 'approved' then w.reviewed_at end, w.won_at) > now() - interval '7 days') rw on true
    left join lateral (select v_adm -> (pl.place::text) ->> 'name' as name, v_adm -> (pl.place::text) ->> 'photo_path' as photo
      where v_adm ? (pl.place::text) and coalesce(v_adm -> (pl.place::text) ->> 'name', '') <> '') am on true
    where rw.place is not null or am.name is not null) x;
  if v_uid is not null and exists (select 1 from public.profiles where id = v_uid and status = 'active') then
    select count(*) filter (where prize_run), count(*) into v_prize_today, v_today
    from public.game_runs where user_id = v_uid and started_at >= (date_trunc('day', now() at time zone 'Asia/Calcutta') at time zone 'Asia/Calcutta');
    select place into v_won_place from public.game_winners where week_key = v_week and user_id = v_uid;
    select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'week_key', w.week_key, 'place', w.place, 'coins', w.coins,
        'submit_status', w.submit_status, 'name_submitted', w.name_submitted, 'reject_reason', w.reject_reason,
        'photo_public_path', case when w.submit_status = 'approved' then w.photo_public_path end, 'expired', (coalesce(case when w.submit_status = 'approved' then w.reviewed_at end, w.won_at) < now() - interval '7 days')) order by w.week_key desc), '[]'::jsonb)
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
end $function$
;
CREATE OR REPLACE FUNCTION public.game_submit_winner(p_win_id bigint, p_name text, p_photo_path text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_uid uuid; w public.game_winners%rowtype; v_name text;
begin
  v_uid := public._require_user();
  perform public.hit_rate_limit('game_submit_winner', v_uid::text, 10, 3600);
  select * into w from public.game_winners where id = p_win_id and user_id = v_uid for update;
  if not found then raise exception 'not_found'; end if;
  if w.submit_status = 'approved' then raise exception 'already_approved'; end if;
  if w.won_at < now() - interval '7 days' then raise exception 'expired'; end if;
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
end $function$
;
create or replace function public.admin_set_game_podium(p_place int, p_name text, p_public_path text) returns jsonb
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_name text := btrim(coalesce(p_name,'')); cur jsonb;
begin
  perform public._require_admin();
  if p_place not between 1 and 3 then raise exception 'invalid_place'; end if;
  perform set_config('sz.notice_seen','1',true);
  select coalesce(value,'{}'::jsonb) into cur from site_settings where key='game_podium_admin';
  cur := coalesce(cur,'{}'::jsonb);
  if v_name = '' then cur := cur - (p_place::text);
  else
    if char_length(v_name) not between 2 and 30 or v_name ~* '(://|www\.|@|[<>])' or v_name ~ '[[:cntrl:]]' then raise exception 'invalid_name'; end if;
    if p_public_path is not null and (p_public_path !~ '^settings/game-winners/[A-Za-z0-9._-]{1,160}\.jpe?g$' or p_public_path ~ '\.\.') then raise exception 'invalid_photo'; end if;
    cur := jsonb_set(cur, array[p_place::text], jsonb_build_object('name', v_name, 'photo_path', p_public_path, 'set_at', now()), true);
  end if;
  insert into site_settings(key,value,is_public) values ('game_podium_admin', cur, false) on conflict (key) do update set value=excluded.value, updated_at=now();
  perform public._audit('game_podium_admin_set','game_podium',p_place::text,jsonb_build_object('name',v_name));
  return jsonb_build_object('ok',true);
end $$;
revoke all on function public.admin_set_game_podium(int,text,text) from public, anon;
grant execute on function public.admin_set_game_podium(int,text,text) to authenticated;
create or replace function public.admin_get_game_podium() returns jsonb language plpgsql stable security definer set search_path to 'public','pg_temp' as $$
begin perform public._require_admin(); return coalesce((select value from site_settings where key='game_podium_admin'),'{}'::jsonb); end $$;
revoke all on function public.admin_get_game_podium() from public, anon;
grant execute on function public.admin_get_game_podium() to authenticated;
