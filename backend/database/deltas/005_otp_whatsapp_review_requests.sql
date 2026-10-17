-- 005: OTP login, WhatsApp delivery log and 7-day review request job.
-- ADDITIVE ONLY — no existing columns, tables or constraints are modified.

-- 1. OTP codes for the WhatsApp-based checkout login (send / verify / resend / expiry).
-- The code is NEVER stored in plaintext: `code_hash` holds HMAC-SHA256(code, pepper)
-- where the pepper is OTP_HASH_PEPPER, a server-side secret that never reaches the
-- database. A 6-digit code has only 10^6 values, so a bare SHA-256 would be
-- reversible by brute force in under a second; the pepper is what makes a leaked
-- dump useless. See src/utils/otpHash.ts.
CREATE TABLE IF NOT EXISTS public.otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone VARCHAR(20) NOT NULL,
  code_hash VARCHAR(64) NOT NULL,
  purpose VARCHAR(30) NOT NULL DEFAULT 'checkout_login',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_otps_phone ON public.otps(phone);
CREATE INDEX IF NOT EXISTS idx_otps_expires_at ON public.otps(expires_at);

-- 2. Outbound WhatsApp message log — also used to guarantee "never send twice".
CREATE TABLE IF NOT EXISTS public.whatsapp_message_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient VARCHAR(30) NOT NULL,
  template_name VARCHAR(100),
  message_type VARCHAR(30),
  purpose VARCHAR(60) NOT NULL,
  reference_id VARCHAR(100),
  status VARCHAR(30) NOT NULL DEFAULT 'sent',
  error TEXT,
  payload JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (purpose, reference_id)
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_message_log_reference ON public.whatsapp_message_log(reference_id);

-- 3. 7-day review request tracking. `order_id` UNIQUE => a request can never be queued twice.
CREATE TABLE IF NOT EXISTS public.review_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  product_id UUID REFERENCES public.products(id) ON DELETE SET NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
  sent_at TIMESTAMPTZ,
  review_id UUID,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (order_id)
);

CREATE INDEX IF NOT EXISTS idx_review_requests_status ON public.review_requests(status);

-- 4. Saved profile fields for OTP-created customers (users.email already exists).
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS address JSONB;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- 5. Row Level Security: these three tables are server-only.
--
-- They hold mobile numbers, OTP digests and outbound message history. The app
-- reaches Supabase exclusively through the backend service-role key, and no
-- browser bundle contains a Supabase client, so no end user ever needs a direct
-- policy on these tables.
--
-- Enabling RLS with NO policies is therefore the correct posture, not an
-- omission: it makes every non-service role denied, so if an anon key is ever
-- leaked or added to the frontend these tables stay unreadable. The
-- service_role key bypasses RLS, which is exactly why the backend still works.
--
-- Verify afterwards:
--   SELECT relname, relrowsecurity FROM pg_class
--    WHERE relname IN ('otps','whatsapp_message_log','review_requests');
--
-- No DROP POLICY statements are issued. These three tables are created in this
-- same transaction, so no policy can pre-exist on them; a DROP here would be a
-- statement that can never do anything and would make the bundle look
-- destructive to anyone reviewing it.
ALTER TABLE public.otps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_message_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.review_requests ENABLE ROW LEVEL SECURITY;
