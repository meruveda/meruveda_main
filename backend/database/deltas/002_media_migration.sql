-- supabase_media_migration.sql
-- 1. Rename existing columns to match the new architecture
ALTER TABLE public.media RENAME COLUMN url TO public_url;
ALTER TABLE public.media RENAME COLUMN folder TO bucket;
ALTER TABLE public.media RENAME COLUMN size_bytes TO size;
ALTER TABLE public.media RENAME COLUMN mimetype TO mime_type;

-- 2. Add the new storage_path column
ALTER TABLE public.media ADD COLUMN IF NOT EXISTS storage_path TEXT;

-- 3. (Optional) Backfill existing local URLs to clarify they aren't in Supabase Storage yet
UPDATE public.media 
SET storage_path = 'local_file_pending_migration', bucket = 'legacy-local' 
WHERE public_url LIKE '/storage/uploads/%';
