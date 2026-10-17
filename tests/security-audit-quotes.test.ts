// Auditoría de seguridad 2026-10 (2ª pasada): cotizaciones y apartados.
// create_sale rechaza a una empresa suspendida/vencida y aplica
// monthly_sales_limit; las RPC de cotizaciones y apartados no lo hacían, así
// que una empresa suspendida o sin cupo seguía vendiendo (cotización ->
// venta, apartado completado).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asUser,
  createSale,
  createTestDb,
  errMessage,
  makeCompany,
  makeCustomer,
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

interface Env {
  C: TestCompany;
  cashier: string;
  admin: string;
  product: string;
  customer: string;
}

describe("Cotizaciones y apartados", () => {
  let db: PGlite;

  const setup = async (
    name: string,
    salesLimit: number | null,
  ): Promise<Env> => {
    const planId =
      salesLimit === null ? null : await makePlan(db, name, 50, 5, salesLimit);
    const C = await makeCompany(db, name, { planId });
    const cashier = await makeUser(db, C.id, "user");
    const admin = await makeUser(db, C.id, "admin");
    const product = await makeProduct(db, C.id, C.loc1, "P", 1, 100, 500);
    const customer = await makeCustomer(db, C.id, "Cliente", 0);

    await db.query(
      "update public.companies set apartado_min_deposit_pct = 0 where id=$1",
      [C.id],
    );

    return { C, cashier, admin, product, customer };
  };

  const quote = async (e: Env) =>
    (
      await asUser(db, e.cashier, () =>
        db.query<{ r: { quote_id?: string; id?: string } }>(
          "select create_quote($1::jsonb,null,null,$2) as r",
          [JSON.stringify([{ product_id: e.product, qty: 1 }]), e.C.loc1],
        ),
      )
    ).rows[0].r;

  const quoteId = async (e: Env) => {
    const q = await quote(e);

    return (q.quote_id ?? q.id) as string;
  };

  const apartado = async (e: Env, deposit: number) =>
    (
      await asUser(db, e.cashier, () =>
        db.query<{ r: { apartado_id: string } }>(
          `select create_apartado(
             p_customer_id := $1, p_items := $2::jsonb, p_location_id := $3,
             p_deposit_amount := $4, p_due_date := null, p_payment_method := 'Efectivo'
           ) as r`,
          [
            e.customer,
            JSON.stringify([{ product_id: e.product, qty: 1 }]),
            e.C.loc1,
            deposit,
          ],
        ),
      )
    ).rows[0].r.apartado_id;

  const convert = (e: Env, id: string) =>
    asUser(db, e.cashier, () =>
      db.query("select convert_quote_to_sale($1,$2)", [id, e.C.loc1]),
    );

  const complete = (e: Env, id: string) =>
    asUser(db, e.cashier, () =>
      db.query(
        "select complete_apartado(p_apartado_id := $1, p_final_payment_amount := 0, p_payment_method := 'Efectivo')",
        [id],
      ),
    );

  beforeAll(async () => {
    db = await createTestDb();
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  describe("empresa suspendida", () => {
    let e: Env;
    let q: string;
    let a1: string;
    let a2: string;

    beforeAll(async () => {
      e = await setup("Empresa suspendible", null);
      // Todo se prepara mientras la empresa está activa (CONTROL).
      q = await quoteId(e);
      a1 = await apartado(e, 100);
      a2 = await apartado(e, 100);
      await db.query(
        "update public.companies set subscription_status='suspended' where id=$1",
        [e.C.id],
      );
    }, 120_000);

    it("CONTROL: mientras estaba activa, cotizar y apartar sí funcionaba (el setup lo demuestra)", () => {
      expect(q).toBeTruthy();
      expect(a1).toBeTruthy();
      expect(a2).toBeTruthy();
    });

    it("una empresa suspendida NO puede crear cotizaciones ni apartados", async () => {
      expect(await rejects(() => quote(e))).toMatch(/suspendida/i);
      expect(await rejects(() => apartado(e, 100))).toMatch(/suspendida/i);
    });

    it("una empresa suspendida NO puede convertir cotizaciones ni completar apartados", async () => {
      expect(await rejects(() => convert(e, q))).toMatch(/suspendida/i);
      expect(await rejects(() => complete(e, a1))).toMatch(/suspendida/i);
    });

    it("una empresa suspendida NO puede abonar ni cancelar apartados", async () => {
      expect(
        await rejects(() =>
          asUser(db, e.cashier, () =>
            db.query(
              "select add_apartado_payment(p_apartado_id := $1, p_amount := 10, p_payment_method := 'Efectivo')",
              [a2],
            ),
          ),
        ),
      ).toMatch(/suspendida/i);
      expect(
        await rejects(() =>
          asUser(db, e.admin, () =>
            db.query(
              "select cancel_apartado(p_apartado_id := $1, p_refund_deposit := false)",
              [a2],
            ),
          ),
        ),
      ).toMatch(/suspendida/i);
    });

    it("no se creó ninguna venta nueva mientras estuvo suspendida", async () => {
      const { rows } = await db.query<{ n: string }>(
        "select count(*)::int as n from public.sales where company_id=$1",
        [e.C.id],
      );

      expect(Number(rows[0].n)).toBe(0);
    });

    it("CONTROL: reactivada la empresa, las mismas operaciones vuelven a funcionar", async () => {
      await db.query(
        "update public.companies set subscription_status='active' where id=$1",
        [e.C.id],
      );

      expect(await rejects(() => convert(e, q))).toBeNull();
      expect(await rejects(() => complete(e, a1))).toBeNull();
    });
  });

  describe("límite mensual de ventas del plan", () => {
    let e: Env;
    let q: string;
    let a: string;

    beforeAll(async () => {
      e = await setup("Empresa con cupo", 1);
      q = await quoteId(e);
      a = await apartado(e, 100);
    }, 120_000);

    it("CONTROL: con cupo disponible una venta normal pasa; agotado el cupo, la siguiente se rechaza", async () => {
      const first = await rejects(() =>
        asUser(db, e.cashier, () =>
          createSale(
            db,
            [{ product_id: e.product, qty: 1, unit_price: 100 }],
            e.C.loc1,
          ),
        ),
      );
      const second = await rejects(() =>
        asUser(db, e.cashier, () =>
          createSale(
            db,
            [{ product_id: e.product, qty: 1, unit_price: 100 }],
            e.C.loc1,
          ),
        ),
      );

      expect(first).toBeNull();
      expect(second).toMatch(/limite de ventas mensuales/i);
    });

    it("agotado el cupo, NO se puede convertir una cotización ni completar un apartado en venta", async () => {
      expect(await rejects(() => convert(e, q))).toMatch(
        /limite de ventas mensuales/i,
      );
      expect(await rejects(() => complete(e, a))).toMatch(
        /limite de ventas mensuales/i,
      );
    });
  });

  describe("empresa con cupo de sobra", () => {
    it("CONTROL: convertir una cotización y completar un apartado funciona con normalidad", async () => {
      const e = await setup("Empresa con mucho cupo", 100);
      const q = await quoteId(e);
      const a = await apartado(e, 100);

      expect(await rejects(() => convert(e, q))).toBeNull();
      expect(await rejects(() => complete(e, a))).toBeNull();
    });
  });
});
