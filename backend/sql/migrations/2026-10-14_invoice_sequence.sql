-- ============================================================
-- REFERENCE ONLY - NEVER APPLIED, NOT REQUIRED.
-- The invoice pipeline needs no database change. This file is kept
-- purely as historical reference for the abandoned RPC-based numbering
-- design. Do NOT run it. Nothing in the codebase depends on it.
-- ============================================================

-- =============================================================================
-- 2026-10-14 — GST invoice number sequence (unique + consecutive per FY)
--
-- Format: MV/<FY>/<6 digits>   e.g. MV/25-26/000123   (15 chars, max 16)
-- FY = Indian financial year Apr 1 – Mar 31, labeled by start year ("25-26").
--
-- Guarantees (all enforced in Postgres — no app-side max()+1):
--   * UNIQUE per order (partial unique index on orders.invoice_number).
--   * Consecutive per financial year: the counter row is taken with
--     INSERT ... ON CONFLICT DO UPDATE ... RETURNING, which holds a row lock
--     on invoice_sequences.fy for the duration of the statement — parallel
--     callers serialize and each gets the next value.
--   * Idempotent per order: assign_invoice_number() locks the order row
--     (SELECT ... FOR UPDATE) and returns the already-stored number when
--     present, so retries never consume a second number.
--   * Cancelled / failed orders consume nothing: the number is only assigned
--     when the backend actually starts generating an invoice (after the
--     invoice_sent_at claim). If an issued invoice is later cancelled, the
--     number is KEPT (never reused) — a credit note must be issued against
--     it instead (see README note; not implemented here).
--
-- Idempotent: safe to run multiple times.
-- Run AFTER backend/database/deltas/010_auto_invoice_shiprocket.sql
-- (needs the orders table; uses no delta-010 columns).
-- =============================================================================

-- 1. Column the number is persisted on (idempotent).
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS invoice_number TEXT;

-- One number per order, ever.
CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_invoice_number
  ON public.orders (invoice_number)
  WHERE invoice_number IS NOT NULL;

-- 2. Per-financial-year counter. Keyed by the FY label ("25-26").
CREATE TABLE IF NOT EXISTS public.invoice_sequences (
  fy          TEXT PRIMARY KEY,
  last_value  BIGINT NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. Atomic assign: lock the order, reuse the stored number or take the next
--    sequence value and persist it in the same transaction.
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

-- Verify afterwards:
--   SELECT * FROM public.invoice_sequences;
--   SELECT invoice_number, COUNT(*) FROM public.orders
--    WHERE invoice_number IS NOT NULL GROUP BY 1 HAVING COUNT(*) > 1;  -- must be 0 rows
