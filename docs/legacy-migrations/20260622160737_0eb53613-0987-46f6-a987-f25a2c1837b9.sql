create or replace function public.sync_product_variants(
  p_product_id uuid,
  p_attribute_names text[],
  p_variants jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company_id uuid;
  v_product public.products%rowtype;
  v_has_variants boolean;
  v_item jsonb;
  v_loc jsonb;
  v_variant_id uuid;
  v_kept uuid[] := array[]::uuid[];
  v_keep_locs uuid[];
  v_total_stock numeric(12,3) := 0;
begin
  if auth.uid() is null then raise exception 'No autenticado.'; end if;
  if public.current_user_is_demo() then
    raise exception 'Esta accion esta deshabilitada en el Modo de Prueba.';
  end if;

  v_company_id := public.current_user_company_id();
  if v_company_id is null then raise exception 'El usuario no tiene empresa asociada.'; end if;

  select * into v_product from public.products
    where id = p_product_id and company_id = v_company_id and deleted_at is null
    for update;
  if not found then raise exception 'Producto no encontrado.'; end if;

  v_has_variants := (p_variants is not null and jsonb_array_length(p_variants) > 0);

  if v_has_variants then
    for v_item in select * from jsonb_array_elements(p_variants) loop
      v_variant_id := nullif(v_item ->> 'id','')::uuid;

      if v_variant_id is not null then
        update public.product_variants set
          attributes = coalesce(v_item -> 'attributes', '{}'::jsonb),
          barcode = nullif(btrim(coalesce(v_item ->> 'barcode','')),''),
          sku = nullif(btrim(coalesce(v_item ->> 'sku','')),''),
          price_override = nullif(v_item ->> 'price_override','')::numeric,
          cost_override = nullif(v_item ->> 'cost_override','')::numeric,
          is_active = true,
          deleted_at = null,
          updated_at = now()
        where id = v_variant_id and product_id = p_product_id and company_id = v_company_id;
        if not found then raise exception 'Variante no encontrada.'; end if;
      else
        insert into public.product_variants
          (company_id, product_id, attributes, barcode, sku, price_override, cost_override, is_active)
        values (
          v_company_id, p_product_id,
          coalesce(v_item -> 'attributes', '{}'::jsonb),
          nullif(btrim(coalesce(v_item ->> 'barcode','')),''),
          nullif(btrim(coalesce(v_item ->> 'sku','')),''),
          nullif(v_item ->> 'price_override','')::numeric,
          nullif(v_item ->> 'cost_override','')::numeric,
          true
        )
        returning id into v_variant_id;
      end if;

      v_kept := v_kept || v_variant_id;

      -- Upsert locations for this variant
      v_keep_locs := array[]::uuid[];
      if (v_item ? 'locations') and jsonb_typeof(v_item -> 'locations') = 'array' then
        for v_loc in select * from jsonb_array_elements(v_item -> 'locations') loop
          insert into public.product_variant_locations
            (company_id, product_variant_id, location_id, stock, is_active)
          values (
            v_company_id, v_variant_id,
            (v_loc ->> 'location_id')::uuid,
            coalesce((v_loc ->> 'stock')::numeric, 0),
            true
          )
          on conflict (product_variant_id, location_id) do update
            set stock = excluded.stock, is_active = true, updated_at = now();
          v_keep_locs := v_keep_locs || (v_loc ->> 'location_id')::uuid;
        end loop;
      end if;

      -- Deactivate stale locations for this variant
      update public.product_variant_locations
        set is_active = false, updated_at = now()
        where product_variant_id = v_variant_id
          and is_active = true
          and (array_length(v_keep_locs,1) is null or not (location_id = any(v_keep_locs)));
    end loop;
  end if;

  -- Soft-delete variants not in the kept set
  update public.product_variants
    set deleted_at = now(), is_active = false, updated_at = now()
    where product_id = p_product_id
      and company_id = v_company_id
      and deleted_at is null
      and (array_length(v_kept,1) is null or not (id = any(v_kept)));

  -- Also deactivate their locations
  update public.product_variant_locations pvl
    set is_active = false, updated_at = now()
    where pvl.is_active = true
      and pvl.product_variant_id in (
        select id from public.product_variants
        where product_id = p_product_id
          and (array_length(v_kept,1) is null or not (id = any(v_kept)))
      );

  if v_has_variants then
    select coalesce(sum(stock),0) into v_total_stock
    from public.product_variant_locations
    where product_variant_id = any(v_kept) and is_active = true;

    update public.products set
      has_variants = true,
      variant_attributes = p_attribute_names,
      stock = v_total_stock,
      updated_at = now()
    where id = p_product_id;

    -- Deactivate flat product_locations: stock is owned by variants now
    update public.product_locations
      set is_active = false, updated_at = now()
      where product_id = p_product_id and is_active = true;
  else
    update public.products set
      has_variants = false,
      variant_attributes = null,
      updated_at = now()
    where id = p_product_id;
  end if;
end;
$$;

revoke all on function public.sync_product_variants(uuid, text[], jsonb) from public;
grant execute on function public.sync_product_variants(uuid, text[], jsonb) to authenticated;