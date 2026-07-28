import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Boxes } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { useCompanyCatalog } from "@/hooks/useCompanyCatalog";
import { useCurrentLocation } from "@/hooks/useCurrentLocation";
import { useDemoSession } from "@/hooks/useDemoSession";
import { blockDemoAction } from "@/lib/demoMode";
import {
  createStockAdjustment,
  fetchStockMovements,
  getErrorMessage,
  type StockMovementRow,
} from "@/services/appData";

export const Route = createFileRoute("/inventario/kardex")({ component: Kardex });

const tipoLabel: Record<string, string> = {
  in: "Entrada",
  purchase: "Compra",
  out: "Salida",
  sale: "Venta",
  adjustment: "Ajuste",
  transfer_in: "Transferencia (entra)",
  transfer_out: "Transferencia (sale)",
};

const tipoVariant: Record<string, "success" | "warm" | "soft"> = {
  in: "success",
  purchase: "success",
  transfer_in: "success",
  out: "warm",
  sale: "warm",
  transfer_out: "warm",
  adjustment: "soft",
};

const labelFor = (type: string) => tipoLabel[type] ?? type;

function Kardex() {
  const { products, session } = useCompanyCatalog();
  const { isDemo } = useDemoSession();
  const { currentLocationId, currentLocation, isAllLocations } = useCurrentLocation();
  const companyId = session?.companyId;

  const [movs, setMovs] = useState<StockMovementRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [tipo, setTipo] = useState("all");
  const [prod, setProd] = useState("all");

  // Ajuste manual
  const [adjOpen, setAdjOpen] = useState(false);
  const [aProduct, setAProduct] = useState("");
  const [aQty, setAQty] = useState("");
  const [aNotes, setANotes] = useState("");
  const [aSaving, setASaving] = useState(false);

  const reloadMovs = useCallback(async () => {
    if (!companyId) return;
    setIsLoading(true);
    try {
      setMovs(
        await fetchStockMovements(
          companyId,
          isAllLocations ? undefined : (currentLocationId ?? undefined),
        ),
      );
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudieron cargar los movimientos."));
    } finally {
      setIsLoading(false);
    }
  }, [companyId, isAllLocations, currentLocationId]);

  useEffect(() => {
    void reloadMovs();
  }, [reloadMovs]);

  // Tipos presentes (para el filtro) según lo que realmente haya en los datos.
  const types = useMemo(() => Array.from(new Set(movs.map((m) => m.movementType))), [movs]);

  const list = useMemo(
    () =>
      movs.filter(
        (m) =>
          (tipo === "all" || m.movementType === tipo) && (prod === "all" || m.productId === prod),
      ),
    [movs, tipo, prod],
  );

  const handleAdjust = async () => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    if (!session) return;
    if (isAllLocations || !currentLocationId) {
      toast.error("Elige una sucursal específica (arriba) para registrar un ajuste.");
      return;
    }
    setASaving(true);
    try {
      await createStockAdjustment(session, {
        productId: aProduct,
        locationId: currentLocationId,
        qty: Math.trunc(Number(aQty)),
        notes: aNotes,
      });
      toast.success("Ajuste registrado.");
      setAdjOpen(false);
      setAProduct("");
      setAQty("");
      setANotes("");
      await reloadMovs();
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo registrar el ajuste."));
    } finally {
      setASaving(false);
    }
  };

  return (
    <AppShell>
      <PageHeader
        title="Kardex"
        description="Movimientos de inventario por producto."
        eyebrow="Inventario"
        icon={Boxes}
        actions={
          <Button variant="outline" onClick={() => setAdjOpen(true)}>
            Ajuste manual
          </Button>
        }
      />

      <Dialog open={adjOpen} onOpenChange={setAdjOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ajuste de inventario</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Sucursal:{" "}
              <span className="font-medium text-foreground">
                {isAllLocations ? "Todas — elige una arriba" : (currentLocation?.name ?? "—")}
              </span>
            </p>
            <div className="space-y-1">
              <Label>Producto</Label>
              <Select value={aProduct} onValueChange={setAProduct}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecciona..." />
                </SelectTrigger>
                <SelectContent>
                  {products
                    .filter((p) => !p.hasVariants)
                    .map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Los productos con variantes (talla/color) se ajustan desde su edición, no aquí.
              </p>
            </div>
            <div className="space-y-1">
              <Label>Cantidad (+/-)</Label>
              <Input
                type="number"
                value={aQty}
                onChange={(event) => setAQty(event.target.value)}
                placeholder="Ej. -2 para descontar"
              />
            </div>
            <div className="space-y-1">
              <Label>Motivo</Label>
              <Input
                value={aNotes}
                onChange={(event) => setANotes(event.target.value)}
                placeholder="Pérdida, merma, conteo físico..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="brand"
              disabled={aSaving || isAllLocations || !aProduct || !aQty}
              onClick={handleAdjust}
            >
              {aSaving ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex flex-wrap gap-2">
            <Select value={prod} onValueChange={setProd}>
              <SelectTrigger className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los productos</SelectItem>
                {products.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={tipo} onValueChange={setTipo}>
              <SelectTrigger className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los tipos</SelectItem>
                {types.map((t) => (
                  <SelectItem key={t} value={t}>
                    {labelFor(t)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead>Sucursal</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="text-right">Cantidad</TableHead>
                  <TableHead>Motivo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                      Cargando movimientos...
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && list.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <EmptyState
                        emoji="📦"
                        title="Sin movimientos"
                        description="No hay movimientos para los filtros seleccionados."
                      />
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  list.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="whitespace-nowrap">
                        {m.createdAt.slice(0, 10)}
                        <span className="ml-1 text-xs text-muted-foreground">
                          {m.createdAt.slice(11, 16)}
                        </span>
                      </TableCell>
                      <TableCell className="font-medium">{m.productName}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {m.locationName ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={tipoVariant[m.movementType] ?? "outline"}>
                          {labelFor(m.movementType)}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className={`text-right font-medium tabular-nums ${
                          m.qty < 0 ? "text-destructive" : ""
                        }`}
                      >
                        {m.qty > 0 ? `+${m.qty}` : m.qty}
                      </TableCell>
                      <TableCell className="text-muted-foreground">{m.notes ?? "—"}</TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}
