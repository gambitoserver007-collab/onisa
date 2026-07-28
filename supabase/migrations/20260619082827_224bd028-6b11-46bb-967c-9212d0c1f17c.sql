-- 1) create_sale: precio siempre del servidor
create or replace function public.create_sale(
  p_customer_id uuid,
  p_document_type text,
  p_payment_method text,
  p_items jsonb
)
returns uuid
language plpgsql security invoker set search_path = public
as $$
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
  if public.current_user_is_demo() then raise exception 'Esta accion esta deshabilitada en el Modo de Prueba.'; end if;
  v_company_id := public.current_user_company_id();
  if v_company_id is null then raise exception 'El usuario no tiene empresa asociada.'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'El carrito esta vacio.'; end if;
  select tax_rate into v_tax_rate from public.companies where id = v_company_id;
  v_tax_rate := coalesce(v_tax_rate, 0.18);
  select coalesce(name, 'Publico general') into v_customer_name
  from public.customers where id = p_customer_id and company_id = v_company_id and deleted_at is null;
  v_customer_name := coalesce(v_customer_name, 'Publico general');
  v_sale_number := 'V-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item ->> 'qty')::numeric, 0);
    if v_qty <= 0 then raise exception 'Cantidad invalida.'; end if;
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

revoke execute on function public.create_sale(uuid, text, text, jsonb) from public, anon;
grant execute on function public.create_sale(uuid, text, text, jsonb) to authenticated, service_role;

-- 2) Anti escalada de privilegios en profiles
create or replace function public.protect_profile_sensitive_columns()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or public.current_user_is_platform_admin() then
    return new;
  end if;
  if new.role is distinct from old.role
     or new.is_platform_admin is distinct from old.is_platform_admin
     or new.company_id is distinct from old.company_id
     or new.is_demo is distinct from old.is_demo
     or new.demo_mode is distinct from old.demo_mode
     or new.is_active is distinct from old.is_active
  then
    raise exception 'No tienes permiso para modificar campos protegidos del perfil.';
  end if;
  return new;
end;
$$;

revoke execute on function public.protect_profile_sensitive_columns() from public, anon, authenticated;

drop trigger if exists protect_profile_sensitive_columns on public.profiles;
create trigger protect_profile_sensitive_columns
  before update on public.profiles
  for each row execute function public.protect_profile_sensitive_columns();

-- 3) Helpers de RLS solo para authenticated
revoke execute on function public.current_user_role() from public, anon;
grant  execute on function public.current_user_role() to authenticated;

revoke execute on function public.current_user_company_id() from public, anon;
grant  execute on function public.current_user_company_id() to authenticated;

revoke execute on function public.current_user_is_demo() from public, anon;
grant  execute on function public.current_user_is_demo() to authenticated;

revoke execute on function public.current_user_is_platform_admin() from public, anon;
grant  execute on function public.current_user_is_platform_admin() to authenticated;

revoke execute on function public.can_select_company(uuid, boolean) from public, anon;
grant  execute on function public.can_select_company(uuid, boolean) to authenticated;

revoke execute on function public.can_write_company(uuid) from public, anon;
grant  execute on function public.can_write_company(uuid) to authenticated;
