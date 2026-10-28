
-- 1) Totales hoy / mes
create or replace function public.dashboard_sales_totals(
  p_location_id uuid default null,
  p_tz text default 'UTC'
) returns table (
  total_today numeric,
  count_today bigint,
  total_month numeric,
  count_month bigint
)
language sql stable security definer set search_path = public as $$
  with base as (
    select s.total, (s.sale_date at time zone p_tz)::date as d_local,
           date_trunc('month', (s.sale_date at time zone p_tz))::date as m_local
    from public.sales s
    where s.company_id = public.current_user_company_id()
      and s.deleted_at is null
      and (p_location_id is null or s.location_id = p_location_id)
      and public.user_can_access_location(s.location_id)
  ), today_ref as (
    select (now() at time zone p_tz)::date as today,
           date_trunc('month', (now() at time zone p_tz))::date as month_start
  )
  select
    coalesce(sum(case when b.d_local = t.today then b.total end), 0)::numeric as total_today,
    coalesce(count(*) filter (where b.d_local = t.today), 0)::bigint as count_today,
    coalesce(sum(case when b.m_local = t.month_start then b.total end), 0)::numeric as total_month,
    coalesce(count(*) filter (where b.m_local = t.month_start), 0)::bigint as count_month
  from today_ref t left join base b on true
  group by t.today, t.month_start;
$$;

-- 2) Ventas por día (últimos N días, rellenando 0)
create or replace function public.sales_by_day(
  p_location_id uuid default null,
  p_tz text default 'UTC',
  p_days int default 7
) returns table (day date, total numeric, count bigint)
language sql stable security definer set search_path = public as $$
  with days as (
    select generate_series(
      ((now() at time zone p_tz)::date - (p_days - 1)),
      (now() at time zone p_tz)::date,
      interval '1 day'
    )::date as day
  ), agg as (
    select (s.sale_date at time zone p_tz)::date as d_local,
           sum(s.total) as total, count(*) as count
    from public.sales s
    where s.company_id = public.current_user_company_id()
      and s.deleted_at is null
      and (p_location_id is null or s.location_id = p_location_id)
      and public.user_can_access_location(s.location_id)
      and (s.sale_date at time zone p_tz)::date
            >= ((now() at time zone p_tz)::date - (p_days - 1))
    group by 1
  )
  select d.day, coalesce(a.total, 0)::numeric, coalesce(a.count, 0)::bigint
  from days d left join agg a on a.d_local = d.day
  order by d.day;
$$;

-- 3) Ventas por categoría
create or replace function public.sales_by_category(
  p_location_id uuid default null,
  p_tz text default 'UTC',
  p_from timestamptz default null,
  p_to timestamptz default null
) returns table (category text, total numeric)
language sql stable security definer set search_path = public as $$
  select coalesce(c.name, 'Sin categoría') as category,
         sum(si.qty * si.unit_price)::numeric as total
  from public.sale_items si
  join public.sales s on s.id = si.sale_id
  left join public.products p on p.id = si.product_id
  left join public.categories c on c.id = p.category_id
  where s.company_id = public.current_user_company_id()
    and s.deleted_at is null
    and (p_location_id is null or s.location_id = p_location_id)
    and public.user_can_access_location(s.location_id)
    and (p_from is null or s.sale_date >= p_from)
    and (p_to is null or s.sale_date < p_to)
  group by coalesce(c.name, 'Sin categoría')
  order by total desc;
$$;

-- 4) Ventas por método de pago
create or replace function public.sales_by_payment_method(
  p_location_id uuid default null,
  p_tz text default 'UTC',
  p_from timestamptz default null,
  p_to timestamptz default null
) returns table (method text, total numeric, count bigint)
language sql stable security definer set search_path = public as $$
  select coalesce(s.payment_method, 'Otro') as method,
         sum(s.total)::numeric as total,
         count(*)::bigint as count
  from public.sales s
  where s.company_id = public.current_user_company_id()
    and s.deleted_at is null
    and (p_location_id is null or s.location_id = p_location_id)
    and public.user_can_access_location(s.location_id)
    and (p_from is null or s.sale_date >= p_from)
    and (p_to is null or s.sale_date < p_to)
  group by coalesce(s.payment_method, 'Otro')
  order by total desc;
$$;

grant execute on function public.dashboard_sales_totals(uuid, text) to authenticated;
grant execute on function public.sales_by_day(uuid, text, int) to authenticated;
grant execute on function public.sales_by_category(uuid, text, timestamptz, timestamptz) to authenticated;
grant execute on function public.sales_by_payment_method(uuid, text, timestamptz, timestamptz) to authenticated;
