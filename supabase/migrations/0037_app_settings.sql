-- 0037: Android app settings. 'app' = which launcher icon the app uses (auto follows the festival), 'app_push' = a notice the app shows in the phone's notification bar.
select set_config('sz.notice_seen', '1', true);
insert into public.site_settings (key, value, is_public) values ('app', '{"icon": "auto"}'::jsonb, true) on conflict (key) do nothing;
insert into public.site_settings (key, value, is_public) values ('app_push', '{"title": "", "body": ""}'::jsonb, true) on conflict (key) do nothing;
CREATE OR REPLACE FUNCTION public._send_update_notice(p_reason text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare n int;
begin
  insert into public.notifications (user_id, audience, title, body, link)
  select p.id, 'user', '🔔 Naya update', 'Website me naya update hua hai. Dekhne ke liye refresh karein. (New update on the website: please refresh.)', null
    from public.profiles p where p.role = 'customer' and p.status = 'active';
  get diagnostics n = row_count;
  insert into public.site_settings (key, value, is_public) values ('app_push', jsonb_build_object('title', '🔔 Naya update', 'body', 'SHOPZENT me naya update hua hai. Dekhne ke liye app kholiye.'), true)
    on conflict (key) do update set value = excluded.value, updated_at = now();
  update public.site_notice_state set last_sent_at = now(), pending_since = null, last_recipients = n, last_reason = p_reason, updated_at = now() where id = 1;
  perform public._audit('update_notice_sent', 'site_notice_state', '1', jsonb_build_object('reason', p_reason, 'recipients', n));
  return n;
end;
$function$
;

CREATE OR REPLACE FUNCTION public._note_content_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_new jsonb; v_old jsonb; v_row jsonb; v_st public.site_notice_state%rowtype;
begin
  if coalesce(current_setting('sz.notice_seen', true), '') = '1' then return null; end if;
  if auth.uid() is null or not public.is_staff_aal1() then return null; end if;
  v_row := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  if tg_table_name = 'site_settings' then
    if coalesce((v_row ->> 'is_public')::boolean, false) is not true
       or (v_row ->> 'key') in ('order_rules', 'payment', 'domain', 'update_notice', 'security', 'owner_coins', 'blocked_email_domains', 'app', 'app_push') then return null; end if;
  end if;
  -- drafts (not published) are invisible to customers
  if v_row ? 'published' and coalesce((v_row ->> 'published')::boolean, false) is not true then
    if tg_op <> 'UPDATE' or coalesce((to_jsonb(old) ->> 'published')::boolean, false) is not true then return null; end if;
  end if;
  if tg_op = 'UPDATE' then
    v_new := to_jsonb(new); v_old := to_jsonb(old);
    if not exists (select 1 from jsonb_object_keys(v_new) k
                    where v_new -> k is distinct from v_old -> k and k not in ('updated_at', 'updated_by', 'view_count', 'impressions', 'clicks')) then
      return null; -- counters only
    end if;
  end if;
  perform set_config('sz.notice_seen', '1', true); -- once per transaction
  if not public._notice_enabled() then return null; end if;
  insert into public.site_notice_state (id) values (1) on conflict (id) do nothing;
  select * into v_st from public.site_notice_state where id = 1 for update;
  if v_st.last_sent_at is null or v_st.last_sent_at + public._notice_cooldown() <= now() then
    perform public._send_update_notice('content_change:' || tg_table_name);
  elsif v_st.pending_since is null then
    update public.site_notice_state set pending_since = now(), updated_at = now() where id = 1;
  end if;
  return null;
end;
$function$
;
