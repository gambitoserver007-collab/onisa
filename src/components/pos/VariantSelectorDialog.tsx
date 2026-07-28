import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useBusinessSettings } from "@/hooks/useBusinessSettings";
import type { Product, ProductVariant } from "@/types";

interface VariantSelectorDialogProps {
  product: Product | null;
  variants: ProductVariant[];
  loading: boolean;
  /** Stock por variante en la sucursal activa (variantId -> stock). */
  variantStock: Map<string, number>;
  onSelect: (variant: ProductVariant) => void;
  onClose: () => void;
}

export function VariantSelectorDialog({
  product,
  variants,
  loading,
  variantStock,
  onSelect,
  onClose,
}: VariantSelectorDialogProps) {
  const { formatMoney } = useBusinessSettings();
  return (
    <Dialog
      open={!!product}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Elige la variante{product ? ` — ${product.name}` : ""}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Cargando variantes…</p>
        ) : variants.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Este producto no tiene variantes disponibles en esta sucursal.
          </p>
        ) : (
          <div className="grid max-h-[60vh] gap-2 overflow-y-auto">
            {variants.map((variant) => {
              const stock = variantStock.get(variant.id) ?? 0;
              const price =
                variant.priceOverride != null ? variant.priceOverride : (product?.price ?? 0);
              return (
                <Button
                  key={variant.id}
                  variant="outline"
                  disabled={stock <= 0}
                  className="h-auto justify-between py-3"
                  onClick={() => onSelect(variant)}
                >
                  <span className="flex flex-col items-start">
                    <span className="font-semibold">{variant.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatMoney(price)} · {stock > 0 ? `${stock} disp.` : "Sin stock"}
                    </span>
                  </span>
                </Button>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
