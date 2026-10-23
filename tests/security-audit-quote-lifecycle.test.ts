// Auditoría de seguridad 2026-10 (10ª pasada): ciclo de vida de las cotizaciones.
//   - create_quote no revisaba el acceso a la sucursal.
//   - La vigencia no tenía tope: se podía congelar el precio de hoy hasta 2099 y
//     convertirlo en venta meses después.
//   - Una cotización seguía vendiendo un producto desactivado.
//   - convert_quote_to_sale / reject_quote no revisaban la sucursal de la propia
//     cotización.
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

describe("Cotizaciones: sucursal, vigencia y productos desactivados", () => {
  let db: PGlite;
  let C: TestCompany;
  let seller: string; // sin restricción
  let restricted: string; // restringido a la sucursal 1
  let product: string;

  const quote = (
    userId: string,
    opts: {
      loc?: string | null;
      validUntil?: string | null;
      name?: string;
      productId?: string;
    } = {},
  ) =>
    asUser(db, userId, () =>
      db.query<{ r: { quote_id?: string; id?: string } }>(
        "select create_quote($1::jsonb,null,$2,$3,$4::date) as r",
        [
          JSON.stringify([{ product_id: opts.productId ?? product, qty: 1 }]),
          opts.name ?? null,
          opts.loc ?? null,
          opts.validUntil ?? null,
        ],
      ),
    );

  const idOf = (r: { r: { quote_id?: string; id?: string } }) =>
    (r.r.quote_id ?? r.r.id) as string;

  const dayOffset = async (days: number) =>
    (
      await db.query<{ d: string }>(
        "select (current_date + $1::int)::text as d",
        [days],
      )
    ).rows[0].d;

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa cotizaciones");
    seller = await makeUser(db, C.id, "user");
    restricted = await makeUser(db, C.id, "user");
    product = await makeProduct(db, C.id, C.loc1, "P", 1, 100, 500);
    await db.query(
      "insert into public.profile_locations (company_id, profile_id, location_id) values ($1,$2,$3)",
      [C.id, restricted, C.loc1],
    );
    await asUser(db, seller, () =>
      db.query("select open_cash_session(0,$1)", [C.loc1]),
    );
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: cotizar con vigencia normal, en la propia sucursal o sin sucursal, funciona", async () => {
    expect(await rejects(() => quote(seller))).toBeNull();
    expect(await rejects(() => quote(restricted, { loc: C.loc1 }))).toBeNull();
    expect(await rejects(() => quote(restricted))).toBeNull();
  });

  it("un empleado restringido a la sucursal 1 NO puede cotizar para la sucursal 2", async () => {
    const err = await rejects(() => quote(restricted, { loc: C.loc2 }));

    expect(err).toMatch(/acceso a esta sucursal/i);
  });

  it("la vigencia tiene tope de 90 días: 2099 y 91 días se rechazan; 90 días se acepta", async () => {
    const day91 = await dayOffset(91);
    const day90 = await dayOffset(90);

    for (const d of ["2099-12-31", day91]) {
      const err = await rejects(() => quote(seller, { validUntil: d }));

      expect(err, d).toMatch(/90 dias/i);
    }

    expect(
      await rejects(() => quote(seller, { validUntil: day90 })),
    ).toBeNull();
  });

  it("un producto desactivado no se cotiza", async () => {
    const off = await makeProduct(db, C.id, C.loc1, "Descontinuado", 1, 10, 5);

    await db.query("update public.products set active=false where id=$1", [
      off,
    ]);

    const err = await rejects(() => quote(seller, { productId: off }));

    expect(err).toMatch(/Producto no encontrado/i);
  });

  it("una cotización cuyo producto se desactivó después ya no se convierte en venta", async () => {
    const p = await makeProduct(db, C.id, C.loc1, "Baja luego", 1, 10, 5);
    const q = idOf((await quote(seller, { productId: p })).rows[0]);

    await db.query("update public.products set active=false where id=$1", [p]);

    const err = await rejects(() =>
      asUser(db, seller, () =>
        db.query("select convert_quote_to_sale($1,$2)", [q, C.loc1]),
      ),
    );

    expect(err).toMatch(/ya no esta disponible/i);
  });

  it("CONTROL: una cotización vigente de un producto activo sí se convierte", async () => {
    const q = idOf((await quote(seller)).rows[0]);

    expect(
      await rejects(() =>
        asUser(db, seller, () =>
          db.query("select convert_quote_to_sale($1,$2)", [q, C.loc1]),
        ),
      ),
    ).toBeNull();
  });

  it("el restringido NO convierte ni rechaza una cotización de la sucursal 2", async () => {
    const q = idOf((await quote(seller, { loc: C.loc2 })).rows[0]);
    const convert = await rejects(() =>
      asUser(db, restricted, () =>
        db.query("select convert_quote_to_sale($1,$2)", [q, C.loc1]),
      ),
    );
    const reject = await rejects(() =>
      asUser(db, restricted, () => db.query("select reject_quote($1)", [q])),
    );

    expect(convert).toMatch(/acceso a esta sucursal/i);
    expect(reject).toMatch(/acceso a esta sucursal/i);

    const { rows } = await db.query<{ status: string }>(
      "select status from public.quotes where id=$1",
      [q],
    );

    expect(rows[0].status).toBe("pendiente");
  });

  it("CONTROL: quien sí tiene acceso rechaza esa cotización", async () => {
    const q = idOf((await quote(seller, { loc: C.loc2 })).rows[0]);

    expect(
      await rejects(() =>
        asUser(db, seller, () => db.query("select reject_quote($1)", [q])),
      ),
    ).toBeNull();
  });

  it("el nombre de cliente libre se recorta a 200 caracteres", async () => {
    const q = idOf((await quote(seller, { name: "x".repeat(500) })).rows[0]);
    const { rows } = await db.query<{ n: number }>(
      "select length(customer_name) as n from public.quotes where id=$1",
      [q],
    );

    expect(Number(rows[0].n)).toBe(200);
  });
});
