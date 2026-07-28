
-- 1) companies.business_type
alter table public.companies add column if not exists business_type text not null default 'general';

-- 2) products: has_variants + variant_attributes
alter table public.products add column if not exists has_variants boolean not null default false;
alter table public.products add column if not exists variant_attributes text[] null;

-- 3) product_variants
create table if not exists public.product_variants (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  attributes jsonb not null default '{}'::jsonb,
  barcode text null,
  sku text null,
  price_override numeric(12,2) null,
  cost_override numeric(12,2) null,
  is_active boolean not null default true,
  is_demo_data boolean not null default false,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

grant select, insert, update, delete on public.product_variants to authenticated;
grant all on public.product_variants to service_role;

create unique index if not exists product_variants_company_barcode_unique
  on public.product_variants (company_id, barcode) where barcode is not null;
create index if not exists product_variants_product_idx on public.product_variants(product_id);
create index if not exists product_variants_company_idx on public.product_variants(company_id);

alter table public.product_variants enable row level security;

drop policy if exists "product_variants select scoped" on public.product_variants;
create policy "product_variants select scoped" on public.product_variants
  for select to authenticated
  using (public.can_select_company(company_id, is_demo_data));

drop policy if exists "product_variants write scoped" on public.product_variants;
create policy "product_variants write scoped" on public.product_variants
  for all to authenticated
  using (public.can_write_company(company_id))
  with check (public.can_write_company(company_id));

drop trigger if exists product_variants_touch_updated_at on public.product_variants;
create trigger product_variants_touch_updated_at before update on public.product_variants
  for each row execute function public.touch_updated_at();

drop trigger if exists product_variants_reject_demo_write on public.product_variants;
create trigger product_variants_reject_demo_write before insert or update or delete on public.product_variants
  for each row execute function public.reject_demo_write();

-- 4) product_variant_locations
create table if not exists public.product_variant_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  product_variant_id uuid not null references public.product_variants(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  stock numeric(12,3) not null default 0,
  is_active boolean not null default true,
  is_demo_data boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_variant_id, location_id)
);

grant select, insert, update, delete on public.product_variant_locations to authenticated;
grant all on public.product_variant_locations to service_role;

create index if not exists pvl_company_idx on public.product_variant_locations(company_id);
create index if not exists pvl_location_idx on public.product_variant_locations(location_id);

alter table public.product_variant_locations enable row level security;

drop policy if exists "product_variant_locations select scoped" on public.product_variant_locations;
create policy "product_variant_locations select scoped" on public.product_variant_locations
  for select to authenticated
  using (public.can_select_company(company_id, is_demo_data));

drop policy if exists "product_variant_locations write scoped" on public.product_variant_locations;
create policy "product_variant_locations write scoped" on public.product_variant_locations
  for all to authenticated
  using (public.can_write_company(company_id) and public.user_can_access_location(location_id))
  with check (public.can_write_company(company_id) and public.user_can_access_location(location_id));

drop trigger if exists pvl_touch_updated_at on public.product_variant_locations;
create trigger pvl_touch_updated_at before update on public.product_variant_locations
  for each row execute function public.touch_updated_at();

drop trigger if exists pvl_reject_demo_write on public.product_variant_locations;
create trigger pvl_reject_demo_write before insert or update or delete on public.product_variant_locations
  for each row execute function public.reject_demo_write();

-- 5) Nullable variant ref columns in existing tables
alter table public.sale_items add column if not exists product_variant_id uuid null references public.product_variants(id);
alter table public.sale_items add column if not exists variant_label text null;
alter table public.purchase_items add column if not exists product_variant_id uuid null references public.product_variants(id);
alter table public.stock_movements add column if not exists product_variant_id uuid null references public.product_variants(id);

-- 6) Update create_sale to support optional variant_id per item
create or replace function public.create_sale(p_customer_id uuid, p_document_type text, p_payment_method text, p_items jsonb, p_location_id uuid default null)
returns uuid
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

    v_variant_id := nullif(v_item ->> 'variant_id','')::uuid;

    if v_variant_id is not null then
      select * into v_variant from public.product_variants
        where id = v_variant_id and product_id = v_product.id and company_id = v_company_id
          and is_active = true and deleted_at is null;
      if not found then raise exception 'Variante no encontrada para el producto %.', v_product.name; end if;

      v_unit_price := coalesce(v_variant.price_override, v_product.price);
      v_unit_cost  := coalesce(v_variant.cost_override, v_product.cost);

      select stock into v_loc_stock from public.product_variant_locations
        where product_variant_id = v_variant.id and location_id = v_location_id for update;
      if not found then raise exception 'El producto % no esta asignado a este punto de venta.', v_product.name; end if;
      if v_loc_stock < v_qty then raise exception 'Stock insuficiente para % en este local.', v_product.name; end if;

      if not v_charges_iva then
        v_line_total := round(v_unit_price * v_qty, 2); v_line_tax := 0;
      elsif coalesce(v_product.price_includes_tax, true) then
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

      insert into public.sale_items (company_id, location_id, sale_id, product_id, product_variant_id, variant_label, product_name, qty, unit_price, total, cost)
      values (v_company_id, v_location_id, v_sale_id, v_product.id, v_variant.id, v_variant_label, v_product.name, v_qty, v_unit_price, v_line_total, v_unit_cost);

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
      select stock into v_loc_stock from public.product_locations where product_id = v_product.id and location_id = v_location_id for update;
      if not found then raise exception 'El producto % no esta asignado a este punto de venta.', v_product.name; end if;
      if v_loc_stock < v_qty then raise exception 'Stock insuficiente para % en este local.', v_product.name; end if;
      if not v_charges_iva then v_line_total := round(v_product.price * v_qty, 2); v_line_tax := 0;
      elsif coalesce(v_product.price_includes_tax, true) then
        v_line_total := round(v_product.price * v_qty, 2); v_line_tax := round(v_line_total - v_line_total/(1+v_tax_rate), 2);
      else
        v_line_total := round(v_product.price * v_qty * (1+v_tax_rate), 2); v_line_tax := round(v_product.price * v_qty * v_tax_rate, 2);
      end if;
      v_total := v_total + v_line_total; v_tax := v_tax + v_line_tax;
      insert into public.sale_items (company_id, location_id, sale_id, product_id, product_name, qty, unit_price, total, cost)
      values (v_company_id, v_location_id, v_sale_id, v_product.id, v_product.name, v_qty, v_product.price, v_line_total, v_product.cost);
      update public.product_locations set stock = stock - v_qty, updated_at = now() where product_id = v_product.id and location_id = v_location_id;
      update public.products set stock = (select coalesce(sum(stock),0) from public.product_locations where product_id = v_product.id) where id = v_product.id;
      insert into public.stock_movements (company_id, location_id, product_id, movement_type, qty, reference_type, reference_id, notes)
      values (v_company_id, v_location_id, v_product.id, 'sale', -v_qty, 'sale', v_sale_id, 'Venta POS');
    end if;
  end loop;

  v_subtotal := v_total - v_tax;
  update public.sales set subtotal = v_subtotal, tax = v_tax, total = v_total where id = v_sale_id;
  return v_sale_id;
end; $function$;
