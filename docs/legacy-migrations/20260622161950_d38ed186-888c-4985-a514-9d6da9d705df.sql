-- 7.2: IVA por renglón en sale_items + RPC profit_report (ingreso neto)

-- 1) Columnas nuevas en sale_items (sin backfill: históricas quedan en 0/true)
alter table public.sale_items
  add column if not exists tax_amount numeric(12,2) not null default 0,
  add column if not exists price_includes_tax boolean not null default true;

-- Columna generada: ingreso neto del renglón (total - IVA)
alter table public.sale_items
  add column if not exists net_revenue numeric(12,2)
  generated always as (total - tax_amount) stored;

-- 2) create_sale: misma firma y lógica, ahora guarda tax_amount y price_includes_tax
create or replace function public.create_sale(
  p_customer_id uuid,
  p_document_type text,
  p_payment_method text,
  p_items jsonb,
  p_location_id uuid default null
) returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_company_id uuid; v_location_id uuid; v_tax_rate numeric(5,4); v_doc_types jsonb; v_charges_iva boolean;
  v_sale_id uuid; v_customer_name text; v_item jsonb; v_product public.products%rowtype; v_loc_stock numeric(12,3);
  v_qty numeric(12,3); v_line_total numeric(12,2); v_line_tax numeric(12,2);
  v_total numeric(12,2) := 0; v_tax numeric(12,2) := 0; v_subtotal numeric(12,2); v_sale_number text;
  v_variant_id uuid; v_variant public.product_variants%rowtype; v_unit_price numeric(12,2); v_unit_cost numeric(12,2);
  v_variant_label text; v_attr_key text; v_attr_val text; v_label_parts text[];
  v_price_in numeric(12,2);
  v_price_includes_tax boolean;
begin
  if auth.uid() is null then raise exception 'No autenticado.'; end if;
  if public.current_user_is_demo() then raise exception 'Esta accion esta deshabilitada en el Modo de Prueba.'; end if;
  v_company_id := public.current_user_company_id();
  if v_company_id is null then raise exception 'El usuario no tiene empresa asociada.'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'El carrito esta vacio.'; end if;
  v_location_id := p_location_id;
  if v_location_id is null then select location_id into v_location_id from public.profiles where id = auth.uid(); end if;
  if v_location_id is null then select id into v_location_id from public.locations where company_id = v_company_id order by created_at limit 1; end if;
  if v_location_id is null then raise exception 'No hay punto de venta configurado.'; end if;
  select tax_rate, document_types into v_tax_rate, v_doc_types from public.companies where id = v_company_id;
  v_tax_rate := coalesce(v_tax_rate, 0.18);
  select (dt ->> 'charges_iva')::boolean into v_charges_iva from jsonb_array_elements(coalesce(v_doc_types,'[]'::jsonb)) dt
    where lower(dt ->> 'name') = lower(coalesce(p_document_type,'')) limit 1;
  v_charges_iva := coalesce(v_charges_iva, true);
  select coalesce(name,'Publico general') into v_customer_name from public.customers
    where id = p_customer_id and company_id = v_company_id and deleted_at is null;
  v_customer_name := coalesce(v_customer_name,'Publico general');
  v_sale_number := 'V-' || to_char(now(),'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  insert into public.sales (company_id, location_id, customer_id, sale_number, document_type, payment_method, customer_name, subtotal, tax, total, created_by)
  values (v_company_id, v_location_id, p_customer_id, v_sale_number, coalesce(p_document_type,'Ticket'), coalesce(p_payment_method,'Efectivo'), v_customer_name, 0,0,0, auth.uid())
  returning id into v_sale_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item ->> 'qty')::numeric, 0);
    if v_qty <= 0 then raise exception 'Cantidad invalida.'; end if;
    select * into v_product from public.products where id = (v_item ->> 'product_id')::uuid and company_id = v_company_id and deleted_at is null and active = true;
    if not found then raise exception 'Producto no encontrado.'; end if;

    v_price_in := coalesce(
      nullif(v_item ->> 'unit_price','')::numeric,
      nullif(v_item ->> 'price','')::numeric
    );
    v_price_includes_tax := coalesce(v_product.price_includes_tax, true);

    v_variant_id := nullif(v_item ->> 'variant_id','')::uuid;

    if v_variant_id is not null then
      select * into v_variant from public.product_variants
        where id = v_variant_id and product_id = v_product.id and company_id = v_company_id
          and is_active = true and deleted_at is null;
      if not found then raise exception 'Variante no encontrada para el producto %.', v_product.name; end if;

      v_unit_price := coalesce(v_price_in, v_variant.price_override, v_product.price);
      v_unit_cost  := coalesce(v_variant.cost_override, v_product.cost);

      select stock into v_loc_stock from public.product_variant_locations
        where product_variant_id = v_variant.id and location_id = v_location_id for update;
      if not found then raise exception 'El producto % no esta asignado a este punto de venta.', v_product.name; end if;
      if v_loc_stock < v_qty then raise exception 'Stock insuficiente para % en este local.', v_product.name; end if;

      if not v_charges_iva then
        v_line_total := round(v_unit_price * v_qty, 2); v_line_tax := 0;
      elsif v_price_includes_tax then
        v_line_total := round(v_unit_price * v_qty, 2); v_line_tax := round(v_line_total - v_line_total/(1+v_tax_rate), 2);
      else
        v_line_total := round(v_unit_price * v_qty * (1+v_tax_rate), 2); v_line_tax := round(v_unit_price * v_qty * v_tax_rate, 2);
      end if;
      v_total := v_total + v_line_total; v_tax := v_tax + v_line_tax;

      v_label_parts := array[]::text[];
      for v_attr_key, v_attr_val in select key, value::text from jsonb_each_text(coalesce(v_variant.attributes,'{}'::jsonb)) loop
        v_label_parts := v_label_parts || (v_attr_key || ' ' || v_attr_val);
      end loop;
      v_variant_label := array_to_string(v_label_parts, ' / ');

      insert into public.sale_items (company_id, location_id, sale_id, product_id, product_variant_id, variant_label, product_name, qty, unit_price, total, cost, tax_amount, price_includes_tax)
      values (v_company_id, v_location_id, v_sale_id, v_product.id, v_variant.id, v_variant_label, v_product.name, v_qty, v_unit_price, v_line_total, v_unit_cost, v_line_tax, case when v_charges_iva then v_price_includes_tax else true end);

      update public.product_variant_locations set stock = stock - v_qty, updated_at = now()
        where product_variant_id = v_variant.id and location_id = v_location_id;

      update public.products set stock = (
        select coalesce(sum(pvl.stock),0)
        from public.product_variant_locations pvl
        join public.product_variants pv on pv.id = pvl.product_variant_id
        where pv.product_id = v_product.id
      ) where id = v_product.id;

      insert into public.stock_movements (company_id, location_id, product_id, product_variant_id, movement_type, qty, reference_type, reference_id, notes)
      values (v_company_id, v_location_id, v_product.id, v_variant.id, 'sale', -v_qty, 'sale', v_sale_id, 'Venta POS');

    else
      v_unit_price := coalesce(v_price_in, v_product.price);
      v_unit_cost := v_product.cost;

      select stock into v_loc_stock from public.product_locations where product_id = v_product.id and location_id = v_location_id for update;
      if not found then raise exception 'El producto % no esta asignado a este punto de venta.', v_product.name; end if;
      if v_loc_stock < v_qty then raise exception 'Stock insuficiente para % en este local.', v_product.name; end if;
      if not v_charges_iva then
        v_line_total := round(v_unit_price * v_qty, 2); v_line_tax := 0;
      elsif v_price_includes_tax then
        v_line_total := round(v_unit_price * v_qty, 2); v_line_tax := round(v_line_total - v_line_total/(1+v_tax_rate), 2);
      else
        v_line_total := round(v_unit_price * v_qty * (1+v_tax_rate), 2); v_line_tax := round(v_unit_price * v_qty * v_tax_rate, 2);
      end if;
      v_total := v_total + v_line_total; v_tax := v_tax + v_line_tax;

      insert into public.sale_items (company_id, location_id, sale_id, product_id, product_name, qty, unit_price, total, cost, tax_amount, price_includes_tax)
      values (v_company_id, v_location_id, v_sale_id, v_product.id, v_product.name, v_qty, v_unit_price, v_line_total, v_unit_cost, v_line_tax, case when v_charges_iva then v_price_includes_tax else true end);

      update public.product_locations set stock = stock - v_qty, updated_at = now() where product_id = v_product.id and location_id = v_location_id;
      update public.products set stock = (select coalesce(sum(stock),0) from public.product_locations where product_id = v_product.id) where id = v_product.id;
      insert into public.stock_movements (company_id, location_id, product_id, movement_type, qty, reference_type, reference_id, notes)
      values (v_company_id, v_location_id, v_product.id, 'sale', -v_qty, 'sale', v_sale_id, 'Venta POS');
    end if;
  end loop;

  v_subtotal := v_total - v_tax;
  update public.sales set subtotal = v_subtotal, tax = v_tax, total = v_total where id = v_sale_id;

  return jsonb_build_object(
    'sale_id', v_sale_id,
    'subtotal', v_subtotal,
    'tax', v_tax,
    'total', v_total
  );
end;
$function$;

-- 3) RPC profit_report: ingreso NETO (sin IVA) vs costo
create or replace function public.profit_report(
  p_from timestamptz default null,
  p_to   timestamptz default null,
  p_location_id uuid default null
) returns table (
  product_id uuid,
  product_name text,
  qty numeric,
  revenue numeric,
  cost numeric,
  profit numeric
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    si.product_id,
    coalesce(max(si.product_name), 'Producto') as product_name,
    sum(si.qty)::numeric                       as qty,
    sum(si.net_revenue)::numeric               as revenue,
    sum(si.qty * coalesce(si.cost, 0))::numeric as cost,
    (sum(si.net_revenue) - sum(si.qty * coalesce(si.cost, 0)))::numeric as profit
  from public.sale_items si
  join public.sales s on s.id = si.sale_id
  where s.company_id = public.current_user_company_id()
    and s.deleted_at is null
    and (p_location_id is null or s.location_id = p_location_id)
    and public.user_can_access_location(s.location_id)
    and (p_from is null or s.sale_date >= p_from)
    and (p_to   is null or s.sale_date <  p_to)
  group by si.product_id
  order by profit desc;
$$;

grant execute on function public.profit_report(timestamptz, timestamptz, uuid) to authenticated;