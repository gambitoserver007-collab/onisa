import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Download, FileSpreadsheet, Plus, Receipt } from "lucide-react";
import { toast } from "sonner";
import {
  exportSalesToExcel,
  filterSalesByDate,
  printReceipts,
} from "@/lib/salesExport";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { FallbackNotice } from "@/components/layout/FallbackNotice";
import { EmptyState } from "@/components/layout/EmptyState";
import { ALL_LOCATIONS } from "@/lib/currentLocation";
import { useCurrentLocation } from "@/hooks/useCurrentLocation";
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
import { useBusinessSettings } from "@/hooks/useBusinessSettings";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import { useSales } from "@/hooks/useSales";

export const Route = createFileRoute("/ventas/")({ component: VentasPage });

function VentasPage() {
  const { formatMoney, settings } = useBusinessSettings();
  const { activeMethods } = usePaymentMethods(settings.countryCode);
  const { currentLocationId } = useCurrentLocation();
  const { sales, error, source, isLoading } = useSales(
    currentLocationId === ALL_LOCATIONS
      ? undefined
      : (currentLocationId ?? undefined),
  );
  const [method, setMethod] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const methodOptions = useMemo(
    () =>
      Array.from(
        new Set([
          ...activeMethods.map((item) => item.label),
          ...sales.map((sale) => sale.method),
        ]),
      ),
    [activeMethods, sales],
  );
  const filtered = useMemo(
    () =>
      filterSalesByDate(sales, from, to).filter(
        (sale) => method === "all" || sale.method === method,
      ),
    [from, to, method, sales],
  );

  const exportSettings = {
    businessName: settings.businessName,
    fiscalIdLabel: settings.fiscalIdLabel,
    sampleFiscalId: settings.sampleFiscalId,
    taxName: settings.taxName,
  };

  const handleExcel = async () => {
    try {
      await exportSalesToExcel(filtered, exportSettings, { from, to });
    } catch {
      toast.error("No se pudo generar el Excel.");
    }
  };

  return (
    <AppShell>
      <PageHeader
        eyebrow="Operaciones"
        icon={Receipt}
        title="Ventas"
        description="Historial de comprobantes."
        actions={
          <Link to="/pos">
            <Button variant="brand">
              <Plus className="mr-1 h-4 w-4" /> Nueva venta
            </Button>
          </Link>
        }
      />
      <FallbackNotice show={!!error && source === "demo-fallback"}>
        No se pudo leer Supabase todavía. Mostrando ventas de prueba.
      </FallbackNotice>
      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Input
              type="date"
              className="w-44"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              aria-label="Desde"
            />
            <Input
              type="date"
              className="w-44"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              aria-label="Hasta"
            />
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los métodos</SelectItem>
                {methodOptions.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex gap-2 sm:ml-auto">
              <Button
                variant="outline"
                onClick={handleExcel}
                disabled={filtered.length === 0}
              >
                <FileSpreadsheet className="mr-1 h-4 w-4" /> Exportar Excel
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  printReceipts(filtered, exportSettings, formatMoney)
                }
                disabled={filtered.length === 0}
              >
                <Download className="mr-1 h-4 w-4" /> Descargar recibos
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>N°</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Método</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-8 text-center text-muted-foreground"
                    >
                      Cargando ventas...
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <EmptyState
                        emoji="🧾"
                        title="Sin ventas"
                        description="Aún no hay comprobantes para el filtro seleccionado."
                      />
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  filtered.map((sale) => (
                    <TableRow key={sale.databaseId ?? sale.id}>
                      <TableCell className="font-mono">{sale.id}</TableCell>
                      <TableCell>{sale.date}</TableCell>
                      <TableCell>
                        <Badge variant="soft">{sale.type}</Badge>
                      </TableCell>
                      <TableCell>{sale.customer}</TableCell>
                      <TableCell>{sale.method}</TableCell>
                      <TableCell className="text-right font-medium">
                        {formatMoney(sale.total)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Link to="/ventas/$id" params={{ id: sale.id }}>
                            <Button variant="ghost" size="sm">
                              Ver
                            </Button>
                          </Link>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label={`Descargar recibo ${sale.id}`}
                            onClick={() =>
                              printReceipts([sale], exportSettings, formatMoney)
                            }
                          >
                            <Download className="h-4 w-4" />
                          </Button>
                        </div>
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
