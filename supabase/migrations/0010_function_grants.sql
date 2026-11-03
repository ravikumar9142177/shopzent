-- SHOPZENT 0010: function privileges. Supabase grants EXECUTE on new functions to
-- PUBLIC/anon/authenticated by default, so revoke everything and grant explicitly.

revoke execute on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon, authenticated;

-- helpers used inside RLS policies / storage policies must be callable by the API roles
grant execute on function public.current_aal(), public.is_admin(), public.is_super_admin(), public.is_staff_aal1(),
  public.my_role(), public.apk_downloadable(text) to anon, authenticated;
grant execute on function public.require_fresh(int) to authenticated;

-- public (anon + signed-in)
grant execute on function
  public.public_coupons(),
  public.quote_cart(jsonb, text),
  public.track_affiliate_click(uuid),
  public.track_ad(uuid, text),
  public.submit_contact(text, text, text, text, text),
  public.subscribe_newsletter(text),
  public.record_view(uuid)
to anon, authenticated;

-- signed-in users
grant execute on function
  public.my_profile(),
  public.update_my_profile(text, text),
  public.toggle_wishlist(uuid),
  public.my_wallet(),
  public.my_coins(),
  public.create_order(jsonb, text, jsonb, numeric, text),
  public.submit_payment(uuid, text, text, text),
  public.request_cancellation(uuid, text),
  public.request_return(uuid, text, text, text[], text),
  public.mark_notification_read(uuid),
  public.generate_recovery_codes(),
  public.use_recovery_code(text),
  public.log_auth_event(text, jsonb)
to authenticated;

-- admin RPCs (each one checks is_admin()/aal2 itself; anon never gets them)
grant execute on function
  public.admin_stats(),
  public.admin_security_overview(),
  public.admin_search_customers(text),
  public.admin_list_users(text, int),
  public.admin_list_orders(text, text, int, int),
  public.admin_order_detail(uuid),
  public.admin_mark_under_verification(uuid),
  public.admin_verify_payment(uuid, text, text),
  public.admin_reject_payment(uuid, text, text),
  public.admin_set_order_status(uuid, text, text, text),
  public.admin_reject_order(uuid, text, text),
  public.admin_cancel_order(uuid, text, text),
  public.admin_update_order(uuid, jsonb),
  public.admin_add_order_note(uuid, text),
  public.admin_review_return(uuid, text, text, numeric, text),
  public.admin_issue_refund(uuid, uuid, numeric, text, text, text),
  public.admin_complete_refund(bigint, text, text),
  public.admin_wallet_adjust(uuid, text, text, numeric, text, text),
  public.admin_wallet_ledger(uuid, int),
  public.admin_coin_overview(),
  public.admin_coin_transfer(text, bigint, text, text),
  public.admin_coin_reverse(bigint, text, text),
  public.admin_expire_coins(),
  public.admin_coin_ledger(int),
  public.admin_set_coin_settings(boolean, int, text),
  public.admin_set_user_role(uuid, text),
  public.admin_set_user_status(uuid, text, text),
  public.admin_upsert_setting(text, jsonb, boolean),
  public.admin_audit_log(int, text)
to authenticated;

-- service role (Edge Functions) + owner only
revoke execute on function public.bootstrap_super_admin(text) from public, anon, authenticated;
grant execute on function public.bootstrap_super_admin(text) to service_role;
grant execute on function public.hit_rate_limit(text, text, int, int) to service_role;
grant select, insert on public.login_attempts to service_role;
grant usage, select on sequence public.login_attempts_id_seq to service_role;
grant select, insert on public.audit_log to service_role;
grant usage, select on sequence public.audit_log_id_seq to service_role;
