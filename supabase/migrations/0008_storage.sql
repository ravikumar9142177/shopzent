-- SHOPZENT 0008: storage buckets + policies on storage.objects
-- (storage.objects already has RLS enabled on Supabase.)

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  ('public-media', 'public-media', true, 52428800,
   array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'video/mp4', 'video/webm']),
  ('payment-proofs', 'payment-proofs', false, 5242880, array['image/png', 'image/jpeg', 'image/webp']),
  ('return-photos', 'return-photos', false, 5242880, array['image/png', 'image/jpeg', 'image/webp']),
  ('apk-files', 'apk-files', false, 209715200,
   array['application/vnd.android.package-archive', 'application/octet-stream', 'application/zip'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- true when a published app row points at this object and it passed a scan / manual verification
create or replace function public.apk_downloadable(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (select 1 from public.apps a
                 where a.storage_path = p_name and a.published and a.verification_status in ('scanned_clean', 'verified'));
$$;

drop policy if exists shopzent_public_media_read on storage.objects;
drop policy if exists shopzent_public_media_insert on storage.objects;
drop policy if exists shopzent_public_media_update on storage.objects;
drop policy if exists shopzent_public_media_delete on storage.objects;
drop policy if exists shopzent_proofs_insert on storage.objects;
drop policy if exists shopzent_proofs_read on storage.objects;
drop policy if exists shopzent_proofs_delete on storage.objects;
drop policy if exists shopzent_returns_insert on storage.objects;
drop policy if exists shopzent_returns_read on storage.objects;
drop policy if exists shopzent_returns_delete on storage.objects;
drop policy if exists shopzent_apk_admin_write on storage.objects;
drop policy if exists shopzent_apk_admin_update on storage.objects;
drop policy if exists shopzent_apk_admin_delete on storage.objects;
drop policy if exists shopzent_apk_read on storage.objects;

-- public-media: anyone can read (bucket is public); only admins (aal2) write
create policy shopzent_public_media_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'public-media');
create policy shopzent_public_media_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'public-media' and public.is_admin() and name !~ '\.\.'
              and (storage.foldername(name))[1] in ('products', 'banners', 'ads', 'videos', 'thumbs', 'brand', 'settings', 'categories', 'apps'));
create policy shopzent_public_media_update on storage.objects for update to authenticated
  using (bucket_id = 'public-media' and public.is_admin()) with check (bucket_id = 'public-media' and public.is_admin());
create policy shopzent_public_media_delete on storage.objects for delete to authenticated
  using (bucket_id = 'public-media' and public.is_admin());

-- payment-proofs: owner folder = auth.uid(); owner or admin can read; no update; admin delete
create policy shopzent_proofs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'payment-proofs' and (storage.foldername(name))[1] = auth.uid()::text and name !~ '\.\.'
              and coalesce(public.my_role(), '') <> '' );
create policy shopzent_proofs_read on storage.objects for select to authenticated
  using (bucket_id = 'payment-proofs' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
create policy shopzent_proofs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'payment-proofs' and public.is_admin());

-- return-photos: same owner-folder rules
create policy shopzent_returns_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'return-photos' and (storage.foldername(name))[1] = auth.uid()::text and name !~ '\.\.');
create policy shopzent_returns_read on storage.objects for select to authenticated
  using (bucket_id = 'return-photos' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));
create policy shopzent_returns_delete on storage.objects for delete to authenticated
  using (bucket_id = 'return-photos' and public.is_admin());

-- apk-files: admins write; downloads (signed URLs) only for published + scanned/verified apps
create policy shopzent_apk_admin_write on storage.objects for insert to authenticated
  with check (bucket_id = 'apk-files' and public.is_admin() and name !~ '\.\.');
create policy shopzent_apk_admin_update on storage.objects for update to authenticated
  using (bucket_id = 'apk-files' and public.is_admin()) with check (bucket_id = 'apk-files' and public.is_admin());
create policy shopzent_apk_admin_delete on storage.objects for delete to authenticated
  using (bucket_id = 'apk-files' and public.is_admin());
create policy shopzent_apk_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'apk-files' and (public.is_admin() or public.apk_downloadable(name)));
