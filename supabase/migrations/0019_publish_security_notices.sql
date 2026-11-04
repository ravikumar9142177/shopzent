-- 0019_publish_security_notices.sql
-- 1) Publish / unpublish the website (maintenance mode), enforced on the server for ordering.
-- 2) Hacker / security alerts (admin-only) + IP block list (enforced in login-guard, signup hook and ordering).
-- 3) "New update" in-app notices to customers, throttled, with a master switch and a manual button.
-- Idempotent. No secrets. No coupon seeds.

-- =====================================================================================
-- 1) PUBLISH / UNPUBLISH
-- =====================================================================================
create table if not exists public.site_control (
  id int primary key check (id = 1),
  published boolean not null default true,
  message text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.site_control (id) values (1) on conflict (id) do nothing;
alter table public.site_control enable row level security;
revoke all on public.site_control from anon, authenticated;

create or replace function public._site_is_published()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select c.published from public.site_control c where c.id = 1), true);
$$;
revoke all on function public._site_is_published() from public, anon, authenticated;

-- the ONLY thing visitors can read: the on/off flag and the closed-page message
create or replace function public.public_site_status()
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object('published', c.published, 'message', c.message) from public.site_control c where c.id = 1
  union all select jsonb_build_object('published', true, 'message', null) where not exists (select 1 from public.site_control)
  limit 1;
$$;
revoke all on function public.public_site_status() from public;
grant execute on function public.public_site_status() to anon, authenticated;

create or replace function public.admin_site_status()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare r jsonb;
begin
  perform public._require_admin();
  select jsonb_build_object('published', c.published, 'message', c.message, 'updated_at', c.updated_at) into r from public.site_control c where c.id = 1;
  return coalesce(r, jsonb_build_object('published', true, 'message', null, 'updated_at', null));
end;
$$;
revoke all on function public.admin_site_status() from public, anon;
grant execute on function public.admin_site_status() to authenticated;

create or replace function public.admin_set_site_published(p_published boolean, p_message text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_msg text := nullif(btrim(coalesce(p_message, '')), ''); v_old boolean;
begin
  perform public._require_admin();
  if p_published is null or (v_msg is not null and char_length(v_msg) > 300) then raise exception 'invalid_input'; end if;
  insert into public.site_control (id) values (1) on conflict (id) do nothing;
  select published into v_old from public.site_control where id = 1 for update;
  update public.site_control set published = p_published, message = v_msg, updated_at = now(), updated_by = auth.uid() where id = 1;
  perform public._audit(case when p_published then 'site_published' else 'site_unpublished' end, 'site_control', '1',
    jsonb_strip_nulls(jsonb_build_object('was_published', v_old, 'message', v_msg)));
  return jsonb_build_object('published', p_published, 'message', v_msg);
end;
$$;
revoke all on function public.admin_set_site_published(boolean, text) from public, anon;
grant execute on function public.admin_set_site_published(boolean, text) to authenticated;

-- =====================================================================================
-- 2) SECURITY ALERTS + IP BLOCK LIST
-- =====================================================================================
create table if not exists public.security_alerts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  kind text not null,
  severity text not null default 'low' check (severity in ('low', 'medium', 'high', 'critical')),
  target text,
  summary text not null,
  details jsonb not null default '{}'::jsonb,
  ip inet,
  user_agent text,
  user_id uuid,
  count int not null default 1,
  status text not null default 'new' check (status in ('new', 'acknowledged', 'handled')),
  handled_by uuid,
  handled_at timestamptz,
  note text,
  dedupe_key text not null
);
create index if not exists security_alerts_status_idx on public.security_alerts (status, last_seen_at desc);
create index if not exists security_alerts_dedupe_idx on public.security_alerts (dedupe_key, last_seen_at desc);
create index if not exists security_alerts_ip_idx on public.security_alerts (ip);
alter table public.security_alerts enable row level security;
revoke all on public.security_alerts from anon, authenticated;
grant select on public.security_alerts to authenticated;
drop policy if exists security_alerts_admin_read on public.security_alerts;
create policy security_alerts_admin_read on public.security_alerts for select to authenticated using (public.is_admin());

create table if not exists public.blocked_ips (
  ip inet primary key,
  reason text,
  blocked_by uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz
);
alter table public.blocked_ips enable row level security;
revoke all on public.blocked_ips from anon, authenticated;
grant select on public.blocked_ips to authenticated;
drop policy if exists blocked_ips_admin_read on public.blocked_ips;
create policy blocked_ips_admin_read on public.blocked_ips for select to authenticated using (public.is_admin());

create or replace function public._sev_rank(p text) returns int language sql immutable as $$
  select case p when 'critical' then 4 when 'high' then 3 when 'medium' then 2 else 1 end;
$$;

create or replace function public._ip_blocked(p_ip inet)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select p_ip is not null and exists (select 1 from public.blocked_ips b where b.ip = p_ip and (b.expires_at is null or b.expires_at > now()));
$$;
revoke all on function public._ip_blocked(inet) from public, anon, authenticated;
grant execute on function public._ip_blocked(inet) to service_role;

-- Records an alert. Repeats of the same thing from the same IP inside 30 minutes raise ONE alert's counter
-- (so a flood is one row, not thousands). Never raises: logging must not break the action it watches.
create or replace function public._log_security_alert(
  p_kind text, p_severity text, p_target text, p_summary text, p_details jsonb default '{}'::jsonb,
  p_ip inet default null, p_user_agent text default null, p_user_id uuid default null, p_dedupe text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_ip inet := coalesce(p_ip, public._client_ip());
  v_ua text := left(coalesce(p_user_agent, public._user_agent()), 300);
  v_key text; v_id uuid; v_count int; v_sev text; v_new text; v_det jsonb := coalesce(p_details, '{}'::jsonb);
begin
  v_key := coalesce(p_dedupe, p_kind || '|' || coalesce(host(v_ip), '?') || '|' || coalesce(p_target, ''));
  perform pg_advisory_xact_lock(hashtextextended('sec_alert|' || v_key, 0));
  select a.id, a.count, a.severity into v_id, v_count, v_sev from public.security_alerts a
   where a.dedupe_key = v_key and a.status = 'new' and a.last_seen_at > now() - interval '30 minutes'
   order by a.last_seen_at desc limit 1;
  if v_id is not null then
    v_new := case when v_count + 1 >= 50 then 'critical' when v_count + 1 >= 10 then 'high' else v_sev end;
    if public._sev_rank(p_severity) > public._sev_rank(v_new) then v_new := p_severity; end if;
    update public.security_alerts set count = count + 1, last_seen_at = now(), severity = v_new,
           details = details || v_det, user_agent = coalesce(v_ua, user_agent) where id = v_id;
    -- escalated to High/Critical: ring the bell now
    if public._sev_rank(v_new) >= 3 and public._sev_rank(v_sev) < 3 and
       (select count(*) from public.notifications n where n.audience = 'admin' and n.link = 'alerts.html' and n.created_at > now() - interval '1 hour') < 10 then
      insert into public.notifications (user_id, audience, title, body, link)
      values (null, 'admin', '🚨 Hacker alert (now HIGH): ' || left(p_summary, 110), 'Details: Admin → Hacker alerts', 'alerts.html');
    end if;
    return v_id;
  end if;
  insert into public.security_alerts (kind, severity, target, summary, details, ip, user_agent, user_id, dedupe_key)
  values (p_kind, p_severity, left(p_target, 200), left(p_summary, 300), v_det, v_ip, v_ua, p_user_id, v_key) returning id into v_id;
  -- bell for the admin: medium and above, at most 10 per hour
  if public._sev_rank(p_severity) >= 2 and
     (select count(*) from public.notifications n where n.audience = 'admin' and n.link = 'alerts.html' and n.created_at > now() - interval '1 hour') < 10 then
    insert into public.notifications (user_id, audience, title, body, link)
    values (null, 'admin', '🚨 Hacker alert: ' || left(p_summary, 120), 'Details: Admin → Hacker alerts', 'alerts.html');
  end if;
  return v_id;
exception when others then
  return null;
end;
$$;
revoke all on function public._log_security_alert(text, text, text, text, jsonb, inet, text, uuid, text) from public, anon, authenticated;

-- called by login-guard (service role) with the real client IP
create or replace function public.service_log_security_alert(
  p_kind text, p_severity text, p_target text, p_summary text, p_details jsonb, p_ip text, p_user_agent text, p_dedupe text default null)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ip inet;
begin
  begin v_ip := nullif(p_ip, 'unknown')::inet; exception when others then v_ip := null; end;
  return public._log_security_alert(p_kind, case when p_severity in ('low','medium','high','critical') then p_severity else 'low' end,
    p_target, p_summary, coalesce(p_details, '{}'::jsonb), v_ip, p_user_agent, null, p_dedupe);
end;
$$;
revoke all on function public.service_log_security_alert(text, text, text, text, jsonb, text, text, text) from public, anon, authenticated;
grant execute on function public.service_log_security_alert(text, text, text, text, jsonb, text, text, text) to service_role;

-- one round trip for login-guard: is this IP blocked, is this email an admin account
create or replace function public.service_login_info(p_email text, p_ip text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_ip inet;
begin
  begin v_ip := nullif(p_ip, 'unknown')::inet; exception when others then v_ip := null; end;
  return jsonb_build_object(
    'blocked', public._ip_blocked(v_ip),
    'is_admin', exists (select 1 from public.profiles p where lower(p.email) = lower(p_email) and p.role in ('admin', 'super_admin')));
end;
$$;
revoke all on function public.service_login_info(text, text) from public, anon, authenticated;
grant execute on function public.service_login_info(text, text) to service_role;

-- browser-reported events (frame-busting, injection payloads typed into forms, customer opening the admin panel).
-- Anyone can call it, so: fixed list of kinds, fixed severities, clipped details, silently dropped past 40/hour per IP.
create or replace function public.log_security_event(p_kind text, p_target text default null, p_details jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ip inet := public._client_ip(); v_det jsonb := '{}'::jsonb; v_sev text; v_sum text;
begin
  if p_kind not in ('frame_bust', 'injection_payload', 'admin_ui_denied') then return; end if;
  if p_kind = 'admin_ui_denied' and auth.uid() is null then return; end if;
  if (select count(*) from public.security_alerts a where a.ip = v_ip and a.kind in ('frame_bust', 'injection_payload', 'admin_ui_denied')
        and a.last_seen_at > now() - interval '1 hour') >= 40 then return; end if;
  if p_details is not null and jsonb_typeof(p_details) = 'object' then
    select coalesce(jsonb_object_agg(k, left(p_details ->> k, 200)), '{}'::jsonb) into v_det
    from jsonb_object_keys(p_details) k where k in ('field', 'sample', 'page', 'referrer', 'top_origin');
  end if;
  v_sev := case p_kind when 'frame_bust' then 'medium' when 'admin_ui_denied' then 'medium' else 'low' end;
  v_sum := case p_kind when 'frame_bust' then 'Another website tried to show SHOPZENT inside its frame (clickjacking)'
                       when 'admin_ui_denied' then 'A customer account opened the admin panel'
                       else 'Script/SQL-looking text typed into a form' end;
  perform public._log_security_alert(p_kind, v_sev, left(coalesce(p_target, ''), 200), v_sum, v_det, v_ip, null, auth.uid());
end;
$$;
revoke all on function public.log_security_event(text, text, jsonb) from public;
grant execute on function public.log_security_event(text, text, jsonb) to anon, authenticated;

-- obvious injection / XSS payloads (loose on purpose: it only raises an alert, it never blocks or edits anything)
create or replace function public._looks_malicious(p text)
returns boolean language sql immutable as $$
  select p is not null and p ~* '(<\s*/?\s*(script|iframe|object|embed)\y|<\s*(img|svg|body|video|audio)[^>]{0,80}\son\w+\s*=|javascript\s*:|data\s*:\s*text/html|\yunion\s+(all\s+)?select\y|\ydrop\s+table\y|\yor\s+1\s*=\s*1\y|''\s*or\s*''1''\s*=\s*''1|;\s*--\s*$|\$\{\s*jndi\s*:|\.\./\.\./\.\./)';
$$;

create or replace function public._trg_alert_malicious_text()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v jsonb := to_jsonb(new); f text; s text;
begin
  foreach f in array tg_argv loop
    s := v ->> f;
    if public._looks_malicious(s) then
      perform public._log_security_alert('injection_payload', 'low', tg_table_name || '.' || f,
        'Script/SQL-looking text saved in ' || tg_table_name || ' (' || f || ')',
        jsonb_build_object('field', f, 'sample', left(s, 200), 'stored_as_plain_text', true), null, null, auth.uid());
    end if;
  end loop;
  return new;
end;
$$;
revoke all on function public._trg_alert_malicious_text() from public, anon, authenticated;
drop trigger if exists contact_messages_alert on public.contact_messages;
create trigger contact_messages_alert after insert on public.contact_messages
  for each row execute function public._trg_alert_malicious_text('name', 'subject', 'message');
drop trigger if exists profiles_alert on public.profiles;
create trigger profiles_alert after update of full_name on public.profiles
  for each row when (new.full_name is distinct from old.full_name) execute function public._trg_alert_malicious_text('full_name');

-- duplicate UTR attempts (someone re-using a payment reference)
create or replace function public._trg_alert_duplicate_utr()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int;
begin
  select count(*) into v_n from public.duplicate_utr_attempts d
   where d.created_at > now() - interval '24 hours' and (d.user_id is not distinct from new.user_id);
  perform public._log_security_alert('duplicate_utr', case when v_n >= 3 then 'high' else 'medium' end, 'payment-submit',
    'Payment reference (UTR) already used was submitted again',
    jsonb_build_object('utr_last4', right(new.utr_normalized, 4), 'order_id', new.order_id, 'attempts_24h', v_n),
    null, null, new.user_id, 'duplicate_utr|' || coalesce(new.user_id::text, '?'));
  return new;
end;
$$;
revoke all on function public._trg_alert_duplicate_utr() from public, anon, authenticated;
drop trigger if exists duplicate_utr_alert on public.duplicate_utr_attempts;
create trigger duplicate_utr_alert after insert on public.duplicate_utr_attempts
  for each row execute function public._trg_alert_duplicate_utr();

-- bulk ordering: 5 or more orders from one customer inside 30 minutes
create or replace function public._trg_alert_bulk_orders()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int;
begin
  select count(*) into v_n from public.orders o where o.user_id = new.user_id and o.created_at > now() - interval '30 minutes';
  if v_n >= 5 then
    perform public._log_security_alert('bulk_orders', case when v_n >= 8 then 'high' else 'medium' end, 'create_order',
      'Many orders from one customer in a short time',
      jsonb_build_object('orders_30m', v_n, 'last_order_code', new.order_code), null, null, new.user_id, 'bulk_orders|' || new.user_id::text);
  end if;
  return new;
end;
$$;
revoke all on function public._trg_alert_bulk_orders() from public, anon, authenticated;
drop trigger if exists orders_bulk_alert on public.orders;
create trigger orders_bulk_alert after insert on public.orders
  for each row execute function public._trg_alert_bulk_orders();

-- admin 2FA code failures (comes from the browser through log_auth_event)
create or replace function public.log_auth_event(p_action text, p_details jsonb default '{}'::jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $function$
declare
  v_details jsonb := '{}'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'login_required';
  end if;
  if p_action not in ('admin_login_success', 'mfa_failure', 'mfa_enrolled', 'mfa_removed', 'password_changed', 'logout_all', 'login_success') then
    raise exception 'invalid_input';
  end if;
  if p_action = 'admin_login_success' and not public.is_staff_aal1() then
    raise exception 'not_authorized';
  end if;
  perform public.hit_rate_limit('auth_event', auth.uid()::text, 20, 60);
  if p_details is not null and jsonb_typeof(p_details) = 'object' then
    select coalesce(jsonb_object_agg(k, left(p_details ->> k, 120)), '{}'::jsonb) into v_details
    from jsonb_object_keys(p_details) k
    where k in ('factor_id', 'factor_type', 'reason', 'device', 'page');
  end if;
  perform public._audit(p_action, 'auth', auth.uid()::text, v_details || jsonb_build_object('aal', public.current_aal()));
  if p_action = 'mfa_failure' then
    perform public._log_security_alert('mfa_failure', case when public.is_staff_aal1() then 'high' else 'low' end, '2-step code',
      case when public.is_staff_aal1() then 'Wrong 2-step (authenticator) code on an ADMIN account' else 'Wrong 2-step code on a customer account' end,
      jsonb_build_object('is_admin_account', public.is_staff_aal1()), null, null, auth.uid(), 'mfa_failure|' || auth.uid()::text);
  end if;
end;
$function$;

-- signup hook: block IPs on the block list, alert on disposable-email signups and script-looking names
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb language plpgsql volatile security definer set search_path = public, pg_temp as $$
declare v_ip inet; v_email text := event -> 'user' ->> 'email'; v_name text := event -> 'user' -> 'user_metadata' ->> 'full_name'; v_n int;
begin
  begin v_ip := nullif(event -> 'metadata' ->> 'ip_address', '')::inet; exception when others then v_ip := null; end;
  if public._ip_blocked(v_ip) then
    return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'Signups from your network are blocked. Contact us on WhatsApp.'));
  end if;
  if public._looks_malicious(v_name) or public._looks_malicious(v_email) then
    perform public._log_security_alert('injection_payload', 'medium', 'signup', 'Script/SQL-looking text in a signup form',
      jsonb_build_object('field', case when public._looks_malicious(v_name) then 'full_name' else 'email' end, 'sample', left(coalesce(v_name, v_email), 200)),
      v_ip, null, null);
  end if;
  if public._is_disposable_email(v_email) then
    perform public._log_security_alert('disposable_signup', 'low', 'signup',
      'Signup with a temporary/disposable email blocked',
      jsonb_build_object('email_domain', lower(split_part(coalesce(v_email, ''), '@', 2))), v_ip, null, null);
    return jsonb_build_object('error', jsonb_build_object('http_code', 400,
      'message', 'Temporary/disposable email addresses are not allowed. Please use your real email (Gmail etc.).'));
  end if;
  return '{}'::jsonb;
end;
$$;
revoke all on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;

-- ordering: refuse while the site is unpublished or the IP is blocked (BEFORE INSERT on orders: create_order cannot bypass it)
create or replace function public._order_site_checks()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public._site_is_published() then raise exception 'site_unpublished'; end if;
  if public._ip_blocked(public._client_ip()) then raise exception 'ip_blocked'; end if;
  return new;
end;
$$;
revoke all on function public._order_site_checks() from public, anon, authenticated;
drop trigger if exists a0_order_site_checks on public.orders;
create trigger a0_order_site_checks before insert on public.orders for each row execute function public._order_site_checks();

-- ---------- admin RPCs ----------
create or replace function public.admin_list_security_alerts(
  p_severity text default null, p_status text default null, p_from timestamptz default null, p_to timestamptz default null,
  p_ip text default null, p_limit int default 100)
returns table (id uuid, created_at timestamptz, last_seen_at timestamptz, kind text, severity text, target text, summary text,
  details jsonb, ip text, user_agent text, user_id uuid, user_email text, count int, status text, handled_at timestamptz, note text, ip_blocked boolean)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin();
  return query
    select a.id, a.created_at, a.last_seen_at, a.kind, a.severity, a.target, a.summary, a.details, host(a.ip), a.user_agent, a.user_id,
           (select p.email from public.profiles p where p.id = a.user_id), a.count, a.status, a.handled_at, a.note, public._ip_blocked(a.ip)
      from public.security_alerts a
     where (p_severity is null or p_severity = '' or a.severity = p_severity)
       and (p_status is null or p_status = '' or a.status = p_status)
       and (p_from is null or a.last_seen_at >= p_from)
       and (p_to is null or a.last_seen_at < p_to)
       and (p_ip is null or p_ip = '' or host(a.ip) = p_ip)
     order by (a.status = 'new') desc, a.last_seen_at desc
     limit least(greatest(coalesce(p_limit, 100), 1), 500);
end;
$$;
revoke all on function public.admin_list_security_alerts(text, text, timestamptz, timestamptz, text, int) from public, anon;
grant execute on function public.admin_list_security_alerts(text, text, timestamptz, timestamptz, text, int) to authenticated;

create or replace function public.admin_security_alert_counts()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin();
  return (select jsonb_build_object('new_total', count(*) filter (where status = 'new'),
            'new_high', count(*) filter (where status = 'new' and severity in ('high', 'critical')),
            'last_24h', count(*) filter (where last_seen_at > now() - interval '24 hours'))
          from public.security_alerts);
end;
$$;
revoke all on function public.admin_security_alert_counts() from public, anon;
grant execute on function public.admin_security_alert_counts() to authenticated;

create or replace function public.admin_set_security_alert_status(p_id uuid, p_status text, p_note text default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin();
  if p_status not in ('new', 'acknowledged', 'handled') or char_length(coalesce(p_note, '')) > 500 then raise exception 'invalid_input'; end if;
  update public.security_alerts set status = p_status, note = coalesce(nullif(btrim(p_note), ''), note),
         handled_by = case when p_status = 'new' then null else auth.uid() end,
         handled_at = case when p_status = 'new' then null else now() end where id = p_id;
  if not found then raise exception 'not_found'; end if;
  perform public._audit('security_alert_' || p_status, 'security_alerts', p_id::text, jsonb_build_object('status', p_status));
end;
$$;
revoke all on function public.admin_set_security_alert_status(uuid, text, text) from public, anon;
grant execute on function public.admin_set_security_alert_status(uuid, text, text) to authenticated;

create or replace function public.admin_acknowledge_all_alerts()
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  perform public._require_admin();
  update public.security_alerts set status = 'acknowledged', handled_by = auth.uid(), handled_at = now() where status = 'new';
  get diagnostics n = row_count;
  perform public._audit('security_alert_acknowledge_all', 'security_alerts', null, jsonb_build_object('count', n));
  return n;
end;
$$;
revoke all on function public.admin_acknowledge_all_alerts() from public, anon;
grant execute on function public.admin_acknowledge_all_alerts() to authenticated;

create or replace function public.admin_block_ip(p_ip text, p_reason text default null, p_hours int default null)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ip inet;
begin
  perform public._require_admin();
  begin v_ip := btrim(p_ip)::inet; exception when others then raise exception 'invalid_input'; end;
  if host(v_ip) is distinct from btrim(p_ip) then raise exception 'invalid_input'; end if;
  if v_ip = public._client_ip() then raise exception 'cannot_block_own_ip'; end if;
  if p_hours is not null and (p_hours < 1 or p_hours > 24 * 365) then raise exception 'invalid_input'; end if;
  insert into public.blocked_ips (ip, reason, blocked_by, expires_at)
  values (v_ip, left(nullif(btrim(coalesce(p_reason, '')), ''), 300), auth.uid(), case when p_hours is null then null else now() + make_interval(hours => p_hours) end)
  on conflict (ip) do update set reason = excluded.reason, blocked_by = excluded.blocked_by, created_at = now(), expires_at = excluded.expires_at;
  perform public._audit('ip_blocked', 'blocked_ips', host(v_ip), jsonb_build_object('hours', p_hours, 'reason', left(p_reason, 200)));
end;
$$;
revoke all on function public.admin_block_ip(text, text, int) from public, anon;
grant execute on function public.admin_block_ip(text, text, int) to authenticated;

create or replace function public.admin_unblock_ip(p_ip text)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ip inet;
begin
  perform public._require_admin();
  begin v_ip := btrim(p_ip)::inet; exception when others then raise exception 'invalid_input'; end;
  delete from public.blocked_ips where ip = v_ip;
  perform public._audit('ip_unblocked', 'blocked_ips', host(v_ip), '{}'::jsonb);
end;
$$;
revoke all on function public.admin_unblock_ip(text) from public, anon;
grant execute on function public.admin_unblock_ip(text) to authenticated;

create or replace function public.admin_list_blocked_ips()
returns table (ip text, reason text, created_at timestamptz, expires_at timestamptz)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin();
  return query select host(b.ip), b.reason, b.created_at, b.expires_at from public.blocked_ips b
   where b.expires_at is null or b.expires_at > now() order by b.created_at desc limit 200;
end;
$$;
revoke all on function public.admin_list_blocked_ips() from public, anon;
grant execute on function public.admin_list_blocked_ips() to authenticated;

-- housekeeping: handled alerts older than 180 days, expired IP blocks
create or replace function public._prune_security()
returns void language sql security definer set search_path = public, pg_temp as $$
  delete from public.security_alerts where status <> 'new' and last_seen_at < now() - interval '180 days';
  delete from public.blocked_ips where expires_at is not null and expires_at < now() - interval '7 days';
$$;
revoke all on function public._prune_security() from public, anon, authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'shopzent-prune-security';
select cron.schedule('shopzent-prune-security', '17 21 * * *', 'select public._prune_security()');

-- =====================================================================================
-- 3) CUSTOMER "NEW UPDATE" NOTICES (in-app only; email flag exists but is forced OFF and sends nothing)
-- =====================================================================================
create table if not exists public.site_notice_state (
  id int primary key check (id = 1),
  last_sent_at timestamptz,
  pending_since timestamptz,
  last_recipients int,
  last_reason text,
  updated_at timestamptz not null default now()
);
insert into public.site_notice_state (id) values (1) on conflict (id) do nothing;
alter table public.site_notice_state enable row level security;
revoke all on public.site_notice_state from anon, authenticated;

create or replace function public._notice_enabled() returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select (s.value ->> 'enabled')::boolean from public.site_settings s where s.key = 'update_notice' and s.value ->> 'enabled' in ('true', 'false')), true);
$$;
create or replace function public._notice_cooldown() returns interval language sql stable security definer set search_path = public, pg_temp as $$
  select make_interval(secs => 3600 * coalesce((select (s.value ->> 'cooldown_hours')::numeric from public.site_settings s
    where s.key = 'update_notice' and s.value ->> 'cooldown_hours' ~ '^\d{1,3}(\.\d{1,2})?$'), 6));
$$;
revoke all on function public._notice_enabled() from public, anon, authenticated;
revoke all on function public._notice_cooldown() from public, anon, authenticated;

-- ONE set-based insert for all customers (no loop). Caller must hold the state-row lock.
create or replace function public._send_update_notice(p_reason text)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  insert into public.notifications (user_id, audience, title, body, link)
  select p.id, 'user', '🔔 Naya update', 'Website me naya update hua hai. Dekhne ke liye refresh karein. (New update on the website: please refresh.)', null
    from public.profiles p where p.role = 'customer' and p.status = 'active';
  get diagnostics n = row_count;
  update public.site_notice_state set last_sent_at = now(), pending_since = null, last_recipients = n, last_reason = p_reason, updated_at = now() where id = 1;
  perform public._audit('update_notice_sent', 'site_notice_state', '1', jsonb_build_object('reason', p_reason, 'recipients', n));
  return n;
end;
$$;
revoke all on function public._send_update_notice(text) from public, anon, authenticated;

-- fires after an admin changes customer-visible content. Cheap exits first; at most one notice per cooldown.
create or replace function public._note_content_change()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_new jsonb; v_old jsonb; v_row jsonb; v_st public.site_notice_state%rowtype;
begin
  if coalesce(current_setting('sz.notice_seen', true), '') = '1' then return null; end if;
  if auth.uid() is null or not public.is_staff_aal1() then return null; end if;
  v_row := to_jsonb(case when tg_op = 'DELETE' then old else new end);
  if tg_table_name = 'site_settings' then
    if coalesce((v_row ->> 'is_public')::boolean, false) is not true
       or (v_row ->> 'key') in ('order_rules', 'payment', 'domain', 'update_notice', 'security', 'owner_coins', 'blocked_email_domains') then return null; end if;
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
$$;
revoke all on function public._note_content_change() from public, anon, authenticated;
do $$
declare t text;
begin
  foreach t in array array['products', 'categories', 'brands', 'videos', 'apps', 'ads', 'site_settings'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_notice', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public._note_content_change()', t || '_notice', t);
  end loop;
end;
$$;

-- edits that arrived during the cooldown: one notice when the cooldown is over (pg_cron every 10 minutes)
create or replace function public._flush_update_notice()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare v_st public.site_notice_state%rowtype;
begin
  if not public._notice_enabled() then return; end if;
  select * into v_st from public.site_notice_state where id = 1 for update;
  if v_st.pending_since is not null and (v_st.last_sent_at is null or v_st.last_sent_at + public._notice_cooldown() <= now()) then
    perform public._send_update_notice('edits_during_cooldown');
  end if;
end;
$$;
revoke all on function public._flush_update_notice() from public, anon, authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'shopzent-flush-update-notice';
select cron.schedule('shopzent-flush-update-notice', '*/10 * * * *', 'select public._flush_update_notice()');

create or replace function public.admin_update_notice_status()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_st public.site_notice_state%rowtype;
begin
  perform public._require_admin();
  select * into v_st from public.site_notice_state where id = 1;
  return jsonb_build_object('enabled', public._notice_enabled(), 'cooldown_hours', extract(epoch from public._notice_cooldown()) / 3600,
    'last_sent_at', v_st.last_sent_at, 'next_allowed_at', v_st.last_sent_at + public._notice_cooldown(),
    'pending', v_st.pending_since is not null, 'last_recipients', v_st.last_recipients,
    'customers', (select count(*) from public.profiles p where p.role = 'customer' and p.status = 'active'));
end;
$$;
revoke all on function public.admin_update_notice_status() from public, anon;
grant execute on function public.admin_update_notice_status() to authenticated;

-- manual button: ignores the master switch and the cooldown, but not more than once a minute
create or replace function public.admin_send_update_notice()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_st public.site_notice_state%rowtype; n int;
begin
  perform public._require_admin();
  insert into public.site_notice_state (id) values (1) on conflict (id) do nothing;
  select * into v_st from public.site_notice_state where id = 1 for update;
  if v_st.last_sent_at is not null and v_st.last_reason = 'manual' and v_st.last_sent_at > now() - interval '1 minute' then raise exception 'too_soon'; end if;
  n := public._send_update_notice('manual');
  return jsonb_build_object('recipients', n);
end;
$$;
revoke all on function public.admin_send_update_notice() from public, anon;
grant execute on function public.admin_send_update_notice() to authenticated;

-- customer bell helpers
create or replace function public.mark_all_notifications_read()
returns void language sql security definer set search_path = public, pg_temp as $$
  update public.notifications set read_at = now() where user_id = auth.uid() and audience = 'user' and read_at is null;
$$;
revoke all on function public.mark_all_notifications_read() from public, anon;
grant execute on function public.mark_all_notifications_read() to authenticated;

-- settings: update_notice (private; the email switch is always stored OFF)
CREATE OR REPLACE FUNCTION public.admin_upsert_setting(p_key text, p_value jsonb, p_is_public boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform public._require_admin();
  if p_key is null or p_key !~ '^[a-z][a-z0-9_]{1,40}$' or p_value is null or pg_column_size(p_value) > 200000 then
    raise exception 'invalid_input';
  end if;
  if p_key in ('payment', 'security') then
    perform public._require_super_admin();
    perform public.require_fresh(15);
  end if;
  if p_key = 'security' then
    p_is_public := false;
  end if;
  if p_key = 'domain' then
    perform public._require_super_admin();
    if jsonb_typeof(p_value) <> 'object'
       or coalesce(p_value ->> 'domain', '') !~ '^([a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+)?$'
       or coalesce(p_value ->> 'github_user', '') !~ '^([a-z0-9][a-z0-9-]{0,38})?$' then
      raise exception 'invalid_input' using detail = 'domain must look like shopzent.in; github_user letters/digits/dashes';
    end if;
    p_is_public := true;
  end if;
  if p_key = 'payment' then
    if jsonb_typeof(p_value) <> 'object'
       or coalesce(p_value ->> 'upi_id', '') !~ '^([A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9.-]{1,63})?$'
       or coalesce(p_value ->> 'qr_url', '') !~ '^(https://[^\s]+)?$' then
      raise exception 'invalid_input' using detail = 'upi_id must look like name@bank and qr_url must be https';
    end if;
  end if;
  if p_key = 'owner_coins' then
    perform public._require_super_admin();
    perform public.require_fresh(15);
    p_is_public := false;
    if jsonb_typeof(p_value) <> 'object'
       or coalesce(p_value ->> 'monthly_amount', '0') !~ '^\d{1,13}$'
       or coalesce(p_value ->> 'opening_balance', '0') !~ '^\d{1,13}$'
       or coalesce(p_value ->> 'owner_email', 'a@b.c') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception 'invalid_input' using detail = 'monthly_amount: whole number of coins; owner_email: an email';
    end if;
  end if;
  if p_key = 'order_rules' then
    p_is_public := true;
    if jsonb_typeof(p_value) <> 'object'
       or coalesce(p_value ->> 'max_orders_per_day', '10') !~ '^\d{1,4}$' or (p_value ->> 'max_orders_per_day')::int < 1
       or coalesce(p_value ->> 'cancel_penalty_after', '5') !~ '^\d{1,3}$'
       or coalesce(p_value ->> 'cancel_penalty_amount', '10') !~ '^\d{1,5}(\.\d{1,2})?$'
       or coalesce(p_value ->> 'require_phone', 'true') not in ('true', 'false')
       or coalesce(p_value ->> 'require_phone_verified', 'false') not in ('true', 'false')
       or coalesce(p_value ->> 'allow_negative_wallet', 'false') not in ('true', 'false') then
      raise exception 'invalid_input' using detail = 'order rules: whole numbers (orders/day at least 1), amount in rupees, on/off switches';
    end if;
  end if;
  if p_key = 'update_notice' then
    p_is_public := false;
    if jsonb_typeof(p_value) <> 'object'
       or coalesce(p_value ->> 'enabled', 'true') not in ('true', 'false')
       or coalesce(p_value ->> 'cooldown_hours', '6') !~ '^\d{1,3}(\.\d{1,2})?$'
       or coalesce(p_value ->> 'cooldown_hours', '6')::numeric < 0.25 or coalesce(p_value ->> 'cooldown_hours', '6')::numeric > 720 then
      raise exception 'invalid_input' using detail = 'update notice: on/off and a cooldown between 0.25 and 720 hours';
    end if;
    p_value := jsonb_build_object('enabled', coalesce(p_value ->> 'enabled', 'true')::boolean,
                                  'cooldown_hours', coalesce(p_value ->> 'cooldown_hours', '6')::numeric,
                                  'send_email', false);  -- email is not built: always OFF
  end if;
  insert into public.site_settings (key, value, is_public, updated_by)
  values (p_key, p_value, coalesce(p_is_public, true), auth.uid())
  on conflict (key) do update set value = excluded.value, is_public = excluded.is_public, updated_by = excluded.updated_by;
  perform public._audit('setting_change', 'site_settings', p_key, jsonb_build_object('key', p_key, 'is_public', coalesce(p_is_public, true)));
end;
$function$;
revoke all on function public.admin_upsert_setting(text, jsonb, boolean) from public, anon;
grant execute on function public.admin_upsert_setting(text, jsonb, boolean) to authenticated;

-- default notice settings (private); never overwritten
insert into public.site_settings (key, value, is_public)
values ('update_notice', '{"enabled": true, "cooldown_hours": 6, "send_email": false}'::jsonb, false)
on conflict (key) do nothing;
