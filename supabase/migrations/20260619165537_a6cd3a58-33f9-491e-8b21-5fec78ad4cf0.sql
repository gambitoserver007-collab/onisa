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