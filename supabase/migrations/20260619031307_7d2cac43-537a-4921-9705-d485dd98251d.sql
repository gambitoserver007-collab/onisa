
-- 1) Add 'finanzas' to app_role enum (safe if not used in same tx)
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'finanzas';

-- 2) Add is_platform_admin column to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_platform_admin boolean NOT NULL DEFAULT false;

-- 3) Mark the SaaS owner as platform admin
UPDATE public.profiles p
SET is_platform_admin = true, updated_at = now()
FROM auth.users u
WHERE p.id = u.id
  AND lower(u.email) = 'owner@tiendaagil.test';

-- 4) Helper: is the current user a platform admin?
CREATE OR REPLACE FUNCTION public.current_user_is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_platform_admin
       FROM public.profiles
      WHERE id = auth.uid()
        AND is_active = true
        AND NOT is_demo
      LIMIT 1),
    false
  );
$$;

-- 5) Update scope helpers so cross-company access requires platform admin
CREATE OR REPLACE FUNCTION public.can_select_company(p_company_id uuid, p_is_demo_data boolean DEFAULT false)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN public.current_user_is_platform_admin() THEN true
    WHEN public.current_user_is_demo() AND public.current_user_role() = 'admin'::public.app_role
      THEN COALESCE(p_is_demo_data, false)
    WHEN public.current_user_is_demo()
      THEN p_company_id = public.current_user_company_id() AND COALESCE(p_is_demo_data, false)
    ELSE p_company_id = public.current_user_company_id()
  END;
$$;

CREATE OR REPLACE FUNCTION public.can_write_company(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND NOT public.current_user_is_demo()
    AND (
      public.current_user_is_platform_admin()
      OR p_company_id = public.current_user_company_id()
    );
$$;

-- 6) Profiles policies: replace role='admin' global access with platform admin
DROP POLICY IF EXISTS "profiles select scoped" ON public.profiles;
CREATE POLICY "profiles select scoped" ON public.profiles
FOR SELECT
USING (
  id = auth.uid()
  OR public.current_user_is_platform_admin()
  OR company_id = public.current_user_company_id()
);

DROP POLICY IF EXISTS "profiles insert admin" ON public.profiles;
CREATE POLICY "profiles insert admin" ON public.profiles
FOR INSERT
WITH CHECK (
  public.current_user_is_platform_admin()
);

DROP POLICY IF EXISTS "profiles update scoped" ON public.profiles;
CREATE POLICY "profiles update scoped" ON public.profiles
FOR UPDATE
USING (
  NOT public.current_user_is_demo()
  AND (id = auth.uid() OR public.current_user_is_platform_admin())
)
WITH CHECK (
  NOT public.current_user_is_demo()
  AND (id = auth.uid() OR public.current_user_is_platform_admin())
);

DROP POLICY IF EXISTS "profiles delete admin" ON public.profiles;
CREATE POLICY "profiles delete admin" ON public.profiles
FOR DELETE
USING (
  public.current_user_is_platform_admin()
);

-- 7) subscription_plans write policy restricted to platform admin
DROP POLICY IF EXISTS "plans write real admin" ON public.subscription_plans;
CREATE POLICY "plans write platform admin" ON public.subscription_plans
FOR ALL
USING (public.current_user_is_platform_admin())
WITH CHECK (public.current_user_is_platform_admin());
