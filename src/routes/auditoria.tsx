import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { History } from "lucide-react";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
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
  fetchCompanyAuditLog,
  fetchProfileNames,
  describeAuditAction,
  describeAuditEntity,
  getErrorMessage,
  type CompanyAuditLogEntry,
} from "@/services/appData";

export const Route = createFileRoute("/auditoria")({
  component: AuditoriaPage,
});

const ENTITY_FILTERS = [
  { value: "all", label: "Todo" },
  { value: "profile", label: "Usuarios" },
  { value: "customer", label: "Clientes" },
  { value: "company", label: "Empresa" },
  { value: "merma", label: "Mermas" },
  { value: "quote", label: "Cotizaciones" },
  { value: "apartado", label: "Apartados" },
  { value: "cash_session", label: "Caja" },
  { value: "voided_sale", label: "Ventas canceladas" },
];

function fmtDateTime(iso: string) {
  try {
    return new Date(iso).toLocaleString("es-MX", {
      day: "2-digit",
      month: "2-digit",
      year: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function renderDetailValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "Sí" : "No";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "—";
  return String(value);
}

function DetailSummary({ detail }: { detail: Record<string, unknown> }) {
  const entries = Object.entries(detail).filter(([key]) => key !== "full_name");
  if (entries.length === 0)
    return <span className="text-muted-foreground">—</span>;
  return (
    <div className="space-y-0.5 text-xs">
      {entries.map(([key, value]) => {
        if (
          value &&
          typeof value === "object" &&
          !Array.isArray(value) &&
          ("antes" in (value as Record<string, unknown>) ||
            "despues" in (value as Record<string, unknown>))
        ) {
          const { antes, despues } = value as {
            antes?: unknown;
            despues?: unknown;
          };
          return (
            <div key={key}>
              <span className="text-muted-foreground">{key}:</span>{" "}
              {renderDetailValue(antes)} → {renderDetailValue(despues)}
            </div>
          );
        }
        return (
          <div key={key}>
            <span className="text-muted-foreground">{key}:</span>{" "}
            {renderDetailValue(value)}
          </div>
        );
      })}
    </div>
  );
}

function AuditoriaPage() {
  const { session } = useDemoSession();
  const [entries, setEntries] = useState<CompanyAuditLogEntry[]>([]);
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});
  const [entityFilter, setEntityFilter] = useState("all");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session?.companyId) return;
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    Promise.all([
      fetchCompanyAuditLog({
        entityType: entityFilter === "all" ? undefined : entityFilter,
      }),
      fetchProfileNames(session.companyId),
    ])
      .then(([log, names]) => {
        if (cancelled) return;
        setEntries(log);
        setProfileNames(names);
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
  }, [session?.companyId, entityFilter]);

  const nameOf = (id: string | null) =>
    id ? (profileNames[id] ?? "—") : "Sistema";

  const rows = useMemo(() => entries, [entries]);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Análisis"
        icon={History}
        title="Auditoría"
        description="Quién hizo qué, y cuándo -- cambios de rol y permisos, cancelaciones, mermas y configuración."
        actions={
          <Select value={entityFilter} onValueChange={setEntityFilter}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ENTITY_FILTERS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      <Card>
        <CardContent className="p-4">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Quién</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Acción</TableHead>
                  <TableHead>Detalle</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-8 text-center text-muted-foreground"
                    >
                      Cargando...
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && error && (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-8 text-center text-destructive"
                    >
                      {error}
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && !error && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <EmptyState
                        emoji="📋"
                        title="Sin movimientos"
                        description="No hay registros de auditoría para este filtro."
                      />
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  !error &&
                  rows.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                        {fmtDateTime(entry.createdAt)}
                      </TableCell>
                      <TableCell className="font-medium">
                        {nameOf(entry.actorId)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">
                          {describeAuditEntity(entry.entityType)}
                        </Badge>
                      </TableCell>
                      <TableCell>{describeAuditAction(entry.action)}</TableCell>
                      <TableCell>
                        <DetailSummary detail={entry.detail} />
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
