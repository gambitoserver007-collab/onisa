alter table public.products add column if not exists price_includes_tax boolean not null default true;
alter table public.companies add column if not exists document_types jsonb;

create or replace function public.default_tax_rate(p_country text)
returns numeric language sql immutable as $$
  select case upper(coalesce(p_country,''))
    when 'EC' then 0.15 when 'PE' then 0.18 when 'CO' then 0.19 when 'MX' then 0.16
    when 'CL' then 0.19 when 'AR' then 0.21 when 'BO' then 0.13 when 'PY' then 0.10
    when 'UY' then 0.22 when 'VE' then 0.16 when 'CR' then 0.13 when 'SV' then 0.13
    when 'GT' then 0.12 when 'HN' then 0.15 when 'NI' then 0.15 when 'PA' then 0.07
    when 'DO' then 0.18 when 'PR' then 0.115 else 0.15 end;
$$;

create or replace function public.default_tax_name(p_country text)
returns text language sql immutable as $$
  select case upper(coalesce(p_country,''))
    when 'PE' then 'IGV' when 'PA' then 'ITBMS' when 'DO' then 'ITBIS'
    when 'HN' then 'ISV' when 'PR' then 'IVU' else 'IVA' end;
$$;

create or replace function public.default_document_types(p_country text)
returns jsonb language sql immutable as $$
  select case upper(coalesce(p_country,''))
    when 'EC' then '[{"name":"Consumidor final","charges_iva":false},{"name":"Nota de venta","charges_iva":false},{"name":"Factura","charges_iva":true}]'::jsonb
    when 'PE' then '[{"name":"Boleta","charges_iva":true},{"name":"Factura","charges_iva":true}]'::jsonb
    when 'CO' then '[{"name":"Tiquete POS","charges_iva":true},{"name":"Factura electrónica","charges_iva":true}]'::jsonb
    when 'MX' then '[{"name":"Nota de venta","charges_iva":false},{"name":"Factura","charges_iva":true}]'::jsonb
    when 'CL' then '[{"name":"Boleta","charges_iva":true},{"name":"Factura","charges_iva":true}]'::jsonb
    when 'AR' then '[{"name":"Ticket","charges_iva":true},{"name":"Factura","charges_iva":true}]'::jsonb
    when 'BO' then '[{"name":"Factura","charges_iva":true}]'::jsonb
    when 'CR' then '[{"name":"Tiquete","charges_iva":true},{"name":"Factura","charges_iva":true}]'::jsonb
    when 'DO' then '[{"name":"Factura de consumo","charges_iva":false},{"name":"Factura crédito fiscal","charges_iva":true}]'::jsonb
    else '[{"name":"Nota de venta","charges_iva":false},{"name":"Boleta","charges_iva":true},{"name":"Factura","charges_iva":true}]'::jsonb
  end;
$$;

create or replace function public.set_default_document_types()
returns trigger language plpgsql as $$
begin
  if new.document_types is null then
    new.document_types := public.default_document_types(new.country_code);
  end if;
  return new;
end; $$;

drop trigger if exists companies_default_document_types on public.companies;
create trigger companies_default_document_types
  before insert on public.companies
  for each row execute function public.set_default_document_types();

update public.companies set document_types = public.default_document_types(country_code)
where document_types is null;

update public.companies
set tax_rate = public.default_tax_rate(country_code),
    tax_name = public.default_tax_name(country_code),
    updated_at = now()
where coalesce(tax_name,'') ilike '%demo%' or tax_rate = 0.18;

create or replace function public.create_sale(
  p_customer_id uuid, p_document_type text, p_payment_method text, p_items jsonb
) returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_company_id uuid; v_tax_rate numeric(5,4); v_doc_types jsonb; v_charges_iva boolean;
  v_sale_id uuid; v_customer_name text; v_item jsonb; v_product public.products%rowtype;
  v_qty numeric(12,3); v_line_total numeric(12,2); v_line_tax numeric(12,2);
  v_total numeric(12,2) := 0; v_tax numeric(12,2) := 0; v_subtotal numeric(12,2); v_sale_number text;
begin
  if auth.uid() is null then raise exception 'No autenticado.'; end if;
  if public.current_user_is_demo() then raise exception 'Esta accion esta deshabilitada en el Modo de Prueba.'; end if;
  v_company_id := public.current_user_company_id();
  if v_company_id is null then raise exception 'El usuario no tiene empresa asociada.'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'El carrito esta vacio.'; end if;
  select tax_rate, document_types into v_tax_rate, v_doc_types from public.companies where id = v_company_id;
  v_tax_rate := coalesce(v_tax_rate, 0.18);
  select (dt ->> 'charges_iva')::boolean into v_charges_iva
  from jsonb_array_elements(coalesce(v_doc_types, '[]'::jsonb)) dt
  where lower(dt ->> 'name') = lower(coalesce(p_document_type, '')) limit 1;
  v_charges_iva := coalesce(v_charges_iva, true);
  select coalesce(name, 'Publico general') into v_customer_name
  from public.customers where id = p_customer_id and company_id = v_company_id and deleted_at is null;
  v_customer_name := coalesce(v_customer_name, 'Publico general');
  v_sale_number := 'V-' || to_char(now(),'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,6));
  insert into public.sales (company_id, customer_id, sale_number, document_type, payment_method, customer_name, subtotal, tax, total, created_by)
  values (v_company_id, p_customer_id, v_sale_number, coalesce(p_document_type,'Ticket'), coalesce(p_payment_method,'Efectivo'), v_customer_name, 0, 0, 0, auth.uid())
  returning id into v_sale_id;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item ->> 'qty')::numeric, 0);
    if v_qty <= 0 then raise exception 'Cantidad invalida.'; end if;
    select * into v_product from public.products
      where id = (v_item ->> 'product_id')::uuid and company_id = v_company_id and deleted_at is null and active = true for update;
    if not found then raise exception 'Producto no encontrado.'; end if;
    if v_product.stock < v_qty then raise exception 'Stock insuficiente para %.', v_product.name; end if;
    if not v_charges_iva then
      v_line_total := round(v_product.price * v_qty, 2);
      v_line_tax := 0;
    elsif coalesce(v_product.price_includes_tax, true) then
      v_line_total := round(v_product.price * v_qty, 2);
      v_line_tax := round(v_line_total - v_line_total / (1 + v_tax_rate), 2);
    else
      v_line_total := round(v_product.price * v_qty * (1 + v_tax_rate), 2);
      v_line_tax := round(v_product.price * v_qty * v_tax_rate, 2);
    end if;
    v_total := v_total + v_line_total;
    v_tax := v_tax + v_line_tax;
    insert into public.sale_items (company_id, sale_id, product_id, product_name, qty, unit_price, total, cost)
    values (v_company_id, v_sale_id, v_product.id, v_product.name, v_qty, v_product.price, v_line_total, v_product.cost);
    update public.products set stock = stock - v_qty where id = v_product.id;
    insert into public.stock_movements (company_id, product_id, movement_type, qty, reference_type, reference_id, notes)
    values (v_company_id, v_product.id, 'sale', -v_qty, 'sale', v_sale_id, 'Venta POS');
  end loop;
  v_subtotal := v_total - v_tax;
  update public.sales set subtotal = v_subtotal, tax = v_tax, total = v_total where id = v_sale_id;
  return v_sale_id;
end;
$$;