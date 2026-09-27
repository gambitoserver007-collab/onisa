import { useCallback, useEffect, useMemo, useState } from "react";
import { sales as demoSales } from "@/data/demo";
import { fetchSales, getErrorMessage } from "@/services/appData";
import type { Sale } from "@/types";
import { useDemoSession } from "./useDemoSession";

/** `from`/`to` son obligatorios a propósito -- sin un rango, esto traía
 * TODO el historial de ventas de la empresa (se cortaba en silencio a las
 * 1000 filas de PostgREST). El llamador decide el rango (ventas.index.tsx
 * usa los últimos 30 días por defecto, ajustable). */
export function useSales(from: string, to: string, locationId?: string) {
  const { isReady, session } = useDemoSession();

  const sessionKey = session
    ? `${session.userId ?? session.email}:${session.companyId ?? ""}`
    : "";

  const [sales, setSales] = useState<Sale[]>(demoSales);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [source, setSource] = useState<"supabase" | "demo-fallback">(
    "demo-fallback",
  );

  const reload = useCallback(async () => {
    if (!sessionKey) {
      setIsLoading(false);

      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const data = await fetchSales(session?.companyId, locationId, {
        from,
        to,
      });

      setSales(data);
      setSource("supabase");
    } catch (loadError) {
      setSales(demoSales);
      setError(getErrorMessage(loadError));
      setSource("demo-fallback");
    } finally {
      setIsLoading(false);
    }
  }, [session?.companyId, sessionKey, locationId, from, to]);

  useEffect(() => {
    if (!isReady) return;
    void reload();
  }, [isReady, reload]);

  return useMemo(
    () => ({ sales, error, isLoading, source, reload }),
    [error, isLoading, reload, sales, source],
  );
}
