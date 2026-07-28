-- 1) Partial unique index: only one open session per (company_id, location_id)
create unique index if not exists cash_sessions_one_open_per_location
  on public.cash_sessions (company_id, location_id)
  where status = 'open';

-- 2) Server-side open: blocks duplicates with a clear error
create or replace function public.open_cash_session(
  p_opening_amount numeric,
  p_location_id uuid default null
) returns uuid
language plpgsql
set search_path to 'public'
as $function$
declare
  v_company_id uuid;
  v_location_id uuid;
  v_session_id uuid;
begin
  if auth.uid() is null then raise exception 'No autenticado.'; end if;
  if public.current_user_is_demo() then
    raise exception 'Esta accion esta deshabilitada en el Modo de Prueba.';
  end if;

  v_company_id := public.current_user_company_id();
  if v_company_id is null then raise exception 'El usuario no tiene empresa asociada.'; end if;

  v_location_id := p_location_id;
  if v_location_id is null then
    select location_id into v_location_id from public.profiles where id = auth.uid();
  end if;
  if v_location_id is null then
    select id into v_location_id from public.locations
      where company_id = v_company_id and deleted_at is null
      order by created_at limit 1;
  end if;
  if v_location_id is null then raise exception 'No hay punto de venta configurado.'; end if;

  perform 1 from public.locations where id = v_location_id and company_id = v_company_id;
  if not found then raise exception 'Sucursal invalida.'; end if;

  if exists (
    select 1 from public.cash_sessions
    where company_id = v_company_id and location_id = v_location_id and status = 'open'
  ) then
    raise exception 'Ya hay una caja abierta en esta sucursal.';
  end if;

  insert into public.cash_sessions
    (company_id, location_id, status, opening_amount, opened_by, opened_at)
  values
    (v_company_id, v_location_id, 'open', greatest(coalesce(p_opening_amount,0), 0),
     auth.uid(), now())
  returning id into v_session_id;

  return v_session_id;
end;
$function$;

revoke all on function public.open_cash_session(numeric, uuid) from public;
grant execute on function public.open_cash_session(numeric, uuid) to authenticated;

-- 3) Server-side close: recomputes expected on the server, only closes still-open sessions
create or replace function public.close_cash_session(
  p_session_id uuid,
  p_real_amount numeric
) returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  v_company_id uuid;
  v_session public.cash_sessions%rowtype;
  v_movements numeric(12,2) := 0;
  v_cash_sales numeric(12,2) := 0;
  v_expected numeric(12,2);
  v_real numeric(12,2);
  v_diff numeric(12,2);
  v_rows int;
begin
  if auth.uid() is null then raise exception 'No autenticado.'; end if;
  if public.current_user_is_demo() then
    raise exception 'Esta accion esta deshabilitada en el Modo de Prueba.';
  end if;

  v_company_id := public.current_user_company_id();
  if v_company_id is null then raise exception 'El usuario no tiene empresa asociada.'; end if;

  -- Lock the row so concurrent closes can't double-process
  select * into v_session from public.cash_sessions
    where id = p_session_id and company_id = v_company_id
    for update;
  if not found then raise exception 'Caja no encontrada.'; end if;
  if v_session.status <> 'open' then
    raise exception 'Esta caja ya está cerrada.';
  end if;

  -- Sum signed cash movements for this session (egreso is stored negative)
  select coalesce(sum(amount), 0) into v_movements
  from public.cash_movements
  where cash_session_id = v_session.id;

  -- Sum cash sales since the session opened in the same location
  select coalesce(sum(total), 0) into v_cash_sales
  from public.sales
  where company_id = v_company_id
    and location_id = v_session.location_id
    and deleted_at is null
    and payment_method = 'Efectivo'
    and sale_date >= v_session.opened_at;

  v_expected := round(coalesce(v_session.opening_amount, 0) + v_movements + v_cash_sales, 2);
  v_real := round(coalesce(p_real_amount, 0), 2);
  v_diff := round(v_real - v_expected, 2);

  -- Only close if still open (defensive, race-safe)
  update public.cash_sessions set
    status = 'closed',
    closed_at = now(),
    closed_by = auth.uid(),
    expected_amount = v_expected,
    real_amount = v_real,
    difference = v_diff,
    updated_at = now()
  where id = v_session.id and status = 'open';
  get diagnostics v_rows = row_count;
  if v_rows = 0 then raise exception 'Esta caja ya está cerrada.'; end if;

  return jsonb_build_object(
    'session_id', v_session.id,
    'opening_amount', v_session.opening_amount,
    'movements', v_movements,
    'cash_sales', v_cash_sales,
    'expected_amount', v_expected,
    'real_amount', v_real,
    'difference', v_diff
  );
end;
$function$;

revoke all on function public.close_cash_session(uuid, numeric) from public;
grant execute on function public.close_cash_session(uuid, numeric) to authenticated;