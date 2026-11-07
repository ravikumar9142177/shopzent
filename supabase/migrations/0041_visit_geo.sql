-- 0041: visitor location (state/district, only with the visitor's permission) + custom date range stats
alter table public.site_visit_days add column if not exists state text, add column if not exists district text;
create or replace function public.track_visit_geo(p_vid text, p_state text, p_district text) returns void
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_day date := (now() at time zone 'Asia/Calcutta')::date; s text := left(btrim(coalesce(p_state,'')), 60); d text := left(btrim(coalesce(p_district,'')), 60);
begin
  if p_vid is null or p_vid !~ '^[A-Za-z0-9-]{8,64}$' then return; end if;
  if s = '' or s ~ '[<>]' or d ~ '[<>]' then return; end if;
  perform public.hit_rate_limit('track_geo', p_vid, 20, 3600);
  update site_visit_days set state = s, district = nullif(regexp_replace(d, '\s+district$', '', 'i'), '') where vid = p_vid and day >= v_day - 1;
exception when others then null;
end $$;
revoke all on function public.track_visit_geo(text, text, text) from public;
grant execute on function public.track_visit_geo(text, text, text) to anon, authenticated;

drop function if exists public.admin_visit_stats();
create or replace function public.admin_visit_stats(p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path to 'public','pg_temp' as $$
declare t date := (now() at time zone 'Asia/Calcutta')::date; r jsonb; per jsonb := '{}'::jsonb; d int; f date; z date; cust jsonb; geo_total int; vis_total int;
begin
  perform public._require_admin();
  foreach d in array array[1, 7, 30, 90] loop
    select jsonb_build_object(
      'visitors', count(distinct vid), 'visits', coalesce(sum(hits), 0),
      'logged_visitors', count(distinct vid) filter (where user_id is not null),
      'anon_visitors', count(distinct vid) filter (where user_id is null),
      'web_visitors', count(distinct vid) filter (where src = 'web'), 'app_visitors', count(distinct vid) filter (where src = 'app'),
      'web_visits', coalesce(sum(hits) filter (where src = 'web'), 0), 'app_visits', coalesce(sum(hits) filter (where src = 'app'), 0),
      'registered_new', (select count(*) from profiles where (created_at at time zone 'Asia/Calcutta')::date > t - d))
    into r from site_visit_days where day > t - d;
    per := per || jsonb_build_object(d::text, r);
  end loop;
  f := coalesce(p_from, t - 29); z := coalesce(p_to, t); if z < f then z := f; end if; if z - f > 400 then f := z - 400; end if;
  select count(distinct vid), count(distinct vid) filter (where state is not null) into vis_total, geo_total from site_visit_days where day between f and z;
  select jsonb_build_object('from', f, 'to', z,
    'visitors', vis_total, 'visits', coalesce((select sum(hits) from site_visit_days where day between f and z), 0),
    'logged_visitors', (select count(distinct vid) from site_visit_days where day between f and z and user_id is not null),
    'anon_visitors', (select count(distinct vid) from site_visit_days where day between f and z and user_id is null),
    'registered_new', (select count(*) from profiles where (created_at at time zone 'Asia/Calcutta')::date between f and z),
    'geo_visitors', geo_total,
    'states', coalesce((select jsonb_agg(jsonb_build_object('name', st, 'n', n) order by n desc) from (select state st, count(distinct vid) n from site_visit_days where day between f and z and state is not null group by state) q), '[]'::jsonb),
    'districts', coalesce((select jsonb_agg(jsonb_build_object('name', ds, 'n', n) order by n desc) from (select district ds, count(distinct vid) n from site_visit_days where day between f and z and lower(state) = 'bihar' and district is not null group by district) q), '[]'::jsonb),
    'daily', coalesce((select jsonb_agg(x order by x.day) from (select s.day, count(distinct vid) visitors, sum(hits) visits, count(distinct vid) filter (where src = 'app') app_visitors from site_visit_days s where s.day between greatest(f, z - 30) and z group by s.day) x), '[]'::jsonb)) into cust;
  return jsonb_build_object('periods', per, 'custom', cust,
    'users_total', (select count(*) from profiles),
    'new_today', (select count(*) from profiles where (created_at at time zone 'Asia/Calcutta')::date = t),
    'old_users', (select count(*) from profiles where (created_at at time zone 'Asia/Calcutta')::date < t),
    'tracking_since', (select min(day) from site_visit_days));
end $$;
revoke all on function public.admin_visit_stats(date, date) from public, anon;
grant execute on function public.admin_visit_stats(date, date) to authenticated;
