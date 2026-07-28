import { Plus, Search } from "lucide-react";
import type { Product } from "@/types";
import { useBusinessSettings } from "@/hooks/useBusinessSettings";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getProductImage, getProductVisual } from "@/lib/productVisuals";
import { cn } from "@/lib/utils";

interface ProductCatalogProps {
  products: Product[];
  categories: string[];
  query: string;
  category: string;
  isLoading?: boolean;
  onQueryChange: (value: string) => void;
  onCategoryChange: (value: string) => void;
  onAddProduct: (product: Product) => void;
  onScan?: (code: string) => void;
}

export function ProductCatalog({
  products,
  categories,
  query,
  category,
  isLoading = false,
  onQueryChange,
  onCategoryChange,
  onAddProduct,
  onScan,
}: ProductCatalogProps) {
  const { formatMoney } = useBusinessSettings();

  return (
    <section className="min-w-0 space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="h-12 rounded-2xl pl-10 text-sm"
            placeholder="Buscar o escanear código de barras..."
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onScan?.(event.currentTarget.value);
              }
            }}
          />
        </div>
        <Select value={category} onValueChange={onCategoryChange}>
          <SelectTrigger className="h-12 shrink-0 rounded-2xl sm:w-56">
            <SelectValue placeholder="Categoría" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas las categorías</SelectItem>
            {categories.map((item) => (
              <SelectItem key={item} value={item}>
                {item}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {isLoading &&
          Array.from({ length: 8 }).map((_, index) => (
            <div
              key={index}
              className="animate-pulse rounded-2xl border border-border/60 bg-card p-2.5"
            >
              <div className="aspect-square rounded-xl bg-muted" />
              <div className="mt-2.5 h-3.5 w-3/4 rounded bg-muted" />
              <div className="mt-2 h-4 w-1/2 rounded bg-muted" />
            </div>
          ))}

        {!isLoading && products.length === 0 && (
          <div className="col-span-full rounded-2xl border border-dashed border-border bg-card/60 py-12 text-center text-sm text-muted-foreground">
            No hay productos para mostrar.
          </div>
        )}

        {!isLoading &&
          products.map((product) => {
            const outOfStock = product.stock === 0;
            const lowStock = product.stock > 0 && product.stock < 10;
            const image = getProductImage(product);
            const visual = getProductVisual(product);

            return (
              <button
                key={product.id}
                type="button"
                disabled={outOfStock}
                onClick={() => onAddProduct(product)}
                className={cn(
                  "group relative flex flex-col overflow-hidden rounded-2xl border border-border/70 bg-card p-2.5 text-left shadow-card transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-soft focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-[0.98]",
                  outOfStock &&
                    "cursor-not-allowed opacity-60 hover:translate-y-0 hover:shadow-card",
                )}
              >
                <div
                  className={cn(
                    "relative aspect-square w-full overflow-hidden rounded-xl bg-gradient-to-br",
                    visual.gradient,
                  )}
                >
                  {image ? (
                    <img
                      src={image}
                      alt={product.name}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    />
                  ) : (
                    <span className="grid h-full w-full place-items-center text-4xl sm:text-5xl">
                      {visual.emoji}
                    </span>
                  )}

                  {outOfStock ? (
                    <span className="absolute left-2 top-2 rounded-full bg-destructive px-2 py-0.5 text-[10px] font-bold text-destructive-foreground">
                      Agotado
                    </span>
                  ) : lowStock ? (
                    <span className="absolute left-2 top-2 rounded-full bg-warm px-2 py-0.5 text-[10px] font-bold text-warm-foreground">
                      Quedan {product.stock}
                    </span>
                  ) : null}

                  {!outOfStock && (
                    <span className="absolute bottom-2 right-2 grid h-8 w-8 place-items-center rounded-full bg-brand-gradient text-primary-foreground shadow-glow transition-transform duration-200 group-hover:scale-110 group-active:scale-95">
                      <Plus className="h-4 w-4" />
                    </span>
                  )}
                </div>

                <p className="mt-2.5 line-clamp-2 min-h-9 text-sm font-semibold leading-tight">
                  {product.name}
                </p>
                <div className="mt-1 flex items-center justify-between gap-2">
                  <span className="text-base font-extrabold text-foreground">
                    {formatMoney(product.price)}
                  </span>
                  {!outOfStock && !lowStock && (
                    <Badge variant="soft" className="px-2 py-0 text-[10px]">
                      {product.stock} {product.unit}
                    </Badge>
                  )}
                </div>
              </button>
            );
          })}
      </div>
    </section>
  );
}
