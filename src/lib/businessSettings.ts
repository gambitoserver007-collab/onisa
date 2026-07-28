import {
  DEFAULT_BUSINESS_NAME,
  getCurrencyLabel,
  getMarketByCountryCode,
  type Market,
} from "@/data/markets";
import type { DemoSession } from "@/types";

const BUSINESS_SETTINGS_KEY = "tienda_agil_business_settings";
const BUSINESS_SETTINGS_CHANGED_EVENT = "tienda-agil:business-settings-changed";

export interface BusinessSettings {
  businessName: string;
  countryCode: string;
  countryName: string;
  currencyCode: string;
  currencyName: string;
  locale: string;
  fiscalIdLabel: string;
  sampleFiscalId: string;
  sampleAddress: string;
  taxName: string;
  taxRate: number;
  currencyLabel: string;
  /** Optional store logo (data URL or image URL). */
  logoUrl?: string;
  /** Rubro/perfil de la empresa (controla capacidades como variantes). */
  businessType?: string;
}

let cachedRawSettings: string | null | undefined;
let cachedSettings: BusinessSettings | null = null;
let cachedDefaultSettings: BusinessSettings | null = null;

export function createBusinessSettingsFromMarket(
  market: Market,
  businessName = DEFAULT_BUSINESS_NAME,
): BusinessSettings {
  return {
    businessName,
    countryCode: market.countryCode,
    countryName: market.countryName,
    currencyCode: market.currencyCode,
    currencyName: market.currencyName,
    locale: market.locale,
    fiscalIdLabel: market.fiscalIdLabel,
    sampleFiscalId: market.sampleFiscalId,
    sampleAddress: market.sampleAddress,
    taxName: market.taxName,
    taxRate: market.taxRate,
    currencyLabel: getCurrencyLabel(market),
  };
}

export function getDefaultBusinessSettings() {
  cachedDefaultSettings ??= createBusinessSettingsFromMarket(getMarketByCountryCode());
  return cachedDefaultSettings;
}

function normalizeBusinessSettings(settings?: Partial<BusinessSettings> | null) {
  const market = getMarketByCountryCode(settings?.countryCode);
  const base = createBusinessSettingsFromMarket(
    market,
    settings?.businessName?.trim() || DEFAULT_BUSINESS_NAME,
  );

  return {
    ...base,
    currencyCode: settings?.currencyCode || base.currencyCode,
    currencyName: settings?.currencyName || base.currencyName,
    locale: settings?.locale || base.locale,
    fiscalIdLabel: settings?.fiscalIdLabel?.trim() || base.fiscalIdLabel,
    sampleFiscalId: settings?.sampleFiscalId?.trim() || base.sampleFiscalId,
    sampleAddress: settings?.sampleAddress?.trim() || base.sampleAddress,
    taxName: settings?.taxName?.trim() || base.taxName,
    taxRate:
      typeof settings?.taxRate === "number" && Number.isFinite(settings.taxRate)
        ? settings.taxRate
        : base.taxRate,
    currencyLabel:
      settings?.currencyLabel ||
      getCurrencyLabel({
        ...market,
        currencyCode: settings?.currencyCode || market.currencyCode,
        currencyName: settings?.currencyName || market.currencyName,
      }),
    logoUrl: settings?.logoUrl || undefined,
    businessType: settings?.businessType || undefined,
  };
}

function emitBusinessSettingsChange() {
  cachedRawSettings = undefined;
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(BUSINESS_SETTINGS_CHANGED_EVENT));
}

export function subscribeBusinessSettings(listener: () => void) {
  if (typeof window === "undefined") return () => undefined;

  const onStorage = (event: StorageEvent) => {
    if (event.key === BUSINESS_SETTINGS_KEY) listener();
  };

  window.addEventListener(BUSINESS_SETTINGS_CHANGED_EVENT, listener);
  window.addEventListener("storage", onStorage);

  return () => {
    window.removeEventListener(BUSINESS_SETTINGS_CHANGED_EVENT, listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function getBusinessSettings(): BusinessSettings {
  if (typeof window === "undefined") return getDefaultBusinessSettings();

  try {
    const raw = localStorage.getItem(BUSINESS_SETTINGS_KEY);
    if (raw === cachedRawSettings && cachedSettings) return cachedSettings;

    cachedRawSettings = raw;
    cachedSettings = raw
      ? normalizeBusinessSettings(JSON.parse(raw) as Partial<BusinessSettings>)
      : getDefaultBusinessSettings();

    return cachedSettings;
  } catch {
    return getDefaultBusinessSettings();
  }
}

export function saveBusinessSettings(settings: Partial<BusinessSettings>) {
  if (typeof window === "undefined") return getDefaultBusinessSettings();

  const nextSettings = normalizeBusinessSettings({
    ...getBusinessSettings(),
    ...settings,
  });

  localStorage.setItem(BUSINESS_SETTINGS_KEY, JSON.stringify(nextSettings));
  emitBusinessSettingsChange();
  return nextSettings;
}

export function setBusinessCountry(countryCode: string) {
  const current = getBusinessSettings();
  return saveBusinessSettings({
    businessName: current.businessName,
    countryCode,
  });
}

export function setBusinessName(businessName: string) {
  return saveBusinessSettings({ businessName });
}

export function syncBusinessSettingsWithSession(session: DemoSession) {
  return saveBusinessSettings({
    businessName: session.company || DEFAULT_BUSINESS_NAME,
    countryCode: session.countryCode,
    currencyCode: session.currencyCode,
    locale: session.locale,
    fiscalIdLabel: session.fiscalIdLabel,
    sampleFiscalId: session.sampleFiscalId || session.fiscalId,
    sampleAddress: session.sampleAddress,
    taxName: session.taxName,
    taxRate: session.taxRate,
    logoUrl: session.logoUrl,
    businessType: session.businessType,
  });
}
