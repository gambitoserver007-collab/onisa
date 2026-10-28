-- Tienda Agil MVP schema
-- Multiempresa POS con demo read-only reforzado por RLS.

create extension if not exists pgcrypto;

do $$
begin
  create type public.app_role as enum ('user', 'admin');
exception
  when duplicate_object then null;
end $$;

do $$
begin
  create type public.demo_mode as enum ('none', 'read_only');
exception
  when duplicate_object then null;
end $$;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric(12, 2) not null default 0,
  product_limit integer not null default 0,
  user_limit integer not null default 1,
  monthly_sales_limit integer not null default 0,
  is_active boolean not null default true,
  is_demo_data boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_email text,
  fiscal_id text,
  fiscal_id_label text not null default 'ID fiscal',
  address text,
  phone text,
  country_code text not null default 'PE',
  currency_code text not null default 'PEN',
  locale text not null default 'es-PE',
  tax_name text not null default 'Impuesto demo',
  tax_rate numeric(5, 4) not null default 0.18,
  plan_id uuid references public.subscription_plans(id) on delete set null,
  subscription_status text not null default 'trial',
  expires_at date,
  is_demo_data boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid references public.companies(id) on delete set null,
  email text not null,
  full_name text not null,
  role public.app_role not null default 'user',
  is_demo boolean not null default false,
  demo_mode public.demo_mode not null default 'none',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  is_demo_data boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (company_id, name)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  name text not null,
  barcode text,
  cost numeric(12, 2) not null default 0,
  price numeric(12, 2) not null default 0,
  stock numeric(12, 3) not null default 0,
  unit text not null default 'und',
  active boolean not null default true,
  is_demo_data boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists products_company_barcode_unique
  on public.products(company_id, barcode)
  where barcode is not null and deleted_at is null;

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  document_number text,
  phone text,
  email text,
  is_demo_data boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  document_number text,
  phone text,
  email text,
  is_demo_data boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  customer_id uuid references public.customers(id) on delete set null,
  sale_number text not null,
  document_type text not null default 'Ticket',
  payment_method text not null default 'Efectivo',
  customer_name text not null default 'Publico general',
  sale_date timestamptz not null default now(),
  subtotal numeric(12, 2) not null default 0,
  tax numeric(12, 2) not null default 0,
  total numeric(12, 2) not null default 0,
  status text not null default 'completed',
  created_by uuid references public.profiles(id) on delete set null,
  is_demo_data boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (company_id, sale_number)
);

create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  product_name text not null,
  qty numeric(12, 3) not null default 1,
  unit_price numeric(12, 2) not null default 0,
  total numeric(12, 2) not null default 0,
  cost numeric(12, 2) not null default 0,
  is_demo_data boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  supplier_id uuid references public.suppliers(id) on delete set null,
  purchase_number text not null,
  document_number text,
  purchase_date date not null default current_date,
  total numeric(12, 2) not null default 0,
  status text not null default 'registered',
  is_demo_data boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (company_id, purchase_number)
);

create table if not exists public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  qty numeric(12, 3) not null default 1,
  unit_cost numeric(12, 2) not null default 0,
  total numeric(12, 2) not null default 0,
  is_demo_data boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.promotions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  promotion_type text not null,
  value_text text,
  value_amount numeric(12, 2),
  starts_at date,
  ends_at date,
  active boolean not null default true,
  is_demo_data boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists public.cash_sessions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  opened_by uuid references public.profiles(id) on delete set null,
  closed_by uuid references public.profiles(id) on delete set null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opening_amount numeric(12, 2) not null default 0,
  expected_amount numeric(12, 2) not null default 0,
  real_amount numeric(12, 2),
  difference numeric(12, 2),
  status text not null default 'open',
  is_demo_data boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cash_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  cash_session_id uuid references public.cash_sessions(id) on delete cascade,
  movement_type text not null,
  concept text not null,
  amount numeric(12, 2) not null,
  movement_at timestamptz not null default now(),
  is_demo_data boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete cascade,
  movement_type text not null,
  qty numeric(12, 3) not null,
  reference_type text,
  reference_id uuid,
  notes text,
  is_demo_data boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.returns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  sale_id uuid references public.sales(id) on delete set null,
  return_number text not null,
  reason text not null,
  total numeric(12, 2) not null default 0,
  status text not null default 'processed',
  is_demo_data boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (company_id, return_number)
);

create index if not exists profiles_company_idx on public.profiles(company_id);
create index if not exists categories_company_idx on public.categories(company_id);
create index if not exists products_company_idx on public.products(company_id);
create index if not exists products_category_idx on public.products(category_id);
create index if not exists customers_company_idx on public.customers(company_id);
create index if not exists suppliers_company_idx on public.suppliers(company_id);
create index if not exists sales_company_date_idx on public.sales(company_id, sale_date desc);
create index if not exists sale_items_sale_idx on public.sale_items(sale_id);
create index if not exists purchases_company_date_idx on public.purchases(company_id, purchase_date desc);
create index if not exists stock_movements_product_idx on public.stock_movements(product_id, created_at desc);

drop trigger if exists touch_subscription_plans_updated_at on public.subscription_plans;
create trigger touch_subscription_plans_updated_at before update on public.subscription_plans for each row execute function public.touch_updated_at();
drop trigger if exists touch_companies_updated_at on public.companies;
create trigger touch_companies_updated_at before update on public.companies for each row execute function public.touch_updated_at();
drop trigger if exists touch_profiles_updated_at on public.profiles;
create trigger touch_profiles_updated_at before update on public.profiles for each row execute function public.touch_updated_at();
drop trigger if exists touch_categories_updated_at on public.categories;
create trigger touch_categories_updated_at before update on public.categories for each row execute function public.touch_updated_at();
drop trigger if exists touch_products_updated_at on public.products;
create trigger touch_products_updated_at before update on public.products for each row execute function public.touch_updated_at();
drop trigger if exists touch_customers_updated_at on public.customers;
create trigger touch_customers_updated_at before update on public.customers for each row execute function public.touch_updated_at();
drop trigger if exists touch_suppliers_updated_at on public.suppliers;
create trigger touch_suppliers_updated_at before update on public.suppliers for each row execute function public.touch_updated_at();
drop trigger if exists touch_sales_updated_at on public.sales;
create trigger touch_sales_updated_at before update on public.sales for each row execute function public.touch_updated_at();
drop trigger if exists touch_purchases_updated_at on public.purchases;
create trigger touch_purchases_updated_at before update on public.purchases for each row execute function public.touch_updated_at();
drop trigger if exists touch_promotions_updated_at on public.promotions;
create trigger touch_promotions_updated_at before update on public.promotions for each row execute function public.touch_updated_at();
drop trigger if exists touch_cash_sessions_updated_at on public.cash_sessions;
create trigger touch_cash_sessions_updated_at before update on public.cash_sessions for each row execute function public.touch_updated_at();
drop trigger if exists touch_returns_updated_at on public.returns;
create trigger touch_returns_updated_at before update on public.returns for each row execute function public.touch_updated_at();

create or replace function public.current_user_role()
returns public.app_role
language sql stable security definer set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and is_active = true limit 1;
$$;

create or replace function public.current_user_company_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select company_id from public.profiles where id = auth.uid() and is_active = true limit 1;
$$;

create or replace function public.current_user_is_demo()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select is_demo or demo_mode = 'read_only'::public.demo_mode
     from public.profiles
     where id = auth.uid() and is_active = true
     limit 1),
    false
  );
$$;

create or replace function public.can_select_company(p_company_id uuid, p_is_demo_data boolean default false)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    when auth.uid() is null then false
    when public.current_user_is_demo() and public.current_user_role() = 'admin'::public.app_role
      then coalesce(p_is_demo_data, false)
    when public.current_user_role() = 'admin'::public.app_role
      then true
    when public.current_user_is_demo()
      then p_company_id = public.current_user_company_id() and coalesce(p_is_demo_data, false)
    else p_company_id = public.current_user_company_id()
  end;
$$;

create or replace function public.can_write_company(p_company_id uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select auth.uid() is not null
    and not public.current_user_is_demo()
    and (
      public.current_user_role() = 'admin'::public.app_role
      or p_company_id = public.current_user_company_id()
    );
$$;

create or replace function public.reject_demo_write()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if public.current_user_is_demo() then
    raise exception 'Esta acción está deshabilitada en el Modo de Prueba.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public
as $$
declare
  v_company_id uuid;
  v_company_name text;
  v_country_code text;
  v_currency_code text;
  v_locale text;
begin
  v_company_name := coalesce(new.raw_user_meta_data ->> 'company_name', 'Mi Tienda Agil');
  v_country_code := coalesce(new.raw_user_meta_data ->> 'country_code', 'PE');
  v_currency_code := coalesce(new.raw_user_meta_data ->> 'currency_code', 'PEN');
  v_locale := coalesce(new.raw_user_meta_data ->> 'locale', 'es-PE');
  v_company_id := nullif(new.raw_user_meta_data ->> 'company_id', '')::uuid;
  if v_company_id is null then
    insert into public.companies (name, contact_email, country_code, currency_code, locale, fiscal_id_label, tax_name, tax_rate)
    values (v_company_name, new.email, v_country_code, v_currency_code, v_locale,
      coalesce(new.raw_user_meta_data ->> 'fiscal_id_label', 'ID fiscal'),
      coalesce(new.raw_user_meta_data ->> 'tax_name', 'Impuesto demo'),
      coalesce(nullif(new.raw_user_meta_data ->> 'tax_rate', '')::numeric, 0.18))
    returning id into v_company_id;
  end if;
  insert into public.profiles (id, company_id, email, full_name, role, is_demo, demo_mode)
  values (new.id, v_company_id, new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', v_company_name),
    'user', false, 'none')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_tienda_agil on auth.users;
create trigger on_auth_user_created_tienda_agil
after insert on auth.users
for each row execute function public.handle_new_user();

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
  if public.current_user_is_demo() then raise exception 'Esta acción está deshabilitada en el Modo de Prueba.'; end if;
  v_company_id := public.current_user_company_id();
  if v_company_id is null then raise exception 'El usuario no tiene empresa asociada.'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'El carrito estÃ¡ vacÃ­o.'; end if;
  select tax_rate into v_tax_rate from public.companies where id = v_company_id;
  v_tax_rate := coalesce(v_tax_rate, 0.18);
  select coalesce(name, 'Publico general') into v_customer_name
  from public.customers where id = p_customer_id and company_id = v_company_id and deleted_at is null;
  v_customer_name := coalesce(v_customer_name, 'Publico general');
  v_sale_number := 'V-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item ->> 'qty')::numeric, 0);
    v_price := nullif(v_item ->> 'price', '')::numeric;
    if v_qty <= 0 then raise exception 'Cantidad invÃ¡lida.'; end if;
    select * into v_product from public.products
      where id = (v_item ->> 'product_id')::uuid and company_id = v_company_id
      and deleted_at is null and active = true for update;
    if not found then raise exception 'Producto no encontrado.'; end if;
    if v_product.stock < v_qty then raise exception 'Stock insuficiente para %.', v_product.name; end if;
    v_price := coalesce(v_price, v_product.price);
    v_total := v_total + round(v_qty * v_price, 2);
  end loop;
  v_subtotal := round(v_total / (1 + v_tax_rate), 2);
  v_tax := round(v_total - v_subtotal, 2);
  insert into public.sales (company_id, customer_id, sale_number, document_type, payment_method, customer_name, subtotal, tax, total, created_by)
  values (v_company_id, p_customer_id, v_sale_number, coalesce(p_document_type, 'Ticket'), coalesce(p_payment_method, 'Efectivo'), v_customer_name, v_subtotal, v_tax, v_total, auth.uid())
  returning id into v_sale_id;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item ->> 'qty')::numeric, 0);
    v_price := nullif(v_item ->> 'price', '')::numeric;
    select * into v_product from public.products
      where id = (v_item ->> 'product_id')::uuid and company_id = v_company_id for update;
    v_price := coalesce(v_price, v_product.price);
    insert into public.sale_items (company_id, sale_id, product_id, product_name, qty, unit_price, total, cost)
    values (v_company_id, v_sale_id, v_product.id, v_product.name, v_qty, v_price, round(v_qty * v_price, 2), v_product.cost);
    update public.products set stock = stock - v_qty where id = v_product.id;
    insert into public.stock_movements (company_id, product_id, movement_type, qty, reference_type, reference_id, notes)
    values (v_company_id, v_product.id, 'sale', -v_qty, 'sale', v_sale_id, 'Venta POS');
  end loop;
  return v_sale_id;
end;
$$;

grant execute on function public.create_sale(uuid, text, text, jsonb) to authenticated;

alter table public.subscription_plans enable row level security;
alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.suppliers enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;
alter table public.promotions enable row level security;
alter table public.cash_sessions enable row level security;
alter table public.cash_movements enable row level security;
alter table public.stock_movements enable row level security;
alter table public.returns enable row level security;

drop policy if exists "plans select authenticated" on public.subscription_plans;
create policy "plans select authenticated" on public.subscription_plans for select to authenticated
using (case when public.current_user_is_demo() and public.current_user_role() = 'admin'::public.app_role then is_demo_data else true end);

drop policy if exists "plans write real admin" on public.subscription_plans;
create policy "plans write real admin" on public.subscription_plans for all to authenticated
using (public.current_user_role() = 'admin'::public.app_role and not public.current_user_is_demo())
with check (public.current_user_role() = 'admin'::public.app_role and not public.current_user_is_demo());

drop policy if exists "companies select scoped" on public.companies;
create policy "companies select scoped" on public.companies for select to authenticated
using (public.can_select_company(id, is_demo_data));
drop policy if exists "companies write scoped" on public.companies;
create policy "companies write scoped" on public.companies for all to authenticated
using (public.can_write_company(id)) with check (public.can_write_company(id));

drop policy if exists "profiles select scoped" on public.profiles;
create policy "profiles select scoped" on public.profiles for select to authenticated
using (
  id = auth.uid()
  or (public.current_user_role() = 'admin'::public.app_role and (not public.current_user_is_demo() or is_demo = true))
  or company_id = public.current_user_company_id()
);

drop policy if exists "profiles insert admin" on public.profiles;
create policy "profiles insert admin" on public.profiles for insert to authenticated
with check (public.current_user_role() = 'admin'::public.app_role and not public.current_user_is_demo());

drop policy if exists "profiles update scoped" on public.profiles;
create policy "profiles update scoped" on public.profiles for update to authenticated
using (not public.current_user_is_demo() and (id = auth.uid() or public.current_user_role() = 'admin'::public.app_role))
with check (not public.current_user_is_demo() and (id = auth.uid() or public.current_user_role() = 'admin'::public.app_role));

drop policy if exists "profiles delete admin" on public.profiles;
create policy "profiles delete admin" on public.profiles for delete to authenticated
using (public.current_user_role() = 'admin'::public.app_role and not public.current_user_is_demo());

drop policy if exists "categories select scoped" on public.categories;
create policy "categories select scoped" on public.categories for select to authenticated using (public.can_select_company(company_id, is_demo_data));
drop policy if exists "categories write scoped" on public.categories;
create policy "categories write scoped" on public.categories for all to authenticated using (public.can_write_company(company_id)) with check (public.can_write_company(company_id));

drop policy if exists "products select scoped" on public.products;
create policy "products select scoped" on public.products for select to authenticated using (public.can_select_company(company_id, is_demo_data));
drop policy if exists "products write scoped" on public.products;
create policy "products write scoped" on public.products for all to authenticated using (public.can_write_company(company_id)) with check (public.can_write_company(company_id));

drop policy if exists "customers select scoped" on public.customers;
create policy "customers select scoped" on public.customers for select to authenticated using (public.can_select_company(company_id, is_demo_data));
drop policy if exists "customers write scoped" on public.customers;
create policy "customers write scoped" on public.customers for all to authenticated using (public.can_write_company(company_id)) with check (public.can_write_company(company_id));

drop policy if exists "suppliers select scoped" on public.suppliers;
create policy "suppliers select scoped" on public.suppliers for select to authenticated using (public.can_select_company(company_id, is_demo_data));
drop policy if exists "suppliers write scoped" on public.suppliers;
create policy "suppliers write scoped" on public.suppliers for all to authenticated using (public.can_write_company(company_id)) with check (public.can_write_company(company_id));

drop policy if exists "sales select scoped" on public.sales;
create policy "sales select scoped" on public.sales for select to authenticated using (public.can_select_company(company_id, is_demo_data));
drop policy if exists "sales write scoped" on public.sales;
create policy "sales write scoped" on public.sales for all to authenticated using (public.can_write_company(company_id)) with check (public.can_write_company(company_id));

drop policy if exists "sale_items select scoped" on public.sale_items;
create policy "sale_items select scoped" on public.sale_items for select to authenticated using (public.can_select_company(company_id, is_demo_data));
drop policy if exists "sale_items write scoped" on public.sale_items;
create policy "sale_items write scoped" on public.sale_items for all to authenticated using (public.can_write_company(company_id)) with check (public.can_write_company(company_id));

drop policy if exists "purchases select scoped" on public.purchases;
create policy "purchases select scoped" on public.purchases for select to authenticated using (public.can_select_company(company_id, is_demo_data));
drop policy if exists "purchases write scoped" on public.purchases;
create policy "purchases write scoped" on public.purchases for all to authenticated using (public.can_write_company(company_id)) with check (public.can_write_company(company_id));

drop policy if exists "purchase_items select scoped" on public.purchase_items;
create policy "purchase_items select scoped" on public.purchase_items for select to authenticated using (public.can_select_company(company_id, is_demo_data));
drop policy if exists "purchase_items write scoped" on public.purchase_items;
create policy "purchase_items write scoped" on public.purchase_items for all to authenticated using (public.can_write_company(company_id)) with check (public.can_write_company(company_id));

drop policy if exists "promotions select scoped" on public.promotions;
create policy "promotions select scoped" on public.promotions for select to authenticated using (public.can_select_company(company_id, is_demo_data));
drop policy if exists "promotions write scoped" on public.promotions;
create policy "promotions write scoped" on public.promotions for all to authenticated using (public.can_write_company(company_id)) with check (public.can_write_company(company_id));

drop policy if exists "cash_sessions select scoped" on public.cash_sessions;
create policy "cash_sessions select scoped" on public.cash_sessions for select to authenticated using (public.can_select_company(company_id, is_demo_data));
drop policy if exists "cash_sessions write scoped" on public.cash_sessions;
create policy "cash_sessions write scoped" on public.cash_sessions for all to authenticated using (public.can_write_company(company_id)) with check (public.can_write_company(company_id));

drop policy if exists "cash_movements select scoped" on public.cash_movements;
create policy "cash_movements select scoped" on public.cash_movements for select to authenticated using (public.can_select_company(company_id, is_demo_data));
drop policy if exists "cash_movements write scoped" on public.cash_movements;
create policy "cash_movements write scoped" on public.cash_movements for all to authenticated using (public.can_write_company(company_id)) with check (public.can_write_company(company_id));

drop policy if exists "stock_movements select scoped" on public.stock_movements;
create policy "stock_movements select scoped" on public.stock_movements for select to authenticated using (public.can_select_company(company_id, is_demo_data));
drop policy if exists "stock_movements write scoped" on public.stock_movements;
create policy "stock_movements write scoped" on public.stock_movements for all to authenticated using (public.can_write_company(company_id)) with check (public.can_write_company(company_id));

drop policy if exists "returns select scoped" on public.returns;
create policy "returns select scoped" on public.returns for select to authenticated using (public.can_select_company(company_id, is_demo_data));
drop policy if exists "returns write scoped" on public.returns;
create policy "returns write scoped" on public.returns for all to authenticated using (public.can_write_company(company_id)) with check (public.can_write_company(company_id));

drop trigger if exists prevent_demo_products_write on public.products;
create trigger prevent_demo_products_write before insert or update or delete on public.products for each row execute function public.reject_demo_write();
drop trigger if exists prevent_demo_categories_write on public.categories;
create trigger prevent_demo_categories_write before insert or update or delete on public.categories for each row execute function public.reject_demo_write();
drop trigger if exists prevent_demo_customers_write on public.customers;
create trigger prevent_demo_customers_write before insert or update or delete on public.customers for each row execute function public.reject_demo_write();
drop trigger if exists prevent_demo_suppliers_write on public.suppliers;
create trigger prevent_demo_suppliers_write before insert or update or delete on public.suppliers for each row execute function public.reject_demo_write();
drop trigger if exists prevent_demo_sales_write on public.sales;
create trigger prevent_demo_sales_write before insert or update or delete on public.sales for each row execute function public.reject_demo_write();
drop trigger if exists prevent_demo_sale_items_write on public.sale_items;
create trigger prevent_demo_sale_items_write before insert or update or delete on public.sale_items for each row execute function public.reject_demo_write();
drop trigger if exists prevent_demo_purchases_write on public.purchases;
create trigger prevent_demo_purchases_write before insert or update or delete on public.purchases for each row execute function public.reject_demo_write();
drop trigger if exists prevent_demo_purchase_items_write on public.purchase_items;
create trigger prevent_demo_purchase_items_write before insert or update or delete on public.purchase_items for each row execute function public.reject_demo_write();
drop trigger if exists prevent_demo_promotions_write on public.promotions;
create trigger prevent_demo_promotions_write before insert or update or delete on public.promotions for each row execute function public.reject_demo_write();
drop trigger if exists prevent_demo_cash_sessions_write on public.cash_sessions;
create trigger prevent_demo_cash_sessions_write before insert or update or delete on public.cash_sessions for each row execute function public.reject_demo_write();
drop trigger if exists prevent_demo_cash_movements_write on public.cash_movements;
create trigger prevent_demo_cash_movements_write before insert or update or delete on public.cash_movements for each row execute function public.reject_demo_write();
drop trigger if exists prevent_demo_stock_movements_write on public.stock_movements;
create trigger prevent_demo_stock_movements_write before insert or update or delete on public.stock_movements for each row execute function public.reject_demo_write();
drop trigger if exists prevent_demo_returns_write on public.returns;
create trigger prevent_demo_returns_write before insert or update or delete on public.returns for each row execute function public.reject_demo_write();

-- GRANTs requeridos por Supabase Data API (PostgREST)
grant usage on schema public to anon, authenticated, service_role;
grant select on public.subscription_plans to authenticated;
grant all on public.subscription_plans to service_role;
grant select, insert, update, delete on public.companies to authenticated;
grant all on public.companies to service_role;
grant select, insert, update, delete on public.profiles to authenticated;
grant all on public.profiles to service_role;
grant select, insert, update, delete on public.categories to authenticated;
grant all on public.categories to service_role;
grant select, insert, update, delete on public.products to authenticated;
grant all on public.products to service_role;
grant select, insert, update, delete on public.customers to authenticated;
grant all on public.customers to service_role;
grant select, insert, update, delete on public.suppliers to authenticated;
grant all on public.suppliers to service_role;
grant select, insert, update, delete on public.sales to authenticated;
grant all on public.sales to service_role;
grant select, insert, update, delete on public.sale_items to authenticated;
grant all on public.sale_items to service_role;
grant select, insert, update, delete on public.purchases to authenticated;
grant all on public.purchases to service_role;
grant select, insert, update, delete on public.purchase_items to authenticated;
grant all on public.purchase_items to service_role;
grant select, insert, update, delete on public.promotions to authenticated;
grant all on public.promotions to service_role;
grant select, insert, update, delete on public.cash_sessions to authenticated;
grant all on public.cash_sessions to service_role;
grant select, insert, update, delete on public.cash_movements to authenticated;
grant all on public.cash_movements to service_role;
grant select, insert, update, delete on public.stock_movements to authenticated;
grant all on public.stock_movements to service_role;
grant select, insert, update, delete on public.returns to authenticated;
grant all on public.returns to service_role;

-- Seed: base plans only
insert into public.subscription_plans (
  id,
  name,
  price,
  product_limit,
  user_limit,
  monthly_sales_limit,
  is_demo_data
)
values
  ('00000000-0000-4000-8000-000000000101', 'Inicial', 0, 50, 1, 100, false),
  ('00000000-0000-4000-8000-000000000102', 'Basico', 49.90, 500, 3, 2000, false),
  ('00000000-0000-4000-8000-000000000103', 'Pro', 99.90, 5000, 10, 20000, false)
on conflict (id) do update set
  name = excluded.name,
  price = excluded.price,
  product_limit = excluded.product_limit,
  user_limit = excluded.user_limit,
  monthly_sales_limit = excluded.monthly_sales_limit,
  is_demo_data = false,
  updated_at = now();
