// Auditoría de seguridad 2026-10 (5ª pasada): "venta gratis".
// create_sale redondeaba CADA línea (round(precio * cantidad, 2)): una línea de
// 0.001 de un producto de $4 salía en $0.00 pero descontaba stock. Partiendo el
// carrito en cientos de líneas, un cajero se llevaba mercancía sin cobrarla y
// sin registrar ningún pago. Ahora:
//   - una línea con precio > 0 no puede cobrarse en cero,
//   - las líneas repetidas del mismo producto se unen antes de redondear,
//   - el carrito tiene tope de líneas y no admite cantidades <= 0.
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

describe("Carrito partido en líneas diminutas: no hay mercancía gratis", () => {
  let db: PGlite;
  let C: TestCompany;
  let cashier: string;
  let product: string;
  let freebie: string;

  const stockOf = async (productId: string) =>
    Number(
      (
        await db.query<{ stock: string }>(
          "select stock from public.product_locations where product_id=$1 and location_id=$2",
          [productId, C.loc1],
        )
      ).rows[0].stock,
    );

  const salesCount = async () =>
    Number(
      (
        await db.query<{ n: string }>(
          "select count(*)::int as n from public.sales where company_id=$1",
          [C.id],
        )
      ).rows[0].n,
    );

  const sell = (items: { product_id: string; qty: number }[]) =>
    asUser(db, cashier, () =>
      createSale(
        db,
        items.map((i) => ({ ...i, unit_price: 0 })),
        C.loc1,
      ),
    );

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa venta gratis");
    cashier = await makeUser(db, C.id, "user");
    product = await makeProduct(db, C.id, C.loc1, "Caro", 1, 4, 10);
    freebie = await makeProduct(db, C.id, C.loc1, "Regalo", 0, 0, 10);
    await asUser(db, cashier, () =>
      db.query("select open_cash_session(0,$1)", [C.loc1]),
    );
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: una venta normal cobra y descuenta stock", async () => {
    const sale = await sell([{ product_id: product, qty: 1 }]);

    expect(Number(sale.total)).toBe(4);
    expect(await stockOf(product)).toBe(9);
  });

  it("CONTROL: cantidades fraccionarias legítimas se cobran (1.5 kg)", async () => {
    const sale = await sell([{ product_id: product, qty: 1.5 }]);

    expect(Number(sale.total)).toBe(6);
    expect(await stockOf(product)).toBe(7.5);
  });

  it("CONTROL: un producto de precio $0 (regalo) sigue pudiendo venderse", async () => {
    const sale = await sell([{ product_id: freebie, qty: 1 }]);

    expect(Number(sale.total)).toBe(0);
    expect(await stockOf(freebie)).toBe(9);
  });

  it("una sola línea de 0.001 de un producto de $4 se rechaza (cobraría $0.00)", async () => {
    const before = await stockOf(product);
    const sales = await salesCount();
    const err = await rejects(() =>
      sell([{ product_id: product, qty: 0.001 }]),
    );

    expect(err).toMatch(/demasiado pequena/i);
    expect(await stockOf(product)).toBe(before);
    expect(await salesCount()).toBe(sales);
  });

  it("1000 líneas de 0.001 ya no sacan mercancía gratis: se rechaza el carrito", async () => {
    const before = await stockOf(product);
    const sales = await salesCount();
    const items = Array.from({ length: 1000 }, () => ({
      product_id: product,
      qty: 0.001,
    }));
    const err = await rejects(() => sell(items));

    expect(err).toMatch(/demasiadas lineas/i);
    expect(await stockOf(product)).toBe(before);
    expect(await salesCount()).toBe(sales);
  });

  it("200 líneas de 0.001 (dentro del tope) se unen y se cobran juntas, no a $0", async () => {
    const before = await stockOf(product);
    const items = Array.from({ length: 200 }, () => ({
      product_id: product,
      qty: 0.001,
    }));
    // 200 x 0.001 = 0.2 unidades x $4 = $0.80
    const sale = await sell(items);

    expect(Number(sale.total)).toBeCloseTo(0.8, 2);
    expect(await stockOf(product)).toBeCloseTo(before - 0.2, 3);

    const { rows } = await db.query<{ n: string }>(
      "select count(*)::int as n from public.sale_items where sale_id=$1",
      [sale.sale_id],
    );

    expect(Number(rows[0].n)).toBe(1);
  });

  it("líneas repetidas del mismo producto se unen: 3 x 1 = una línea de 3", async () => {
    const sale = await sell([
      { product_id: product, qty: 1 },
      { product_id: product, qty: 1 },
      { product_id: product, qty: 1 },
    ]);
    const { rows } = await db.query<{ qty: string; total: string }>(
      "select qty, total from public.sale_items where sale_id=$1",
      [sale.sale_id],
    );

    expect(rows).toHaveLength(1);
    expect(Number(rows[0].qty)).toBe(3);
    expect(Number(sale.total)).toBe(12);
  });

  it("una línea con cantidad 0 o negativa se rechaza, aunque otra la compense", async () => {
    for (const qty of [0, -1]) {
      const err = await rejects(() =>
        sell([
          { product_id: product, qty: 5 },
          { product_id: product, qty },
        ]),
      );

      expect(err, String(qty)).toMatch(/cantidad invalida/i);
    }
  });

  it("también se bloquea en cotizaciones y apartados", async () => {
    const quote = await rejects(() =>
      asUser(db, cashier, () =>
        db.query("select create_quote($1::jsonb,null,null,$2)", [
          JSON.stringify([{ product_id: product, qty: 0.001 }]),
          C.loc1,
        ]),
      ),
    );
    const apartado = await rejects(() =>
      asUser(db, cashier, () =>
        db.query(
          `select create_apartado(
             p_customer_id := null, p_items := $1::jsonb, p_location_id := $2,
             p_deposit_amount := 0, p_due_date := null, p_payment_method := 'Efectivo'
           )`,
          [JSON.stringify([{ product_id: product, qty: 0.001 }]), C.loc1],
        ),
      ),
    );

    expect(quote).toMatch(/demasiado pequena/i);
    expect(apartado).not.toBeNull();
  });

  it("CONTROL: una cotización normal sigue funcionando", async () => {
    const err = await rejects(() =>
      asUser(db, cashier, () =>
        db.query("select create_quote($1::jsonb,null,null,$2)", [
          JSON.stringify([{ product_id: product, qty: 2 }]),
          C.loc1,
        ]),
      ),
    );

    expect(err).toBeNull();
  });
});
