-- 0044: Team section. The admin adds the people of the company (name, post, photo, rank, order, visible) and the visible ones
-- show in the website footer, by rank then order. Anyone may read visible rows; only an admin (is_admin(): admin role AND 2FA session) writes.
-- Photos go to the existing public-media bucket under team/ (the storage insert policy is widened by one folder below).
-- Idempotent. No seed rows: no real person is added here; the owner enters names through the admin panel.

create table if not exists public.team_members (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  role        text not null default '' check (char_length(role) <= 120),
  photo_path  text check (photo_path is null or char_length(photo_path) <= 300),
  photo_url   text check (photo_url is null or (photo_url ~ '^https://' and char_length(photo_url) <= 2000)),
  rank        integer not null default 9 check (rank between 0 and 999),
  sort_order  integer not null default 0 check (sort_order between 0 and 100000),
  visible     boolean not null default true,
  created_at  timestamptz not null default now()
);
-- display order: rank first (1 = Chairman; lower shows first), then sort_order within the same rank
create index if not exists team_members_order_idx on public.team_members (visible, rank, sort_order, created_at);

alter table public.team_members enable row level security;

drop policy if exists team_members_read on public.team_members;
create policy team_members_read on public.team_members for select to anon, authenticated
  using (visible or public.is_admin());

drop policy if exists team_members_admin_write on public.team_members;
create policy team_members_admin_write on public.team_members for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select on public.team_members to anon, authenticated;
grant insert, update, delete on public.team_members to authenticated;

-- public-media: admin-only writes (aal2), as in 0008; the only change is the extra folder 'team'.
drop policy if exists shopzent_public_media_insert on storage.objects;
create policy shopzent_public_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'public-media' and public.is_admin() and name !~ '\.\.'
              and (storage.foldername(name))[1] in ('products', 'banners', 'ads', 'videos', 'thumbs', 'brand', 'settings', 'categories', 'apps', 'team'));
