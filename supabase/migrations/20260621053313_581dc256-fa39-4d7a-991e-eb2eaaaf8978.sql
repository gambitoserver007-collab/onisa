
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
