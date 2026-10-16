-- =============================================================================
-- 2026-10-15 — Invoice automation: atomic claim, gapless FY-series numbering,
--                delivery tracking and automatic retry.
--
-- !! THIS FILE HAS NEVER BEEN APPLIED TO PRODUCTION. Everything the invoice
-- !! feature needs was missing from the live schema, which is why
-- !! GET /orders/:id/invoice answered 404 "Order not found" for orders that
-- !! existed (PostgREST rejected the query with 42703 on orders.invoice_number,
-- !! the controller saw a null row, and reported it as a missing order) and why
-- !! automatic dispatch failed with nothing recorded anywhere.
--
-- Run order (all idempotent, safe to re-run):
--   1. backend/database/deltas/005_otp_whatsapp_review_requests.sql
--        creates whatsapp_message_log. INCLUDED below as a fallback, but run it
--        properly if you have not - it also owns the OTP tables.
--   2. THIS FILE.
--
-- Verify afterwards:
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='orders' AND column_name LIKE 'invoice%'
--        OR column_name = 'payu_mihpayid';
--   SELECT to_regclass('public.invoice_sequences');        -- not null
--   SELECT to_regclass('public.whatsapp_message_log');     -- not null
--   SELECT proname FROM pg_proc WHERE proname IN
--     ('claim_invoice','release_invoice_claim','record_invoice_attempt',
--      'mark_invoice_sent','set_invoice_url');
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS invoice_number TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS invoice_url TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS invoice_error TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payu_mihpayid TEXT;

-- Claim marker. Deliberately SEPARATE from invoice_sent_at:
--   invoice_claimed_at = we own this order and a number has been taken.
--   invoice_sent_at    = the document actually reached the customer.
-- The earlier draft stored the claim in invoice_sent_at, so an order whose
-- WhatsApp send then failed still looked "Sent" in the admin panel. It did not.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS invoice_claimed_at TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS invoice_sent_at TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS invoice_allocated_at TIMESTAMPTZ;

-- Retry bookkeeping. invoice_attempts caps the cron sweep at 5 tries and then
-- stops, so a permanently-broken order (bad phone number, revoked Meta token)
-- cannot be retried forever.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS invoice_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS invoice_last_attempt_at TIMESTAMPTZ;

-- Per-channel delivery outcome, so the admin card can show "WhatsApp: sent,
-- email: failed" instead of a single opaque flag.
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS invoice_whatsapp_status TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS invoice_email_status TEXT;

-- One number per order, ever.
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_invoice_number
  ON public.orders (invoice_number)
  WHERE invoice_number IS NOT NULL;

-- Drives the retry sweep: unsent, under the attempt cap, newest-first so a
-- backlog is worked from the oldest end.
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
--
-- Named 'invoice' to match the bucket the RLS migration creates (and the
-- singular 'product-image' convention). The backend's default for
-- INVOICE_STORAGE_BUCKET is 'invoice' too, so this needs no env var.
--
-- Created here as well so this file is self-contained: the RLS migration is
-- separately tracked as "not applied", and the earlier code default ('invoices')
-- matched neither, so storage was skipped in silence and orders.invoice_url
-- stayed NULL.
--
-- private = false => no anon/authenticated reads. The backend serves these files
-- with the service role and short-lived signed URLs only.
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('invoice', 'invoice', false, 10485760)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- ---------------------------------------------------------------------------
-- 3. whatsapp_message_log
--
-- Required for the once-only guarantee: wasSent()/getLogEntry() read this
-- table, and it did not exist, so the dedupe check silently returned false and
-- every trigger believed it was the first send.
--
-- Normally created by database/deltas/005_otp_whatsapp_review_requests.sql.
-- Repeated here so this migration stands alone.
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

-- The upsert in logSend() targets onConflict: 'purpose,reference_id'.
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_message_log_reference
  ON public.whatsapp_message_log (purpose, reference_id)
  WHERE reference_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 4. THE atomic claim + allocate step
-- ---------------------------------------------------------------------------
-- Returns the invoice number when this caller won the claim, or NULL when the
-- order was already claimed. The NULL is the "someone else is on it" signal
-- that makes a PayU double-POST or a parallel cron sweep harmless.
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
  -- Serialises concurrent claimers for the SAME order. Parallel PayU callbacks
  -- for one order queue here; the loser sees invoice_claimed_at already set and
  -- returns NULL.
  SELECT invoice_number, invoice_claimed_at
    INTO v_invoice_number, v_claimed_at
    FROM public.orders
   WHERE id = p_order_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim_invoice: order % not found', p_order_id;
  END IF;

  -- Already claimed: idempotent no-op. A retry, the cron sweep or a second
  -- PayU POST must not allocate a second number or send a second invoice.
  IF v_claimed_at IS NOT NULL THEN
    RETURN NULL;
  END IF;

  -- A previous attempt allocated a number and then failed. Reuse that number:
  -- a GST series must never skip or reissue.
  IF v_invoice_number IS NOT NULL AND v_invoice_number <> '' THEN
    UPDATE public.orders
       SET invoice_claimed_at = NOW(),
           invoice_error      = NULL
     WHERE id = p_order_id;
    RETURN v_invoice_number;
  END IF;

  -- Indian FY from the invoice date: April 1 - March 31, named after its start
  -- year. April 2026 -> '26-27'. March 2027 -> '26-27'. April 2027 -> '27-28'.
  v_start_year := EXTRACT(YEAR FROM NOW())::INT
    + CASE WHEN EXTRACT(MONTH FROM NOW()) >= 4 THEN 0 ELSE -1 END;
  v_fy := TO_CHAR(v_start_year, 'YY') || '-' || TO_CHAR(v_start_year + 1, 'YY');

  -- Row lock on the FY counter held until commit => gapless, no duplicates.
  INSERT INTO public.invoice_sequences (fy, last_value)
  VALUES (v_fy, 1)
  ON CONFLICT (fy) DO UPDATE
    SET last_value  = invoice_sequences.last_value + 1,
        updated_at = NOW()
  RETURNING last_value INTO v_seq;

  v_invoice_number := 'MV/' || v_fy || '/' || LPAD(v_seq::TEXT, 6, '0');

  -- Claim + number persisted in the SAME transaction as the allocation.
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
-- 5. Release a failed claim so the retry sweep can pick the order up again.
--    The allocated number is intentionally KEPT - an invoice number that has
--    been allocated must never be reused or re-issued.
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
-- 6. Count an attempt that was skipped by the claim (retry path), so the cap
--    counts real attempts rather than only first-time allocations.
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
-- 7. Record the real delivery outcome. This is the ONLY thing that sets
--    invoice_sent_at, so the admin "Sent" state means the customer got it.
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
-- 8. Store the PDF's Supabase Storage object path.
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

-- ---------------------------------------------------------------------------
-- 9. Older deployments created assign_invoice_number() / release_invoice_claim()
--    via 2026-10-14_invoice_sequence.sql. Leave them in place if present; they
--    are unused by the dispatcher, which calls claim_invoice() only.
-- ---------------------------------------------------------------------------