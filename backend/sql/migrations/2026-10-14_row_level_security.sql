-- =============================================================================
-- 2026-10-14 — Row Level Security lockdown (defense in depth)
--
-- WHAT THIS DOES
--   1. Enables (and FORCES) RLS on every table in the public schema.
--   2. Drops any existing policy, leaving the tables DENY-ALL for anon and
--      authenticated roles. Without a policy, RLS denies every row to
--      non-privileged roles — that is the intended state here.
--   3. Normalizes storage buckets: product images public-read-only, invoices
--      private (served only via signed URLs), everything else untouched.
--
-- WHY IT IS SAFE FOR THIS APP
--   Neither the storefront nor the admin panel talks to Supabase directly —
--   both call the backend API only, which uses the SERVICE-ROLE key. The
--   service_role bypasses RLS, so every read/write the app makes keeps
--   working unchanged (verified: no NEXT_PUBLIC_SUPABASE_* variable and no
--   createClient() call outside backend/).
--
--   -> consequence: if a service-role key ever leaks, RLS does NOT protect the
--      data. Keep the key secret. This migration protects the anon/authenticated
--      surface (leaked anon key, or a future direct-client feature) — it is
--      defense in depth, not a substitute for key hygiene.
--
-- HOW TO RUN
--   Supabase SQL editor / psql, AFTER the other migrations (see
--   backend/database/README.md). Idempotent. Takes effect immediately.
--
-- BEFORE YOU RUN IT (10 seconds, worth it)
--   SELECT count(*) FROM pg_policies WHERE schemaname = 'public';
--     -> if non-zero, something was relying on those policies; drop the
--        FORCE + policy removal into a review first.
--   Verify afterwards that the admin panel and storefront still load data
--   (products, orders, customers) — they should, via the service key.
--
-- NOT COVERED
--   * Views: RLS on a table does not protect a plain (non security_invoker)
--     view built on it. Audit public views separately if you add them.
--   * Realtime / Storage object policies: storage.objects policies are set in
--     the section below, only for the two buckets the app uses.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. Enable + FORCE RLS on every public table.
--    FORCE makes the policy apply even to the table owner, so the ONLY
--    role that can still read/write is one with BYPASSRLS (service_role).
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;


-- -----------------------------------------------------------------------------
-- 2. Remove every existing policy -> deny-all for anon / authenticated.
--    (If you have re-introduced a policy on purpose later, re-add it here.)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  p RECORD;
BEGIN
  FOR p IN
    SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, p.tablename);
  END LOOP;
END $$;


-- -----------------------------------------------------------------------------
-- 3. Storage buckets
--    - product-image : public READ (product photos are served to storefront
--                     visitors via getPublicUrl), no direct writes.
--    - invoice       : PRIVATE (invoices contain customer PII; they are only
--                     reachable through backend-generated signed URLs).
-- -----------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('product-image', 'product-image', true, 10485760)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('invoice', 'invoice', false, 10485760)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- Public read on product images for everyone (anon included); writes stay with
-- the service role only, which bypasses these policies anyway.
DROP POLICY IF EXISTS "product-image public read" ON storage.objects;
CREATE POLICY "product-image public read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'product-image');

-- Invoice bucket: no policies at all = deny-all, including anon reads.
-- The backend issues short-lived signed URLs with the service role; those are
-- authorised by the service role, not by a policy, so invoices stay private.
DROP POLICY IF EXISTS "invoice public read" ON storage.objects;
DROP POLICY IF EXISTS "invoice insert" ON storage.objects;
DROP POLICY IF EXISTS "invoice select" ON storage.objects;
DROP POLICY IF EXISTS "invoice update" ON storage.objects;
DROP POLICY IF EXISTS "invoice delete" ON storage.objects;


-- =============================================================================
-- VERIFY — run after applying.
-- =============================================================================

-- 1. Every public table has RLS enabled and forced. Expect 0 rows.
-- SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
--   FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--  WHERE n.nspname = 'public' AND c.relkind = 'r'
--    AND (NOT c.relrowsecurity OR NOT c.relforcerowsecurity);

-- 2. No policies left on public tables (deny-all). Expect 0 rows.
-- SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public';

-- 3. Buckets: product-image public = true, invoice public = false.
--    Expect 2 rows: product-image|t| , invoice|f
-- SELECT id, public FROM storage.buckets WHERE id IN ('product-image', 'invoice');

-- 4. Prove the anon key is locked out (this is the real test — run it in the
--    SQL editor; it uses the anon role explicitly):
--    SET LOCAL ROLE anon;
--    SELECT count(*) FROM public.users;      -- expect 0 rows (denied by RLS),
--                                            -- NOT a permission error
--    RESET ROLE;
--
--    And that the service role still works — check in the app: load the admin
--    customers list. It must still return rows.
-- =============================================================================