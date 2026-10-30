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

  for (const m of ["eq", "gte", "lt", "lte", "order", "select", "in", "is"]) {
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
