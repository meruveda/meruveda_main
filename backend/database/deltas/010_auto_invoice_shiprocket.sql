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
