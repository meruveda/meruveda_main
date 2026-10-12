-- 007: mobile-number authentication support.
-- ADDITIVE ONLY — no existing columns, tables or constraints are modified.
--
-- Context: login/registration now use the mobile number as the primary
-- identifier, and the password-reset flow resolves accounts by phone as well
-- as email. The API already writes `reset_password_token` /
-- `reset_password_expires` but no earlier delta creates them, so they are
-- created here. Apply AFTER 006 (all statements are idempotent, so the file
-- can be pasted together with the earlier deltas in one Supabase SQL run).

-- 1. Password-reset token storage (single-use, 1-hour expiry enforced by the API).
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS reset_password_token TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS reset_password_expires TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_users_reset_password_token
  ON public.users(reset_password_token) WHERE reset_password_token IS NOT NULL;

-- 2. Fast mobile-number lookups for login / signup duplicate checks /
--    password recovery (users.phone holds several legacy spellings, matched
--    with IN (...) over normalized variants by the API).
CREATE INDEX IF NOT EXISTS idx_users_phone ON public.users(phone);
