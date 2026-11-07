-- 0042: village/town level counts (opt-in via the browser's own permission prompt)
alter table public.site_visit_days add column if not exists village text;
drop function if exists public.track_visit_geo(text, text, text);
create or replace function public.track_visit_geo(p_vid text, p_state text, p_district text, p_village text default null) returns void
language plpgsql security definer set search_path to 'public','pg_temp' as $$
declare v_day date := (now() at time zone 'Asia/Calcutta')::date; s text := left(btrim(coalesce(p_state,'')), 60); d text := left(btrim(coalesce(p_district,'')), 60); v text := left(btrim(coalesce(p_village,'')), 80);
begin
  if p_vid is null or p_vid !~ '^[A-Za-z0-9-]{8,64}$' then return; end if;
  if s = '' or s ~ '[<>]' or d ~ '[<>]' or v ~ '[<>]' then return; end if;
  perform public.hit_rate_limit('track_geo', p_vid, 20, 3600);
  update site_visit_days set state = s, district = nullif(regexp_replace(d, '\s+district$', '', 'i'), ''), village = nullif(v, '') where vid = p_vid and day >= v_day - 1;
exception when others then null;
end $$;
revoke all on function public.track_visit_geo(text, text, text, text) from public;
grant execute on function public.track_visit_geo(text, text, text, text) to anon, authenticated;

create or replace function public.admin_visit_places(p_from date default null, p_to date default null) returns jsonb
language plpgsql stable security definer set search_path to 'public','pg_temp' as $$
declare t date := (now() at time zone 'Asia/Calcutta')::date; f date := coalesce(p_from, t - 29); z date := coalesce(p_to, t);
begin
  perform public._require_admin();
  if z < f then z := f; end if; if z - f > 400 then f := z - 400; end if;
  return jsonb_build_object('from', f, 'to', z, 'rows', coalesce((select jsonb_agg(jsonb_build_object('state', state, 'district', district, 'village', village, 'n', n, 'last', last_day) order by n desc)
    from (select state, district, village, count(distinct vid) n, max(day) last_day from site_visit_days where day between f and z and state is not null group by state, district, village limit 4000) q), '[]'::jsonb));
end $$;
revoke all on function public.admin_visit_places(date, date) from public, anon;
grant execute on function public.admin_visit_places(date, date) to authenticated;
