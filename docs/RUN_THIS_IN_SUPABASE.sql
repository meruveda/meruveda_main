-- =============================================================================
-- RUN_THIS_IN_SUPABASE.sql
--
-- Combined, idempotent migration for invoice automation.
-- Paste the ENTIRE file into the Supabase SQL Editor and run.
-- Safe to run multiple times — every statement uses IF NOT EXISTS / IF EXISTS /
-- CREATE OR REPLACE / ON CONFLICT DO UPDATE.
--
-- Contents (in dependency order):
--   1. database/deltas/005_otp_whatsapp_review_requests.sql
--      — OTP tables, whatsapp_message_log, review_requests, user columns
--   2. sql/migrations/2026-10-15_invoice_automation.sql
--      — invoice columns, gapless FY sequence, atomic claim, storage bucket,
--        delivery tracking, retry bookkeeping
--   3. NOTIFY pgrst to reload the PostgREST schema cache
-- =============================================================================


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 1 — OTP, WhatsApp log, review requests (delta 005)               ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- 1. OTP codes for the WhatsApp-based checkout login (send / verify / resend / expiry).
CREATE TABLE IF NOT EXISTS public.otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(20) NOT NULL,
  code VARCHAR(10) NOT NULL,
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


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  PART 2 — Invoice automation (2026-10-15)                              ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS invoice_number TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS invoice_url TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS invoice_error TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payu_mihpayid TEXT;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS invoice_claimed_at TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS invoice_sent_at TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS invoice_allocated_at TIMESTAMPTZ;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS invoice_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS invoice_last_attempt_at TIMESTAMPTZ;

ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS invoice_whatsapp_status TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS invoice_email_status TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_invoice_number
  ON public.orders (invoice_number)
  WHERE invoice_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_orders_invoice_retry
  ON public.orders (created_at)
  WHERE invoice_sent_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_invoice_sent_at
  ON public.orders (invoice_sent_at) WHERE invoice_sent_at IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Per-financial-year counter
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.invoice_sequences (
  fy          TEXT PRIMARY KEY,
  last_value  BIGINT NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- 2b. The private invoice bucket.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('invoice', 'invoice', false, 10485760)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- ---------------------------------------------------------------------------
-- 3. whatsapp_message_log (repeated for standalone use — IF NOT EXISTS)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.whatsapp_message_log (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient      TEXT,
  template_name  TEXT,
  message_type   TEXT,
  purpose        TEXT NOT NULL,
  reference_id   TEXT,
  status         TEXT NOT NULL DEFAULT 'sent',
  error          TEXT,
  payload        JSONB DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_message_log_reference
  ON public.whatsapp_message_log (purpose, reference_id)
  WHERE reference_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. THE atomic claim + allocate step
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_invoice(p_order_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_invoice_number TEXT;
  v_claimed_at     TIMESTAMPTZ;
  v_fy             TEXT;
  v_seq            BIGINT;
  v_start_year     INT;
BEGIN
  SELECT invoice_number, invoice_claimed_at
    INTO v_invoice_number, v_claimed_at
    FROM public.orders
   WHERE id = p_order_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim_invoice: order % not found', p_order_id;
  END IF;

  IF v_claimed_at IS NOT NULL THEN
    RETURN NULL;
  END IF;

  IF v_invoice_number IS NOT NULL AND v_invoice_number <> '' THEN
    UPDATE public.orders
       SET invoice_claimed_at = NOW(),
           invoice_error      = NULL
     WHERE id = p_order_id;
    RETURN v_invoice_number;
  END IF;

  v_start_year := EXTRACT(YEAR FROM NOW())::INT
    + CASE WHEN EXTRACT(MONTH FROM NOW()) >= 4 THEN 0 ELSE -1 END;
  v_fy := TO_CHAR(v_start_year, 'YY') || '-' || TO_CHAR(v_start_year + 1, 'YY');

  INSERT INTO public.invoice_sequences (fy, last_value)
  VALUES (v_fy, 1)
  ON CONFLICT (fy) DO UPDATE
    SET last_value  = invoice_sequences.last_value + 1,
        updated_at = NOW()
  RETURNING last_value INTO v_seq;

  v_invoice_number := 'MV/' || v_fy || '/' || LPAD(v_seq::TEXT, 6, '0');

  UPDATE public.orders
     SET invoice_number       = v_invoice_number,
         invoice_claimed_at   = NOW(),
         invoice_allocated_at = NOW(),
         invoice_error        = NULL,
         invoice_attempts     = invoice_attempts + 1,
         invoice_last_attempt_at = NOW()
   WHERE id = p_order_id;

  RETURN v_invoice_number;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Release a failed claim
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_invoice_claim(
  p_order_id UUID,
  p_reason   TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.orders
     SET invoice_claimed_at = NULL,
         invoice_error      = LEFT(COALESCE(p_reason, 'invoice delivery failed'), 500)
   WHERE id = p_order_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 6. Count an attempt (retry path)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_invoice_attempt(p_order_id UUID)
RETURNS VOID
LANGUAGE sql
AS $$
  UPDATE public.orders
     SET invoice_attempts        = invoice_attempts + 1,
         invoice_last_attempt_at  = NOW()
   WHERE id = p_order_id;
$$;

-- ---------------------------------------------------------------------------
-- 7. Record the real delivery outcome
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_invoice_sent(
  p_order_id     UUID,
  p_whatsapp     TEXT DEFAULT NULL,
  p_email        TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE sql
AS $$
  UPDATE public.orders
     SET invoice_sent_at           = NOW(),
         invoice_error             = NULL,
         invoice_whatsapp_status   = COALESCE(p_whatsapp, invoice_whatsapp_status),
         invoice_email_status      = COALESCE(p_email, invoice_email_status)
   WHERE id = p_order_id;
$$;

-- ---------------------------------------------------------------------------
-- 8. Store the PDF's Supabase Storage object path
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_invoice_url(p_order_id UUID, p_url TEXT)
RETURNS VOID
LANGUAGE sql
AS $$
  UPDATE public.orders
     SET invoice_url = p_url
   WHERE id = p_order_id
     AND invoice_number IS NOT NULL;
$$;


-- ╔═══════════════════════════════════════════════════════════════════════════╗
-- ║  DONE — tell PostgREST to pick up new columns / functions              ║
-- ╚═══════════════════════════════════════════════════════════════════════════╝

NOTIFY pgrst, 'reload schema';
