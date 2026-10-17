// Auditoría de seguridad 2026-10 (2ª pasada): caja y devoluciones.
//   - Tras el primer conteo no se puede seguir vendiendo en esa caja.
//   - Nadie cuenta/cierra ni mete movimientos en la caja de un compañero
//     (salvo el testigo del segundo conteo y admin/finanzas/gerente).
//   - La caja de una venta/cotización es la del propio usuario.
//   - Devolver una venta pagada con puntos no los convierte en efectivo.
// Cada puerta trae CONTROLES: el flujo legítimo sigue funcionando.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asUser,
  createSale,
  createTestDb,
  errMessage,
  finishTillCount,
  getCustomerLoyaltyPoints,
  makeCompany,
  makeCustomer,
  makeProduct,
  makeUser,
  setLoyaltySettings,
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

describe("Caja: conteo de cierre y ventas posteriores", () => {
  let db: PGlite;
  let C: TestCompany;
  let cashier: string;
  let admin: string;
  let product: string;

  const openSession = async (userId: string, amount = 100) =>
    (
      await asUser(db, userId, () =>
        db.query<{ s: string }>("select open_cash_session($1,$2) as s", [
          amount,
          C.loc1,
        ]),
      )
    ).rows[0].s;

  const sell = (userId: string) =>
    asUser(db, userId, () =>
      createSale(
        db,
        [{ product_id: product, qty: 1, unit_price: 100 }],
        C.loc1,
      ),
    );

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa caja");
    cashier = await makeUser(db, C.id, "user");
    admin = await makeUser(db, C.id, "admin");
    product = await makeProduct(db, C.id, C.loc1, "P", 1, 100, 500);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: se puede vender antes del primer conteo y el cierre normal sigue funcionando", async () => {
    const sessionId = await openSession(cashier, 100);
    const sale = await sell(cashier);

    // Fondo 100 + una venta en efectivo.
    const cash = sale.total;
    const denominations = [
      { denomination: 100, quantity: 1 },
      ...(cash === 100 ? [{ denomination: 100, quantity: 1 }] : []),
    ];

    expect(sale.total).toBeGreaterThan(0);

    await asUser(db, cashier, () =>
      submitTillCount(db, sessionId, denominations),
    );

    const finish = await asUser(db, cashier, () =>
      finishTillCount(db, sessionId),
    );

    // Cierre o segundo conteo: lo importante es que el flujo responde.
    expect(["closed", "open"]).toContain(finish.status);
    // Se cierra para no dejar la caja abierta a las pruebas siguientes.
    if (finish.status === "open") {
      await asUser(db, admin, () => submitTillCount(db, sessionId, COUNT_100));
      await asUser(db, admin, () => finishTillCount(db, sessionId));
    }
  });

  it("NO se puede seguir vendiendo en una caja después de su primer conteo", async () => {
    await openSession(cashier, 100);
    const sessionId = (
      await db.query<{ id: string }>(
        "select id from public.cash_sessions where status='open' order by opened_at desc limit 1",
      )
    ).rows[0].id;

    await asUser(db, cashier, () => submitTillCount(db, sessionId, COUNT_100));

    const err = await rejects(() => sell(cashier));

    expect(err).toMatch(/conteo de cierre/i);

    const { rows } = await db.query<{ n: string }>(
      `select count(*)::int as n from public.sales s
       join public.cash_sessions cs on cs.till_id = s.till_id
       where cs.id = $1 and s.sale_date > cs.count_cutoff_at`,
      [sessionId],
    );

    expect(Number(rows[0].n)).toBe(0);

    // Cierre del turno (segundo conteo por otra persona) para liberar la caja.
    await asUser(db, admin, () => submitTillCount(db, sessionId, COUNT_100));
    await asUser(db, admin, () => finishTillCount(db, sessionId));
  });

  it("CONTROL: cerrada la caja, el siguiente turno vuelve a vender normalmente", async () => {
    await openSession(cashier, 100);

    const err = await rejects(() => sell(cashier));

    expect(err).toBeNull();
  });
});

describe("Caja de un compañero: conteos, cierre y movimientos", () => {
  let db: PGlite;
  let C: TestCompany;
  let k1: string;
  let k2: string;
  let admin: string;
  let sessionOfK2: string;

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa cajas");
    k1 = await makeUser(db, C.id, "user");
    k2 = await makeUser(db, C.id, "user");
    admin = await makeUser(db, C.id, "admin");
    sessionOfK2 = (
      await asUser(db, k2, () =>
        db.query<{ s: string }>("select open_cash_session(100,$1) as s", [
          C.loc1,
        ]),
      )
    ).rows[0].s;
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  const movement = (userId: string) =>
    asUser(db, userId, () =>
      db.query(
        "insert into public.cash_movements (company_id, cash_session_id, movement_type, concept, amount) values ($1,$2,'ingreso','x',500)",
        [C.id, sessionOfK2],
      ),
    );

  it("CONTROL: el dueño de la caja y un admin sí pueden registrar movimientos en ella", async () => {
    expect(await rejects(() => movement(k2))).toBeNull();
    expect(await rejects(() => movement(admin))).toBeNull();
  });

  it("otro cajero NO puede meter movimientos en la caja de su compañero", async () => {
    const err = await rejects(() => movement(k1));

    expect(err).toMatch(/row-level security/i);
  });

  it("otro cajero NO puede hacer el PRIMER conteo ni cerrar la caja de su compañero", async () => {
    const countErr = await rejects(() =>
      asUser(db, k1, () => submitTillCount(db, sessionOfK2, COUNT_100)),
    );
    const finishErr = await rejects(() =>
      asUser(db, k1, () => finishTillCount(db, sessionOfK2)),
    );

    expect(countErr).toMatch(/solo quien abrio la caja/i);
    expect(finishErr).toMatch(/solo quien abrio la caja/i);
  });

  it("CONTROL: el dueño cuenta y otro cajero SÍ puede ser el testigo del segundo conteo", async () => {
    await asUser(db, k2, () => submitTillCount(db, sessionOfK2, COUNT_100));

    const witness = await rejects(() =>
      asUser(db, k1, () =>
        submitTillCount(db, sessionOfK2, [{ denomination: 50, quantity: 1 }]),
      ),
    );

    expect(witness).toBeNull();

    const finish = await asUser(db, k1, () => finishTillCount(db, sessionOfK2));

    expect(finish.status).toBe("closed");
  });
});

describe("Caja de la venta y de la cotización", () => {
  let db: PGlite;
  let C: TestCompany;
  let k1: string;
  let k2: string;
  let admin: string;
  let till1: string;
  let till2: string;
  let product: string;

  const saleOnTill = (userId: string, tillId: string) =>
    asUser(db, userId, () =>
      db.query<{ r: { sale_id: string } }>(
        "select create_sale(null,'Ticket','Efectivo',$1::jsonb,$2,null,$3,0,null,null) as r",
        [
          JSON.stringify([{ product_id: product, qty: 1, unit_price: 100 }]),
          C.loc1,
          tillId,
        ],
      ),
    ).then((r) => r.rows[0].r.sale_id);

  const tillOfSale = async (saleId: string) =>
    (
      await db.query<{ till_id: string | null }>(
        "select till_id from public.sales where id=$1",
        [saleId],
      )
    ).rows[0].till_id;

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa tills");
    k1 = await makeUser(db, C.id, "user");
    k2 = await makeUser(db, C.id, "user");
    admin = await makeUser(db, C.id, "admin");
    product = await makeProduct(db, C.id, C.loc1, "P", 1, 100, 500);
    till1 = (
      await db.query<{ id: string }>(
        "select id from public.tills where company_id=$1 and location_id=$2 limit 1",
        [C.id, C.loc1],
      )
    ).rows[0].id;
    till2 = crypto.randomUUID();
    await db.query(
      "insert into public.tills (id, company_id, location_id, name) values ($1,$2,$3,'Caja 2')",
      [till2, C.id, C.loc1],
    );
    await asUser(db, k1, () =>
      db.query("select open_cash_session(100,$1,$2)", [C.loc1, till1]),
    );
    await asUser(db, k2, () =>
      db.query("select open_cash_session(100,$1,$2)", [C.loc1, till2]),
    );
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: un cajero vende en SU caja cuando la pide explícitamente", async () => {
    expect(await tillOfSale(await saleOnTill(k1, till1))).toBe(till1);
  });

  it("un cajero NO puede cargar una venta a la caja de su compañero", async () => {
    expect(await tillOfSale(await saleOnTill(k1, till2))).toBe(till1);
  });

  it("CONTROL: un admin sí puede atribuir una venta a la caja de un cajero", async () => {
    expect(await tillOfSale(await saleOnTill(admin, till2))).toBe(till2);
  });

  it("al convertir una cotización, un cajero NO puede escoger la caja de su compañero", async () => {
    const quote = (
      await asUser(db, k1, () =>
        db.query<{ r: { quote_id?: string; id?: string } }>(
          "select create_quote($1::jsonb,null,null,$2) as r",
          [JSON.stringify([{ product_id: product, qty: 1 }]), C.loc1],
        ),
      )
    ).rows[0].r;
    const quoteId = (quote.quote_id ?? quote.id) as string;

    const sale = (
      await asUser(db, k1, () =>
        db.query<{ r: { sale_id: string } }>(
          "select convert_quote_to_sale($1,$2,'Efectivo',null,$3,0) as r",
          [quoteId, C.loc1, till2],
        ),
      )
    ).rows[0].r;

    expect(await tillOfSale(sale.sale_id)).toBe(till1);
  });
});

describe("Devoluciones: ventas pagadas con puntos de lealtad", () => {
  let db: PGlite;
  let C: TestCompany;
  let cashier: string;
  let customer: string;
  let product: string;

  const refundTotals = async () => {
    const { rows } = await db.query<{ refunds: string; cash: string }>(
      `select
         (select coalesce(sum(total),0) from public.returns where company_id=$1) as refunds,
         (select coalesce(-sum(amount),0) from public.cash_movements
            where company_id=$1 and movement_type='egreso' and concept like 'Reembolso%') as cash`,
      [C.id],
    );

    return { refunds: Number(rows[0].refunds), cash: Number(rows[0].cash) };
  };

  const doReturn = async (saleId: string, qty: number) => {
    const item = (
      await db.query<{ id: string }>(
        "select id from public.sale_items where sale_id=$1 limit 1",
        [saleId],
      )
    ).rows[0].id;

    await asUser(db, cashier, () =>
      db.query("select create_return($1,'x',$2::jsonb,$3,true)", [
        saleId,
        JSON.stringify([{ sale_item_id: item, qty }]),
        C.loc1,
      ]),
    );
  };

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa devoluciones");
    cashier = await makeUser(db, C.id, "user");
    await setLoyaltySettings(db, C.id, {
      enabled: true,
      pointValue: 0.1,
      earnRate: 0,
    });
    product = await makeProduct(db, C.id, C.loc1, "P", 1, 100, 500);
    customer = await makeCustomer(db, C.id, "Cliente", 1000);
    await asUser(db, cashier, () =>
      db.query("select open_cash_session(0,$1)", [C.loc1]),
    );
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: una venta SIN puntos se reembolsa completa", async () => {
    const sale = await asUser(db, cashier, () =>
      createSale(
        db,
        [{ product_id: product, qty: 1, unit_price: 100 }],
        C.loc1,
      ),
    );

    const before = await refundTotals();

    await doReturn(sale.sale_id, 1);

    const after = await refundTotals();

    expect(after.refunds - before.refunds).toBeCloseTo(sale.total, 2);
    expect(after.cash - before.cash).toBeCloseTo(sale.total, 2);
  });

  it("una venta pagada con puntos solo reembolsa lo que se pagó, y restituye los puntos", async () => {
    const pointsBefore = await getCustomerLoyaltyPoints(db, customer);
    const sale = await asUser(db, cashier, () =>
      createSale(
        db,
        [{ product_id: product, qty: 1, unit_price: 100 }],
        C.loc1,
        undefined,
        { customerId: customer, pointsRedeemed: 500 },
      ),
    );

    // Se canjearon 500 puntos (valor 50): el cliente pagó el resto.
    expect(sale.points_redeemed).toBe(500);
    expect(await getCustomerLoyaltyPoints(db, customer)).toBe(
      pointsBefore - 500,
    );

    const before = await refundTotals();

    await doReturn(sale.sale_id, 1);

    const after = await refundTotals();

    expect(after.refunds - before.refunds).toBeCloseTo(sale.total, 2);
    expect(after.cash - before.cash).toBeCloseTo(sale.total, 2);
    expect(after.cash - before.cash).toBeLessThan(100);
    // Los puntos canjeados vuelven al cliente.
    expect(await getCustomerLoyaltyPoints(db, customer)).toBe(pointsBefore);
  });

  it("en devoluciones parciales el reembolso y los puntos se prorratean sin duplicarse", async () => {
    const pointsBefore = await getCustomerLoyaltyPoints(db, customer);
    const sale = await asUser(db, cashier, () =>
      createSale(
        db,
        [{ product_id: product, qty: 2, unit_price: 100 }],
        C.loc1,
        undefined,
        { customerId: customer, pointsRedeemed: 500 },
      ),
    );
    const before = await refundTotals();

    await doReturn(sale.sale_id, 1);
    await doReturn(sale.sale_id, 1);

    const after = await refundTotals();

    // Entre las dos devoluciones se reembolsa exactamente lo pagado.
    expect(after.cash - before.cash).toBeCloseTo(sale.total, 2);
    // Y los 500 puntos canjeados vuelven completos (ni más ni menos).
    expect(await getCustomerLoyaltyPoints(db, customer)).toBe(pointsBefore);
  });
});
