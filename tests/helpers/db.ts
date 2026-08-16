// Arma un Postgres real (PGlite, compilado a WASM) con el esquema completo del
// proyecto (supabase/install/01_install.sql), para poder probar los RPC
// críticos de dinero/stock exactamente como corren en producción -- RLS,
// triggers, SECURITY DEFINER y todo -- sin necesitar Docker ni un Supabase
// real. Se usa como base de las pruebas en critical-rpcs.test.ts.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INSTALL_SQL_PATH = path.join(
  __dirname,
  "../../supabase/install/01_install.sql",
);

const AUTH_BOOTSTRAP_SQL = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;
  create schema if not exists auth;
  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  );
  create or replace function auth.uid() returns uuid
  language sql stable as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;
  grant usage on schema auth to anon, authenticated, service_role;
  grant select on auth.users to anon, authenticated, service_role;
  grant execute on function auth.uid() to anon, authenticated, service_role, public;
`;

/**
 * Crea una base de datos nueva con el esquema completo instalado.
 * Cada llamada es independiente (PGlite en memoria) -- no comparte estado
 * entre pruebas.
 */
export async function createTestDb(): Promise<PGlite> {
  // pgcrypto se carga como extension real de PGlite (necesario para
  // crypt()/gen_salt(), usados por pin_hash de empleados) -- a diferencia de
  // gen_random_uuid(), que ya es nativo del core desde PG13 y no lo necesita.
  const db = new PGlite({ extensions: { pgcrypto } });
  await db.exec(AUTH_BOOTSTRAP_SQL);

  const sql = readFileSync(INSTALL_SQL_PATH, "utf-8");
  await db.exec(sql);
  return db;
}

/** Ejecuta `fn` como si la sesión fuera la del usuario `userId` (rol
 * `authenticated`, con `auth.uid()` resuelto vía el mismo mecanismo que usa
 * Supabase real a través del JWT). Restaura el rol de superusuario al salir,
 * incluso si `fn` lanza.
 *
 * `set_config(..., false)` deja el valor a nivel de sesión (no de
 * transacción), y PGlite reutiliza la misma sesión entre llamadas -- así que
 * hay que limpiar el claim explícitamente al salir, o `auth.uid()` seguiría
 * resolviendo al último usuario incluso después de `reset role`. */
export async function asUser<T>(
  db: PGlite,
  userId: string,
  fn: () => Promise<T>,
): Promise<T> {
  await db.exec(`set role authenticated;`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false);", [
    userId,
  ]);
  try {
    return await fn();
  } finally {
    await db.exec(`reset role;`);
    await db.exec("select set_config('request.jwt.claim.sub', '', false);");
  }
}

export interface TestCompany {
  id: string;
  loc1: string;
  loc2: string;
}

export async function makeCompany(
  db: PGlite,
  name: string,
  opts: { status?: string; planId?: string | null } = {},
): Promise<TestCompany> {
  const id = randomUUID();
  await db.query(
    `insert into public.companies
       (id, name, country_code, currency_code, locale, fiscal_id_label, tax_name, tax_rate, subscription_status, plan_id)
     values ($1,$2,'MX','MXN','es-MX','RFC','IVA',0.16,$3,$4)`,
    [id, name, opts.status ?? "active", opts.planId ?? null],
  );
  const { rows } = await db.query<{ id: string }>(
    "select id from public.locations where company_id=$1 limit 1",
    [id],
  );
  const loc1 = rows[0].id;
  const loc2 = randomUUID();
  await db.query(
    "insert into public.locations (id, company_id, name) values ($1,$2,'Sucursal 2')",
    [loc2, id],
  );
  return { id, loc1, loc2 };
}

export async function makeUser(
  db: PGlite,
  companyId: string,
  role: string,
  isPlatformAdmin = false,
): Promise<string> {
  const id = randomUUID();
  const email = `${role}-${id.slice(0, 8)}@test.local`;
  // Pasamos company_id en los metadatos para que el trigger handle_new_user
  // trate esto como "usuario nuevo de una empresa existente" en lugar de
  // crear una empresa fantasma (su rama por defecto cuando no hay company_id).
  await db.query(
    "insert into auth.users (id, email, raw_user_meta_data) values ($1,$2,$3)",
    [id, email, JSON.stringify({ company_id: companyId })],
  );
  await db.query(
    `insert into public.profiles (id, company_id, email, full_name, role, is_platform_admin, is_demo, demo_mode)
     values ($1,$2,$3,$4,$5,$6,false,'none')
     on conflict (id) do update set company_id=excluded.company_id, role=excluded.role,
       is_platform_admin=excluded.is_platform_admin`,
    [id, companyId, email, role, role, isPlatformAdmin],
  );
  return id;
}

export async function makeProduct(
  db: PGlite,
  companyId: string,
  locationId: string,
  name: string,
  cost: number,
  price: number,
  stock: number,
): Promise<string> {
  const id = randomUUID();
  await db.query(
    "insert into public.products (id, company_id, name, cost, price, stock, unit) values ($1,$2,$3,$4,$5,$6,'und')",
    [id, companyId, name, cost, price, stock],
  );
  await db.query(
    "insert into public.product_locations (company_id, product_id, location_id, stock, is_active) values ($1,$2,$3,$4,true)",
    [companyId, id, locationId, stock],
  );
  return id;
}

export async function makePlan(
  db: PGlite,
  name: string,
  productLimit: number,
  userLimit: number,
  salesLimit: number,
): Promise<string> {
  const id = randomUUID();
  await db.query(
    `insert into public.subscription_plans (id, name, price, product_limit, user_limit, monthly_sales_limit)
     values ($1,$2,10,$3,$4,$5)`,
    [id, name, productLimit, userLimit, salesLimit],
  );
  return id;
}

export interface CartLine {
  product_id: string;
  qty: number;
  unit_price: number;
}

export interface SalePaymentLine {
  method: string;
  amount: number;
  kind?: string;
}

export async function createSale(
  db: PGlite,
  items: CartLine[],
  locationId: string,
  clientRequestId?: string,
  opts: {
    customerId?: string | null;
    pointsRedeemed?: number;
    payments?: SalePaymentLine[] | null;
    paymentMethod?: string;
    paymentKind?: string;
  } = {},
): Promise<{
  sale_id: string;
  subtotal: number;
  tax: number;
  total: number;
  discount_total: number;
  promo_discount: number;
  points_earned: number;
  points_redeemed: number;
}> {
  const { rows } = await db.query<{ create_sale: unknown }>(
    "select create_sale($1, 'Ticket', $2, $3::jsonb, $4, $5, null, $6, $7::jsonb, $8) as create_sale",
    [
      opts.customerId ?? null,
      opts.paymentMethod ?? "Efectivo",
      JSON.stringify(items),
      locationId,
      clientRequestId ?? null,
      opts.pointsRedeemed ?? 0,
      opts.payments ? JSON.stringify(opts.payments) : null,
      opts.paymentKind ?? null,
    ],
  );
  return rows[0].create_sale as {
    sale_id: string;
    subtotal: number;
    tax: number;
    total: number;
    discount_total: number;
    promo_discount: number;
    points_earned: number;
    points_redeemed: number;
  };
}

export async function makeCustomer(
  db: PGlite,
  companyId: string,
  name: string,
  loyaltyPoints = 0,
): Promise<string> {
  const id = randomUUID();
  await db.query(
    "insert into public.customers (id, company_id, name, loyalty_points) values ($1,$2,$3,$4)",
    [id, companyId, name, loyaltyPoints],
  );
  return id;
}

export async function setLoyaltySettings(
  db: PGlite,
  companyId: string,
  opts: { enabled: boolean; pointValue: number; earnRate: number },
): Promise<void> {
  await db.query(
    `update public.companies
       set loyalty_enabled = $2, loyalty_point_value = $3, loyalty_earn_rate = $4
     where id = $1`,
    [companyId, opts.enabled, opts.pointValue, opts.earnRate],
  );
}

export async function getCustomerLoyaltyPoints(
  db: PGlite,
  customerId: string,
): Promise<number> {
  const { rows } = await db.query<{ loyalty_points: string }>(
    "select loyalty_points from public.customers where id = $1",
    [customerId],
  );
  return Number(rows[0].loyalty_points);
}

export async function submitTillCount(
  db: PGlite,
  sessionId: string,
  denominations: { denomination: number; quantity: number }[],
  manualAdjustment = 0,
): Promise<{
  count_id: string;
  count_number: number;
  counted_cash_total: number;
  card_total: number;
  transfer_total: number;
  other_total: number;
  manual_adjustment: number;
}> {
  const { rows } = await db.query<{ submit_till_count: unknown }>(
    "select submit_till_count($1, $2::jsonb, $3) as submit_till_count",
    [sessionId, JSON.stringify(denominations), manualAdjustment],
  );
  return rows[0].submit_till_count as {
    count_id: string;
    count_number: number;
    counted_cash_total: number;
    card_total: number;
    transfer_total: number;
    other_total: number;
    manual_adjustment: number;
  };
}

export async function finishTillCount(
  db: PGlite,
  sessionId: string,
): Promise<{
  session_id: string;
  status: string;
  second_count_required: boolean;
}> {
  const { rows } = await db.query<{ finish_till_count: unknown }>(
    "select finish_till_count($1) as finish_till_count",
    [sessionId],
  );
  return rows[0].finish_till_count as {
    session_id: string;
    status: string;
    second_count_required: boolean;
  };
}

export async function authorizeCashSession(
  db: PGlite,
  sessionId: string,
  notes?: string,
): Promise<{
  session_id: string;
  expected_amount: number;
  real_amount: number;
  difference: number;
  classification: string;
}> {
  const { rows } = await db.query<{ authorize_cash_session: unknown }>(
    "select authorize_cash_session($1, $2) as authorize_cash_session",
    [sessionId, notes ?? null],
  );
  return rows[0].authorize_cash_session as {
    session_id: string;
    expected_amount: number;
    real_amount: number;
    difference: number;
    classification: string;
  };
}

/** Extrae un mensaje de error legible sin importar la forma exacta del throw. */
export function errMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
