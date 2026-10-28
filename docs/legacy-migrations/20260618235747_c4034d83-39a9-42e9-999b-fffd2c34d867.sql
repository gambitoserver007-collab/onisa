create unique index if not exists products_company_barcode_unique
  on public.products (company_id, barcode)
  where barcode is not null and deleted_at is null;