-- 1. Create Banners table
CREATE TABLE IF NOT EXISTS public.banners (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    heading TEXT NOT NULL,
    subheading TEXT,
    cta_text TEXT DEFAULT 'Shop Now',
    cta_link TEXT DEFAULT '/products',
    image_url TEXT NOT NULL,
    display_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.banners ENABLE ROW LEVEL SECURITY;

-- Create policy to allow public read access
CREATE POLICY "Allow public read access" ON public.banners
    FOR SELECT USING (true);

-- Create policy to allow all actions for service_role (Admin API)
CREATE POLICY "Allow service_role full access" ON public.banners
    FOR ALL TO service_role USING (true) WITH CHECK (true);
