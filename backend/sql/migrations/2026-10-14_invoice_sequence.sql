-- =============================================================================
-- GST invoice number sequence (MV/<FY>/<6 digits>, e.g. MV/25-26/000123).
--
-- ADDITIVE ONLY. Idempotent. No existing column, table, constraint or row is
-- modified or dropped.
--
-- The counter is assigned atomically in Postgres by assign_invoice_number():
-- the order row is locked, an existing number is returned unchanged
-- (idempotent per order, so retries never consume a second number), otherwise
-- the next per-financial-year value is taken under the invoice_sequences row
-- lock. There is no app-side max()+1.
--
-- Cancelled/failed orders consume nothing: the backend only calls the function
-- once an invoice is actually being generated.
-- =============================================================================

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
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'assign_invoice_number: order % not found', p_order_id;
  END IF;

  IF v_existing IS NOT NULL AND v_existing <> '' THEN
    RETURN v_existing;
  END IF;

  -- Indian FY: Apr 1 - Mar 31; label uses the start year.
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

-- VERIFY
-- SELECT proname FROM pg_proc WHERE proname = 'assign_invoice_number';
--   -- expect 1 row
-- SELECT invoice_number, COUNT(*) FROM public.orders
--  WHERE invoice_number IS NOT NULL GROUP BY 1 HAVING COUNT(*) > 1;
--   -- expect 0 rows
