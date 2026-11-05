-- SHOPZENT 0032: Festival Studio, second step. Many festivals (each with up to 10 looks), an optional festival tune on/off,
-- and an optional custom tune (an https audio file the admin pasted or uploaded to site storage). Replaces admin_set_festival
-- from 0031 (same admin + AAL2 + fresh-sign-in checks, audited, no customer update notice). Idempotent.
select set_config('sz.notice_seen', '1', false);

create or replace function public.admin_set_festival(p_value jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v jsonb := coalesce(p_value, '{}'::jsonb);
  v_themes text[] := array['diwali', 'dhanteras', 'bhai-dooj', 'chhath', 'dussehra', 'navratri', 'durga-puja', 'karwa-chauth', 'holi', 'eid-ul-fitr', 'eid-ul-adha', 'christmas', 'new-year', 'republic-day', 'independence-day', 'raksha-bandhan', 'ganesh-chaturthi', 'janmashtami', 'makar-sankranti', 'lohri', 'pongal', 'baisakhi', 'onam', 'ram-navami', 'maha-shivratri', 'guru-nanak-jayanti', 'hanuman-jayanti', 'vasant-panchami', 'teej', 'ugadi', 'sale', 'none'];
  v_theme text; v_int text; v_accent text; v_enabled boolean; v_start timestamptz; v_end timestamptz;
  v_offer jsonb; v_link text; v_code text; v_out jsonb; v_title text; v_greet text;
  v_oh text; v_ot text; v_oen boolean; v_ocode boolean; v_var int; v_tune boolean; v_turl text;
begin
  perform public._require_admin();
  perform public.require_fresh(15);
  if jsonb_typeof(v) <> 'object' then raise exception 'invalid_input' using detail = 'festival: an object is expected'; end if;
  if jsonb_typeof(v -> 'enabled') is distinct from 'boolean' then raise exception 'invalid_input' using detail = 'enabled: true or false'; end if;
  v_enabled := (v ->> 'enabled')::boolean;
  v_theme := coalesce(nullif(btrim(v ->> 'theme'), ''), 'sale');
  if not (v_theme = any(v_themes)) then raise exception 'invalid_input' using detail = 'festival is not in the list'; end if;
  begin v_var := coalesce(nullif(btrim(v ->> 'variant'), ''), '0')::int; exception when others then raise exception 'invalid_input' using detail = 'variant: 0 to 9'; end;
  if v_var < 0 or v_var > 9 then raise exception 'invalid_input' using detail = 'variant: 0 to 9'; end if;
  begin v_tune := coalesce((v ->> 'tune')::boolean, true); exception when others then raise exception 'invalid_input' using detail = 'tune: true or false'; end;
  v_turl := btrim(coalesce(v ->> 'tune_url', ''));
  if v_turl !~* '^(https://[^[:space:]<>"]{8,250}[.](mp3|m4a|ogg|aac|wav))?$' then
    raise exception 'invalid_input' using detail = 'tune file: an https link to an mp3, m4a, ogg, aac or wav file';
  end if;
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
  begin
    v_oen := coalesce((v_offer ->> 'enabled')::boolean, false);
    v_ocode := coalesce((v_offer ->> 'show_code')::boolean, false);
  exception when others then raise exception 'invalid_input' using detail = 'offer flags: true or false'; end;
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
    'variant', v_var,
    'title', v_title,
    'greeting', v_greet,
    'intensity', v_int,
    'accent', v_accent,
    'tune', v_tune,
    'tune_url', nullif(v_turl, ''),
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
    jsonb_build_object('enabled', v_enabled, 'theme', v_theme, 'variant', v_var, 'tune', v_tune, 'custom_tune', nullif(v_turl, '') is not null,
                       'offer_enabled', v_oen, 'starts_at', v_start, 'ends_at', v_end));
  return v_out;
end;
$$;

revoke all on function public.admin_set_festival(jsonb) from public, anon;
grant execute on function public.admin_set_festival(jsonb) to authenticated;
