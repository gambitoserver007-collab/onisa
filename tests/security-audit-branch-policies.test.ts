// Auditoría de seguridad 2026-10 (5ª pasada): aislamiento por sucursal.
// Las políticas de lectura de sales, sale_items, stock_movements, cash_*,
// purchases y returns exigen user_can_access_location; sale_payments,
// purchase_items, apartados (+ items y abonos), cotizaciones (+ items) y las
// ventas anuladas solo exigían la empresa, y tres RPC SECURITY DEFINER
// (get_company_alerts, get_cash_session_cash_sales, purchase_projection) no
// aplicaban la restricción. Un empleado restringido a la sucursal 1 leía los
// datos de la sucursal 2.
// Cada puerta trae CONTROLES: el usuario sin restricción y la sucursal propia
// siguen viendo todo lo suyo.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asUser,
  createSale,
  createTestDb,
  errMessage,
  makeCompany,
  makeCustomer,
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

describe("Sucursal restringida: tablas hijas y RPC de lectura", () => {
  let db: PGlite;
  let C: TestCompany;
  let seller: string; // sin restricción: vende en las dos sucursales
  let seller2: string; // sin restricción: vende en la sucursal 2 (un cajero = una caja abierta)
  let restricted: string; // cajero restringido a loc1
  let finanzas: string; // finanzas restringido a loc1
  let boss: string; // admin sin restricción
  let product1: string;
  let product2: string;
  let customer: string;
  let session2: string;

  const countAs = (userId: string, sql: string) =>
    asUser(db, userId, async () =>
      Number((await db.query<{ n: string }>(sql)).rows[0].n),
    );

  const tables: [string, string][] = [
    ["sale_payments", "sale_payments"],
    ["purchase_items", "purchase_items"],
    ["apartados", "apartados"],
    ["apartado_items", "apartado_items"],
    ["apartado_payments", "apartado_payments"],
    ["quotes", "quotes"],
    ["quote_items", "quote_items"],
    ["voided_sales", "voided_sales"],
    ["voided_sale_items", "voided_sale_items"],
  ];

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa sucursales");
    seller = await makeUser(db, C.id, "user");
    seller2 = await makeUser(db, C.id, "user");
    restricted = await makeUser(db, C.id, "user");
    finanzas = await makeUser(db, C.id, "finanzas");
    boss = await makeUser(db, C.id, "admin");
    product1 = await makeProduct(db, C.id, C.loc1, "P1", 1, 100, 500);
    product2 = await makeProduct(db, C.id, C.loc2, "P2", 1, 100, 500);
    customer = await makeCustomer(db, C.id, "Cliente", 0);

    await db.query(
      "update public.companies set apartado_min_deposit_pct = 0 where id=$1",
      [C.id],
    );

    // Datos en las DOS sucursales, creados por alguien sin restricción.
    for (const [loc, prod] of [
      [C.loc1, product1],
      [C.loc2, product2],
    ] as const) {
      await asUser(db, loc === C.loc1 ? seller : seller2, async () => {
        await db.query("select open_cash_session(0,$1)", [loc]);
        await createSale(
          db,
          [{ product_id: prod, qty: 1, unit_price: 100 }],
          loc,
        );
        await db.query("select create_quote($1::jsonb,null,null,$2)", [
          JSON.stringify([{ product_id: prod, qty: 1 }]),
          loc,
        ]);
        await db.query(
          `select create_apartado(
             p_customer_id := $1, p_items := $2::jsonb, p_location_id := $3,
             p_deposit_amount := 10, p_due_date := current_date + 5, p_payment_method := 'Efectivo'
           )`,
          [customer, JSON.stringify([{ product_id: prod, qty: 1 }]), loc],
        );
        await db.query("select log_voided_sale($1::jsonb,$2,'x')", [
          JSON.stringify([{ product_id: prod, qty: 1 }]),
          loc,
        ]);
      });

      const purchase = crypto.randomUUID();

      await db.query(
        "insert into public.purchases (id, company_id, location_id, purchase_number, total) values ($1,$2,$3,$4,10)",
        [purchase, C.id, loc, `C-${loc.slice(0, 6)}`],
      );
      await db.query(
        "insert into public.purchase_items (company_id, purchase_id, product_id, qty, unit_cost, total) values ($1,$2,$3,1,10,10)",
        [C.id, purchase, prod],
      );
    }

    await db.query(
      "update public.apartados set due_date = current_date - 1 where company_id=$1",
      [C.id],
    );
    // Dos días atrás para que get_company_alerts las vea como "caja de ayer".
    await db.query(
      "update public.cash_sessions set opened_at = now() - interval '2 days' where company_id=$1",
      [C.id],
    );
    session2 = (
      await db.query<{ id: string }>(
        "select id from public.cash_sessions where company_id=$1 and location_id=$2",
        [C.id, C.loc2],
      )
    ).rows[0].id;

    for (const u of [restricted, finanzas]) {
      await db.query(
        "insert into public.profile_locations (company_id, profile_id, location_id) values ($1,$2,$3)",
        [C.id, u, C.loc1],
      );
    }
  }, 180_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: el admin sin restricción ve las dos sucursales en todas las tablas", async () => {
    for (const [label, table] of tables) {
      expect(
        await countAs(boss, `select count(*)::int as n from public.${table}`),
        label,
      ).toBe(2);
    }
  });

  it("el empleado restringido a la sucursal 1 solo ve filas de la sucursal 1", async () => {
    for (const [label, table] of tables) {
      if (table.startsWith("voided")) continue; // solo admin/finanzas
      expect(
        await countAs(
          restricted,
          `select count(*)::int as n from public.${table}`,
        ),
        label,
      ).toBe(1);
    }
  });

  it("finanzas restringido tampoco ve las ventas anuladas de la otra sucursal", async () => {
    for (const table of ["voided_sales", "voided_sale_items"]) {
      expect(
        await countAs(
          finanzas,
          `select count(*)::int as n from public.${table}`,
        ),
        table,
      ).toBe(1);
    }
  });

  it("get_cash_session_cash_sales: la caja de otra sucursal se rechaza; la propia no", async () => {
    const other = await rejects(() =>
      asUser(db, finanzas, () =>
        db.query("select get_cash_session_cash_sales($1)", [session2]),
      ),
    );

    expect(other).toMatch(/No autorizado/i);

    const own = (
      await db.query<{ id: string }>(
        "select id from public.cash_sessions where company_id=$1 and location_id=$2",
        [C.id, C.loc1],
      )
    ).rows[0].id;

    expect(
      await rejects(() =>
        asUser(db, finanzas, () =>
          db.query("select get_cash_session_cash_sales($1)", [own]),
        ),
      ),
    ).toBeNull();
    // CONTROL: el admin sin restricción sí consulta la de la sucursal 2.
    expect(
      await rejects(() =>
        asUser(db, boss, () =>
          db.query("select get_cash_session_cash_sales($1)", [session2]),
        ),
      ),
    ).toBeNull();
  });

  it("get_company_alerts: cajas, apartados y anuladas solo de las sucursales con acceso", async () => {
    const alerts = async (userId: string) =>
      (
        await asUser(db, userId, () =>
          db.query<{
            a: {
              cajas_abiertas: unknown[];
              apartados_vencidos: unknown[];
              ventas_canceladas: unknown[];
            };
          }>("select get_company_alerts() as a"),
        )
      ).rows[0].a;
    const mine = await alerts(finanzas);
    const all = await alerts(boss);

    expect(mine.cajas_abiertas).toHaveLength(1);
    expect(mine.apartados_vencidos).toHaveLength(1);
    expect(mine.ventas_canceladas).toHaveLength(1);
    // CONTROL
    expect(all.cajas_abiertas).toHaveLength(2);
    expect(all.apartados_vencidos).toHaveLength(2);
    expect(all.ventas_canceladas).toHaveLength(2);
  });

  it("purchase_projection: solo cuenta las ventas de las sucursales con acceso", async () => {
    const velocity = async (userId: string, productId: string) => {
      const { rows } = await asUser(db, userId, () =>
        db.query<{
          r: { items: { id: string; velocity: number }[] };
        }>("select purchase_projection(30, 30) as r"),
      );

      return rows[0].r.items.find((i) => i.id === productId)?.velocity ?? 0;
    };

    expect(await velocity(restricted, product2)).toBe(0);
    expect(await velocity(restricted, product1)).toBeGreaterThan(0);
    // CONTROL
    expect(await velocity(boss, product2)).toBeGreaterThan(0);
  });
});
