// Auditoría de seguridad 2026-10 (8ª pasada): método de reembolso de create_return.
// p_refund_cash sacaba efectivo del cajón por el total de lo devuelto aunque la
// venta se hubiera pagado a crédito o con tarjeta, y la deuda del cliente nunca
// bajaba: devolver una venta a crédito "reembolsada en efectivo" convertía una
// deuda en dinero del cajón. Ahora el reembolso sigue la forma de pago original:
// efectivo solo por lo pagado en efectivo (con la caja de quien lo da), la parte
// a crédito baja la deuda del cliente y lo demás no mueve la caja.
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

describe("Devoluciones: el reembolso sigue la forma de pago original", () => {
  let db: PGlite;
  let C: TestCompany;
  let cashier: string;
  let cashierNoSession: string;
  let admin: string;
  let product: string;

  const newCustomer = async () => {
    const id = crypto.randomUUID();

    await db.query(
      "insert into public.customers (id, company_id, name, credit_balance, credit_limit) values ($1,$2,'Cliente',0,5000)",
      [id, C.id],
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

  // Vende 1 línea de 2 piezas a $50 (= $100) con el desglose pedido.
  const sell = async (
    payments: { method: string; amount: number; kind: string }[],
    customerId?: string,
  ) => {
    const sale = await asUser(db, cashier, () =>
      createSale(
        db,
        [{ product_id: product, qty: 2, unit_price: 0 }],
        C.loc1,
        undefined,
        { payments, customerId },
      ),
    );
    const item = (
      await db.query<{ id: string }>(
        "select id from public.sale_items where sale_id=$1",
        [sale.sale_id],
      )
    ).rows[0].id;

    return { saleId: sale.sale_id, item };
  };

  const giveBack = (
    userId: string,
    saleId: string,
    item: string,
    qty: number,
    refundCash = true,
  ) =>
    asUser(db, userId, () =>
      db.query("select create_return($1,'x',$2::jsonb,$3,$4)", [
        saleId,
        JSON.stringify([{ sale_item_id: item, qty }]),
        C.loc1,
        refundCash,
      ]),
    );

  const cashRefunded = async (saleId: string) =>
    Number(
      (
        await db.query<{ s: string }>(
          `select coalesce(sum(-m.amount),0) as s
           from public.cash_movements m
           join public.returns r on m.concept = 'Reembolso devolucion ' || r.return_number
           where r.sale_id=$1`,
          [saleId],
        )
      ).rows[0].s,
    );

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa reembolsos");
    cashier = await makeUser(db, C.id, "user");
    cashierNoSession = await makeUser(db, C.id, "user");
    admin = await makeUser(db, C.id, "admin");
    product = await makeProduct(db, C.id, C.loc1, "P", 1, 50, 500);
    await asUser(db, cashier, () =>
      db.query("select open_cash_session(0,$1)", [C.loc1]),
    );
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: una venta en efectivo se reembolsa en efectivo por todo lo devuelto", async () => {
    const { saleId, item } = await sell([
      { method: "Efectivo", amount: 100, kind: "cash" },
    ]);

    await giveBack(cashier, saleId, item, 2);

    expect(await cashRefunded(saleId)).toBe(100);
  });

  it("una venta A CRÉDITO devuelta ya no saca efectivo del cajón: baja la deuda del cliente", async () => {
    const customer = await newCustomer();
    const { saleId, item } = await sell(
      [{ method: "Crédito", amount: 100, kind: "credit" }],
      customer,
    );

    expect(await balanceOf(customer)).toBe(100);

    await giveBack(cashier, saleId, item, 2, true);

    expect(await cashRefunded(saleId)).toBe(0);
    expect(await balanceOf(customer)).toBe(0);
  });

  it("una venta con TARJETA devuelta no saca efectivo del cajón", async () => {
    const { saleId, item } = await sell([
      { method: "Tarjeta", amount: 100, kind: "other" },
    ]);

    await giveBack(cashier, saleId, item, 2, true);

    expect(await cashRefunded(saleId)).toBe(0);
  });

  it("pago mixto (60 efectivo + 40 crédito): devolver todo reembolsa 60 en efectivo y baja 40 de la deuda", async () => {
    const customer = await newCustomer();
    const { saleId, item } = await sell(
      [
        { method: "Efectivo", amount: 60, kind: "cash" },
        { method: "Crédito", amount: 40, kind: "credit" },
      ],
      customer,
    );

    await giveBack(cashier, saleId, item, 2);

    expect(await cashRefunded(saleId)).toBe(60);
    expect(await balanceOf(customer)).toBe(0);
  });

  it("devoluciones parciales de una venta mixta no pasan de lo pagado en cada forma", async () => {
    const customer = await newCustomer();
    const { saleId, item } = await sell(
      [
        { method: "Efectivo", amount: 60, kind: "cash" },
        { method: "Crédito", amount: 40, kind: "credit" },
      ],
      customer,
    );

    await giveBack(cashier, saleId, item, 1);
    await giveBack(cashier, saleId, item, 1);

    expect(await cashRefunded(saleId)).toBe(60);
    expect(await balanceOf(customer)).toBe(0);

    const { rows } = await db.query<{ c: string; k: string }>(
      "select coalesce(sum(refund_cash_amount),0) c, coalesce(sum(refund_credit_amount),0) k from public.returns where sale_id=$1",
      [saleId],
    );

    expect(Number(rows[0].c)).toBe(60);
    expect(Number(rows[0].k)).toBe(40);
  });

  it("un cajero SIN su caja abierta ya no puede reembolsar efectivo (nada se devuelve)", async () => {
    const { saleId, item } = await sell([
      { method: "Efectivo", amount: 100, kind: "cash" },
    ]);
    const err = await rejects(() =>
      giveBack(cashierNoSession, saleId, item, 2),
    );
    const { rows } = await db.query<{ n: string }>(
      "select count(*)::int as n from public.returns where sale_id=$1",
      [saleId],
    );

    expect(err).toMatch(/Abre tu caja/i);
    expect(Number(rows[0].n)).toBe(0);
  });

  it("CONTROL: sin pedir efectivo (p_refund_cash=false) el cajero sin caja sí registra la devolución", async () => {
    const { saleId, item } = await sell([
      { method: "Efectivo", amount: 100, kind: "cash" },
    ]);

    expect(
      await rejects(() => giveBack(cashierNoSession, saleId, item, 2, false)),
    ).toBeNull();
    expect(await cashRefunded(saleId)).toBe(0);
  });

  it("CONTROL: un admin sin caja propia puede devolver una venta en efectivo", async () => {
    const { saleId, item } = await sell([
      { method: "Efectivo", amount: 100, kind: "cash" },
    ]);

    expect(await rejects(() => giveBack(admin, saleId, item, 2))).toBeNull();
  });
});
