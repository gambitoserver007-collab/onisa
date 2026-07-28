import { useCallback, useEffect, useState } from "react";
import {
  buildDemoDashboardData,
  emptyDashboardData,
  fetchCompanyCatalog,
  fetchLocationStock,
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
  to?: string;   // ISO date (yyyy-mm-dd)
}

// `locationId` opcional: filtra ventas, stock y conteos a un punto de venta.
// `range` opcional: aplica p_from/p_to a las RPCs de categoría y método de pago.
export function useDashboardData(locationId?: string, range?: DashboardRange) {
  const { isReady, session } = useDemoSession();
  const sessionKey = session ? `${session.userId ?? session.email}:${session.companyId ?? ""}` : "";
  const [data, setData] = useState<DashboardData>(() => emptyDashboardData());
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [source, setSource] = useState<"supabase" | "demo-fallback">("supabase");

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
      const fromTs = rangeFrom ? new Date(`${rangeFrom}T00:00:00`).toISOString() : undefined;
      const toTs = rangeTo
        ? new Date(new Date(`${rangeTo}T00:00:00`).getTime() + 24 * 60 * 60 * 1000).toISOString()
        : undefined;

      const [catalog, aggregates, recentSales] = await Promise.all([
        fetchCompanyCatalog(session?.companyId),
        fetchSalesAggregates(tz, locationId, fromTs, toTs),
        fetchRecentSales(session?.companyId, locationId, 4),
      ]);

      let effectiveCatalog = catalog;
      if (locationId) {
        const stock = await fetchLocationStock(locationId);
        effectiveCatalog = {
          ...catalog,
          products: catalog.products
            .filter((product) => stock.has(product.id))
            .map((product) => ({ ...product, stock: stock.get(product.id) ?? 0 })),
        };
      }

      const lowStock = effectiveCatalog.products.filter(
        (product) => product.stock > 0 && product.stock < 10,
      );

      setData({
        totalToday: aggregates.totalToday,
        salesTodayCount: aggregates.salesTodayCount,
        totalMonth: aggregates.totalMonth,
        productsCount: effectiveCatalog.products.length,
        customersCount: effectiveCatalog.customers.length,
        lowStockCount: lowStock.length,
        lowStockProducts: lowStock
          .slice()
          .sort((a, b) => a.stock - b.stock)
          .slice(0, 4)
          .map((product) => ({
            id: product.id,
            name: product.name,
            stock: product.stock,
            unit: product.unit,
          })),
        recentSales,
        salesLast7Days: aggregates.salesLast7Days,
        salesByCategory: aggregates.salesByCategory,
        salesByMethod: aggregates.salesByMethod,
      });
      setSource("supabase");
    } catch (loadError) {
      setData(isDemoSession(session) ? buildDemoDashboardData() : emptyDashboardData());
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
