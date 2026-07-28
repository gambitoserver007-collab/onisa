
create or replace function public.adjust_stock(
  p_product_id uuid,
  p_location_id uuid,
  p_qty numeric,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_company_id uuid;
  v_role public.app_role;
  v_product public.products%rowtype;
  v_row_id uuid;
  v_current numeric(12,3);
  v_next numeric(12,3);
  v_qty numeric(12,3) := round(p_qty::numeric, 3);
  v_total numeric(12,3);
begin
  if auth.uid() is null then raise exception 'No autenticado.'; end if;
  if public.current_user_is_demo() then
    raise exception 'Esta accion esta deshabilitada en el Modo de Prueba.';
  end if;

  v_company_id := public.current_user_company_id();
  if v_company_id is null then raise exception 'El usuario no tiene empresa asociada.'; end if;

  v_role := public.current_user_role();
  if v_role not in ('admin','operador','finanzas') then
    raise exception 'No tienes permiso para ajustar inventario.';
  end if;

  if v_qty = 0 then raise exception 'Ingresa una cantidad distinta de cero (usa negativos para descontar).'; end if;

  select * into v_product from public.products
    where id = p_product_id and company_id = v_company_id and deleted_at is null;
  if not found then raise exception 'Producto no encontrado.'; end if;
  if v_product.has_variants then
    raise exception 'Este producto tiene variantes. Usa el editor de variantes para ajustar stock.';
  end if;

  perform 1 from public.locations where id = p_location_id and company_id = v_company_id;
  if not found then raise exception 'Sucursal invalida.'; end if;
  if not public.user_can_access_location(p_location_id) then
    raise exception 'No tienes acceso a esta sucursal.';
  end if;

  select id, stock into v_row_id, v_current
  from public.product_locations
  where product_id = p_product_id and location_id = p_location_id
  for update;

  if v_row_id is null then
    v_current := 0;
    v_next := v_qty;
    if v_next < 0 then raise exception 'El ajuste dejaria el stock en negativo.'; end if;
    insert into public.product_locations (company_id, product_id, location_id, stock, is_active)
    values (v_company_id, p_product_id, p_location_id, v_next, true);
  else
    v_next := v_current + v_qty;
    if v_next < 0 then raise exception 'El ajuste dejaria el stock en negativo.'; end if;
    update public.product_locations
      set stock = v_next, is_active = true, updated_at = now()
      where id = v_row_id;
  end if;

  insert into public.stock_movements (company_id, location_id, product_id,
                                      movement_type, qty, reference_type, notes)
  values (v_company_id, p_location_id, p_product_id, 'adjustment', v_qty,
          'adjustment', coalesce(nullif(btrim(coalesce(p_notes,'')),''), 'Ajuste manual'));

  select coalesce(sum(stock),0) into v_total
  from public.product_locations
  where product_id = p_product_id and is_active = true;

  update public.products set stock = v_total, updated_at = now()
  where id = p_product_id;

  return jsonb_build_object(
    'product_id', p_product_id,
    'location_id', p_location_id,
    'location_stock', v_next,
    'product_total', v_total
  );
end;
$$;

create or replace function public.transfer_stock(
  p_product_id uuid,
  p_from_location uuid,
  p_to_location uuid,
  p_qty numeric,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_company_id uuid;
  v_role public.app_role;
  v_product public.products%rowtype;
  v_from_id uuid;
  v_from_stock numeric(12,3);
  v_to_id uuid;
  v_to_stock numeric(12,3);
  v_first uuid; v_second uuid;
  v_qty numeric(12,3) := round(p_qty::numeric, 3);
  v_total numeric(12,3);
begin
  if auth.uid() is null then raise exception 'No autenticado.'; end if;
  if public.current_user_is_demo() then
    raise exception 'Esta accion esta deshabilitada en el Modo de Prueba.';
  end if;

  v_company_id := public.current_user_company_id();
  if v_company_id is null then raise exception 'El usuario no tiene empresa asociada.'; end if;

  v_role := public.current_user_role();
  if v_role not in ('admin','operador','finanzas') then
    raise exception 'No tienes permiso para transferir inventario.';
  end if;

  if not (v_qty > 0) then raise exception 'Ingresa una cantidad mayor a cero.'; end if;
  if p_from_location is null or p_to_location is null then
    raise exception 'Elige sucursal origen y destino.';
  end if;
  if p_from_location = p_to_location then
    raise exception 'Origen y destino deben ser distintos.';
  end if;

  select * into v_product from public.products
    where id = p_product_id and company_id = v_company_id and deleted_at is null;
  if not found then raise exception 'Producto no encontrado.'; end if;
  if v_product.has_variants then
    raise exception 'Este producto tiene variantes. Transfiere por variante.';
  end if;

  perform 1 from public.locations where id = p_from_location and company_id = v_company_id;
  if not found then raise exception 'Sucursal origen invalida.'; end if;
  perform 1 from public.locations where id = p_to_location and company_id = v_company_id;
  if not found then raise exception 'Sucursal destino invalida.'; end if;

  if p_from_location < p_to_location then
    v_first := p_from_location; v_second := p_to_location;
  else
    v_first := p_to_location; v_second := p_from_location;
  end if;

  perform 1 from public.product_locations
    where product_id = p_product_id and location_id = v_first for update;
  perform 1 from public.product_locations
    where product_id = p_product_id and location_id = v_second for update;

  select id, stock into v_from_id, v_from_stock
  from public.product_locations
  where product_id = p_product_id and location_id = p_from_location;
  if v_from_id is null or coalesce(v_from_stock,0) < v_qty then
    raise exception 'No hay suficiente stock en la sucursal de origen.';
  end if;

  select id, stock into v_to_id, v_to_stock
  from public.product_locations
  where product_id = p_product_id and location_id = p_to_location;

  update public.product_locations
    set stock = v_from_stock - v_qty, updated_at = now()
    where id = v_from_id;

  if v_to_id is null then
    insert into public.product_locations (company_id, product_id, location_id, stock, is_active)
    values (v_company_id, p_product_id, p_to_location, v_qty, true);
    v_to_stock := v_qty;
  else
    update public.product_locations
      set stock = coalesce(v_to_stock,0) + v_qty, is_active = true, updated_at = now()
      where id = v_to_id;
    v_to_stock := coalesce(v_to_stock,0) + v_qty;
  end if;

  insert into public.stock_movements (company_id, location_id, product_id,
                                      movement_type, qty, reference_type, notes)
  values
    (v_company_id, p_from_location, p_product_id, 'transfer_out', -v_qty,
     'transfer', coalesce(nullif(btrim(coalesce(p_notes,'')),''), 'Transferencia entre sucursales')),
    (v_company_id, p_to_location, p_product_id, 'transfer_in', v_qty,
     'transfer', coalesce(nullif(btrim(coalesce(p_notes,'')),''), 'Transferencia entre sucursales'));

  select coalesce(sum(stock),0) into v_total
  from public.product_locations
  where product_id = p_product_id and is_active = true;

  update public.products set stock = v_total, updated_at = now()
  where id = p_product_id;

  return jsonb_build_object(
    'product_id', p_product_id,
    'from_stock', v_from_stock - v_qty,
    'to_stock', v_to_stock,
    'product_total', v_total
  );
end;
$$;
