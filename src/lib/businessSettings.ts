import {
  DEFAULT_BUSINESS_NAME,
  getCurrencyLabel,
  getMarketByCountryCode,
  type Market,
} from "@/data/markets";
import type { DemoSession } from "@/types";

const BUSINESS_SETTINGS_KEY = "onisa_business_settings";
const BUSINESS_SETTINGS_CHANGED_EVENT = "onisa:business-settings-changed";

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
  /** % de comisión de pago con tarjeta (fracción, ej. 0.03 = 3%). */
  cardCommissionRate: number;
  /** Si el programa de puntos de lealtad está activo. */
  loyaltyEnabled: boolean;
  /** Cuánto vale 1 punto en la moneda de la empresa. */
  loyaltyPointValue: number;
  /** Cuánto gasto equivale a 1 punto ganado. */
  loyaltyEarnRate: number;
  /** Niveles de fidelidad (Bronce/Plata/Oro) opcionales -- apagado por
   * defecto; mientras esté apagado, loyaltyEarnRate se usa tal cual. */
  loyaltyTiersEnabled: boolean;
  /** Gasto acumulado en el año para pasar a Plata. */
  loyaltyTier2MinSpend: number;
  /** Gasto acumulado en el año para pasar a Oro. */
  loyaltyTier3MinSpend: number;
  /** $ gastados = 1 punto ganado en Bronce. */
  loyaltyTier1EarnRate: number;
  /** $ gastados = 1 punto ganado en Plata. */
  loyaltyTier2EarnRate: number;
  /** $ gastados = 1 punto ganado en Oro. */
  loyaltyTier3EarnRate: number;
  /** % mínimo de anticipo exigido para crear un apartado (fracción, ej. 0.2 = 20%). */
  apartadoMinDepositPct: number;
  /** Umbral de stock bajo por defecto (unidades) para productos sin uno propio. */
  lowStockThresholdDefault: number;
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
    // No depende del país (es una configuración propia de cada empresa) --
    // mismo valor por defecto que la columna companies.card_commission_rate.
    cardCommissionRate: 0.03,
    // Apagado por defecto, igual que companies.loyalty_enabled.
    loyaltyEnabled: false,
    loyaltyPointValue: 0,
    loyaltyEarnRate: 0,
    // Apagado por defecto, igual que companies.loyalty_tiers_enabled --
    // mismos valores por defecto que las columnas correspondientes.
    loyaltyTiersEnabled: false,
    loyaltyTier2MinSpend: 1500,
    loyaltyTier3MinSpend: 5000,
    loyaltyTier1EarnRate: 65,
    loyaltyTier2EarnRate: 50,
    loyaltyTier3EarnRate: 33,
    // Mismo valor por defecto que companies.apartado_min_deposit_pct.
    apartadoMinDepositPct: 0.2,
    // Mismo valor por defecto que companies.low_stock_threshold_default.
    lowStockThresholdDefault: 10,
    currencyLabel: getCurrencyLabel(market),
  };
}

export function getDefaultBusinessSettings() {
  cachedDefaultSettings ??= createBusinessSettingsFromMarket(
    getMarketByCountryCode(),
  );
  return cachedDefaultSettings;
}

function normalizeBusinessSettings(
  settings?: Partial<BusinessSettings> | null,
) {
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
    cardCommissionRate:
      typeof settings?.cardCommissionRate === "number" &&
      Number.isFinite(settings.cardCommissionRate)
        ? settings.cardCommissionRate
        : base.cardCommissionRate,
    loyaltyEnabled:
      typeof settings?.loyaltyEnabled === "boolean"
        ? settings.loyaltyEnabled
        : base.loyaltyEnabled,
    loyaltyPointValue:
      typeof settings?.loyaltyPointValue === "number" &&
      Number.isFinite(settings.loyaltyPointValue)
        ? settings.loyaltyPointValue
        : base.loyaltyPointValue,
    loyaltyEarnRate:
      typeof settings?.loyaltyEarnRate === "number" &&
      Number.isFinite(settings.loyaltyEarnRate)
        ? settings.loyaltyEarnRate
        : base.loyaltyEarnRate,
    loyaltyTiersEnabled:
      typeof settings?.loyaltyTiersEnabled === "boolean"
        ? settings.loyaltyTiersEnabled
        : base.loyaltyTiersEnabled,
    loyaltyTier2MinSpend:
      typeof settings?.loyaltyTier2MinSpend === "number" &&
      Number.isFinite(settings.loyaltyTier2MinSpend)
        ? settings.loyaltyTier2MinSpend
        : base.loyaltyTier2MinSpend,
    loyaltyTier3MinSpend:
      typeof settings?.loyaltyTier3MinSpend === "number" &&
      Number.isFinite(settings.loyaltyTier3MinSpend)
        ? settings.loyaltyTier3MinSpend
        : base.loyaltyTier3MinSpend,
    loyaltyTier1EarnRate:
      typeof settings?.loyaltyTier1EarnRate === "number" &&
      Number.isFinite(settings.loyaltyTier1EarnRate)
        ? settings.loyaltyTier1EarnRate
        : base.loyaltyTier1EarnRate,
    loyaltyTier2EarnRate:
      typeof settings?.loyaltyTier2EarnRate === "number" &&
      Number.isFinite(settings.loyaltyTier2EarnRate)
        ? settings.loyaltyTier2EarnRate
        : base.loyaltyTier2EarnRate,
    loyaltyTier3EarnRate:
      typeof settings?.loyaltyTier3EarnRate === "number" &&
      Number.isFinite(settings.loyaltyTier3EarnRate)
        ? settings.loyaltyTier3EarnRate
        : base.loyaltyTier3EarnRate,
    apartadoMinDepositPct:
      typeof settings?.apartadoMinDepositPct === "number" &&
      Number.isFinite(settings.apartadoMinDepositPct)
        ? settings.apartadoMinDepositPct
        : base.apartadoMinDepositPct,
    lowStockThresholdDefault:
      typeof settings?.lowStockThresholdDefault === "number" &&
      Number.isFinite(settings.lowStockThresholdDefault)
        ? settings.lowStockThresholdDefault
        : base.lowStockThresholdDefault,
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
    cardCommissionRate: session.cardCommissionRate,
    loyaltyEnabled: session.loyaltyEnabled,
    loyaltyPointValue: session.loyaltyPointValue,
    loyaltyEarnRate: session.loyaltyEarnRate,
    loyaltyTiersEnabled: session.loyaltyTiersEnabled,
    loyaltyTier2MinSpend: session.loyaltyTier2MinSpend,
    loyaltyTier3MinSpend: session.loyaltyTier3MinSpend,
    loyaltyTier1EarnRate: session.loyaltyTier1EarnRate,
    loyaltyTier2EarnRate: session.loyaltyTier2EarnRate,
    loyaltyTier3EarnRate: session.loyaltyTier3EarnRate,
    apartadoMinDepositPct: session.apartadoMinDepositPct,
    lowStockThresholdDefault: session.lowStockThresholdDefault,
    logoUrl: session.logoUrl,
    businessType: session.businessType,
  });
}
