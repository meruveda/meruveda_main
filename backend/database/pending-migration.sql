-- =====================================================================
-- MeruVeda pending migration bundle
-- GENERATED FILE — do not hand-edit.
-- Regenerate: npm run db:bundle   (node scripts/build-migration-bundle.js)
--
-- Target project : pfklokcgcppdmrqgukmr
-- Includes        : 005 -> 006 -> 009 -> 010
-- Excludes        : 001, 002, 003, 004, 007 (already applied), 008 (superseded by 006)
--
-- WHY A BUNDLE: this repository has no DDL path. The Supabase service-role key
-- speaks PostgREST only, and this project exposes zero SQL-executing RPCs, so
-- the only way to apply schema is a direct connection or this file pasted into
-- the Supabase SQL editor.
--
-- SAFE TO RE-RUN: every statement is ADD COLUMN IF NOT EXISTS / CREATE TABLE IF
-- NOT EXISTS / CREATE INDEX IF NOT EXISTS. Nothing drops, truncates or rewrites
-- existing rows. customers, products, orders, order_items, media, reviews and
-- categories are untouched.
--
-- APPLY ORDER MATTERS ONLY in that 006 must precede nothing, and all four are
-- independent of one another — but keep the order below for reviewability.
-- =====================================================================

BEGIN;


-- --------------------------------------------------------------------
-- 005_otp_whatsapp_review_requests.sql
-- OTP store, WhatsApp send log, review requests, RLS
-- --------------------------------------------------------------------

-- 005: OTP login, WhatsApp delivery log and 7-day review request job.
-- ADDITIVE ONLY — no existing columns, tables or constraints are modified.

-- 1. OTP codes for the WhatsApp-based checkout login (send / verify / resend / expiry).
-- The code is NEVER stored in plaintext: `code_hash` holds HMAC-SHA256(code, pepper)
-- where the pepper is OTP_HASH_PEPPER, a server-side secret that never reaches the
-- database. A 6-digit code has only 10^6 values, so a bare SHA-256 would be
-- reversible by brute force in under a second; the pepper is what makes a leaked
-- dump useless. See src/utils/otpHash.ts.
CREATE TABLE IF NOT EXISTS public.otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(20) NOT NULL,
  code_hash VARCHAR(64) NOT NULL,
  purpose VARCHAR(30) NOT NULL DEFAULT 'checkout_login',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_otps_phone ON public.otps(phone);
CREATE INDEX IF NOT EXISTS idx_otps_expires_at ON public.otps(expires_at);

-- 2. Outbound WhatsApp message log — also used to guarantee "never send twice".
CREATE TABLE IF NOT EXISTS public.whatsapp_message_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient VARCHAR(30) NOT NULL,
  template_name VARCHAR(100),
  message_type VARCHAR(30),
  purpose VARCHAR(60) NOT NULL,
  reference_id VARCHAR(100),
  status VARCHAR(30) NOT NULL DEFAULT 'sent',
  error TEXT,
  payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (purpose, reference_id)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_message_log_reference ON public.whatsapp_message_log(reference_id);

-- 3. 7-day review request tracking. `order_id` UNIQUE => a request can never be queued twice.
CREATE TABLE IF NOT EXISTS public.review_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
  sent_at TIMESTAMPTZ,
  review_id UUID,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (order_id)
);

CREATE INDEX IF NOT EXISTS idx_review_requests_status ON public.review_requests(status);

-- 4. Saved profile fields for OTP-created customers (users.email already exists).
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS address JSONB;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- 5. Row Level Security: these three tables are server-only.
--
-- They hold mobile numbers, OTP digests and outbound message history. The app
-- reaches Supabase exclusively through the backend service-role key, and no
-- browser bundle contains a Supabase client, so no end user ever needs a direct
-- policy on these tables.
--
-- Enabling RLS with NO policies is therefore the correct posture, not an
-- omission: it makes every non-service role denied, so if an anon key is ever
-- leaked or added to the frontend these tables stay unreadable. The
-- service_role key bypasses RLS, which is exactly why the backend still works.
--
-- Verify afterwards:
--   SELECT relname, relrowsecurity FROM pg_class
--    WHERE relname IN ('otps','whatsapp_message_log','review_requests');
ALTER TABLE public.otps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_message_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_requests ENABLE ROW LEVEL SECURITY;

-- A stray policy from an earlier manual attempt would silently re-open these
-- tables, so drop the ones we know are wrong by name only.
DROP POLICY IF EXISTS otps_public_read ON public.otps;
DROP POLICY IF EXISTS whatsapp_log_public_read ON public.whatsapp_message_log;
DROP POLICY IF EXISTS review_requests_public_read ON public.review_requests;

-- --------------------------------------------------------------------
-- 006_missing_columns.sql
-- orders.delivered_at + reviews.is_featured/reply
-- --------------------------------------------------------------------

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

-- --------------------------------------------------------------------
-- 009_page_views.sql
-- page_views + users.phone_verified
-- --------------------------------------------------------------------

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

-- --------------------------------------------------------------------
-- 010_auto_invoice_shiprocket.sql
-- invoice + Shiprocket push bookkeeping
-- --------------------------------------------------------------------

-- 010: automatic invoice delivery + automatic Shiprocket push.
--
-- UNLOCKS:
--   * orders.invoice_sent_at / orders.invoice_error
--       -> atomic "send the invoice at most once" claim used by the PayU
--          success webhook and the COD placement hook, plus the admin Orders
--          page "Invoice: sent / failed / not sent" column and the failure
--          reason shown next to the Resend button.
--   * orders.shiprocket_push_status / shiprocket_push_error /
--     orders.shiprocket_pushed_at / orders.shiprocket_push_started_at
--       -> atomic "who pushes this order to Shiprocket" claim (prevents two
--          parallel PayU callbacks creating two Shiprocket shipments), the
--          pushed / failed / pending badge in admin, the saved failure reason,
--          and the 15-minute stale-claim reclaim.
--
-- ADDITIVE ONLY — no existing column, table, constraint or row is modified.
-- Idempotent: safe to run multiple times (ADD COLUMN IF NOT EXISTS,
-- CREATE INDEX IF NOT EXISTS).
-- DO NOT RUN BLINDLY: paste into the Supabase SQL editor and verify.
--
-- Verify afterwards with:
--   SELECT column_name, data_type FROM information_schema.columns
--   WHERE table_name = 'orders'
--     AND column_name LIKE 'invoice_%' OR column_name LIKE 'shiprocket_push%';

-- ---------------------------------------------------------------------------
-- 1. Invoice delivery bookkeeping
-- ---------------------------------------------------------------------------
-- invoice_sent_at doubles as the atomic claim: the dispatcher runs
--   UPDATE orders SET invoice_sent_at = now()
--    WHERE id = :id AND invoice_sent_at IS NULL
-- and only the caller that gets a row back actually sends. On failure the
-- claim is released (set back to NULL) so the daily retry cron can pick it up.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS invoice_sent_at TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS invoice_error TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_invoice_sent_at
  ON public.orders (invoice_sent_at) WHERE invoice_sent_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Shiprocket push bookkeeping
-- ---------------------------------------------------------------------------
-- shiprocket_push_status allowed values (no CHECK constraint on purpose, so a
-- future rename does not need another migration):
--   'in_progress' -> a push attempt owns the order right now
--   'pushed'      -> Shiprocket accepted the order (shiprocket_order_id set)
--   'failed'      -> the last attempt failed; shiprocket_push_error holds why
-- NULL            -> never attempted
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shiprocket_push_status VARCHAR(30);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shiprocket_push_error TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shiprocket_pushed_at TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shiprocket_push_started_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_shiprocket_push_status
  ON public.orders (shiprocket_push_status);

CREATE INDEX IF NOT EXISTS idx_orders_shiprocket_pushed_at
  ON public.orders (shiprocket_pushed_at) WHERE shiprocket_pushed_at IS NOT NULL;

COMMIT;

-- =====================================================================
-- VERIFY — run this after COMMIT. Every row must return.
-- Expected: 5 objects from 005, 3 from 006, 2 from 009, 6 from 010 = 16.
-- =====================================================================
SELECT table_name AS object, 'table' AS kind
  FROM information_schema.tables
 WHERE table_schema = 'public'
   AND table_name IN ('otps', 'whatsapp_message_log', 'review_requests', 'page_views')
UNION ALL
SELECT table_name || '.' || column_name, 'column'
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND (   (table_name = 'users'    AND column_name IN ('address', 'last_login_at', 'phone_verified'))
         OR (table_name = 'orders'   AND (column_name LIKE 'invoice_%' OR column_name LIKE 'shiprocket_push%'))
         OR (table_name = 'reviews'  AND column_name IN ('is_featured', 'reply'))
         OR (table_name = 'orders'   AND column_name = 'delivered_at') )
 ORDER BY 1;

-- RLS must be on for the three sensitive tables (relrowsecurity = t).
SELECT relname, relrowsecurity
  FROM pg_class
 WHERE relname IN ('otps', 'whatsapp_message_log', 'review_requests')
 ORDER BY relname;

-- ROLLBACK: if anything above is wrong, restore from
-- backend/backups/ using scripts/restore-data.js. Do NOT reset the project.
