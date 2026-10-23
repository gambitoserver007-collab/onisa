// Auditoría de seguridad 2026-10 (9ª pasada): dinero de los apartados.
//   - Un anticipo o abono en EFECTIVO se guardaba aunque quien lo recibía no
//     tuviera caja abierta: el dinero no entraba a ningún arqueo.
//   - Un abono NaN liquidaba el apartado entero (least(NaN, saldo) = saldo).
//   - Al cancelar con reembolso, salía del cajón el total pagado aunque el
//     anticipo se hubiera cobrado con tarjeta o transferencia.
// Cada puerta trae CONTROLES: lo legítimo sigue funcionando.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asUser,
  createTestDb,
  errMessage,
  makeCompany,
  makeCustomer,
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

describe("Apartados: el efectivo entra a un turno y el reembolso sigue el medio de pago", () => {
  let db: PGlite;
  let C: TestCompany;
  let cashier: string;
  let cashierNoSession: string;
  let admin: string;
  let product: string;
  let customer: string;

  const create = (userId: string, deposit: number, method = "Efectivo") =>
    asUser(db, userId, () =>
      db.query<{ r: { apartado_id: string } }>(
        `select create_apartado(
           p_customer_id := $1, p_items := $2::jsonb, p_location_id := $3,
           p_deposit_amount := $4, p_due_date := current_date + 5, p_payment_method := $5
         ) as r`,
        [
          customer,
          JSON.stringify([{ product_id: product, qty: 1 }]),
          C.loc1,
          deposit,
          method,
        ],
      ),
    );

  const pay = (
    userId: string,
    id: string,
    amount: number | string,
    method = "Efectivo",
  ) =>
    asUser(db, userId, () =>
      db.query("select add_apartado_payment($1,$2::numeric,$3)", [
        id,
        amount,
        method,
      ]),
    );

  const paidTotal = async (id: string) =>
    Number(
      (
        await db.query<{ p: string }>(
          "select paid_total as p from public.apartados where id=$1",
          [id],
        )
      ).rows[0].p,
    );

  const movementsOf = async (concept: string) =>
    (
      await db.query<{ movement_type: string; amount: string }>(
        "select movement_type, amount from public.cash_movements where company_id=$1 and concept like $2 order by created_at",
        [C.id, concept],
      )
    ).rows;

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa apartados");
    cashier = await makeUser(db, C.id, "user");
    cashierNoSession = await makeUser(db, C.id, "user");
    admin = await makeUser(db, C.id, "admin");
    product = await makeProduct(db, C.id, C.loc1, "P", 1, 100, 500);
    customer = await makeCustomer(db, C.id, "Cliente", 0);
    await db.query(
      "update public.companies set apartado_min_deposit_pct = 0 where id=$1",
      [C.id],
    );
    await asUser(db, cashier, () =>
      db.query("select open_cash_session(0,$1)", [C.loc1]),
    );

    // El admin trabaja en una segunda caja para que sus movimientos queden en su turno.
    const till2 = crypto.randomUUID();

    await db.query(
      "insert into public.tills (id, company_id, location_id, name) values ($1,$2,$3,'Caja 2')",
      [till2, C.id, C.loc1],
    );
    await asUser(db, admin, () =>
      db.query("select open_cash_session(0,$1,$2)", [C.loc1, till2]),
    );
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: el cajero con caja abierta recibe un anticipo en efectivo y entra a su turno", async () => {
    const id = (await create(cashier, 30)).rows[0].r.apartado_id;

    expect(await paidTotal(id)).toBe(30);
    expect(
      (await movementsOf("Anticipo apartado%")).map((m) => Number(m.amount)),
    ).toContain(30);
  });

  it("un cajero SIN caja abierta ya no puede recibir un anticipo en efectivo (no se crea el apartado)", async () => {
    const before = await db.query<{ n: string }>(
      "select count(*)::int as n from public.apartados where company_id=$1",
      [C.id],
    );
    const err = await rejects(() => create(cashierNoSession, 30));
    const after = await db.query<{ n: string }>(
      "select count(*)::int as n from public.apartados where company_id=$1",
      [C.id],
    );

    expect(err).toMatch(/Abre tu caja/i);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  it("CONTROL: el mismo cajero sin caja sí puede recibir un anticipo con tarjeta, y un admin sin caja uno en efectivo", async () => {
    expect(
      await rejects(() => create(cashierNoSession, 30, "Tarjeta")),
    ).toBeNull();
    expect(await rejects(() => create(admin, 30))).toBeNull();
  });

  it("un abono en efectivo sin caja abierta se rechaza y el saldo no cambia", async () => {
    const id = (await create(cashier, 10)).rows[0].r.apartado_id;
    const err = await rejects(() => pay(cashierNoSession, id, 20));

    expect(err).toMatch(/Abre tu caja/i);
    expect(await paidTotal(id)).toBe(10);
  });

  it("un abono NaN se rechaza (antes liquidaba todo el apartado)", async () => {
    const id = (await create(cashier, 10)).rows[0].r.apartado_id;

    for (const method of ["Efectivo", "Tarjeta"]) {
      const err = await rejects(() => pay(cashier, id, "NaN", method));

      expect(err, method).toMatch(/monto valido/i);
    }

    expect(await paidTotal(id)).toBe(10);
  });

  it("completar con un pago final NaN se rechaza", async () => {
    const id = (await create(cashier, 10)).rows[0].r.apartado_id;
    const err = await rejects(() =>
      asUser(db, cashier, () =>
        db.query("select complete_apartado($1,'NaN'::numeric,'Tarjeta')", [id]),
      ),
    );

    expect(err).toMatch(/monto valido/i);
  });

  it("cancelar con reembolso: un anticipo con TARJETA no saca efectivo del cajón", async () => {
    const id = (await create(admin, 50, "Tarjeta")).rows[0].r.apartado_id;

    const res = await asUser(db, admin, () =>
      db.query<{ r: { refunded_cash: number; refunded_amount: number } }>(
        "select cancel_apartado($1, true) as r",
        [id],
      ),
    );

    expect(Number(res.rows[0].r.refunded_cash)).toBe(0);
    expect(Number(res.rows[0].r.refunded_amount)).toBe(50);
    expect(await movementsOf(`Reembolso apartado cancelado%`)).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ amount: "-50.00" })]),
    );
  });

  it("cancelar con reembolso: pago mixto (30 efectivo + 20 tarjeta) saca solo 30 del cajón", async () => {
    const id = (await create(cashier, 30)).rows[0].r.apartado_id;

    await pay(cashier, id, 20, "Tarjeta");

    const res = await asUser(db, admin, () =>
      db.query<{ r: { refunded_cash: number } }>(
        "select cancel_apartado($1, true) as r",
        [id],
      ),
    );

    expect(Number(res.rows[0].r.refunded_cash)).toBe(30);
    expect(
      (await movementsOf("Reembolso apartado cancelado%")).map((m) =>
        Number(m.amount),
      ),
    ).toContain(-30);
  });

  it("CONTROL: cancelar un apartado pagado en efectivo reembolsa el efectivo completo", async () => {
    const id = (await create(cashier, 40)).rows[0].r.apartado_id;
    const res = await asUser(db, admin, () =>
      db.query<{ r: { refunded_cash: number } }>(
        "select cancel_apartado($1, true) as r",
        [id],
      ),
    );

    expect(Number(res.rows[0].r.refunded_cash)).toBe(40);
  });
});
