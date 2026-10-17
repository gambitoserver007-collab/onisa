// Auditoría de seguridad 2026-10 (3ª pasada):
//   - El rol operador (almacén) no puede llamar las RPC de ventas, caja,
//     devoluciones ni cobro de crédito aunque la pantalla no se lo muestre.
//   - Borrar una sucursal ya no libera a los empleados restringidos solo a
//     ella (antes quedaban sin filas = "sin restricción" = todas las sucursales).
// Cada puerta trae CONTROLES: lo legítimo sigue funcionando.
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

describe("Rol operador: ventas, caja, devoluciones y cobro de crédito", () => {
  let db: PGlite;
  let C: TestCompany;
  let cashier: string;
  let gerente: string;
  let operador: string;
  let product: string;
  let customer: string;
  let sessionId: string;
  let saleId: string;

  const doReturn = async (userId: string) => {
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

  const collect = (userId: string) =>
    asUser(db, userId, () =>
      db.query("select collect_customer_credit($1, 10, 'Efectivo', 'cash')", [
        customer,
      ]),
    );

  const balance = async () =>
    Number(
      (
        await db.query<{ b: string }>(
          "select credit_balance as b from public.customers where id=$1",
          [customer],
        )
      ).rows[0].b,
    );

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa roles");
    cashier = await makeUser(db, C.id, "user");
    gerente = await makeUser(db, C.id, "gerente");
    operador = await makeUser(db, C.id, "operador");
    product = await makeProduct(db, C.id, C.loc1, "P", 1, 100, 500);
    customer = crypto.randomUUID();
    await db.query(
      "insert into public.customers (id, company_id, name, credit_balance, credit_limit) values ($1,$2,'Deudor',500,1000)",
      [customer, C.id],
    );
    sessionId = (
      await asUser(db, cashier, () =>
        db.query<{ s: string }>("select open_cash_session(100,$1) as s", [
          C.loc1,
        ]),
      )
    ).rows[0].s;
    saleId = (
      await asUser(db, cashier, () =>
        createSale(
          db,
          [{ product_id: product, qty: 2, unit_price: 100 }],
          C.loc1,
        ),
      )
    ).sale_id;
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: el cajero sí vende, devuelve y cobra crédito", async () => {
    expect(await rejects(() => doReturn(cashier))).toBeNull();
    expect(await rejects(() => collect(cashier))).toBeNull();
    expect(await balance()).toBe(490);
  });

  it("CONTROL: el gerente sí vende y cobra crédito", async () => {
    const sale = await rejects(() =>
      asUser(db, gerente, () =>
        createSale(
          db,
          [{ product_id: product, qty: 1, unit_price: 100 }],
          C.loc1,
        ),
      ),
    );

    expect(sale).toBeNull();
    expect(await rejects(() => collect(gerente))).toBeNull();
    expect(await balance()).toBe(480);
  });

  it("un operador NO puede cobrar crédito (no borra deudas de clientes)", async () => {
    const err = await rejects(() => collect(operador));

    expect(err).toMatch(/No tienes permiso/i);
    expect(await balance()).toBe(480);
  });

  it("un operador NO puede registrar una venta ni abrir una caja", async () => {
    const sale = await rejects(() =>
      asUser(db, operador, () =>
        createSale(
          db,
          [{ product_id: product, qty: 1, unit_price: 100 }],
          C.loc1,
        ),
      ),
    );
    const open = await rejects(() =>
      asUser(db, operador, () =>
        db.query("select open_cash_session(0,$1)", [C.loc1]),
      ),
    );

    expect(sale).toMatch(/No tienes permiso/i);
    expect(open).toMatch(/No tienes permiso/i);
  });

  it("un operador NO puede registrar una devolución", async () => {
    const err = await rejects(() => doReturn(operador));

    expect(err).toMatch(/No tienes permiso/i);
  });

  it("un operador NO puede contar ni cerrar una caja", async () => {
    const count = await rejects(() =>
      asUser(db, operador, () =>
        submitTillCount(db, sessionId, [{ denomination: 100, quantity: 1 }]),
      ),
    );
    const finish = await rejects(() =>
      asUser(db, operador, () => finishTillCount(db, sessionId)),
    );

    expect(count).toMatch(/No tienes permiso/i);
    expect(finish).toMatch(/No tienes permiso/i);
  });

  it("CONTROL: el operador conserva lo suyo de almacén (ajustar stock)", async () => {
    const err = await rejects(() =>
      asUser(db, operador, () =>
        db.query("select adjust_stock($1, $2, 5, 'ajuste de prueba')", [
          product,
          C.loc1,
        ]),
      ),
    );

    expect(err).toBeNull();
  });
});

describe("Sucursal borrada: el empleado restringido no queda libre", () => {
  let db: PGlite;
  let C: TestCompany;
  let admin: string;
  let cashier: string;
  let productLoc1: string;

  const restrict = (locationId: string) =>
    db.query(
      "insert into public.profile_locations (company_id, profile_id, location_id) values ($1,$2,$3)",
      [C.id, cashier, locationId],
    );

  const deleteLocation = (locationId: string) =>
    asUser(db, admin, () =>
      db.query("delete from public.locations where id=$1", [locationId]),
    );

  const cashierSellsAt = (locationId: string, productId: string) =>
    asUser(db, cashier, () =>
      createSale(
        db,
        [{ product_id: productId, qty: 1, unit_price: 100 }],
        locationId,
      ),
    );

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa sucursales");
    admin = await makeUser(db, C.id, "admin");
    cashier = await makeUser(db, C.id, "user");
    productLoc1 = await makeProduct(db, C.id, C.loc1, "P1", 1, 100, 500);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: borrar una sucursal sin empleados restringidos a ella funciona", async () => {
    const free = crypto.randomUUID();

    await db.query(
      "insert into public.locations (id, company_id, name) values ($1,$2,'Sobrante')",
      [free, C.id],
    );

    expect(await rejects(() => deleteLocation(free))).toBeNull();
  });

  it("NO se puede borrar la única sucursal de un empleado restringido", async () => {
    await restrict(C.loc2);

    const err = await rejects(() => deleteLocation(C.loc2));

    expect(err).toMatch(/restringidos solo a ella/i);

    // La sucursal y la restricción siguen ahí: el cajero no puede usar loc1.
    const { rows } = await db.query<{ n: string }>(
      "select count(*)::int as n from public.profile_locations where profile_id=$1",
      [cashier],
    );

    expect(Number(rows[0].n)).toBe(1);

    const sale = await rejects(() => cashierSellsAt(C.loc1, productLoc1));

    expect(sale).toMatch(/acceso a esta sucursal/i);
  });

  it("CONTROL: reasignando al empleado a otra sucursal ya se puede borrar, y sigue restringido", async () => {
    await restrict(C.loc1);

    expect(await rejects(() => deleteLocation(C.loc2))).toBeNull();

    // Sigue restringido a loc1: vende ahí, no en una sucursal nueva.
    expect(await rejects(() => cashierSellsAt(C.loc1, productLoc1))).toBeNull();

    const other = crypto.randomUUID();

    await db.query(
      "insert into public.locations (id, company_id, name) values ($1,$2,'Nueva')",
      [other, C.id],
    );

    const otherProduct = await makeProduct(db, C.id, other, "P3", 1, 100, 500);
    const blocked = await rejects(() => cashierSellsAt(other, otherProduct));

    expect(blocked).toMatch(/acceso a esta sucursal/i);
  });

  it("CONTROL: borrar la empresa completa (cascade) no se bloquea por esta regla", async () => {
    const C2 = await makeCompany(db, "Empresa a borrar");
    const worker = await makeUser(db, C2.id, "user");

    await db.query(
      "insert into public.profile_locations (company_id, profile_id, location_id) values ($1,$2,$3)",
      [C2.id, worker, C2.loc1],
    );

    const err = await rejects(() =>
      db.query("delete from public.companies where id=$1", [C2.id]),
    );

    expect(err).toBeNull();
  });
});
