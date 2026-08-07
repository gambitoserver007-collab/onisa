import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Banknote,
  ClipboardCheck,
  Plus,
  Store,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { DemoGuardedButton } from "@/components/demo/DemoGuardedButton";
import {
  DenominationCountForm,
  type DenominationLine,
} from "@/components/caja/DenominationCountForm";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { FallbackNotice } from "@/components/layout/FallbackNotice";
import { EmptyState } from "@/components/layout/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { useCurrentLocation } from "@/hooks/useCurrentLocation";
import { ALL_LOCATIONS } from "@/lib/currentLocation";
import { useDemoSession } from "@/hooks/useDemoSession";
import { useSales } from "@/hooks/useSales";
import { blockDemoAction } from "@/lib/demoMode";
import {
  createCashMovement,
  fetchCashClosings,
  fetchCashMovements,
  fetchOpenCashSession,
  fetchProfileNames,
  fetchTillCounts,
  fetchTills,
  finishTillCount,
  openCashSession,
  submitTillCount,
  type CashMovement,
  type CashSession,
  type Till,
  type TillCount,
  getErrorMessage,
} from "@/services/appData";

export const Route = createFileRoute("/caja")({ component: Caja });

// Read-only sample shown in Modo de Prueba so the screen never looks empty.
const DEMO_SESSION: CashSession = {
  id: "demo",
  status: "open",
  openingAmount: 200,
  openedAt: "2026-06-18T09:15:00Z",
  closedAt: null,
  realAmount: null,
  expectedAmount: 505.5,
  difference: null,
  openedBy: null,
  closedBy: null,
  tillId: null,
  reviewStatus: "pending",
  classification: null,
};
const DEMO_MOVEMENTS: CashMovement[] = [
  {
    id: "d1",
    type: "ingreso",
    concept: "Fondo inicial",
    amount: 200,
    movementAt: "2026-06-18T09:15:00Z",
  },
  {
    id: "d2",
    type: "venta",
    concept: "V-0001",
    amount: 21.6,
    movementAt: "2026-06-18T10:42:00Z",
  },
  {
    id: "d3",
    type: "egreso",
    concept: "Compra de bolsas",
    amount: -15,
    movementAt: "2026-06-18T12:05:00Z",
  },
];
const DEMO_CLOSINGS: CashSession[] = [
  {
    id: "CJ-0009",
    status: "closed",
    openingAmount: 200,
    openedAt: "2025-06-14T08:00:00Z",
    closedAt: "2025-06-14T20:00:00Z",
    expectedAmount: 540.3,
    realAmount: 540.3,
    difference: 0,
    openedBy: null,
    closedBy: null,
    tillId: null,
    reviewStatus: "authorized",
    classification: "cuadrado",
  },
  {
    id: "CJ-0010",
    status: "closed",
    openingAmount: 200,
    openedAt: "2025-06-15T08:00:00Z",
    closedAt: "2025-06-15T20:00:00Z",
    expectedAmount: 620.5,
    realAmount: 619,
    difference: -1.5,
    openedBy: null,
    closedBy: null,
    tillId: null,
    reviewStatus: "authorized",
    classification: "faltante",
  },
];

const CLASSIFICATION_LABELS: Record<string, string> = {
  cuadrado: "Cuadrado",
  faltante: "Faltante",
  sobrante: "Sobrante",
};

function Caja() {
  const { formatMoney, settings } = useBusinessSettings();
  const { session, isDemo, role } = useDemoSession();
  const { currentLocationId, locations } = useCurrentLocation();
  // Solo admin/finanzas ven el esperado/real/diferencia -- el arqueo ciego
  // exige que el cajero nunca los vea, ni siquiera de turnos ya autorizados.
  const canSeeFigures = role === "admin" || role === "finanzas";
  // La caja es de un local: el cajero usa el suyo; el admin, el local activo.
  // "Todas las tiendas" no aplica a la caja → exige elegir una sucursal.
  const resolvedLocationId =
    currentLocationId === ALL_LOCATIONS ? null : currentLocationId;
  const cajaLocationId =
    role === "admin"
      ? resolvedLocationId
      : (session?.locationId ?? resolvedLocationId);
  // No operar caja en una sucursal desactivada (ya no está en la lista de activas).
  const cajaLocationInactive =
    !!cajaLocationId &&
    locations.length > 0 &&
    !locations.some((loc) => loc.id === cajaLocationId);
  const { sales } = useSales(cajaLocationId ?? undefined);
  const companyId = session?.companyId;

  const [openSession, setOpenSession] = useState<CashSession | null>(null);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [closings, setClosings] = useState<CashSession[]>([]);
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});
  const [tills, setTills] = useState<Till[]>([]);
  const [tillCounts, setTillCounts] = useState<TillCount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const activeTills = tills.filter((t) => t.isActive);
  const tillName = (id: string | null) =>
    id ? (tills.find((t) => t.id === id)?.name ?? null) : null;

  // Nombre del cajero que abrió/cerró (con fallback al usuario actual).
  const nameOf = (id: string | null) =>
    id
      ? (profileNames[id] ??
        (id === session?.userId ? (session?.name ?? "—") : "—"))
      : "—";

  const [openingAmount, setOpeningAmount] = useState("");
  const [openingTillId, setOpeningTillId] = useState("");
  const [busy, setBusy] = useState(false);

  const [movDialog, setMovDialog] = useState(false);
  const [movType, setMovType] = useState<"ingreso" | "egreso">("egreso");
  const [movConcept, setMovConcept] = useState("");
  const [movAmount, setMovAmount] = useState("");

  const [countDialog, setCountDialog] = useState(false);
  const [countBusy, setCountBusy] = useState(false);

  const load = async () => {
    setIsLoading(true);
    try {
      const [current, history, names, tillsList] = await Promise.all([
        // Acotado al propio usuario: puede haber varias cajas abiertas a la
        // vez en la misma sucursal, y cada quien debe ver (y poder cerrar)
        // solo la suya.
        fetchOpenCashSession(
          companyId,
          cajaLocationId ?? undefined,
          session?.userId,
          canSeeFigures,
        ),
        // Admin/finanzas ven el historial de toda la sucursal (supervisión);
        // un cajero solo el suyo, y sin cifras.
        fetchCashClosings(
          companyId,
          cajaLocationId ?? undefined,
          canSeeFigures ? undefined : session?.userId,
          canSeeFigures,
        ),
        fetchProfileNames(companyId),
        cajaLocationId ? fetchTills(cajaLocationId) : Promise.resolve([]),
      ]);
      const mv = current ? await fetchCashMovements(current.id) : [];
      const tc = current ? await fetchTillCounts(current.id) : [];
      setOpenSession(current);
      setClosings(history);
      setProfileNames(names);
      setMovements(mv);
      setTills(tillsList);
      setTillCounts(tc);
      setLoadError(false);
    } catch {
      setLoadError(true);
      setOpenSession(null);
      setClosings([]);
      setMovements([]);
      setTills([]);
      setTillCounts([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (session) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.companyId, cajaLocationId]);

  // Ventas en efectivo del TURNO: solo las hechas desde que se abrió la caja
  // (compara la marca de tiempo exacta de la venta con la hora de apertura).
  // Esto es solo un estimado en vivo para admin/finanzas mientras la caja
  // sigue abierta -- el número que de verdad cuenta para el arqueo lo
  // calcula el servidor al autorizar, nunca este cálculo del navegador.
  const cashSales = useMemo(() => {
    if (!openSession) return 0;
    const openedAt = openSession.openedAt;
    return sales
      .filter(
        (sale) =>
          sale.method === "Efectivo" &&
          (sale.createdAt ?? sale.date) >= openedAt,
      )
      .reduce((sum, sale) => sum + sale.total, 0);
  }, [sales, openSession]);

  const ingresos = movements
    .filter((m) => m.amount > 0)
    .reduce((s, m) => s + m.amount, 0);
  const egresos = movements
    .filter((m) => m.amount < 0)
    .reduce((s, m) => s + m.amount, 0); // negative
  const expected =
    (openSession?.openingAmount ?? 0) + cashSales + ingresos + egresos;

  // In demo (or on read error) show a read-only preview so it never looks empty.
  const preview = isDemo || loadError;
  const sessionView = preview ? DEMO_SESSION : openSession;
  const movementsView = preview ? DEMO_MOVEMENTS : movements;
  const closingsView = preview ? DEMO_CLOSINGS : closings;
  const cashSalesView = preview ? 320.5 : cashSales;
  const ingresosView = preview ? 0 : ingresos;
  const egresosView = preview ? -15 : egresos;
  const expectedView = preview ? 505.5 : expected;

  const hasCount1 = tillCounts.some((c) => c.countNumber === 1);
  const hasCount2 = tillCounts.some((c) => c.countNumber === 2);
  const count1 = tillCounts.find((c) => c.countNumber === 1);
  const iDidCount1 = !!count1 && count1.countedBy === session?.userId;

  const fmtTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleTimeString(settings.locale, {
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  };
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

  const handleOpen = async () => {
    if (isDemo) return blockDemoAction();
    if (!session) return;
    // Con una sola caja activa no hay nada que elegir; con varias, sí se
    // exige (el servidor también lo exige -- esto es solo para no mandar
    // una petición que sabemos que va a fallar).
    if (activeTills.length > 1 && !openingTillId) {
      toast.error("Elige en qué caja vas a trabajar.");
      return;
    }
    setBusy(true);
    try {
      await openCashSession(
        session,
        Number(openingAmount) || 0,
        cajaLocationId ?? undefined,
        openingTillId || undefined,
      );
      setOpeningAmount("");
      setOpeningTillId("");
      toast.success("Caja abierta.");
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo abrir la caja."));
    } finally {
      setBusy(false);
    }
  };

  const handleAddMovement = async () => {
    if (isDemo) return blockDemoAction();
    if (!session || !openSession) return;
    setBusy(true);
    try {
      await createCashMovement(
        session,
        openSession.id,
        movType,
        movConcept,
        Number(movAmount) || 0,
      );
      setMovDialog(false);
      setMovConcept("");
      setMovAmount("");
      setMovType("egreso");
      toast.success("Movimiento registrado.");
      await load();
    } catch (error) {
      toast.error(
        getErrorMessage(error, "No se pudo registrar el movimiento."),
      );
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitCount = async (lines: DenominationLine[]) => {
    if (isDemo) return blockDemoAction();
    if (!session || !openSession) return;
    setCountBusy(true);
    try {
      await submitTillCount(openSession.id, lines);
      const finish = await finishTillCount(openSession.id);
      setCountDialog(false);
      if (finish.status === "closed") {
        toast.success(
          "Caja cerrada. Queda pendiente de que admin la autorice.",
        );
      } else {
        toast(
          "Conteo registrado. Se necesita un segundo conteo, hecho por otra persona, antes de cerrar.",
        );
      }
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo registrar el conteo."));
    } finally {
      setCountBusy(false);
    }
  };

  // Sin sucursal concreta (admin con "Todas las tiendas") no hay caja que abrir:
  // se pide elegir una en el selector de arriba.
  if (!cajaLocationId) {
    return (
      <AppShell>
        <div className="grid min-h-[60vh] place-items-center px-4">
          <div className="max-w-sm text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary">
              <Store className="h-7 w-7" />
            </div>
            <h2 className="mt-4 text-lg font-bold">Elige una sucursal</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Selecciona la sucursal en el menú de arriba para gestionar su
              caja.
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  if (cajaLocationInactive) {
    return (
      <AppShell>
        <div className="grid min-h-[60vh] place-items-center px-4">
          <div className="max-w-sm text-center">
            <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary">
              <Store className="h-7 w-7" />
            </div>
            <h2 className="mt-4 text-lg font-bold">Sucursal no disponible</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Tu sucursal asignada está desactivada. Pide a un administrador que
              te asigne una sucursal activa para gestionar la caja.
            </p>
          </div>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <PageHeader
        eyebrow="Operaciones"
        icon={Wallet}
        title="Caja"
        description="Control de apertura y cierre."
        actions={
          <div className="flex items-center gap-2">
            {canSeeFigures && (
              <Button variant="outline" size="sm" asChild>
                <Link to="/caja/revision">
                  <ClipboardCheck className="mr-1 h-4 w-4" /> Revisar cierres
                </Link>
              </Button>
            )}
            <Badge variant={sessionView ? "success" : "outline"}>
              {sessionView ? "Abierta" : "Cerrada"}
            </Badge>
          </div>
        }
      />

      <FallbackNotice show={loadError && !isDemo}>
        No se pudo leer la caja (revisa permisos/RLS en Supabase). Mostrando un
        ejemplo.
      </FallbackNotice>

      {/* Estas 3 tarjetas (esperado, ventas en efectivo, egresos) son
          justo lo que el arqueo ciego debe ocultar: mostrar cualquier
          subconjunto de los ingredientes de la fórmula (aunque se
          esconda el resultado final) deja que se sume a mano y se
          reconstruya el esperado. Por eso todo el bloque es solo para
          admin/finanzas, nunca para quien va a hacer el conteo. */}
      {canSeeFigures && (
        <div className="mb-4 grid gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
                <Banknote className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs text-muted-foreground">
                  Esperado en caja
                </p>
                <p className="text-2xl font-black tabular-nums">
                  {formatMoney(expectedView)}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
                <ArrowUpCircle className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs text-muted-foreground">
                  Ventas en efectivo
                </p>
                <p className="text-2xl font-black tabular-nums">
                  {formatMoney(cashSalesView)}
                </p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex items-center gap-3 p-4">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
                <ArrowDownCircle className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs text-muted-foreground">Egresos</p>
                <p className="text-2xl font-black tabular-nums">
                  {formatMoney(egresosView)}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {sessionView ? "Estado de caja" : "Abrir caja"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {sessionView ? (
              <>
                {canSeeFigures && (
                  <div className="space-y-1.5 rounded-2xl border border-border/70 p-3 text-sm">
                    <Row
                      label="Apertura"
                      value={formatMoney(sessionView.openingAmount)}
                    />
                    <Row
                      label="Ventas efectivo"
                      value={formatMoney(cashSalesView)}
                    />
                    <Row label="Ingresos" value={formatMoney(ingresosView)} />
                    <Row label="Egresos" value={formatMoney(egresosView)} />
                    <div className="mt-1 flex justify-between border-t border-border/60 pt-2 font-bold">
                      <span>Esperado</span>
                      <span className="tabular-nums">
                        {formatMoney(expectedView)}
                      </span>
                    </div>
                  </div>
                )}
                <p className="px-1 text-xs text-muted-foreground">
                  {tillName(sessionView.tillId) && (
                    <>
                      <span className="font-medium text-foreground">
                        {tillName(sessionView.tillId)}
                      </span>
                      {" · "}
                    </>
                  )}
                  Abierta por{" "}
                  <span className="font-medium text-foreground">
                    {nameOf(sessionView.openedBy)}
                  </span>{" "}
                  · {fmtDate(sessionView.openedAt)}{" "}
                  {fmtTime(sessionView.openedAt)}
                </p>
                <DemoGuardedButton
                  variant="outline"
                  className="w-full"
                  onAllowedClick={() => setMovDialog(true)}
                >
                  <Plus className="mr-1 h-4 w-4" /> Agregar movimiento
                </DemoGuardedButton>

                {!hasCount1 && (
                  <DemoGuardedButton
                    variant="destructive"
                    className="w-full"
                    onAllowedClick={() => setCountDialog(true)}
                  >
                    Cerrar caja
                  </DemoGuardedButton>
                )}

                {hasCount1 && !hasCount2 && (
                  <div className="space-y-2 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                    <p className="text-amber-700 dark:text-amber-400">
                      El primer conteo no cuadró. Se necesita un{" "}
                      <strong>segundo conteo</strong>, hecho por{" "}
                      <strong>otra persona</strong>, antes de cerrar.
                    </p>
                    {iDidCount1 ? (
                      <p className="text-xs text-muted-foreground">
                        Tú hiciste el primer conteo — pide que otra persona
                        entre con su cuenta y complete el segundo.
                      </p>
                    ) : (
                      <DemoGuardedButton
                        variant="destructive"
                        className="w-full"
                        onAllowedClick={() => setCountDialog(true)}
                      >
                        Hacer segundo conteo
                      </DemoGuardedButton>
                    )}
                  </div>
                )}
              </>
            ) : (
              <>
                {activeTills.length > 1 && (
                  <div className="space-y-1">
                    <Label>
                      Caja <span className="text-destructive">*</span>
                    </Label>
                    <Select
                      value={openingTillId}
                      onValueChange={setOpeningTillId}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Elige una caja" />
                      </SelectTrigger>
                      <SelectContent>
                        {activeTills.map((till) => (
                          <SelectItem key={till.id} value={till.id}>
                            {till.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-1">
                  <Label>Monto inicial</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="200.00"
                    value={openingAmount}
                    onChange={(event) => setOpeningAmount(event.target.value)}
                  />
                </div>
                <DemoGuardedButton
                  variant="brand"
                  className="w-full"
                  disabled={busy}
                  onAllowedClick={handleOpen}
                >
                  Abrir caja
                </DemoGuardedButton>
              </>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Movimientos del día</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Hora</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Concepto</TableHead>
                    <TableHead className="text-right">Monto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && !preview && (
                    <TableRow>
                      <TableCell
                        colSpan={4}
                        className="py-8 text-center text-muted-foreground"
                      >
                        Cargando...
                      </TableCell>
                    </TableRow>
                  )}
                  {!isLoading && movementsView.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4}>
                        <EmptyState
                          emoji="💵"
                          title="Sin movimientos"
                          description="Las ventas en efectivo y los ingresos/egresos aparecerán aquí."
                        />
                      </TableCell>
                    </TableRow>
                  )}
                  {movementsView.map((movement) => (
                    <TableRow key={movement.id}>
                      <TableCell>{fmtTime(movement.movementAt)}</TableCell>
                      <TableCell className="capitalize">
                        {movement.type}
                      </TableCell>
                      <TableCell>{movement.concept}</TableCell>
                      <TableCell
                        className={`text-right tabular-nums ${movement.amount < 0 ? "text-destructive" : ""}`}
                      >
                        {formatMoney(movement.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">Historial de cierres</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Turno</TableHead>
                  <TableHead className="text-right">Apertura</TableHead>
                  {canSeeFigures ? (
                    <>
                      <TableHead className="text-right">Esperado</TableHead>
                      <TableHead className="text-right">Real</TableHead>
                      <TableHead className="text-right">Diferencia</TableHead>
                    </>
                  ) : (
                    <TableHead className="text-right">Estado</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {!isLoading && closingsView.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={canSeeFigures ? 5 : 3}>
                      <EmptyState
                        emoji="🧾"
                        title="Sin cierres todavía"
                        description="Cuando cierres una caja, el arqueo quedará registrado aquí."
                      />
                    </TableCell>
                  </TableRow>
                )}
                {closingsView.map((closing) => (
                  <TableRow key={closing.id}>
                    <TableCell>
                      <div className="space-y-0.5">
                        <div className="text-xs text-muted-foreground">
                          <span className="text-foreground">Abrió:</span>{" "}
                          {nameOf(closing.openedBy)}
                          {" · "}
                          {fmtDate(closing.openedAt)}{" "}
                          {fmtTime(closing.openedAt)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          <span className="text-foreground">Cerró:</span>{" "}
                          {nameOf(closing.closedBy)}
                          {" · "}
                          {closing.closedAt
                            ? `${fmtDate(closing.closedAt)} ${fmtTime(closing.closedAt)}`
                            : "—"}
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatMoney(closing.openingAmount)}
                    </TableCell>
                    {canSeeFigures ? (
                      closing.reviewStatus === "authorized" ? (
                        <>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(closing.expectedAmount)}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {formatMoney(closing.realAmount ?? 0)}
                          </TableCell>
                          <TableCell className="text-right">
                            <Badge
                              variant={
                                closing.classification === "cuadrado"
                                  ? "success"
                                  : closing.classification === "faltante"
                                    ? "destructive"
                                    : "warm"
                              }
                            >
                              {closing.classification
                                ? CLASSIFICATION_LABELS[closing.classification]
                                : "—"}
                            </Badge>
                          </TableCell>
                        </>
                      ) : (
                        <TableCell colSpan={3} className="text-right">
                          <Badge variant="outline">
                            Pendiente de autorizar
                          </Badge>
                        </TableCell>
                      )
                    ) : (
                      <TableCell className="text-right">
                        <Badge
                          variant={
                            closing.reviewStatus === "authorized"
                              ? "success"
                              : "outline"
                          }
                        >
                          {closing.reviewStatus === "authorized"
                            ? "Autorizado"
                            : "Pendiente de revisión"}
                        </Badge>
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Add movement dialog */}
      <Dialog open={movDialog} onOpenChange={setMovDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo movimiento</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Tipo</Label>
              <Select
                value={movType}
                onValueChange={(v) => setMovType(v as "ingreso" | "egreso")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ingreso">Ingreso</SelectItem>
                  <SelectItem value="egreso">Egreso</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Concepto</Label>
              <Input
                value={movConcept}
                onChange={(event) => setMovConcept(event.target.value)}
                placeholder="Ej. Compra de bolsas"
              />
            </div>
            <div className="space-y-1">
              <Label>Monto</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={movAmount}
                onChange={(event) => setMovAmount(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="brand"
              disabled={busy || !(Number(movAmount) > 0)}
              onClick={handleAddMovement}
            >
              {busy ? "Guardando..." : "Registrar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Arqueo ciego: conteo por denominación (1er o 2do conteo) */}
      <Dialog open={countDialog} onOpenChange={setCountDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {hasCount1 ? "Segundo conteo" : "Cerrar caja — conteo ciego"}
            </DialogTitle>
          </DialogHeader>
          {!hasCount1 && (
            <p className="text-sm text-muted-foreground">
              Cuenta los billetes y monedas que hay en la caja. No podrás ver
              cuánto se esperaba hasta que un administrador autorice este corte.
            </p>
          )}
          <DenominationCountForm
            busy={countBusy}
            onSubmit={handleSubmitCount}
            formatMoney={formatMoney}
            submitLabel={hasCount1 ? "Enviar segundo conteo" : "Enviar conteo"}
          />
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
