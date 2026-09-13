import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { DemoGuardedButton } from "@/components/demo/DemoGuardedButton";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDemoSession } from "@/hooks/useDemoSession";
import {
  createCalendarEvent,
  deleteCalendarEvent,
  fetchCalendarEvents,
  fetchProfileNames,
  updateCalendarEvent,
  type CalendarEvent,
  type CalendarEventType,
  getErrorMessage,
} from "@/services/appData";

export const Route = createFileRoute("/calendario")({ component: Calendario });

const EVENT_TYPE_LABELS: Record<CalendarEventType, string> = {
  rest: "Descanso",
  holiday: "Día festivo",
  birthday: "Cumpleaños",
  closure: "Cierre del negocio",
};

// Clases de Tailwind ya usadas por el resto de la app (tokens del tema, no
// colores sueltos) -- closure usa el tratamiento "oscuro sólido" que ya
// tiene precedente en badges de estado cerrado en otras pantallas.
const EVENT_TYPE_CHIP: Record<CalendarEventType, string> = {
  rest: "bg-info/15 text-info",
  holiday: "bg-destructive/15 text-destructive",
  birthday: "bg-warm/20 text-warm-foreground",
  closure: "bg-foreground text-background",
};

const EVENT_TYPE_DOT: Record<CalendarEventType, string> = {
  rest: "bg-info",
  holiday: "bg-destructive",
  birthday: "bg-warm",
  closure: "bg-foreground",
};

const WEEKDAY_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

function pad2(n: number) {
  return n.toString().padStart(2, "0");
}
function toDateKey(year: number, month: number, day: number) {
  return `${year}-${pad2(month + 1)}-${pad2(day)}`;
}
function todayKey() {
  const now = new Date();
  return toDateKey(now.getFullYear(), now.getMonth(), now.getDate());
}
/** Lunes=0 .. Domingo=6 (a diferencia de Date#getDay(), que empieza en domingo). */
function mondayIndex(date: Date) {
  return (date.getDay() + 6) % 7;
}
function eventAppliesToDay(event: CalendarEvent, dayKey: string) {
  const end = event.endDate ?? event.date;
  return dayKey >= event.date && dayKey <= end;
}

const MONTH_FORMATTER = new Intl.DateTimeFormat("es", {
  month: "long",
  year: "numeric",
});

interface EventFormState {
  eventType: CalendarEventType;
  date: string;
  endDate: string;
  profileId: string;
  title: string;
  notes: string;
}

const NO_PROFILE = "__ninguno__";

function suggestedTitle(
  eventType: CalendarEventType,
  profileId: string,
  profileNames: Record<string, string>,
): string {
  const name = profileId !== NO_PROFILE ? profileNames[profileId] : undefined;
  switch (eventType) {
    case "rest":
      return name ? `Descanso de ${name}` : "Descanso";
    case "birthday":
      return name ? `Cumpleaños de ${name}` : "Cumpleaños";
    case "holiday":
      return "Día festivo";
    case "closure":
      return "Cierre del negocio";
  }
}

function emptyForm(dateKey: string): EventFormState {
  return {
    eventType: "holiday",
    date: dateKey,
    endDate: "",
    profileId: NO_PROFILE,
    title: suggestedTitle("holiday", NO_PROFILE, {}),
    notes: "",
  };
}

function Calendario() {
  const { session, role, isReady } = useDemoSession();
  const isAdmin = role === "admin";

  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [viewYear, setViewYear] = useState(() => new Date().getFullYear());
  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth());

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [form, setForm] = useState<EventFormState>(() => emptyForm(todayKey()));
  const [isSaving, setIsSaving] = useState(false);
  const [titleTouched, setTitleTouched] = useState(false);

  const load = async () => {
    if (!session?.companyId) return;
    setIsLoading(true);
    try {
      const [eventsData, names] = await Promise.all([
        fetchCalendarEvents(session.companyId),
        fetchProfileNames(session.companyId),
      ]);
      setEvents(eventsData);
      setProfileNames(names);
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo cargar el calendario."));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!isReady) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, session?.companyId]);

  const monthLabel = useMemo(
    () => MONTH_FORMATTER.format(new Date(viewYear, viewMonth, 1)),
    [viewYear, viewMonth],
  );

  const gridCells = useMemo(() => {
    const first = new Date(viewYear, viewMonth, 1);
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const leadBlanks = mondayIndex(first);
    const cells: { dayKey: string | null; dayNum: number | null }[] = [];
    for (let i = 0; i < leadBlanks; i++)
      cells.push({ dayKey: null, dayNum: null });
    for (let d = 1; d <= daysInMonth; d++) {
      cells.push({ dayKey: toDateKey(viewYear, viewMonth, d), dayNum: d });
    }
    return cells;
  }, [viewYear, viewMonth]);

  const today = todayKey();

  const upcoming = useMemo(() => {
    return events
      .filter((event) => (event.endDate ?? event.date) >= today)
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(0, 8);
  }, [events, today]);

  const goToMonth = (delta: number) => {
    const next = new Date(viewYear, viewMonth + delta, 1);
    setViewYear(next.getFullYear());
    setViewMonth(next.getMonth());
  };

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm(today));
    setTitleTouched(false);
    setDialogOpen(true);
  };

  const openEdit = (event: CalendarEvent) => {
    if (!isAdmin) return;
    setEditing(event);
    setForm({
      eventType: event.eventType,
      date: event.date,
      endDate: event.endDate ?? "",
      profileId: event.profileId ?? NO_PROFILE,
      title: event.title,
      notes: event.notes ?? "",
    });
    setTitleTouched(true);
    setDialogOpen(true);
  };

  const updateForm = (patch: Partial<EventFormState>) => {
    setForm((prev) => {
      const next = { ...prev, ...patch };
      if (
        !titleTouched &&
        (patch.eventType !== undefined || patch.profileId !== undefined)
      ) {
        next.title = suggestedTitle(
          next.eventType,
          next.profileId,
          profileNames,
        );
      }
      return next;
    });
  };

  const needsProfile =
    form.eventType === "rest" || form.eventType === "birthday";

  const handleSave = async () => {
    if (!session) return;
    setIsSaving(true);
    try {
      const input = {
        eventType: form.eventType,
        date: form.date,
        endDate: form.endDate || null,
        profileId:
          needsProfile && form.profileId !== NO_PROFILE ? form.profileId : null,
        title: form.title,
        notes: form.notes,
      };
      if (editing) {
        await updateCalendarEvent(editing.id, input);
        toast.success("Evento actualizado.");
      } else {
        await createCalendarEvent(session, input);
        toast.success("Evento agregado.");
      }
      setDialogOpen(false);
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo guardar el evento."));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editing) return;
    if (!window.confirm("¿Eliminar este evento del calendario?")) return;
    setIsSaving(true);
    try {
      await deleteCalendarEvent(editing.id);
      toast.success("Evento eliminado.");
      setDialogOpen(false);
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo eliminar el evento."));
    } finally {
      setIsSaving(false);
    }
  };

  const nameFor = (id: string | null) =>
    id ? (profileNames[id] ?? "—") : null;

  return (
    <AppShell>
      <PageHeader
        eyebrow="Equipo"
        icon={CalendarDays}
        title="Calendario"
        description="Descansos, festivos, cumpleaños y cierres -- visible para todo el equipo."
        actions={
          isAdmin ? (
            <DemoGuardedButton variant="brand" onAllowedClick={openCreate}>
              <Plus className="mr-1 h-4 w-4" /> Agregar evento
            </DemoGuardedButton>
          ) : undefined
        }
      />

      <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
        <Card>
          <CardContent className="p-4">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Button
                  size="icon"
                  variant="outline"
                  aria-label="Mes anterior"
                  onClick={() => goToMonth(-1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="min-w-40 text-center text-base font-bold capitalize">
                  {monthLabel}
                </span>
                <Button
                  size="icon"
                  variant="outline"
                  aria-label="Mes siguiente"
                  onClick={() => goToMonth(1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="mb-3 flex flex-wrap gap-3 text-xs font-medium text-muted-foreground">
              {(Object.keys(EVENT_TYPE_LABELS) as CalendarEventType[]).map(
                (type) => (
                  <span key={type} className="flex items-center gap-1.5">
                    <span
                      className={`h-2 w-2 rounded-full ${EVENT_TYPE_DOT[type]}`}
                    />
                    {EVENT_TYPE_LABELS[type]}
                  </span>
                ),
              )}
            </div>

            <div className="mb-1 grid grid-cols-7 gap-1.5">
              {WEEKDAY_LABELS.map((label) => (
                <span
                  key={label}
                  className="text-center text-[11px] font-bold uppercase tracking-wide text-muted-foreground"
                >
                  {label}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1.5">
              {gridCells.map((cell, index) => {
                if (!cell.dayKey) {
                  return (
                    <div
                      key={`blank-${index}`}
                      className="min-h-[88px] rounded-lg border border-transparent bg-muted/40"
                    />
                  );
                }
                const dayEvents = events.filter((event) =>
                  eventAppliesToDay(event, cell.dayKey!),
                );
                const isToday = cell.dayKey === today;
                return (
                  <div
                    key={cell.dayKey}
                    className={`min-h-[88px] rounded-lg border p-1.5 ${isToday ? "border-primary ring-1 ring-primary" : "border-border"}`}
                  >
                    <span
                      className={`text-xs font-bold ${isToday ? "text-primary" : "text-muted-foreground"}`}
                    >
                      {cell.dayNum}
                    </span>
                    <div className="mt-1 flex flex-col gap-1">
                      {dayEvents.map((event) => (
                        <button
                          key={event.id}
                          type="button"
                          disabled={!isAdmin}
                          onClick={() => openEdit(event)}
                          className={`truncate rounded px-1.5 py-0.5 text-left text-[10px] font-semibold ${EVENT_TYPE_CHIP[event.eventType]} ${isAdmin ? "cursor-pointer" : "cursor-default"}`}
                          title={event.title}
                        >
                          {event.title}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="mb-1 text-sm font-bold">Próximos eventos</p>
            <p className="mb-3 text-xs text-muted-foreground">
              {isLoading ? "Cargando..." : "Lo que se acerca en el equipo"}
            </p>
            {!isLoading && upcoming.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No hay eventos próximos.
              </p>
            )}
            <div className="space-y-3">
              {upcoming.map((event) => (
                <button
                  key={event.id}
                  type="button"
                  disabled={!isAdmin}
                  onClick={() => openEdit(event)}
                  className={`flex w-full items-start gap-2 border-t pt-3 text-left first:border-t-0 first:pt-0 ${isAdmin ? "cursor-pointer" : "cursor-default"}`}
                >
                  <span
                    className={`mt-1 h-2 w-2 shrink-0 rounded-full ${EVENT_TYPE_DOT[event.eventType]}`}
                  />
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                      {new Date(`${event.date}T00:00:00`).toLocaleDateString(
                        "es",
                        { day: "2-digit", month: "short" },
                      )}
                    </p>
                    <p className="truncate text-sm font-semibold">
                      {event.title}
                    </p>
                    {nameFor(event.profileId) && (
                      <p className="truncate text-xs text-muted-foreground">
                        {nameFor(event.profileId)}
                      </p>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? "Editar evento" : "Agregar evento"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Tipo</Label>
              <Select
                value={form.eventType}
                onValueChange={(value) =>
                  updateForm({ eventType: value as CalendarEventType })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(EVENT_TYPE_LABELS) as CalendarEventType[]).map(
                    (type) => (
                      <SelectItem key={type} value={type}>
                        {EVENT_TYPE_LABELS[type]}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </div>
            {needsProfile && (
              <div className="space-y-1">
                <Label>Empleado</Label>
                <Select
                  value={form.profileId}
                  onValueChange={(value) => updateForm({ profileId: value })}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Selecciona un empleado" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_PROFILE}>Sin asignar</SelectItem>
                    {Object.entries(profileNames).map(([id, name]) => (
                      <SelectItem key={id} value={id}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Fecha</Label>
                <Input
                  type="date"
                  value={form.date}
                  onChange={(event) => updateForm({ date: event.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label>Hasta (opcional)</Label>
                <Input
                  type="date"
                  value={form.endDate}
                  onChange={(event) =>
                    updateForm({ endDate: event.target.value })
                  }
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Título</Label>
              <Input
                value={form.title}
                onChange={(event) => {
                  setTitleTouched(true);
                  updateForm({ title: event.target.value });
                }}
              />
            </div>
            <div className="space-y-1">
              <Label>Notas (opcional)</Label>
              <Textarea
                value={form.notes}
                onChange={(event) => updateForm({ notes: event.target.value })}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:justify-between">
            {editing ? (
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                disabled={isSaving}
                onClick={handleDelete}
              >
                <Trash2 className="mr-1 h-4 w-4" /> Eliminar
              </Button>
            ) : (
              <span />
            )}
            <Button
              variant="brand"
              disabled={isSaving || !form.title.trim() || !form.date}
              onClick={handleSave}
            >
              {isSaving ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
