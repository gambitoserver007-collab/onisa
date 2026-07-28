// Lightweight module store for the active location selection, shared across the
// whole app via useSyncExternalStore. The selection can be a concrete location
// id or the special ALL_LOCATIONS sentinel ("Todas las tiendas"), which only
// roles that may view several stores (admin/finanzas) are allowed to pick.
import { fetchLocations, type Location } from "@/services/appData";

// Sentinel meaning "all stores together". Lives here so every consumer shares
// one definition instead of redefining it per page.
export const ALL_LOCATIONS = "all";

let locations: Location[] = [];
let currentId: string | null = null;
let snapshotKey = "";
let stateSnapshot: { locations: Location[]; currentId: string | null } = {
  locations,
  currentId,
};
const listeners = new Set<() => void>();

function commit() {
  // Incluir nombre y estado (no solo ids) para que editar/activar una sucursal sí
  // notifique a los consumidores (el selector global mostraba el nombre viejo).
  const key = JSON.stringify({
    c: currentId,
    locs: locations.map((loc) => [loc.id, loc.name, loc.isActive]),
  });
  if (key === snapshotKey) return;
  snapshotKey = key;
  stateSnapshot = { locations, currentId };
  for (const listener of listeners) listener();
}

export function getLocationState() {
  return stateSnapshot;
}

export function subscribeLocation(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setCurrentLocationId(id: string) {
  if (id === currentId) return;
  currentId = id;
  commit();
}

// Loads the company's active locations and resolves the current selection:
// keeps the in-session choice if still valid; otherwise admin/finanzas default
// to "Todas las tiendas" and a cashier to their assigned (or first) store.
// Últimos argumentos usados, para poder refrescar la lista (p. ej. tras crear o
// desactivar una sucursal) sin recargar la página.
let lastLoadArgs: {
  companyId: string;
  options?: { preferredId?: string | null; allowAll?: boolean; allowedIds?: string[] };
} | null = null;

export async function refreshLocations() {
  if (!lastLoadArgs) return;
  return loadLocationsForCompany(lastLoadArgs.companyId, lastLoadArgs.options);
}

export async function loadLocationsForCompany(
  companyId: string,
  options?: { preferredId?: string | null; allowAll?: boolean; allowedIds?: string[] },
) {
  lastLoadArgs = { companyId, options };
  const preferredId = options?.preferredId ?? null;
  const allowAll = options?.allowAll ?? false;
  const allowedIds = options?.allowedIds ?? [];
  const all = await fetchLocations(companyId, true);
  // Restringe a las sucursales asignadas (vacío = todas). Si el filtro dejara la
  // lista vacía (p. ej. asignado a una sucursal inactiva), se cae a todas para
  // no bloquear al usuario.
  const filtered = allowedIds.length ? all.filter((loc) => allowedIds.includes(loc.id)) : all;
  const list = filtered.length ? filtered : all;
  locations = list;
  const existsConcrete = (id: string | null | undefined): id is string =>
    !!id && list.some((loc) => loc.id === id);
  const isValid = (id: string | null | undefined): boolean =>
    (allowAll && id === ALL_LOCATIONS) || existsConcrete(id);
  currentId = isValid(currentId)
    ? currentId
    : allowAll
      ? ALL_LOCATIONS
      : existsConcrete(preferredId)
        ? preferredId
        : (list[0]?.id ?? null);
  commit();
  return list;
}

export function resetLocations() {
  locations = [];
  currentId = null;
  commit();
}
