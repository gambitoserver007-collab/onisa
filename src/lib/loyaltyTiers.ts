import type { BusinessSettings } from "@/lib/businessSettings";

export type LoyaltyTier = "bronce" | "plata" | "oro";

export const LOYALTY_TIER_LABELS: Record<LoyaltyTier, string> = {
  bronce: "Bronce",
  plata: "Plata",
  oro: "Oro",
};

/** Mismo badge en cualquier pantalla que muestre el nivel de un cliente
 * (Clientes, Reportes, etc.) -- una sola fuente de verdad visual. */
export const LOYALTY_TIER_BADGE_VARIANT: Record<
  LoyaltyTier,
  "secondary" | "outline" | "warm"
> = {
  bronce: "secondary",
  plata: "outline",
  oro: "warm",
};

/** Mismo criterio que create_sale: Oro si ya llegó al umbral 3, Plata si
 * llegó al umbral 2, si no Bronce. Solo para mostrar el nivel en pantalla --
 * el nivel real que aplicó a cada venta ya quedó fijo en esa venta. */
export function getLoyaltyTier(
  yearSpend: number,
  settings: Pick<
    BusinessSettings,
    "loyaltyTier2MinSpend" | "loyaltyTier3MinSpend"
  >,
): LoyaltyTier {
  if (
    settings.loyaltyTier3MinSpend > 0 &&
    yearSpend >= settings.loyaltyTier3MinSpend
  ) {
    return "oro";
  }
  if (
    settings.loyaltyTier2MinSpend > 0 &&
    yearSpend >= settings.loyaltyTier2MinSpend
  ) {
    return "plata";
  }
  return "bronce";
}
