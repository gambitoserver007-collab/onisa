import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Download, FileSpreadsheet, Plus, Receipt } from "lucide-react";
import { toast } from "sonner";
import {
  exportSalesToExcel,
  filterSalesByDate,
  printReceipts,
  type TicketDisplaySettings,
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
import { useDemoSession } from "@/hooks/useDemoSession";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import { useSales } from "@/hooks/useSales";
import {
  fetchCashClosings,
  fetchCompanyProfile,
  fetchOpenCashSession,
  fetchProfileNames,
  type CashSession,
  type CompanyProfile,
} from "@/services/appData";

export const Route = createFileRoute("/ventas/")({ component: VentasPage });

function VentasPage() {
  const { formatMoney, settings } = useBusinessSettings();
  const { session } = useDemoSession();
  const { activeMethods } = usePaymentMethods(settings.countryCode);
  const { currentLocationId, locations } = useCurrentLocation();
  const { sales, error, source, isLoading } = useSales(
    currentLocationId === ALL_LOCATIONS
      ? undefined
      : (currentLocationId ?? undefined),
  );

  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(
    null,
  );
  useEffect(() => {
    if (!session?.companyId) return;
    void fetchCompanyProfile(session.companyId)
      .then(setCompanyProfile)
      .catch(() => undefined);
  }, [session?.companyId]);

  const salesLocationId =
    currentLocationId === ALL_LOCATIONS
      ? undefined
      : (currentLocationId ?? undefined);

  const [profileNames, setProfileNames] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!session?.companyId) return;
    void fetchProfileNames(session.companyId)
      .then(setProfileNames)
      .catch(() => undefined);
  }, [session?.companyId]);

  // Turnos disponibles para filtrar (el abierto + los últimos cerrados),
  // acotados a la misma sucursal que las ventas que se están listando.
  const [turnos, setTurnos] = useState<CashSession[]>([]);
  useEffect(() => {
    if (!session?.companyId) return;
    let active = true;
    void Promise.all([
      fetchOpenCashSession(session.companyId, salesLocationId),
      fetchCashClosings(session.companyId, salesLocationId),
    ])
      .then(([open, closed]) => {
        if (!active) return;
        setTurnos(open ? [open, ...closed] : closed);
      })
      .catch(() => {
        if (active) setTurnos([]);
      });
    return () => {
      active = false;
    };
  }, [session?.companyId, salesLocationId]);
  const formatTurno = (turno: CashSession) => {
    const openLabel = new Date(turno.openedAt).toLocaleString(settings.locale, {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    const closeLabel = turno.closedAt
      ? new Date(turno.closedAt).toLocaleTimeString(settings.locale, {
          hour: "2-digit",
          minute: "2-digit",
        })
      : "abierto";
    const opener = turno.openedBy ? profileNames[turno.openedBy] : undefined;
    return `${openLabel} – ${closeLabel}${opener ? ` · ${opener}` : ""}`;
  };

  // Qué mostrar/ocultar del ticket, por sucursal -- ver puntos-de-venta.tsx.
  const ticketByLocation = useMemo(() => {
    const map = new Map<string, TicketDisplaySettings>();
    for (const loc of locations) {
      map.set(loc.id, {
        showFiscalInfo: loc.ticketShowFiscalInfo,
        showTaxBreakdown: loc.ticketShowTaxBreakdown,
        showPaymentMethod: loc.ticketShowPaymentMethod,
        footerText: loc.ticketFooterText,
      });
    }
    return map;
  }, [locations]);
  const [method, setMethod] = useState("all");
  const [vendor, setVendor] = useState("all");
  const [turno, setTurno] = useState("all");
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
  const vendorOptions = useMemo(() => {
    const ids = new Set(
      sales.map((sale) => sale.createdBy).filter((id): id is string => !!id),
    );
    return Array.from(ids)
      .map((id) => ({ id, name: profileNames[id] ?? "—" }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [sales, profileNames]);
  const filtered = useMemo(() => {
    const activeTurno =
      turno === "all" ? null : turnos.find((t) => t.id === turno);
    return filterSalesByDate(sales, from, to).filter((sale) => {
      if (method !== "all" && sale.method !== method) return false;
      if (vendor !== "all" && sale.createdBy !== vendor) return false;
      if (activeTurno) {
        const ts = sale.createdAt ?? sale.date;
        if (ts < activeTurno.openedAt) return false;
        if (activeTurno.closedAt && ts >= activeTurno.closedAt) return false;
      }
      return true;
    });
  }, [from, to, method, vendor, turno, turnos, sales]);

  const exportSettings = {
    businessName: settings.businessName,
    fiscalIdLabel: settings.fiscalIdLabel,
    sampleFiscalId: settings.sampleFiscalId,
    taxName: settings.taxName,
    address: companyProfile?.address,
    phone: companyProfile?.phone,
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
            <Select value={vendor} onValueChange={setVendor}>
              <SelectTrigger className="w-44">
                <SelectValue placeholder="Vendedor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los vendedores</SelectItem>
                {vendorOptions.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={turno} onValueChange={setTurno}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Turno" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los turnos</SelectItem>
                {turnos.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {formatTurno(item)}
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
                  printReceipts(
                    filtered,
                    exportSettings,
                    formatMoney,
                    ticketByLocation,
                  )
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
                  <TableHead>Vendedor</TableHead>
                  <TableHead>Método</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="py-8 text-center text-muted-foreground"
                    >
                      Cargando ventas...
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8}>
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
                      <TableCell>
                        {sale.createdBy
                          ? (profileNames[sale.createdBy] ?? "—")
                          : "—"}
                      </TableCell>
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
                              printReceipts(
                                [sale],
                                exportSettings,
                                formatMoney,
                                ticketByLocation,
                              )
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
