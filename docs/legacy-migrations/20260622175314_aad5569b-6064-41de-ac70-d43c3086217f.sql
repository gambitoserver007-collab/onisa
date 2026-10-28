REVOKE EXECUTE ON FUNCTION public.dashboard_sales_totals(uuid, text)            FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.profit_report(timestamptz, timestamptz, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sales_by_category(uuid, text, timestamptz, timestamptz)        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sales_by_day(uuid, text, integer)             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sales_by_payment_method(uuid, text, timestamptz, timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sync_product_variants(uuid, text[], jsonb)    FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.dashboard_sales_totals(uuid, text)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.profit_report(timestamptz, timestamptz, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sales_by_category(uuid, text, timestamptz, timestamptz)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.sales_by_day(uuid, text, integer)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.sales_by_payment_method(uuid, text, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_product_variants(uuid, text[], jsonb)    TO authenticated;