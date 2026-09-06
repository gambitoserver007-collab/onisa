import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Ban,
  Boxes,
  CreditCard,
  PackageCheck,
  FileText,
  Wallet,
} from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
  fetchCompanyAlerts,
  getErrorMessage,
  type CompanyAlerts,
} from "@/services/appData";

export const Route = createFileRoute("/alertas")({
  component: AlertasPage,
});

function fmtDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString("es-MX", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function Section({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  if (count === 0) return null;
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Icon className="h-4 w-4 text-warm-foreground" />
          {title}
        </CardTitle>
        <Badge variant="warm">{count}</Badge>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="overflow-x-auto">{children}</div>
      </CardContent>
    </Card>
  );
}

function AlertasPage() {
  const { formatMoney } = useBusinessSettings();
  const { session } = useDemoSession();
  const [alerts, setAlerts] = useState<CompanyAlerts | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session?.companyId) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    fetchCompanyAlerts()
      .then((data) => {
        if (!cancelled) setAlerts(data);
      })
      .catch((err) => {
        if (!cancelled) setError(getErrorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.companyId]);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Análisis"
        icon={AlertTriangle}
        title="Alertas"
        description="Focos rojos operativos de tu negocio, en un solo lugar."
      />

      {isLoading && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            Cargando alertas...
          </CardContent>
        </Card>
      )}

      {!isLoading && error && (
        <Card>
          <CardContent className="py-10 text-center text-sm text-destructive">
            {error}
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && alerts && alerts.total === 0 && (
        <Card>
          <CardContent>
            <EmptyState
              emoji="✅"
              title="Todo en orden"
              description="No hay alertas pendientes en este momento."
            />
          </CardContent>
        </Card>
      )}

      {!isLoading && !error && alerts && alerts.total > 0 && (
        <div className="space-y-4">
          <Section
            icon={Boxes}
            title="Stock bajo"
            count={alerts.stockBajo.length}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Stock</TableHead>
                  <TableHead className="text-right">Mínimo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alerts.stockBajo.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">
                      <Link to="/productos" className="hover:underline">
                        {item.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {item.stock <= 0 ? (
                        <Badge variant="destructive">Agotado</Badge>
                      ) : (
                        `${item.stock} ${item.unit}`
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {item.threshold} {item.unit}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Section>

          <Section
            icon={PackageCheck}
            title="Apartados vencidos"
            count={alerts.apartadosVencidos.length}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Apartado</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Venció</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alerts.apartadosVencidos.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">
                      <Link
                        to="/apartados/$id"
                        params={{ id: item.id }}
                        className="hover:underline"
                      >
                        {item.apartadoNumber}
                      </Link>
                    </TableCell>
                    <TableCell>{item.customerName}</TableCell>
                    <TableCell className="text-destructive">
                      {item.dueDate}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(item.balance)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Section>

          <Section
            icon={FileText}
            title="Cotizaciones vencidas"
            count={alerts.cotizacionesVencidas.length}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cotización</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Venció</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alerts.cotizacionesVencidas.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">
                      <Link
                        to="/cotizaciones/$id"
                        params={{ id: item.id }}
                        className="hover:underline"
                      >
                        {item.quoteNumber}
                      </Link>
                    </TableCell>
                    <TableCell>{item.customerName}</TableCell>
                    <TableCell className="text-destructive">
                      {item.validUntil}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(item.total)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Section>

          <Section
            icon={Wallet}
            title="Cajas abiertas de turnos anteriores"
            count={alerts.cajasAbiertas.length}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sucursal</TableHead>
                  <TableHead>Abrió</TableHead>
                  <TableHead>Desde</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alerts.cajasAbiertas.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">
                      {item.locationName ?? "—"}
                    </TableCell>
                    <TableCell>{item.openedByName ?? "—"}</TableCell>
                    <TableCell className="text-destructive">
                      {fmtDateTime(item.openedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Section>

          <Section
            icon={CreditCard}
            title="Clientes al límite de crédito"
            count={alerts.clientesCredito.length}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="text-right">Debe</TableHead>
                  <TableHead className="text-right">Límite</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alerts.clientesCredito.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">
                      <Link to="/clientes" className="hover:underline">
                        {item.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(item.creditBalance)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {formatMoney(item.creditLimit)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Section>

          <Section
            icon={Ban}
            title="Ventas canceladas (últimas 48h)"
            count={alerts.ventasCanceladas.length}
          >
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cuándo</TableHead>
                  <TableHead>Cajero</TableHead>
                  <TableHead className="text-right">Productos</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead>Motivo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {alerts.ventasCanceladas.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {fmtDateTime(item.createdAt)}
                    </TableCell>
                    <TableCell className="font-medium">
                      {item.cashierName ?? "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {item.itemCount}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(item.total)}
                    </TableCell>
                    <TableCell className="text-sm">
                      {item.reason ?? (
                        <span className="text-destructive">Sin motivo</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Section>
        </div>
      )}
    </AppShell>
  );
}
