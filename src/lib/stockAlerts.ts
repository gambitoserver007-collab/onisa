/** Umbral efectivo de un producto: el propio si lo tiene, si no el default
 * de la empresa (configurable en Configuración, arranca en 10). */
export function effectiveLowStockThreshold(
  product: { lowStockThreshold?: number | null },
  companyDefault: number,
): number {
  return product.lowStockThreshold ?? companyDefault;
}

export type StockStatus = "out" | "low" | "ok";

export function stockStatus(stock: number, threshold: number): StockStatus {
  if (stock <= 0) return "out";
  if (stock <= threshold) return "low";
  return "ok";
}
