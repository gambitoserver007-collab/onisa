import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  demoCatalog,
  fetchCompanyCatalog,
  getErrorMessage,
  type CompanyCatalog,
} from "@/services/appData";
import { isDemoSession } from "@/lib/demoMode";
import { useDemoSession } from "./useDemoSession";

const EMPTY_CATALOG: CompanyCatalog = {
  categories: [],
  products: [],
  customers: [],
  suppliers: [],
};

// Se usa en ~20 pantallas/diálogos distintos (Productos, POS, Cotizaciones,
// Compras, Reportes...) y es común que una ruta y un diálogo suyo (ej.
// ProductFormSheet dentro de /productos) llamen a este hook al mismo
// tiempo. Antes cada llamada tenía su propio useState/useEffect sin
// compartir nada, así que el catálogo completo (productos/clientes/
// categorías/proveedores, sin paginar) se pedía una vez POR CADA llamada
// montada a la vez -- confirmado en vivo: /productos disparaba cada
// consulta 2 veces seguidas. React Query (ya usado en el resto del
// proyecto, con su QueryClientProvider en __root.tsx) deduplica por
// queryKey: várias llamadas simultáneas comparten una sola petición real y
// el mismo cache, y reload() de cualquiera refresca a todas.
export function useCompanyCatalog() {
  const { isReady, session } = useDemoSession();
  const queryClient = useQueryClient();

  const sessionKey = session
    ? `${session.userId ?? session.email}:${session.companyId ?? ""}`
    : "";

  const companyId = session?.companyId;
  const isDemo = isDemoSession(session);

  const query = useQuery({
    queryKey: ["companyCatalog", sessionKey],
    queryFn: () => fetchCompanyCatalog(companyId),
    enabled: isReady && !!sessionKey,
    // Volver a la misma pantalla en los siguientes 30s no dispara otra
    // vuelta al servidor -- los datos de catálogo no cambian tan seguido
    // como para justificarlo, y reload() (tras guardar algo) sigue forzando
    // una consulta real de todas formas.
    staleTime: 30_000,
  });

  const hasData = query.data !== undefined;
  const usesFallback = !hasData && query.isError && isDemo;
  const catalog = hasData
    ? query.data!
    : usesFallback
      ? demoCatalog
      : EMPTY_CATALOG;

  const reload = async () => {
    await queryClient.refetchQueries({
      queryKey: ["companyCatalog", sessionKey],
    });
  };

  return {
    ...catalog,
    error: query.error ? getErrorMessage(query.error) : null,
    isLoading: !isReady || (!!sessionKey && query.isLoading),
    source: usesFallback ? ("demo-fallback" as const) : ("supabase" as const),
    reload,
    session,
  };
}
