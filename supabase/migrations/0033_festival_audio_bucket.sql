-- SHOPZENT 0033: Festival Studio custom tune. The admin may upload a short festival audio file (mp3/m4a/ogg/aac/wav, 2 MB)
-- to the existing public-media bucket under settings/festival-audio. Only the bucket's MIME list changes: writes stay
-- admin-only (the existing public-media policies, AAL2), nothing is deleted. Idempotent.
update storage.buckets
set allowed_mime_types = allowed_mime_types || array['audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg', 'audio/wav', 'audio/x-wav']
where id = 'public-media' and allowed_mime_types is not null
  and not ('audio/mpeg' = any(allowed_mime_types));
