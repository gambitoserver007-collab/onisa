
-- 1) companies.logo_url
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS logo_url text;

-- 2) platform_settings table
CREATE TABLE IF NOT EXISTS public.platform_settings (
  id uuid PRIMARY KEY,
  brand_name text NOT NULL DEFAULT 'Tienda Ágil',
  logo_url text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.platform_settings TO authenticated;
GRANT UPDATE ON public.platform_settings TO authenticated;
GRANT ALL ON public.platform_settings TO service_role;

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

INSERT INTO public.platform_settings (id, brand_name, logo_url)
VALUES ('00000000-0000-4000-8000-0000000000a1', 'Tienda Ágil', NULL)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "platform_settings select authenticated" ON public.platform_settings;
CREATE POLICY "platform_settings select authenticated"
  ON public.platform_settings FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "platform_settings update platform admin" ON public.platform_settings;
CREATE POLICY "platform_settings update platform admin"
  ON public.platform_settings FOR UPDATE
  TO authenticated
  USING (public.current_user_is_platform_admin())
  WITH CHECK (public.current_user_is_platform_admin());

DROP TRIGGER IF EXISTS touch_platform_settings_updated_at ON public.platform_settings;
CREATE TRIGGER touch_platform_settings_updated_at
  BEFORE UPDATE ON public.platform_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
