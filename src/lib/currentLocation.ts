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
  options?: {
    preferredId?: string | null;
    allowAll?: boolean;
    allowedIds?: string[];
  };
} | null = null;

export async function refreshLocations() {
  // eslint-disable-next-line no-console -- depuración temporal, se quita después
  console.log("[DEBUG refreshLocations] lastLoadArgs:", lastLoadArgs);
  if (!lastLoadArgs) return;
  return loadLocationsForCompany(lastLoadArgs.companyId, lastLoadArgs.options);
}

export async function loadLocationsForCompany(
  companyId: string,
  options?: {
    preferredId?: string | null;
    allowAll?: boolean;
    allowedIds?: string[];
  },
) {
  lastLoadArgs = { companyId, options };
  const preferredId = options?.preferredId ?? null;
  const allowAll = options?.allowAll ?? false;
  const allowedIds = options?.allowedIds ?? [];
  const all = await fetchLocations(companyId, true);
  // eslint-disable-next-line no-console -- depuración temporal, se quita después
  console.log("[DEBUG loadLocationsForCompany] companyId:", companyId, "prevCurrentId:", currentId, "allowAll:", allowAll, "activas desde DB:", all.map((l) => ({ id: l.id, name: l.name })));
  // Restringe a las sucursales asignadas (vacío = todas). Si el filtro dejara la
  // lista vacía (p. ej. asignado a una sucursal inactiva), se cae a todas para
  // no bloquear al usuario.
  const filtered = allowedIds.length
    ? all.filter((loc) => allowedIds.includes(loc.id))
    : all;
  const list = filtered.length ? filtered : all;
  locations = list;
  const existsConcrete = (id: string | null | undefined): id is string =>
    !!id && list.some((loc) => loc.id === id);
  const isValid = (id: string | null | undefined): boolean =>
    (allowAll && id === ALL_LOCATIONS) || existsConcrete(id);
  // Con una sola sucursal en la lista no hay ambigüedad posible -- se usa esa
  // siempre, incluso si la selección previa (guardada de cuando había más de
  // una) era "Todas las tiendas". Es necesario forzarlo aquí: para admin/
  // finanzas "Todas" siempre cuenta como selección válida (isValid), y el
  // selector que permitiría corregirlo a mano se oculta precisamente cuando
  // solo queda una sucursal (ver LocationSwitcher) -- sin este caso especial,
  // desactivar una sucursal hasta dejar solo una deja al usuario sin forma de
  // salir de "Todas las tiendas", que el POS/Caja no aceptan.
  currentId =
    list.length === 1
      ? list[0].id
      : isValid(currentId)
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
