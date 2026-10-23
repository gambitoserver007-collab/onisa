// Auditoría de seguridad 2026-10 (12ª pasada): funciones de inventario.
//   - adjust_stock / transfer_stock / create_purchase daban stock propio a un
//     combo o a un servicio (create_sale descuenta las PIEZAS de un combo y un
//     servicio no maneja inventario).
//   - create_purchase aceptaba el proveedor de OTRA empresa y no dejaba bitácora.
//   - transfer_stock no guardaba quién hizo la transferencia.
//   - sync_product_variants aceptaba sucursales de otra empresa, stock negativo y
//     precios/costos negativos de variante.
//   - Cantidades NaN en ajustes, transferencias y compras.
// Cada puerta trae CONTROLES: lo legítimo sigue funcionando.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asUser,
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

describe("Funciones de inventario", () => {
  let db: PGlite;
  let C: TestCompany;
  let other: TestCompany;
  let admin: string;
  let operador: string;
  let standard: string;
  let combo: string;
  let service: string;
  let supplier: string;
  let foreignSupplier: string;

  const rowCount = async (productId: string) =>
    Number(
      (
        await db.query<{ n: string }>(
          "select count(*)::int as n from public.product_locations where product_id=$1",
          [productId],
        )
      ).rows[0].n,
    );

  const adjust = (productId: string, qty: number | string, loc = C.loc1) =>
    asUser(db, operador, () =>
      db.query("select adjust_stock($1,$2,$3::numeric,'prueba')", [
        productId,
        loc,
        qty,
      ]),
    );

  const purchase = (
    items: unknown[],
    supplierId: string | null = null,
    userId = operador,
  ) =>
    asUser(db, userId, () =>
      db.query("select create_purchase($1,'F-1',now(),$2,$3::jsonb)", [
        supplierId,
        C.loc1,
        JSON.stringify(items),
      ]),
    );

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa inventario");
    other = await makeCompany(db, "Otra empresa");
    admin = await makeUser(db, C.id, "admin");
    operador = await makeUser(db, C.id, "operador");
    standard = await makeProduct(db, C.id, C.loc1, "Estandar", 1, 100, 20);
    combo = await makeProduct(db, C.id, C.loc1, "Combo", 0, 100, 0);
    service = await makeProduct(db, C.id, C.loc1, "Servicio", 0, 100, 0);
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
    supplier = crypto.randomUUID();
    foreignSupplier = crypto.randomUUID();
    await db.query(
      "insert into public.suppliers (id, company_id, name) values ($1,$2,'Mio'),($3,$4,'Ajeno')",
      [supplier, C.id, foreignSupplier, other.id],
    );
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: ajustar y transferir un producto estándar funciona", async () => {
    expect(await rejects(() => adjust(standard, 5))).toBeNull();
    expect(
      await rejects(() =>
        asUser(db, operador, () =>
          db.query("select transfer_stock($1,$2,$3,2::numeric,'t')", [
            standard,
            C.loc1,
            C.loc2,
          ]),
        ),
      ),
    ).toBeNull();
  });

  it("un combo o un servicio NO reciben stock propio por ajuste, transferencia ni compra", async () => {
    for (const p of [combo, service]) {
      expect(await rejects(() => adjust(p, 5)), "ajuste").toMatch(
        /no manejan inventario/i,
      );
      expect(
        await rejects(() =>
          asUser(db, operador, () =>
            db.query("select transfer_stock($1,$2,$3,1::numeric,'t')", [
              p,
              C.loc1,
              C.loc2,
            ]),
          ),
        ),
        "transferencia",
      ).toMatch(/no manejan inventario/i);
      expect(
        await rejects(() =>
          purchase([{ product_id: p, qty: 1, unit_cost: 5 }]),
        ),
        "compra",
      ).toMatch(/no se compran/i);
      expect(await rowCount(p)).toBe(0);
    }
  });

  it("cantidades NaN se rechazan en ajuste, transferencia y compra", async () => {
    expect(await rejects(() => adjust(standard, "NaN"))).toMatch(
      /cantidad valida/i,
    );
    expect(
      await rejects(() =>
        asUser(db, operador, () =>
          db.query("select transfer_stock($1,$2,$3,'NaN'::numeric,'t')", [
            standard,
            C.loc1,
            C.loc2,
          ]),
        ),
      ),
    ).toMatch(/mayor a cero/i);
    expect(
      await rejects(() =>
        purchase([{ product_id: standard, qty: "NaN", unit_cost: 5 }]),
      ),
    ).toMatch(/mayor a 0/i);
    expect(
      await rejects(() =>
        purchase([{ product_id: standard, qty: 1, unit_cost: "NaN" }]),
      ),
    ).toMatch(/negativo/i);
  });

  it("la transferencia deja a su autor en las dos filas del kardex", async () => {
    const { rows } = await db.query<{ created_by: string | null }>(
      "select created_by from public.stock_movements where company_id=$1 and movement_type in ('transfer_out','transfer_in')",
      [C.id],
    );

    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.created_by === operador)).toBe(true);
  });

  it("una compra con el proveedor de OTRA empresa se rechaza; con el propio funciona y deja bitácora", async () => {
    const err = await rejects(() =>
      purchase(
        [{ product_id: standard, qty: 1, unit_cost: 5 }],
        foreignSupplier,
      ),
    );

    expect(err).toMatch(/Proveedor no encontrado/i);
    expect(
      await rejects(() =>
        purchase([{ product_id: standard, qty: 1, unit_cost: 5 }], supplier),
      ),
    ).toBeNull();

    const { rows } = await db.query<{ n: string }>(
      "select count(*)::int as n from public.audit_log where company_id=$1 and entity_type='purchase' and action='registered'",
      [C.id],
    );

    expect(Number(rows[0].n)).toBeGreaterThanOrEqual(1);
  });

  it("una compra de más de 200 líneas se rechaza", async () => {
    const items = Array.from({ length: 201 }, () => ({
      product_id: standard,
      qty: 1,
      unit_cost: 1,
    }));

    expect(await rejects(() => purchase(items))).toMatch(/200/);
  });

  it("sync_product_variants rechaza sucursales ajenas, stock negativo y precios negativos; lo normal funciona", async () => {
    const sync = (variant: Record<string, unknown>) =>
      asUser(db, admin, () =>
        db.query("select sync_product_variants($1,$2,$3::jsonb)", [
          standard,
          ["Talla"],
          JSON.stringify([variant]),
        ]),
      );

    expect(
      await rejects(() =>
        sync({
          attributes: { Talla: "S" },
          locations: [{ location_id: other.loc1, stock: 1 }],
        }),
      ),
    ).toMatch(/Sucursal invalida/i);
    expect(
      await rejects(() =>
        sync({
          attributes: { Talla: "S" },
          locations: [{ location_id: C.loc1, stock: -3 }],
        }),
      ),
    ).toMatch(/negativo/i);
    expect(
      await rejects(() =>
        sync({
          attributes: { Talla: "S" },
          price_override: -5,
          locations: [{ location_id: C.loc1, stock: 1 }],
        }),
      ),
    ).toMatch(/negativos/i);
    expect(
      await rejects(() =>
        sync({
          attributes: { Talla: "M" },
          price_override: 120,
          cost_override: 60,
          locations: [{ location_id: C.loc1, stock: 4 }],
        }),
      ),
    ).toBeNull();
  });
});
