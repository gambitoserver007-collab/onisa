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