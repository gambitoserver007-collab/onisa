// Auditoría de seguridad 2026-10 (2ª pasada):
//   - El límite de productos del plan también aplica al RESTAURAR productos
//     borrados (antes solo se revisaba al insertar).
//   - NaN no entra a ninguna columna numérica (antes pasaba las validaciones
//     "<= 0" de las RPC y envenenaba totales, stock y costos).
// Cada puerta trae CONTROLES: lo legítimo sigue funcionando.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asUser,
  createSale,
  createTestDb,
  errMessage,
  makeCompany,
  makePlan,
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

describe("Límite de productos: restaurar productos borrados", () => {
  let db: PGlite;
  let C: TestCompany;
  let admin: string;

  const insert = (name: string) =>
    asUser(db, admin, () =>
      db.query<{ id: string }>(
        "insert into public.products (company_id, name, cost, price, stock, unit) values ($1,$2,1,1,0,'und') returning id",
        [C.id, name],
      ),
    ).then((r) => r.rows[0].id);

  const setDeleted = (ids: string[], deleted: boolean) =>
    asUser(db, admin, () =>
      db.query(
        `update public.products set deleted_at = ${deleted ? "now()" : "null"} where id = any($1::uuid[])`,
        [ids],
      ),
    );

  const live = async () =>
    Number(
      (
        await db.query<{ n: string }>(
          "select count(*)::int as n from public.products where company_id=$1 and deleted_at is null",
          [C.id],
        )
      ).rows[0].n,
    );

  let p1: string;
  let p2: string;
  let p3: string;
  let p4: string;

  beforeAll(async () => {
    db = await createTestDb();
    const plan = await makePlan(db, "Mini", 2, 5, 100);

    C = await makeCompany(db, "Empresa límite", { planId: plan });
    admin = await makeUser(db, C.id, "admin");
    p1 = await insert("p1");
    p2 = await insert("p2");
    await setDeleted([p1, p2], true);
    p3 = await insert("p3");
    p4 = await insert("p4");
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: un 5º producto nuevo sigue rechazado por el límite (insert)", async () => {
    expect(await rejects(() => insert("p5"))).toMatch(/limite de productos/i);
  });

  it("CONTROL: editar un producto vivo estando en el límite no se bloquea", async () => {
    const err = await rejects(() =>
      asUser(db, admin, () =>
        db.query("update public.products set price = 5 where id = $1", [p3]),
      ),
    );

    expect(err).toBeNull();
  });

  it("NO se pueden restaurar productos borrados si eso rebasa el límite", async () => {
    const err = await rejects(() => setDeleted([p1], false));

    expect(err).toMatch(/limite de productos/i);
    expect(await live()).toBe(2);
  });

  it("CONTROL: con espacio disponible, restaurar un producto sí funciona", async () => {
    await setDeleted([p3], true);

    expect(await rejects(() => setDeleted([p1], false))).toBeNull();
    expect(await live()).toBe(2);

    // Y borrar (soft delete) sigue sin revisarse.
    expect(await rejects(() => setDeleted([p4], true))).toBeNull();
  });
});

describe("NaN en columnas numéricas", () => {
  let db: PGlite;
  let C: TestCompany;
  let cashier: string;
  let admin: string;
  let service: string;
  let standard: string;

  const sellService = (qty: number | string) =>
    asUser(db, cashier, () =>
      db.query("select create_sale(null,'Ticket','Efectivo',$1::jsonb,$2)", [
        JSON.stringify([{ product_id: service, qty }]),
        C.loc1,
      ]),
    );

  const stockOf = async (productId: string) =>
    (
      await db.query<{ stock: string }>(
        "select stock from public.product_locations where product_id=$1 and location_id=$2",
        [productId, C.loc1],
      )
    ).rows[0].stock;

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa NaN");
    cashier = await makeUser(db, C.id, "user");
    admin = await makeUser(db, C.id, "admin");
    service = await makeProduct(db, C.id, C.loc1, "Servicio", 0, 50, 0);
    await db.query(
      "update public.products set product_type='service' where id=$1",
      [service],
    );
    standard = await makeProduct(db, C.id, C.loc1, "Normal", 2, 10, 5);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: cantidades normales (con decimales) siguen funcionando", async () => {
    expect(await rejects(() => sellService(1.5))).toBeNull();
    expect(
      await rejects(() =>
        asUser(db, cashier, () =>
          db.query(
            "select register_merma($1,'otro',null,$2,1::numeric,null,null)",
            [C.loc1, standard],
          ),
        ),
      ),
    ).toBeNull();
    expect(
      await rejects(() =>
        asUser(db, admin, () =>
          db.query("select create_purchase(null,'F',now(),$1,$2::jsonb)", [
            C.loc1,
            JSON.stringify([{ product_id: standard, qty: 2, unit_cost: 2.5 }]),
          ]),
        ),
      ),
    ).toBeNull();
  });

  it("una venta con cantidad NaN se rechaza y no deja ninguna venta", async () => {
    const before = Number(
      (
        await db.query<{ n: string }>(
          "select count(*)::int as n from public.sales where company_id=$1",
          [C.id],
        )
      ).rows[0].n,
    );

    expect(await rejects(() => sellService("NaN"))).toBeTruthy();

    const after = Number(
      (
        await db.query<{ n: string }>(
          "select count(*)::int as n from public.sales where company_id=$1",
          [C.id],
        )
      ).rows[0].n,
    );

    expect(after).toBe(before);

    const { rows } = await db.query<{ total: string }>(
      "select coalesce(sum(total),0) as total from public.sales where company_id=$1",
      [C.id],
    );

    expect(rows[0].total).not.toBe("NaN");
  });

  it("una cotización con cantidad NaN se rechaza", async () => {
    const err = await rejects(() =>
      asUser(db, cashier, () =>
        db.query("select create_quote($1::jsonb,null,null,$2)", [
          JSON.stringify([{ product_id: service, qty: "NaN" }]),
          C.loc1,
        ]),
      ),
    );

    expect(err).toBeTruthy();
  });

  it("una merma con cantidad NaN se rechaza y el stock no cambia", async () => {
    const before = await stockOf(standard);
    const err = await rejects(() =>
      asUser(db, cashier, () =>
        db.query(
          "select register_merma($1,'otro',null,$2,'NaN'::numeric,null,null)",
          [C.loc1, standard],
        ),
      ),
    );

    expect(err).toBeTruthy();
    expect(await stockOf(standard)).toBe(before);
    expect(await stockOf(standard)).not.toBe("NaN");
  });

  it("una compra con costo NaN se rechaza y el costo del producto no cambia", async () => {
    const before = (
      await db.query<{ cost: string }>(
        "select cost from public.products where id=$1",
        [standard],
      )
    ).rows[0].cost;
    const err = await rejects(() =>
      asUser(db, admin, () =>
        db.query("select create_purchase(null,'F',now(),$1,$2::jsonb)", [
          C.loc1,
          JSON.stringify([{ product_id: standard, qty: 1, unit_cost: "NaN" }]),
        ]),
      ),
    );
    const after = (
      await db.query<{ cost: string }>(
        "select cost from public.products where id=$1",
        [standard],
      )
    ).rows[0].cost;

    expect(err).toBeTruthy();
    expect(after).toBe(before);
  });

  it("una escritura directa de NaN (precio, stock) se rechaza", async () => {
    const price = await rejects(() =>
      asUser(db, admin, () =>
        db.query("update public.products set price='NaN' where id=$1", [
          standard,
        ]),
      ),
    );
    const stock = await rejects(() =>
      asUser(db, admin, () =>
        db.query(
          "update public.product_locations set stock='NaN' where product_id=$1",
          [standard],
        ),
      ),
    );

    expect(price).toBeTruthy();
    expect(stock).toBeTruthy();
  });

  it("CONTROL: el flujo normal de venta sigue sumando sin NaN", async () => {
    await asUser(db, cashier, () =>
      createSale(
        db,
        [{ product_id: standard, qty: 1, unit_price: 10 }],
        C.loc1,
      ),
    );

    const { rows } = await db.query<{ total: string }>(
      "select coalesce(sum(total),0) as total from public.sales where company_id=$1",
      [C.id],
    );

    expect(rows[0].total).not.toBe("NaN");
    expect(Number(rows[0].total)).toBeGreaterThan(0);
  });
});
