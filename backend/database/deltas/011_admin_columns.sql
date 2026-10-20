-- 011: admin panel columns the UI already renders.
-- ADDITIVE ONLY - no existing columns, tables or constraints are modified.
-- Idempotent: safe to run multiple times.

-- Journal editor.
ALTER TABLE public.blogs ADD COLUMN IF NOT EXISTS featured_image TEXT;
ALTER TABLE public.blogs ADD COLUMN IF NOT EXISTS seo_metadata JSONB DEFAULT '{}'::jsonb;

-- Categories editor.
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS image TEXT;
ALTER TABLE public.categories ADD COLUMN IF NOT EXISTS banner TEXT;

-- Support ticket list + admin reply endpoint.
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS ticket_number VARCHAR(50);
ALTER TABLE public.support_tickets ADD COLUMN IF NOT EXISTS reply TEXT;

CREATE INDEX IF NOT EXISTS idx_support_tickets_ticket_number
  ON public.support_tickets(ticket_number);
