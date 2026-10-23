// Auditoría de seguridad 2026-10 (7ª pasada): cobro de crédito de clientes.
// collect_customer_credit borra deuda con el tipo de cobro que declara quien
// llama. Antes: un cobro "en efectivo" sin caja propia abierta borraba la deuda y
// el dinero no quedaba en ningún arqueo; un monto NaN pasaba la validación; y no
// quedaba rastro de qué tipo de cobro se declaró ni del saldo antes/después.
// Ahora el efectivo exige la caja de quien cobra (los cajeros; admin / gerente /
// finanzas quedan registrados), se rechaza NaN y cada cobro entra a la bitácora.
// Cada puerta trae CONTROLES: el cobro legítimo sigue funcionando.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asUser,
  createTestDb,
  errMessage,
  makeCompany,
  makeUser,
  type TestCompany,
} from "./helpers/db";

async function rejects(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();

    return null;
  } catch (err) {
    return errMessage(err);
  }
}

describe("Cobro de crédito: el efectivo entra a un turno y todo queda registrado", () => {
  let db: PGlite;
  let C: TestCompany;
  let cashier: string;
  let cashierNoSession: string;
  let admin: string;

  const newCustomer = async (balance = 100) => {
    const id = crypto.randomUUID();

    await db.query(
      "insert into public.customers (id, company_id, name, credit_balance, credit_limit) values ($1,$2,'Deudor',$3,1000)",
      [id, C.id, balance],
    );

    return id;
  };

  const balanceOf = async (id: string) =>
    Number(
      (
        await db.query<{ b: string }>(
          "select credit_balance as b from public.customers where id=$1",
          [id],
        )
      ).rows[0].b,
    );

  const collect = (
    userId: string,
    customer: string,
    amount: number | string,
    method = "Efectivo",
    kind = "cash",
  ) =>
    asUser(db, userId, () =>
      db.query("select collect_customer_credit($1,$2::numeric,$3,$4)", [
        customer,
        amount,
        method,
        kind,
      ]),
    );

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa cobros");
    cashier = await makeUser(db, C.id, "user");
    cashierNoSession = await makeUser(db, C.id, "user");
    admin = await makeUser(db, C.id, "admin");
    await asUser(db, cashier, () =>
      db.query("select open_cash_session(0,$1)", [C.loc1]),
    );
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: el cajero con caja abierta cobra en efectivo y entra a su turno", async () => {
    const customer = await newCustomer(100);

    await collect(cashier, customer, 40);

    expect(await balanceOf(customer)).toBe(60);

    const { rows } = await db.query<{ amount: string }>(
      "select amount from public.cash_movements where company_id=$1 and concept='Cobro de credito'",
      [C.id],
    );

    expect(rows.map((r) => Number(r.amount))).toEqual([40]);
  });

  it("un cajero SIN caja abierta ya no puede cobrar en efectivo (la deuda no cambia)", async () => {
    const customer = await newCustomer(100);
    const err = await rejects(() => collect(cashierNoSession, customer, 100));

    expect(err).toMatch(/Abre tu caja/i);
    expect(await balanceOf(customer)).toBe(100);
  });

  it("CONTROL: el cobro NO efectivo (tarjeta) del mismo cajero sigue permitido y no toca la caja", async () => {
    const customer = await newCustomer(100);
    const before = await db.query<{ n: string }>(
      "select count(*)::int as n from public.cash_movements where company_id=$1",
      [C.id],
    );

    await collect(cashierNoSession, customer, 30, "Tarjeta", "other");

    const after = await db.query<{ n: string }>(
      "select count(*)::int as n from public.cash_movements where company_id=$1",
      [C.id],
    );

    expect(await balanceOf(customer)).toBe(70);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("CONTROL: un admin sin caja propia puede cobrar en efectivo (queda registrado)", async () => {
    const customer = await newCustomer(100);

    await collect(admin, customer, 25);

    expect(await balanceOf(customer)).toBe(75);
  });

  it("un monto NaN se rechaza (antes borraba todo el saldo)", async () => {
    const customer = await newCustomer(100);
    const err = await rejects(() =>
      collect(cashier, customer, "NaN", "Tarjeta", "other"),
    );

    expect(err).toMatch(/monto valido/i);
    expect(await balanceOf(customer)).toBe(100);
  });

  it("cada cobro guarda el tipo declarado y deja una entrada en la bitácora con el saldo antes y después", async () => {
    const customer = await newCustomer(100);

    await collect(cashierNoSession, customer, 30, "Tarjeta", "card");

    const pay = await db.query<{ kind: string; amount: string }>(
      "select kind, amount from public.customer_credit_payments where customer_id=$1",
      [customer],
    );
    const log = await db.query<{ detail: Record<string, unknown> }>(
      "select detail from public.audit_log where entity_type='customer' and entity_id=$1 and action='credit_collected'",
      [customer],
    );

    expect(pay.rows[0].kind).toBe("other");
    expect(Number(pay.rows[0].amount)).toBe(30);
    expect(log.rows).toHaveLength(1);
    expect(Number(log.rows[0].detail.balance_before)).toBe(100);
    expect(Number(log.rows[0].detail.balance_after)).toBe(70);
    expect(log.rows[0].detail.kind).toBe("other");
  });

  it("CONTROL: cobrar de más se topa al saldo (sin error)", async () => {
    const customer = await newCustomer(50);

    await collect(cashier, customer, 500);

    expect(await balanceOf(customer)).toBe(0);
  });
});
