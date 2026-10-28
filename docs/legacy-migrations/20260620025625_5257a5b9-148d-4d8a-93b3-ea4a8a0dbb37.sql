
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
