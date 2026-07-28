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