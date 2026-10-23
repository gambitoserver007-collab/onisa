// Auditoría de seguridad 2026-10 (5ª pasada): respaldo de caja del cajero.
// create_sale y convert_quote_to_sale caían a "la única sesión abierta de la
// sucursal" aunque la hubiera abierto OTRO cajero: la venta en efectivo de un
// cajero sin sesión se cargaba a la caja de su compañero, subía el efectivo
// esperado de este y su arqueo salía en faltante. Ahora solo admin / gerente /
// finanzas usan ese respaldo; un cajero sin sesión propia queda sin caja
// (igual que create_return, que ya exigía la sesión del propio usuario).
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

describe("Caja de una venta: no se carga a la sesión de otro cajero", () => {
  let db: PGlite;
  let C: TestCompany;
  let owner: string;
  let intruder: string;
  let gerente: string;
  let admin: string;
  let product: string;
  let ownerTill: string;
  let ownerSession: string;

  const saleTill = async (saleId: string) =>
    (
      await db.query<{ till_id: string | null }>(
        "select till_id from public.sales where id=$1",
        [saleId],
      )
    ).rows[0].till_id;

  const expectedCash = async () =>
    Number(
      (
        await db.query<{ e: string }>(
          "select public.compute_cash_session_expected($1) as e",
          [ownerSession],
        )
      ).rows[0].e,
    );

  const sellAs = (userId: string) =>
    asUser(db, userId, () =>
      createSale(
        db,
        [{ product_id: product, qty: 1, unit_price: 100 }],
        C.loc1,
      ),
    );

  const quoteAndConvert = async (userId: string, quoteBy = userId) => {
    const q = await asUser(db, quoteBy, () =>
      db.query<{ r: { quote_id?: string; id?: string } }>(
        "select create_quote($1::jsonb,null,null,$2) as r",
        [JSON.stringify([{ product_id: product, qty: 1 }]), C.loc1],
      ),
    );
    const quoteId = (q.rows[0].r.quote_id ?? q.rows[0].r.id) as string;
    const res = await asUser(db, userId, () =>
      db.query<{ r: { sale_id: string } }>(
        "select convert_quote_to_sale($1,$2) as r",
        [quoteId, C.loc1],
      ),
    );

    return res.rows[0].r.sale_id;
  };

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa caja");
    owner = await makeUser(db, C.id, "user");
    intruder = await makeUser(db, C.id, "user");
    gerente = await makeUser(db, C.id, "gerente");
    admin = await makeUser(db, C.id, "admin");
    product = await makeProduct(db, C.id, C.loc1, "P", 1, 100, 500);
    ownerSession = (
      await asUser(db, owner, () =>
        db.query<{ s: string }>("select open_cash_session(0,$1) as s", [
          C.loc1,
        ]),
      )
    ).rows[0].s;
    ownerTill = (
      await db.query<{ till_id: string }>(
        "select till_id from public.cash_sessions where id=$1",
        [ownerSession],
      )
    ).rows[0].till_id;
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: el cajero dueño de la sesión vende en SU caja", async () => {
    const sale = await sellAs(owner);

    expect(await saleTill(sale.sale_id)).toBe(ownerTill);
    expect(await expectedCash()).toBe(100);
  });

  it("un cajero SIN sesión propia ya no carga su venta a la caja del compañero", async () => {
    const before = await expectedCash();
    const sale = await sellAs(intruder);

    expect(await saleTill(sale.sale_id)).toBeNull();
    expect(await expectedCash()).toBe(before);
  });

  it("lo mismo al convertir una cotización a venta", async () => {
    const before = await expectedCash();
    const saleId = await quoteAndConvert(intruder);

    expect(await saleTill(saleId)).toBeNull();
    expect(await expectedCash()).toBe(before);
  });

  it("CONTROL: el gerente (venta) y el admin (conversión) sin caja propia sí usan la única sesión abierta", async () => {
    const sale = await sellAs(gerente);

    expect(await saleTill(sale.sale_id)).toBe(ownerTill);

    const converted = await quoteAndConvert(admin, owner);

    expect(await saleTill(converted)).toBe(ownerTill);
  });

  it("CONTROL: el cajero que abre su propia sesión vuelve a vender en su caja", async () => {
    const till2 = crypto.randomUUID();

    await db.query(
      "insert into public.tills (id, company_id, location_id, name) values ($1,$2,$3,'Caja 2')",
      [till2, C.id, C.loc1],
    );
    await asUser(db, intruder, () =>
      db.query("select open_cash_session(0,$1,$2)", [C.loc1, till2]),
    );

    const sale = await sellAs(intruder);

    expect(await saleTill(sale.sale_id)).toBe(till2);
  });
});
