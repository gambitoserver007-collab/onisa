import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useBusinessSettings } from "@/hooks/useBusinessSettings";
import { useCompanyCatalog } from "@/hooks/useCompanyCatalog";
import { useCurrentLocation } from "@/hooks/useCurrentLocation";
import { useDemoSession } from "@/hooks/useDemoSession";
import { ALL_LOCATIONS } from "@/lib/currentLocation";
import { blockDemoAction } from "@/lib/demoMode";
import { variantLabel } from "@/components/productos/VariantEditor";
import { ProductFormSheet } from "@/components/productos/ProductFormSheet";
import {
  createPurchase,
  fetchProductVariants,
  getErrorMessage,
} from "@/services/appData";
import type { ProductVariant } from "@/types";

interface Row {
  productId: string;
  variantId: string | null;
  qty: number;
  cost: number;
}

export function PurchaseFormSheet({
  open,
  onOpenChange,
  supplierId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Proveedor al que se le compra (fijo en este panel). */
  supplierId: string;
  /** Se llama tras registrar la compra con éxito. */
  onSaved?: () => void | Promise<void>;
}) {
  const { formatMoney } = useBusinessSettings();
  const { products, suppliers, reload } = useCompanyCatalog();
  const { isDemo, session } = useDemoSession();
  const { currentLocationId } = useCurrentLocation();
  const [document, setDocument] = useState("");
  const [date, setDate] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [variantsByProduct, setVariantsByProduct] = useState<
    Record<string, ProductVariant[]>
  >({});
  const [newProdOpen, setNewProdOpen] = useState(false);

  const supplier = suppliers.find((s) => s.id === supplierId) ?? null;
  // Solo los productos de este proveedor (más los que aún no tienen proveedor asignado).
  const availableProducts = products.filter(
    (p) => p.supplierId === supplierId || !p.supplierId,
  );

  // Al abrir, limpia el formulario y siembra una primera línea si hay productos.
  useEffect(() => {
    if (!open) return;
    setDocument("");
    setDate("");
    setRows(
      availableProducts.length
        ? [
            {
              productId: availableProducts[0].id,
              variantId: null,
              qty: 1,
              cost: availableProducts[0].cost,
            },
          ]
        : [],
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Carga las variantes de los productos (con variantes) presentes en las líneas.
  useEffect(() => {
    rows.forEach((row) => {
      const product = products.find((p) => p.id === row.productId);
      if (product?.hasVariants && !variantsByProduct[product.id]) {
        void fetchProductVariants(product.id)
          .then((vs) =>
            setVariantsByProduct((prev) => ({ ...prev, [product.id]: vs })),
          )
          .catch(() => undefined);
      }
    });
  }, [rows, products, variantsByProduct]);

  const total = rows.reduce((sum, row) => sum + row.qty * row.cost, 0);

  const addRow = () => {
    if (!availableProducts.length) return;
    setRows((current) => [
      ...current,
      {
        productId: availableProducts[0].id,
        variantId: null,
        qty: 1,
        cost: availableProducts[0].cost,
      },
    ]);
  };

  // Tras crear un producto nuevo, recarga el catálogo y lo agrega como línea.
  const handleProductCreated = async (newId: string) => {
    await reload();
    setRows((current) => [
      ...current,
      { productId: newId, variantId: null, qty: 1, cost: 0 },
    ]);
  };

  const handleSave = async () => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    if (!session) return;
    if (!supplierId) {
      toast.error("Selecciona un proveedor.");
      return;
    }
    const missingVariant = rows.some((row) => {
      const product = products.find((p) => p.id === row.productId);
      return product?.hasVariants && !row.variantId;
    });
    if (missingVariant) {
      toast.error(
        "Elige la variante (talla/color) en los productos que la usan.",
      );
      return;
    }
    const items = rows.map((row) => ({
      productId: row.productId,
      variantId: row.variantId,
      qty: Math.trunc(Number(row.qty)),
      unitCost: Number(row.cost),
    }));
    if (
      items.length === 0 ||
      items.some(
        (it) =>
          !it.productId ||
          !Number.isFinite(it.qty) ||
          it.qty < 1 ||
          !Number.isFinite(it.unitCost) ||
          it.unitCost < 0,
      )
    ) {
      toast.error(
        "Revisa las líneas: la cantidad debe ser entero ≥ 1 y el costo un número ≥ 0.",
      );
      return;
    }
    setIsSaving(true);
    try {
      await createPurchase(session, {
        supplierId,
        documentNumber: document,
        date: date ? new Date(date).toISOString() : undefined,
        locationId:
          currentLocationId === ALL_LOCATIONS ? null : currentLocationId,
        items,
      });
      toast.success("Compra registrada y stock actualizado.");
      onOpenChange(false);
      await onSaved?.();
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo registrar la compra."));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent className="flex w-full flex-col sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>
              Nueva compra{supplier ? ` · ${supplier.name}` : ""}
            </SheetTitle>
          </SheetHeader>
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {supplier && (
              <p className="text-xs text-muted-foreground">
                Documento: {supplier.ruc || "—"} · Tel: {supplier.phone || "—"}
              </p>
            )}

            {availableProducts.length === 0 ? (
              <div className="space-y-3 rounded-lg border p-4 text-center">
                <p className="text-sm text-muted-foreground">
                  Este proveedor aún no tiene productos. Crea el primero para
                  registrar la compra.
                </p>
                <Button variant="brand" onClick={() => setNewProdOpen(true)}>
                  <Plus className="mr-1 h-4 w-4" /> Nuevo producto
                </Button>
              </div>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>N° de factura</Label>
                    <Input
                      placeholder="F001-001"
                      value={document}
                      onChange={(event) => setDocument(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Fecha</Label>
                    <Input
                      type="date"
                      value={date}
                      onChange={(event) => setDate(event.target.value)}
                    />
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Producto</TableHead>
                        <TableHead className="w-20">Cantidad</TableHead>
                        <TableHead className="w-24">Costo</TableHead>
                        <TableHead className="w-24 text-right">
                          Subtotal
                        </TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((row, idx) => (
                        <TableRow key={idx}>
                          <TableCell>
                            <Select
                              value={row.productId}
                              onValueChange={(v) => {
                                const product = products.find(
                                  (x) => x.id === v,
                                );
                                setRows((rs) =>
                                  rs.map((x, i) =>
                                    i === idx
                                      ? {
                                          ...x,
                                          productId: v,
                                          variantId: null,
                                          cost: product?.cost ?? x.cost,
                                        }
                                      : x,
                                  ),
                                );
                              }}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {availableProducts.map((product) => (
                                  <SelectItem
                                    key={product.id}
                                    value={product.id}
                                  >
                                    {product.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {(() => {
                              const product = products.find(
                                (p) => p.id === row.productId,
                              );
                              if (!product?.hasVariants) return null;
                              const vs = variantsByProduct[product.id] ?? [];
                              return (
                                <Select
                                  value={row.variantId ?? ""}
                                  onValueChange={(vid) =>
                                    setRows((rs) =>
                                      rs.map((x, i) =>
                                        i === idx
                                          ? { ...x, variantId: vid }
                                          : x,
                                      ),
                                    )
                                  }
                                >
                                  <SelectTrigger className="mt-1">
                                    <SelectValue placeholder="Elige variante" />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {vs.map((variant) => (
                                      <SelectItem
                                        key={variant.id}
                                        value={variant.id}
                                      >
                                        {variantLabel(variant.attributes)}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              );
                            })()}
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              min={1}
                              step="1"
                              value={row.qty}
                              onChange={(e) => {
                                const n = Math.trunc(Number(e.target.value));
                                setRows((rs) =>
                                  rs.map((x, i) =>
                                    i === idx
                                      ? {
                                          ...x,
                                          qty: Number.isFinite(n)
                                            ? Math.max(0, n)
                                            : 0,
                                        }
                                      : x,
                                  ),
                                );
                              }}
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              type="number"
                              step="0.1"
                              min={0}
                              value={row.cost}
                              onChange={(e) => {
                                const n = Number(e.target.value);
                                setRows((rs) =>
                                  rs.map((x, i) =>
                                    i === idx
                                      ? {
                                          ...x,
                                          cost: Number.isFinite(n)
                                            ? Math.max(0, n)
                                            : 0,
                                        }
                                      : x,
                                  ),
                                );
                              }}
                            />
                          </TableCell>
                          <TableCell className="text-right font-medium">
                            {formatMoney(row.qty * row.cost)}
                          </TableCell>
                          <TableCell>
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() =>
                                setRows((rs) => rs.filter((_, i) => i !== idx))
                              }
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={addRow}>
                    <Plus className="mr-1 h-4 w-4" /> Agregar producto
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setNewProdOpen(true)}
                  >
                    <Plus className="mr-1 h-4 w-4" /> Nuevo producto
                  </Button>
                </div>
              </>
            )}
          </div>
          <SheetFooter>
            <div className="flex w-full items-center justify-between">
              <div>
                <p className="text-xs text-muted-foreground">
                  Total de la compra
                </p>
                <span className="text-gradient text-2xl font-black tabular-nums">
                  {formatMoney(total)}
                </span>
              </div>
              <Button
                variant="brand"
                disabled={isSaving || rows.length === 0 || !supplierId}
                onClick={handleSave}
              >
                {isSaving ? "Guardando..." : "Guardar compra"}
              </Button>
            </div>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {/* Crear producto nuevo sin salir de la compra (panel completo de Productos). */}
      <ProductFormSheet
        open={newProdOpen}
        onOpenChange={setNewProdOpen}
        defaultSupplierId={supplierId}
        lockSupplier
        onSaved={handleProductCreated}
      />
    </>
  );
}
