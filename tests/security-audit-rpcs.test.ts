// Pruebas SQL (PGlite) de la auditoría de seguridad 2026-10, puertas 6-10:
//   Puerta 6   sync_product_variants solo para admin.
//   Puerta 7   create_purchase solo para roles de operación.
//   Puerta 8   un cajero no puede borrar clientes (se archivan con deleted_at).
//   Puerta 9   las RPC de dinero/stock respetan la restricción por sucursal
//              (profile_locations) y create_sale valida la sucursal.
//   Puerta 10  pin_hash y horario del empleado solo los cambia un admin.
// Cada puerta trae un CONTROL: el caso legítimo sigue funcionando.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asUser,
  createSale,
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

describe("Puertas 6, 7, 8 y 10: roles dentro de una empresa", () => {
  let db: PGlite;
  let C: TestCompany;
  let admin: string;
  let cajero: string;
  let operador: string;
  let prodVar: string;
  let prodVarAdmin: string;
  let prodBuy: string;

  const variantJson = (locationId: string) =>
    JSON.stringify([
      {
        attributes: { Talla: "M" },
        price_override: 0.01,
        cost_override: 0,
        locations: [{ location_id: locationId, stock: 999 }],
      },
    ]);

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa roles");
    admin = await makeUser(db, C.id, "admin");
    cajero = await makeUser(db, C.id, "user");
    operador = await makeUser(db, C.id, "operador");
    prodVar = await makeProduct(db, C.id, C.loc1, "Con variantes", 10, 20, 50);
    prodVarAdmin = await makeProduct(
      db,
      C.id,
      C.loc1,
      "Variantes admin",
      10,
      20,
      50,
    );
    prodBuy = await makeProduct(db, C.id, C.loc1, "Para compras", 10, 20, 50);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  // ----- Puerta 6
  it("CONTROL (6): el admin sí puede sincronizar variantes", async () => {
    const err = await rejects(() =>
      asUser(db, admin, () =>
        db.query("select sync_product_variants($1, $2, $3::jsonb)", [
          prodVarAdmin,
          ["Talla"],
          variantJson(C.loc1),
        ]),
      ),
    );

    expect(err).toBeNull();
  });

  it("(6) un cajero NO puede sincronizar variantes (precio/costo/stock)", async () => {
    const err = await rejects(() =>
      asUser(db, cajero, () =>
        db.query("select sync_product_variants($1, $2, $3::jsonb)", [
          prodVar,
          ["Talla"],
          variantJson(C.loc1),
        ]),
      ),
    );

    expect(err).toMatch(/administrador/i);

    const { rows } = await db.query<{ n: string }>(
      "select count(*)::int as n from public.product_variants where product_id=$1",
      [prodVar],
    );

    expect(Number(rows[0].n)).toBe(0);
  });

  // ----- Puerta 7
  const purchaseItems = (productId: string) =>
    JSON.stringify([{ product_id: productId, qty: 5, unit_cost: 1 }]);

  it("(7) un cajero NO puede registrar una compra ni cambiar el costo", async () => {
    const err = await rejects(() =>
      asUser(db, cajero, () =>
        db.query("select create_purchase(null, 'X', now(), $1, $2::jsonb)", [
          C.loc1,
          purchaseItems(prodBuy),
        ]),
      ),
    );

    expect(err).toMatch(/permiso/i);

    const { rows } = await db.query<{ cost: string }>(
      "select cost from public.products where id=$1",
      [prodBuy],
    );

    expect(Number(rows[0].cost)).toBe(10);
  });

  it("CONTROL (7): un operador sí puede registrar una compra", async () => {
    const err = await rejects(() =>
      asUser(db, operador, () =>
        db.query("select create_purchase(null, 'X', now(), $1, $2::jsonb)", [
          C.loc1,
          purchaseItems(prodBuy),
        ]),
      ),
    );

    expect(err).toBeNull();

    const { rows } = await db.query<{ cost: string }>(
      "select cost from public.products where id=$1",
      [prodBuy],
    );

    expect(Number(rows[0].cost)).toBe(1);
  });

  // ----- Puerta 8
  it("(8) un cajero NO puede borrar un cliente (se perdería su deuda)", async () => {
    const customer = await makeCustomer(db, C.id, "Deudor", 0);

    const err = await rejects(() =>
      asUser(db, cajero, () =>
        db.query("delete from public.customers where id=$1", [customer]),
      ),
    );

    expect(err).toBeTruthy();

    const { rows } = await db.query<{ n: string }>(
      "select count(*)::int as n from public.customers where id=$1",
      [customer],
    );

    expect(Number(rows[0].n)).toBe(1);
  });

  it("CONTROL (8): un cajero sí puede archivar un cliente (deleted_at), como hace la app", async () => {
    const customer = await makeCustomer(db, C.id, "Para archivar", 0);

    const res = await asUser(db, cajero, () =>
      db.query(
        "update public.customers set deleted_at=now() where id=$1 returning id",
        [customer],
      ),
    );

    expect(res.rows).toHaveLength(1);
  });

  // ----- Puerta 10
  it("(10) un empleado NO puede cambiarse el horario ni el PIN", async () => {
    const shiftErr = await rejects(() =>
      asUser(db, cajero, () =>
        db.query(
          "update public.profiles set shift_start='23:59', shift_end='23:59' where id=$1",
          [cajero],
        ),
      ),
    );
    const pinErr = await rejects(() =>
      asUser(db, cajero, () =>
        db.query(
          "update public.profiles set pin_hash=crypt('1234', gen_salt('bf')) where id=$1",
          [cajero],
        ),
      ),
    );

    expect(shiftErr).toMatch(/administrador/i);
    expect(pinErr).toMatch(/administrador/i);
  });

  it("CONTROL (10): el admin sí puede fijar el horario y el PIN de un empleado; el empleado sí edita su nombre", async () => {
    const shiftErr = await rejects(() =>
      asUser(db, admin, () =>
        db.query(
          "update public.profiles set shift_start='09:00', shift_end='18:00' where id=$1",
          [cajero],
        ),
      ),
    );
    const pinErr = await rejects(() =>
      asUser(db, admin, () =>
        db.query("select set_employee_pin($1, '4321')", [cajero]),
      ),
    );
    const nameErr = await rejects(() =>
      asUser(db, cajero, () =>
        db.query(
          "update public.profiles set full_name='Nuevo nombre' where id=$1",
          [cajero],
        ),
      ),
    );

    expect(shiftErr).toBeNull();
    expect(pinErr).toBeNull();
    expect(nameErr).toBeNull();
  });
});

describe("Puerta 9: restricción por sucursal en las RPC de dinero y stock", () => {
  let db: PGlite;
  let C: TestCompany;
  let other: TestCompany;
  let cajeroR: string;
  let operadorR: string;
  let operadorFree: string;
  let adminC: string;
  let prod1: string;
  let prod2: string;

  const NO_ACCESS = /acceso a esta sucursal/i;

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa sucursales");
    other = await makeCompany(db, "Empresa ajena");
    adminC = await makeUser(db, C.id, "admin");
    cajeroR = await makeUser(db, C.id, "user");
    operadorR = await makeUser(db, C.id, "operador");
    operadorFree = await makeUser(db, C.id, "operador");
    // cajeroR y operadorR quedan restringidos a la sucursal 1.
    for (const profileId of [cajeroR, operadorR]) {
      await db.query(
        "insert into public.profile_locations (company_id, profile_id, location_id) values ($1,$2,$3)",
        [C.id, profileId, C.loc1],
      );
    }
    prod1 = await makeProduct(db, C.id, C.loc1, "Producto suc 1", 1, 10, 50);
    prod2 = await makeProduct(db, C.id, C.loc2, "Producto suc 2", 1, 10, 50);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  const stockAt = async (productId: string, locationId: string) => {
    const { rows } = await db.query<{ stock: string }>(
      "select stock from public.product_locations where product_id=$1 and location_id=$2",
      [productId, locationId],
    );

    return Number(rows[0]?.stock ?? 0);
  };

  it("CONTROL: un cajero restringido a la sucursal 1 sí vende en la sucursal 1", async () => {
    const err = await rejects(() =>
      asUser(db, cajeroR, () =>
        createSale(db, [{ product_id: prod1, qty: 1, unit_price: 10 }], C.loc1),
      ),
    );

    expect(err).toBeNull();
  });

  it("un cajero restringido NO puede vender en la sucursal 2", async () => {
    const err = await rejects(() =>
      asUser(db, cajeroR, () =>
        createSale(db, [{ product_id: prod2, qty: 1, unit_price: 10 }], C.loc2),
      ),
    );

    expect(err).toMatch(NO_ACCESS);
    expect(await stockAt(prod2, C.loc2)).toBe(50);
  });

  it("create_sale rechaza una sucursal de OTRA empresa", async () => {
    const err = await rejects(() =>
      asUser(db, adminC, () =>
        createSale(
          db,
          [{ product_id: prod1, qty: 1, unit_price: 10 }],
          other.loc1,
        ),
      ),
    );

    expect(err).toMatch(/Sucursal invalida/i);
  });

  it("un cajero restringido NO puede abrir caja en la sucursal 2", async () => {
    const err = await rejects(() =>
      asUser(db, cajeroR, () =>
        db.query("select open_cash_session(0, $1)", [C.loc2]),
      ),
    );

    expect(err).toMatch(NO_ACCESS);
  });

  it("CONTROL: ese cajero sí puede abrir caja en la sucursal 1", async () => {
    const err = await rejects(() =>
      asUser(db, cajeroR, () =>
        db.query("select open_cash_session(0, $1)", [C.loc1]),
      ),
    );

    expect(err).toBeNull();
  });

  it("un operador restringido NO puede registrar compras en la sucursal 2 (y sí en la 1)", async () => {
    const items = (p: string) =>
      JSON.stringify([{ product_id: p, qty: 3, unit_cost: 1 }]);
    const bad = await rejects(() =>
      asUser(db, operadorR, () =>
        db.query("select create_purchase(null, 'X', now(), $1, $2::jsonb)", [
          C.loc2,
          items(prod2),
        ]),
      ),
    );
    const good = await rejects(() =>
      asUser(db, operadorR, () =>
        db.query("select create_purchase(null, 'X', now(), $1, $2::jsonb)", [
          C.loc1,
          items(prod1),
        ]),
      ),
    );

    expect(bad).toMatch(NO_ACCESS);
    expect(good).toBeNull();
  });

  it("un operador restringido NO puede mover stock desde/hacia la sucursal 2; uno sin restricción sí", async () => {
    const bad = await rejects(() =>
      asUser(db, operadorR, () =>
        db.query("select transfer_stock($1, $2, $3, 1)", [
          prod2,
          C.loc2,
          C.loc1,
        ]),
      ),
    );
    const good = await rejects(() =>
      asUser(db, operadorFree, () =>
        db.query("select transfer_stock($1, $2, $3, 1)", [
          prod2,
          C.loc2,
          C.loc1,
        ]),
      ),
    );

    expect(bad).toMatch(NO_ACCESS);
    expect(good).toBeNull();
  });

  it("un cajero restringido NO puede registrar una devolución en la sucursal 2 (y sí en la 1)", async () => {
    const sale = await asUser(db, cajeroR, () =>
      createSale(db, [{ product_id: prod1, qty: 2, unit_price: 10 }], C.loc1),
    );
    const { rows } = await db.query<{ id: string }>(
      "select id from public.sale_items where sale_id=$1 limit 1",
      [sale.sale_id],
    );
    const items = JSON.stringify([{ sale_item_id: rows[0].id, qty: 1 }]);

    const bad = await rejects(() =>
      asUser(db, cajeroR, () =>
        db.query("select create_return($1, 'x', $2::jsonb, $3, false)", [
          sale.sale_id,
          items,
          C.loc2,
        ]),
      ),
    );
    const good = await rejects(() =>
      asUser(db, cajeroR, () =>
        db.query("select create_return($1, 'x', $2::jsonb, $3, false)", [
          sale.sale_id,
          items,
          C.loc1,
        ]),
      ),
    );

    expect(bad).toMatch(NO_ACCESS);
    expect(good).toBeNull();
  });
});
