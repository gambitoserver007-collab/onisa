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
