
-- =====================================================================
-- PASO 9 — Re-auditoría RPCs y RLS
-- =====================================================================

-- §4) Permitir que el admin de la empresa cambie plan_id
create or replace function public.protect_company_subscription_fields()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null or public.current_user_is_platform_admin() then
    return new;
  end if;

  -- subscription_status / expires_at: solo platform admin
  if new.subscription_status is distinct from old.subscription_status
     or new.expires_at is distinct from old.expires_at
  then
    raise exception 'Solo un administrador de la plataforma puede cambiar el estado o el vencimiento de la suscripción.';
  end if;

  -- plan_id: admin de la empresa puede cambiarlo
  if new.plan_id is distinct from old.plan_id then
    if not public.can_admin_company(new.id) then
      raise exception 'Solo el administrador de la empresa puede cambiar el plan.';
    end if;
  end if;

  return new;
end;
$$;

-- §7) Categorías: índice único parcial que libera el nombre al eliminar
alter table public.categories drop constraint if exists categories_company_id_name_key;
drop index if exists public.categories_company_id_name_key;
create unique index if not exists categories_company_name_active_uniq
  on public.categories (company_id, lower(name))
  where deleted_at is null;

-- =====================================================================
-- §5) open_cash_session — corregir filtro locations.deleted_at -> is_active
-- =====================================================================
create or replace function public.open_cash_session(p_opening_amount numeric, p_location_id uuid default null)
returns uuid
language plpgsql
set search_path to 'public'
as $$
declare
  v_company_id uuid;
  v_location_id uuid;
  v_session_id uuid;
begin
  if auth.uid() is null then raise exception 'No autenticado.'; end if;
  if public.current_user_is_demo() then
    raise exception 'Esta accion esta deshabilitada en el Modo de Prueba.';
  end if;

  v_company_id := public.current_user_company_id();
  if v_company_id is null then raise exception 'El usuario no tiene empresa asociada.'; end if;

  v_location_id := p_location_id;
  if v_location_id is null then
    select location_id into v_location_id from public.profiles where id = auth.uid();
  end if;
  if v_location_id is null then
    select id into v_location_id from public.locations
      where company_id = v_company_id and is_active = true
      order by created_at limit 1;
  end if;
  if v_location_id is null then raise exception 'No hay punto de venta configurado.'; end if;

  perform 1 from public.locations where id = v_location_id and company_id = v_company_id;
  if not found then raise exception 'Sucursal invalida.'; end if;

  if exists (
    select 1 from public.cash_sessions
    where company_id = v_company_id and location_id = v_location_id and status = 'open'
  ) then
    raise exception 'Ya hay una caja abierta en esta sucursal.';
  end if;

  insert into public.cash_sessions
    (company_id, location_id, status, opening_amount, opened_by, opened_at)
  values
    (v_company_id, v_location_id, 'open', greatest(coalesce(p_opening_amount,0), 0),
     auth.uid(), now())
  returning id into v_session_id;

  return v_session_id;
end;
$$;

revoke execute on function public.open_cash_session(numeric, uuid) from public, anon;
grant execute on function public.open_cash_session(numeric, uuid) to authenticated;

-- =====================================================================
-- §2) create_purchase — variant reactivada, has_variants validado,
--      fix locations.deleted_at -> is_active
-- =====================================================================
create or replace function public.create_purchase(
  p_supplier_id uuid, p_document_number text, p_date timestamp with time zone,
  p_location_id uuid, p_items jsonb)
returns uuid
language plpgsql
set search_path to 'public'
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
      where company_id = v_company_id and is_active = true
      order by created_at limit 1;
  end if;
  if v_location_id is null then raise exception 'No hay punto de venta configurado.'; end if;

  perform 1 from public.locations where id = v_location_id and company_id = v_company_id;
  if not found then raise exception 'Sucursal invalida.'; end if;

  -- Pre-compute total + validar has_variants
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item ->> 'qty')::numeric, 0);
    v_unit_cost := coalesce((v_item ->> 'unit_cost')::numeric, 0);
    if v_qty <= 0 then raise exception 'La cantidad debe ser mayor a 0.'; end if;
    if v_unit_cost < 0 then raise exception 'El costo no puede ser negativo.'; end if;
    v_total := v_total + round(v_qty * v_unit_cost, 2);

    select * into v_product from public.products
      where id = (v_item ->> 'product_id')::uuid
        and company_id = v_company_id and deleted_at is null;
    if not found then raise exception 'Producto no encontrado.'; end if;
    v_variant_id := nullif(v_item ->> 'variant_id','')::uuid;
    if v_product.has_variants and v_variant_id is null then
      raise exception 'El producto % requiere variante.', v_product.name;
    end if;
    if (not v_product.has_variants) and v_variant_id is not null then
      raise exception 'El producto % no tiene variantes.', v_product.name;
    end if;
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

    v_variant_id := nullif(v_item ->> 'variant_id','')::uuid;

    insert into public.purchase_items (company_id, purchase_id, product_id, product_variant_id,
                                       qty, unit_cost, total)
    values (v_company_id, v_purchase_id, v_product.id, v_variant_id, v_qty, v_unit_cost, v_line_total);

    if v_variant_id is not null then
      select * into v_variant from public.product_variants
        where id = v_variant_id and product_id = v_product.id and company_id = v_company_id
          and deleted_at is null;
      if not found then raise exception 'Variante no encontrada para %.', v_product.name; end if;

      insert into public.product_variant_locations (company_id, product_variant_id, location_id, stock, is_active)
      values (v_company_id, v_variant.id, v_location_id, v_qty, true)
      on conflict (product_variant_id, location_id)
        do update set stock = public.product_variant_locations.stock + excluded.stock,
                      is_active = true,
                      updated_at = now();

      update public.products set stock = (
        select coalesce(sum(pvl.stock),0)
        from public.product_variant_locations pvl
        join public.product_variants pv on pv.id = pvl.product_variant_id
        where pv.product_id = v_product.id and pvl.is_active = true
      ), updated_at = now()
      where id = v_product.id;

      insert into public.stock_movements (company_id, location_id, product_id, product_variant_id,
                                          movement_type, qty, reference_type, reference_id, notes)
      values (v_company_id, v_location_id, v_product.id, v_variant.id, 'purchase', v_qty,
              'purchase', v_purchase_id, 'Compra ' || v_purchase_number);
    else
      insert into public.product_locations (company_id, product_id, location_id, stock, is_active)
      values (v_company_id, v_product.id, v_location_id, v_qty, true)
      on conflict (product_id, location_id)
        do update set stock = public.product_locations.stock + excluded.stock,
                      is_active = true,
                      updated_at = now();

      update public.products set stock = (
        select coalesce(sum(stock),0) from public.product_locations
        where product_id = v_product.id and is_active = true
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

revoke execute on function public.create_purchase(uuid, text, timestamp with time zone, uuid, jsonb) from public, anon;
grant execute on function public.create_purchase(uuid, text, timestamp with time zone, uuid, jsonb) to authenticated;

-- =====================================================================
-- §1) create_return — exigir sale_item_id + lock anti-carrera
--      (también fix locations.deleted_at -> is_active)
-- =====================================================================
create or replace function public.create_return(
  p_sale_id uuid, p_reason text, p_items jsonb,
  p_location_id uuid default null, p_refund_cash boolean default true)
returns uuid
language plpgsql
set search_path to 'public'
as $$
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
  if p_sale_id is null then
    raise exception 'Toda devolucion debe referenciar una venta.';
  end if;

  v_location_id := p_location_id;
  if v_location_id is null then
    select location_id into v_location_id from public.sales where id = p_sale_id and company_id = v_company_id;
  end if;
  if v_location_id is null then
    select location_id into v_location_id from public.profiles where id = auth.uid();
  end if;
  if v_location_id is null then
    select id into v_location_id from public.locations
      where company_id = v_company_id and is_active = true
      order by created_at limit 1;
  end if;
  if v_location_id is null then raise exception 'No hay punto de venta configurado.'; end if;

  perform 1 from public.locations where id = v_location_id and company_id = v_company_id;
  if not found then raise exception 'Sucursal invalida.'; end if;

  perform 1 from public.sales where id = p_sale_id and company_id = v_company_id and deleted_at is null;
  if not found then raise exception 'Venta no encontrada.'; end if;

  v_return_number := 'NC-' || to_char(now(),'YYYYMMDD') || '-' ||
                     upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));

  insert into public.returns (company_id, location_id, sale_id, return_number, reason, total, status)
  values (v_company_id, v_location_id, p_sale_id, v_return_number, btrim(p_reason), 0, 'processed')
  returning id into v_return_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item ->> 'qty')::numeric, 0);
    if v_qty <= 0 then raise exception 'Cantidad invalida.'; end if;

    v_sale_item_id := nullif(v_item ->> 'sale_item_id','')::uuid;
    if v_sale_item_id is null then
      raise exception 'Cada renglon debe referenciar un renglon de venta (sale_item_id).';
    end if;

    -- LOCK del renglón de venta antes de validar tope (anti-carrera)
    select * into v_sale_item from public.sale_items
      where id = v_sale_item_id and company_id = v_company_id
      for update;
    if not found then raise exception 'Renglon de venta no encontrado.'; end if;
    if v_sale_item.sale_id <> p_sale_id then
      raise exception 'El renglon no pertenece a la venta.';
    end if;

    v_product_id := v_sale_item.product_id;
    v_variant_id := v_sale_item.product_variant_id;
    v_unit_price := coalesce(nullif(v_item ->> 'unit_price','')::numeric, v_sale_item.unit_price);

    select coalesce(sum(ri.qty),0) into v_returned_prev
    from public.return_items ri
    where ri.sale_item_id = v_sale_item.id;

    v_max_returnable := v_sale_item.qty - v_returned_prev;
    if v_qty > v_max_returnable + 0.0005 then
      raise exception 'No puedes devolver mas de % unidades de %.', v_max_returnable, v_sale_item.product_name;
    end if;

    if v_product_id is null then raise exception 'Producto requerido.'; end if;

    select * into v_product from public.products
      where id = v_product_id and company_id = v_company_id and deleted_at is null;
    if not found then raise exception 'Producto no encontrado.'; end if;

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

      insert into public.product_variant_locations (company_id, product_variant_id, location_id, stock, is_active)
      values (v_company_id, v_variant.id, v_location_id, v_qty, true)
      on conflict (product_variant_id, location_id)
        do update set stock = public.product_variant_locations.stock + excluded.stock,
                      is_active = true,
                      updated_at = now();

      update public.products set stock = (
        select coalesce(sum(pvl.stock),0)
        from public.product_variant_locations pvl
        join public.product_variants pv on pv.id = pvl.product_variant_id
        where pv.product_id = v_product.id and pvl.is_active = true
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
      insert into public.product_locations (company_id, product_id, location_id, stock, is_active)
      values (v_company_id, v_product.id, v_location_id, v_qty, true)
      on conflict (product_id, location_id)
        do update set stock = public.product_locations.stock + excluded.stock,
                      is_active = true,
                      updated_at = now();

      update public.products set stock = (
        select coalesce(sum(stock),0) from public.product_locations
        where product_id = v_product.id and is_active = true
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

  -- Cash refund: egreso con monto negativo
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
$$;

revoke execute on function public.create_return(uuid, text, jsonb, uuid, boolean) from public, anon;
grant execute on function public.create_return(uuid, text, jsonb, uuid, boolean) to authenticated;

-- =====================================================================
-- §3) sync_product_variants — recalc stock al pasar a SIN variantes
-- =====================================================================
create or replace function public.sync_product_variants(
  p_product_id uuid, p_attribute_names text[], p_variants jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_company_id uuid;
  v_product public.products%rowtype;
  v_has_variants boolean;
  v_item jsonb;
  v_loc jsonb;
  v_variant_id uuid;
  v_kept uuid[] := array[]::uuid[];
  v_keep_locs uuid[];
  v_total_stock numeric(12,3) := 0;
begin
  if auth.uid() is null then raise exception 'No autenticado.'; end if;
  if public.current_user_is_demo() then
    raise exception 'Esta accion esta deshabilitada en el Modo de Prueba.';
  end if;

  v_company_id := public.current_user_company_id();
  if v_company_id is null then raise exception 'El usuario no tiene empresa asociada.'; end if;

  select * into v_product from public.products
    where id = p_product_id and company_id = v_company_id and deleted_at is null
    for update;
  if not found then raise exception 'Producto no encontrado.'; end if;

  v_has_variants := (p_variants is not null and jsonb_array_length(p_variants) > 0);

  if v_has_variants then
    for v_item in select * from jsonb_array_elements(p_variants) loop
      v_variant_id := nullif(v_item ->> 'id','')::uuid;

      if v_variant_id is not null then
        update public.product_variants set
          attributes = coalesce(v_item -> 'attributes', '{}'::jsonb),
          barcode = nullif(btrim(coalesce(v_item ->> 'barcode','')),''),
          sku = nullif(btrim(coalesce(v_item ->> 'sku','')),''),
          price_override = nullif(v_item ->> 'price_override','')::numeric,
          cost_override = nullif(v_item ->> 'cost_override','')::numeric,
          is_active = true,
          deleted_at = null,
          updated_at = now()
        where id = v_variant_id and product_id = p_product_id and company_id = v_company_id;
        if not found then raise exception 'Variante no encontrada.'; end if;
      else
        insert into public.product_variants
          (company_id, product_id, attributes, barcode, sku, price_override, cost_override, is_active)
        values (
          v_company_id, p_product_id,
          coalesce(v_item -> 'attributes', '{}'::jsonb),
          nullif(btrim(coalesce(v_item ->> 'barcode','')),''),
          nullif(btrim(coalesce(v_item ->> 'sku','')),''),
          nullif(v_item ->> 'price_override','')::numeric,
          nullif(v_item ->> 'cost_override','')::numeric,
          true
        )
        returning id into v_variant_id;
      end if;

      v_kept := v_kept || v_variant_id;

      v_keep_locs := array[]::uuid[];
      if (v_item ? 'locations') and jsonb_typeof(v_item -> 'locations') = 'array' then
        for v_loc in select * from jsonb_array_elements(v_item -> 'locations') loop
          insert into public.product_variant_locations
            (company_id, product_variant_id, location_id, stock, is_active)
          values (
            v_company_id, v_variant_id,
            (v_loc ->> 'location_id')::uuid,
            coalesce((v_loc ->> 'stock')::numeric, 0),
            true
          )
          on conflict (product_variant_id, location_id) do update
            set stock = excluded.stock, is_active = true, updated_at = now();
          v_keep_locs := v_keep_locs || (v_loc ->> 'location_id')::uuid;
        end loop;
      end if;

      update public.product_variant_locations
        set is_active = false, updated_at = now()
        where product_variant_id = v_variant_id
          and is_active = true
          and (array_length(v_keep_locs,1) is null or not (location_id = any(v_keep_locs)));
    end loop;
  end if;

  update public.product_variants
    set deleted_at = now(), is_active = false, updated_at = now()
    where product_id = p_product_id
      and company_id = v_company_id
      and deleted_at is null
      and (array_length(v_kept,1) is null or not (id = any(v_kept)));

  update public.product_variant_locations pvl
    set is_active = false, updated_at = now()
    where pvl.is_active = true
      and pvl.product_variant_id in (
        select id from public.product_variants
        where product_id = p_product_id
          and (array_length(v_kept,1) is null or not (id = any(v_kept)))
      );

  if v_has_variants then
    select coalesce(sum(stock),0) into v_total_stock
    from public.product_variant_locations
    where product_variant_id = any(v_kept) and is_active = true;

    update public.products set
      has_variants = true,
      variant_attributes = p_attribute_names,
      stock = v_total_stock,
      updated_at = now()
    where id = p_product_id;

    update public.product_locations
      set is_active = false, updated_at = now()
      where product_id = p_product_id and is_active = true;
  else
    -- §3 FIX: recalcular stock desde product_locations al pasar a SIN variantes
    select coalesce(sum(stock),0) into v_total_stock
    from public.product_locations
    where product_id = p_product_id and is_active = true;

    update public.products set
      has_variants = false,
      variant_attributes = null,
      stock = v_total_stock,
      updated_at = now()
    where id = p_product_id;
  end if;
end;
$$;

-- =====================================================================
-- §6) soft_delete_product — cascada de variantes
-- =====================================================================
create or replace function public.soft_delete_product(p_product_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_company_id uuid;
  v_product public.products%rowtype;
begin
  if auth.uid() is null then raise exception 'No autenticado.'; end if;
  if public.current_user_is_demo() then
    raise exception 'Esta accion esta deshabilitada en el Modo de Prueba.';
  end if;

  v_company_id := public.current_user_company_id();
  if v_company_id is null then raise exception 'El usuario no tiene empresa asociada.'; end if;

  select * into v_product from public.products
    where id = p_product_id and company_id = v_company_id
    for update;
  if not found then raise exception 'Producto no encontrado.'; end if;

  if not public.can_admin_company(v_company_id) then
    raise exception 'Solo el administrador de la empresa puede eliminar productos.';
  end if;

  update public.products
    set deleted_at = now(), active = false, updated_at = now()
    where id = p_product_id;

  update public.product_variants
    set deleted_at = now(), is_active = false, updated_at = now()
    where product_id = p_product_id and deleted_at is null;

  update public.product_variant_locations
    set is_active = false, updated_at = now()
    where product_variant_id in (
      select id from public.product_variants where product_id = p_product_id
    )
    and is_active = true;

  update public.product_locations
    set is_active = false, updated_at = now()
    where product_id = p_product_id and is_active = true;
end;
$$;

revoke execute on function public.soft_delete_product(uuid) from public, anon;
grant execute on function public.soft_delete_product(uuid) to authenticated;

-- =====================================================================
-- §8a) adjust_stock — RPC transaccional
-- =====================================================================
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
  if v_role not in ('admin','user') then
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

revoke execute on function public.adjust_stock(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.adjust_stock(uuid, uuid, numeric, text) to authenticated;

-- =====================================================================
-- §8b) transfer_stock — RPC transaccional
-- =====================================================================
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
  if v_role not in ('admin','user') then
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

  -- Lock en orden estable para evitar deadlock
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

revoke execute on function public.transfer_stock(uuid, uuid, uuid, numeric, text) from public, anon;
grant execute on function public.transfer_stock(uuid, uuid, uuid, numeric, text) to authenticated;
