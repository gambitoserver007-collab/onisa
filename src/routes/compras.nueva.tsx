import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Plus, Trash2, Truck } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
import { useBusinessSettings } from "@/hooks/useBusinessSettings";
import { useCompanyCatalog } from "@/hooks/useCompanyCatalog";
import { useCurrentLocation } from "@/hooks/useCurrentLocation";
import { useDemoSession } from "@/hooks/useDemoSession";
import { ALL_LOCATIONS } from "@/lib/currentLocation";
import { blockDemoAction } from "@/lib/demoMode";
import { variantLabel } from "@/components/productos/VariantEditor";
import { createPurchase, fetchProductVariants, getErrorMessage } from "@/services/appData";
import type { ProductVariant } from "@/types";

export const Route = createFileRoute("/compras/nueva")({ component: NuevaCompra });

const NO_SUPPLIER = "__none__";

interface Row {
  productId: string;
  variantId: string | null;
  qty: number;
  cost: number;
}

function NuevaCompra() {
  const navigate = useNavigate();
  const { formatMoney } = useBusinessSettings();
  const { products, suppliers, isLoading } = useCompanyCatalog();
  const { isDemo, session } = useDemoSession();
  const [supplierId, setSupplierId] = useState<string>(NO_SUPPLIER);
  const [document, setDocument] = useState("");
  const [date, setDate] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const { currentLocationId } = useCurrentLocation();
  const [variantsByProduct, setVariantsByProduct] = useState<Record<string, ProductVariant[]>>({});
  const selectedSupplier = suppliers.find((s) => s.id === supplierId) ?? null;

  // Seed a first line once the catalog is available.
  useEffect(() => {
    if (!isLoading && products.length && rows.length === 0) {
      setRows([{ productId: products[0].id, variantId: null, qty: 1, cost: products[0].cost }]);
    }
  }, [isLoading, products, rows.length]);

  // Carga las variantes de los productos (con variantes) presentes en las líneas.
  useEffect(() => {
    rows.forEach((row) => {
      const product = products.find((p) => p.id === row.productId);
      if (product?.hasVariants && !variantsByProduct[product.id]) {
        void fetchProductVariants(product.id)
          .then((vs) => setVariantsByProduct((prev) => ({ ...prev, [product.id]: vs })))
          .catch(() => undefined);
      }
    });
  }, [rows, products, variantsByProduct]);

  const total = rows.reduce((sum, row) => sum + row.qty * row.cost, 0);

  const addRow = () => {
    if (!products.length) return;
    setRows((current) => [
      ...current,
      { productId: products[0].id, variantId: null, qty: 1, cost: products[0].cost },
    ]);
  };

  const handleSave = async () => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    if (!session) return;
    if (supplierId === NO_SUPPLIER) {
      toast.error("Selecciona un proveedor.");
      return;
    }
    const missingVariant = rows.some((row) => {
      const product = products.find((p) => p.id === row.productId);
      return product?.hasVariants && !row.variantId;
    });
    if (missingVariant) {
      toast.error("Elige la variante (talla/color) en los productos que la usan.");
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
      toast.error("Revisa las líneas: la cantidad debe ser entero ≥ 1 y el costo un número ≥ 0.");
      return;
    }
    setIsSaving(true);
    try {
      await createPurchase(session, {
        supplierId,
        documentNumber: document,
        date: date ? new Date(date).toISOString() : undefined,
        locationId: currentLocationId === ALL_LOCATIONS ? null : currentLocationId,
        items,
      });
      toast.success("Compra registrada y stock actualizado.");
      navigate({ to: "/compras" });
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo registrar la compra."));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AppShell>
      <PageHeader
        eyebrow="Abastecimiento"
        icon={Truck}
        title="Nueva Compra"
        description="Registra una compra a proveedor. Suma el stock automáticamente."
      />
      <Card>
        <CardContent className="space-y-4 p-4">
          {!isLoading && products.length === 0 ? (
            <div className="space-y-3">
              <EmptyState
                emoji="📦"
                title="Aún no tienes productos"
                description="Crea tu primer producto en la sección Productos para poder registrar una compra."
              />
              <div className="flex justify-center">
                <Button variant="brand" onClick={() => navigate({ to: "/productos" })}>
                  <Plus className="mr-1 h-4 w-4" /> Nuevo producto
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1">
                  <Select value={supplierId} onValueChange={setSupplierId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Proveedor" />
                    </SelectTrigger>
                    <SelectContent>
                      {suppliers.map((supplier) => (
                        <SelectItem key={supplier.id} value={supplier.id}>
                          {supplier.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {selectedSupplier && (
                    <p className="text-xs text-muted-foreground">
                      Documento: {selectedSupplier.ruc || "—"} · Tel:{" "}
                      {selectedSupplier.phone || "—"}
                    </p>
                  )}
                </div>
                <Input
                  placeholder="N° de factura (F001-001)"
                  value={document}
                  onChange={(event) => setDocument(event.target.value)}
                />
                <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
              </div>

              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Producto</TableHead>
                      <TableHead className="w-24">Cantidad</TableHead>
                      <TableHead className="w-28">Costo</TableHead>
                      <TableHead className="w-28 text-right">Subtotal</TableHead>
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
                              const product = products.find((x) => x.id === v);
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
                              {products.map((product) => (
                                <SelectItem key={product.id} value={product.id}>
                                  {product.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          {(() => {
                            const product = products.find((p) => p.id === row.productId);
                            if (!product?.hasVariants) return null;
                            const vs = variantsByProduct[product.id] ?? [];
                            return (
                              <Select
                                value={row.variantId ?? ""}
                                onValueChange={(vid) =>
                                  setRows((rs) =>
                                    rs.map((x, i) => (i === idx ? { ...x, variantId: vid } : x)),
                                  )
                                }
                              >
                                <SelectTrigger className="mt-1">
                                  <SelectValue placeholder="Elige variante" />
                                </SelectTrigger>
                                <SelectContent>
                                  {vs.map((variant) => (
                                    <SelectItem key={variant.id} value={variant.id}>
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
                                    ? { ...x, qty: Number.isFinite(n) ? Math.max(0, n) : 0 }
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
                                    ? { ...x, cost: Number.isFinite(n) ? Math.max(0, n) : 0 }
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
                            onClick={() => setRows((rs) => rs.filter((_, i) => i !== idx))}
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
                <Button variant="outline" onClick={() => navigate({ to: "/productos" })}>
                  <Plus className="mr-1 h-4 w-4" /> Nuevo producto
                </Button>
              </div>

              <div className="flex items-center justify-between border-t pt-3">
                <div>
                  <p className="text-xs text-muted-foreground">Total de la compra</p>
                  <span className="text-gradient text-2xl font-black tabular-nums">
                    {formatMoney(total)}
                  </span>
                </div>
                <Button
                  variant="brand"
                  disabled={isSaving || rows.length === 0 || supplierId === NO_SUPPLIER}
                  onClick={handleSave}
                >
                  {isSaving ? "Guardando..." : "Guardar compra"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
