// Auditoría de seguridad 2026-10 (3ª pasada): devoluciones de combos y servicios.
// create_sale descuenta las PIEZAS de un combo y nunca toca el stock de un
// servicio; create_return, en cambio, le sumaba existencias al propio renglón
// del combo/servicio (un servicio "con 1 pieza", un combo con stock propio) y
// nunca devolvía las piezas. Ahora el combo regresa sus piezas y el servicio
// no maneja inventario.
// Cada puerta trae CONTROLES: lo legítimo sigue funcionando.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asUser,
  createSale,
  createTestDb,
  makeCompany,
  makeProduct,
  makeUser,
  type TestCompany,
} from "./helpers/db";

describe("Devoluciones: combos y servicios", () => {
  let db: PGlite;
  let C: TestCompany;
  let cashier: string;
  let pieceA: string;
  let pieceB: string;
  let combo: string;
  let service: string;
  let standard: string;

  const stockAt = async (productId: string) => {
    const { rows } = await db.query<{ stock: string }>(
      "select stock from public.product_locations where product_id=$1 and location_id=$2",
      [productId, C.loc1],
    );

    return rows.length ? Number(rows[0].stock) : null;
  };

  const rowCount = async (productId: string) =>
    Number(
      (
        await db.query<{ n: string }>(
          "select count(*)::int as n from public.product_locations where product_id=$1",
          [productId],
        )
      ).rows[0].n,
    );

  const sell = (productId: string, qty: number) =>
    asUser(db, cashier, () =>
      createSale(db, [{ product_id: productId, qty, unit_price: 100 }], C.loc1),
    );

  const giveBack = async (saleId: string, qty: number) => {
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
    C = await makeCompany(db, "Empresa combos");
    cashier = await makeUser(db, C.id, "user");

    pieceA = await makeProduct(db, C.id, C.loc1, "Pieza A", 1, 50, 50);
    pieceB = await makeProduct(db, C.id, C.loc1, "Pieza B", 1, 50, 50);
    standard = await makeProduct(db, C.id, C.loc1, "Estandar", 1, 100, 20);
    combo = await makeProduct(db, C.id, C.loc1, "Combo", 0, 100, 0);
    service = await makeProduct(db, C.id, C.loc1, "Servicio", 0, 100, 0);

    // Un combo y un servicio reales nunca tienen fila propia de stock.
    await db.query(
      "delete from public.product_locations where product_id = any($1)",
      [[combo, service]],
    );
    await db.query(
      "update public.products set product_type='combo' where id=$1",
      [combo],
    );
    await db.query(
      "update public.products set product_type='service' where id=$1",
      [service],
    );
    await db.query(
      "insert into public.product_combo_items (company_id, combo_product_id, component_product_id, qty) values ($1,$2,$3,2),($1,$2,$4,1)",
      [C.id, combo, pieceA, pieceB],
    );

    await asUser(db, cashier, () =>
      db.query("select open_cash_session(0,$1)", [C.loc1]),
    );
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: devolver un producto estándar le regresa sus existencias", async () => {
    const sale = await sell(standard, 3);

    expect(await stockAt(standard)).toBe(17);

    await giveBack(sale.sale_id, 2);

    expect(await stockAt(standard)).toBe(19);
  });

  it("devolver un combo regresa sus PIEZAS, no crea existencias del combo", async () => {
    const sale = await sell(combo, 2);

    // 2 combos = 4 de A y 2 de B.
    expect(await stockAt(pieceA)).toBe(46);
    expect(await stockAt(pieceB)).toBe(48);

    await giveBack(sale.sale_id, 1);

    expect(await stockAt(pieceA)).toBe(48);
    expect(await stockAt(pieceB)).toBe(49);
    expect(await rowCount(combo)).toBe(0);

    // Devolución del resto: todo vuelve a como estaba.
    await giveBack(sale.sale_id, 1);

    expect(await stockAt(pieceA)).toBe(50);
    expect(await stockAt(pieceB)).toBe(50);
    expect(await rowCount(combo)).toBe(0);
  });

  it("la devolución del combo deja un movimiento por cada pieza y el stock total cuadra", async () => {
    const { rows } = await db.query<{ product_id: string; qty: string }>(
      `select product_id, qty from public.stock_movements
       where movement_type='return' and notes like '%pieza del combo%'
       order by qty`,
    );

    // 1 combo devuelto dos veces: 2 piezas A (x2 unidades) y 1 pieza B.
    const total = rows.reduce((sum, r) => sum + Number(r.qty), 0);

    expect(total).toBe(6);
    expect(rows.every((r) => [pieceA, pieceB].includes(r.product_id))).toBe(
      true,
    );

    const { rows: totals } = await db.query<{ stock: string }>(
      "select stock from public.products where id=$1",
      [pieceA],
    );

    expect(Number(totals[0].stock)).toBe(50);
  });

  it("devolver un servicio no le crea existencias, pero sí reembolsa", async () => {
    const sale = await sell(service, 1);

    expect(await rowCount(service)).toBe(0);

    await giveBack(sale.sale_id, 1);

    expect(await rowCount(service)).toBe(0);

    const mov = await db.query<{ n: string }>(
      "select count(*)::int as n from public.stock_movements where product_id=$1",
      [service],
    );

    expect(Number(mov.rows[0].n)).toBe(0);

    const ret = await db.query<{ total: string }>(
      "select total from public.returns where sale_id=$1",
      [sale.sale_id],
    );

    expect(Number(ret.rows[0].total)).toBeCloseTo(sale.total, 2);
  });
});
