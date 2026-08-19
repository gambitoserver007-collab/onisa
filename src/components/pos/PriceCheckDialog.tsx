import { useEffect, useMemo, useRef, useState } from "react";
import { Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useBusinessSettings } from "@/hooks/useBusinessSettings";
import type { Product } from "@/types";

// Verificador de precios (F9): consulta rápida de precio y stock SIN
// agregar nada al carrito -- para cuando un cliente pregunta "¿cuánto
// cuesta esto?" sin querer comprarlo todavía.
export interface PriceCheckDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  products: Product[];
}

export function PriceCheckDialog({
  open,
  onOpenChange,
  products,
}: PriceCheckDialogProps) {
  const { formatMoney } = useBusinessSettings();
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return products
      .filter(
        (product) =>
          product.name.toLowerCase().includes(q) ||
          product.barcode.includes(query.trim()) ||
          (product.sku?.toLowerCase().includes(q) ?? false),
      )
      .slice(0, 8);
  }, [products, query]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Verificador de precios</DialogTitle>
        </DialogHeader>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Nombre, código de barras o SKU..."
            className="pl-9"
          />
        </div>
        <div className="max-h-[50vh] space-y-1 overflow-y-auto">
          {query.trim() && results.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Sin resultados.
            </p>
          )}
          {results.map((product) => {
            const tracksStock = product.productType === "standard";
            return (
              <div
                key={product.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-border/60 p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {product.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {product.barcode || product.sku || "Sin código"}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-lg font-black tabular-nums">
                    {formatMoney(product.price)}
                  </p>
                  {tracksStock && (
                    <p className="text-xs text-muted-foreground">
                      {product.stock > 0
                        ? `${product.stock} disp.`
                        : "Sin stock"}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
