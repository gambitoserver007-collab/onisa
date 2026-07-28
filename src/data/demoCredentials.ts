import type { Role } from "@/types";

// Demo accounts shown on the login page. Only the read-only Super Admin demo is
// exposed publicly. Values can be overridden with the VITE_DEMO_SUPERADMIN_* env vars.
export type DemoAccountId = "superadmin";

export interface DemoAccount {
  id: DemoAccountId;
  label: string;
  email: string;
  password: string;
  role: Role;
  name: string;
  company?: string;
  countryCode: string;
  defaultPath: "/dashboard" | "/admin";
}

function readDemoValue(envKey: string, fallbackValue: string) {
  const configuredValue = import.meta.env[envKey] as string | undefined;
  return configuredValue?.trim() || fallbackValue;
}

export const DEMO_ACCOUNTS: Record<DemoAccountId, DemoAccount> = {
  superadmin: {
    id: "superadmin",
    label: "Super Admin Demo",
    email: readDemoValue("VITE_DEMO_SUPERADMIN_EMAIL", "superadmin@demo.test"),
    password: readDemoValue("VITE_DEMO_SUPERADMIN_PASSWORD", "Demo1234"),
    role: "admin",
    name: "Super Admin Demo",
    company: "Tienda Demo",
    countryCode: "PE",
    defaultPath: "/admin",
  },
};

export const STANDARD_DEMO_CREDENTIALS = Object.values(DEMO_ACCOUNTS);

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function findDemoAccountByCredentials(email: string, password: string) {
  const normalizedEmail = normalizeEmail(email);
  return STANDARD_DEMO_CREDENTIALS.find(
    (account) => account.email === normalizedEmail && account.password === password,
  );
}

export function getDemoAccount() {
  return DEMO_ACCOUNTS.superadmin;
}

// Only one public demo account; any role maps to the Super Admin read-only demo.
export function getDemoAccountByRole(_role?: Role) {
  return DEMO_ACCOUNTS.superadmin;
}

export function isDemoEmail(email?: string | null) {
  if (!email) return false;
  const normalizedEmail = normalizeEmail(email);
  return STANDARD_DEMO_CREDENTIALS.some((account) => account.email === normalizedEmail);
}
