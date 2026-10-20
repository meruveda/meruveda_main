-- =============================================================================
-- NEON PENDING DELTAS - single consolidated script for the columns/tables the
-- API already reads or writes but the migrated schema does not have yet.
--
-- Everything here is ADDITIVE ONLY (CREATE TABLE IF NOT EXISTS / ADD COLUMN IF
-- NOT EXISTS / CREATE INDEX IF NOT EXISTS). No existing column, table,
-- constraint or row is modified or dropped, and nothing is deleted.
--
-- NEON NOTES
--   * No Supabase roles: there is no `service_role` / `anon`, no RLS and no
--     storage policies in this file. The backend connects as the database owner.
--   * Run order: this file assumes the base schema (deltas 001-004) is already
--     present. It covers deltas 005-012 plus analytics_events (013).
--   * DO NOT RUN BLINDLY: run on a Neon branch or the rehearsal schema first.
--
-- HOW TO RUN
--   1. psql "$DATABASE_URL_UNPOOLED" -f backend/sql/migrations/2026-10-19_neon_pending_deltas.sql
--   2. Re-running is safe - every statement is idempotent.
--   3. Verify afterwards with the queries in the VERIFY section at the bottom.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 005 - OTP login, WhatsApp delivery log, 7-day review request job,
--       and saved profile fields for OTP-created customers.
-- -----------------------------------------------------------------------------
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
CREATE INDEX IF NOT EXISTS idx_whatsapp_message_log_reference
  ON public.whatsapp_message_log(reference_id);

CREATE TABLE IF NOT EXISTS public.review_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
  sent_at TIMESTAMPTZ,
  review_id UUID,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (order_id)
);
CREATE INDEX IF NOT EXISTS idx_review_requests_status
  ON public.review_requests(status);

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS address JSONB;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;



-- -----------------------------------------------------------------------------
-- 007 — mobile-number authentication (password-reset token + phone lookup).
--       Guards: users.reset_password_token / reset_password_expires
--               (forgot-password flow), idx_users_phone (login speed).
-- -----------------------------------------------------------------------------
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS reset_password_token TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS reset_password_expires TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_users_reset_password_token
  ON public.users(reset_password_token) WHERE reset_password_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_phone ON public.users(phone);


-- -----------------------------------------------------------------------------
-- 006 / 008 — guest order tracking, homepage review feature flag, review reply.
--       Guards: orders.delivered_at (Shiprocket webhook + review job),
--               reviews.is_featured (admin sparkle toggle + GET /reviews/featured),
--               reviews.reply (storefront support reply under a review).
-- -----------------------------------------------------------------------------
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_orders_delivered_at
  ON public.orders(delivered_at) WHERE delivered_at IS NOT NULL;

ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS idx_reviews_is_featured
  ON public.reviews(is_featured) WHERE is_featured = true;

ALTER TABLE public.reviews ADD COLUMN IF NOT EXISTS reply TEXT;


-- -----------------------------------------------------------------------------
-- 009 — first-party pageview analytics + phone_verified flag for checkout
--       quick-login.
--       Guards: page_views table (admin Analytics traffic card),
--               users.phone_verified (order-history access for quick-login users).
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.page_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  path TEXT NOT NULL,
  referrer TEXT,
  session_id TEXT,
  device_type TEXT NOT NULL DEFAULT 'desktop',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_page_views_created_at ON public.page_views (created_at);
CREATE INDEX IF NOT EXISTS idx_page_views_session ON public.page_views (session_id);

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT true;


-- -----------------------------------------------------------------------------
-- 010 — automatic GST invoice + Shiprocket push bookkeeping.
--       Guards: orders.invoice_sent_at / invoice_error (invoice auto-send claim),
--               orders.shiprocket_push_status / shiprocket_push_error /
--               shiprocket_pushed_at / shiprocket_push_started_at
--               (single-flight Shiprocket push + admin retry state).
--
--       invoice_sent_at doubles as the idempotency claim: the backend takes it
--       with a conditional UPDATE (`WHERE invoice_sent_at IS NULL`) before
--       generating/sending anything, and releases it if the send fails.
-- -----------------------------------------------------------------------------
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS invoice_sent_at TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS invoice_error TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_invoice_sent_at
  ON public.orders (invoice_sent_at) WHERE invoice_sent_at IS NOT NULL;

-- shiprocket_push_status values (no CHECK on purpose, so a future rename needs
-- no migration): 'in_progress' | 'pushed' | 'failed' | NULL (never attempted).
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shiprocket_push_status VARCHAR(30);
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shiprocket_push_error TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shiprocket_pushed_at TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS shiprocket_push_started_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_shiprocket_push_status
  ON public.orders (shiprocket_push_status);

CREATE INDEX IF NOT EXISTS idx_orders_shiprocket_pushed_at
  ON public.orders (shiprocket_pushed_at) WHERE shiprocket_pushed_at IS NOT NULL;


-- -----------------------------------------------------------------------------
-- 011 — admin panel columns the UI already renders.
--       Guards: blogs.featured_image / blogs.seo_metadata (Journal editor),
--               categories.image / categories.banner (Categories editor),
--               support_tickets.ticket_number / reply (Support ticket list +
--               admin reply endpoint).
--
--       Note: blogs already has an `image_url` column; `featured_image` is the
--       name the backend/admin actually use, so both are kept and the API reads
--       featured_image.
-- -----------------------------------------------------------------------------
ALTER TABLE public.blogs ADD COLUMN IF NOT EXISTS featured_image TEXT;
ALTER TABLE public.blogs ADD COLUMN IF NOT EXISTS seo_metadata JSONB DEFAULT '{}'::jsonb;

ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS image TEXT;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS banner TEXT;

ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS ticket_number VARCHAR(50);
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS reply TEXT;
CREATE INDEX IF NOT EXISTS idx_support_tickets_ticket_number
  ON public.support_tickets(ticket_number);


-- -----------------------------------------------------------------------------
-- 012 — GST invoice number sequence (MV/<FY>/<6 digits>, e.g. MV/25-26/000123).
--       Canonical file: backend/sql/migrations/2026-10-14_invoice_sequence.sql
--       (same statements, kept in sync here as the consolidated convenience
--       copy). Must come AFTER 010 — needs the orders table.
--
--       The counter is assigned atomically in Postgres by the
--       assign_invoice_number() function: the order row is locked, an existing
--       number is returned unchanged (idempotent per order — retries never
--       consume a second number), otherwise the next per-financial-year value
--       is taken under the invoice_sequences row lock. No app-side max()+1.
--       Cancelled/failed orders consume nothing: the backend only calls the
--       function once an invoice is actually being generated.
-- -----------------------------------------------------------------------------
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS invoice_number TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_invoice_number
  ON public.orders (invoice_number) WHERE invoice_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.invoice_sequences (
  fy          TEXT PRIMARY KEY,
  last_value  BIGINT NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.assign_invoice_number(p_order_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_existing TEXT;
  v_fy TEXT;
  v_seq BIGINT;
  v_start_year INT;
  v_number TEXT;
BEGIN
  SELECT invoice_number INTO v_existing
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;                       -- serializes concurrent assigns per order

  IF NOT FOUND THEN
    RAISE EXCEPTION 'assign_invoice_number: order % not found', p_order_id;
  END IF;

  IF v_existing IS NOT NULL AND v_existing <> '' THEN
    RETURN v_existing;              -- idempotent: already assigned, never re-issued
  END IF;

  -- Indian FY: Apr 1 – Mar 31; label uses the start year.
  v_start_year := EXTRACT(YEAR FROM NOW())::INT
    + CASE WHEN EXTRACT(MONTH FROM NOW()) >= 4 THEN 0 ELSE -1 END;
  v_fy := TO_CHAR(v_start_year, 'YY') || '-' || TO_CHAR(v_start_year + 1, 'YY');

  INSERT INTO public.invoice_sequences (fy, last_value)
  VALUES (v_fy, 1)
  ON CONFLICT (fy) DO UPDATE
    SET last_value = invoice_sequences.last_value + 1,
        updated_at = NOW()
  RETURNING last_value INTO v_seq;  -- row lock on the FY counter until commit

  v_number := 'MV/' || v_fy || '/' || LPAD(v_seq::TEXT, 6, '0');

  UPDATE public.orders
  SET invoice_number = v_number
  WHERE id = p_order_id;

  RETURN v_number;
END;
$$;


-- -----------------------------------------------------------------------------
-- 013 — first-party e-commerce events (funnel + top products + COD/PayU split).
--       Append-only, no PII. The API answers 204 while the table is missing.
--       Canonical file: backend/sql/migrations/2026-10-14_analytics_events.sql
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name VARCHAR(40) NOT NULL,
  path VARCHAR(200),
  session_id VARCHAR(64),
  product_id UUID,
  order_id UUID,
  value NUMERIC(12, 2),
  currency VARCHAR(3) DEFAULT 'INR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at
  ON public.analytics_events (created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_events_name_created
  ON public.analytics_events (event_name, created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_events_product
  ON public.analytics_events (product_id)
  WHERE product_id IS NOT NULL;


-- =============================================================================
-- VERIFY — run after applying. Every row should be non-zero / true.
-- =============================================================================
-- SELECT table_name, column_name FROM information_schema.columns
-- WHERE table_name = 'users'
--   AND column_name IN ('address', 'last_login_at', 'phone_verified',
--                       'reset_password_token', 'reset_password_expires')
-- ORDER BY column_name;
--   -- expect 5 rows

-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'orders'
--   AND column_name IN ('delivered_at', 'invoice_sent_at', 'invoice_error',
--                       'shiprocket_push_status', 'shiprocket_push_error',
--                       'shiprocket_pushed_at', 'shiprocket_push_started_at',
--                       'invoice_number')
-- ORDER BY column_name;
--   -- expect 8 rows

-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'reviews' AND column_name IN ('is_featured', 'reply');
--   -- expect 2 rows

-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'blogs' AND column_name IN ('featured_image', 'seo_metadata');
--   -- expect 2 rows

-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'categories' AND column_name IN ('image', 'banner');
--   -- expect 2 rows

-- SELECT column_name FROM information_schema.columns
-- WHERE table_name = 'support_tickets' AND column_name IN ('ticket_number', 'reply');
--   -- expect 2 rows

-- SELECT table_name FROM information_schema.tables
-- WHERE table_name IN ('otps', 'whatsapp_message_log', 'review_requests',
--                      'page_views', 'invoice_sequences', 'analytics_events');
--   -- expect 6 rows

-- SELECT proname FROM pg_proc WHERE proname = 'assign_invoice_number';
--   -- expect 1 row

-- SELECT invoice_number, COUNT(*) FROM public.orders
--  WHERE invoice_number IS NOT NULL GROUP BY 1 HAVING COUNT(*) > 1;
--   -- expect 0 rows (numbers are unique per order)
-- =============================================================================
