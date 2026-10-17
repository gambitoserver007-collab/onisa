// Auditoría de seguridad 2026-10 (3ª pasada): arqueo ciego de la caja.
//   - Después del primer conteo (el corte) no entra ni sale dinero de esa caja:
//     antes solo se bloqueaban las ventas, y un egreso/ingreso posterior movía
//     el esperado y tapaba el faltante.
//   - El ajuste manual del conteo tiene tope: sin él se rellenaba cualquier
//     faltante y el primer conteo cuadraba sin pedir segundo conteo.
//   - El reembolso de una devolución va a la caja de quien devuelve, no a la
//     última caja abierta de la sucursal (otro cajero).
// Cada puerta trae CONTROLES: el flujo legítimo sigue funcionando.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asUser,
  createSale,
  createTestDb,
  errMessage,
  finishTillCount,
  makeCompany,
  makeProduct,
  makeUser,
  submitTillCount,
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

const COUNT_100 = [{ denomination: 100, quantity: 1 }];

describe("Conteo ciego: movimientos de caja después del corte", () => {
  let db: PGlite;
  let C: TestCompany;
  let cashier: string;
  let admin: string;
  let sessionId: string;
  let customer: string;

  const movement = (userId: string, amount: number) =>
    asUser(db, userId, () =>
      db.query(
        `insert into public.cash_movements
           (company_id, cash_session_id, location_id, movement_type, concept, amount)
         values ($1,$2,$3,$4,'prueba',$5)`,
        [C.id, sessionId, C.loc1, amount < 0 ? "egreso" : "ingreso", amount],
      ),
    );

  const movementsTotal = async () =>
    Number(
      (
        await db.query<{ t: string }>(
          "select coalesce(sum(amount),0) as t from public.cash_movements where cash_session_id=$1",
          [sessionId],
        )
      ).rows[0].t,
    );

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa conteo ciego");
    cashier = await makeUser(db, C.id, "user");
    admin = await makeUser(db, C.id, "admin");
    customer = crypto.randomUUID();
    await db.query(
      "insert into public.customers (id, company_id, name, credit_balance, credit_limit) values ($1,$2,'Deudor',100,500)",
      [customer, C.id],
    );
    sessionId = (
      await asUser(db, cashier, () =>
        db.query<{ s: string }>("select open_cash_session(200,$1) as s", [
          C.loc1,
        ]),
      )
    ).rows[0].s;
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: antes del conteo el cajero sí puede registrar un ingreso/egreso en su caja", async () => {
    expect(await rejects(() => movement(cashier, 50))).toBeNull();
    expect(await rejects(() => movement(cashier, -50))).toBeNull();
    expect(await movementsTotal()).toBe(0);
  });

  it("un conteo corto pide segundo conteo y NO se puede tapar con un egreso posterior", async () => {
    // Esperado 200, cuenta 100 -> faltan 100.
    await asUser(db, cashier, () => submitTillCount(db, sessionId, COUNT_100));

    const first = await asUser(db, cashier, () =>
      finishTillCount(db, sessionId),
    );

    expect(first.second_count_required).toBe(true);

    // El cajero intenta "justificar" el faltante con un egreso de 100.
    const direct = await rejects(() => movement(cashier, -100));

    expect(direct).toMatch(/conteo de cierre/i);
    expect(await movementsTotal()).toBe(0);

    const again = await asUser(db, cashier, () =>
      finishTillCount(db, sessionId),
    );

    expect(again.second_count_required).toBe(true);
    expect(again.status).toBe("open");
  });

  it("tampoco entra un ingreso posterior al corte, ni de un admin", async () => {
    expect(await rejects(() => movement(cashier, 100))).toMatch(
      /conteo de cierre/i,
    );
    expect(await rejects(() => movement(admin, 100))).toMatch(
      /conteo de cierre/i,
    );
  });

  it("el cobro de crédito en efectivo se rechaza en una caja en conteo", async () => {
    const collect = await rejects(() =>
      asUser(db, cashier, () =>
        db.query("select collect_customer_credit($1, 10, 'Efectivo', 'cash')", [
          customer,
        ]),
      ),
    );

    expect(collect).toMatch(/conteo de cierre/i);

    // Todo se revirtió: la deuda del cliente sigue intacta.
    const { rows } = await db.query<{ credit_balance: string }>(
      "select credit_balance from public.customers where id=$1",
      [customer],
    );

    expect(Number(rows[0].credit_balance)).toBe(100);
    expect(await movementsTotal()).toBe(0);
  });

  it("CONTROL: el segundo conteo (testigo) cierra y el admin autoriza con el esperado intacto", async () => {
    await asUser(db, admin, () => submitTillCount(db, sessionId, COUNT_100));

    const done = await asUser(db, admin, () => finishTillCount(db, sessionId));

    expect(done.status).toBe("closed");

    const auth = await asUser(db, admin, () =>
      db.query<{ r: { expected_amount: number; difference: number } }>(
        "select authorize_cash_session($1,null) as r",
        [sessionId],
      ),
    );

    expect(Number(auth.rows[0].r.expected_amount)).toBe(200);
    expect(Number(auth.rows[0].r.difference)).toBe(-100);
  });
});

describe("Conteo ciego: tope del ajuste manual", () => {
  let db: PGlite;
  let C: TestCompany;
  let cashier: string;
  let sessionId: string;

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa ajuste");
    cashier = await makeUser(db, C.id, "user");
    sessionId = (
      await asUser(db, cashier, () =>
        db.query<{ s: string }>("select open_cash_session(200,$1) as s", [
          C.loc1,
        ]),
      )
    ).rows[0].s;
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("NO se puede rellenar el faltante con un ajuste manual grande", async () => {
    // Esperado 200; cuenta 100 y "ajusta" 100 para cuadrar.
    const err = await rejects(() =>
      asUser(db, cashier, () => submitTillCount(db, sessionId, COUNT_100, 100)),
    );

    expect(err).toMatch(/ajuste manual/i);

    const { rows } = await db.query<{ n: string }>(
      "select count(*)::int as n from public.till_counts where cash_session_id=$1",
      [sessionId],
    );

    // El conteo rechazado no dejó rastro, ni fijó el corte.
    expect(Number(rows[0].n)).toBe(0);

    const cs = await db.query<{ count_cutoff_at: string | null }>(
      "select count_cutoff_at from public.cash_sessions where id=$1",
      [sessionId],
    );

    expect(cs.rows[0].count_cutoff_at).toBeNull();
  });

  it("CONTROL: un ajuste de sueltos (centavos, hasta $10) sigue permitido", async () => {
    const small = await asUser(db, cashier, () =>
      submitTillCount(db, sessionId, COUNT_100, 0.25),
    );

    expect(Number(small.counted_cash_total)).toBeCloseTo(100.25, 2);
    expect(Number(small.manual_adjustment)).toBeCloseTo(0.25, 2);
  });

  it("CONTROL: el tope exacto ($10) se acepta en el segundo conteo del testigo", async () => {
    const witness = await makeUser(db, C.id, "user");
    const edge = await asUser(db, witness, () =>
      submitTillCount(db, sessionId, COUNT_100, 10),
    );

    expect(Number(edge.manual_adjustment)).toBe(10);
  });
});

describe("Devoluciones: el reembolso va a la caja de quien devuelve", () => {
  let db: PGlite;
  let C: TestCompany;
  let cashierA: string;
  let cashierB: string;
  let sessionA: string;
  let sessionB: string;
  let product: string;

  const refundRows = async (session: string) =>
    Number(
      (
        await db.query<{ n: string }>(
          "select count(*)::int as n from public.cash_movements where cash_session_id=$1 and concept like 'Reembolso%'",
          [session],
        )
      ).rows[0].n,
    );

  const doReturn = async (userId: string, saleId: string) => {
    const item = (
      await db.query<{ id: string }>(
        "select id from public.sale_items where sale_id=$1 limit 1",
        [saleId],
      )
    ).rows[0].id;

    return asUser(db, userId, () =>
      db.query("select create_return($1,'x',$2::jsonb,$3,true)", [
        saleId,
        JSON.stringify([{ sale_item_id: item, qty: 1 }]),
        C.loc1,
      ]),
    );
  };

  const sellAs = (userId: string) =>
    asUser(db, userId, () =>
      createSale(
        db,
        [{ product_id: product, qty: 1, unit_price: 100 }],
        C.loc1,
      ),
    );

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa reembolsos");
    cashierA = await makeUser(db, C.id, "user");
    cashierB = await makeUser(db, C.id, "user");
    product = await makeProduct(db, C.id, C.loc1, "P", 1, 100, 500);

    const till2 = crypto.randomUUID();

    await db.query(
      "insert into public.tills (id, company_id, location_id, name) values ($1,$2,$3,'Caja 2')",
      [till2, C.id, C.loc1],
    );

    const till1 = (
      await db.query<{ id: string }>(
        "select id from public.tills where company_id=$1 and location_id=$2 and id<>$3 limit 1",
        [C.id, C.loc1, till2],
      )
    ).rows[0].id;

    sessionA = (
      await asUser(db, cashierA, () =>
        db.query<{ s: string }>("select open_cash_session(0,$1,$2) as s", [
          C.loc1,
          till1,
        ]),
      )
    ).rows[0].s;
    // B abre DESPUÉS: es la "última caja abierta" de la sucursal.
    sessionB = (
      await asUser(db, cashierB, () =>
        db.query<{ s: string }>("select open_cash_session(0,$1,$2) as s", [
          C.loc1,
          till2,
        ]),
      )
    ).rows[0].s;
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("el reembolso de A cae en la caja de A, no en la de B (la más reciente)", async () => {
    const sale = await sellAs(cashierA);

    await doReturn(cashierA, sale.sale_id);

    expect(await refundRows(sessionA)).toBe(1);
    expect(await refundRows(sessionB)).toBe(0);
  });

  it("CONTROL: el reembolso de B cae en la caja de B", async () => {
    const sale = await sellAs(cashierB);

    await doReturn(cashierB, sale.sale_id);

    expect(await refundRows(sessionB)).toBe(1);
    expect(await refundRows(sessionA)).toBe(1);
  });
});
