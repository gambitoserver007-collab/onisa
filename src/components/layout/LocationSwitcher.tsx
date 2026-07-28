import { Store } from "lucide-react";
import { useRouterState } from "@tanstack/react-router";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useCurrentLocation } from "@/hooks/useCurrentLocation";
import { ALL_LOCATIONS } from "@/lib/currentLocation";
import { useDemoSession } from "@/hooks/useDemoSession";

// Pages where you MUST operate on a single store (you can't sell or open a cash
// register across all stores at once), so "Todas las tiendas" is not offered.
function requiresSingleLocation(pathname: string) {
  return pathname.startsWith("/pos") || pathname.startsWith("/caja");
}

// Single source of truth for the active store, shown in the top bar.
// - Admin/finanzas: pueden elegir "Todas" + cada tienda (oculto si solo hay una).
// - Cajero/operador: ven su(s) sucursal(es) asignada(s) como indicador de dónde
//   operan; nunca ven "Todas". Si tienen varias asignadas, pueden cambiar.
// En POS/Caja siempre se exige una tienda concreta.
export function LocationSwitcher() {
  const { role } = useDemoSession();
  const { locations, currentLocationId, setCurrentLocationId } = useCurrentLocation();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const canViewAllStores = role === "admin" || role === "finanzas";
  if (locations.length === 0) return null;
  // Admin/finanzas con una sola tienda no necesitan selector. El cajero/operador
  // sí ve su sucursal asignada aunque sea una (sabe dónde está operando).
  if (canViewAllStores && locations.length <= 1) return null;

  // El cajero/operador nunca ve "Todas las tiendas" (siempre opera en una).
  const singleOnly = requiresSingleLocation(pathname) || !canViewAllStores;
  const isAll = currentLocationId === ALL_LOCATIONS;
  // On single-store pages, never show "Todas"; if it's currently selected, leave
  // the trigger empty so the user is forced to choose a concrete store.
  const value = singleOnly && isAll ? undefined : (currentLocationId ?? undefined);

  return (
    <Select value={value} onValueChange={setCurrentLocationId}>
      <SelectTrigger
        className="h-9 w-auto gap-2 rounded-full border-border/60 px-3 text-sm font-semibold shadow-sm"
        aria-label="Sucursal activa"
      >
        <Store className="h-4 w-4 shrink-0 text-primary" />
        <SelectValue placeholder={singleOnly ? "Elige sucursal" : "Sucursal"} />
      </SelectTrigger>
      <SelectContent>
        {!singleOnly && <SelectItem value={ALL_LOCATIONS}>Todas las tiendas</SelectItem>}
        {locations.map((location) => (
          <SelectItem key={location.id} value={location.id}>
            {location.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
