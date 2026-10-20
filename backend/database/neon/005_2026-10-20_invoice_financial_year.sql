-- STEP 2/4: the invoice number must carry the financial year.
--
-- TO_CHAR(year::int, 'YY') does NOT return the two-digit year: the integer
-- overload of to_char() has no year pattern, so it emits the mask verbatim.
-- Every invoice issued so far therefore reads "MV/YY-YY/000004" instead of
-- "MV/26-27/000004" - the GST series did not name the financial year.
--
-- The financial year is computed arithmetically instead: the year that
-- contains the month, and the next one (April to March).
--
-- The rows already issued are corrected, and the sequence keeps its counter so
-- the series stays continuous.
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

  -- The Indian financial year runs April to March: April-December belongs to
  -- the year it starts in, January-March to the year before.
  v_start_year := EXTRACT(YEAR FROM NOW())::INT
    + CASE WHEN EXTRACT(MONTH FROM NOW()) >= 4 THEN 0 ELSE -1 END;
  v_fy := LPAD((v_start_year % 100)::TEXT, 2, '0')
       || '-'
       || LPAD(((v_start_year + 1) % 100)::TEXT, 2, '0');

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

-- Move the counter that was written under the broken label onto the real
-- financial year, so the series continues where it left off.
DO $$
DECLARE
  v_start_year INT;
  v_fy TEXT;
  v_old TEXT := 'YY-YY';
  v_old_last BIGINT;
  v_fy_last BIGINT;
BEGIN
  v_start_year := EXTRACT(YEAR FROM NOW())::INT
    + CASE WHEN EXTRACT(MONTH FROM NOW()) >= 4 THEN 0 ELSE -1 END;
  v_fy := LPAD((v_start_year % 100)::TEXT, 2, '0')
       || '-'
       || LPAD(((v_start_year + 1) % 100)::TEXT, 2, '0');

  SELECT last_value INTO v_old_last FROM public.invoice_sequences WHERE fy = v_old;
  IF v_old_last IS NOT NULL THEN
    SELECT last_value INTO v_fy_last FROM public.invoice_sequences WHERE fy = v_fy;
    IF v_fy_last IS NULL THEN
      -- The real financial year has no row yet: rename the broken one.
      UPDATE public.invoice_sequences SET fy = v_fy, updated_at = NOW() WHERE fy = v_old;
    ELSE
      -- Both exist: keep the higher counter and retire the broken row.
      UPDATE public.invoice_sequences
         SET last_value = GREATEST(last_value, v_old_last), updated_at = NOW()
       WHERE fy = v_fy;
      UPDATE public.invoice_sequences
         SET fy = 'retired-' || v_old, updated_at = NOW()
       WHERE fy = v_old;
    END IF;
  END IF;

  -- Correct the invoice numbers that were already issued.
  UPDATE public.orders
     SET invoice_number = 'MV/' || v_fy || '/' || substring(invoice_number from '([0-9]{6})$')
   WHERE invoice_number LIKE 'MV/YY-YY/%'
     AND invoice_number ~ 'MV/YY-YY/[0-9]{6}$';
END;
$$;
