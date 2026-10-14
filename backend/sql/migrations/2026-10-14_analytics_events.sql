-- =============================================================================
-- 2026-10-14 — First-party e-commerce events
--
-- Why: page_views (delta 009) only answers "who saw which page". The admin
-- Analytics page also needs a funnel — product views -> add to cart -> checkout
-- started -> purchase — plus top products viewed and a COD vs PayU split.
--
-- What: one append-only events table. No PII is stored (the storefront scrubs
-- params before sending and this endpoint re-validates them): only the event
-- name, the path, the random session id, an optional product/order reference,
-- and the value.
--
-- Guards: the endpoint answers 204 while the table is missing, so the
-- storefront keeps working before the migration is applied.
--
-- Idempotent. Run AFTER the invoice_sequence / RLS migrations, or any time —
-- it only touches this new table.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- GA4/Meta-style names, stored verbatim: view_item, view_item_list,
  -- add_to_cart, remove_from_cart, begin_checkout, add_shipping_info,
  -- add_payment_info, purchase. No CHECK so a new event needs no migration.
  event_name VARCHAR(40) NOT NULL,
  -- Page path at the time of the event (query string stripped by the API).
  path VARCHAR(200),
  -- Random per-browser-session id (same one page_views uses). Not a user id.
  session_id VARCHAR(64),
  -- Product / order references, both UUIDs. Nullable: not every event has one.
  product_id UUID,
  order_id UUID,
  -- Revenue in minor-unit rupees (the storefront sends rupees; we store the
  -- numeric value as sent) — kept numeric for straightforward aggregation.
  value NUMERIC(12, 2),
  currency VARCHAR(3) DEFAULT 'INR',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- The admin funnel counts events per name over a date range.
CREATE INDEX IF NOT EXISTS idx_analytics_events_created_at
  ON public.analytics_events (created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_events_name_created
  ON public.analytics_events (event_name, created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_events_product
  ON public.analytics_events (product_id)
  WHERE product_id IS NOT NULL;

-- =============================================================================
-- VERIFY — run after applying.
-- =============================================================================

-- SELECT table_name FROM information_schema.tables
--   WHERE table_name = 'analytics_events';
--   -- expect 1 row

-- SELECT event_name, COUNT(*) FROM public.analytics_events
--   GROUP BY 1 ORDER BY 2 DESC;
--   -- view_item / add_to_cart / begin_checkout / purchase once the storefront
--   --  is live. Empty is normal until the migration is applied AND traffic
--   --  arrives.

-- Data retention note: this table grows one row per tracked interaction. At
-- storefront volumes that is small, but consider a periodic delete of rows
-- older than ~18 months if it ever gets large.
-- =============================================================================