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