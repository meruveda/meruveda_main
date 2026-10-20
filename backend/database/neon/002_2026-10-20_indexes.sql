-- =============================================================================
-- 2026-10-20 Index pass (additive, idempotent)
--
-- One index set for the queries the API actually runs, plus a trigram GIN for
-- the storefront search (ILIKE '%term%' cannot use a plain btree).
-- Safe to re-run: every statement is guarded. Run in ONE transaction against
-- DATABASE_URL_UNPOOLED.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- Trigram search (products name/sku/brand, blogs title)
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_products_name_trgm
  ON public.products USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_products_sku_trgm
  ON public.products USING gin (sku gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_blogs_title_trgm
  ON public.blogs USING gin (title gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Foreign key columns get an index each: joins and child-row lookups in both
-- directions, and cheap cascade checks on DELETE.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_blogs_author_id        ON public.blogs (author_id);
CREATE INDEX IF NOT EXISTS idx_categories_parent_id   ON public.categories (parent_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id  ON public.notifications (user_id);
CREATE INDEX IF NOT EXISTS idx_order_items_product_id ON public.order_items (product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_user_id        ON public.reviews (user_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_user_id ON public.support_tickets (user_id);
CREATE INDEX IF NOT EXISTS idx_user_addresses_user_id ON public.user_addresses (user_id);

-- ---------------------------------------------------------------------------
-- Orders: the admin list and the cron sweeps filter on status + recency, then
-- payment method (reporting). One composite serves the hot path.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_orders_status_created_payment
  ON public.orders (status, created_at DESC, payment_method);

CREATE INDEX IF NOT EXISTS idx_orders_payment_method
  ON public.orders (payment_method);

-- Cron sweep for orders whose Shiprocket push is still owed.
CREATE INDEX IF NOT EXISTS idx_orders_push_pending
  ON public.orders (created_at DESC)
  WHERE shiprocket_order_id IS NULL
    AND status IN ('processing', 'confirmed', 'pending');

-- "My orders" for a user, recency-first.
CREATE INDEX IF NOT EXISTS idx_orders_user_created
  ON public.orders (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Storefront visibility filters
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_products_status_slug
  ON public.products (status, slug)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at
  ON public.activity_logs (created_at DESC);

-- ---------------------------------------------------------------------------
-- Invoices: the sequence lookup and "invoice still unsent" queue.
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_orders_invoice_unsent
  ON public.orders (created_at ASC)
  WHERE invoice_number IS NULL;

-- ---------------------------------------------------------------------------
-- OTP lookups: newest-first by phone is already idx_otps_phone_created;
-- add the verification sweep (expired/unused rows).
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_otps_created_at
  ON public.otps (created_at DESC);

COMMIT;
