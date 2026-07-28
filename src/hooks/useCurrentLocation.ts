import { useEffect } from "react";
import { useSyncExternalStore } from "react";
import {
  ALL_LOCATIONS,
  getLocationState,
  loadLocationsForCompany,
  setCurrentLocationId,
  subscribeLocation,
} from "@/lib/currentLocation";
import { useDemoSession } from "@/hooks/useDemoSession";
import { fetchAssignedLocationIds } from "@/services/appData";

// Active location selection shared across the app. Loads the company's active
// locations once the session is ready. Admin/finanzas may select "Todas las
// tiendas"; a cashier stays pinned to their assigned (or first) store.
export function useCurrentLocation() {
  const { session, isReady } = useDemoSession();
  const state = useSyncExternalStore(subscribeLocation, getLocationState, getLocationState);
  const allowAll = session?.role === "admin" || session?.role === "finanzas";

  useEffect(() => {
    if (!isReady || !session?.companyId) return;
    const companyId = session.companyId;
    let active = true;
    void (async () => {
      // Sucursales asignadas (vacío = todas). El admin/dueño normalmente no tiene
      // asignación → ve todas.
      const allowedIds = await fetchAssignedLocationIds(session.userId);
      if (!active) return;
      await loadLocationsForCompany(companyId, {
        preferredId: session.locationId,
        allowAll,
        allowedIds,
      });
    })().catch(() => {});
    return () => {
      active = false;
    };
  }, [isReady, session?.companyId, session?.userId, session?.locationId, allowAll]);

  const isAllLocations = state.currentId === ALL_LOCATIONS;
  const currentLocation = isAllLocations
    ? null
    : (state.locations.find((loc) => loc.id === state.currentId) ?? state.locations[0] ?? null);

  return {
    locations: state.locations,
    currentLocationId: state.currentId,
    currentLocation,
    isAllLocations,
    setCurrentLocationId,
    hasMultiple: state.locations.length > 1,
  };
}
