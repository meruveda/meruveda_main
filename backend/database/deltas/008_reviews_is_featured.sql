-- 008: admin "Feature on homepage" toggle (PATCH /api/reviews/:id/feature).
--
-- ROOT CAUSE: the base schema (seed.sql `reviews` table) has no `is_featured`
-- column, so every sparkle-button click fails with HTTP 503 until this runs.
-- (Delta 006 contains the same statement; apply EITHER 006 or this file,
-- not both — both are idempotent so double-applying is harmless.)
--
-- ADDITIVE ONLY — no existing columns, tables or constraints are modified.
-- DO NOT RUN BLINDLY: paste into the Supabase SQL editor and verify.
-- Verify afterwards with:
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'reviews' AND column_name IN ('is_featured', 'reply');

-- 1. Featured flag read/written by the admin toggle and the public
--    homepage feed (GET /api/reviews/featured).
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_reviews_is_featured
  ON public.reviews(is_featured) WHERE is_featured = true;

-- 2. Support reply rendered beneath a review on the storefront
--    (PATCH /api/reviews/:id with a `reply` body).
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS reply TEXT;
