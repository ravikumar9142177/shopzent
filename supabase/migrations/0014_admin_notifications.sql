-- 0014_admin_notifications.sql
-- CONTRACT.md lists admin_notifications() -> setof notifications (audience admin, newest 50).
-- The admin panel's notification bell and dashboard call it; it was missing (404 on every admin page).
create or replace function public.admin_notifications()
returns setof public.notifications
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._require_admin();
  return query
    select * from public.notifications n
    where n.audience = 'admin'
    order by n.created_at desc
    limit 50;
end;
$$;
revoke all on function public.admin_notifications() from public, anon;
grant execute on function public.admin_notifications() to authenticated;
notify pgrst, 'reload schema';
