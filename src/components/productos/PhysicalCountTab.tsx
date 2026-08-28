import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { EmptyState } from "@/components/layout/EmptyState";
import { useCompanyCatalog } from "@/hooks/useCompanyCatalog";
import { useCurrentLocation } from "@/hooks/useCurrentLocation";
import { useDemoSession } from "@/hooks/useDemoSession";
import { ALL_LOCATIONS } from "@/lib/currentLocation";
import { blockDemoAction } from "@/lib/demoMode";
import {
  createStockAdjustment,
  fetchLocationStock,
  getErrorMessage,
} from "@/services/appData";

// Conteo físico: captura la cantidad REAL contada en piso por sucursal y
// ajusta el stock por la diferencia contra lo que el sistema tiene
// registrado -- reutiliza la misma RPC `adjust_stock` que el Kardex (un
// conteo físico es, matemáticamente, un ajuste con delta = contado - sistema).
// Solo productos estándar sin variantes: son los únicos con stock propio por
// sucursal (los combos se arman de piezas y los servicios no llevan stock).
export function PhysicalCountTab({ onChanged }: { onChanged: () => void }) {
  const { products, session } = useCompanyCatalog();
  const { locations, currentLocationId, hasMultiple } = useCurrentLocation();
  const { isDemo } = useDemoSession();

  const [locationId, setLocationId] = useState("");
  const [systemStock, setSystemStock] = useState<Map<string, number>>(
    new Map(),
  );
  const [isLoadingStock, setIsLoadingStock] = useState(false);
  const [query, setQuery] = useState("");
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (locationId) return;
    if (currentLocationId && currentLocationId !== ALL_LOCATIONS) {
      setLocationId(currentLocationId);
    } else if (locations[0]) {
      setLocationId(locations[0].id);
    }
  }, [currentLocationId, locations, locationId]);

  useEffect(() => {
    if (!locationId) return;
    let active = true;
    setIsLoadingStock(true);
    setCounts({});
    void fetchLocationStock(locationId)
      .then((map) => {
        if (active) setSystemStock(map);
      })
      .catch(() => {
        if (active) setSystemStock(new Map());
      })
      .finally(() => {
        if (active) setIsLoadingStock(false);
      });
    return () => {
      active = false;
    };
  }, [locationId]);

  const eligibleProducts = useMemo(
    () =>
      products
        .filter(
          (p) =>
            p.productType === "standard" &&
            !p.hasVariants &&
            systemStock.has(p.id),
        )
        .filter(
          (p) =>
            p.name.toLowerCase().includes(query.toLowerCase()) ||
            p.barcode.includes(query) ||
            (p.sku?.toLowerCase().includes(query.toLowerCase()) ?? false),
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [products, systemStock, query],
  );

  const pendingChanges = useMemo(() => {
    return eligibleProducts
      .map((product) => {
        const sys = systemStock.get(product.id) ?? 0;
        const raw = counts[product.id];
        if (raw === undefined || raw.trim() === "") return null;
        const counted = Number(raw);
        if (!Number.isFinite(counted) || counted < 0) return null;
        const diff = counted - sys;
        if (diff === 0) return null;
        return { product, sys, counted, diff };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null);
  }, [eligibleProducts, systemStock, counts]);

  const handleSave = async () => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    if (!session) return;
    if (pendingChanges.length === 0) {
      toast.error("No hay diferencias que guardar todavía.");
      return;
    }
    if (
      !window.confirm(
        `¿Aplicar el conteo? Se ajustará el stock de ${pendingChanges.length} producto(s) según lo capturado.`,
      )
    ) {
      return;
    }
    setIsSaving(true);
    let okCount = 0;
    const failed: string[] = [];
    for (const change of pendingChanges) {
      try {
        await createStockAdjustment(session, {
          productId: change.product.id,
          locationId,
          qty: change.diff,
          notes: "Conteo físico",
        });
        okCount += 1;
      } catch (error) {
        failed.push(`${change.product.name}: ${getErrorMessage(error)}`);
      }
    }
    setIsSaving(false);
    if (okCount > 0) {
      toast.success(`Conteo aplicado a ${okCount} producto(s).`);
      setCounts({});
      try {
        setSystemStock(await fetchLocationStock(locationId));
      } catch {
        /* la tabla se refresca sola en el próximo cambio de filtro */
      }
      onChanged();
    }
    if (failed.length > 0) {
      toast.error(`No se pudo ajustar: ${failed.join(" · ")}`);
    }
  };

  return (
    <Card>
      <CardContent className="p-4">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          {hasMultiple && (
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger className="w-52">
                <SelectValue placeholder="Sucursal" />
              </SelectTrigger>
              <SelectContent>
                {locations.map((loc) => (
                  <SelectItem key={loc.id} value={loc.id}>
                    {loc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <div className="relative max-w-sm flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-10"
              placeholder="Buscar por nombre o código..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <Button
            variant="brand"
            className="sm:ml-auto"
            disabled={isSaving || pendingChanges.length === 0}
            onClick={handleSave}
          >
            {isSaving
              ? "Guardando..."
              : `Guardar conteo${pendingChanges.length ? ` (${pendingChanges.length})` : ""}`}
          </Button>
        </div>

        <p className="mb-3 text-xs text-muted-foreground">
          Captura la cantidad que cuentes físicamente. Solo se ajustan los
          productos donde escribas un número distinto al stock del sistema; deja
          el campo vacío para no tocar un producto.
        </p>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead className="text-right">Stock sistema</TableHead>
                <TableHead className="w-32 text-right">
                  Cantidad contada
                </TableHead>
                <TableHead className="text-right">Diferencia</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoadingStock && (
                <TableRow>
                  <TableCell
                    colSpan={4}
                    className="py-8 text-center text-muted-foreground"
                  >
                    Cargando stock de la sucursal...
                  </TableCell>
                </TableRow>
              )}
              {!isLoadingStock && eligibleProducts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4}>
                    <EmptyState
                      emoji="📋"
                      title="Sin productos para contar"
                      description="No hay productos estándar asignados a esta sucursal."
                    />
                  </TableCell>
                </TableRow>
              )}
              {!isLoadingStock &&
                eligibleProducts.map((product) => {
                  const sys = systemStock.get(product.id) ?? 0;
                  const raw = counts[product.id] ?? "";
                  const counted = raw.trim() === "" ? null : Number(raw);
                  const diff =
                    counted !== null && Number.isFinite(counted)
                      ? counted - sys
                      : null;
                  return (
                    <TableRow key={product.id}>
                      <TableCell>
                        <div className="font-medium">{product.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {product.barcode || product.sku || "Sin código"}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {sys} {product.unit}
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          min={0}
                          step="0.001"
                          className="text-right"
                          value={raw}
                          onChange={(event) =>
                            setCounts((prev) => ({
                              ...prev,
                              [product.id]: event.target.value,
                            }))
                          }
                          placeholder={String(sys)}
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        {diff === null ? (
                          <span className="text-muted-foreground">—</span>
                        ) : diff === 0 ? (
                          <Badge variant="success">Cuadrado</Badge>
                        ) : diff < 0 ? (
                          <Badge variant="destructive">{diff}</Badge>
                        ) : (
                          <Badge variant="warm">+{diff}</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
