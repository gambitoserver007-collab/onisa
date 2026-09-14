import { useCallback, useEffect, useState } from "react";
import {
  demoCatalog,
  fetchCompanyCatalog,
  getErrorMessage,
  type CompanyCatalog,
} from "@/services/appData";
import { isDemoSession } from "@/lib/demoMode";
import { useDemoSession } from "./useDemoSession";

interface CatalogState extends CompanyCatalog {
  error: string | null;
  isLoading: boolean;
  source: "supabase" | "demo-fallback";
}

const EMPTY_CATALOG: CompanyCatalog = {
  categories: [],
  products: [],
  customers: [],
  suppliers: [],
};

export function useCompanyCatalog() {
  const { isReady, session } = useDemoSession();
  const sessionKey = session
    ? `${session.userId ?? session.email}:${session.companyId ?? ""}`
    : "";
  // companyId/isDemo (primitivos) en vez de todo el objeto session en los deps
  // de reload -- session cambia de referencia varias veces mientras arranca la
  // sesión (aunque el contenido real no cambie), y eso volvía a disparar todo
  // el catálogo de la empresa (categorías/productos/clientes/proveedores) 2-3
  // veces seguidas en cada carga.
  const companyId = session?.companyId;
  const isDemo = isDemoSession(session);
  const [state, setState] = useState<CatalogState>({
    ...EMPTY_CATALOG,
    error: null,
    isLoading: true,
    source: "supabase",
  });

  const reload = useCallback(async () => {
    if (!sessionKey) {
      setState((current) => ({ ...current, isLoading: false }));
      return;
    }

    setState((current) => ({ ...current, isLoading: true, error: null }));

    try {
      const catalog = await fetchCompanyCatalog(companyId);
      setState({
        ...catalog,
        error: null,
        isLoading: false,
        source: "supabase",
      });
    } catch (error) {
      // Only fall back to demo data for demo sessions; real accounts show their
      // own (empty) state plus the error so demo numbers never leak in.
      setState({
        ...(isDemo ? demoCatalog : EMPTY_CATALOG),
        error: getErrorMessage(error),
        isLoading: false,
        source: "demo-fallback",
      });
    }
  }, [sessionKey, companyId, isDemo]);

  useEffect(() => {
    if (!isReady) return;
    void reload();
  }, [isReady, reload]);

  return {
    ...state,
    reload,
    session,
  };
}
