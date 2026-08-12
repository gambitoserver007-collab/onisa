import { useCallback, useEffect, useState } from "react";
import {
  buildDemoDashboardData,
  emptyDashboardData,
  fetchCompanyCounts,
  fetchLowStockSummary,
  fetchRecentSales,
  fetchSalesAggregates,
  getErrorMessage,
  type DashboardData,
} from "@/services/appData";
import { isDemoSession } from "@/lib/demoMode";
import { useDemoSession } from "./useDemoSession";

function getBusinessTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export interface DashboardRange {
  from?: string; // ISO date (yyyy-mm-dd)
  to?: string; // ISO date (yyyy-mm-dd)
}

// `locationId` opcional: filtra ventas, stock y conteos a un punto de venta.
// `range` opcional: aplica p_from/p_to a las RPCs de categoría y método de pago.
export function useDashboardData(locationId?: string, range?: DashboardRange) {
  const { isReady, session } = useDemoSession();
  const sessionKey = session
    ? `${session.userId ?? session.email}:${session.companyId ?? ""}`
    : "";
  const [data, setData] = useState<DashboardData>(() => emptyDashboardData());
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [source, setSource] = useState<"supabase" | "demo-fallback">(
    "supabase",
  );

  const rangeFrom = range?.from || undefined;
  const rangeTo = range?.to || undefined;

  const reload = useCallback(async () => {
    if (!sessionKey) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const tz = getBusinessTz();
      // Convertir yyyy-mm-dd a timestamps en TZ del negocio (rango [from 00:00, to+1 00:00)).
      const fromTs = rangeFrom
        ? new Date(`${rangeFrom}T00:00:00`).toISOString()
        : undefined;
      const toTs = rangeTo
        ? new Date(
            new Date(`${rangeTo}T00:00:00`).getTime() + 24 * 60 * 60 * 1000,
          ).toISOString()
        : undefined;

      const [counts, lowStock, aggregates, recentSales] = await Promise.all([
        fetchCompanyCounts(session?.companyId),
        fetchLowStockSummary(locationId),
        fetchSalesAggregates(tz, locationId, fromTs, toTs),
        fetchRecentSales(session?.companyId, locationId, 4),
      ]);

      setData({
        totalToday: aggregates.totalToday,
        salesTodayCount: aggregates.salesTodayCount,
        totalMonth: aggregates.totalMonth,
        productsCount: counts.productsCount,
        customersCount: counts.customersCount,
        lowStockCount: lowStock.count,
        lowStockProducts: lowStock.items,
        recentSales,
        salesLast7Days: aggregates.salesLast7Days,
        salesByCategory: aggregates.salesByCategory,
        salesByMethod: aggregates.salesByMethod,
      });
      setSource("supabase");
    } catch (loadError) {
      setData(
        isDemoSession(session)
          ? buildDemoDashboardData()
          : emptyDashboardData(),
      );
      setError(getErrorMessage(loadError));
      setSource("demo-fallback");
    } finally {
      setIsLoading(false);
    }
  }, [session, sessionKey, locationId, rangeFrom, rangeTo]);

  useEffect(() => {
    if (!isReady) return;
    void reload();
  }, [isReady, reload]);

  return { data, error, isLoading, source, reload };
}
