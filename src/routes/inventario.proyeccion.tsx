import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
import { useDemoSession } from "@/hooks/useDemoSession";
import {
  fetchPurchaseProjection,
  getErrorMessage,
  type PurchaseProjectionItem,
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

function Proyeccion() {
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
    </AppShell>
  );
}
