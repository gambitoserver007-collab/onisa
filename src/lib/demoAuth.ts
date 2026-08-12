import type { Session as SupabaseSession, User } from "@supabase/supabase-js";
import type { DemoSession, DocumentType, Role } from "@/types";
import {
  DEMO_ACCOUNTS,
  getDemoAccountByRole,
  isDemoEmail,
  normalizeEmail,
} from "@/data/demoCredentials";
import { getMarketByCountryCode } from "@/data/markets";
import { supabase } from "@/integrations/supabase/client";
import { syncBusinessSettingsWithSession } from "@/lib/businessSettings";
import type { Tables } from "@/integrations/supabase/types";

type CompanyRow = Tables<"companies">;
type ProfileRow = Tables<"profiles">;

const SESSION_CHANGED_EVENT = "onisa:session-changed";
const DEMO_MARKET_OVERRIDE_KEY = "onisa_demo_market_code";

export const DEMO_USERS = DEMO_ACCOUNTS;

type ProfileWithCompany = ProfileRow & {
  companies?: CompanyRow | CompanyRow[] | null;
};

export interface RegisterLocalAccountInput {
  company: string;
  email: string;
  password: string;
  countryCode: string;
}

export type RegisterLocalAccountResult =
  | { ok: true; session: DemoSession | null; needsEmailConfirmation: boolean }
  | {
      ok: false;
      error: "email-exists" | "invalid-input" | "auth-error" | "weak-password";
      message?: string;
    };

let cachedSession: DemoSession | null = null;
let cachedSessionSnapshot = "";
let authSubscriptionReady = false;
let initializePromise: Promise<DemoSession | null> | null = null;
let authSubscription: { unsubscribe: () => void } | null = null;
const listeners = new Set<() => void>();

function getCompany(profile?: ProfileWithCompany | null) {
  const relation = profile?.companies;
  if (Array.isArray(relation)) return relation[0] ?? null;
  return relation ?? null;
}

// Map the company's `document_types` jsonb ([{name, charges_iva}]) to typed list.
function parseDocumentTypes(raw: unknown): DocumentType[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const list = raw
    .filter(
      (entry): entry is Record<string, unknown> =>
        !!entry && typeof entry === "object",
    )
    .map((entry) => ({
      name: String(entry.name ?? "").trim(),
      chargesIva: Boolean(entry.charges_iva),
    }))
    .filter((entry) => entry.name.length > 0);
  return list.length ? list : undefined;
}

function createSessionFromUser(
  user: User,
  profile?: ProfileWithCompany | null,
): DemoSession {
  const company = getCompany(profile);
  const metadata = user.user_metadata ?? {};
  const market = getMarketByCountryCode(
    company?.country_code ?? (metadata.country_code as string | undefined),
  );
  const role = profile?.role ?? "user";
  const profileDemo = Boolean(
    profile?.is_demo || profile?.demo_mode === "read_only",
  );
  const demoFallback = isDemoEmail(user.email);
  // `undefined` when the column isn't in the DB yet (keeps current SaaS access).
  const isSuperAdmin =
    profile &&
    Object.prototype.hasOwnProperty.call(profile, "is_platform_admin")
      ? Boolean((profile as { is_platform_admin?: boolean }).is_platform_admin)
      : undefined;

  return {
    userId: user.id,
    companyId:
      profile?.company_id ??
      company?.id ??
      (metadata.company_id as string | undefined),
    locationId:
      (profile as { location_id?: string | null } | null)?.location_id ??
      undefined,
    email: normalizeEmail(profile?.email ?? user.email ?? ""),
    role,
    name:
      profile?.full_name ||
      (metadata.full_name as string | undefined) ||
      (metadata.company_name as string | undefined) ||
      user.email ||
      "Usuario",
    company: company?.name ?? (metadata.company_name as string | undefined),
    countryCode: market.countryCode,
    currencyCode: company?.currency_code ?? market.currencyCode,
    locale: company?.locale ?? market.locale,
    fiscalId: company?.fiscal_id ?? undefined,
    fiscalIdLabel: company?.fiscal_id_label ?? market.fiscalIdLabel,
    sampleFiscalId: company?.fiscal_id ?? market.sampleFiscalId,
    sampleAddress: company?.address ?? market.sampleAddress,
    phone: company?.phone ?? undefined,
    taxName: company?.tax_name ?? market.taxName,
    taxRate:
      typeof company?.tax_rate === "number" && Number.isFinite(company.tax_rate)
        ? company.tax_rate
        : market.taxRate,
    cardCommissionRate:
      typeof (company as { card_commission_rate?: number } | null)
        ?.card_commission_rate === "number"
        ? (company as { card_commission_rate?: number }).card_commission_rate
        : 0.03,
    loyaltyEnabled:
      (company as { loyalty_enabled?: boolean } | null)?.loyalty_enabled ??
      false,
    loyaltyPointValue:
      typeof (company as { loyalty_point_value?: number } | null)
        ?.loyalty_point_value === "number"
        ? (company as { loyalty_point_value?: number }).loyalty_point_value
        : 0,
    loyaltyEarnRate:
      typeof (company as { loyalty_earn_rate?: number } | null)
        ?.loyalty_earn_rate === "number"
        ? (company as { loyalty_earn_rate?: number }).loyalty_earn_rate
        : 0,
    lowStockThresholdDefault:
      typeof (company as { low_stock_threshold_default?: number } | null)
        ?.low_stock_threshold_default === "number"
        ? (company as { low_stock_threshold_default?: number })
            .low_stock_threshold_default
        : 10,
    isDemo: profileDemo || demoFallback,
    demoMode: profile?.demo_mode ?? (demoFallback ? "read_only" : "none"),
    demoAccountId: Object.values(DEMO_ACCOUNTS).find(
      (account) => account.email === user.email,
    )?.id,
    isSuperAdmin,
    logoUrl:
      (company as { logo_url?: string | null } | null)?.logo_url ?? undefined,
    documentTypes: parseDocumentTypes(
      (company as { document_types?: unknown } | null)?.document_types,
    ),
    businessType:
      (company as { business_type?: string | null } | null)?.business_type ??
      undefined,
  };
}

function getDemoMarketOverride() {
  if (typeof window === "undefined") return null;

  try {
    return localStorage.getItem(DEMO_MARKET_OVERRIDE_KEY);
  } catch {
    return null;
  }
}

function saveDemoMarketOverride(countryCode: string) {
  if (typeof window === "undefined") return;

  try {
    localStorage.setItem(DEMO_MARKET_OVERRIDE_KEY, countryCode);
  } catch {
    // Ignore storage errors; the selected country still applies to the current login.
  }
}

function applyDemoMarketOverride(
  session: DemoSession,
  countryCode?: string | null,
): DemoSession {
  if (!session.isDemo) return session;

  const market = getMarketByCountryCode(
    countryCode ?? getDemoMarketOverride() ?? session.countryCode,
  );

  return {
    ...session,
    countryCode: market.countryCode,
    currencyCode: market.currencyCode,
    locale: market.locale,
    fiscalIdLabel: market.fiscalIdLabel,
    sampleFiscalId: market.sampleFiscalId,
    sampleAddress: market.sampleAddress,
    taxName: market.taxName,
    taxRate: market.taxRate,
  };
}

const PROFILE_SELECT_BASE =
  "id, company_id, location_id, email, full_name, role, is_demo, demo_mode, is_active, created_at, updated_at, companies(*)";
const PROFILE_SELECT_FULL =
  "id, company_id, location_id, email, full_name, role, is_demo, demo_mode, is_active, is_platform_admin, created_at, updated_at, companies(*)";

async function loadProfile(user: User) {
  // Prefer the full select (with the platform-admin flag); if that column does
  // not exist yet, fall back to the base select so login never breaks.
  let select = PROFILE_SELECT_FULL;
  for (let attempt = 0; attempt < 3; attempt++) {
    const { data, error } = await supabase
      .from("profiles")
      .select(select)
      .eq("id", user.id)
      .maybeSingle();

    if (error) {
      if (select === PROFILE_SELECT_FULL) {
        select = PROFILE_SELECT_BASE;
        attempt--; // retry immediately without consuming a propagation attempt
        continue;
      }
      console.warn(
        "[Supabase] No se pudo cargar profiles/companies.",
        error.message,
      );
      return null;
    }

    if (data) return data as unknown as ProfileWithCompany;
    if (attempt < 2)
      await new Promise((resolve) => globalThis.setTimeout(resolve, 250));
  }

  return null;
}

function notifySessionChange() {
  for (const listener of listeners) listener();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(SESSION_CHANGED_EVENT));
  }
}

function setCachedSession(session: DemoSession | null) {
  const nextSnapshot = session ? JSON.stringify(session) : "";
  if (nextSnapshot === cachedSessionSnapshot) return;

  cachedSession = session;
  cachedSessionSnapshot = nextSnapshot;
  if (session) syncBusinessSettingsWithSession(session);
  notifySessionChange();
}

async function setSessionFromAuth(authSession: SupabaseSession | null) {
  if (!authSession?.user) {
    setCachedSession(null);
    return null;
  }

  const profile = await loadProfile(authSession.user);

  // Empleado desactivado por el dueño (o de una empresa eliminada): aunque siga
  // existiendo en Supabase Auth, no debe poder operar. Cerramos la sesión.
  // (profile null = alta recién creada cuyo trigger aún no corre → no bloquear.)
  if (profile && profile.is_active === false) {
    await supabase.auth.signOut();
    setCachedSession(null);
    return null;
  }

  const session = applyDemoMarketOverride(
    createSessionFromUser(authSession.user, profile),
  );
  setCachedSession(session);
  return session;
}

function ensureAuthSubscription() {
  if (authSubscriptionReady || typeof window === "undefined") return;
  authSubscriptionReady = true;

  const { data } = supabase.auth.onAuthStateChange((_event, authSession) => {
    window.setTimeout(() => {
      void setSessionFromAuth(authSession);
    }, 0);
  });

  authSubscription = data.subscription;
}

export async function initializeSession() {
  ensureAuthSubscription();
  if (initializePromise) return initializePromise;

  initializePromise = supabase.auth
    .getSession()
    .then(({ data }) => setSessionFromAuth(data.session))
    .catch((error) => {
      console.warn("[Supabase] No se pudo inicializar la sesión.", error);
      setCachedSession(null);
      return null;
    })
    .finally(() => {
      initializePromise = null;
    });

  return initializePromise;
}

export function subscribeSession(listener: () => void) {
  ensureAuthSubscription();
  listeners.add(listener);

  const onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith("sb-")) void initializeSession();
  };

  if (typeof window !== "undefined")
    window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    if (typeof window !== "undefined")
      window.removeEventListener("storage", onStorage);

    if (listeners.size === 0 && authSubscription) {
      authSubscription.unsubscribe();
      authSubscription = null;
      authSubscriptionReady = false;
    }
  };
}

export async function login(
  email: string,
  password: string,
): Promise<DemoSession | null> {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: normalizeEmail(email),
    password,
  });

  if (error || !data.session) {
    if (error) console.warn("[Supabase] Login rechazado.", error.message);
    return null;
  }

  return setSessionFromAuth(data.session);
}

export async function loginAs(
  role: Role,
  countryCode?: string,
): Promise<DemoSession> {
  const account = getDemoAccountByRole(role);
  if (countryCode) saveDemoMarketOverride(countryCode);

  const session = await login(account.email, account.password);
  if (!session)
    throw new Error("No se pudo iniciar la cuenta de prueba en Supabase Auth.");

  const demoSession = applyDemoMarketOverride(session, countryCode);
  setCachedSession(demoSession);
  return demoSession;
}

export function getSession(): DemoSession | null {
  return cachedSession;
}

export async function registerLocalAccount({
  company,
  email,
  password,
  countryCode,
}: RegisterLocalAccountInput): Promise<RegisterLocalAccountResult> {
  const normalizedEmail = normalizeEmail(email);
  const normalizedCompany = company.trim();
  const normalizedPassword = password.trim();
  const market = getMarketByCountryCode(countryCode);

  if (!normalizedEmail || !normalizedCompany || normalizedPassword.length < 6) {
    return { ok: false, error: "invalid-input" };
  }

  const { data, error } = await supabase.auth.signUp({
    email: normalizedEmail,
    password: normalizedPassword,
    options: {
      data: {
        full_name: normalizedCompany,
        company_name: normalizedCompany,
        country_code: market.countryCode,
        currency_code: market.currencyCode,
        locale: market.locale,
        fiscal_id_label: market.fiscalIdLabel,
        tax_name: market.taxName,
        tax_rate: market.taxRate,
      },
    },
  });

  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes("already") || message.includes("registered")) {
      return { ok: false, error: "email-exists", message: error.message };
    }

    if (
      message.includes("weak") ||
      message.includes("pwned") ||
      message.includes("leaked") ||
      message.includes("easy to guess")
    ) {
      return { ok: false, error: "weak-password", message: error.message };
    }

    return { ok: false, error: "auth-error", message: error.message };
  }

  if (!data.session) {
    return { ok: true, session: null, needsEmailConfirmation: true };
  }

  const session = await setSessionFromAuth(data.session);
  return { ok: true, session, needsEmailConfirmation: false };
}

export async function logout() {
  await supabase.auth.signOut();
  setCachedSession(null);
}
