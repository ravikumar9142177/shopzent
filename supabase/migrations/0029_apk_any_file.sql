-- SHOPZENT 0029: app files bucket accepts any file type (APK, zip, pdf, anything the admin uploads).
-- The project's storage plan caps a single file at 50 MB (the platform's own limit, not this bucket's): bigger files use the
-- Link option on the admin app form. Idempotent. No secrets.
update storage.buckets
   set allowed_mime_types = null,
       file_size_limit = 209715200
 where id = 'apk-files';
