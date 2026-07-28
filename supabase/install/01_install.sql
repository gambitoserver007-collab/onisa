-- ==================================================================
-- Tienda Agil - Instalador Supabase (esquema completo)
--
-- Recrea TODO el esquema en un proyecto Supabase NUEVO y externo:
-- extensiones, tipos, tablas, indices, funciones, triggers, RLS,
-- politicas y RPC, mas los datos base (planes, ajustes de pais).
--
-- Como usar: es el UNICO archivo de instalacion. Pega y ejecuta este
-- archivo UNA vez en el SQL Editor de tu proyecto Supabase.
-- Despues crea el usuario admin en Auth y ejecuta:
--   select public.bootstrap_owner_profile('superadmin@user.test');
--
-- NO ejecutes la carpeta migrations/ (es solo historial de desarrollo).
-- No incluye cuentas demo ni limpiezas especificas de produccion.
-- ==================================================================


-- ============================================================
-- 202606170001_init_tienda_agil.sql
-- ============================================================
﻿-- Tienda Agil MVP schema
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
create trigger touch_subscription_plans_updated_at
before update on public.subscription_plans
for each row execute function public.touch_updated_at();

drop trigger if exists touch_companies_updated_at on public.companies;
create trigger touch_companies_updated_at
before update on public.companies
for each row execute function public.touch_updated_at();

drop trigger if exists touch_profiles_updated_at on public.profiles;
create trigger touch_profiles_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

drop trigger if exists touch_categories_updated_at on public.categories;
create trigger touch_categories_updated_at
before update on public.categories
for each row execute function public.touch_updated_at();

drop trigger if exists touch_products_updated_at on public.products;
create trigger touch_products_updated_at
before update on public.products
for each row execute function public.touch_updated_at();

drop trigger if exists touch_customers_updated_at on public.customers;
create trigger touch_customers_updated_at
before update on public.customers
for each row execute function public.touch_updated_at();

drop trigger if exists touch_suppliers_updated_at on public.suppliers;
create trigger touch_suppliers_updated_at
before update on public.suppliers
for each row execute function public.touch_updated_at();

drop trigger if exists touch_sales_updated_at on public.sales;
create trigger touch_sales_updated_at
before update on public.sales
for each row execute function public.touch_updated_at();

drop trigger if exists touch_purchases_updated_at on public.purchases;
create trigger touch_purchases_updated_at
before update on public.purchases
for each row execute function public.touch_updated_at();

drop trigger if exists touch_promotions_updated_at on public.promotions;
create trigger touch_promotions_updated_at
before update on public.promotions
for each row execute function public.touch_updated_at();

drop trigger if exists touch_cash_sessions_updated_at on public.cash_sessions;
create trigger touch_cash_sessions_updated_at
before update on public.cash_sessions
for each row execute function public.touch_updated_at();

drop trigger if exists touch_returns_updated_at on public.returns;
create trigger touch_returns_updated_at
before update on public.returns
for each row execute function public.touch_updated_at();

create or replace function public.current_user_role()
returns public.app_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid() and is_active = true limit 1;
$$;

create or replace function public.current_user_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select company_id from public.profiles where id = auth.uid() and is_active = true limit 1;
$$;

create or replace function public.current_user_is_demo()
returns boolean
language sql
stable
security definer
set search_path = public
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
language sql
stable
security definer
set search_path = public
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
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and not public.current_user_is_demo()
    and (
      public.current_user_role() = 'admin'::public.app_role
      or p_company_id = public.current_user_company_id()
    );
$$;

create or replace function public.reject_demo_write()
returns trigger
language plpgsql
security definer
set search_path = public
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
returns trigger
language plpgsql
security definer
set search_path = public
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
    insert into public.companies (
      name,
      contact_email,
      country_code,
      currency_code,
      locale,
      fiscal_id_label,
      tax_name,
      tax_rate
    )
    values (
      v_company_name,
      new.email,
      v_country_code,
      v_currency_code,
      v_locale,
      coalesce(new.raw_user_meta_data ->> 'fiscal_id_label', 'ID fiscal'),
      coalesce(new.raw_user_meta_data ->> 'tax_name', 'Impuesto demo'),
      coalesce(nullif(new.raw_user_meta_data ->> 'tax_rate', '')::numeric, 0.18)
    )
    returning id into v_company_id;
  end if;

  insert into public.profiles (
    id,
    company_id,
    email,
    full_name,
    role,
    is_demo,
    demo_mode
  )
  values (
    new.id,
    v_company_id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', v_company_name),
    'user',
    false,
    'none'
  )
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
language plpgsql
security invoker
set search_path = public
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
  if auth.uid() is null then
    raise exception 'No autenticado.';
  end if;

  if public.current_user_is_demo() then
    raise exception 'Esta acción está deshabilitada en el Modo de Prueba.';
  end if;

  v_company_id := public.current_user_company_id();
  if v_company_id is null then
    raise exception 'El usuario no tiene empresa asociada.';
  end if;

  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'El carrito estÃ¡ vacÃ­o.';
  end if;

  select tax_rate into v_tax_rate from public.companies where id = v_company_id;
  v_tax_rate := coalesce(v_tax_rate, 0.18);

  select coalesce(name, 'Publico general')
  into v_customer_name
  from public.customers
  where id = p_customer_id and company_id = v_company_id and deleted_at is null;

  v_customer_name := coalesce(v_customer_name, 'Publico general');
  v_sale_number := 'V-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := coalesce((v_item ->> 'qty')::numeric, 0);
    v_price := nullif(v_item ->> 'price', '')::numeric;

    if v_qty <= 0 then
      raise exception 'Cantidad invÃ¡lida.';
    end if;

    select *
    into v_product
    from public.products
    where id = (v_item ->> 'product_id')::uuid
      and company_id = v_company_id
      and deleted_at is null
      and active = true
    for update;

    if not found then
      raise exception 'Producto no encontrado.';
    end if;

    if v_product.stock < v_qty then
      raise exception 'Stock insuficiente para %.', v_product.name;
    end if;

    v_price := coalesce(v_price, v_product.price);
    v_total := v_total + round(v_qty * v_price, 2);
  end loop;

  v_subtotal := round(v_total / (1 + v_tax_rate), 2);
  v_tax := round(v_total - v_subtotal, 2);

  insert into public.sales (
    company_id,
    customer_id,
    sale_number,
    document_type,
    payment_method,
    customer_name,
    subtotal,
    tax,
    total,
    created_by
  )
  values (
    v_company_id,
    p_customer_id,
    v_sale_number,
    coalesce(p_document_type, 'Ticket'),
    coalesce(p_payment_method, 'Efectivo'),
    v_customer_name,
    v_subtotal,
    v_tax,
    v_total,
    auth.uid()
  )
  returning id into v_sale_id;

  for v_item in select * from jsonb_array_elements(p_items)
  loop
    v_qty := coalesce((v_item ->> 'qty')::numeric, 0);
    v_price := nullif(v_item ->> 'price', '')::numeric;

    select *
    into v_product
    from public.products
    where id = (v_item ->> 'product_id')::uuid
      and company_id = v_company_id
    for update;

    v_price := coalesce(v_price, v_product.price);

    insert into public.sale_items (
      company_id,
      sale_id,
      product_id,
      product_name,
      qty,
      unit_price,
      total,
      cost
    )
    values (
      v_company_id,
      v_sale_id,
      v_product.id,
      v_product.name,
      v_qty,
      v_price,
      round(v_qty * v_price, 2),
      v_product.cost
    );

    update public.products
    set stock = stock - v_qty
    where id = v_product.id;

    insert into public.stock_movements (
      company_id,
      product_id,
      movement_type,
      qty,
      reference_type,
      reference_id,
      notes
    )
    values (
      v_company_id,
      v_product.id,
      'sale',
      -v_qty,
      'sale',
      v_sale_id,
      'Venta POS'
    );
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
create policy "plans select authenticated"
on public.subscription_plans for select
to authenticated
using (
  case
    when public.current_user_is_demo() and public.current_user_role() = 'admin'::public.app_role
      then is_demo_data
    else true
  end
);

drop policy if exists "plans write real admin" on public.subscription_plans;
create policy "plans write real admin"
on public.subscription_plans for all
to authenticated
using (public.current_user_role() = 'admin'::public.app_role and not public.current_user_is_demo())
with check (public.current_user_role() = 'admin'::public.app_role and not public.current_user_is_demo());

drop policy if exists "companies select scoped" on public.companies;
create policy "companies select scoped"
on public.companies for select
to authenticated
using (public.can_select_company(id, is_demo_data));

drop policy if exists "companies write scoped" on public.companies;
create policy "companies write scoped"
on public.companies for all
to authenticated
using (public.can_write_company(id))
with check (public.can_write_company(id));

drop policy if exists "profiles select scoped" on public.profiles;
create policy "profiles select scoped"
on public.profiles for select
to authenticated
using (
  id = auth.uid()
  or (
    public.current_user_role() = 'admin'::public.app_role
    and (
      not public.current_user_is_demo()
      or is_demo = true
    )
  )
  or company_id = public.current_user_company_id()
);

drop policy if exists "profiles insert admin" on public.profiles;
create policy "profiles insert admin"
on public.profiles for insert
to authenticated
with check (public.current_user_role() = 'admin'::public.app_role and not public.current_user_is_demo());

drop policy if exists "profiles update scoped" on public.profiles;
create policy "profiles update scoped"
on public.profiles for update
to authenticated
using (
  not public.current_user_is_demo()
  and (
    id = auth.uid()
    or public.current_user_role() = 'admin'::public.app_role
  )
)
with check (
  not public.current_user_is_demo()
  and (
    id = auth.uid()
    or public.current_user_role() = 'admin'::public.app_role
  )
);

drop policy if exists "profiles delete admin" on public.profiles;
create policy "profiles delete admin"
on public.profiles for delete
to authenticated
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


-- ============================================================
-- 20260617235322_16db5c81-054a-4065-bf63-d8301c47d869.sql
-- ============================================================
﻿-- Tienda Agil MVP schema
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


-- ============================================================
-- 202606180001_private_owner_access.sql
-- ============================================================
-- Initial administrator account support.
-- Create the Auth user manually, then run:
-- select public.bootstrap_owner_profile();

insert into public.companies (
  id,
  name,
  contact_email,
  fiscal_id_label,
  country_code,
  currency_code,
  locale,
  tax_name,
  tax_rate,
  plan_id,
  subscription_status,
  is_demo_data
)
values (
  '00000000-0000-4000-8000-000000000010',
  'Mi Tienda Agil',
  'owner@tiendaagil.test',
  'RUC',
  'PE',
  'PEN',
  'es-PE',
  'IGV',
  0.18,
  '00000000-0000-4000-8000-000000000103',
  'active',
  false
)
on conflict (id) do update set
  name = excluded.name,
  contact_email = excluded.contact_email,
  fiscal_id_label = excluded.fiscal_id_label,
  country_code = excluded.country_code,
  currency_code = excluded.currency_code,
  locale = excluded.locale,
  tax_name = excluded.tax_name,
  tax_rate = excluded.tax_rate,
  plan_id = excluded.plan_id,
  subscription_status = excluded.subscription_status,
  is_demo_data = false;

create or replace function public.sync_profile_email_from_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.profiles
  set email = new.email,
      updated_at = now()
  where id = new.id;

  return new;
end;
$$;

drop trigger if exists on_auth_user_email_updated_tienda_agil on auth.users;
create trigger on_auth_user_email_updated_tienda_agil
after update of email on auth.users
for each row
when (old.email is distinct from new.email)
execute function public.sync_profile_email_from_auth_user();

create or replace function public.bootstrap_owner_profile(
  p_owner_email text default 'owner@tiendaagil.test'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
  v_email text;
begin
  select id, email
  into v_user_id, v_email
  from auth.users
  where lower(email) = lower(p_owner_email)
  limit 1;

  if v_user_id is null then
    raise exception 'Create Auth user % first, then run bootstrap_owner_profile().', p_owner_email;
  end if;

  update public.companies
  set contact_email = v_email,
      updated_at = now()
  where id = '00000000-0000-4000-8000-000000000010';

  insert into public.profiles (
    id,
    company_id,
    email,
    full_name,
    role,
    is_demo,
    demo_mode,
    is_active
  )
  values (
    v_user_id,
    '00000000-0000-4000-8000-000000000010',
    v_email,
    'Owner Tienda Agil',
    'admin',
    false,
    'none',
    true
  )
  on conflict (id) do update set
    company_id = excluded.company_id,
    email = excluded.email,
    full_name = excluded.full_name,
    role = 'admin',
    is_demo = false,
    demo_mode = 'none',
    is_active = true,
    updated_at = now();
end;
$$;

revoke all on function public.sync_profile_email_from_auth_user() from public, anon, authenticated;
revoke all on function public.bootstrap_owner_profile(text) from public, anon, authenticated;
grant execute on function public.bootstrap_owner_profile(text) to service_role;


-- ============================================================
-- 20260618034723_090fa6bd-753e-4cca-b97e-7fa147ae2c56.sql
-- ============================================================
-- Initial administrator account support.
insert into public.companies (
  id, name, contact_email, fiscal_id_label, country_code, currency_code, locale,
  tax_name, tax_rate, plan_id, subscription_status, is_demo_data
) values (
  '00000000-0000-4000-8000-000000000010', 'Mi Tienda Agil', 'owner@tiendaagil.test',
  'RUC', 'PE', 'PEN', 'es-PE', 'IGV', 0.18,
  '00000000-0000-4000-8000-000000000103', 'active', false
)
on conflict (id) do update set
  name = excluded.name, contact_email = excluded.contact_email,
  fiscal_id_label = excluded.fiscal_id_label, country_code = excluded.country_code,
  currency_code = excluded.currency_code, locale = excluded.locale,
  tax_name = excluded.tax_name, tax_rate = excluded.tax_rate,
  plan_id = excluded.plan_id, subscription_status = excluded.subscription_status,
  is_demo_data = false;

create or replace function public.sync_profile_email_from_auth_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set email = new.email, updated_at = now() where id = new.id;
  return new;
end;
$$;

drop trigger if exists on_auth_user_email_updated_tienda_agil on auth.users;
create trigger on_auth_user_email_updated_tienda_agil
after update of email on auth.users
for each row when (old.email is distinct from new.email)
execute function public.sync_profile_email_from_auth_user();

create or replace function public.bootstrap_owner_profile(
  p_owner_email text default 'owner@tiendaagil.test'
) returns void language plpgsql security definer set search_path = public as $$
declare v_user_id uuid; v_email text;
begin
  select id, email into v_user_id, v_email
  from auth.users where lower(email) = lower(p_owner_email) limit 1;
  if v_user_id is null then
    raise exception 'Create Auth user % first, then run bootstrap_owner_profile().', p_owner_email;
  end if;
  update public.companies set contact_email = v_email, updated_at = now()
  where id = '00000000-0000-4000-8000-000000000010';
  insert into public.profiles (id, company_id, email, full_name, role, is_demo, demo_mode, is_active)
  values (v_user_id, '00000000-0000-4000-8000-000000000010', v_email, 'Owner Tienda Agil',
    'admin', false, 'none', true)
  on conflict (id) do update set
    company_id = excluded.company_id, email = excluded.email, full_name = excluded.full_name,
    role = 'admin', is_demo = false, demo_mode = 'none', is_active = true, updated_at = now();
end;
$$;

revoke all on function public.sync_profile_email_from_auth_user() from public, anon, authenticated;
revoke all on function public.bootstrap_owner_profile(text) from public, anon, authenticated;
grant execute on function public.bootstrap_owner_profile(text) to service_role;


-- ============================================================
-- 20260618152017_70f893d5-c557-4a01-a63f-fd07bcdaa0df.sql
-- ============================================================

-- Fix mutable search_path on touch_updated_at
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Revoke public EXECUTE on privileged bootstrap definer functions; only service_role can call them.
REVOKE EXECUTE ON FUNCTION public.bootstrap_demo_profiles() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.bootstrap_owner_profile(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.bootstrap_demo_profiles() TO service_role;
GRANT EXECUTE ON FUNCTION public.bootstrap_owner_profile(text) TO service_role;

-- create_sale should only be callable by signed-in users (not anon)
REVOKE EXECUTE ON FUNCTION public.create_sale(uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_sale(uuid, text, text, jsonb) TO authenticated, service_role;

-- reject_demo_write and sync_profile_email_from_auth_user are trigger-only; remove public execute.
REVOKE EXECUTE ON FUNCTION public.reject_demo_write() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_profile_email_from_auth_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.touch_updated_at() FROM PUBLIC, anon, authenticated;


-- ============================================================
-- 20260618235747_c4034d83-39a9-42e9-999b-fffd2c34d867.sql
-- ============================================================
create unique index if not exists products_company_barcode_unique
  on public.products (company_id, barcode)
  where barcode is not null and deleted_at is null;

-- ============================================================
-- 20260619031307_7d2cac43-537a-4921-9705-d485dd98251d.sql
-- ============================================================

-- 1) Add 'finanzas' to app_role enum (safe if not used in same tx)
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'finanzas';

-- 2) Add is_platform_admin column to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_platform_admin boolean NOT NULL DEFAULT false;

-- 3) Mark the SaaS owner as platform admin
UPDATE public.profiles p
SET is_platform_admin = true, updated_at = now()
FROM auth.users u
WHERE p.id = u.id
  AND lower(u.email) = 'owner@tiendaagil.test';

-- 4) Helper: is the current user a platform admin?
CREATE OR REPLACE FUNCTION public.current_user_is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT is_platform_admin
       FROM public.profiles
      WHERE id = auth.uid()
        AND is_active = true
        AND NOT is_demo
      LIMIT 1),
    false
  );
$$;

-- 5) Update scope helpers so cross-company access requires platform admin
CREATE OR REPLACE FUNCTION public.can_select_company(p_company_id uuid, p_is_demo_data boolean DEFAULT false)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN auth.uid() IS NULL THEN false
    WHEN public.current_user_is_platform_admin() THEN true
    WHEN public.current_user_is_demo() AND public.current_user_role() = 'admin'::public.app_role
      THEN COALESCE(p_is_demo_data, false)
    WHEN public.current_user_is_demo()
      THEN p_company_id = public.current_user_company_id() AND COALESCE(p_is_demo_data, false)
    ELSE p_company_id = public.current_user_company_id()
  END;
$$;

CREATE OR REPLACE FUNCTION public.can_write_company(p_company_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND NOT public.current_user_is_demo()
    AND (
      public.current_user_is_platform_admin()
      OR p_company_id = public.current_user_company_id()
    );
$$;

-- 6) Profiles policies: replace role='admin' global access with platform admin
DROP POLICY IF EXISTS "profiles select scoped" ON public.profiles;
CREATE POLICY "profiles select scoped" ON public.profiles
FOR SELECT
USING (
  id = auth.uid()
  OR public.current_user_is_platform_admin()
  OR company_id = public.current_user_company_id()
);

DROP POLICY IF EXISTS "profiles insert admin" ON public.profiles;
CREATE POLICY "profiles insert admin" ON public.profiles
FOR INSERT
WITH CHECK (
  public.current_user_is_platform_admin()
);

DROP POLICY IF EXISTS "profiles update scoped" ON public.profiles;
CREATE POLICY "profiles update scoped" ON public.profiles
FOR UPDATE
USING (
  NOT public.current_user_is_demo()
  AND (id = auth.uid() OR public.current_user_is_platform_admin())
)
WITH CHECK (
  NOT public.current_user_is_demo()
  AND (id = auth.uid() OR public.current_user_is_platform_admin())
);

DROP POLICY IF EXISTS "profiles delete admin" ON public.profiles;
CREATE POLICY "profiles delete admin" ON public.profiles
FOR DELETE
USING (
  public.current_user_is_platform_admin()
);

-- 7) subscription_plans write policy restricted to platform admin
DROP POLICY IF EXISTS "plans write real admin" ON public.subscription_plans;
CREATE POLICY "plans write platform admin" ON public.subscription_plans
FOR ALL
USING (public.current_user_is_platform_admin())
WITH CHECK (public.current_user_is_platform_admin());


-- ============================================================
-- 20260619054946_70418ec0-5b9e-4943-9c48-49892fea9474.sql
-- ============================================================

-- 1) companies.logo_url
ALTER TABLE public.companies ADD COLUMN IF NOT EXISTS logo_url text;

-- 2) platform_settings table
CREATE TABLE IF NOT EXISTS public.platform_settings (
  id uuid PRIMARY KEY,
  brand_name text NOT NULL DEFAULT 'Tienda Ágil',
  logo_url text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.platform_settings TO authenticated;
GRANT UPDATE ON public.platform_settings TO authenticated;
GRANT ALL ON public.platform_settings TO service_role;

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

INSERT INTO public.platform_settings (id, brand_name, logo_url)
VALUES ('00000000-0000-4000-8000-0000000000a1', 'Tienda Ágil', NULL)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "platform_settings select authenticated" ON public.platform_settings;
CREATE POLICY "platform_settings select authenticated"
  ON public.platform_settings FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "platform_settings update platform admin" ON public.platform_settings;
CREATE POLICY "platform_settings update platform admin"
  ON public.platform_settings FOR UPDATE
  TO authenticated
  USING (public.current_user_is_platform_admin())
  WITH CHECK (public.current_user_is_platform_admin());

DROP TRIGGER IF EXISTS touch_platform_settings_updated_at ON public.platform_settings;
CREATE TRIGGER touch_platform_settings_updated_at
  BEFORE UPDATE ON public.platform_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();


-- ============================================================
-- 20260619061459_acf95a79-f252-47fc-976c-70fc815947d6.sql
-- ============================================================
alter table public.products add column if not exists image_url text;

-- ============================================================
-- 20260619071444_86f56e52-fe62-403d-8fd1-18fb079a8e0f.sql
-- ============================================================
-- 1) Protect sensitive profile columns from self-escalation
CREATE OR REPLACE FUNCTION public.protect_profile_sensitive_columns()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR public.current_user_is_platform_admin() THEN
    RETURN NEW;
  END IF;
  IF NEW.role              IS DISTINCT FROM OLD.role
     OR NEW.is_platform_admin IS DISTINCT FROM OLD.is_platform_admin
     OR NEW.company_id     IS DISTINCT FROM OLD.company_id
     OR NEW.is_demo        IS DISTINCT FROM OLD.is_demo
     OR NEW.demo_mode      IS DISTINCT FROM OLD.demo_mode
     OR NEW.is_active      IS DISTINCT FROM OLD.is_active
  THEN
    RAISE EXCEPTION 'No tienes permiso para modificar campos protegidos del perfil.';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.protect_profile_sensitive_columns() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS protect_profile_sensitive_columns ON public.profiles;
CREATE TRIGGER protect_profile_sensitive_columns
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_sensitive_columns();

-- 2) create_sale: always use server-side price
CREATE OR REPLACE FUNCTION public.create_sale(
  p_customer_id uuid,
  p_document_type text,
  p_payment_method text,
  p_items jsonb
)
RETURNS uuid
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public
AS $$
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
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'El carrito está vacío.'; end if;
  select tax_rate into v_tax_rate from public.companies where id = v_company_id;
  v_tax_rate := coalesce(v_tax_rate, 0.18);
  select coalesce(name, 'Publico general') into v_customer_name
  from public.customers where id = p_customer_id and company_id = v_company_id and deleted_at is null;
  v_customer_name := coalesce(v_customer_name, 'Publico general');
  v_sale_number := 'V-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item ->> 'qty')::numeric, 0);
    if v_qty <= 0 then raise exception 'Cantidad inválida.'; end if;
    select * into v_product from public.products
      where id = (v_item ->> 'product_id')::uuid and company_id = v_company_id
      and deleted_at is null and active = true for update;
    if not found then raise exception 'Producto no encontrado.'; end if;
    if v_product.stock < v_qty then raise exception 'Stock insuficiente para %.', v_product.name; end if;
    v_price := v_product.price;
    v_total := v_total + round(v_qty * v_price, 2);
  end loop;

  v_subtotal := round(v_total / (1 + v_tax_rate), 2);
  v_tax := round(v_total - v_subtotal, 2);

  insert into public.sales (company_id, customer_id, sale_number, document_type, payment_method, customer_name, subtotal, tax, total, created_by)
  values (v_company_id, p_customer_id, v_sale_number, coalesce(p_document_type, 'Ticket'), coalesce(p_payment_method, 'Efectivo'), v_customer_name, v_subtotal, v_tax, v_total, auth.uid())
  returning id into v_sale_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item ->> 'qty')::numeric, 0);
    select * into v_product from public.products
      where id = (v_item ->> 'product_id')::uuid and company_id = v_company_id for update;
    v_price := v_product.price;
    insert into public.sale_items (company_id, sale_id, product_id, product_name, qty, unit_price, total, cost)
    values (v_company_id, v_sale_id, v_product.id, v_product.name, v_qty, v_price, round(v_qty * v_price, 2), v_product.cost);
    update public.products set stock = stock - v_qty where id = v_product.id;
    insert into public.stock_movements (company_id, product_id, movement_type, qty, reference_type, reference_id, notes)
    values (v_company_id, v_product.id, 'sale', -v_qty, 'sale', v_sale_id, 'Venta POS');
  end loop;
  return v_sale_id;
end;
$$;

REVOKE EXECUTE ON FUNCTION public.create_sale(uuid, text, text, jsonb) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.create_sale(uuid, text, text, jsonb) TO authenticated, service_role;

-- 3) Restrict RLS helper functions from anon
REVOKE EXECUTE ON FUNCTION public.current_user_role()             FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.current_user_role()             TO authenticated;
REVOKE EXECUTE ON FUNCTION public.current_user_company_id()       FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.current_user_company_id()       TO authenticated;
REVOKE EXECUTE ON FUNCTION public.current_user_is_demo()          FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.current_user_is_demo()          TO authenticated;
REVOKE EXECUTE ON FUNCTION public.current_user_is_platform_admin() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.current_user_is_platform_admin() TO authenticated;
REVOKE EXECUTE ON FUNCTION public.can_select_company(uuid, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_select_company(uuid, boolean) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.can_write_company(uuid)         FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.can_write_company(uuid)         TO authenticated;

-- ============================================================
-- 20260619072050_db1b3173-6596-46da-92b0-ffed990e6f2d.sql
-- ============================================================
-- Protect subscription/billing fields on companies from non-platform-admins
CREATE OR REPLACE FUNCTION public.protect_company_subscription_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Allow server-side (no auth) and platform admins to modify subscription
  IF auth.uid() IS NULL OR public.current_user_is_platform_admin() THEN
    RETURN NEW;
  END IF;

  IF NEW.plan_id              IS DISTINCT FROM OLD.plan_id
     OR NEW.subscription_status IS DISTINCT FROM OLD.subscription_status
     OR NEW.expires_at          IS DISTINCT FROM OLD.expires_at
  THEN
    RAISE EXCEPTION 'Solo un administrador de la plataforma puede cambiar el plan o el estado de suscripción.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_company_subscription_guard ON public.companies;
CREATE TRIGGER enforce_company_subscription_guard
BEFORE UPDATE ON public.companies
FOR EACH ROW EXECUTE FUNCTION public.protect_company_subscription_fields();

-- ============================================================
-- 20260619082827_224bd028-6b11-46bb-967c-9212d0c1f17c.sql
-- ============================================================
-- 1) create_sale: precio siempre del servidor
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
  if public.current_user_is_demo() then raise exception 'Esta accion esta deshabilitada en el Modo de Prueba.'; end if;
  v_company_id := public.current_user_company_id();
  if v_company_id is null then raise exception 'El usuario no tiene empresa asociada.'; end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then raise exception 'El carrito esta vacio.'; end if;
  select tax_rate into v_tax_rate from public.companies where id = v_company_id;
  v_tax_rate := coalesce(v_tax_rate, 0.18);
  select coalesce(name, 'Publico general') into v_customer_name
  from public.customers where id = p_customer_id and company_id = v_company_id and deleted_at is null;
  v_customer_name := coalesce(v_customer_name, 'Publico general');
  v_sale_number := 'V-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item ->> 'qty')::numeric, 0);
    if v_qty <= 0 then raise exception 'Cantidad invalida.'; end if;
    select * into v_product from public.products
      where id = (v_item ->> 'product_id')::uuid and company_id = v_company_id
      and deleted_at is null and active = true for update;
    if not found then raise exception 'Producto no encontrado.'; end if;
    if v_product.stock < v_qty then raise exception 'Stock insuficiente para %.', v_product.name; end if;
    v_price := v_product.price;
    v_total := v_total + round(v_qty * v_price, 2);
  end loop;

  v_subtotal := round(v_total / (1 + v_tax_rate), 2);
  v_tax := round(v_total - v_subtotal, 2);

  insert into public.sales (company_id, customer_id, sale_number, document_type, payment_method, customer_name, subtotal, tax, total, created_by)
  values (v_company_id, p_customer_id, v_sale_number, coalesce(p_document_type, 'Ticket'), coalesce(p_payment_method, 'Efectivo'), v_customer_name, v_subtotal, v_tax, v_total, auth.uid())
  returning id into v_sale_id;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce((v_item ->> 'qty')::numeric, 0);
    select * into v_product from public.products
      where id = (v_item ->> 'product_id')::uuid and company_id = v_company_id for update;
    v_price := v_product.price;
    insert into public.sale_items (company_id, sale_id, product_id, product_name, qty, unit_price, total, cost)
    values (v_company_id, v_sale_id, v_product.id, v_product.name, v_qty, v_price, round(v_qty * v_price, 2), v_product.cost);
    update public.products set stock = stock - v_qty where id = v_product.id;
    insert into public.stock_movements (company_id, product_id, movement_type, qty, reference_type, reference_id, notes)
    values (v_company_id, v_product.id, 'sale', -v_qty, 'sale', v_sale_id, 'Venta POS');
  end loop;
  return v_sale_id;
end;
$$;

revoke execute on function public.create_sale(uuid, text, text, jsonb) from public, anon;
grant execute on function public.create_sale(uuid, text, text, jsonb) to authenticated, service_role;

-- 2) Anti escalada de privilegios en profiles
create or replace function public.protect_profile_sensitive_columns()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if auth.uid() is null or public.current_user_is_platform_admin() then
    return new;
  end if;
  if new.role is distinct from old.role
     or new.is_platform_admin is distinct from old.is_platform_admin
     or new.company_id is distinct from old.company_id
     or new.is_demo is distinct from old.is_demo
     or new.demo_mode is distinct from old.demo_mode
     or new.is_active is distinct from old.is_active
  then
    raise exception 'No tienes permiso para modificar campos protegidos del perfil.';
  end if;
  return new;
end;
$$;

revoke execute on function public.protect_profile_sensitive_columns() from public, anon, authenticated;

drop trigger if exists protect_profile_sensitive_columns on public.profiles;
create trigger protect_profile_sensitive_columns
  before update on public.profiles
  for each row execute function public.protect_profile_sensitive_columns();

-- 3) Helpers de RLS solo para authenticated
revoke execute on function public.current_user_role() from public, anon;
grant  execute on function public.current_user_role() to authenticated;

revoke execute on function public.current_user_company_id() from public, anon;
grant  execute on function public.current_user_company_id() to authenticated;

revoke execute on function public.current_user_is_demo() from public, anon;
grant  execute on function public.current_user_is_demo() to authenticated;

revoke execute on function public.current_user_is_platform_admin() from public, anon;
grant  execute on function public.current_user_is_platform_admin() to authenticated;

revoke execute on function public.can_select_company(uuid, boolean) from public, anon;
grant  execute on function public.can_select_company(uuid, boolean) to authenticated;

revoke execute on function public.can_write_company(uuid) from public, anon;
grant  execute on function public.can_write_company(uuid) to authenticated;


-- ============================================================
-- 20260619085430_a69cdbb8-c84d-4fa3-9fb9-776b4e3387eb.sql
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.protect_company_subscription_fields() FROM PUBLIC, anon;

-- ============================================================
-- 20260619161844_1c086d23-06f6-4b22-9c0c-3e02ae135dcb.sql
-- ============================================================
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

-- ============================================================
-- 20260619165537_a6cd3a58-33f9-491e-8b21-5fec78ad4cf0.sql
-- ============================================================
create table if not exists public.country_settings (
  country_code text primary key,
  tax_rate numeric(5,4) not null default 0.15,
  tax_name text not null default 'IVA',
  fiscal_id_label text not null default 'ID fiscal',
  currency_code text,
  document_types jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
grant select on public.country_settings to authenticated;
grant all on public.country_settings to service_role;
alter table public.country_settings enable row level security;
drop policy if exists "country_settings select authenticated" on public.country_settings;
create policy "country_settings select authenticated" on public.country_settings
  for select to authenticated using (true);
drop policy if exists "country_settings write platform admin" on public.country_settings;
create policy "country_settings write platform admin" on public.country_settings
  for all to authenticated
  using (public.current_user_is_platform_admin())
  with check (public.current_user_is_platform_admin());

insert into public.country_settings (country_code, tax_rate, tax_name, fiscal_id_label, currency_code, document_types) values
('EC',0.15,'IVA','RUC','USD','[{"name":"Consumidor final","charges_iva":false},{"name":"Nota de venta","charges_iva":false},{"name":"Factura","charges_iva":true}]'),
('PE',0.18,'IGV','RUC','PEN','[{"name":"Boleta","charges_iva":true},{"name":"Factura","charges_iva":true}]'),
('CO',0.19,'IVA','NIT','COP','[{"name":"Documento POS","charges_iva":true},{"name":"Factura electrónica","charges_iva":true}]'),
('MX',0.16,'IVA','RFC','MXN','[{"name":"Nota de venta","charges_iva":false},{"name":"Factura","charges_iva":true}]'),
('CL',0.19,'IVA','RUT','CLP','[{"name":"Boleta","charges_iva":true},{"name":"Factura","charges_iva":true}]'),
('AR',0.21,'IVA','CUIT','ARS','[{"name":"Factura B","charges_iva":true},{"name":"Factura A","charges_iva":true}]'),
('BO',0.13,'IVA','NIT','BOB','[{"name":"Factura","charges_iva":true}]'),
('PY',0.10,'IVA','RUC','PYG','[{"name":"Boleta","charges_iva":false},{"name":"Factura","charges_iva":true}]'),
('UY',0.22,'IVA','RUT','UYU','[{"name":"e-Ticket","charges_iva":true},{"name":"e-Factura","charges_iva":true}]'),
('VE',0.16,'IVA','RIF','VES','[{"name":"Ticket fiscal","charges_iva":true},{"name":"Factura","charges_iva":true}]'),
('CR',0.13,'IVA','Cédula jurídica','CRC','[{"name":"Tiquete","charges_iva":true},{"name":"Factura","charges_iva":true}]'),
('SV',0.13,'IVA','NIT','USD','[{"name":"Factura","charges_iva":true},{"name":"Crédito fiscal","charges_iva":true}]'),
('GT',0.12,'IVA','NIT','GTQ','[{"name":"Factura","charges_iva":true}]'),
('HN',0.15,'ISV','RTN','HNL','[{"name":"Factura","charges_iva":true}]'),
('NI',0.15,'IVA','RUC','NIO','[{"name":"Factura","charges_iva":true}]'),
('PA',0.07,'ITBMS','RUC','PAB','[{"name":"Factura","charges_iva":true}]'),
('DO',0.18,'ITBIS','RNC','DOP','[{"name":"Factura de consumo","charges_iva":true},{"name":"Crédito fiscal","charges_iva":true}]'),
('PR',0.115,'IVU','EIN/SSN','USD','[{"name":"Recibo","charges_iva":true},{"name":"Factura","charges_iva":true}]'),
('BR',0.17,'ICMS','CNPJ','BRL','[{"name":"Cupom fiscal","charges_iva":true},{"name":"Nota fiscal","charges_iva":true}]')
on conflict (country_code) do update set
  tax_rate=excluded.tax_rate, tax_name=excluded.tax_name, fiscal_id_label=excluded.fiscal_id_label,
  currency_code=excluded.currency_code, document_types=excluded.document_types, updated_at=now();

create or replace function public.apply_country_settings_to_company()
returns trigger language plpgsql security definer set search_path = public as $$
declare cs public.country_settings%rowtype;
begin
  select * into cs from public.country_settings where country_code = new.country_code;
  if found then
    new.tax_rate := cs.tax_rate;
    new.tax_name := cs.tax_name;
    new.fiscal_id_label := cs.fiscal_id_label;
    new.document_types := cs.document_types;
  end if;
  return new;
end; $$;

drop trigger if exists companies_default_document_types on public.companies;
drop trigger if exists companies_apply_country_settings on public.companies;
create trigger companies_apply_country_settings
  before insert on public.companies for each row
  execute function public.apply_country_settings_to_company();

create or replace function public.propagate_country_settings()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.companies set
    tax_rate = new.tax_rate, tax_name = new.tax_name,
    fiscal_id_label = new.fiscal_id_label, document_types = new.document_types, updated_at = now()
  where country_code = new.country_code;
  return new;
end; $$;

drop trigger if exists country_settings_propagate on public.country_settings;
create trigger country_settings_propagate
  after update on public.country_settings for each row
  execute function public.propagate_country_settings();

update public.companies c set
  tax_rate = cs.tax_rate, tax_name = cs.tax_name,
  fiscal_id_label = cs.fiscal_id_label, document_types = cs.document_types, updated_at = now()
from public.country_settings cs where cs.country_code = c.country_code;

-- ============================================================
-- 20260619185448_0a17be92-da13-48c5-a291-036a5e1b110b.sql
-- ============================================================
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

-- ============================================================
-- 20260619234726_38713cf8-43d9-4d64-a000-c68ffa391f57.sql
-- ============================================================
alter table public.locations add column if not exists city text;
alter table public.locations add column if not exists phone text;
alter table public.locations add column if not exists manager_name text;

-- ============================================================
-- 20260620001419_c63c22d4-ae42-4735-b081-c92e76653579.sql
-- ============================================================
alter table public.locations add column if not exists short_code text;
alter table public.locations add column if not exists opening_hours text;

-- ============================================================
-- 20260620025625_5257a5b9-148d-4d8a-93b3-ea4a8a0dbb37.sql
-- ============================================================

create table if not exists public.units (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  name text not null,
  active boolean not null default true,
  is_demo_data boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index if not exists units_company_idx on public.units(company_id);
grant select, insert, update, delete on public.units to authenticated;
grant all on public.units to service_role;
alter table public.units enable row level security;
drop policy if exists "units select scoped" on public.units;
create policy "units select scoped" on public.units for select to authenticated
  using (public.can_select_company(company_id, is_demo_data));
drop policy if exists "units write scoped" on public.units;
create policy "units write scoped" on public.units for all to authenticated
  using (public.can_write_company(company_id)) with check (public.can_write_company(company_id));
drop trigger if exists touch_units_updated_at on public.units;
create trigger touch_units_updated_at before update on public.units
  for each row execute function public.touch_updated_at();

update public.products set unit = case unit
  when 'und' then 'Unidad' when 'kg' then 'Kilogramo' when 'g' then 'Gramo'
  when 'L' then 'Litro' when 'ml' then 'Mililitro' when 'paq' then 'Paquete'
  when 'caja' then 'Caja' when 'docena' then 'Docena' when 'lata' then 'Lata'
  when 'botella' then 'Botella' when 'saco' then 'Saco' else unit end
where unit in ('und','kg','g','L','ml','paq','caja','docena','lata','botella','saco');

insert into public.units (company_id, name, is_demo_data)
select distinct p.company_id, p.unit, coalesce(p.is_demo_data,false)
from public.products p
where p.deleted_at is null and coalesce(trim(p.unit),'') <> ''
  and not exists (select 1 from public.units u where u.company_id = p.company_id and u.name = p.unit);

insert into public.units (company_id, name, is_demo_data)
select c.id, d.name, c.is_demo_data
from public.companies c
cross join (values ('Unidad'),('Kilogramo'),('Gramo'),('Litro'),('Mililitro'),('Paquete'),('Caja'),('Docena'),('Lata'),('Botella'),('Saco')) as d(name)
where not exists (select 1 from public.units u where u.company_id = c.id and u.name = d.name);

create or replace function public.seed_default_units()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.units (company_id, name, is_demo_data)
  select new.id, d.name, new.is_demo_data
  from (values ('Unidad'),('Kilogramo'),('Gramo'),('Litro'),('Mililitro'),('Paquete'),('Caja'),('Docena'),('Lata'),('Botella'),('Saco')) as d(name);
  return new;
end; $$;
drop trigger if exists companies_seed_default_units on public.companies;
create trigger companies_seed_default_units after insert on public.companies
  for each row execute function public.seed_default_units();


-- ============================================================
-- 20260621053313_581dc256-fa39-4d7a-991e-eb2eaaaf8978.sql
-- ============================================================

-- a) Tabla profile_locations
create table if not exists public.profile_locations (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, location_id)
);

create index if not exists profile_locations_company_id_idx on public.profile_locations(company_id);
create index if not exists profile_locations_location_id_idx on public.profile_locations(location_id);

grant select on public.profile_locations to authenticated;
grant all on public.profile_locations to service_role;

alter table public.profile_locations enable row level security;

create policy "profile_locations_select_same_company"
  on public.profile_locations
  for select
  to authenticated
  using (company_id = public.current_user_company_id());

-- b) Backfill cajeros
insert into public.profile_locations (profile_id, location_id, company_id)
select p.id, p.location_id, p.company_id
from public.profiles p
where p.role = 'user'
  and p.location_id is not null
  and p.company_id is not null
on conflict do nothing;

-- c) Enum operador
alter type public.app_role add value if not exists 'operador';

-- d) allowed_sections en profiles
alter table public.profiles add column if not exists allowed_sections text[];


-- ============================================================
-- 20260621055446_c1f65619-d1f0-4894-9534-20dedb9441c1.sql
-- ============================================================
-- Revoke anon EXECUTE on internal SECURITY DEFINER trigger helpers
REVOKE EXECUTE ON FUNCTION public.apply_country_settings_to_company() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_default_location() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.propagate_country_settings() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.seed_default_units() FROM anon, PUBLIC;

-- Lock down helper functions that are exposed to anon too
REVOKE EXECUTE ON FUNCTION public.default_document_types(text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.default_tax_name(text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.default_tax_rate(text) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_default_document_types() FROM anon, PUBLIC;

-- Set immutable search_path on remaining functions
ALTER FUNCTION public.default_document_types(text) SET search_path = public;
ALTER FUNCTION public.default_tax_name(text) SET search_path = public;
ALTER FUNCTION public.default_tax_rate(text) SET search_path = public;
ALTER FUNCTION public.set_default_document_types() SET search_path = public;


-- ============================================================
-- 20260621060236_730eb7d6-4bf1-4e00-aaf1-f05b3a25b603.sql
-- ============================================================
create or replace function public.user_can_access_location(p_location_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    p_location_id is null
    or not exists (select 1 from public.profile_locations pl where pl.profile_id = auth.uid())
    or exists (select 1 from public.profile_locations pl
               where pl.profile_id = auth.uid() and pl.location_id = p_location_id);
$$;

revoke execute on function public.user_can_access_location(uuid) from public, anon;
grant execute on function public.user_can_access_location(uuid) to authenticated, service_role;

do $$
declare t text;
begin
  foreach t in array array[
    'sales','sale_items','stock_movements',
    'cash_sessions','cash_movements','purchases','returns'
  ] loop
    execute format('drop policy if exists "%s select scoped" on public.%I', t, t);
    execute format(
      'create policy "%s select scoped" on public.%I for select to authenticated using (public.can_select_company(company_id, is_demo_data) and public.user_can_access_location(location_id))',
      t, t);
  end loop;
end $$;

-- ============================================================
-- 20260621061626_5cf2613c-bd60-4194-98aa-19b0ad2e8edb.sql
-- ============================================================
-- Blindaje RLS: aislamiento de ESCRITURA por sucursal.
-- Un usuario solo puede crear/editar/borrar filas de sus sucursales asignadas.
-- Reusa la función public.user_can_access_location(uuid) creada en el paso anterior.
do $$
declare t text;
begin
  foreach t in array array[
    'sales','sale_items','stock_movements','cash_sessions',
    'cash_movements','purchases','returns','product_locations'
  ] loop
    execute format('drop policy if exists "%s write scoped" on public.%I', t, t);
    execute format(
      'create policy "%s write scoped" on public.%I for all to authenticated using (public.can_write_company(company_id) and public.user_can_access_location(location_id)) with check (public.can_write_company(company_id) and public.user_can_access_location(location_id))',
      t, t);
  end loop;
end $$;

-- ============================================================
-- 20260622025453_a9ad22bb-4226-49d3-9825-270cd0f0a652.sql
-- ============================================================

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

-- (omitida limpieza de produccion: 20260622065509_3bf3fb90-1639-4be6-a267-60f51074f266.sql)

-- ============================================================
-- 20260622075914_eb4d779d-5252-4eb2-a0a5-9f7f24468500.sql
-- ============================================================
begin;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_company_id uuid;
  v_company_name text;
  v_country_code text;
  v_currency_code text;
  v_locale text;
  v_is_owner boolean;
begin
  v_company_name  := coalesce(new.raw_user_meta_data ->> 'company_name', 'Mi Tienda Agil');
  v_country_code  := coalesce(new.raw_user_meta_data ->> 'country_code', 'PE');
  v_currency_code := coalesce(new.raw_user_meta_data ->> 'currency_code', 'PEN');
  v_locale        := coalesce(new.raw_user_meta_data ->> 'locale', 'es-PE');
  v_company_id    := nullif(new.raw_user_meta_data ->> 'company_id', '')::uuid;

  v_is_owner := (v_company_id is null);

  if v_company_id is null then
    insert into public.companies (name, contact_email, country_code, currency_code, locale,
                                  fiscal_id_label, tax_name, tax_rate)
    values (v_company_name, new.email, v_country_code, v_currency_code, v_locale,
      coalesce(new.raw_user_meta_data ->> 'fiscal_id_label', 'ID fiscal'),
      coalesce(new.raw_user_meta_data ->> 'tax_name', 'Impuesto demo'),
      coalesce(nullif(new.raw_user_meta_data ->> 'tax_rate', '')::numeric, 0.18))
    returning id into v_company_id;
  end if;

  insert into public.profiles (id, company_id, email, full_name, role,
                               is_platform_admin, is_demo, demo_mode)
  values (new.id, v_company_id, new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', v_company_name),
    case when v_is_owner then 'admin'::public.app_role else 'user'::public.app_role end,
    false,
    false, 'none')
  on conflict (id) do nothing;

  return new;
end;
$function$;

-- Corrección puntual del perfil de prueba.
update public.profiles
set role = 'admin'::public.app_role,
    is_platform_admin = false,
    updated_at = now()
where email = 'anunciosfbads2@gmail.com';

commit;

-- ============================================================
-- 20260622140921_47f4a492-aefe-4c95-8d35-af20d0524423.sql
-- ============================================================

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


-- ============================================================
-- 20260622141958_1e81c03c-1ae8-4bf6-8d86-487a9f367149.sql
-- ============================================================

-- 1) Totales hoy / mes
create or replace function public.dashboard_sales_totals(
  p_location_id uuid default null,
  p_tz text default 'UTC'
) returns table (
  total_today numeric,
  count_today bigint,
  total_month numeric,
  count_month bigint
)
language sql stable security definer set search_path = public as $$
  with base as (
    select s.total, (s.sale_date at time zone p_tz)::date as d_local,
           date_trunc('month', (s.sale_date at time zone p_tz))::date as m_local
    from public.sales s
    where s.company_id = public.current_user_company_id()
      and s.deleted_at is null
      and (p_location_id is null or s.location_id = p_location_id)
      and public.user_can_access_location(s.location_id)
  ), today_ref as (
    select (now() at time zone p_tz)::date as today,
           date_trunc('month', (now() at time zone p_tz))::date as month_start
  )
  select
    coalesce(sum(case when b.d_local = t.today then b.total end), 0)::numeric as total_today,
    coalesce(count(*) filter (where b.d_local = t.today), 0)::bigint as count_today,
    coalesce(sum(case when b.m_local = t.month_start then b.total end), 0)::numeric as total_month,
    coalesce(count(*) filter (where b.m_local = t.month_start), 0)::bigint as count_month
  from today_ref t left join base b on true
  group by t.today, t.month_start;
$$;

-- 2) Ventas por día (últimos N días, rellenando 0)
create or replace function public.sales_by_day(
  p_location_id uuid default null,
  p_tz text default 'UTC',
  p_days int default 7
) returns table (day date, total numeric, count bigint)
language sql stable security definer set search_path = public as $$
  with days as (
    select generate_series(
      ((now() at time zone p_tz)::date - (p_days - 1)),
      (now() at time zone p_tz)::date,
      interval '1 day'
    )::date as day
  ), agg as (
    select (s.sale_date at time zone p_tz)::date as d_local,
           sum(s.total) as total, count(*) as count
    from public.sales s
    where s.company_id = public.current_user_company_id()
      and s.deleted_at is null
      and (p_location_id is null or s.location_id = p_location_id)
      and public.user_can_access_location(s.location_id)
      and (s.sale_date at time zone p_tz)::date
            >= ((now() at time zone p_tz)::date - (p_days - 1))
    group by 1
  )
  select d.day, coalesce(a.total, 0)::numeric, coalesce(a.count, 0)::bigint
  from days d left join agg a on a.d_local = d.day
  order by d.day;
$$;

-- 3) Ventas por categoría
create or replace function public.sales_by_category(
  p_location_id uuid default null,
  p_tz text default 'UTC',
  p_from timestamptz default null,
  p_to timestamptz default null
) returns table (category text, total numeric)
language sql stable security definer set search_path = public as $$
  select coalesce(c.name, 'Sin categoría') as category,
         sum(si.qty * si.unit_price)::numeric as total
  from public.sale_items si
  join public.sales s on s.id = si.sale_id
  left join public.products p on p.id = si.product_id
  left join public.categories c on c.id = p.category_id
  where s.company_id = public.current_user_company_id()
    and s.deleted_at is null
    and (p_location_id is null or s.location_id = p_location_id)
    and public.user_can_access_location(s.location_id)
    and (p_from is null or s.sale_date >= p_from)
    and (p_to is null or s.sale_date < p_to)
  group by coalesce(c.name, 'Sin categoría')
  order by total desc;
$$;

-- 4) Ventas por método de pago
create or replace function public.sales_by_payment_method(
  p_location_id uuid default null,
  p_tz text default 'UTC',
  p_from timestamptz default null,
  p_to timestamptz default null
) returns table (method text, total numeric, count bigint)
language sql stable security definer set search_path = public as $$
  select coalesce(s.payment_method, 'Otro') as method,
         sum(s.total)::numeric as total,
         count(*)::bigint as count
  from public.sales s
  where s.company_id = public.current_user_company_id()
    and s.deleted_at is null
    and (p_location_id is null or s.location_id = p_location_id)
    and public.user_can_access_location(s.location_id)
    and (p_from is null or s.sale_date >= p_from)
    and (p_to is null or s.sale_date < p_to)
  group by coalesce(s.payment_method, 'Otro')
  order by total desc;
$$;

grant execute on function public.dashboard_sales_totals(uuid, text) to authenticated;
grant execute on function public.sales_by_day(uuid, text, int) to authenticated;
grant execute on function public.sales_by_category(uuid, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.sales_by_payment_method(uuid, text, timestamptz, timestamptz) to authenticated;


-- ============================================================
-- 20260622150420_86d98658-1aa0-401f-bdbc-c4a178c1c843.sql
-- ============================================================

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


-- ============================================================
-- 20260622151411_d01ba735-1707-4b52-ae8c-fdf67eebaa1e.sql
-- ============================================================
-- Unify create_sale price source so the POS total matches the recorded total.
-- - Accepts unit_price / price from items as the locked price for non-variant and variant lines
-- - Returns jsonb { sale_id, subtotal, tax, total } so the frontend shows exactly what was saved
drop function if exists public.create_sale(uuid, text, text, jsonb, uuid);

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

    -- Locked price from the POS cart (accept unit_price or price). If absent, fall back to live values.
    v_price_in := coalesce(
      nullif(v_item ->> 'unit_price','')::numeric,
      nullif(v_item ->> 'price','')::numeric
    );

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
      v_unit_price := coalesce(v_price_in, v_product.price);
      v_unit_cost := v_product.cost;

      select stock into v_loc_stock from public.product_locations where product_id = v_product.id and location_id = v_location_id for update;
      if not found then raise exception 'El producto % no esta asignado a este punto de venta.', v_product.name; end if;
      if v_loc_stock < v_qty then raise exception 'Stock insuficiente para % en este local.', v_product.name; end if;
      if not v_charges_iva then v_line_total := round(v_unit_price * v_qty, 2); v_line_tax := 0;
      elsif coalesce(v_product.price_includes_tax, true) then
        v_line_total := round(v_unit_price * v_qty, 2); v_line_tax := round(v_line_total - v_line_total/(1+v_tax_rate), 2);
      else
        v_line_total := round(v_unit_price * v_qty * (1+v_tax_rate), 2); v_line_tax := round(v_unit_price * v_qty * v_tax_rate, 2);
      end if;
      v_total := v_total + v_line_total; v_tax := v_tax + v_line_tax;
      insert into public.sale_items (company_id, location_id, sale_id, product_id, product_name, qty, unit_price, total, cost)
      values (v_company_id, v_location_id, v_sale_id, v_product.id, v_product.name, v_qty, v_unit_price, v_line_total, v_unit_cost);
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

grant execute on function public.create_sale(uuid, text, text, jsonb, uuid) to authenticated;

-- ============================================================
-- 20260622151801_c18910b1-856d-402b-b64c-fd8e38d8fcc1.sql
-- ============================================================
-- 1) Partial unique index: only one open session per (company_id, location_id)
create unique index if not exists cash_sessions_one_open_per_location
  on public.cash_sessions (company_id, location_id)
  where status = 'open';

-- 2) Server-side open: blocks duplicates with a clear error
create or replace function public.open_cash_session(
  p_opening_amount numeric,
  p_location_id uuid default null
) returns uuid
language plpgsql
set search_path to 'public'
as $function$
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
      where company_id = v_company_id and deleted_at is null
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
$function$;

revoke all on function public.open_cash_session(numeric, uuid) from public;
grant execute on function public.open_cash_session(numeric, uuid) to authenticated;

-- 3) Server-side close: recomputes expected on the server, only closes still-open sessions
create or replace function public.close_cash_session(
  p_session_id uuid,
  p_real_amount numeric
) returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_company_id uuid;
  v_session public.cash_sessions%rowtype;
  v_movements numeric(12,2) := 0;
  v_cash_sales numeric(12,2) := 0;
  v_expected numeric(12,2);
  v_real numeric(12,2);
  v_diff numeric(12,2);
  v_rows int;
begin
  if auth.uid() is null then raise exception 'No autenticado.'; end if;
  if public.current_user_is_demo() then
    raise exception 'Esta accion esta deshabilitada en el Modo de Prueba.';
  end if;

  v_company_id := public.current_user_company_id();
  if v_company_id is null then raise exception 'El usuario no tiene empresa asociada.'; end if;

  -- Lock the row so concurrent closes can't double-process
  select * into v_session from public.cash_sessions
    where id = p_session_id and company_id = v_company_id
    for update;
  if not found then raise exception 'Caja no encontrada.'; end if;
  if v_session.status <> 'open' then
    raise exception 'Esta caja ya está cerrada.';
  end if;

  -- Sum signed cash movements for this session (egreso is stored negative)
  select coalesce(sum(amount), 0) into v_movements
  from public.cash_movements
  where cash_session_id = v_session.id;

  -- Sum cash sales since the session opened in the same location
  select coalesce(sum(total), 0) into v_cash_sales
  from public.sales
  where company_id = v_company_id
    and location_id = v_session.location_id
    and deleted_at is null
    and payment_method = 'Efectivo'
    and sale_date >= v_session.opened_at;

  v_expected := round(coalesce(v_session.opening_amount, 0) + v_movements + v_cash_sales, 2);
  v_real := round(coalesce(p_real_amount, 0), 2);
  v_diff := round(v_real - v_expected, 2);

  -- Only close if still open (defensive, race-safe)
  update public.cash_sessions set
    status = 'closed',
    closed_at = now(),
    closed_by = auth.uid(),
    expected_amount = v_expected,
    real_amount = v_real,
    difference = v_diff,
    updated_at = now()
  where id = v_session.id and status = 'open';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise exception 'Esta caja ya está cerrada.'; end if;

  return jsonb_build_object(
    'session_id', v_session.id,
    'opening_amount', v_session.opening_amount,
    'movements', v_movements,
    'cash_sales', v_cash_sales,
    'expected_amount', v_expected,
    'real_amount', v_real,
    'difference', v_diff
  );
end;
$function$;

revoke all on function public.close_cash_session(uuid, numeric) from public;
grant execute on function public.close_cash_session(uuid, numeric) to authenticated;

-- ============================================================
-- 20260622160737_0eb53613-0987-46f6-a987-f25a2c1837b9.sql
-- ============================================================
create or replace function public.sync_product_variants(
  p_product_id uuid,
  p_attribute_names text[],
  p_variants jsonb
) returns void
language plpgsql
security definer
set search_path = public
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

      -- Upsert locations for this variant
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

      -- Deactivate stale locations for this variant
      update public.product_variant_locations
        set is_active = false, updated_at = now()
        where product_variant_id = v_variant_id
          and is_active = true
          and (array_length(v_keep_locs,1) is null or not (location_id = any(v_keep_locs)));
    end loop;
  end if;

  -- Soft-delete variants not in the kept set
  update public.product_variants
    set deleted_at = now(), is_active = false, updated_at = now()
    where product_id = p_product_id
      and company_id = v_company_id
      and deleted_at is null
      and (array_length(v_kept,1) is null or not (id = any(v_kept)));

  -- Also deactivate their locations
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

    -- Deactivate flat product_locations: stock is owned by variants now
    update public.product_locations
      set is_active = false, updated_at = now()
      where product_id = p_product_id and is_active = true;
  else
    update public.products set
      has_variants = false,
      variant_attributes = null,
      updated_at = now()
    where id = p_product_id;
  end if;
end;
$$;

revoke all on function public.sync_product_variants(uuid, text[], jsonb) from public;
grant execute on function public.sync_product_variants(uuid, text[], jsonb) to authenticated;

-- ============================================================
-- 20260622161950_d38ed186-888c-4985-a514-9d6da9d705df.sql
-- ============================================================
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

-- ============================================================
-- 20260622163721_308afa43-667f-4088-b722-55ae0d7c91bb.sql
-- ============================================================
-- Catálogo global de métodos de pago por país (gestionado por platform admin)
CREATE TABLE public.country_payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  country_code text NOT NULL,
  method_code  text NOT NULL,
  label        text NOT NULL,
  kind         text NOT NULL,
  description  text,
  recommended  boolean NOT NULL DEFAULT false,
  sort_order   integer NOT NULL DEFAULT 0,
  is_active    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT country_payment_methods_country_method_uk UNIQUE (country_code, method_code)
);

GRANT SELECT ON public.country_payment_methods TO authenticated;
GRANT ALL    ON public.country_payment_methods TO service_role;

ALTER TABLE public.country_payment_methods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "country_payment_methods_read_authenticated"
  ON public.country_payment_methods FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "country_payment_methods_insert_platform_admin"
  ON public.country_payment_methods FOR INSERT
  TO authenticated
  WITH CHECK (public.current_user_is_platform_admin());

CREATE POLICY "country_payment_methods_update_platform_admin"
  ON public.country_payment_methods FOR UPDATE
  TO authenticated
  USING (public.current_user_is_platform_admin())
  WITH CHECK (public.current_user_is_platform_admin());

CREATE POLICY "country_payment_methods_delete_platform_admin"
  ON public.country_payment_methods FOR DELETE
  TO authenticated
  USING (public.current_user_is_platform_admin());

CREATE TRIGGER country_payment_methods_touch_updated_at
  BEFORE UPDATE ON public.country_payment_methods
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Seed inicial desde el catálogo del frontend (idempotente)
INSERT INTO public.country_payment_methods (country_code, method_code, label, kind, recommended, sort_order)
VALUES
('AR', 'ar-mercado-pago', 'Mercado Pago', 'wallet', true, 0),
('AR', 'ar-modo', 'MODO', 'wallet', true, 1),
('AR', 'ar-cuenta-dni', 'Cuenta DNI', 'wallet', false, 2),
('AR', 'ar-qr-interoperable', 'QR interoperable', 'qr', true, 3),
('AR', 'ar-transferencia-30', 'Transferencia 3.0', 'instant_transfer', false, 4),
('AR', 'ar-uala', 'Ualá', 'wallet', false, 5),
('AR', 'ar-naranja-x', 'Naranja X', 'wallet', false, 6),
('AR', 'ar-pago-facil', 'Pago Fácil', 'voucher', false, 7),
('AR', 'ar-rapipago', 'Rapipago', 'voucher', false, 8),
('BO', 'bo-qr-simple', 'QR Simple', 'qr', true, 0),
('BO', 'bo-simple', 'Simple', 'wallet', true, 1),
('BO', 'bo-tigo-money', 'Tigo Money', 'wallet', false, 2),
('BO', 'bo-soli', 'Soli', 'wallet', false, 3),
('BO', 'bo-pagofacil', 'PagoFácil Bolivia', 'voucher', false, 4),
('BR', 'br-pix', 'Pix', 'instant_transfer', true, 0),
('BR', 'br-pix-qr', 'Pix QR', 'qr', true, 1),
('BR', 'br-boleto', 'Boleto Bancário', 'voucher', false, 2),
('BR', 'br-picpay', 'PicPay', 'wallet', false, 3),
('BR', 'br-mercado-pago', 'Mercado Pago', 'wallet', false, 4),
('BR', 'br-nubank', 'Nubank', 'wallet', false, 5),
('BR', 'br-ted-doc', 'TED/DOC', 'bank_transfer', false, 6),
('CL', 'cl-redcompra', 'Redcompra', 'card', true, 0),
('CL', 'cl-webpay', 'Webpay', 'card', true, 1),
('CL', 'cl-mach', 'MACH', 'wallet', true, 2),
('CL', 'cl-mercado-pago', 'Mercado Pago', 'wallet', false, 3),
('CL', 'cl-servipag', 'Servipag', 'voucher', false, 4),
('CL', 'cl-khipu', 'Khipu', 'bank_transfer', false, 5),
('CL', 'cl-fpay', 'Fpay', 'wallet', false, 6),
('CO', 'co-pse', 'PSE', 'bank_transfer', true, 0),
('CO', 'co-nequi', 'Nequi', 'wallet', true, 1),
('CO', 'co-nequi-qr', 'Nequi QR', 'qr', true, 2),
('CO', 'co-daviplata', 'Daviplata', 'wallet', true, 3),
('CO', 'co-bre-b', 'Bre-B', 'instant_transfer', false, 4),
('CO', 'co-bancolombia', 'Bancolombia', 'bank_transfer', false, 5),
('CO', 'co-efecty', 'Efecty', 'voucher', false, 6),
('CO', 'co-mercado-pago', 'Mercado Pago', 'wallet', false, 7),
('CO', 'co-addi', 'Addi', 'bnpl', false, 8),
('EC', 'ec-deuna', 'DeUna!', 'wallet', true, 0),
('EC', 'ec-payphone', 'PayPhone', 'wallet', true, 1),
('EC', 'ec-transferencia', 'Transferencia interbancaria', 'bank_transfer', false, 2),
('EC', 'ec-datafast', 'Datafast', 'card', false, 3),
('EC', 'ec-medianet', 'Medianet', 'card', false, 4),
('EC', 'ec-kushki', 'Kushki', 'other', false, 5),
('GY', 'gy-mmg', 'MMG+', 'wallet', true, 0),
('GY', 'gy-mobile-money', 'Mobile Money Guyana', 'wallet', false, 1),
('GY', 'gy-bank-transfer', 'Transferencia bancaria local', 'bank_transfer', false, 2),
('PY', 'py-bancard-qr', 'QR Bancard', 'qr', true, 0),
('PY', 'py-tigo-money', 'Tigo Money', 'wallet', true, 1),
('PY', 'py-personal-pay', 'Personal Pay', 'wallet', false, 2),
('PY', 'py-aqui-pago', 'Aquí Pago', 'voucher', false, 3),
('PY', 'py-pago-express', 'Pago Express', 'voucher', false, 4),
('PE', 'pe-yape', 'Yape', 'wallet', true, 0),
('PE', 'pe-plin', 'Plin', 'wallet', true, 1),
('PE', 'pe-pagoefectivo', 'PagoEfectivo', 'voucher', false, 2),
('PE', 'pe-izipay', 'Izipay', 'card', false, 3),
('PE', 'pe-niubiz', 'Niubiz', 'card', false, 4),
('PE', 'pe-tunki', 'Tunki', 'wallet', false, 5),
('PE', 'pe-transferencia', 'Transferencia interbancaria', 'bank_transfer', false, 6),
('SR', 'sr-bank-transfer', 'Transferencia bancaria local', 'bank_transfer', false, 0),
('SR', 'sr-mobile-banking', 'Banca móvil', 'wallet', false, 1),
('SR', 'sr-qr', 'Pago QR', 'qr', false, 2),
('UY', 'uy-mercado-pago', 'Mercado Pago', 'wallet', true, 0),
('UY', 'uy-prex', 'Prex', 'wallet', false, 1),
('UY', 'uy-oca-blue', 'OCA Blue', 'wallet', false, 2),
('UY', 'uy-midinero', 'MiDinero', 'wallet', false, 3),
('UY', 'uy-abitab', 'Abitab', 'voucher', false, 4),
('UY', 'uy-redpagos', 'RedPagos', 'voucher', false, 5),
('VE', 've-pago-movil', 'Pago móvil interbancario', 'instant_transfer', true, 0),
('VE', 've-transferencia', 'Transferencia bancaria', 'bank_transfer', false, 1),
('VE', 've-zelle', 'Zelle', 'bank_transfer', false, 2),
('VE', 've-usdt', 'USDT', 'crypto', false, 3),
('VE', 've-binance-pay', 'Binance Pay', 'crypto', false, 4),
('BZ', 'bz-e-kyash', 'E-Kyash', 'wallet', true, 0),
('BZ', 'bz-bank-transfer', 'Transferencia bancaria local', 'bank_transfer', false, 1),
('BZ', 'bz-mobile-pay', 'Pago móvil local', 'wallet', false, 2),
('CR', 'cr-sinpe-movil', 'SINPE Móvil', 'instant_transfer', true, 0),
('CR', 'cr-sinpe', 'Transferencia SINPE', 'bank_transfer', false, 1),
('CR', 'cr-bn-servicios', 'BN Servicios', 'voucher', false, 2),
('CR', 'cr-wink', 'Wink', 'wallet', false, 3),
('CR', 'cr-kash', 'Kash', 'wallet', false, 4),
('SV', 'sv-chivo', 'Chivo Wallet', 'wallet', true, 0),
('SV', 'sv-bitcoin-lightning', 'Bitcoin Lightning', 'crypto', false, 1),
('SV', 'sv-tigo-money', 'Tigo Money', 'wallet', false, 2),
('SV', 'sv-n1co', 'N1CO', 'wallet', false, 3),
('SV', 'sv-transferencia', 'Transferencia bancaria', 'bank_transfer', false, 4),
('GT', 'gt-tigo-money', 'Tigo Money', 'wallet', true, 0),
('GT', 'gt-paggo', 'Paggo', 'wallet', false, 1),
('GT', 'gt-transferencia', 'Transferencia bancaria', 'bank_transfer', false, 2),
('GT', 'gt-bac-link', 'BAC Compra Click', 'other', false, 3),
('HN', 'hn-tigo-money', 'Tigo Money', 'wallet', true, 0),
('HN', 'hn-tengo', 'Tengo', 'wallet', false, 1),
('HN', 'hn-kash', 'Kash', 'wallet', false, 2),
('HN', 'hn-bac-link', 'BAC Compra Click', 'other', false, 3),
('HN', 'hn-transferencia', 'Transferencia bancaria', 'bank_transfer', false, 4),
('MX', 'mx-spei', 'SPEI', 'instant_transfer', true, 0),
('MX', 'mx-codi', 'CoDi', 'qr', true, 1),
('MX', 'mx-oxxo-pay', 'OXXO Pay', 'voucher', false, 2),
('MX', 'mx-mercado-pago', 'Mercado Pago', 'wallet', false, 3),
('MX', 'mx-kueski-pay', 'Kueski Pay', 'bnpl', false, 4),
('MX', 'mx-clip', 'Clip', 'card', false, 5),
('MX', 'mx-paypal', 'PayPal', 'wallet', false, 6),
('NI', 'ni-transferencia', 'Transferencia bancaria', 'bank_transfer', true, 0),
('NI', 'ni-pago-movil', 'Pago móvil bancario', 'wallet', false, 1),
('NI', 'ni-bac-link', 'BAC Compra Click', 'other', false, 2),
('NI', 'ni-billetera-local', 'Billetera móvil local', 'wallet', false, 3),
('PA', 'pa-yappy', 'Yappy', 'wallet', true, 0),
('PA', 'pa-nequi', 'Nequi Panamá', 'wallet', false, 1),
('PA', 'pa-ach', 'ACH', 'bank_transfer', false, 2),
('PA', 'pa-ach-xpress', 'ACH Xpress', 'instant_transfer', false, 3),
('PA', 'pa-punto-pago', 'Punto Pago', 'voucher', false, 4),
('PA', 'pa-clave', 'Clave', 'card', false, 5),
('AG', 'ag-dcash', 'DCash', 'wallet', false, 0),
('AG', 'ag-bank-transfer', 'Transferencia bancaria local', 'bank_transfer', false, 1),
('AG', 'ag-mobile-wallet', 'Billetera móvil local', 'wallet', false, 2),
('BS', 'bs-sand-dollar', 'Sand Dollar', 'wallet', true, 0),
('BS', 'bs-kanoo', 'Kanoo', 'wallet', false, 1),
('BS', 'bs-bank-transfer', 'Transferencia bancaria local', 'bank_transfer', false, 2),
('BB', 'bb-mmoney', 'mMoney', 'wallet', false, 0),
('BB', 'bb-surepay', 'SurePay', 'voucher', false, 1),
('BB', 'bb-bank-transfer', 'Transferencia bancaria local', 'bank_transfer', false, 2),
('CU', 'cu-transfermovil', 'Transfermóvil', 'wallet', true, 0),
('CU', 'cu-enzona', 'EnZona', 'wallet', true, 1),
('CU', 'cu-transferencia', 'Transferencia bancaria', 'bank_transfer', false, 2),
('DM', 'dm-dcash', 'DCash', 'wallet', false, 0),
('DM', 'dm-bank-transfer', 'Transferencia bancaria local', 'bank_transfer', false, 1),
('DM', 'dm-mobile-wallet', 'Billetera móvil local', 'wallet', false, 2),
('GD', 'gd-dcash', 'DCash', 'wallet', false, 0),
('GD', 'gd-bank-transfer', 'Transferencia bancaria local', 'bank_transfer', false, 1),
('GD', 'gd-mobile-wallet', 'Billetera móvil local', 'wallet', false, 2),
('HT', 'ht-moncash', 'MonCash', 'wallet', true, 0),
('HT', 'ht-natcash', 'Natcash', 'wallet', false, 1),
('HT', 'ht-bank-transfer', 'Transferencia bancaria local', 'bank_transfer', false, 2),
('JM', 'jm-lynk', 'Lynk', 'wallet', true, 0),
('JM', 'jm-ncb-quisk', 'NCB Quisk', 'wallet', false, 1),
('JM', 'jm-bank-transfer', 'Transferencia bancaria local', 'bank_transfer', false, 2),
('PR', 'pr-ath-movil', 'ATH Móvil', 'wallet', true, 0),
('PR', 'pr-paypal', 'PayPal', 'wallet', false, 1),
('PR', 'pr-venmo', 'Venmo', 'wallet', false, 2),
('PR', 'pr-apple-pay', 'Apple Pay', 'wallet', false, 3),
('PR', 'pr-google-pay', 'Google Pay', 'wallet', false, 4),
('DO', 'do-azul', 'Azul', 'card', true, 0),
('DO', 'do-cardnet', 'CardNet', 'card', false, 1),
('DO', 'do-tpago', 'tPago', 'wallet', false, 2),
('DO', 'do-qik', 'Qik', 'wallet', false, 3),
('DO', 'do-transferencia', 'Transferencia bancaria', 'bank_transfer', false, 4),
('KN', 'kn-dcash', 'DCash', 'wallet', false, 0),
('KN', 'kn-bank-transfer', 'Transferencia bancaria local', 'bank_transfer', false, 1),
('KN', 'kn-mobile-wallet', 'Billetera móvil local', 'wallet', false, 2),
('VC', 'vc-dcash', 'DCash', 'wallet', false, 0),
('VC', 'vc-bank-transfer', 'Transferencia bancaria local', 'bank_transfer', false, 1),
('VC', 'vc-mobile-wallet', 'Billetera móvil local', 'wallet', false, 2),
('LC', 'lc-dcash', 'DCash', 'wallet', false, 0),
('LC', 'lc-bank-transfer', 'Transferencia bancaria local', 'bank_transfer', false, 1),
('LC', 'lc-mobile-wallet', 'Billetera móvil local', 'wallet', false, 2),
('TT', 'tt-wipay', 'WiPay', 'wallet', true, 0),
('TT', 'tt-paywise', 'PayWise', 'voucher', false, 1),
('TT', 'tt-bank-transfer', 'Transferencia bancaria local', 'bank_transfer', false, 2),
('TT', 'tt-endcash', 'Endcash', 'wallet', false, 3),
('GQ', 'gq-orange-money', 'Orange Money', 'wallet', false, 0),
('GQ', 'gq-muni', 'Muni', 'wallet', false, 1),
('GQ', 'gq-mobile-money-cemac', 'Mobile Money CEMAC', 'wallet', false, 2),
('GQ', 'gq-transferencia', 'Transferencia bancaria', 'bank_transfer', false, 3)
ON CONFLICT (country_code, method_code) DO NOTHING;

-- ============================================================
-- 20260622175245_31493e52-4254-4766-8dbb-4ed2e623d36b.sql
-- ============================================================
-- 1) Harden create_sale: always use server-side product/variant price; ignore client-supplied unit_price/price
CREATE OR REPLACE FUNCTION public.create_sale(p_customer_id uuid, p_document_type text, p_payment_method text, p_items jsonb, p_location_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_company_id uuid; v_location_id uuid; v_tax_rate numeric(5,4); v_doc_types jsonb; v_charges_iva boolean;
  v_sale_id uuid; v_customer_name text; v_item jsonb; v_product public.products%rowtype; v_loc_stock numeric(12,3);
  v_qty numeric(12,3); v_line_total numeric(12,2); v_line_tax numeric(12,2);
  v_total numeric(12,2) := 0; v_tax numeric(12,2) := 0; v_subtotal numeric(12,2); v_sale_number text;
  v_variant_id uuid; v_variant public.product_variants%rowtype; v_unit_price numeric(12,2); v_unit_cost numeric(12,2);
  v_variant_label text; v_attr_key text; v_attr_val text; v_label_parts text[];
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

    v_price_includes_tax := coalesce(v_product.price_includes_tax, true);
    v_variant_id := nullif(v_item ->> 'variant_id','')::uuid;

    if v_variant_id is not null then
      select * into v_variant from public.product_variants
        where id = v_variant_id and product_id = v_product.id and company_id = v_company_id
          and is_active = true and deleted_at is null;
      if not found then raise exception 'Variante no encontrada para el producto %.', v_product.name; end if;

      -- SECURITY: server-side price only; never trust client-supplied unit_price/price.
      v_unit_price := coalesce(v_variant.price_override, v_product.price);
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
      -- SECURITY: server-side price only; never trust client-supplied unit_price/price.
      v_unit_price := v_product.price;
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

-- 2) Revoke anonymous EXECUTE on SECURITY DEFINER RPCs exposed to anon role.
--    All of these already require auth.uid(); revoking anon execute aligns the
--    grants with intent and resolves the Supabase linter finding.
REVOKE EXECUTE ON FUNCTION public.dashboard_sales_totals(uuid, text)            FROM anon;
REVOKE EXECUTE ON FUNCTION public.profit_report(timestamptz, timestamptz, uuid) FROM anon;
REVOKE EXECUTE ON FUNCTION public.sales_by_category(uuid, text, timestamptz, timestamptz)        FROM anon;
REVOKE EXECUTE ON FUNCTION public.sales_by_day(uuid, text, integer)             FROM anon;
REVOKE EXECUTE ON FUNCTION public.sales_by_payment_method(uuid, text, timestamptz, timestamptz) FROM anon;
REVOKE EXECUTE ON FUNCTION public.sync_product_variants(uuid, text[], jsonb)    FROM anon;

-- ============================================================
-- 20260622175314_aad5569b-6064-41de-ac70-d43c3086217f.sql
-- ============================================================
REVOKE EXECUTE ON FUNCTION public.dashboard_sales_totals(uuid, text)            FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.profit_report(timestamptz, timestamptz, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sales_by_category(uuid, text, timestamptz, timestamptz)        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sales_by_day(uuid, text, integer)             FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sales_by_payment_method(uuid, text, timestamptz, timestamptz) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sync_product_variants(uuid, text[], jsonb)    FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.dashboard_sales_totals(uuid, text)            TO authenticated;
GRANT EXECUTE ON FUNCTION public.profit_report(timestamptz, timestamptz, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sales_by_category(uuid, text, timestamptz, timestamptz)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.sales_by_day(uuid, text, integer)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.sales_by_payment_method(uuid, text, timestamptz, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_product_variants(uuid, text[], jsonb)    TO authenticated;

-- ============================================================
-- 20260622205645_a1f85919-4d7f-4df2-afd0-709e7a5e9f0e.sql
-- ============================================================
begin;

-- 1) Hardening del trigger de perfil: bloquear auto-otorgarse permisos.
create or replace function public.protect_profile_sensitive_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Service role / SQL sin sesión (auth.uid() is null) pasa.
  -- Platform admin pasa.
  if auth.uid() is null or public.current_user_is_platform_admin() then
    return new;
  end if;

  if new.role is distinct from old.role
     or new.is_platform_admin is distinct from old.is_platform_admin
     or new.company_id is distinct from old.company_id
     or new.is_demo is distinct from old.is_demo
     or new.demo_mode is distinct from old.demo_mode
     or new.is_active is distinct from old.is_active
     or new.allowed_sections is distinct from old.allowed_sections
     or new.location_id is distinct from old.location_id
  then
    raise exception 'No tienes permiso para modificar campos protegidos del perfil.';
  end if;

  return new;
end;
$$;

-- 2) Helper: requiere rol admin de tienda (o platform admin) y no demo.
create or replace function public.can_admin_company(p_company_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select auth.uid() is not null
    and not public.current_user_is_demo()
    and (
      public.current_user_is_platform_admin()
      or (
        p_company_id = public.current_user_company_id()
        and public.current_user_role() = 'admin'::public.app_role
      )
    );
$$;

revoke execute on function public.can_admin_company(uuid) from public, anon;
grant execute on function public.can_admin_company(uuid) to authenticated;

-- 3) Reemplazar policies de escritura en catálogo: exigir rol admin.
drop policy if exists "companies write scoped" on public.companies;
create policy "companies write scoped" on public.companies
  for all to authenticated
  using (public.can_admin_company(id))
  with check (public.can_admin_company(id));

drop policy if exists "products write scoped" on public.products;
create policy "products write scoped" on public.products
  for all to authenticated
  using (public.can_admin_company(company_id))
  with check (public.can_admin_company(company_id));

drop policy if exists "promotions write scoped" on public.promotions;
create policy "promotions write scoped" on public.promotions
  for all to authenticated
  using (public.can_admin_company(company_id))
  with check (public.can_admin_company(company_id));

drop policy if exists "categories write scoped" on public.categories;
create policy "categories write scoped" on public.categories
  for all to authenticated
  using (public.can_admin_company(company_id))
  with check (public.can_admin_company(company_id));

commit;

-- ============================================================
-- 20260622210812_52242cdf-6ed5-4761-8f27-c1a9f306c113.sql
-- ============================================================
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

-- ============================================================
-- 20260622212903_b161a95a-ccd2-46b7-b421-ef10f5ae62c0.sql
-- ============================================================

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


-- ============================================================
-- 20260622213524_083f28f4-9c52-46fd-91f9-236598814063.sql
-- ============================================================

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

-- (omitida limpieza de produccion: 20260622214136_30a690fb-4b72-49c3-9e41-ec87c75b8f86.sql)

-- ============================================================
-- 20260622220051_883259f1-9642-4ebf-af88-5d15a63d859e.sql
-- ============================================================
-- 1) profile_locations: add INSERT/UPDATE/DELETE policies for same-company admins
CREATE POLICY "profile_locations_insert_admin"
  ON public.profile_locations
  FOR INSERT
  TO authenticated
  WITH CHECK (public.can_admin_company(company_id));

CREATE POLICY "profile_locations_update_admin"
  ON public.profile_locations
  FOR UPDATE
  TO authenticated
  USING (public.can_admin_company(company_id))
  WITH CHECK (public.can_admin_company(company_id));

CREATE POLICY "profile_locations_delete_admin"
  ON public.profile_locations
  FOR DELETE
  TO authenticated
  USING (public.can_admin_company(company_id));

-- 2) profiles: switch existing policies from {public} to {authenticated}
DROP POLICY IF EXISTS "profiles select scoped" ON public.profiles;
CREATE POLICY "profiles select scoped"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR public.current_user_is_platform_admin()
    OR (company_id = public.current_user_company_id() AND public.current_user_role() = 'admin'::public.app_role)
  );

DROP POLICY IF EXISTS "profiles insert admin" ON public.profiles;
CREATE POLICY "profiles insert admin"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.current_user_is_platform_admin()
    OR (company_id = public.current_user_company_id() AND public.current_user_role() = 'admin'::public.app_role)
  );

DROP POLICY IF EXISTS "profiles update scoped" ON public.profiles;
CREATE POLICY "profiles update scoped"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    id = auth.uid()
    OR public.current_user_is_platform_admin()
    OR (company_id = public.current_user_company_id() AND public.current_user_role() = 'admin'::public.app_role)
  )
  WITH CHECK (
    id = auth.uid()
    OR public.current_user_is_platform_admin()
    OR (company_id = public.current_user_company_id() AND public.current_user_role() = 'admin'::public.app_role)
  );

DROP POLICY IF EXISTS "profiles delete admin" ON public.profiles;
CREATE POLICY "profiles delete admin"
  ON public.profiles
  FOR DELETE
  TO authenticated
  USING (
    public.current_user_is_platform_admin()
    OR (company_id = public.current_user_company_id() AND public.current_user_role() = 'admin'::public.app_role)
  );

-- 3) subscription_plans: switch write policy from {public} to {authenticated}
DROP POLICY IF EXISTS "plans write platform admin" ON public.subscription_plans;
CREATE POLICY "plans write platform admin"
  ON public.subscription_plans
  FOR ALL
  TO authenticated
  USING (public.current_user_is_platform_admin())
  WITH CHECK (public.current_user_is_platform_admin());


-- ============================================================
-- 20260623045625_f2160390-75e7-4d82-875c-3dc56ff76725.sql
-- ============================================================
ALTER TABLE public.products
  ADD COLUMN supplier_id uuid NULL
  REFERENCES public.suppliers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS products_supplier_id_idx
  ON public.products(supplier_id);
