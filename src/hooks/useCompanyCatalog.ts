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
  const sessionKey = session ? `${session.userId ?? session.email}:${session.companyId ?? ""}` : "";
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
      const catalog = await fetchCompanyCatalog(session?.companyId);
      setState({ ...catalog, error: null, isLoading: false, source: "supabase" });
    } catch (error) {
      // Only fall back to demo data for demo sessions; real accounts show their
      // own (empty) state plus the error so demo numbers never leak in.
      setState({
        ...(isDemoSession(session) ? demoCatalog : EMPTY_CATALOG),
        error: getErrorMessage(error),
        isLoading: false,
        source: "demo-fallback",
      });
    }
  }, [session, session?.companyId, sessionKey]);

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
