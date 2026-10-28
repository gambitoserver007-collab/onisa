-- 1) locations
create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null, address text,
  is_active boolean not null default true,
  is_demo_data boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists locations_company_idx on public.locations(company_id);
grant select, insert, update, delete on public.locations to authenticated;
grant all on public.locations to service_role;
alter table public.locations enable row level security;
drop policy if exists "locations select scoped" on public.locations;
create policy "locations select scoped" on public.locations for select to authenticated using (public.can_select_company(company_id, is_demo_data));
drop policy if exists "locations write scoped" on public.locations;
create policy "locations write scoped" on public.locations for all to authenticated using (public.can_write_company(company_id)) with check (public.can_write_company(company_id));
drop trigger if exists touch_locations_updated_at on public.locations;
create trigger touch_locations_updated_at before update on public.locations for each row execute function public.touch_updated_at();
insert into public.locations (company_id, name, is_demo_data)
select c.id, 'Principal', c.is_demo_data from public.companies c
where not exists (select 1 from public.locations l where l.company_id = c.id);

-- 2) product_locations
create table if not exists public.product_locations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  stock numeric(12,3) not null default 0,
  is_active boolean not null default true,
  is_demo_data boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, location_id)
);
create index if not exists product_locations_location_idx on public.product_locations(location_id);
create index if not exists product_locations_product_idx on public.product_locations(product_id);
grant select, insert, update, delete on public.product_locations to authenticated;
grant all on public.product_locations to service_role;
alter table public.product_locations enable row level security;
drop policy if exists "product_locations select scoped" on public.product_locations;
create policy "product_locations select scoped" on public.product_locations for select to authenticated using (public.can_select_company(company_id, is_demo_data));
drop policy if exists "product_locations write scoped" on public.product_locations;
create policy "product_locations write scoped" on public.product_locations for all to authenticated using (public.can_write_company(company_id)) with check (public.can_write_company(company_id));
drop trigger if exists touch_product_locations_updated_at on public.product_locations;
create trigger touch_product_locations_updated_at before update on public.product_locations for each row execute function public.touch_updated_at();

-- 3) location_id en tablas transaccionales
do $$ declare t text; begin
  foreach t in array array['sales','sale_items','stock_movements','cash_sessions','cash_movements','purchases','returns','profiles','promotions'] loop
    execute format('alter table public.%I add column if not exists location_id uuid references public.locations(id) on delete set null', t);
  end loop;
end $$;

-- 4) backfill
insert into public.product_locations (company_id, product_id, location_id, stock, is_demo_data)
select p.company_id, p.id, l.id, coalesce(p.stock,0), coalesce(p.is_demo_data,false)
from public.products p join public.locations l on l.company_id = p.company_id and l.name='Principal'
where p.deleted_at is null
on conflict (product_id, location_id) do nothing;

do $$ declare t text; begin
  foreach t in array array['sales','sale_items','stock_movements','cash_sessions','cash_movements','purchases','returns','profiles'] loop
    execute format('update public.%I x set location_id = l.id from public.locations l where l.company_id = x.company_id and l.name=''Principal'' and x.location_id is null', t);
  end loop;
end $$;

-- 5) trigger en companies
create or replace function public.create_default_location()
returns trigger language plpgsql security definer set search_path = public as $$
begin insert into public.locations (company_id, name, is_demo_data) values (new.id, 'Principal', new.is_demo_data); return new; end; $$;
drop trigger if exists companies_create_default_location on public.companies;
create trigger companies_create_default_location after insert on public.companies for each row execute function public.create_default_location();

-- 6) create_sale
drop function if exists public.create_sale(uuid, text, text, jsonb);
drop function if exists public.create_sale(uuid, text, text, jsonb, uuid);
create or replace function public.create_sale(
  p_customer_id uuid, p_document_type text, p_payment_method text, p_items jsonb, p_location_id uuid default null
) returns uuid language plpgsql security invoker set search_path = public as $$
declare
  v_company_id uuid; v_location_id uuid; v_tax_rate numeric(5,4); v_doc_types jsonb; v_charges_iva boolean;
  v_sale_id uuid; v_customer_name text; v_item jsonb; v_product public.products%rowtype; v_loc_stock numeric(12,3);
  v_qty numeric(12,3); v_line_total numeric(12,2); v_line_tax numeric(12,2);
  v_total numeric(12,2) := 0; v_tax numeric(12,2) := 0; v_subtotal numeric(12,2); v_sale_number text;
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
  end loop;
  v_subtotal := v_total - v_tax;
  update public.sales set subtotal = v_subtotal, tax = v_tax, total = v_total where id = v_sale_id;
  return v_sale_id;
end; $$;
revoke execute on function public.create_sale(uuid, text, text, jsonb, uuid) from public, anon;
grant execute on function public.create_sale(uuid, text, text, jsonb, uuid) to authenticated, service_role;