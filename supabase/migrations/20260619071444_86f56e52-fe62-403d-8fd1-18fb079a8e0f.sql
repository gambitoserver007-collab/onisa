-- 1) Protect sensitive profile columns from self-escalation
CREATE OR REPLACE FUNCTION public.protect_profile_sensitive_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.current_user_is_platform_admin() THEN
    RETURN NEW;
  END IF;
  IF NEW.role              IS DISTINCT FROM OLD.role
     OR NEW.is_platform_admin IS DISTINCT FROM OLD.is_platform_admin
     OR NEW.company_id     IS DISTINCT FROM OLD.company_id
     OR NEW.is_demo        IS DISTINCT FROM OLD.is_demo
     OR NEW.demo_mode      IS DISTINCT FROM OLD.demo_mode
     OR NEW.is_active      IS DISTINCT FROM OLD.is_active
  THEN
    RAISE EXCEPTION 'No tienes permiso para modificar campos protegidos del perfil.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.protect_profile_sensitive_columns() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS protect_profile_sensitive_columns ON public.profiles;
CREATE TRIGGER protect_profile_sensitive_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_sensitive_columns();

-- 2) create_sale: always use server-side price
CREATE OR REPLACE FUNCTION public.create_sale(
  p_customer_id uuid,
  p_document_type text,
  p_payment_method text,
  p_items jsonb
)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
declare
  v_company_id uuid;
  v_tax_rate numeric(5, 4);
  v_sale_id uuid;
  v_customer_name text;
  v_item jsonb;
  v_product public.products%rowtype;
  v_qty numeric(12, 3);
  v_price numeric(12, 2);
  v_total numeric(12, 2) := 0;
  v_subtotal numeric(12, 2);
  v_tax numeric(12, 2);
  v_sale_number text;
begin
  if auth.uid() is null then raise exception 'No autenticado.'; end if;
  if public.current_user_is_demo() then raise exception 'Esta acción está deshabilitada en el Modo de Prueba.'; end if;
  v_company_id := public.current_user_company_id();
  if v_company_id is null then raise exception 'El usuario no tiene empresa asociada.'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'El carrito está vacío.'; end if;
  select tax_rate into v_tax_rate from public.companies where id = v_company_id;
  v_tax_rate := coalesce(v_tax_rate, 0.18);
  select coalesce(name, 'Publico general') into v_customer_name
  from public.customers where id = p_customer_id and company_id = v_company_id and deleted_at is null;
  v_customer_name := coalesce(v_customer_name, 'Publico general');
  v_sale_number := 'V-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item ->> 'qty')::numeric, 0);
    if v_qty <= 0 then raise exception 'Cantidad inválida.'; end if;
    select * into v_product from public.products
      where id = (v_item ->> 'product_id')::uuid and company_id = v_company_id
      and deleted_at is null and active = true for update;
    if not found then raise exception 'Producto no encontrado.'; end if;
    if v_product.stock < v_qty then raise exception 'Stock insuficiente para %.', v_product.name; end if;
    v_price := v_product.price;
    v_total := v_total + round(v_qty * v_price, 2);
  end loop;

  v_subtotal := round(v_total / (1 + v_tax_rate), 2);
  v_tax := round(v_total - v_subtotal, 2);

  insert into public.sales (company_id, customer_id, sale_number, document_type, payment_method, customer_name, subtotal, tax, total, created_by)
  values (v_company_id, p_customer_id, v_sale_number, coalesce(p_document_type, 'Ticket'), coalesce(p_payment_method, 'Efectivo'), v_customer_name, v_subtotal, v_tax, v_total, auth.uid())
  returning id into v_sale_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item ->> 'qty')::numeric, 0);
    select * into v_product from public.products
      where id = (v_item ->> 'product_id')::uuid and company_id = v_company_id for update;
    v_price := v_product.price;
    insert into public.sale_items (company_id, sale_id, product_id, product_name, qty, unit_price, total, cost)
    values (v_company_id, v_sale_id, v_product.id, v_product.name, v_qty, v_price, round(v_qty * v_price, 2), v_product.cost);
    update public.products set stock = stock - v_qty where id = v_product.id;
    insert into public.stock_movements (company_id, product_id, movement_type, qty, reference_type, reference_id, notes)
    values (v_company_id, v_product.id, 'sale', -v_qty, 'sale', v_sale_id, 'Venta POS');
  end loop;
  return v_sale_id;
end;
$$;

REVOKE EXECUTE ON FUNCTION public.create_sale(uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_sale(uuid, text, text, jsonb) TO authenticated, service_role;

-- 3) Restrict RLS helper functions from anon
REVOKE EXECUTE ON FUNCTION public.current_user_role()             FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.current_user_role()             TO authenticated;
REVOKE EXECUTE ON FUNCTION public.current_user_company_id()       FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.current_user_company_id()       TO authenticated;
REVOKE EXECUTE ON FUNCTION public.current_user_is_demo()          FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.current_user_is_demo()          TO authenticated;
REVOKE EXECUTE ON FUNCTION public.current_user_is_platform_admin() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.current_user_is_platform_admin() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.can_select_company(uuid, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_select_company(uuid, boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.can_write_company(uuid)         FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_write_company(uuid)         TO authenticated;