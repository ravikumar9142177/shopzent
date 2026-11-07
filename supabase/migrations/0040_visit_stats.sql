-- 0040: visitor stats (privacy-light: random per-device id, no IP/location stored)
create table if not exists public.site_visit_days (
  vid text not null, day date not null, src text not null check (src in ('web','app')),
  hits int not null default 1, user_id uuid, first_at timestamptz not null default now(), last_at timestamptz not null default now(),
  primary key (vid, day, src)
);
alter table public.site_visit_days enable row level security;
create index if not exists site_visit_days_day on public.site_visit_days(day);
create or replace function public.track_visit(p_vid text, p_src text) returns void
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_day date := (now() at time zone 'Asia/Calcutta')::date; v_src text := case when p_src = 'app' then 'app' else 'web' end;
begin
  if p_vid is null or p_vid !~ '^[A-Za-z0-9-]{8,64}$' then return; end if;
  perform public.hit_rate_limit('track_visit', p_vid, 120, 3600);
  insert into site_visit_days(vid, day, src, user_id) values (p_vid, v_day, v_src, auth.uid())
  on conflict (vid, day, src) do update set hits = site_visit_days.hits + 1, last_at = now(), user_id = coalesce(site_visit_days.user_id, excluded.user_id);
exception when others then null;
end $$;
revoke all on function public.track_visit(text, text) from public;
grant execute on function public.track_visit(text, text) to anon, authenticated;

create or replace function public.admin_visit_stats() returns jsonb
language plpgsql stable security definer set search_path to 'public','pg_temp' as $$
declare t date := (now() at time zone 'Asia/Calcutta')::date; r jsonb; per jsonb := '{}'::jsonb; d int; k text;
begin
  perform public._require_admin();
  foreach d in array array[1, 7, 30, 90] loop
    select jsonb_build_object(
      'visitors', count(distinct vid), 'visits', coalesce(sum(hits), 0),
      'web_visitors', count(distinct vid) filter (where src = 'web'), 'app_visitors', count(distinct vid) filter (where src = 'app'),
      'web_visits', coalesce(sum(hits) filter (where src = 'web'), 0), 'app_visits', coalesce(sum(hits) filter (where src = 'app'), 0))
    into r from site_visit_days where day > t - d;
    per := per || jsonb_build_object(d::text, r);
  end loop;
  return jsonb_build_object(
    'periods', per,
    'daily', coalesce((select jsonb_agg(x order by x.day) from (select s.day, count(distinct vid) visitors, sum(hits) visits,
        count(distinct vid) filter (where src = 'app') app_visitors from site_visit_days s where s.day > t - 14 group by s.day) x), '[]'::jsonb),
    'users_total', (select count(*) from profiles),
    'new_today', (select count(*) from profiles where (created_at at time zone 'Asia/Calcutta')::date = t),
    'new_7', (select count(*) from profiles where (created_at at time zone 'Asia/Calcutta')::date > t - 7),
    'new_30', (select count(*) from profiles where (created_at at time zone 'Asia/Calcutta')::date > t - 30),
    'old_users', (select count(*) from profiles where (created_at at time zone 'Asia/Calcutta')::date < t),
    'logged_in_today', (select count(distinct user_id) from site_visit_days where day = t and user_id is not null),
    'tracking_since', (select min(day) from site_visit_days));
end $$;
revoke all on function public.admin_visit_stats() from public, anon;
grant execute on function public.admin_visit_stats() to authenticated;
