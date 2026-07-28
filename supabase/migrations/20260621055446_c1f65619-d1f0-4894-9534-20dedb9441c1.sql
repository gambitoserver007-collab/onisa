-- Revoke anon EXECUTE on internal SECURITY DEFINER trigger helpers
REVOKE EXECUTE ON FUNCTION public.apply_country_settings_to_company() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_default_location() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.propagate_country_settings() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seed_default_units() FROM anon, PUBLIC;

-- Lock down helper functions that are exposed to anon too
REVOKE EXECUTE ON FUNCTION public.default_document_types(text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.default_tax_name(text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.default_tax_rate(text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_default_document_types() FROM anon, PUBLIC;

-- Set immutable search_path on remaining functions
ALTER FUNCTION public.default_document_types(text) SET search_path = public;
ALTER FUNCTION public.default_tax_name(text) SET search_path = public;
ALTER FUNCTION public.default_tax_rate(text) SET search_path = public;
ALTER FUNCTION public.set_default_document_types() SET search_path = public;
