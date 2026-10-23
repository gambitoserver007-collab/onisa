// Auditoría de seguridad 2026-10 (6ª pasada): cuatro puertas bajas.
//   1. get_cash_session_cash_sales fallaba ABIERTA para quien no tiene perfil
//      activo (empleado desactivado con sesión vigente): leía el efectivo de la
//      caja de otra empresa. Mismas guardas nulas en funciones hermanas.
//   2. Un admin en modo demo (solo lectura) podía editar y borrar perfiles.
//   3. create_return redondeaba cada devolución por separado: devolviendo de a
//      0.001 se reembolsaba el doble de lo pagado.
//   4. create_sale / create_quote / convert_quote_to_sale vendían un producto con
//      variantes sin variante (precio base y stock viejo).
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
  type CartLine,
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

describe("Puerta 1: get_cash_session_cash_sales no falla abierta sin perfil activo", () => {
  let db: PGlite;
  let A: TestCompany;
  let B: TestCompany;
  let sessionA: string;
  let adminA: string;
  let deactivatedB: string;
  let activeB: string;

  const total = (userId: string) =>
    asUser(db, userId, () =>
      db.query<{ t: string }>("select get_cash_session_cash_sales($1) as t", [
        sessionA,
      ]),
    );

  beforeAll(async () => {
    db = await createTestDb();
    A = await makeCompany(db, "Empresa A");
    B = await makeCompany(db, "Empresa B");
    adminA = await makeUser(db, A.id, "admin");

    const cashierA = await makeUser(db, A.id, "user");
    const product = await makeProduct(db, A.id, A.loc1, "P", 1, 100, 50);

    sessionA = (
      await asUser(db, cashierA, () =>
        db.query<{ s: string }>("select open_cash_session(0,$1) as s", [
          A.loc1,
        ]),
      )
    ).rows[0].s;
    await asUser(db, cashierA, () =>
      createSale(
        db,
        [{ product_id: product, qty: 2, unit_price: 100 }],
        A.loc1,
      ),
    );
    activeB = await makeUser(db, B.id, "admin");
    deactivatedB = await makeUser(db, B.id, "admin");
    await db.query("update public.profiles set is_active=false where id=$1", [
      deactivatedB,
    ]);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: el admin de la empresa dueña de la caja sí ve el total", async () => {
    expect(Number((await total(adminA)).rows[0].t)).toBe(200);
  });

  it("CONTROL: un admin ACTIVO de otra empresa sigue rechazado", async () => {
    expect(await rejects(() => total(activeB))).toMatch(/No autorizado/i);
  });

  it("un usuario DESACTIVADO de otra empresa ya no lee el efectivo (antes devolvía 200)", async () => {
    const err = await rejects(() => total(deactivatedB));

    expect(err).toMatch(/empresa asociada/i);
  });

  it("las funciones hermanas también rechazan expresamente a quien no tiene empresa activa", async () => {
    const calls: [string, unknown[]][] = [
      ["select delete_merma($1)", [crypto.randomUUID()]],
      ["select cancel_apartado($1, true)", [crypto.randomUUID()]],
      ["select discard_quote_request($1)", [crypto.randomUUID()]],
    ];

    for (const [sql, params] of calls) {
      const err = await rejects(() =>
        asUser(db, deactivatedB, () => db.query(sql, params)),
      );

      expect(err, sql).toMatch(/empresa asociada/i);
    }
  });
});

describe("Puerta 2: el modo demo no puede editar ni borrar perfiles", () => {
  let db: PGlite;
  let C: TestCompany;
  let demoAdmin: string;
  let normalAdmin: string;
  let victim: string;

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa demo");
    demoAdmin = await makeUser(db, C.id, "admin");
    normalAdmin = await makeUser(db, C.id, "admin");
    victim = await makeUser(db, C.id, "user");
    await db.query(
      "update public.profiles set is_demo=true, demo_mode='read_only' where id=$1",
      [demoAdmin],
    );
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: un admin normal sí edita el nombre de un compañero", async () => {
    const r = await asUser(db, normalAdmin, () =>
      db.query(
        "update public.profiles set full_name='Renombrado' where id=$1 returning id",
        [victim],
      ),
    );

    expect(r.rows).toHaveLength(1);
  });

  it("el admin demo NO puede cambiar nombre ni PIN de otro perfil", async () => {
    for (const set of ["full_name='x'", "pin_hash='x'"]) {
      const err = await rejects(() =>
        asUser(db, demoAdmin, () =>
          db.query(`update public.profiles set ${set} where id=$1`, [victim]),
        ),
      );

      expect(err, set).toMatch(/Modo de Prueba/i);
    }
  });

  it("el admin demo NO puede borrar perfiles y el perfil sigue ahí", async () => {
    const err = await rejects(() =>
      asUser(db, demoAdmin, () =>
        db.query("delete from public.profiles where id=$1", [victim]),
      ),
    );
    const { rows } = await db.query<{ n: string }>(
      "select count(*)::int as n from public.profiles where id=$1",
      [victim],
    );

    expect(err).toMatch(/Modo de Prueba/i);
    expect(Number(rows[0].n)).toBe(1);
  });

  it("el admin demo tampoco puede editar su propio perfil", async () => {
    const err = await rejects(() =>
      asUser(db, demoAdmin, () =>
        db.query("update public.profiles set full_name='yo' where id=$1", [
          demoAdmin,
        ]),
      ),
    );

    expect(err).toMatch(/Modo de Prueba/i);
  });

  it("CONTROL: el sistema (sin sesión de usuario) sigue pudiendo actualizar perfiles", async () => {
    const err = await rejects(() =>
      db.query("update public.profiles set full_name='sistema' where id=$1", [
        demoAdmin,
      ]),
    );

    expect(err).toBeNull();
  });
});

describe("Puerta 3: create_return reembolsa sobre la cantidad acumulada", () => {
  let db: PGlite;
  let C: TestCompany;
  let cashier: string;
  let product: string;

  const sellLine = async (qty: number, price: number) => {
    const sale = await asUser(db, cashier, () =>
      createSale(db, [{ product_id: product, qty, unit_price: price }], C.loc1),
    );
    const item = (
      await db.query<{ id: string }>(
        "select id from public.sale_items where sale_id=$1",
        [sale.sale_id],
      )
    ).rows[0].id;

    return { saleId: sale.sale_id, item };
  };

  const giveBack = (saleId: string, item: string, qty: number) =>
    asUser(db, cashier, () =>
      db.query("select create_return($1,'x',$2::jsonb,$3,true)", [
        saleId,
        JSON.stringify([{ sale_item_id: item, qty }]),
        C.loc1,
      ]),
    );

  const refunded = async (saleId: string) =>
    Number(
      (
        await db.query<{ s: string }>(
          "select coalesce(sum(total),0) as s from public.returns where sale_id=$1",
          [saleId],
        )
      ).rows[0].s,
    );

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa devoluciones");
    cashier = await makeUser(db, C.id, "user");
    product = await makeProduct(db, C.id, C.loc1, "P", 1, 5, 5000);
    await asUser(db, cashier, () =>
      db.query("select open_cash_session(0,$1)", [C.loc1]),
    );
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: devolver todo de una vez reembolsa lo pagado", async () => {
    const { saleId, item } = await sellLine(100, 5);

    await giveBack(saleId, item, 100);

    expect(await refunded(saleId)).toBe(500);
  });

  it("100 devoluciones de 0.001 ya no reembolsan el doble (0.50, no 1.00)", async () => {
    const { saleId, item } = await sellLine(100, 5);

    for (let i = 0; i < 100; i++) await giveBack(saleId, item, 0.001);

    expect(await refunded(saleId)).toBeCloseTo(0.5, 2);
  });

  it("devolver en partes (40 y 60) suma exactamente lo pagado", async () => {
    const { saleId, item } = await sellLine(100, 5);

    await giveBack(saleId, item, 40);
    await giveBack(saleId, item, 60);

    expect(await refunded(saleId)).toBe(500);
  });

  it("una devolución en fracciones nunca supera lo pagado por la línea completa", async () => {
    const { saleId, item } = await sellLine(3, 5); // 15.00

    for (let i = 0; i < 3000; i += 1) {
      const err = await rejects(() => giveBack(saleId, item, 0.001));

      if (err) break;
    }

    expect(await refunded(saleId)).toBeLessThanOrEqual(15);
  }, 120_000);
});

describe("Puerta 4: un producto con variantes solo se vende por variante", () => {
  let db: PGlite;
  let C: TestCompany;
  let admin: string;
  let cashier: string;
  let variantProduct: string;
  let variantId: string;
  let plainProduct: string;

  const itemsOf = (extra: Record<string, unknown>[]): CartLine[] =>
    extra as unknown as CartLine[];

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa variantes");
    admin = await makeUser(db, C.id, "admin");
    cashier = await makeUser(db, C.id, "user");
    variantProduct = await makeProduct(db, C.id, C.loc1, "Camisa", 5, 10, 10);
    plainProduct = await makeProduct(db, C.id, C.loc1, "Simple", 1, 10, 10);
    await asUser(db, admin, () =>
      db.query("select sync_product_variants($1,$2,$3::jsonb)", [
        variantProduct,
        ["Talla"],
        JSON.stringify([
          {
            attributes: { Talla: "L" },
            price_override: 20,
            cost_override: 8,
            locations: [{ location_id: C.loc1, stock: 5 }],
          },
        ]),
      ]),
    );
    variantId = (
      await db.query<{ id: string }>(
        "select id from public.product_variants where product_id=$1",
        [variantProduct],
      )
    ).rows[0].id;
    await asUser(db, cashier, () =>
      db.query("select open_cash_session(0,$1)", [C.loc1]),
    );
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  const sell = (lines: Record<string, unknown>[]) =>
    asUser(db, cashier, () => createSale(db, itemsOf(lines), C.loc1));

  it("CONTROL: un producto simple se vende normal", async () => {
    const sale = await sell([
      { product_id: plainProduct, qty: 1, unit_price: 0 },
    ]);

    expect(Number(sale.total)).toBe(10);
  });

  it("CONTROL: el producto con variantes se vende POR variante al precio de la variante", async () => {
    const sale = await sell([
      {
        product_id: variantProduct,
        variant_id: variantId,
        qty: 1,
        unit_price: 0,
      },
    ]);

    expect(Number(sale.total)).toBe(20);
  });

  it("vender el producto con variantes SIN variante se rechaza y no mueve stock", async () => {
    const before = await db.query(
      "select stock from public.products where id=$1",
      [variantProduct],
    );
    const err = await rejects(() =>
      sell([{ product_id: variantProduct, qty: 1, unit_price: 0 }]),
    );
    const after = await db.query(
      "select stock from public.products where id=$1",
      [variantProduct],
    );

    expect(err).toMatch(/requiere variante/i);
    expect(after.rows).toEqual(before.rows);
  });

  it("cotizar sin variante se rechaza; con variante funciona", async () => {
    const without = await rejects(() =>
      asUser(db, cashier, () =>
        db.query("select create_quote($1::jsonb,null,null,$2)", [
          JSON.stringify([{ product_id: variantProduct, qty: 1 }]),
          C.loc1,
        ]),
      ),
    );
    const withVariant = await rejects(() =>
      asUser(db, cashier, () =>
        db.query("select create_quote($1::jsonb,null,null,$2)", [
          JSON.stringify([
            { product_id: variantProduct, variant_id: variantId, qty: 1 },
          ]),
          C.loc1,
        ]),
      ),
    );

    expect(without).toMatch(/requiere variante/i);
    expect(withVariant).toBeNull();
  });

  it("convertir una cotización vieja (sin variante) de un producto que luego pasó a tener variantes se rechaza", async () => {
    const legacy = await makeProduct(db, C.id, C.loc1, "Legado", 1, 10, 10);
    const q = await asUser(db, cashier, () =>
      db.query<{ r: { quote_id?: string; id?: string } }>(
        "select create_quote($1::jsonb,null,null,$2) as r",
        [JSON.stringify([{ product_id: legacy, qty: 1 }]), C.loc1],
      ),
    );
    const quoteId = (q.rows[0].r.quote_id ?? q.rows[0].r.id) as string;

    await asUser(db, admin, () =>
      db.query("select sync_product_variants($1,$2,$3::jsonb)", [
        legacy,
        ["Talla"],
        JSON.stringify([
          {
            attributes: { Talla: "M" },
            price_override: 30,
            locations: [{ location_id: C.loc1, stock: 5 }],
          },
        ]),
      ]),
    );

    const err = await rejects(() =>
      asUser(db, admin, () =>
        db.query("select convert_quote_to_sale($1,$2)", [quoteId, C.loc1]),
      ),
    );

    expect(err).toMatch(/requiere variante/i);
  });
});
