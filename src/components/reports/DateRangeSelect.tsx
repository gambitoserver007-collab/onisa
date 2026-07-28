import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface DateRange {
  from?: string;
  to?: string;
}

// Fecha local YYYY-MM-DD (no UTC), para que el periodo respete el día del negocio.
function dateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

const PRESETS = [
  { id: "hoy", label: "Hoy" },
  { id: "ayer", label: "Ayer" },
  { id: "7d", label: "Últimos 7 días" },
  { id: "30d", label: "Últimos 30 días" },
  { id: "mes", label: "Este mes" },
  { id: "mesPasado", label: "Mes pasado" },
  { id: "todo", label: "Todo el histórico" },
  { id: "custom", label: "Personalizado" },
];

function rangeForPreset(id: string): DateRange {
  const now = new Date();
  const back = (days: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - days);
    return dateKey(d);
  };
  switch (id) {
    case "hoy":
      return { from: dateKey(now), to: dateKey(now) };
    case "ayer":
      return { from: back(1), to: back(1) };
    case "7d":
      return { from: back(6), to: dateKey(now) };
    case "30d":
      return { from: back(29), to: dateKey(now) };
    case "mes":
      return { from: dateKey(new Date(now.getFullYear(), now.getMonth(), 1)), to: dateKey(now) };
    case "mesPasado":
      return {
        from: dateKey(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
        to: dateKey(new Date(now.getFullYear(), now.getMonth(), 0)),
      };
    default:
      return { from: undefined, to: undefined }; // "todo"
  }
}

// Selector de periodo (dropdown con presets) + fechas personalizadas Desde/Hasta.
// Por defecto aplica "Hoy". Emite el rango por onChange cada vez que cambia.
export function DateRangeSelect({
  onChange,
  defaultPreset = "hoy",
}: {
  onChange: (range: DateRange) => void;
  defaultPreset?: string;
}) {
  const [preset, setPreset] = useState(defaultPreset);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Aplica el preset por defecto al montar.
  useEffect(() => {
    const r = rangeForPreset(defaultPreset);
    setFrom(r.from ?? "");
    setTo(r.to ?? "");
    onChangeRef.current(r);
    // Solo al montar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyPreset = (id: string) => {
    setPreset(id);
    if (id === "custom") return; // conserva las fechas actuales
    const r = rangeForPreset(id);
    setFrom(r.from ?? "");
    setTo(r.to ?? "");
    onChange(r);
  };

  const editDate = (which: "from" | "to", value: string) => {
    setPreset("custom");
    const nextFrom = which === "from" ? value : from;
    const nextTo = which === "to" ? value : to;
    if (which === "from") setFrom(value);
    else setTo(value);
    onChange({ from: nextFrom || undefined, to: nextTo || undefined });
  };

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Periodo</Label>
        <Select value={preset} onValueChange={applyPreset}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRESETS.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Desde</Label>
        <Input
          type="date"
          value={from}
          max={to || undefined}
          onChange={(e) => editDate("from", e.target.value)}
          className="w-auto"
        />
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Hasta</Label>
        <Input
          type="date"
          value={to}
          min={from || undefined}
          onChange={(e) => editDate("to", e.target.value)}
          className="w-auto"
        />
      </div>
    </div>
  );
}
