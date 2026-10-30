// Vistas previas con IVA (cotización, apartado, devolución) y rango de fechas del reporte de caja.
//   · La vista previa debe coincidir con lo que calcula el servidor (create_return / create_apartado).
//   · fetchCashReport compara en hora LOCAL: un corte cerrado de noche sigue saliendo en su día.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asUser,
  createSale,
  createTestDb,
  makeCompany,
  makeProduct,
  makeUser,
} from "./helpers/db";
import { estimateReturnRefund, lineTotalWithTax } from "../src/lib/taxPreview";

const calls = vi.hoisted(() => ({ list: [] as [string, unknown][] }));

vi.mock("../src/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = {};
  const rec = (name: string) => (col: string, val: unknown) => {
    calls.list.push([`${name}:${col}`, val]);

    return chain;
  };

  for (const m of [
    "eq",
    "gte",
    "lt",
    "lte",
    "order",
    "select",
    "in",
    "is",
    "range",
    "ilike",
  ]) {
    chain[m] = rec(m);
  }
  (chain as { then: unknown }).then = (resolve: (v: unknown) => void) =>
    resolve({ data: [], error: null });

  return { supabase: { from: () => chain } };
});

describe("lineTotalWithTax", () => {
  it("IVA aparte suma el IVA; IVA incluido no", () => {
    expect(lineTotalWithTax(100, 1, false, 0.16)).toBe(116);
    expect(lineTotalWithTax(100, 3, false, 0.16)).toBe(348);
    expect(lineTotalWithTax(100, 1, true, 0.16)).toBe(100);
    expect(lineTotalWithTax(100, 2, undefined, 0.16)).toBe(200);
  });
});

describe("la vista previa de devolución coincide con el servidor", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDb();
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("devoluciones parciales de un renglón con IVA aparte suman lo mismo que reembolsa create_return", async () => {
    const C = await makeCompany(db, "Previa");
    const cashier = await makeUser(db, C.id, "user");
    const p = await makeProduct(db, C.id, C.loc1, "P", 1, 33.33, 50);

    await db.query(
      "update public.products set price_includes_tax=false where id=$1",
      [p],
    );
    await asUser(db, cashier, () =>
      db.query("select open_cash_session(0,$1)", [C.loc1]),
    );
    const sale = await asUser(db, cashier, () =>
      createSale(db, [{ product_id: p, qty: 3, unit_price: 33.33 }], C.loc1),
    );
    const item = (
      await db.query<{ id: string; total: string; qty: string }>(
        "select id, total, qty from public.sale_items where sale_id=$1",
        [sale.sale_id],
      )
    ).rows[0];

    expect(Number(item.total)).toBeCloseTo(115.99, 2);

    let returnedQty = 0;
    let refundedSoFar = 0;

    for (const qty of [1, 1, 1]) {
      const preview = estimateReturnRefund(
        [
          {
            id: item.id,
            qty: Number(item.qty),
            alreadyReturned: returnedQty,
            lineTotal: Number(item.total),
            refundedAmount: refundedSoFar,
            paidRatio: 1,
          },
        ],
        { [item.id]: qty },
      );

      await asUser(db, cashier, () =>
        db.query("select create_return($1,'x',$2::jsonb,$3,true)", [
          sale.sale_id,
          JSON.stringify([{ sale_item_id: item.id, qty }]),
          C.loc1,
        ]),
      );
      const real = (
        await db.query<{ total: string }>(
          "select total from public.returns where sale_id=$1 order by created_at desc limit 1",
          [sale.sale_id],
        )
      ).rows[0].total;

      expect(preview).toBeCloseTo(Number(real), 2);
      returnedQty += qty;
      refundedSoFar += Number(real);
    }
    expect(refundedSoFar).toBeCloseTo(Number(item.total), 2);
  });
});

describe("fetchCashReport: rango en hora local", () => {
  it("el límite superior es el INICIO del día siguiente local (no 23:59:59 sin zona)", async () => {
    const { fetchCashReport } = await import("../src/services/appData");

    calls.list.length = 0;
    await fetchCashReport("c1", {
      dateFrom: "2026-10-29",
      dateTo: "2026-10-29",
    });
    const gte = calls.list.find(([k]) => k === "gte:closed_at")?.[1] as string;
    const lt = calls.list.find(([k]) => k === "lt:closed_at")?.[1] as string;

    expect(new Date(gte).getTime()).toBe(
      new Date("2026-10-29T00:00:00").getTime(),
    );
    expect(new Date(lt).getTime()).toBe(
      new Date("2026-10-30T00:00:00").getTime(),
    );
    expect(calls.list.some(([k]) => k === "lte:closed_at")).toBe(false);
  });
});

describe("tienda pública y mensajes de error", () => {
  it("fetchPublicCatalog pide solo lo visible, activo y no borrado", async () => {
    const { fetchPublicCatalog } = await import("../src/services/appData");

    calls.list.length = 0;
    await fetchPublicCatalog("c1");

    expect(calls.list).toContainEqual(["eq:show_online", true]);
    expect(calls.list).toContainEqual(["eq:active", true]);
    expect(calls.list).toContainEqual(["is:deleted_at", null]);
  });

  it("un tope de largo dice cuál campo, sin mostrar SQL", async () => {
    const { getErrorMessage } = await import("../src/services/appData");
    const raw = {
      message:
        'new row for relation "suppliers" violates check constraint "suppliers_document_number_len_chk"',
    };

    expect(getErrorMessage(raw, "No se pudo guardar el proveedor.")).toBe(
      'El campo "Documento" es demasiado largo. Acórtalo e inténtalo de nuevo.',
    );
    expect(
      getErrorMessage(
        { message: 'violates check constraint "locations_city_len_chk"' },
        "x",
      ),
    ).toMatch(/"Ciudad"/);
    expect(
      getErrorMessage(
        { message: 'violates check constraint "algo_raro_len_chk"' },
        "x",
      ),
    ).toMatch(/demasiado largo/);
    // control: otros errores siguen igual
    expect(
      getErrorMessage({ message: "algo inesperado: SQLSTATE 42" }, "fallback"),
    ).toBe("fallback");
  });
});

describe("ventas netas de devoluciones (dashboard, reportes y ganancias)", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDb();
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("una venta de 232 con una devolución de 116 cuenta 116 en TODAS las cifras", async () => {
    const C = await makeCompany(db, "Netas");
    const admin = await makeUser(db, C.id, "admin");
    const a = await makeProduct(db, C.id, C.loc1, "A", 50, 100, 50);

    await db.query(
      "update public.products set price_includes_tax=false where id=$1",
      [a],
    );
    await asUser(db, admin, () =>
      db.query("select open_cash_session(0,$1)", [C.loc1]),
    );
    const sale = await asUser(db, admin, () =>
      createSale(db, [{ product_id: a, qty: 2, unit_price: 100 }], C.loc1),
    );

    expect(Number(sale.total)).toBe(232);

    const num = async (sql: string) =>
      asUser(db, admin, async () =>
        Number((await db.query<{ n: string }>(sql)).rows[0].n),
      );
    const all = async () => ({
      today: await num("select total_today as n from dashboard_sales_totals()"),
      month: await num("select total_month as n from dashboard_sales_totals()"),
      count: await num("select count_today as n from dashboard_sales_totals()"),
      day: await num(
        "select coalesce(sum(total),0) as n from sales_by_day(null,'UTC',7)",
      ),
      category: await num(
        "select coalesce(sum(total),0) as n from sales_by_category()",
      ),
      method: await num(
        "select coalesce(sum(total),0) as n from sales_by_payment_method()",
      ),
      profitQty: await num(
        "select coalesce(sum(qty),0) as n from profit_report()",
      ),
      revenue: await num(
        "select coalesce(sum(revenue),0) as n from profit_report()",
      ),
      cost: await num("select coalesce(sum(cost),0) as n from profit_report()"),
    });

    // CONTROL: sin devoluciones, todo coincide con lo cobrado (con IVA)
    const before = await all();

    expect(before).toMatchObject({
      today: 232,
      month: 232,
      day: 232,
      category: 232,
      method: 232,
      profitQty: 2,
      revenue: 200,
      cost: 100,
    });

    const item = (
      await db.query<{ id: string }>(
        "select id from public.sale_items where sale_id=$1",
        [sale.sale_id],
      )
    ).rows[0];

    await asUser(db, admin, () =>
      db.query("select create_return($1,'x',$2::jsonb,$3,true)", [
        sale.sale_id,
        JSON.stringify([{ sale_item_id: item.id, qty: 1 }]),
        C.loc1,
      ]),
    );
    const after = await all();

    expect(after).toMatchObject({
      today: 116,
      month: 116,
      count: 1, // sigue siendo UN comprobante
      day: 116,
      category: 116,
      method: 116,
      profitQty: 1,
      revenue: 100,
      cost: 50,
    });

    // devolver lo que quedaba: la venta ya no cuenta y el producto sale de ganancias
    await asUser(db, admin, () =>
      db.query("select create_return($1,'x',$2::jsonb,$3,true)", [
        sale.sale_id,
        JSON.stringify([{ sale_item_id: item.id, qty: 1 }]),
        C.loc1,
      ]),
    );
    const none = await all();

    expect(none).toMatchObject({
      today: 0,
      category: 0,
      method: 0,
      profitQty: 0,
      revenue: 0,
      cost: 0,
    });
  });
});
