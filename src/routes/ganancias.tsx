import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Coins,
  DollarSign,
  Download,
  Percent,
  Printer,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { ALL_LOCATIONS } from "@/lib/currentLocation";
import { useCurrentLocation } from "@/hooks/useCurrentLocation";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { DateRangeSelect } from "@/components/reports/DateRangeSelect";
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
  fetchProfitReport,
  type ProfitReport,
  getErrorMessage,
} from "@/services/appData";

export const Route = createFileRoute("/ganancias")({ component: Ganancias });

function Kpi({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-3 p-4">
        <div
          className={`grid h-10 w-10 place-items-center rounded-lg ${tone ?? "bg-primary/10 text-primary"}`}
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

function Ganancias() {
  const { formatMoney } = useBusinessSettings();
  const { session, isReady } = useDemoSession();
  const [report, setReport] = useState<ProfitReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const { currentLocationId } = useCurrentLocation();

  useEffect(() => {
    if (!isReady) return;
    setIsLoading(true);
    void fetchProfitReport(
      session?.companyId,
      from || undefined,
      to || undefined,
      currentLocationId === ALL_LOCATIONS
        ? undefined
        : (currentLocationId ?? undefined),
    )
      .then(setReport)
      .catch((error) =>
        toast.error(
          getErrorMessage(error, "No se pudieron cargar las ganancias."),
        ),
      )
      .finally(() => setIsLoading(false));
  }, [isReady, session?.companyId, from, to, currentLocationId]);

  const rows = report?.rows ?? [];

  const exportCsv = () => {
    if (rows.length === 0) {
      toast.error("No hay datos para exportar.");
      return;
    }
    const header = ["Producto", "Unidades", "Ingreso", "Costo", "Ganancia"];
    const body = rows.map((row) => [
      row.productName,
      row.qty,
      row.revenue.toFixed(2),
      row.cost.toFixed(2),
      row.profit.toFixed(2),
    ]);
    const csv = [header, ...body]
      .map((line) =>
        line.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","),
      )
      .join("\n");
    // Prepend a UTF-8 BOM (U+FEFF) so Excel reads the accents correctly.
    const blob = new Blob([String.fromCharCode(0xfeff) + csv], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `ganancias${from ? `_${from}` : ""}${to ? `_${to}` : ""}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppShell>
      <PageHeader
        eyebrow="Análisis"
        icon={TrendingUp}
        title="Ganancias"
        description="Tu utilidad: lo que ganas después de descontar el costo."
      />

      <div className="mb-4 flex flex-wrap items-end gap-2">
        <DateRangeSelect
          onChange={(r) => {
            setFrom(r.from ?? "");
            setTo(r.to ?? "");
          }}
        />
        <div className="ml-auto flex gap-2">
          <Button variant="brand" onClick={exportCsv}>
            <Download className="mr-1 h-4 w-4" /> Exportar
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="mr-1 h-4 w-4" /> Imprimir
          </Button>
        </div>
      </div>

      <div id="ganancias-print">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Kpi
            icon={DollarSign}
            label="Ingresos"
            value={formatMoney(report?.totalRevenue ?? 0)}
          />
          <Kpi
            icon={Coins}
            label="Costo"
            value={formatMoney(report?.totalCost ?? 0)}
            tone="bg-muted text-muted-foreground"
          />
          <Kpi
            icon={TrendingUp}
            label="Ganancia"
            value={formatMoney(report?.totalProfit ?? 0)}
            tone="bg-primary/10 text-primary"
          />
          <Kpi
            icon={Percent}
            label="Margen"
            value={`${(report?.marginPct ?? 0).toFixed(1)}%`}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Ganancia = Ingreso neto (sin IVA) − Costo. No descuenta devoluciones.
        </p>

        <Card className="mt-4">
          <CardContent className="p-4">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-right">Unidades</TableHead>
                    <TableHead className="text-right">Ingreso</TableHead>
                    <TableHead className="text-right">Costo</TableHead>
                    <TableHead className="text-right">Ganancia</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="py-8 text-center text-muted-foreground"
                      >
                        Cargando ganancias...
                      </TableCell>
                    </TableRow>
                  )}
                  {!isLoading && rows.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={5}>
                        <EmptyState
                          emoji="💵"
                          title="Sin datos de ganancias"
                          description="No hay ventas en el periodo seleccionado."
                        />
                      </TableCell>
                    </TableRow>
                  )}
                  {!isLoading &&
                    rows.map((row) => (
                      <TableRow key={row.productName}>
                        <TableCell className="font-medium">
                          {row.productName}
                        </TableCell>
                        <TableCell className="text-right">{row.qty}</TableCell>
                        <TableCell className="text-right">
                          {formatMoney(row.revenue)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatMoney(row.cost)}
                        </TableCell>
                        <TableCell className="text-right font-semibold text-primary">
                          {formatMoney(row.profit)}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
