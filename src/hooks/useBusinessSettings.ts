import { useSyncExternalStore } from "react";
import { formatCurrencyAmount, getMarketByCountryCode } from "@/data/markets";
import {
  getBusinessSettings,
  getDefaultBusinessSettings,
  setBusinessCountry,
  setBusinessName,
  subscribeBusinessSettings,
} from "@/lib/businessSettings";

export function useBusinessSettings() {
  const settings = useSyncExternalStore(
    subscribeBusinessSettings,
    getBusinessSettings,
    getDefaultBusinessSettings,
  );
  const market = getMarketByCountryCode(settings.countryCode);

  return {
    settings,
    market,
    setCountryCode: setBusinessCountry,
    setBusinessName,
    formatMoney: (value: number) => formatCurrencyAmount(value, settings),
  };
}
