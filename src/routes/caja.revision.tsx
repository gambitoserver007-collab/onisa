import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
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
import { ALL_LOCATIONS } from "@/lib/currentLocation";
import { useDemoSession } from "@/hooks/useDemoSession";
import {
  authorizeCashSession,
  fetchPendingReviewSessions,
  fetchProfileNames,
  fetchTillCounts,
  getErrorMessage,
  type PendingReviewSession,
  type TillCount,
} from "@/services/appData";

export const Route = createFileRoute("/caja/revision")({
  component: CajaRevision,
});

function CajaRevision() {
  const { formatMoney, settings } = useBusinessSettings();
  const { session, role, isReady } = useDemoSession();
  const { currentLocationId } = useCurrentLocation();
  const locationId =
    currentLocationId === ALL_LOCATIONS
      ? undefined
      : (currentLocationId ?? undefined);

  const [sessions, setSessions] = useState<PendingReviewSession[]>([]);
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);

  const [detail, setDetail] = useState<PendingReviewSession | null>(null);
  const [counts, setCounts] = useState<TillCount[]>([]);
  const [countsLoading, setCountsLoading] = useState(false);
  const [notes, setNotes] = useState("");
  const [authorizing, setAuthorizing] = useState(false);

  const nameOf = (id: string | null) => (id ? (profileNames[id] ?? "—") : "—");

  const load = async () => {
    setIsLoading(true);
    try {
      const [pending, names] = await Promise.all([
        fetchPendingReviewSessions(session?.companyId, locationId),
        fetchProfileNames(session?.companyId),
      ]);
      setSessions(pending);
      setProfileNames(names);
    } catch (error) {
      toast.error(
        getErrorMessage(error, "No se pudieron cargar los cierres pendientes."),
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (session) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.companyId, locationId]);

  const openDetail = async (item: PendingReviewSession) => {
    setDetail(item);
    setNotes("");
    setCountsLoading(true);
    try {
      setCounts(await fetchTillCounts(item.id));
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo cargar el detalle."));
    } finally {
      setCountsLoading(false);
    }
  };

  const handleAuthorize = async () => {
    if (!detail) return;
    setAuthorizing(true);
    try {
      await authorizeCashSession(detail.id, notes.trim() || undefined);
      toast.success("Corte autorizado.");
      setDetail(null);
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo autorizar el corte."));
    } finally {
      setAuthorizing(false);
    }
  };

  const fmtDateTime = (iso: string | null) => {
    if (!iso) return "—";
    try {
      return new Date(iso).toLocaleString(settings.locale, {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return iso;
    }
  };

  if (!isReady) return null;

  return (
    <AppShell>
      <PageHeader
        eyebrow="Operaciones"
        icon={ClipboardCheck}
        title="Revisión de cierres"
        description="Cortes de caja cerrados que esperan autorización."
      />

      <Card>
        <CardContent className="p-4">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sucursal / Caja</TableHead>
                  <TableHead>Turno</TableHead>
                  <TableHead className="text-right">Fondo</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="py-8 text-center text-muted-foreground"
                    >
                      Cargando...
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && sessions.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4}>
                      <EmptyState
                        emoji="✅"
                        title="Sin pendientes"
                        description="No hay cortes de caja esperando autorización."
                      />
                    </TableCell>
                  </TableRow>
                )}
                {sessions.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium">
                      {item.locationName}
                      {item.tillName && (
                        <span className="ml-2 rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                          {item.tillName}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-0.5 text-xs text-muted-foreground">
                        <div>
                          <span className="text-foreground">Abrió:</span>{" "}
                          {nameOf(item.openedBy)} · {fmtDateTime(item.openedAt)}
                        </div>
                        <div>
                          <span className="text-foreground">Cerró:</span>{" "}
                          {nameOf(item.closedBy)} · {fmtDateTime(item.closedAt)}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(item.openingAmount)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void openDetail(item)}
                      >
                        Ver y autorizar
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetail(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              Autorizar corte — {detail?.locationName}
              {detail?.tillName ? ` · ${detail.tillName}` : ""}
            </DialogTitle>
          </DialogHeader>

          {countsLoading && (
            <p className="text-sm text-muted-foreground">Cargando conteos...</p>
          )}

          {!countsLoading && (
            <div className="space-y-4">
              <div
                className={`grid gap-3 ${counts.length > 1 ? "sm:grid-cols-2" : ""}`}
              >
                {counts.map((count) => (
                  <div
                    key={count.id}
                    className="space-y-2 rounded-2xl border border-border/70 p-3"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold">
                        Conteo #{count.countNumber}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {nameOf(count.countedBy)} ·{" "}
                        {fmtDateTime(count.countedAt)}
                      </span>
                    </div>
                    <div className="space-y-1 text-sm">
                      {count.lines
                        .filter((l) => l.quantity > 0)
                        .map((line) => (
                          <div
                            key={line.denomination}
                            className="flex justify-between text-muted-foreground"
                          >
                            <span>
                              {line.denomination >= 1
                                ? `$${line.denomination}`
                                : `${Math.round(line.denomination * 100)}¢`}{" "}
                              × {line.quantity}
                            </span>
                            <span className="tabular-nums">
                              {formatMoney(line.subtotal)}
                            </span>
                          </div>
                        ))}
                      <div className="flex justify-between border-t border-border/60 pt-1 font-bold">
                        <span>Efectivo contado</span>
                        <span className="tabular-nums">
                          {formatMoney(count.countedCashTotal)}
                        </span>
                      </div>
                      <Row
                        label="Tarjeta"
                        value={formatMoney(count.cardTotal)}
                      />
                      <Row
                        label="Transferencia"
                        value={formatMoney(count.transferTotal)}
                      />
                      <Row
                        label="Otros"
                        value={formatMoney(count.otherTotal)}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <div className="space-y-1">
                <label className="text-sm text-muted-foreground">
                  Notas (opcional)
                </label>
                <Textarea
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Cualquier observación sobre este corte..."
                  rows={2}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="brand"
              disabled={authorizing || countsLoading}
              onClick={handleAuthorize}
            >
              {authorizing ? "Autorizando..." : "Autorizar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-muted-foreground">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
