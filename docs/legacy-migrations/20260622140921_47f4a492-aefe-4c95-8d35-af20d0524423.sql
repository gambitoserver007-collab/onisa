
create or replace function public.create_purchase(
  p_supplier_id uuid,
  p_document_number text,
  p_date timestamptz,
  p_location_id uuid,
  p_items jsonb
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_company_id uuid;
  v_location_id uuid;
  v_purchase_id uuid;
  v_purchase_number text;
  v_item jsonb;
  v_product public.products%rowtype;
  v_variant public.product_variants%rowtype;
  v_variant_id uuid;
  v_qty numeric(12,3);
  v_unit_cost numeric(12,2);
  v_line_total numeric(12,2);
  v_total numeric(12,2) := 0;
begin
  if auth.uid() is null then raise exception 'No autenticado.'; end if;
  if public.current_user_is_demo() then
    raise exception 'Esta accion esta deshabilitada en el Modo de Prueba.';
  end if;

  v_company_id := public.current_user_company_id();
  if v_company_id is null then raise exception 'El usuario no tiene empresa asociada.'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Agrega al menos un producto a la compra.';
  end if;

  v_location_id := p_location_id;
  if v_location_id is null then
    select location_id into v_location_id from public.profiles where id = auth.uid();
  end if;
  if v_location_id is null then
    select id into v_location_id from public.locations
      where company_id = v_company_id and deleted_at is null
      order by created_at limit 1;
  end if;
  if v_location_id is null then raise exception 'No hay punto de venta configurado.'; end if;

  -- Validate location belongs to company
  perform 1 from public.locations where id = v_location_id and company_id = v_company_id;
  if not found then raise exception 'Sucursal invalida.'; end if;

  -- Pre-compute total
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item ->> 'qty')::numeric, 0);
    v_unit_cost := coalesce((v_item ->> 'unit_cost')::numeric, 0);
    if v_qty <= 0 then raise exception 'La cantidad debe ser mayor a 0.'; end if;
    if v_unit_cost < 0 then raise exception 'El costo no puede ser negativo.'; end if;
    v_total := v_total + round(v_qty * v_unit_cost, 2);
  end loop;

  v_purchase_number := 'C-' || to_char(now(),'YYYYMMDD') || '-' ||
                       upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));

  insert into public.purchases (company_id, location_id, supplier_id, purchase_number,
                                document_number, purchase_date, total, status)
  values (v_company_id, v_location_id, nullif(p_supplier_id,'00000000-0000-0000-0000-000000000000'::uuid),
          v_purchase_number, nullif(btrim(coalesce(p_document_number,'')),''),
          coalesce(p_date::date, current_date), v_total, 'received')
  returning id into v_purchase_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := (v_item ->> 'qty')::numeric;
    v_unit_cost := (v_item ->> 'unit_cost')::numeric;
    v_line_total := round(v_qty * v_unit_cost, 2);

    select * into v_product from public.products
      where id = (v_item ->> 'product_id')::uuid
        and company_id = v_company_id and deleted_at is null;
    if not found then raise exception 'Producto no encontrado.'; end if;

    v_variant_id := nullif(v_item ->> 'variant_id','')::uuid;

    insert into public.purchase_items (company_id, purchase_id, product_id, product_variant_id,
                                       qty, unit_cost, total)
    values (v_company_id, v_purchase_id, v_product.id, v_variant_id, v_qty, v_unit_cost, v_line_total);

    if v_variant_id is not null then
      select * into v_variant from public.product_variants
        where id = v_variant_id and product_id = v_product.id and company_id = v_company_id
          and deleted_at is null;
      if not found then raise exception 'Variante no encontrada para %.', v_product.name; end if;

      insert into public.product_variant_locations (company_id, product_variant_id, location_id, stock)
      values (v_company_id, v_variant.id, v_location_id, v_qty)
      on conflict (product_variant_id, location_id)
        do update set stock = public.product_variant_locations.stock + excluded.stock,
                      updated_at = now();

      update public.products set stock = (
        select coalesce(sum(pvl.stock),0)
        from public.product_variant_locations pvl
        join public.product_variants pv on pv.id = pvl.product_variant_id
        where pv.product_id = v_product.id
      ), updated_at = now()
      where id = v_product.id;

      insert into public.stock_movements (company_id, location_id, product_id, product_variant_id,
                                          movement_type, qty, reference_type, reference_id, notes)
      values (v_company_id, v_location_id, v_product.id, v_variant.id, 'purchase', v_qty,
              'purchase', v_purchase_id, 'Compra ' || v_purchase_number);
    else
      insert into public.product_locations (company_id, product_id, location_id, stock)
      values (v_company_id, v_product.id, v_location_id, v_qty)
      on conflict (product_id, location_id)
        do update set stock = public.product_locations.stock + excluded.stock,
                      updated_at = now();

      update public.products set stock = (
        select coalesce(sum(stock),0) from public.product_locations
        where product_id = v_product.id
      ), updated_at = now()
      where id = v_product.id;

      insert into public.stock_movements (company_id, location_id, product_id,
                                          movement_type, qty, reference_type, reference_id, notes)
      values (v_company_id, v_location_id, v_product.id, 'purchase', v_qty,
              'purchase', v_purchase_id, 'Compra ' || v_purchase_number);
    end if;
  end loop;

  return v_purchase_id;
end;
$$;

grant execute on function public.create_purchase(uuid, text, timestamptz, uuid, jsonb) to authenticated;
