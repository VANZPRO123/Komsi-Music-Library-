-- KOMSI Music Library Storage limits
-- Applied to the hosted Supabase project on 2026-11-15.
-- Safe to re-run; does not modify existing objects or bucket visibility.

update storage.buckets
set file_size_limit = 104857600
where id = 'audio';

update storage.buckets
set file_size_limit = 10485760
where id = 'covers';

-- Public read + admin-only insert/delete policies are managed separately.
-- Do not make either bucket private without changing public media URL handling.
