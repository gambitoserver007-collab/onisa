// Auditoría de seguridad 2026-10 (5ª pasada): pagos de centavos.
// create_sale validaba el desglose de pagos sumando los montos SIN redondear,
// pero guardaba cada línea redondeada a centavos: una línea grande más muchas
// de 0.0149 sumaban el total "en el aire" y dejaban pagos guardados por debajo
// de sales.total (y, en líneas de crédito/efectivo, un esperado de caja
// distinto). Ahora cada línea se redondea a centavos ANTES de validar la suma,
// y el desglose tiene tope de 20 líneas.
// Cada puerta trae CONTROLES: lo legítimo sigue funcionando.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asUser,
  createSale,
  createTestDb,
  errMessage,
  makeCompany,
  makeProduct,
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

describe("Pago dividido: los montos se validan en centavos", () => {
  let db: PGlite;
  let C: TestCompany;
  let cashier: string;
  let product: string;
  let customer: string;

  const sellWith = (
    payments: { method: string; amount: number; kind?: string }[],
    customerId?: string,
  ) =>
    asUser(db, cashier, () =>
      createSale(
        db,
        [{ product_id: product, qty: 1, unit_price: 0 }],
        C.loc1,
        undefined,
        { payments, customerId },
      ),
    );

  const storedSum = async (saleId: string) =>
    Number(
      (
        await db.query<{ s: string }>(
          "select coalesce(sum(amount),0) as s from public.sale_payments where sale_id=$1",
          [saleId],
        )
      ).rows[0].s,
    );

  const salesCount = async () =>
    Number(
      (
        await db.query<{ n: string }>(
          "select count(*)::int as n from public.sales where company_id=$1",
          [C.id],
        )
      ).rows[0].n,
    );

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa pagos");
    cashier = await makeUser(db, C.id, "user");
    product = await makeProduct(db, C.id, C.loc1, "Cien", 1, 100, 500);
    customer = crypto.randomUUID();
    await db.query(
      "insert into public.customers (id, company_id, name, credit_balance, credit_limit) values ($1,$2,'Cliente',0,1000)",
      [customer, C.id],
    );
    await asUser(db, cashier, () =>
      db.query("select open_cash_session(0,$1)", [C.loc1]),
    );
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: un pago dividido normal cuadra y guarda ambos pagos", async () => {
    const sale = await sellWith([
      { method: "Efectivo", amount: 60, kind: "cash" },
      { method: "Tarjeta", amount: 40, kind: "card" },
    ]);

    expect(await storedSum(sale.sale_id)).toBe(100);
  });

  it("CONTROL: montos con ruido de punto flotante se redondean y cuadran", async () => {
    const sale = await sellWith([
      { method: "Efectivo", amount: 50.004, kind: "cash" },
      { method: "Tarjeta", amount: 49.996, kind: "card" },
    ]);

    expect(await storedSum(sale.sale_id)).toBe(100);
  });

  it("una línea grande + 19 de 0.0149 que suman 100 en el aire se rechaza", async () => {
    const sales = await salesCount();
    const err = await rejects(() =>
      sellWith([
        { method: "Efectivo", amount: 99.7169, kind: "cash" },
        ...Array.from({ length: 19 }, () => ({
          method: "Tarjeta",
          amount: 0.0149,
          kind: "other",
        })),
      ]),
    );

    expect(err).toMatch(/no coincide con el total/i);
    expect(await salesCount()).toBe(sales);
  });

  it("200 líneas de centavos se rechazan por exceso de líneas (nada se guarda)", async () => {
    const sales = await salesCount();
    const err = await rejects(() =>
      sellWith([
        { method: "Efectivo", amount: 97.02, kind: "cash" },
        ...Array.from({ length: 200 }, () => ({
          method: "Tarjeta",
          amount: 0.0149,
          kind: "other",
        })),
      ]),
    );

    expect(err).toMatch(/demasiadas lineas/i);
    expect(await salesCount()).toBe(sales);
  });

  it("la variante a crédito tampoco mueve la deuda del cliente", async () => {
    const err = await rejects(() =>
      sellWith(
        [
          { method: "Efectivo", amount: 99.7169, kind: "cash" },
          ...Array.from({ length: 19 }, () => ({
            method: "Credito",
            amount: 0.0149,
            kind: "credit",
          })),
        ],
        customer,
      ),
    );
    const { rows } = await db.query<{ credit_balance: string }>(
      "select credit_balance from public.customers where id=$1",
      [customer],
    );

    expect(err).toMatch(/no coincide con el total/i);
    expect(Number(rows[0].credit_balance)).toBe(0);
  });

  it("CONTROL: venta a crédito dividida legítima sigue funcionando", async () => {
    const sale = await sellWith(
      [
        { method: "Efectivo", amount: 70, kind: "cash" },
        { method: "Credito", amount: 30, kind: "credit" },
      ],
      customer,
    );
    const { rows } = await db.query<{ credit_balance: string }>(
      "select credit_balance from public.customers where id=$1",
      [customer],
    );

    expect(await storedSum(sale.sale_id)).toBe(100);
    expect(Number(rows[0].credit_balance)).toBe(30);
  });
});
