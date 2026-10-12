-- 009: first-party pageview analytics + phone_verified flag for checkout quick-login.
--
-- ADDITIVE ONLY — no existing columns, tables or constraints are modified.
-- Idempotent: safe to run multiple times.
-- DO NOT RUN BLINDLY: paste into the Supabase SQL editor and verify.
-- Verify afterwards with:
--   SELECT table_name FROM information_schema.tables WHERE table_name = 'page_views';
--   SELECT column_name FROM information_schema.columns
--   WHERE table_name = 'users' AND column_name = 'phone_verified';

-- 1. Pageview log written by public POST /api/analytics/pageview (storefront,
--    fire-and-forget) and read by admin GET /api/analytics/traffic.
--    No PII: no IP, no user id — only path, referrer, a random session id and
--    a coarse device type.
CREATE TABLE IF NOT EXISTS public.page_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  path TEXT NOT NULL,
  referrer TEXT,
  session_id TEXT,
  device_type TEXT NOT NULL DEFAULT 'desktop',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_page_views_created_at
  ON public.page_views (created_at);

CREATE INDEX IF NOT EXISTS idx_page_views_session
  ON public.page_views (session_id);

-- 2. Phone-verification flag for the checkout quick-login flow (no OTP).
--    DEFAULT true so every pre-existing user keeps access to order history.
--    New quick-login users are explicitly set to false by the backend; the
--    flag flips to true only after a successful OTP verification (when the
--    OTP feature is re-enabled). Tokens carrying phone_verified=false are
--    blocked from GET /api/orders/my until then.
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT true;
