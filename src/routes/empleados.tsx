import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Clock,
  KeyRound,
  Trash2,
  UserCheck,
  UserX,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { blockDemoAction } from "@/lib/demoMode";
import {
  clearEmployeePin,
  createTimeEvent,
  deleteTimeEvent,
  fetchAttendance,
  fetchProfileNames,
  fetchSales,
  fetchStockMovements,
  fetchTeam,
  fetchTimeEvents,
  punchEmployee,
  setEmployeePin,
  getErrorMessage,
  type AttendanceEntry,
  type StockMovementRow,
  type TeamMember,
  type TimeEvent,
} from "@/services/appData";
import type { Sale } from "@/types";

export const Route = createFileRoute("/empleados")({ component: Empleados });

const ALL = "__all__";
const TIME_EVENT_LABELS: Record<string, string> = {
  absence: "Falta",
  vacation: "Vacación",
};

function localDateKey(value: string | Date) {
  const d = typeof value === "string" ? new Date(value) : value;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function Empleados() {
  const { isDemo, session, isReady } = useDemoSession();
  const { settings } = useBusinessSettings();
  const { locations, hasMultiple } = useCurrentLocation();

  const [team, setTeam] = useState<TeamMember[]>([]);
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});
  const [attendance, setAttendance] = useState<AttendanceEntry[]>([]);
  const [timeEvents, setTimeEvents] = useState<TimeEvent[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [movements, setMovements] = useState<StockMovementRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const nameOf = (id: string | null) => (id ? (profileNames[id] ?? "—") : "—");

  const reload = async () => {
    if (!session?.companyId) return;
    setIsLoading(true);
    try {
      const [
        teamData,
        names,
        attendanceData,
        timeEventsData,
        salesData,
        movementsData,
      ] = await Promise.all([
        fetchTeam(session.companyId),
        fetchProfileNames(session.companyId),
        fetchAttendance(session.companyId),
        fetchTimeEvents(session.companyId),
        fetchSales(session.companyId),
        fetchStockMovements(session.companyId),
      ]);
      setTeam(teamData);
      setProfileNames(names);
      setAttendance(attendanceData);
      setTimeEvents(timeEventsData);
      setSales(salesData);
      setMovements(movementsData);
    } catch (error) {
      toast.error(
        getErrorMessage(error, "No se pudo cargar el módulo de empleados."),
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isReady) return;
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, session?.companyId]);

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

  // ---- Checador ----
  const [pin, setPin] = useState("");
  const [punchLocationId, setPunchLocationId] = useState(ALL);
  const [isPunching, setIsPunching] = useState(false);
  const [pinTarget, setPinTarget] = useState<TeamMember | null>(null);
  const [pinValue, setPinValue] = useState("");
  const [isSavingPin, setIsSavingPin] = useState(false);
  const [clearPinTarget, setClearPinTarget] = useState<TeamMember | null>(null);

  const todayAttendance = useMemo(
    () =>
      attendance.filter(
        (a) => localDateKey(a.checkInAt) === localDateKey(new Date()),
      ),
    [attendance],
  );

  const handlePunch = async () => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    if (!pin.trim()) return;
    setIsPunching(true);
    try {
      const result = await punchEmployee(
        pin.trim(),
        punchLocationId === ALL ? null : punchLocationId,
      );
      setPin("");
      if (result.action === "check_in") {
        toast.success(
          `${result.fullName}: entrada registrada${result.isLate ? " (con retardo)" : ""}.`,
        );
      } else {
        toast.success(`${result.fullName}: salida registrada.`);
      }
      await reload();
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo registrar el PIN."));
    } finally {
      setIsPunching(false);
    }
  };

  const handleSavePin = async () => {
    if (!pinTarget) return;
    if (!/^\d{4,6}$/.test(pinValue.trim())) {
      toast.error("El PIN debe ser numérico, de 4 a 6 dígitos.");
      return;
    }
    setIsSavingPin(true);
    try {
      await setEmployeePin(pinTarget.id, pinValue.trim());
      toast.success(`PIN asignado a ${pinTarget.name}.`);
      setPinTarget(null);
      setPinValue("");
      await reload();
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo asignar el PIN."));
    } finally {
      setIsSavingPin(false);
    }
  };

  const handleClearPin = async () => {
    if (!clearPinTarget) return;
    try {
      await clearEmployeePin(clearPinTarget.id);
      toast.success(`PIN de ${clearPinTarget.name} eliminado.`);
      setClearPinTarget(null);
      await reload();
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo quitar el PIN."));
    }
  };

  // ---- Ventas / Mermas por empleado ----
  const [salesEmployeeId, setSalesEmployeeId] = useState(ALL);
  const employeeSales = useMemo(
    () =>
      salesEmployeeId === ALL
        ? []
        : sales.filter((s) => s.createdBy === salesEmployeeId),
    [sales, salesEmployeeId],
  );
  const employeeSalesTotal = employeeSales.reduce((sum, s) => sum + s.total, 0);

  const [mermasEmployeeId, setMermasEmployeeId] = useState(ALL);
  const employeeMermas = useMemo(
    () =>
      mermasEmployeeId === ALL
        ? []
        : movements.filter(
            (m) =>
              m.movementType === "adjustment" &&
              m.createdBy === mermasEmployeeId,
          ),
    [movements, mermasEmployeeId],
  );

  // ---- Faltas y vacaciones ----
  const [teEmployeeId, setTeEmployeeId] = useState("");
  const [teType, setTeType] = useState<"absence" | "vacation">("absence");
  const [teDate, setTeDate] = useState(localDateKey(new Date()));
  const [teNote, setTeNote] = useState("");
  const [isSavingTe, setIsSavingTe] = useState(false);

  const handleCreateTimeEvent = async () => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    if (!session || !teEmployeeId) {
      toast.error("Elige un empleado.");
      return;
    }
    setIsSavingTe(true);
    try {
      await createTimeEvent(session, {
        profileId: teEmployeeId,
        type: teType,
        date: teDate,
        note: teNote,
      });
      toast.success("Registro guardado.");
      setTeNote("");
      await reload();
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo guardar el registro."));
    } finally {
      setIsSavingTe(false);
    }
  };

  const handleDeleteTimeEvent = async (id: string) => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    try {
      await deleteTimeEvent(id);
      await reload();
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo eliminar el registro."));
    }
  };

  const employees = team.filter((m) => !m.isPlatformAdmin);

  if (!isReady) return null;

  return (
    <AppShell>
      <PageHeader
        icon={Clock}
        eyebrow="Equipo"
        title="Empleados"
        description="Checador por PIN, asistencia, ventas y mermas por empleado."
      />

      <Tabs defaultValue="checador" className="w-full">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="checador">Checador</TabsTrigger>
          <TabsTrigger value="ventas">Ventas</TabsTrigger>
          <TabsTrigger value="mermas">Mermas</TabsTrigger>
          <TabsTrigger value="faltas">Faltas y vacaciones</TabsTrigger>
          <TabsTrigger value="permisos">Permisos</TabsTrigger>
        </TabsList>

        <TabsContent value="checador" className="space-y-4">
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-base">Pad de PIN</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                <div className="flex-1 space-y-1">
                  <Label>PIN del empleado</Label>
                  <Input
                    type="password"
                    inputMode="numeric"
                    maxLength={6}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handlePunch();
                    }}
                    placeholder="••••"
                  />
                </div>
                {hasMultiple && (
                  <div className="w-full space-y-1 sm:w-48">
                    <Label>Sucursal</Label>
                    <Select
                      value={punchLocationId}
                      onValueChange={setPunchLocationId}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={ALL}>La del empleado</SelectItem>
                        {locations.map((loc) => (
                          <SelectItem key={loc.id} value={loc.id}>
                            {loc.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <Button
                  variant="brand"
                  disabled={isPunching || !pin.trim()}
                  onClick={handlePunch}
                >
                  {isPunching ? "Registrando..." : "Registrar"}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                El empleado captura su propio PIN; el sistema decide solo si es
                una entrada o una salida.
              </p>
            </CardContent>
          </Card>

          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-base">Asistencia de hoy</CardTitle>
            </CardHeader>
            <CardContent>
              {todayAttendance.length === 0 ? (
                <EmptyState
                  emoji="🕒"
                  title="Sin movimientos hoy"
                  description="Los check-in/check-out de hoy aparecerán aquí."
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Empleado</TableHead>
                        <TableHead>Entrada</TableHead>
                        <TableHead>Salida</TableHead>
                        <TableHead>Estado</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {todayAttendance.map((a) => (
                        <TableRow key={a.id}>
                          <TableCell>{nameOf(a.profileId)}</TableCell>
                          <TableCell>
                            {fmtDateTime(a.checkInAt)}{" "}
                            {a.isLate && (
                              <Badge variant="destructive" className="ml-1">
                                Retardo
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell>{fmtDateTime(a.checkOutAt)}</TableCell>
                          <TableCell>
                            <Badge
                              variant={
                                a.status === "open" ? "default" : "secondary"
                              }
                            >
                              {a.status === "open" ? "Dentro" : "Cerrado"}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-base">PIN por empleado</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nombre</TableHead>
                      <TableHead>PIN</TableHead>
                      <TableHead className="text-right">Acción</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {employees.map((m) => (
                      <TableRow key={m.id}>
                        <TableCell>{m.name}</TableCell>
                        <TableCell>
                          {m.hasPin ? (
                            <Badge variant="default">
                              <UserCheck className="mr-1 h-3 w-3" /> Asignado
                            </Badge>
                          ) : (
                            <Badge variant="secondary">
                              <UserX className="mr-1 h-3 w-3" /> Sin PIN
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-right space-x-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setPinTarget(m);
                              setPinValue("");
                            }}
                          >
                            <KeyRound className="h-3.5 w-3.5" />{" "}
                            {m.hasPin ? "Cambiar" : "Asignar"}
                          </Button>
                          {m.hasPin && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setClearPinTarget(m)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="ventas">
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-base">Ventas por empleado</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="w-full sm:w-64 space-y-1">
                <Label>Empleado</Label>
                <Select
                  value={salesEmployeeId}
                  onValueChange={setSalesEmployeeId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Elige un empleado" />
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {salesEmployeeId === ALL ? (
                <EmptyState
                  emoji="🧑‍💼"
                  title="Elige un empleado"
                  description="Selecciona un empleado para ver sus ventas."
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Folio</TableHead>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Cliente</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {employeeSales.map((s) => (
                        <TableRow key={s.databaseId ?? s.id}>
                          <TableCell>{s.id}</TableCell>
                          <TableCell>{s.date}</TableCell>
                          <TableCell>{s.customer}</TableCell>
                          <TableCell className="text-right">
                            {s.total.toFixed(2)}
                          </TableCell>
                        </TableRow>
                      ))}
                      {employeeSales.length === 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={4}
                            className="text-center text-muted-foreground"
                          >
                            Sin ventas registradas.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                    {employeeSales.length > 0 && (
                      <tfoot>
                        <TableRow>
                          <TableCell colSpan={3} className="font-semibold">
                            Total
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {employeeSalesTotal.toFixed(2)}
                          </TableCell>
                        </TableRow>
                      </tfoot>
                    )}
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="mermas">
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-base">Mermas por empleado</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="w-full sm:w-64 space-y-1">
                <Label>Empleado</Label>
                <Select
                  value={mermasEmployeeId}
                  onValueChange={setMermasEmployeeId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Elige un empleado" />
                  </SelectTrigger>
                  <SelectContent>
                    {employees.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {mermasEmployeeId === ALL ? (
                <EmptyState
                  emoji="🧑‍💼"
                  title="Elige un empleado"
                  description="Selecciona un empleado para ver sus ajustes de inventario."
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Producto</TableHead>
                        <TableHead>Cantidad</TableHead>
                        <TableHead>Nota</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {employeeMermas.map((m) => (
                        <TableRow key={m.id}>
                          <TableCell>{fmtDateTime(m.createdAt)}</TableCell>
                          <TableCell>{m.productName}</TableCell>
                          <TableCell>{m.qty}</TableCell>
                          <TableCell>{m.notes ?? "—"}</TableCell>
                        </TableRow>
                      ))}
                      {employeeMermas.length === 0 && (
                        <TableRow>
                          <TableCell
                            colSpan={4}
                            className="text-center text-muted-foreground"
                          >
                            Sin ajustes registrados.
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="faltas" className="space-y-4">
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-base">
                Registrar falta o vacación
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-4">
                <div className="space-y-1">
                  <Label>Empleado</Label>
                  <Select value={teEmployeeId} onValueChange={setTeEmployeeId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Elige" />
                    </SelectTrigger>
                    <SelectContent>
                      {employees.map((m) => (
                        <SelectItem key={m.id} value={m.id}>
                          {m.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Tipo</Label>
                  <Select
                    value={teType}
                    onValueChange={(v) =>
                      setTeType(v as "absence" | "vacation")
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="absence">Falta</SelectItem>
                      <SelectItem value="vacation">Vacación</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Fecha</Label>
                  <Input
                    type="date"
                    value={teDate}
                    onChange={(e) => setTeDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <Label>Nota (opcional)</Label>
                  <Input
                    value={teNote}
                    onChange={(e) => setTeNote(e.target.value)}
                    placeholder="Motivo..."
                  />
                </div>
              </div>
              <Button
                variant="brand"
                disabled={isSavingTe || !teEmployeeId}
                onClick={handleCreateTimeEvent}
              >
                {isSavingTe ? "Guardando..." : "Registrar"}
              </Button>
            </CardContent>
          </Card>

          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-base">Historial</CardTitle>
            </CardHeader>
            <CardContent>
              {timeEvents.length === 0 ? (
                <EmptyState
                  emoji="🗓️"
                  title="Sin registros"
                  description="Las faltas y vacaciones capturadas aparecerán aquí."
                />
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Empleado</TableHead>
                        <TableHead>Tipo</TableHead>
                        <TableHead>Fecha</TableHead>
                        <TableHead>Nota</TableHead>
                        <TableHead className="text-right">Acción</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {timeEvents.map((te) => (
                        <TableRow key={te.id}>
                          <TableCell>{nameOf(te.profileId)}</TableCell>
                          <TableCell>
                            {TIME_EVENT_LABELS[te.type] ?? te.type}
                          </TableCell>
                          <TableCell>{te.date}</TableCell>
                          <TableCell>{te.note ?? "—"}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void handleDeleteTimeEvent(te.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="permisos">
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-base">Permisos</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Los roles y accesos de cada empleado se gestionan desde
                Usuarios, para no duplicar esa pantalla aquí.
              </p>
              <Button asChild variant="outline">
                <Link to="/usuarios">
                  <ShieldCheck className="h-4 w-4" /> Ir a Usuarios
                </Link>
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog
        open={!!pinTarget}
        onOpenChange={(open) => !open && setPinTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>PIN de {pinTarget?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-1">
            <Label>Nuevo PIN (4 a 6 dígitos)</Label>
            <Input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={pinValue}
              onChange={(e) => setPinValue(e.target.value.replace(/\D/g, ""))}
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button
              variant="brand"
              disabled={isSavingPin || !pinValue.trim()}
              onClick={handleSavePin}
            >
              {isSavingPin ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={!!clearPinTarget}
        onOpenChange={(open) => !open && setClearPinTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              ¿Quitar el PIN de {clearPinTarget?.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              No podrá usar el checador hasta que se le asigne un PIN nuevo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleClearPin()}>
              Quitar PIN
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {isLoading && (
        <p className="mt-4 text-center text-sm text-muted-foreground">
          Cargando...
        </p>
      )}
    </AppShell>
  );
}
