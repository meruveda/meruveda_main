-- STEP 2/4: automation bookkeeping on orders.
--
-- The automatic Shiprocket push + invoice pipeline needs to remember, per
-- order, how far it got: how many push attempts have been made, when the next
-- one is due, whether the order was deliberately skipped, whether the store
-- owner has already been alerted about a terminal failure, and whether the
-- customer actually verified their phone.
--
-- Every column is additive and idempotent, so this file can be re-run safely.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS shiprocket_push_attempts integer NOT NULL DEFAULT 0;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS shiprocket_push_next_attempt_at timestamptz;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS shiprocket_push_skipped boolean NOT NULL DEFAULT false;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS shiprocket_push_skipped_reason text;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS shiprocket_admin_alerted_at timestamptz;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS shiprocket_tracking_polled_at timestamptz;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS phone_verified boolean;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS invoice_generated_at timestamptz;

COMMENT ON COLUMN orders.shiprocket_push_attempts IS
  'Number of Shiprocket push attempts made so far. The schedule is immediate, 5m, 15m, 1h, 6h, 24h; after 8 attempts the push is terminal-failed.';

COMMENT ON COLUMN orders.shiprocket_push_next_attempt_at IS
  'Earliest time the next automatic push attempt may run. NULL means "not scheduled".';

COMMENT ON COLUMN orders.shiprocket_push_skipped IS
  'True when the order was deliberately not pushed to Shiprocket (e.g. no Indian delivery contact). A skipped order is never a failure and is never retried.';

COMMENT ON COLUMN orders.shiprocket_push_skipped_reason IS
  'Human readable reason for the skip, shown verbatim in the admin order list.';

COMMENT ON COLUMN orders.shiprocket_admin_alerted_at IS
  'Set when the store owner has been alerted about a terminal Shiprocket failure. Guarantees the alert is sent exactly once per order.';

COMMENT ON COLUMN orders.shiprocket_tracking_polled_at IS
  'Last time the Shiprocket tracking of this order was polled, so the sweep can rate-limit itself.';

COMMENT ON COLUMN orders.phone_verified IS
  'True when the customer proved ownership of the delivery phone with an OTP. NULL means the order predates phone verification (or the phone was never checked).';

COMMENT ON COLUMN orders.invoice_generated_at IS
  'When the tax invoice PDF was generated for this order.';

-- The sweep looks for orders whose next attempt is due; without an index it
-- would scan the whole table on every run.
CREATE INDEX IF NOT EXISTS idx_orders_push_due
  ON orders (shiprocket_push_next_attempt_at)
  WHERE shiprocket_order_id IS NULL AND shiprocket_push_skipped = false;

-- Polling candidates: pushed orders that are not delivered yet.
CREATE INDEX IF NOT EXISTS idx_orders_tracking_poll
  ON orders (shiprocket_tracking_polled_at)
  WHERE shiprocket_order_id IS NOT NULL AND status <> 'delivered';
