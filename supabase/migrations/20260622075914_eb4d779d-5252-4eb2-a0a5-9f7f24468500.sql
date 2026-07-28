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