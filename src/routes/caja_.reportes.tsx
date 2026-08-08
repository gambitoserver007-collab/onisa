import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Download, LineChart } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  DateRangeSelect,
  type DateRange,
} from "@/components/reports/DateRangeSelect";
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
import { useCurrentLocation } from "@/hooks/useCurrentLocation";
import { useDemoSession } from "@/hooks/useDemoSession";
import { exportCashReportToExcel } from "@/lib/cashReportExport";
import {
  fetchCashReport,
  fetchProfileNames,
  fetchTeam,
  fetchTills,
  getErrorMessage,
  type CashReportRow,
  type Till,
} from "@/services/appData";

export const Route = createFileRoute("/caja_/reportes")({
  component: CajaReportes,
});

const CLASSIFICATION_LABELS: Record<string, string> = {
  cuadrado: "Cuadrado",
  faltante: "Faltante",
  sobrante: "Sobrante",
};

const ALL = "__all__";

function CajaReportes() {
  const { formatMoney, settings } = useBusinessSettings();
  const { session } = useDemoSession();
  const { locations } = useCurrentLocation();

  const [range, setRange] = useState<DateRange>({});
  const [locationId, setLocationId] = useState(ALL);
  const [tillId, setTillId] = useState(ALL);
  const [cajeroId, setCajeroId] = useState(ALL);

  const [tills, setTills] = useState<Till[]>([]);
  const [cajeros, setCajeros] = useState<{ id: string; name: string }[]>([]);
  const [rows, setRows] = useState<CashReportRow[]>([]);
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);

  const nameOf = (id: string | null) => (id ? (profileNames[id] ?? "—") : "—");

  // Caja depende de qué sucursal esté elegida -- si cambia la sucursal, la
  // caja seleccionada (de la sucursal anterior) ya no aplica.
  useEffect(() => {
    setTillId(ALL);
    if (locationId === ALL) {
      setTills([]);
      return;
    }
    void fetchTills(locationId)
      .then(setTills)
      .catch(() => setTills([]));
  }, [locationId]);

  useEffect(() => {
    if (!session?.companyId) return;
    void fetchTeam(session.companyId)
      .then((team) => setCajeros(team.map((t) => ({ id: t.id, name: t.name }))))
      .catch(() => setCajeros([]));
  }, [session?.companyId]);

  const load = async () => {
    if (!session?.companyId) return;
    setIsLoading(true);
    try {
      const [report, names] = await Promise.all([
        fetchCashReport(session.companyId, {
          locationId: locationId === ALL ? undefined : locationId,
          tillId: tillId === ALL ? undefined : tillId,
          openedBy: cajeroId === ALL ? undefined : cajeroId,
          dateFrom: range.from,
          dateTo: range.to,
        }),
        fetchProfileNames(session.companyId),
      ]);
      setRows(report);
      setProfileNames(names);
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo cargar el reporte."));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.companyId, range.from, range.to, locationId, tillId, cajeroId]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, row) => ({
          opening: acc.opening + row.openingAmount,
          expected: acc.expected + row.expectedAmount,
          real: acc.real + (row.realAmount ?? 0),
          difference: acc.difference + (row.difference ?? 0),
          card: acc.card + row.cardTotal,
          transfer: acc.transfer + row.transferTotal,
          other: acc.other + row.otherTotal,
        }),
        {
          opening: 0,
          expected: 0,
          real: 0,
          difference: 0,
          card: 0,
          transfer: 0,
          other: 0,
        },
      ),
    [rows],
  );

  const fmtDate = (iso: string | null) => {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleDateString(settings.locale, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
    } catch {
      return iso.slice(0, 10);
    }
  };

  const handleExport = async () => {
    if (!rows.length) return;
    try {
      await exportCashReportToExcel(rows, nameOf, range);
    } catch {
      toast.error("No se pudo generar el Excel.");
    }
  };

  return (
    <AppShell>
      <PageHeader
        eyebrow="Operaciones"
        icon={LineChart}
        title="Reportes de caja"
        description="Cortes autorizados, filtrables por fecha, sucursal, caja y cajero."
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={!rows.length}
            onClick={() => void handleExport()}
          >
            <Download className="mr-1 h-4 w-4" /> Exportar
          </Button>
        }
      />

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <DateRangeSelect onChange={setRange} defaultPreset="30d" />
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Sucursal</Label>
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas</SelectItem>
                {locations.map((loc) => (
                  <SelectItem key={loc.id} value={loc.id}>
                    {loc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Caja</Label>
            <Select
              value={tillId}
              onValueChange={setTillId}
              disabled={locationId === ALL}
            >
              <SelectTrigger className="w-40">
                <SelectValue placeholder="Todas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todas</SelectItem>
                {tills.map((till) => (
                  <SelectItem key={till.id} value={till.id}>
                    {till.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Cajero</Label>
            <Select value={cajeroId} onValueChange={setCajeroId}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Todos</SelectItem>
                {cajeros.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Sucursal / Caja</TableHead>
                  <TableHead>Cajero</TableHead>
                  <TableHead className="text-right">Apertura</TableHead>
                  <TableHead className="text-right">Esperado</TableHead>
                  <TableHead className="text-right">Real</TableHead>
                  <TableHead className="text-right">Diferencia</TableHead>
                  <TableHead className="text-right">Tarjeta</TableHead>
                  <TableHead className="text-right">Transferencia</TableHead>
                  <TableHead className="text-right">Otros</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell
                      colSpan={10}
                      className="py-8 text-center text-muted-foreground"
                    >
                      Cargando...
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={10}>
                      <EmptyState
                        emoji="📊"
                        title="Sin resultados"
                        description="No hay cortes autorizados en ese rango/filtros."
                      />
                    </TableCell>
                  </TableRow>
                )}
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>{fmtDate(row.closedAt)}</TableCell>
                    <TableCell className="font-medium">
                      {row.locationName}
                      {row.tillName && (
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                          {row.tillName}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>{nameOf(row.openedBy)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.openingAmount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.expectedAmount)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.realAmount ?? 0)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Badge
                        variant={
                          row.classification === "cuadrado"
                            ? "success"
                            : row.classification === "faltante"
                              ? "destructive"
                              : "warm"
                        }
                      >
                        {formatMoney(row.difference ?? 0)}
                        {row.classification &&
                          ` · ${CLASSIFICATION_LABELS[row.classification]}`}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.cardTotal)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.transferTotal)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(row.otherTotal)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              {rows.length > 0 && (
                <tfoot>
                  <TableRow className="font-bold">
                    <TableCell colSpan={3}>Total</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(totals.opening)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(totals.expected)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(totals.real)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(totals.difference)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(totals.card)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(totals.transfer)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(totals.other)}
                    </TableCell>
                  </TableRow>
                </tfoot>
              )}
            </Table>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}
