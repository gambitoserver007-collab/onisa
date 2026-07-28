CREATE OR REPLACE FUNCTION public.create_return(p_sale_id uuid, p_reason text, p_items jsonb, p_location_id uuid DEFAULT NULL::uuid, p_refund_cash boolean DEFAULT true)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_company_id uuid;
  v_location_id uuid;
  v_return_id uuid;
  v_return_number text;
  v_item jsonb;
  v_sale_item public.sale_items%rowtype;
  v_product public.products%rowtype;
  v_variant public.product_variants%rowtype;
  v_sale_item_id uuid;
  v_product_id uuid;
  v_variant_id uuid;
  v_qty numeric(12,3);
  v_unit_price numeric(12,2);
  v_line_total numeric(12,2);
  v_total numeric(12,2) := 0;
  v_returned_prev numeric(12,3);
  v_max_returnable numeric(12,3);
  v_variant_label text;
  v_attr_key text; v_attr_val text; v_label_parts text[];
  v_session_id uuid;
begin
  if auth.uid() is null then raise exception 'No autenticado.'; end if;
  if public.current_user_is_demo() then
    raise exception 'Esta accion esta deshabilitada en el Modo de Prueba.';
  end if;

  v_company_id := public.current_user_company_id();
  if v_company_id is null then raise exception 'El usuario no tiene empresa asociada.'; end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'Describe el motivo de la devolucion.';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Agrega al menos un producto a la devolucion.';
  end if;

  v_location_id := p_location_id;
  if v_location_id is null and p_sale_id is not null then
    select location_id into v_location_id from public.sales where id = p_sale_id and company_id = v_company_id;
  end if;
  if v_location_id is null then
    select location_id into v_location_id from public.profiles where id = auth.uid();
  end if;
  if v_location_id is null then
    select id into v_location_id from public.locations
      where company_id = v_company_id and deleted_at is null
      order by created_at limit 1;
  end if;
  if v_location_id is null then raise exception 'No hay punto de venta configurado.'; end if;

  perform 1 from public.locations where id = v_location_id and company_id = v_company_id;
  if not found then raise exception 'Sucursal invalida.'; end if;

  if p_sale_id is not null then
    perform 1 from public.sales where id = p_sale_id and company_id = v_company_id and deleted_at is null;
    if not found then raise exception 'Venta no encontrada.'; end if;
  end if;

  v_return_number := 'NC-' || to_char(now(),'YYYYMMDD') || '-' ||
                     upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));

  insert into public.returns (company_id, location_id, sale_id, return_number, reason, total, status)
  values (v_company_id, v_location_id, p_sale_id, v_return_number, btrim(p_reason), 0, 'processed')
  returning id into v_return_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item ->> 'qty')::numeric, 0);
    if v_qty <= 0 then raise exception 'Cantidad invalida.'; end if;

    v_sale_item_id := nullif(v_item ->> 'sale_item_id','')::uuid;
    v_product_id := nullif(v_item ->> 'product_id','')::uuid;
    v_variant_id := nullif(v_item ->> 'variant_id','')::uuid;
    v_unit_price := nullif(v_item ->> 'unit_price','')::numeric;

    if v_sale_item_id is not null then
      select * into v_sale_item from public.sale_items
        where id = v_sale_item_id and company_id = v_company_id;
      if not found then raise exception 'Renglon de venta no encontrado.'; end if;
      if p_sale_id is not null and v_sale_item.sale_id <> p_sale_id then
        raise exception 'El renglon no pertenece a la venta.';
      end if;
      v_product_id := v_sale_item.product_id;
      v_variant_id := v_sale_item.product_variant_id;
      v_unit_price := coalesce(v_unit_price, v_sale_item.unit_price);

      select coalesce(sum(ri.qty),0) into v_returned_prev
      from public.return_items ri
      where ri.sale_item_id = v_sale_item.id;
      v_max_returnable := v_sale_item.qty - v_returned_prev;
      if v_qty > v_max_returnable + 0.0005 then
        raise exception 'No puedes devolver mas de % unidades de %.', v_max_returnable, v_sale_item.product_name;
      end if;
    end if;

    if v_product_id is null then raise exception 'Producto requerido.'; end if;

    select * into v_product from public.products
      where id = v_product_id and company_id = v_company_id and deleted_at is null;
    if not found then raise exception 'Producto no encontrado.'; end if;

    v_unit_price := coalesce(v_unit_price, v_product.price);
    v_line_total := round(v_unit_price * v_qty, 2);
    v_total := v_total + v_line_total;

    if v_variant_id is not null then
      select * into v_variant from public.product_variants
        where id = v_variant_id and product_id = v_product.id and company_id = v_company_id;
      if not found then raise exception 'Variante no encontrada.'; end if;

      v_label_parts := array[]::text[];
      for v_attr_key, v_attr_val in
        select key, value::text from jsonb_each_text(coalesce(v_variant.attributes,'{}'::jsonb))
      loop
        v_label_parts := v_label_parts || (v_attr_key || ' ' || v_attr_val);
      end loop;
      v_variant_label := array_to_string(v_label_parts, ' / ');

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
      values (v_company_id, v_location_id, v_product.id, v_variant.id, 'return', v_qty,
              'return', v_return_id, 'Devolucion ' || v_return_number);

      insert into public.return_items (company_id, return_id, sale_item_id, product_id,
                                       product_variant_id, location_id, product_name, variant_label,
                                       qty, unit_price, total)
      values (v_company_id, v_return_id, v_sale_item_id, v_product.id, v_variant.id, v_location_id,
              v_product.name, v_variant_label, v_qty, v_unit_price, v_line_total);
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
      values (v_company_id, v_location_id, v_product.id, 'return', v_qty,
              'return', v_return_id, 'Devolucion ' || v_return_number);

      insert into public.return_items (company_id, return_id, sale_item_id, product_id,
                                       location_id, product_name,
                                       qty, unit_price, total)
      values (v_company_id, v_return_id, v_sale_item_id, v_product.id, v_location_id,
              v_product.name, v_qty, v_unit_price, v_line_total);
    end if;
  end loop;

  update public.returns set total = v_total, updated_at = now() where id = v_return_id;

  -- Cash refund: registrar como EGRESO con monto NEGATIVO para que
  -- close_cash_session (suma firmada) reste el reembolso del esperado.
  -- Convención del proyecto: movement_type 'ingreso'|'egreso'; egreso => amount < 0.
  if p_refund_cash and v_total > 0 then
    select id into v_session_id from public.cash_sessions
      where company_id = v_company_id
        and location_id = v_location_id
        and status = 'open'
      order by opened_at desc limit 1;

    if v_session_id is not null then
      insert into public.cash_movements (company_id, cash_session_id,
                                         movement_type, concept, amount, movement_at)
      values (v_company_id, v_session_id, 'egreso',
              'Reembolso devolucion ' || v_return_number, -v_total, now());
    end if;
  end if;

  return v_return_id;
end;
$function$;