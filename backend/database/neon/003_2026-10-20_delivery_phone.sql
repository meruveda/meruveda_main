-- STEP 3: delivery_phone on orders.
-- Today the delivery phone only lives inside shipping_address->>'phone' (jsonb).
-- Shiprocket push, track lookup, and invoice WhatsApp all read that jsonb key.
-- A dedicated column makes it queryable, indexed and stable even when the
-- address json is edited later, and lets a non-Indian country code be stored
-- without touching the address blob.
ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_phone text;

COMMENT ON COLUMN orders.delivery_phone IS
  'E.164-ish digits-only phone for delivery (country code + national number), e.g. 919876543210. Preferred over shipping_address->>phone by Shiprocket push and tracking.';

-- Backfill from the existing address json so old orders keep working.
UPDATE orders
   SET delivery_phone = COALESCE(shipping_address->>'phone', billing_address->>'phone')
 WHERE delivery_phone IS NULL
   AND (shipping_address->>'phone' IS NOT NULL OR billing_address->>'phone' IS NOT NULL);
