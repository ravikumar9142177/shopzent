-- SHOPZENT 0024: delivery confirmation by admin, product reviews (after delivery), coin fields on order JSON.
-- Share rewards are released when an order is DELIVERED (trigger from 0022). Idempotent.

-- order JSON: coins used and delivered time (read by My orders and order details)
CREATE OR REPLACE FUNCTION public._order_json(p_o orders)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select jsonb_build_object('order_id', p_o.id, 'order_code', p_o.order_code, 'total', p_o.total, 'status', p_o.status,
         'payment_status', p_o.payment_status, 'subtotal', p_o.subtotal, 'product_discount', p_o.product_discount,
         'coupon_discount', p_o.coupon_discount, 'wallet_used', p_o.wallet_used, 'coupon_codes', to_jsonb(p_o.coupon_codes),
         'created_at', p_o.created_at, 'coins_used', p_o.coins_used, 'coin_discount', p_o.coin_discount, 'delivered_at', p_o.delivered_at);
$function$
;

-- ---------- admin: mark delivered (ticket-style: who, when, note in the order events and audit log) ----------
create or replace function public.admin_mark_delivered(p_order_id uuid, p_note text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_o public.orders; v_note text := left(btrim(coalesce(p_note, '')), 300);
begin
  perform public._require_admin();
  perform public.require_fresh(15);
  select * into v_o from public.orders where id = p_order_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_o.status = 'delivered' then
    return jsonb_build_object('order_id', v_o.id, 'status', 'delivered', 'delivered_at', v_o.delivered_at, 'replayed', true);
  end if;
  if v_o.status in ('order_cancelled', 'order_rejected', 'payment_rejected', 'return_requested', 'return_approved', 'refund_processing', 'refund_completed') then
    raise exception 'order_not_active';
  end if;
  if v_o.payment_status <> 'verified' then raise exception 'payment_not_confirmed'; end if;
  perform public._set_order_status(v_o.id, 'delivered',
    coalesce(nullif(v_note, ''), 'Delivered - confirmed by SHOPZENT admin'), true);
  perform public._audit('order_delivered', 'orders', v_o.id::text, jsonb_build_object('order_code', v_o.order_code, 'note', v_note));
  return jsonb_build_object('order_id', v_o.id, 'status', 'delivered', 'delivered_at', now(), 'replayed', false);
end $$;

-- ---------- reviews: one per customer per product, only after a DELIVERED order with that product ----------
create table if not exists public.product_reviews (
  id bigserial primary key,
  product_id uuid not null references public.products (id) on delete cascade,
  user_id uuid not null references public.profiles (id),
  order_id uuid not null references public.orders (id),
  rating smallint not null check (rating between 1 and 5),
  body text check (body is null or char_length(body) <= 500),
  status text not null default 'visible' check (status in ('visible', 'hidden')),
  hidden_reason text,
  created_at timestamptz not null default now(),
  constraint product_reviews_one_per_customer unique (user_id, product_id)
);
create index if not exists product_reviews_product_idx on public.product_reviews (product_id, status, created_at desc);
alter table public.product_reviews enable row level security;
-- no direct table access for anyone: writes and reads go through the functions below (cannot forge or edit others' reviews)
revoke all on public.product_reviews from public, anon, authenticated;

create or replace function public.product_reviews_summary(p_product_id uuid, p_limit int default 20)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_uid uuid := auth.uid(); v_out jsonb;
begin
  select jsonb_build_object(
    'avg', round(coalesce(avg(r.rating), 0), 1),
    'count', count(*),
    'items', coalesce((select jsonb_agg(x) from (
        select jsonb_build_object('rating', rr.rating, 'body', rr.body, 'created_at', rr.created_at,
                                  'by', coalesce(nullif(split_part(coalesce(p.full_name, ''), ' ', 1), ''), 'Customer'),
                                  'mine', (rr.user_id = v_uid)) x
        from public.product_reviews rr join public.profiles p on p.id = rr.user_id
        where rr.product_id = p_product_id and rr.status = 'visible'
        order by rr.created_at desc limit least(greatest(coalesce(p_limit, 20), 1), 50)) s), '[]'::jsonb))
  into v_out
  from public.product_reviews r where r.product_id = p_product_id and r.status = 'visible';
  return v_out;
end $$;

create or replace function public.submit_review(p_product_id uuid, p_rating int, p_body text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_uid uuid := public._require_user(); v_order uuid; v_body text;
begin
  if p_rating is null or p_rating < 1 or p_rating > 5 then raise exception 'invalid_input' using detail = 'rating'; end if;
  -- strip anything that looks like markup; the page also escapes everything it shows
  v_body := nullif(btrim(regexp_replace(coalesce(p_body, ''), '[<>]', '', 'g')), '');
  if v_body is not null and char_length(v_body) > 500 then raise exception 'invalid_input' using detail = 'review too long'; end if;
  select o.id into v_order from public.orders o join public.order_items oi on oi.order_id = o.id
    where o.user_id = v_uid and o.status = 'delivered' and oi.product_id = p_product_id
    order by o.delivered_at desc nulls last limit 1;
  if v_order is null then raise exception 'not_delivered'; end if;
  if exists (select 1 from public.product_reviews x where x.user_id = v_uid and x.product_id = p_product_id) then
    raise exception 'already_reviewed';
  end if;
  insert into public.product_reviews (product_id, user_id, order_id, rating, body)
  values (p_product_id, v_uid, v_order, p_rating, v_body);
  return jsonb_build_object('product_id', p_product_id, 'rating', p_rating, 'saved', true);
end $$;

create or replace function public.my_reviews()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_uid uuid := public._require_user();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('product_id', r.product_id, 'rating', r.rating, 'body', r.body, 'status', r.status, 'created_at', r.created_at))
                   from public.product_reviews r where r.user_id = v_uid), '[]'::jsonb);
end $$;

create or replace function public.admin_list_reviews(p_status text default null, p_limit int default 200)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform public._require_admin();
  return coalesce((select jsonb_agg(x) from (
      select jsonb_build_object('id', r.id, 'product', p.name, 'product_id', r.product_id, 'customer', pr.customer_id,
                                'name', pr.full_name, 'order_code', o.order_code, 'rating', r.rating, 'body', r.body,
                                'status', r.status, 'hidden_reason', r.hidden_reason, 'created_at', r.created_at) x
      from public.product_reviews r
        join public.products p on p.id = r.product_id
        join public.profiles pr on pr.id = r.user_id
        join public.orders o on o.id = r.order_id
      where p_status is null or r.status = p_status
      order by r.created_at desc
      limit least(greatest(coalesce(p_limit, 200), 1), 500)) s), '[]'::jsonb);
end $$;

create or replace function public.admin_set_review_status(p_id bigint, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r public.product_reviews%rowtype; v_reason text := left(btrim(coalesce(p_reason, '')), 200);
begin
  perform public._require_admin();
  perform public.require_fresh(15);
  if p_status not in ('visible', 'hidden') then raise exception 'invalid_input' using detail = 'status'; end if;
  if p_status = 'hidden' and char_length(v_reason) < 3 then raise exception 'invalid_input' using detail = 'reason'; end if;
  select * into r from public.product_reviews where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  update public.product_reviews set status = p_status, hidden_reason = case when p_status = 'hidden' then v_reason else null end where id = r.id;
  perform public._audit('review_' || p_status, 'product_reviews', r.id::text, jsonb_build_object('product_id', r.product_id, 'reason', v_reason));
  return jsonb_build_object('id', r.id, 'status', p_status);
end $$;

-- ---------- grants ----------
revoke all on function public.admin_mark_delivered(uuid, text), public.admin_list_reviews(text, int),
  public.admin_set_review_status(bigint, text, text), public.my_reviews(), public.submit_review(uuid, int, text),
  public.product_reviews_summary(uuid, int) from public, anon, authenticated;
grant execute on function public.admin_mark_delivered(uuid, text), public.admin_list_reviews(text, int),
  public.admin_set_review_status(bigint, text, text) to authenticated;
grant execute on function public.my_reviews(), public.submit_review(uuid, int, text) to authenticated;
grant execute on function public.product_reviews_summary(uuid, int) to anon, authenticated;
