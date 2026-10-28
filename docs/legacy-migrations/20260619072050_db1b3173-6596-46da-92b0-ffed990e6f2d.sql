-- Protect subscription/billing fields on companies from non-platform-admins
CREATE OR REPLACE FUNCTION public.protect_company_subscription_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Allow server-side (no auth) and platform admins to modify subscription
  IF auth.uid() IS NULL OR public.current_user_is_platform_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.plan_id              IS DISTINCT FROM OLD.plan_id
     OR NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
     OR NEW.expires_at          IS DISTINCT FROM OLD.expires_at
  THEN
    RAISE EXCEPTION 'Solo un administrador de la plataforma puede cambiar el plan o el estado de suscripción.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_company_subscription_guard ON public.companies;
CREATE TRIGGER enforce_company_subscription_guard
BEFORE UPDATE ON public.companies
FOR EACH ROW EXECUTE FUNCTION public.protect_company_subscription_fields();