-- 1) profile_locations: add INSERT/UPDATE/DELETE policies for same-company admins
CREATE POLICY "profile_locations_insert_admin"
  ON public.profile_locations
  FOR INSERT
  TO authenticated
  WITH CHECK (public.can_admin_company(company_id));

CREATE POLICY "profile_locations_update_admin"
  ON public.profile_locations
  FOR UPDATE
  TO authenticated
  USING (public.can_admin_company(company_id))
  WITH CHECK (public.can_admin_company(company_id));

CREATE POLICY "profile_locations_delete_admin"
  ON public.profile_locations
  FOR DELETE
  TO authenticated
  USING (public.can_admin_company(company_id));

-- 2) profiles: switch existing policies from {public} to {authenticated}
DROP POLICY IF EXISTS "profiles select scoped" ON public.profiles;
CREATE POLICY "profiles select scoped"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR public.current_user_is_platform_admin()
    OR (company_id = public.current_user_company_id() AND public.current_user_role() = 'admin'::public.app_role)
  );

DROP POLICY IF EXISTS "profiles insert admin" ON public.profiles;
CREATE POLICY "profiles insert admin"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.current_user_is_platform_admin()
    OR (company_id = public.current_user_company_id() AND public.current_user_role() = 'admin'::public.app_role)
  );

DROP POLICY IF EXISTS "profiles update scoped" ON public.profiles;
CREATE POLICY "profiles update scoped"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    id = auth.uid()
    OR public.current_user_is_platform_admin()
    OR (company_id = public.current_user_company_id() AND public.current_user_role() = 'admin'::public.app_role)
  )
  WITH CHECK (
    id = auth.uid()
    OR public.current_user_is_platform_admin()
    OR (company_id = public.current_user_company_id() AND public.current_user_role() = 'admin'::public.app_role)
  );

DROP POLICY IF EXISTS "profiles delete admin" ON public.profiles;
CREATE POLICY "profiles delete admin"
  ON public.profiles
  FOR DELETE
  TO authenticated
  USING (
    public.current_user_is_platform_admin()
    OR (company_id = public.current_user_company_id() AND public.current_user_role() = 'admin'::public.app_role)
  );

-- 3) subscription_plans: switch write policy from {public} to {authenticated}
DROP POLICY IF EXISTS "plans write platform admin" ON public.subscription_plans;
CREATE POLICY "plans write platform admin"
  ON public.subscription_plans
  FOR ALL
  TO authenticated
  USING (public.current_user_is_platform_admin())
  WITH CHECK (public.current_user_is_platform_admin());
