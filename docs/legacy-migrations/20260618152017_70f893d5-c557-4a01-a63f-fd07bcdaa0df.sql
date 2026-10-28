
-- Fix mutable search_path on touch_updated_at
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Revoke public EXECUTE on privileged bootstrap definer functions; only service_role can call them.
REVOKE EXECUTE ON FUNCTION public.bootstrap_demo_profiles() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bootstrap_owner_profile(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_demo_profiles() TO service_role;
GRANT EXECUTE ON FUNCTION public.bootstrap_owner_profile(text) TO service_role;

-- create_sale should only be callable by signed-in users (not anon)
REVOKE EXECUTE ON FUNCTION public.create_sale(uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sale(uuid, text, text, jsonb) TO authenticated, service_role;

-- reject_demo_write and sync_profile_email_from_auth_user are trigger-only; remove public execute.
REVOKE EXECUTE ON FUNCTION public.reject_demo_write() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_profile_email_from_auth_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;
