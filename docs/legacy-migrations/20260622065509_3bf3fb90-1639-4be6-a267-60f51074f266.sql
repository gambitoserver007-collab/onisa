do $$
declare
  v_keep_email text := 'superadmin@user.test';
  v_keep_id uuid;
  v_deleted int;
  v_remaining int;
  v_is_admin boolean;
begin
  select id into v_keep_id from auth.users where lower(email) = v_keep_email;
  if v_keep_id is null then
    raise exception 'Cuenta a conservar (%) no existe. Abortando.', v_keep_email;
  end if;

  delete from auth.users
  where lower(email) in (
    'superadmin@demo.test',
    'admintienda@user.test',
    'finanzas@user.test',
    'cajera@user.test',
    'anunciosfbads2@gmail.com'
  );
  get diagnostics v_deleted = row_count;

  select count(*) into v_remaining from auth.users;
  if v_remaining <> 1 then
    raise exception 'Verificacion fallida: quedan % cuentas en auth.users (esperado 1).', v_remaining;
  end if;

  select is_platform_admin into v_is_admin
  from public.profiles where id = v_keep_id;
  if v_is_admin is not true then
    raise exception 'Verificacion fallida: % ya no es platform admin.', v_keep_email;
  end if;

  raise notice 'OK: eliminadas % cuentas. Conservada: % (platform admin).', v_deleted, v_keep_email;
end $$;