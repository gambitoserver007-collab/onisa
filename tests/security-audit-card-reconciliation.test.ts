// Auditoría de seguridad 2026-10 (16ª pasada): conciliación de cobros con tarjeta y
// transferencia. El sistema no puede comprobar que un pago con tarjeta existió: un
// cajero podía registrar una venta "Tarjeta" que no cobró y quedarse con la
// mercancía. Al contar la caja, quien cierra declara lo que dice SU terminal /
// banco; al autorizar el corte se compara con lo que el sistema registró y la
// diferencia queda guardada para el administrador. (Detecta; no puede impedir.)
// Cada puerta trae CONTROLES: el cierre y la autorización normales siguen igual.
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

describe("Conciliación de tarjeta y transferencia al cerrar la caja", () => {
  let db: PGlite;
  let C: TestCompany;
  let admin: string;
  let product: string;

  // Un turno: abre con 100, vende en efectivo 100 y con tarjeta 200, y cierra.
  const shift = async (declared: {
    card?: number | null;
    transfer?: number | null;
  }) => {
    const cashier = await makeUser(db, C.id, "user");
    const till = crypto.randomUUID();

    await db.query(
      "insert into public.tills (id, company_id, location_id, name) values ($1,$2,$3,$4)",
      [till, C.id, C.loc1, `Caja ${till.slice(0, 4)}`],
    );

    const session = (
      await asUser(db, cashier, () =>
        db.query<{ s: string }>("select open_cash_session(100,$1,$2) as s", [
          C.loc1,
          till,
        ]),
      )
    ).rows[0].s;

    await asUser(db, cashier, () =>
      createSale(
        db,
        [{ product_id: product, qty: 1, unit_price: 0 }],
        C.loc1,
        undefined,
        {
          payments: [{ method: "Efectivo", amount: 100, kind: "cash" }],
        },
      ),
    );
    // Ventas con tarjeta: las registra un admin (un cajero no registra cobros no
    // efectivo posteriores, pero la venta en el POS sí la puede registrar).
    await asUser(db, cashier, () =>
      createSale(
        db,
        [{ product_id: product, qty: 2, unit_price: 0 }],
        C.loc1,
        undefined,
        {
          payments: [{ method: "Tarjeta", amount: 200, kind: "card" }],
        },
      ),
    );
    await asUser(db, cashier, () =>
      submitTillCount(
        db,
        session,
        [{ denomination: 100, quantity: 2 }],
        0,
        declared,
      ),
    );
    await asUser(db, cashier, () => finishTillCount(db, session));

    return session;
  };

  const authorize = (session: string) =>
    asUser(db, admin, () =>
      db.query<{
        r: {
          card_difference: number | null;
          transfer_difference: number | null;
        };
      }>("select authorize_cash_session($1,null) as r", [session]),
    ).then((x) => x.rows[0].r);

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa conciliación");
    admin = await makeUser(db, C.id, "admin");
    product = await makeProduct(db, C.id, C.loc1, "P", 1, 100, 500);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: lo declarado coincide con lo registrado -> diferencia de tarjeta 0", async () => {
    const s = await shift({ card: 200, transfer: 0 });
    const r = await authorize(s);

    expect(Number(r.card_difference)).toBe(0);
    expect(Number(r.transfer_difference)).toBe(0);
  });

  it("una venta 'Tarjeta' que la terminal no tiene queda como diferencia NEGATIVA para el admin", async () => {
    // El sistema registró 200 de tarjeta; la terminal del cajero dice 0.
    const s = await shift({ card: 0 });
    const r = await authorize(s);

    expect(Number(r.card_difference)).toBe(-200);

    const { rows } = await db.query<{ card_difference: string }>(
      "select card_difference from public.cash_sessions where id=$1",
      [s],
    );

    expect(Number(rows[0].card_difference)).toBe(-200);
  });

  it("si no se declara nada y hubo cobros con tarjeta, cuenta como declarar 0 (diferencia -total); sin cobros de transferencia queda null; el cierre no se bloquea", async () => {
    // Auditoría 2026-10 (8ª pasada): dejar el campo vacío ya no esquiva la conciliación.
    const s = await shift({});
    const r = await authorize(s);

    expect(Number(r.card_difference)).toBe(-200);
    expect(r.transfer_difference).toBeNull();
  });

  it("los totales declarados quedan guardados en el conteo", async () => {
    const s = await shift({ card: 150, transfer: 20 });
    const { rows } = await db.query<{
      declared_card_total: string;
      declared_transfer_total: string;
    }>(
      "select declared_card_total, declared_transfer_total from public.till_counts where cash_session_id=$1",
      [s],
    );

    expect(Number(rows[0].declared_card_total)).toBe(150);
    expect(Number(rows[0].declared_transfer_total)).toBe(20);
  });

  it("totales declarados negativos o NaN se rechazan", async () => {
    const cashier = await makeUser(db, C.id, "user");
    const till = crypto.randomUUID();

    await db.query(
      "insert into public.tills (id, company_id, location_id, name) values ($1,$2,$3,'Caja X')",
      [till, C.id, C.loc1],
    );

    const session = (
      await asUser(db, cashier, () =>
        db.query<{ s: string }>("select open_cash_session(0,$1,$2) as s", [
          C.loc1,
          till,
        ]),
      )
    ).rows[0].s;

    for (const bad of [-5, Number.NaN]) {
      const err = await rejects(() =>
        asUser(db, cashier, () =>
          db.query(
            "select submit_till_count($1,$2::jsonb,0,$3::numeric,null)",
            [
              session,
              JSON.stringify([{ denomination: 100, quantity: 1 }]),
              bad,
            ],
          ),
        ),
      );

      expect(err, String(bad)).toMatch(/no es valido/i);
    }
  });
});
