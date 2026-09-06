import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ShoppingBasket, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useBusinessSettings } from "@/hooks/useBusinessSettings";
import { useDemoSession } from "@/hooks/useDemoSession";
import {
  fetchPurchaseProjection,
  getErrorMessage,
  PURCHASE_PREFILL_STORAGE_KEY,
  type PurchaseProjectionItem,
  type PurchasePrefillPayload,
} from "@/services/appData";

export const Route = createFileRoute("/inventario/proyeccion")({
  component: Proyeccion,
});

const WINDOW_OPTIONS = [
  { value: "14", label: "Últimos 14 días" },
  { value: "30", label: "Últimos 30 días" },
  { value: "90", label: "Últimos 90 días" },
];

const COVERAGE_OPTIONS = [
  { value: "7", label: "1 semana" },
  { value: "15", label: "2 semanas" },
  { value: "30", label: "1 mes" },
  { value: "60", label: "2 meses" },
];

function urgencyVariant(days: number): "destructive" | "warm" | "success" {
  if (days <= 3) return "destructive";
  if (days <= 14) return "warm";
  return "success";
}

interface SupplierGroup {
  supplierId: string | null;
  supplierName: string;
  items: PurchaseProjectionItem[];
}

const NO_SUPPLIER_KEY = "__none__";

function Proyeccion() {
  const navigate = useNavigate();
  const { formatMoney } = useBusinessSettings();
  const { session, isReady } = useDemoSession();
  const [windowDays, setWindowDays] = useState("30");
  const [coverageDays, setCoverageDays] = useState("30");
  const [items, setItems] = useState<PurchaseProjectionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!isReady || !session?.companyId) return;
    setIsLoading(true);
    try {
      const result = await fetchPurchaseProjection(
        Number(windowDays),
        Number(coverageDays),
      );
      setItems(result.items);
    } catch (error) {
      toast.error(
        getErrorMessage(error, "No se pudo calcular la proyección de compra."),
      );
    } finally {
      setIsLoading(false);
    }
  }, [isReady, session?.companyId, windowDays, coverageDays]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Resurtido: solo lo que de verdad conviene comprar (suggestedQty > 0),
  // agrupado por proveedor -- un solo clic arma la orden de compra
  // completa para ese proveedor, prellenada para revisar antes de
  // confirmar (nunca se registra sola).
  const supplierGroups = useMemo<SupplierGroup[]>(() => {
    const map = new Map<string, SupplierGroup>();
    for (const item of items) {
      if (item.suggestedQty <= 0) continue;
      const key = item.supplierId ?? NO_SUPPLIER_KEY;
      let group = map.get(key);
      if (!group) {
        group = {
          supplierId: item.supplierId,
          supplierName: item.supplierName ?? "Sin proveedor asignado",
          items: [],
        };
        map.set(key, group);
      }
      group.items.push(item);
    }
    // Sin proveedor al final -- no se puede generar una orden para ese grupo.
    return Array.from(map.values()).sort((a, b) =>
      a.supplierId === null ? 1 : b.supplierId === null ? -1 : 0,
    );
  }, [items]);

  const generateOrder = (group: SupplierGroup) => {
    if (!group.supplierId) return;
    const payload: PurchasePrefillPayload = {
      supplierId: group.supplierId,
      items: group.items.map((item) => ({
        productId: item.id,
        qty: item.suggestedQty,
        cost: item.cost,
      })),
    };
    sessionStorage.setItem(
      PURCHASE_PREFILL_STORAGE_KEY,
      JSON.stringify(payload),
    );
    navigate({ to: "/compras/nueva" });
  };

  return (
    <AppShell>
      <PageHeader
        title="Proyección de compra"
        description="Qué se está vendiendo, cuándo se agota y cuánto conviene comprar."
        eyebrow="Inventario"
        icon={TrendingUp}
      />

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label>Velocidad calculada con</Label>
              <Select value={windowDays} onValueChange={setWindowDays}>
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WINDOW_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Comprar para cubrir</Label>
              <Select value={coverageDays} onValueChange={setCoverageDays}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COVERAGE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Solo muestra productos con ventas reales en el periodo elegido — sin
            historial, no hay nada que proyectar. La sugerencia de compra no
            descuenta lo que ya tengas en un pedido en camino.
          </p>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead className="text-right">Venta diaria</TableHead>
                  <TableHead className="text-right">Se agota en</TableHead>
                  <TableHead className="text-right">Comprar</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-8 text-center text-muted-foreground"
                    >
                      Calculando...
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && items.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <EmptyState
                        emoji="📈"
                        title="Sin datos suficientes"
                        description="Todavía no hay ventas registradas en este periodo para proyectar nada."
                      />
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  items.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.name}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {item.stock} {item.unit}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-muted-foreground">
                        {item.velocity.toFixed(2)} {item.unit}/día
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge variant={urgencyVariant(item.daysOfCoverage)}>
                          {item.daysOfCoverage.toFixed(0)} días
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-semibold tabular-nums">
                        {item.suggestedQty > 0
                          ? `${item.suggestedQty} ${item.unit}`
                          : "—"}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {!isLoading && supplierGroups.length > 0 && (
        <div className="mt-4 space-y-3">
          <h2 className="text-sm font-bold text-muted-foreground">
            Resurtido por proveedor
          </h2>
          {supplierGroups.map((group) => {
            const groupTotal = group.items.reduce(
              (sum, item) => sum + item.suggestedQty * item.cost,
              0,
            );
            return (
              <Card key={group.supplierId ?? NO_SUPPLIER_KEY}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ShoppingBasket className="h-4 w-4 text-muted-foreground" />
                    {group.supplierName}
                    <Badge variant="secondary">{group.items.length}</Badge>
                  </CardTitle>
                  {group.supplierId ? (
                    <Button size="sm" onClick={() => generateOrder(group)}>
                      Generar orden de compra
                    </Button>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      Asígnales un proveedor en Productos para poder generar su
                      orden
                    </span>
                  )}
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Producto</TableHead>
                          <TableHead className="text-right">Comprar</TableHead>
                          <TableHead className="text-right">Costo</TableHead>
                          <TableHead className="text-right">Subtotal</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {group.items.map((item) => (
                          <TableRow key={item.id}>
                            <TableCell className="font-medium">
                              {item.name}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {item.suggestedQty} {item.unit}
                            </TableCell>
                            <TableCell className="text-right tabular-nums text-muted-foreground">
                              {formatMoney(item.cost)}
                            </TableCell>
                            <TableCell className="text-right tabular-nums">
                              {formatMoney(item.suggestedQty * item.cost)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <p className="mt-2 text-right text-xs text-muted-foreground">
                    Total estimado: {formatMoney(groupTotal)}
                  </p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </AppShell>
  );
}
