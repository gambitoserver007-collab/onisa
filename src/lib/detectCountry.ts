import { DEFAULT_MARKET_CODE, SUPPORTED_MARKETS } from "@/data/markets";

/**
 * Offline country detection (no external API, privacy-friendly).
 *
 * Primary signal is the device timezone (geographic), with the browser
 * language/region as a fallback. Only ever resolves to a supported market,
 * otherwise it returns the default. Safe to call during SSR (returns default).
 */

const SUPPORTED = new Set(SUPPORTED_MARKETS.map((market) => market.countryCode));

// IANA timezone → ISO country code, limited to the markets we support.
const TZ_TO_COUNTRY: Record<string, string> = {
  // Sudamérica
  "America/La_Paz": "BO",
  "America/Sao_Paulo": "BR",
  "America/Bahia": "BR",
  "America/Fortaleza": "BR",
  "America/Recife": "BR",
  "America/Manaus": "BR",
  "America/Belem": "BR",
  "America/Cuiaba": "BR",
  "America/Campo_Grande": "BR",
  "America/Porto_Velho": "BR",
  "America/Boa_Vista": "BR",
  "America/Rio_Branco": "BR",
  "America/Maceio": "BR",
  "America/Araguaina": "BR",
  "America/Santarem": "BR",
  "America/Noronha": "BR",
  "America/Santiago": "CL",
  "America/Punta_Arenas": "CL",
  "Pacific/Easter": "CL",
  "America/Bogota": "CO",
  "America/Guayaquil": "EC",
  "Pacific/Galapagos": "EC",
  "America/Guyana": "GY",
  "America/Asuncion": "PY",
  "America/Lima": "PE",
  "America/Paramaribo": "SR",
  "America/Montevideo": "UY",
  "America/Caracas": "VE",
  // Centroamérica y México
  "America/Belize": "BZ",
  "America/Costa_Rica": "CR",
  "America/El_Salvador": "SV",
  "America/Guatemala": "GT",
  "America/Tegucigalpa": "HN",
  "America/Mexico_City": "MX",
  "America/Cancun": "MX",
  "America/Merida": "MX",
  "America/Monterrey": "MX",
  "America/Matamoros": "MX",
  "America/Chihuahua": "MX",
  "America/Ciudad_Juarez": "MX",
  "America/Ojinaga": "MX",
  "America/Hermosillo": "MX",
  "America/Mazatlan": "MX",
  "America/Bahia_Banderas": "MX",
  "America/Tijuana": "MX",
  "America/Managua": "NI",
  "America/Panama": "PA",
  // Caribe
  "America/Antigua": "AG",
  "America/Nassau": "BS",
  "America/Barbados": "BB",
  "America/Havana": "CU",
  "America/Dominica": "DM",
  "America/Grenada": "GD",
  "America/Port-au-Prince": "HT",
  "America/Jamaica": "JM",
  "America/Puerto_Rico": "PR",
  "America/Santo_Domingo": "DO",
  "America/St_Kitts": "KN",
  "America/St_Vincent": "VC",
  "America/St_Lucia": "LC",
  "America/Port_of_Spain": "TT",
  // Hispanohablantes fuera de América
  "Africa/Malabo": "GQ",
};

function regionFromLocale(locale: string): string | null {
  try {
    const region = new Intl.Locale(locale).region;
    return region && region.length === 2 ? region.toUpperCase() : null;
  } catch {
    return null;
  }
}

export function detectCountryCode(): string {
  if (typeof window === "undefined") return DEFAULT_MARKET_CODE;

  // 1) Geographic signal — device timezone.
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz) {
      if (tz.startsWith("America/Argentina/") && SUPPORTED.has("AR")) return "AR";
      const byTz = TZ_TO_COUNTRY[tz];
      if (byTz && SUPPORTED.has(byTz)) return byTz;
    }
  } catch {
    /* ignore */
  }

  // 2) Fallback — browser language/region preference.
  try {
    const langs =
      navigator.languages && navigator.languages.length
        ? navigator.languages
        : [navigator.language];
    for (const lang of langs) {
      const region = regionFromLocale(lang);
      if (region && SUPPORTED.has(region)) return region;
    }
  } catch {
    /* ignore */
  }

  return DEFAULT_MARKET_CODE;
}
