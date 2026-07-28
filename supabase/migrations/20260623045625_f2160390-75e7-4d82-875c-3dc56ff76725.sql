ALTER TABLE public.products
  ADD COLUMN supplier_id uuid NULL
  REFERENCES public.suppliers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS products_supplier_id_idx
  ON public.products(supplier_id);