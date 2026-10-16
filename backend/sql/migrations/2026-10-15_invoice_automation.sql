-- =============================================================================
-- 2026-10-15 — Invoice automation: storage URL, PayU reference, atomic
--                claim + gapless FY-series number allocation.
--
-- Run AFTER backend/sql/migrations/2026-10-14_invoice_sequence.sql.
-- Idempotent: safe to run multiple times.
--
-- What this adds
--   1. orders.invoice_url            — Supabase Storage object path of the ONE
--                                      issued PDF. The PDF is generated once
--                                      and never regenerated, so this is the
--                                      only copy the admin ever downloads.
--   2. orders.invoice_error          — last delivery failure (delta 010 has it,
--                                      repeated here so this file stands alone).
--   3. orders.payu_mihpayid          — PayU's payment reference, in its own
--                                      column. Previously it was only ever
--                                      concatenated into the free-text `notes`
--                                      field and had to be regex-parsed back
--                                      out; the invoice notes box now reads it
--                                      directly.
--   4. orders.invoice_allocated_at   — when the number was taken from the
--                                      sequence. Lets us audit gaps.
--   5. claim_invoice()               — THE atomic step: claims the order AND
--                                      allocates the number in one transaction.
--
-- Why one function instead of two calls
--   Previously the dispatcher did `UPDATE ... SET invoice_sent_at = now()
--   WHERE invoice_sent_at IS NULL` (claim) and then a separate
--   assign_invoice_number() (allocate). Two statements = two round trips = two
--   windows in which the process can die:
--     - die between claim and allocate -> the order is claimed but has NO
--       number; every retry is skipped forever, invoice never issued.
--     - die after allocate but before persist -> sequence value burned, series
--       has a gap.
--   claim_invoice() closes both: it is ONE statement inside ONE transaction.
--
-- Gapless guarantee
--   The FY counter row is taken with INSERT ... ON CONFLICT DO UPDATE ...
--   RETURNING, which holds a row lock on invoice_sequences.fy for the rest of
--   the transaction, so concurrent callers serialise and each gets the next
--   value. A number is never skipped: allocation only happens for an order
--   that will get an invoice, and the number is persisted in the same
--   transaction. If the PDF then fails to render, the number stays consumed
--   and the retry REUSES it (idempotent) — a GST series must never reissue.
--
-- FY is computed from the invoice date at allocation time, not hardcoded:
--   EXTRACT(MONTH FROM NOW()) >= 4  ->  current year starts the FY (26-27)
--   otherwise                       ->  previous year starts it
-- So an invoice generated in March 2027 is MV/26-27/..., and one generated in
-- April 2027 is MV/27-28/....
--
-- Verify afterwards:
--   SELECT invoice_number, invoice_url, payu_mihpayid, invoice_sent_at,
--          invoice_allocated_at
--     FROM public.orders
--    WHERE invoice_number IS NOT NULL
--    ORDER BY invoice_allocated_at DESC LIMIT 20;
--   -- unique + gapless:
--   SELECT invoice_number, COUNT(*) FROM public.orders
--    WHERE invoice_number IS NOT NULL GROUP BY 1 HAVING COUNT(*) > 1;
--   SELECT * FROM public.invoice_sequences;
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS invoice_number TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS invoice_url TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS invoice_error TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS payu_mihpayid TEXT;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS invoice_allocated_at TIMESTAMPTZ;
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS invoice_sent_at TIMESTAMPTZ;

-- One number per order, ever.
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_invoice_number
  ON public.orders (invoice_number)
  WHERE invoice_number IS NOT NULL;

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
-- 3. THE atomic claim + allocate step
-- ---------------------------------------------------------------------------
-- Returns the invoice number on success, or NULL when this order was already
-- claimed (idempotent no-op for PayU retries / webhook double-posts).
--
-- force = true  -> skip the claim and just return/allocate the existing number
--                 (used by the admin "Resend invoice" button, which must not
--                 burn a second number).
CREATE OR REPLACE FUNCTION public.claim_invoice(
  p_order_id UUID,
  p_force    BOOLEAN DEFAULT FALSE
)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_invoice_number TEXT;
  v_sent_at        TIMESTAMPTZ;
  v_fy             TEXT;
  v_seq            BIGINT;
  v_start_year     INT;
BEGIN
  -- Serialises concurrent claimers for the SAME order. Parallel PayU callbacks
  -- for one order queue here; the loser sees invoice_sent_at already set and
  -- returns NULL.
  SELECT invoice_number, invoice_sent_at
    INTO v_invoice_number, v_sent_at
    FROM public.orders
   WHERE id = p_order_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'claim_invoice: order % not found', p_order_id;
  END IF;

  -- Already claimed and not forced: idempotent no-op. The retry (or the cron
  -- sweep, or a second PayU POST) must not allocate a second number or send a
  -- second invoice.
  IF v_sent_at IS NOT NULL AND NOT p_force THEN
    RETURN NULL;
  END IF;

  -- Already allocated (e.g. the claim was released after a render failure):
  -- reuse the stored number, never take a second one from the series.
  IF v_invoice_number IS NOT NULL AND v_invoice_number <> '' THEN
    IF v_sent_at IS NULL OR p_force THEN
      UPDATE public.orders
         SET invoice_sent_at = COALESCE(invoice_sent_at, NOW()),
             invoice_error    = NULL
       WHERE id = p_order_id;
    END IF;
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
         invoice_sent_at      = NOW(),
         invoice_allocated_at = NOW(),
         invoice_error        = NULL
   WHERE id = p_order_id;

  RETURN v_invoice_number;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Release a failed claim so the retry sweep can pick the order up again.
--    The allocated number is intentionally KEPT — a GST invoice number that has
--    been issued must never be reused or re-issued.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_invoice_claim(p_order_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.orders
     SET invoice_sent_at = NULL,
         invoice_error   = LEFT(COALESCE(p_reason, 'invoice delivery failed'), 500)
   WHERE id = p_order_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- 5. Mark a delivered invoice's storage object path.
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
-- 6. Backfill: orders that were sent before this migration have an
--    invoice_sent_at but no invoice_url (nothing was stored back then).
--    Leave them NULL — regenerating them would reissue a tax document that was
--    already issued under the same number, which is not allowed.
-- ---------------------------------------------------------------------------
-- SELECT COUNT(*) FROM public.orders
--  WHERE invoice_sent_at IS NOT NULL AND invoice_url IS NULL;