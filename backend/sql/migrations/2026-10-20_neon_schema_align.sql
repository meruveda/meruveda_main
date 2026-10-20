-- =============================================================================
-- 2026-10-20 Neon schema alignment
--
-- Brings the CSV-imported Neon schema up to what the API already reads/writes.
-- ADDITIVE ONLY. Every statement is idempotent (IF NOT EXISTS / OR REPLACE),
-- so re-running is safe. Run in ONE transaction against DATABASE_URL_UNPOOLED.
--
-- Covers: delta 005 (otps columns, whatsapp log, review requests, profile),
-- 006 (delivery + review flags), 009 (pageviews + phone_verified),
-- 010 (invoice + Shiprocket push bookkeeping), 011 (admin columns),
-- 012 (invoice numbering), 013 (analytics events).
--
-- No RLS, no Supabase roles, no storage policies: Neon has no `anon` /
-- `service_role` and the backend connects as the database owner.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 005 - OTP / WhatsApp / review requests
-- ---------------------------------------------------------------------------
-- otps usually already exists from the CSV import, so CREATE TABLE IF NOT
-- EXISTS would silently skip these two columns. Add them explicitly first.
ALTER TABLE public.otps
  ADD COLUMN IF NOT EXISTS consumed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 5;

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

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS address JSONB,
  ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- ---------------------------------------------------------------------------
-- 006 - delivery timestamp + review feature/reply
-- ---------------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_orders_delivered_at
  ON public.orders(delivered_at) WHERE delivered_at IS NOT NULL;

ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reply TEXT;
CREATE INDEX IF NOT EXISTS idx_reviews_is_featured
  ON public.reviews(is_featured) WHERE is_featured = true;

-- ---------------------------------------------------------------------------
-- 009 - first-party analytics + phone_verified
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.page_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  path TEXT NOT NULL,
  referrer TEXT,
  session_id TEXT,
  device_type TEXT NOT NULL DEFAULT 'desktop',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_page_views_created_at
  ON public.page_views(created_at);
CREATE INDEX IF NOT EXISTS idx_page_views_session
  ON public.page_views(session_id);

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT true;

-- ---------------------------------------------------------------------------
-- 010 - invoice delivery + Shiprocket push bookkeeping
-- ---------------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS invoice_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invoice_error TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_invoice_sent_at
  ON public.orders(invoice_sent_at) WHERE invoice_sent_at IS NOT NULL;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS shiprocket_push_status VARCHAR(30),
  ADD COLUMN IF NOT EXISTS shiprocket_push_error TEXT,
  ADD COLUMN IF NOT EXISTS shiprocket_pushed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS shiprocket_push_started_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_shiprocket_push_status
  ON public.orders(shiprocket_push_status);
CREATE INDEX IF NOT EXISTS idx_orders_shiprocket_pushed_at
  ON public.orders(shiprocket_pushed_at) WHERE shiprocket_pushed_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 011 - admin columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.blogs
  ADD COLUMN IF NOT EXISTS featured_image TEXT,
  ADD COLUMN IF NOT EXISTS seo_metadata JSONB DEFAULT '{}'::jsonb;

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS image TEXT,
  ADD COLUMN IF NOT EXISTS banner TEXT;

ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS ticket_number VARCHAR(50),
  ADD COLUMN IF NOT EXISTS reply TEXT;
CREATE INDEX IF NOT EXISTS idx_support_tickets_ticket_number
  ON public.support_tickets(ticket_number);

-- ---------------------------------------------------------------------------
-- 012 - GST invoice number sequence
-- ---------------------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS invoice_number TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_invoice_number
  ON public.orders(invoice_number) WHERE invoice_number IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.invoice_sequences (
  fy TEXT PRIMARY KEY,
  last_value BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'assign_invoice_number: order % not found', p_order_id;
  END IF;

  IF v_existing IS NOT NULL AND v_existing <> '' THEN
    RETURN v_existing;
  END IF;

  v_start_year := EXTRACT(YEAR FROM NOW())::INT
    + CASE WHEN EXTRACT(MONTH FROM NOW()) >= 4 THEN 0 ELSE -1 END;
  v_fy := TO_CHAR(v_start_year, 'YY') || '-' || TO_CHAR(v_start_year + 1, 'YY');

  INSERT INTO public.invoice_sequences (fy, last_value)
  VALUES (v_fy, 1)
  ON CONFLICT (fy) DO UPDATE
    SET last_value = invoice_sequences.last_value + 1,
        updated_at = NOW()
  RETURNING last_value INTO v_seq;

  v_number := 'MV/' || v_fy || '/' || LPAD(v_seq::TEXT, 6, '0');

  UPDATE public.orders
  SET invoice_number = v_number
  WHERE id = p_order_id;

  RETURN v_number;
END;
$$;

-- ---------------------------------------------------------------------------
-- 013 - first-party e-commerce events
-- ---------------------------------------------------------------------------
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
  ON public.analytics_events(created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_events_name_created
  ON public.analytics_events(event_name, created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_events_product
  ON public.analytics_events(product_id)
  WHERE product_id IS NOT NULL;

COMMIT;

-- =============================================================================
-- VERIFY (run separately)
-- =============================================================================
-- SELECT table_name FROM information_schema.tables
--  WHERE table_schema='public'
--    AND table_name IN ('whatsapp_message_log','review_requests','page_views',
--                       'analytics_events','invoice_sequences')
--  ORDER BY table_name;                                  -- expect 5 rows
--
-- SELECT table_name, column_name FROM information_schema.columns
--  WHERE table_schema='public' AND (
--        (table_name='orders' AND column_name IN
--          ('delivered_at','invoice_sent_at','invoice_error','invoice_number',
--           'shiprocket_push_status','shiprocket_push_error',
--           'shiprocket_pushed_at','shiprocket_push_started_at'))
--     OR (table_name='users' AND column_name IN
--          ('address','last_login_at','phone_verified'))
--     OR (table_name='reviews' AND column_name IN ('is_featured','reply'))
--     OR (table_name='support_tickets' AND column_name IN ('ticket_number','reply'))
--     OR (table_name='otps' AND column_name IN ('consumed_at','max_attempts'))
--  ) ORDER BY table_name, column_name;
--
-- SELECT proname FROM pg_proc WHERE proname='assign_invoice_number';
-- SELECT invoice_number, COUNT(*) FROM public.orders
--  WHERE invoice_number IS NOT NULL GROUP BY 1 HAVING COUNT(*) > 1; -- 0 rows
