import { useMemo, useSyncExternalStore } from "react";
import type { PaymentMethodKind } from "@/data/paymentMethods";
import {
  addCustomPaymentMethod,
  getActivePaymentMethods,
  getCountryPaymentMethodCatalog,
  getPaymentMethodAdminCatalog,
  getPaymentMethodsSnapshot,
  resetPaymentMethodsForCountry,
  setPaymentMethodAvailability,
  setStorePaymentMethodActive,
  subscribePaymentMethods,
} from "@/lib/paymentMethods";

export function usePaymentMethods(countryCode: string) {
  const snapshot = useSyncExternalStore(
    subscribePaymentMethods,
    getPaymentMethodsSnapshot,
    () => "",
  );

  return useMemo(() => {
    Boolean(snapshot);

    return {
      adminCatalog: getPaymentMethodAdminCatalog(countryCode),
      catalog: getCountryPaymentMethodCatalog(countryCode),
      fullCatalog: getCountryPaymentMethodCatalog(countryCode, { includeDisabled: true }),
      activeMethods: getActivePaymentMethods(countryCode),
      addCustom: (label: string, kind?: PaymentMethodKind) =>
        addCustomPaymentMethod(countryCode, label, kind),
      resetCountry: () => resetPaymentMethodsForCountry(countryCode),
      setAvailable: (methodId: string, available: boolean) =>
        setPaymentMethodAvailability(countryCode, methodId, available),
      setStoreActive: (methodId: string, active: boolean) =>
        setStorePaymentMethodActive(countryCode, methodId, active),
    };
  }, [countryCode, snapshot]);
}
