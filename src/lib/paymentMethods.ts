import {
  getDefaultCountryPaymentMethods,
  type PaymentMethodDefinition,
  type PaymentMethodKind,
} from "@/data/paymentMethods";
import { getSession } from "@/lib/demoAuth";

const PAYMENT_METHOD_SETTINGS_KEY = "tienda_agil_payment_methods";
const PAYMENT_METHOD_SETTINGS_CHANGED_EVENT =
  "tienda-agil:payment-methods-changed";

// Clave por EMPRESA (no global): así los métodos de cobro de una empresa no se filtran
// a otra que use el mismo navegador/dispositivo. Sin sesión, usa la clave base.
function storageKey() {
  const companyId = getSession()?.companyId;
  return companyId
    ? `${PAYMENT_METHOD_SETTINGS_KEY}:${companyId}`
    : PAYMENT_METHOD_SETTINGS_KEY;
}

interface CountryPaymentMethodSettings {
  disabledMethodIds?: string[];
  customMethods?: PaymentMethodDefinition[];
  activeMethodIds?: string[];
}

interface PaymentMethodSettings {
  countries: Record<string, CountryPaymentMethodSettings>;
}

export type PaymentMethodAdminItem = PaymentMethodDefinition & {
  available: boolean;
  isDefault: boolean;
  isCustom: boolean;
};

const emptySettings: PaymentMethodSettings = { countries: {} };

function normalizeCountryCode(countryCode: string) {
  return countryCode.trim().toUpperCase() || "PE";
}

function normalizeSettings(
  settings?: Partial<PaymentMethodSettings> | null,
): PaymentMethodSettings {
  return {
    countries: Object.entries(settings?.countries ?? {}).reduce<
      PaymentMethodSettings["countries"]
    >((countries, [countryCode, countrySettings]) => {
      countries[normalizeCountryCode(countryCode)] = {
        disabledMethodIds: Array.from(
          new Set(countrySettings?.disabledMethodIds ?? []),
        ),
        customMethods: uniqueMethods(countrySettings?.customMethods ?? []),
        activeMethodIds: Array.from(
          new Set(countrySettings?.activeMethodIds ?? []),
        ),
      };
      return countries;
    }, {}),
  };
}

function getRawPaymentMethodSettings() {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(storageKey()) ?? "";
}

function readSettings(): PaymentMethodSettings {
  if (typeof window === "undefined") return emptySettings;

  try {
    const raw = getRawPaymentMethodSettings();
    return raw
      ? normalizeSettings(JSON.parse(raw) as Partial<PaymentMethodSettings>)
      : emptySettings;
  } catch {
    return emptySettings;
  }
}

function emitPaymentMethodsChange() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PAYMENT_METHOD_SETTINGS_CHANGED_EVENT));
}

function writeSettings(settings: PaymentMethodSettings) {
  if (typeof window === "undefined") return normalizeSettings(settings);

  const normalized = normalizeSettings(settings);
  localStorage.setItem(storageKey(), JSON.stringify(normalized));
  emitPaymentMethodsChange();
  return normalized;
}

function updateCountrySettings(
  countryCode: string,
  update: (countrySettings: CountryPaymentMethodSettings) => void,
) {
  const code = normalizeCountryCode(countryCode);
  const settings = readSettings();
  const countrySettings: CountryPaymentMethodSettings = {
    ...settings.countries[code],
    disabledMethodIds: [...(settings.countries[code]?.disabledMethodIds ?? [])],
    customMethods: [...(settings.countries[code]?.customMethods ?? [])],
    activeMethodIds: [...(settings.countries[code]?.activeMethodIds ?? [])],
  };

  update(countrySettings);
  settings.countries[code] = countrySettings;
  writeSettings(settings);
}

function getCountrySettings(countryCode: string) {
  return readSettings().countries[normalizeCountryCode(countryCode)] ?? {};
}

function uniqueMethods(methods: PaymentMethodDefinition[]) {
  const seen = new Set<string>();
  const seenLabels = new Set<string>();
  return methods.filter((method) => {
    const labelKey = method.label.trim().toLowerCase();
    if (!method.id || seen.has(method.id) || seenLabels.has(labelKey))
      return false;
    seen.add(method.id);
    seenLabels.add(labelKey);
    return Boolean(method.label?.trim());
  });
}

function slugify(value: string) {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 36) || "metodo"
  );
}

function createCustomMethodId(countryCode: string, label: string) {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Date.now().toString(36);

  return `custom-${normalizeCountryCode(countryCode).toLowerCase()}-${slugify(label)}-${suffix}`;
}

export function subscribePaymentMethods(listener: () => void) {
  if (typeof window === "undefined") return () => undefined;

  const onStorage = (event: StorageEvent) => {
    if (event.key && event.key.startsWith(PAYMENT_METHOD_SETTINGS_KEY))
      listener();
  };

  window.addEventListener(PAYMENT_METHOD_SETTINGS_CHANGED_EVENT, listener);
  window.addEventListener("storage", onStorage);

  return () => {
    window.removeEventListener(PAYMENT_METHOD_SETTINGS_CHANGED_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function getPaymentMethodsSnapshot() {
  return getRawPaymentMethodSettings();
}

export function getCountryPaymentMethodCatalog(
  countryCode: string,
  options: { includeDisabled?: boolean } = {},
) {
  const code = normalizeCountryCode(countryCode);
  const countrySettings = getCountrySettings(code);
  const disabledMethodIds = new Set(countrySettings.disabledMethodIds ?? []);
  const catalog = uniqueMethods([
    ...getDefaultCountryPaymentMethods(code),
    ...(countrySettings.customMethods ?? []),
  ]);

  if (options.includeDisabled) return catalog;
  return catalog.filter((method) => !disabledMethodIds.has(method.id));
}

export function getPaymentMethodAdminCatalog(
  countryCode: string,
): PaymentMethodAdminItem[] {
  const code = normalizeCountryCode(countryCode);
  const countrySettings = getCountrySettings(code);
  const disabledMethodIds = new Set(countrySettings.disabledMethodIds ?? []);
  const defaultMethodIds = new Set(
    getDefaultCountryPaymentMethods(code).map((method) => method.id),
  );

  return getCountryPaymentMethodCatalog(code, { includeDisabled: true }).map(
    (method) => ({
      ...method,
      available: !disabledMethodIds.has(method.id),
      isDefault: defaultMethodIds.has(method.id),
      isCustom: !defaultMethodIds.has(method.id),
    }),
  );
}

export function getActivePaymentMethods(countryCode: string) {
  const code = normalizeCountryCode(countryCode);
  const catalog = getCountryPaymentMethodCatalog(code);
  const catalogById = new Map(catalog.map((method) => [method.id, method]));
  const savedActiveIds = (
    getCountrySettings(code).activeMethodIds ?? []
  ).filter((id) => catalogById.has(id));
  const activeIds = savedActiveIds.length
    ? savedActiveIds
    : catalog.filter((method) => method.recommended).map((method) => method.id);
  const activeMethods = uniqueMethods(
    activeIds.flatMap((id) => {
      const method = catalogById.get(id);
      return method ? [method] : [];
    }),
  );

  if (activeMethods.length) return activeMethods;
  return catalog.slice(0, 1);
}

export function setPaymentMethodAvailability(
  countryCode: string,
  methodId: string,
  available: boolean,
) {
  updateCountrySettings(countryCode, (countrySettings) => {
    const disabledMethodIds = new Set(countrySettings.disabledMethodIds ?? []);

    if (available) disabledMethodIds.delete(methodId);
    else disabledMethodIds.add(methodId);

    countrySettings.disabledMethodIds = Array.from(disabledMethodIds);
    if (!available) {
      countrySettings.activeMethodIds = (
        countrySettings.activeMethodIds ?? []
      ).filter((id) => id !== methodId);
    }
  });
}

export function setStorePaymentMethodActive(
  countryCode: string,
  methodId: string,
  active: boolean,
) {
  const code = normalizeCountryCode(countryCode);
  const availableCatalog = getCountryPaymentMethodCatalog(code);
  const availableIds = new Set(availableCatalog.map((method) => method.id));
  if (!availableIds.has(methodId)) return false;

  const nextActiveIds = new Set(
    getActivePaymentMethods(code).map((method) => method.id),
  );
  if (active) nextActiveIds.add(methodId);
  else nextActiveIds.delete(methodId);

  if (!nextActiveIds.size) return false;

  updateCountrySettings(code, (countrySettings) => {
    countrySettings.activeMethodIds = availableCatalog
      .filter((method) => nextActiveIds.has(method.id))
      .map((method) => method.id);
  });

  return true;
}

export function addCustomPaymentMethod(
  countryCode: string,
  label: string,
  kind: PaymentMethodKind = "other",
) {
  const code = normalizeCountryCode(countryCode);
  const cleanLabel = label.trim();
  if (!cleanLabel) throw new Error("Ingresa el nombre del método de pago.");

  const existingMethod = getCountryPaymentMethodCatalog(code, {
    includeDisabled: true,
  }).find((method) => method.label.toLowerCase() === cleanLabel.toLowerCase());
  if (existingMethod) {
    setPaymentMethodAvailability(code, existingMethod.id, true);
    setStorePaymentMethodActive(code, existingMethod.id, true);
    return existingMethod;
  }

  const method: PaymentMethodDefinition = {
    id: createCustomMethodId(code, cleanLabel),
    label: cleanLabel,
    kind,
    recommended: true,
  };

  const activeMethodIds = new Set(
    getActivePaymentMethods(code).map((item) => item.id),
  );
  activeMethodIds.add(method.id);

  updateCountrySettings(code, (countrySettings) => {
    countrySettings.customMethods = uniqueMethods([
      ...(countrySettings.customMethods ?? []),
      method,
    ]);
    countrySettings.activeMethodIds = Array.from(activeMethodIds);
  });

  return method;
}

export function resetPaymentMethodsForCountry(countryCode: string) {
  const code = normalizeCountryCode(countryCode);
  const settings = readSettings();
  delete settings.countries[code];
  writeSettings(settings);
}
