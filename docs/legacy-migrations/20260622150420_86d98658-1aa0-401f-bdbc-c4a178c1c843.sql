
-- 1) return_items table
CREATE TABLE public.return_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  company_id uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  return_id uuid NOT NULL REFERENCES public.returns(id) ON DELETE CASCADE,
  sale_item_id uuid REFERENCES public.sale_items(id) ON DELETE SET NULL,
  product_id uuid REFERENCES public.products(id) ON DELETE SET NULL,
  product_variant_id uuid REFERENCES public.product_variants(id) ON DELETE SET NULL,
  location_id uuid REFERENCES public.locations(id) ON DELETE SET NULL,
  product_name text NOT NULL DEFAULT '',
  variant_label text,
  qty numeric(12,3) NOT NULL CHECK (qty > 0),
  unit_price numeric(12,2) NOT NULL DEFAULT 0,
  total numeric(12,2) NOT NULL DEFAULT 0,
  is_demo_data boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX return_items_return_idx ON public.return_items(return_id);
CREATE INDEX return_items_sale_item_idx ON public.return_items(sale_item_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.return_items TO authenticated;
GRANT ALL ON public.return_items TO service_role;

ALTER TABLE public.return_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "return_items select scoped" ON public.return_items
  FOR SELECT TO authenticated
  USING (can_select_company(company_id, is_demo_data) AND user_can_access_location(location_id));

CREATE POLICY "return_items write scoped" ON public.return_items
  FOR ALL TO authenticated
  USING (can_write_company(company_id) AND user_can_access_location(location_id))
  WITH CHECK (can_write_company(company_id) AND user_can_access_location(location_id));

CREATE TRIGGER prevent_demo_return_items_write
  BEFORE INSERT OR UPDATE OR DELETE ON public.return_items
  FOR EACH ROW EXECUTE FUNCTION public.reject_demo_write();

-- 2) create_return RPC
CREATE OR REPLACE FUNCTION public.create_return(
  p_sale_id uuid,
  p_reason text,
  p_items jsonb,
  p_location_id uuid DEFAULT NULL,
  p_refund_cash boolean DEFAULT true
) RETURNS uuid
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

  -- Resolve location
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

  -- Validate sale belongs to company if provided
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

      -- Max returnable = sold qty - already returned
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

  -- Cash refund if requested and open session exists at the location
  if p_refund_cash and v_total > 0 then
    select id into v_session_id from public.cash_sessions
      where company_id = v_company_id
        and location_id = v_location_id
        and status = 'open'
      order by opened_at desc limit 1;

    if v_session_id is not null then
      insert into public.cash_movements (company_id, location_id, cash_session_id,
                                         movement_type, concept, amount, movement_at)
      values (v_company_id, v_location_id, v_session_id, 'out',
              'Reembolso devolucion ' || v_return_number, v_total, now());
    end if;
  end if;

  return v_return_id;
end;
$function$;
