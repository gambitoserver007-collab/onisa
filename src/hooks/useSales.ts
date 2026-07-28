import { useCallback, useEffect, useMemo, useState } from "react";
import { sales as demoSales } from "@/data/demo";
import { fetchSales, getErrorMessage } from "@/services/appData";
import type { Sale } from "@/types";
import { useDemoSession } from "./useDemoSession";

export function useSales(locationId?: string) {
  const { isReady, session } = useDemoSession();
  const sessionKey = session ? `${session.userId ?? session.email}:${session.companyId ?? ""}` : "";
  const [sales, setSales] = useState<Sale[]>(demoSales);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [source, setSource] = useState<"supabase" | "demo-fallback">("demo-fallback");

  const reload = useCallback(async () => {
    if (!sessionKey) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const data = await fetchSales(session?.companyId, locationId);
      setSales(data);
      setSource("supabase");
    } catch (loadError) {
      setSales(demoSales);
      setError(getErrorMessage(loadError));
      setSource("demo-fallback");
    } finally {
      setIsLoading(false);
    }
  }, [session?.companyId, sessionKey, locationId]);

  useEffect(() => {
    if (!isReady) return;
    void reload();
  }, [isReady, reload]);

  const findSale = useCallback(
    (id: string) => sales.find((sale) => sale.id === id || sale.databaseId === id) ?? null,
    [sales],
  );

  return useMemo(
    () => ({ sales, error, isLoading, source, reload, findSale }),
    [error, findSale, isLoading, reload, sales, source],
  );
}
