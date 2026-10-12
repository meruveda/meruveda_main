-- 006: columns the API already reads/writes but no earlier delta creates.
-- ADDITIVE ONLY — no existing columns, tables or constraints are modified.
--
-- Apply AFTER 005_otp_whatsapp_review_requests.sql (both are idempotent, so they
-- can be pasted together in one Supabase SQL editor run).

-- 1. Guest order tracking (GET /api/orders/track) and the 7-day review request
--    job both need the delivery timestamp recorded by Shiprocket webhooks
--    (see src/services/shiprocket/webhook.service.ts).
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_orders_delivered_at
  ON public.orders(delivered_at) WHERE delivered_at IS NOT NULL;

-- 2. Admin "Feature on homepage" toggle (PATCH /api/reviews/:id/feature) and the
--    public homepage feed (GET /api/reviews/featured).
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_reviews_is_featured
  ON public.reviews(is_featured) WHERE is_featured = true;

-- 3. Support reply rendered beneath a review on the storefront
--    (PATCH /api/reviews/:id with a `reply` body).
ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS reply TEXT;
