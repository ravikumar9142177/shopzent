-- SHOPZENT 0031: Festival Studio. One public site_settings row ('festival') drives the storefront's festival
-- decoration, greeting and optional special-offer strip. Default OFF: with enabled=false the storefront loads nothing extra.
-- Admin-only writes (admin + AAL2 + fresh sign-in, audited). Saving or resetting never fires the customer update notice
-- (sz.notice_seen is set, like earlier admin settings). Idempotent. No customer data is touched.

insert into public.site_settings (key, value, is_public)
values ('festival', '{"enabled": false}'::jsonb, true)
on conflict (key) do nothing;

create or replace function public._festival_text(p jsonb, k text, maxlen int)
returns text
language sql
immutable
as $$
  select left(regexp_replace(btrim(coalesce(p ->> k, '')), '[<>[:cntrl:]]', '', 'g'), maxlen)
$$;
revoke all on function public._festival_text(jsonb, text, int) from public, anon, authenticated;

create or replace function public.admin_set_festival(p_value jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v jsonb := coalesce(p_value, '{}'::jsonb);
  v_themes text[] := array['diwali','chhath','holi','eid','christmas','newyear','national','navratri','rakhi','ganesh','sale','none'];
  v_theme text; v_int text; v_accent text; v_enabled boolean; v_start timestamptz; v_end timestamptz;
  v_offer jsonb; v_link text; v_code text; v_out jsonb; v_title text; v_greet text;
  v_oh text; v_ot text; v_oen boolean; v_ocode boolean;
begin
  perform public._require_admin();
  perform public.require_fresh(15);
  if jsonb_typeof(v) <> 'object' then raise exception 'invalid_input' using detail = 'festival: an object is expected'; end if;
  if jsonb_typeof(v -> 'enabled') is distinct from 'boolean' then raise exception 'invalid_input' using detail = 'enabled: true or false'; end if;
  v_enabled := (v ->> 'enabled')::boolean;
  v_theme := coalesce(nullif(btrim(v ->> 'theme'), ''), 'sale');
  if not (v_theme = any(v_themes)) then raise exception 'invalid_input' using detail = 'theme is not in the list'; end if;
  v_int := coalesce(nullif(btrim(v ->> 'intensity'), ''), 'medium');
  if v_int not in ('low', 'medium', 'high') then raise exception 'invalid_input' using detail = 'intensity: low, medium or high'; end if;
  v_accent := coalesce(btrim(v ->> 'accent'), '');
  if v_accent !~ '^(#[0-9A-Fa-f]{6})?$' then raise exception 'invalid_input' using detail = 'accent: #rrggbb or empty'; end if;
  v_title := public._festival_text(v, 'title', 60);
  v_greet := public._festival_text(v, 'greeting', 160);
  begin
    v_start := nullif(btrim(coalesce(v ->> 'starts_at', '')), '')::timestamptz;
    v_end := nullif(btrim(coalesce(v ->> 'ends_at', '')), '')::timestamptz;
  exception when others then
    raise exception 'invalid_input' using detail = 'starts_at / ends_at must be date-times';
  end;
  if v_start is not null and v_end is not null and v_end <= v_start then
    raise exception 'invalid_input' using detail = 'ends_at must be after starts_at';
  end if;
  v_offer := coalesce(v -> 'offer', '{}'::jsonb);
  if jsonb_typeof(v_offer) <> 'object' then raise exception 'invalid_input' using detail = 'offer: an object is expected'; end if;
  v_oen := coalesce((v_offer ->> 'enabled')::boolean, false);
  v_ocode := coalesce((v_offer ->> 'show_code')::boolean, false);
  v_link := btrim(coalesce(v_offer ->> 'link', ''));
  if v_link !~ '^(https://[^[:space:]<>"]{3,250}|[a-z0-9-]{1,40}[.]html([?][A-Za-z0-9=&_%-]{0,100})?)?$' then
    raise exception 'invalid_input' using detail = 'offer link: https:// address or a page name like products.html';
  end if;
  v_code := btrim(coalesce(v_offer ->> 'code', ''));
  if v_code !~ '^[A-Za-z0-9_-]{0,30}$' then raise exception 'invalid_input' using detail = 'offer code: letters, numbers, - or _ (max 30)'; end if;
  v_oh := public._festival_text(v_offer, 'headline', 60);
  v_ot := public._festival_text(v_offer, 'text', 160);
  v_out := jsonb_build_object(
    'enabled', v_enabled,
    'theme', v_theme,
    'title', v_title,
    'greeting', v_greet,
    'intensity', v_int,
    'accent', v_accent,
    'starts_at', v_start,
    'ends_at', v_end,
    'offer', jsonb_build_object('enabled', v_oen, 'headline', v_oh, 'text', v_ot, 'link', v_link, 'code', v_code, 'show_code', v_ocode),
    'version', floor(extract(epoch from now()))::bigint
  );
  perform set_config('sz.notice_seen', '1', true);
  insert into public.site_settings (key, value, is_public, updated_by)
  values ('festival', v_out, true, auth.uid())
  on conflict (key) do update set value = excluded.value, is_public = true, updated_by = excluded.updated_by;
  perform public._audit('festival_updated', 'site_settings', 'festival',
    jsonb_build_object('enabled', v_enabled, 'theme', v_theme, 'offer_enabled', v_oen, 'starts_at', v_start, 'ends_at', v_end));
  return v_out;
end;
$$;

create or replace function public.admin_reset_festival()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_out jsonb;
begin
  perform public._require_admin();
  perform public.require_fresh(15);
  v_out := jsonb_build_object('enabled', false, 'theme', 'none', 'version', floor(extract(epoch from now()))::bigint);
  perform set_config('sz.notice_seen', '1', true);
  insert into public.site_settings (key, value, is_public, updated_by)
  values ('festival', v_out, true, auth.uid())
  on conflict (key) do update set value = excluded.value, is_public = true, updated_by = excluded.updated_by;
  perform public._audit('festival_reset', 'site_settings', 'festival', jsonb_build_object('enabled', false));
  return v_out;
end;
$$;

revoke all on function public.admin_set_festival(jsonb) from public, anon;
revoke all on function public.admin_reset_festival() from public, anon;
grant execute on function public.admin_set_festival(jsonb) to authenticated;
grant execute on function public.admin_reset_festival() to authenticated;
