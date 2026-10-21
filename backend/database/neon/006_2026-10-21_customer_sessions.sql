-- STEP 1/3: the customer session created at checkout.
--
-- While the storefront's password pages are switched off, the ONLY way a
-- customer identifies themselves is the checkout contact step: a name, a
-- mobile number and an email address. Pressing "Continue" creates (or
-- reuses) the customer profile and opens a long-lived session in THAT
-- browser.
--
-- The session is its own row, and that is what makes the security rule
-- possible: a session that belongs to a number which already had an account
-- is NOT linked to that account, so it cannot see the account's profile, its
-- addresses or its order history. It sees only the orders it created itself
-- (orders.session_id).
--
-- When the WhatsApp OTP is switched on and the number is verified, the
-- session is merged into the real customer (merged_into_user_id) and the
-- history becomes visible.

CREATE TABLE IF NOT EXISTS public.customer_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- NULL for a session whose number already belonged to somebody else: the
  -- session is then deliberately NOT attached to that account.
  user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  -- The account this session is merged into once the number is verified.
  merged_into_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  phone TEXT NOT NULL,
  name TEXT,
  email TEXT,
  phone_verified BOOLEAN NOT NULL DEFAULT false,
  source TEXT NOT NULL DEFAULT 'checkout',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '90 days')
);

CREATE INDEX IF NOT EXISTS customer_sessions_phone_idx ON public.customer_sessions (phone);
CREATE INDEX IF NOT EXISTS customer_sessions_user_idx ON public.customer_sessions (user_id);

-- STEP 2/3: the orders and the addresses a session created.
--
-- The session id is what scopes the history: an unverified session only ever
-- sees the rows whose session_id is its own.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES public.customer_sessions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS orders_session_idx ON public.orders (session_id);

ALTER TABLE public.user_addresses
  ADD COLUMN IF NOT EXISTS session_id UUID REFERENCES public.customer_sessions(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS user_addresses_session_idx ON public.user_addresses (session_id);

-- STEP 3/3: where the customer profile came from.
--
-- 'checkout' = created automatically at the checkout contact step.
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS source TEXT;

-- The email the customer gave at the checkout. It is the address the order
-- confirmation and the invoice go to, and it must not depend on the order
-- being linked to an account row.
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS email TEXT;
