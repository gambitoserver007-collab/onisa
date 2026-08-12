import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRightLeft,
  Boxes,
  DollarSign,
  Package,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { ALL_LOCATIONS } from "@/lib/currentLocation";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { useBusinessSettings } from "@/hooks/useBusinessSettings";
import { useCompanyCatalog } from "@/hooks/useCompanyCatalog";
import { useCurrentLocation } from "@/hooks/useCurrentLocation";
import { useDemoSession } from "@/hooks/useDemoSession";
import { blockDemoAction } from "@/lib/demoMode";
import { effectiveLowStockThreshold } from "@/lib/stockAlerts";
import {
  fetchLocationStock,
  fetchLocationVariantStock,
  fetchLowStockByLocation,
  transferStock,
  type LowStockRow,
  getErrorMessage,
} from "@/services/appData";
import { FallbackNotice } from "@/components/layout/FallbackNotice";
import { EmptyState } from "@/components/layout/EmptyState";
import { getProductImage, getProductVisual } from "@/lib/productVisuals";

export const Route = createFileRoute("/inventario/")({ component: Inventario });

function Kpi({
  icon: Icon,
  label,
  value,
  tone = "",
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  tone?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div
          className={`grid h-10 w-10 place-items-center rounded-lg ${tone || "bg-primary/10 text-primary"}`}
        >
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-bold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function Inventario() {
  const { formatMoney, settings } = useBusinessSettings();
  const {
    products: baseProducts,
    error,
    source,
    isLoading,
    reload,
  } = useCompanyCatalog();
  const { isDemo, session } = useDemoSession();
  const { locations, currentLocationId } = useCurrentLocation();
  const multiLocal = locations.length > 1;

  // La sucursal activa la manda el selector único de la barra superior.
  const location = currentLocationId ?? ALL_LOCATIONS;
  const [locStock, setLocStock] = useState<Map<string, number> | null>(null);

  // Stock por sucursal = product_locations + stock de variantes (product_variant_locations).
  // Antes solo se leía product_locations, por lo que los productos con variantes
  // (que guardan su stock por variante) desaparecían del inventario al elegir sucursal.
  const loadLocationStock = useCallback(async (loc: string) => {
    const [baseMap, variant] = await Promise.all([
      fetchLocationStock(loc),
      fetchLocationVariantStock(loc),
    ]);
    const merged = new Map(baseMap);
    variant.byProduct.forEach((qty, productId) =>
      merged.set(productId, (merged.get(productId) ?? 0) + qty),
    );
    return merged;
  }, []);

  useEffect(() => {
    if (location === ALL_LOCATIONS) {
      setLocStock(null);
      return;
    }
    let active = true;
    void loadLocationStock(location)
      .then((map) => active && setLocStock(map))
      .catch(() => active && setLocStock(null));
    return () => {
      active = false;
    };
  }, [location, loadLocationStock]);

  // Por local: solo los productos de ese local, con su stock. "Todos" = total.
  const products = useMemo(() => {
    if (location === ALL_LOCATIONS || !locStock) return baseProducts;
    return baseProducts
      .filter((p) => locStock.has(p.id))
      .map((p) => ({ ...p, stock: locStock.get(p.id) ?? 0 }));
  }, [baseProducts, location, locStock]);

  const valor = products.reduce((s, p) => s + p.cost * p.stock, 0);
  const bajo = products.filter(
    (p) =>
      p.stock > 0 &&
      p.stock <=
        effectiveLowStockThreshold(p, settings.lowStockThresholdDefault),
  );
  const sin = products.filter((p) => p.stock === 0);

  // Umbral efectivo más alto entre todos los productos: se usa como cota
  // generosa para la consulta de reposición por sucursal (product_locations
  // no tiene el umbral por producto, así que se filtra preciso después,
  // producto por producto, con el mismo umbral que ya se ve en pantalla).
  const maxThreshold = useMemo(
    () =>
      baseProducts.reduce(
        (max, p) =>
          Math.max(
            max,
            effectiveLowStockThreshold(p, settings.lowStockThresholdDefault),
          ),
        settings.lowStockThresholdDefault,
      ),
    [baseProducts, settings.lowStockThresholdDefault],
  );
  const thresholdByProduct = useMemo(
    () =>
      new Map(
        baseProducts.map((p) => [
          p.id,
          effectiveLowStockThreshold(p, settings.lowStockThresholdDefault),
        ]),
      ),
    [baseProducts, settings.lowStockThresholdDefault],
  );

  // Reposición consolidada: qué falta en cada local (solo si hay varios locales).
  const [lowByLoc, setLowByLoc] = useState<LowStockRow[]>([]);
  // Obedece el selector: una sucursal concreta → solo la suya; "Todas" → todas.
  const lowByLocView = useMemo(
    () =>
      (location === ALL_LOCATIONS
        ? lowByLoc
        : lowByLoc.filter((row) => row.locationId === location)
      ).filter(
        (row) => row.stock <= (thresholdByProduct.get(row.productId) ?? 0),
      ),
    [lowByLoc, location, thresholdByProduct],
  );
  const reloadLowByLoc = useCallback(async () => {
    if (!multiLocal || !session?.companyId) {
      setLowByLoc([]);
      return;
    }
    try {
      setLowByLoc(
        await fetchLowStockByLocation(session.companyId, maxThreshold + 1),
      );
    } catch {
      setLowByLoc([]);
    }
  }, [multiLocal, session?.companyId, maxThreshold]);

  useEffect(() => {
    void reloadLowByLoc();
  }, [reloadLowByLoc]);

  // Transferencia entre locales.
  const [transferOpen, setTransferOpen] = useState(false);
  const [tProduct, setTProduct] = useState("");
  const [tFrom, setTFrom] = useState("");
  const [tTo, setTTo] = useState("");
  const [tQty, setTQty] = useState("");
  const [tSaving, setTSaving] = useState(false);

  const handleTransfer = async () => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    if (!session) return;
    setTSaving(true);
    try {
      await transferStock(session, {
        productId: tProduct,
        fromLocationId: tFrom,
        toLocationId: tTo,
        qty: Number(tQty),
      });
      toast.success("Stock transferido.");
      setTransferOpen(false);
      setTProduct("");
      setTFrom("");
      setTTo("");
      setTQty("");
      await reload();
      await reloadLowByLoc();
      if (location !== ALL_LOCATIONS) {
        try {
          setLocStock(await loadLocationStock(location));
        } catch {
          /* el filtro se refresca al recargar */
        }
      }
    } catch (err) {
      toast.error(getErrorMessage(err, "No se pudo transferir el stock."));
    } finally {
      setTSaving(false);
    }
  };

  return (
    <AppShell>
      <PageHeader
        title="Control de Stock"
        description="Estado del inventario."
        eyebrow="Inventario"
        icon={Boxes}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {multiLocal && (
              <Button variant="outline" onClick={() => setTransferOpen(true)}>
                <ArrowRightLeft className="mr-1 h-4 w-4" /> Transferir stock
              </Button>
            )}
            <Link to="/inventario/kardex">
              <Button variant="outline">Ver Kardex</Button>
            </Link>
          </div>
        }
      />
      <FallbackNotice show={!!error && source === "demo-fallback"}>
        No se pudo leer Supabase todavía. Mostrando inventario de prueba.
      </FallbackNotice>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi icon={Package} label="Productos" value={products.length} />
        <Kpi
          icon={DollarSign}
          label="Valor inventario"
          value={formatMoney(valor)}
        />
        <Kpi
          icon={AlertTriangle}
          label="Stock bajo"
          value={bajo.length}
          tone="bg-primary/10 text-primary"
        />
        <Kpi
          icon={XCircle}
          label="Sin stock"
          value={sin.length}
          tone="bg-red-100 text-red-700"
        />
      </div>

      {multiLocal && (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle className="text-base">Reposición por sucursal</CardTitle>
            <p className="text-xs text-muted-foreground">
              {location === ALL_LOCATIONS
                ? "Productos bajo mínimo en cada sucursal, todos juntos."
                : "Productos bajo mínimo en la sucursal seleccionada."}
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead>Sucursal</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lowByLocView.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3}>
                        <EmptyState
                          emoji="✅"
                          title="Todo abastecido"
                          description="Ningún producto está bajo mínimo en tus locales."
                        />
                      </TableCell>
                    </TableRow>
                  ) : (
                    lowByLocView.map((row) => (
                      <TableRow key={`${row.productId}-${row.locationId}`}>
                        <TableCell className="font-medium">
                          {row.productName}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {row.locationName}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge
                            variant={row.stock === 0 ? "destructive" : "warm"}
                          >
                            {row.stock}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Sin stock</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead>Categoría</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && (
                    <TableRow>
                      <TableCell
                        colSpan={3}
                        className="py-8 text-center text-muted-foreground"
                      >
                        Cargando inventario...
                      </TableCell>
                    </TableRow>
                  )}
                  {!isLoading && sin.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3}>
                        <EmptyState
                          emoji="✅"
                          title="Todo con stock"
                          description="No hay productos agotados por ahora."
                        />
                      </TableCell>
                    </TableRow>
                  )}
                  {!isLoading &&
                    sin.map((p) => {
                      const visual = getProductVisual(p);
                      const image = getProductImage(p);
                      return (
                        <TableRow key={p.id}>
                          <TableCell>
                            <span className="flex items-center gap-2.5">
                              <span
                                className={`grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-gradient-to-br ${visual.gradient} text-lg`}
                              >
                                {image ? (
                                  <img
                                    src={image}
                                    alt={p.name}
                                    loading="lazy"
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  visual.emoji
                                )}
                              </span>
                              <span className="font-medium">{p.name}</span>
                            </span>
                          </TableCell>
                          <TableCell>{p.category}</TableCell>
                          <TableCell>
                            <Badge variant="destructive">Agotado</Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Bajo mínimo</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead>Stock</TableHead>
                    <TableHead>Categoría</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && (
                    <TableRow>
                      <TableCell
                        colSpan={3}
                        className="py-8 text-center text-muted-foreground"
                      >
                        Cargando inventario...
                      </TableCell>
                    </TableRow>
                  )}
                  {!isLoading && bajo.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3}>
                        <EmptyState
                          emoji="📦"
                          title="Stock saludable"
                          description="Ningún producto está por debajo del mínimo."
                        />
                      </TableCell>
                    </TableRow>
                  )}
                  {!isLoading &&
                    bajo.map((p) => {
                      const visual = getProductVisual(p);
                      const image = getProductImage(p);
                      return (
                        <TableRow key={p.id}>
                          <TableCell>
                            <span className="flex items-center gap-2.5">
                              <span
                                className={`grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-gradient-to-br ${visual.gradient} text-lg`}
                              >
                                {image ? (
                                  <img
                                    src={image}
                                    alt={p.name}
                                    loading="lazy"
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  visual.emoji
                                )}
                              </span>
                              <span className="font-medium">{p.name}</span>
                            </span>
                          </TableCell>
                          <TableCell>
                            <Badge variant="warm">{p.stock}</Badge>
                          </TableCell>
                          <TableCell>{p.category}</TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Transferir stock entre puntos de venta */}
      <Dialog open={transferOpen} onOpenChange={setTransferOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Transferir stock entre sucursales</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Producto</Label>
              <Select value={tProduct} onValueChange={setTProduct}>
                <SelectTrigger>
                  <SelectValue placeholder="Elige un producto" />
                </SelectTrigger>
                <SelectContent>
                  {baseProducts
                    .filter((p) => !p.hasVariants)
                    .map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Los productos con variantes (talla/color) se gestionan desde su
                edición, no por transferencia.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Desde</Label>
                <Select value={tFrom} onValueChange={setTFrom}>
                  <SelectTrigger>
                    <SelectValue placeholder="Origen" />
                  </SelectTrigger>
                  <SelectContent>
                    {locations.map((loc) => (
                      <SelectItem key={loc.id} value={loc.id}>
                        {loc.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Hacia</Label>
                <Select value={tTo} onValueChange={setTTo}>
                  <SelectTrigger>
                    <SelectValue placeholder="Destino" />
                  </SelectTrigger>
                  <SelectContent>
                    {locations
                      .filter((loc) => loc.id !== tFrom)
                      .map((loc) => (
                        <SelectItem key={loc.id} value={loc.id}>
                          {loc.name}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Cantidad</Label>
              <Input
                type="number"
                min="0"
                step="1"
                value={tQty}
                onChange={(event) => setTQty(event.target.value)}
                placeholder="0"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="brand"
              disabled={
                tSaving || !tProduct || !tFrom || !tTo || !(Number(tQty) > 0)
              }
              onClick={handleTransfer}
            >
              {tSaving ? "Transfiriendo..." : "Transferir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
