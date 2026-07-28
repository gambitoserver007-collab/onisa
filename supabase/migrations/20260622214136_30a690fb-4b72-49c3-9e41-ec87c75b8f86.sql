-- Borrar cuenta de prueba qa.rol.test.2026@example.com
-- Solo tiene 1 perfil y 0 datos en su empresa.
do $$
declare v_user uuid := '613d84f6-2c80-4204-9ac9-0894af531385';
        v_company uuid := 'f484d6f7-cd13-427d-8cf3-7e7d95bbfc1f';
begin
  delete from public.profile_locations where profile_id = v_user;
  delete from public.profiles where id = v_user;
  delete from public.locations where company_id = v_company;
  delete from public.units where company_id = v_company;
  delete from public.companies where id = v_company;
  delete from auth.users where id = v_user;
end $$;