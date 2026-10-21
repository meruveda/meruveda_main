-- The orders table's user_id must be nullable to support isolated sessions
-- (when the number already existed, the session is not attached to that account)
ALTER TABLE public.orders
  ALTER COLUMN user_id DROP NOT NULL;