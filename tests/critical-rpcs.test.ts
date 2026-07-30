// Pruebas de los RPC de dinero/stock más críticos, corriendo contra un
// Postgres real (PGlite) con el esquema completo del proyecto instalado.
// Cubre los 6 hallazgos críticos de la auditoría 2026-07 + el vencimiento
// automático de periodo de prueba + una regresión de cierre de caja.
//
// Por qué así: estas RPC son SECURITY DEFINER con lógica de negocio real
// (candados anti-carrera, validaciones de rol/empresa/sucursal); probarlas
// con mocks no habría detectado ninguno de los bugs reales que encontramos
// en esta sesión. Corre en CI sin Docker ni Supabase real.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asUser,
  createSale,
  createTestDb,
  makeCompany,
  makePlan,
  makeProduct,
  makeUser,
  type TestCompany,
} from "./helpers/db";

describe("RPCs críticas de dinero y stock", () => {
  let db: PGlite;
  let companyA: TestCompany;
  let adminA: string;
  let cajeroA: string;
  let operadorA: string;
  let prodA1: string;
  let prodA2: string;
  let firstSaleId: string;

  beforeAll(async () => {
    db = await createTestDb();
    companyA = await makeCompany(db, "Empresa Principal Test");
    adminA = await makeUser(db, companyA.id, "admin");
    cajeroA = await makeUser(db, companyA.id, "user");
    operadorA = await makeUser(db, companyA.id, "operador");
    prodA1 = await makeProduct(
      db,
      companyA.id,
      companyA.loc1,
      "Producto A1",
      5.0,
      10.0,
      50,
    );
    prodA2 = await makeProduct(
      db,
      companyA.id,
      companyA.loc1,
      "Producto A2",
      3.0,
      6.0,
      50,
    );
  });

  afterAll(async () => {
    await db.close();
  });

  describe("1. Escritura directa vía API bloqueada; RPCs siguen funcionando", () => {
    it("1a. INSERT directo en sales bloqueado para un cajero", async () => {
      await asUser(db, cajeroA, async () => {
        await expect(
          db.query(
            `insert into public.sales (company_id, location_id, sale_number, document_type, payment_method, customer_name, subtotal, tax, total)
             values ($1,$2,'FAKE-1','Ticket','Efectivo','x',0,0,0)`,
            [companyA.id, companyA.loc1],
          ),
        ).rejects.toThrow();
      });
    });

    it("1b/1c. cash_movements: INSERT legítimo permitido, UPDATE bloqueado (no se puede alterar historial)", async () => {
      let sessionId = "";
      await asUser(db, cajeroA, async () => {
        const { rows } = await db.query<{ open_cash_session: string }>(
          "select open_cash_session(100, $1) as open_cash_session",
          [companyA.loc1],
        );
        sessionId = rows[0].open_cash_session;
        await db.query(
          `insert into public.cash_movements (company_id, cash_session_id, movement_type, concept, amount, location_id)
           values ($1,$2,'ingreso','venta suelta',50,$3)`,
          [companyA.id, sessionId, companyA.loc1],
        );

        const res = await db.query(
          "update public.cash_movements set amount = 999999 where cash_session_id=$1",
          [sessionId],
        );
        expect(res.affectedRows ?? 0).toBe(0);
      });

      const { rows } = await db.query<{ amount: number }>(
        "select amount from public.cash_movements where cash_session_id=$1",
        [sessionId],
      );
      expect(Number(rows[0].amount)).toBe(50);
    });

    it("1d. UPDATE directo de stock (cajero) bloqueado, el stock real no cambia", async () => {
      await asUser(db, cajeroA, async () => {
        const res = await db.query(
          "update public.product_locations set stock = 999999 where product_id=$1 and location_id=$2",
          [prodA1, companyA.loc1],
        );
        expect(res.affectedRows ?? 0).toBe(0);
      });
      const { rows } = await db.query<{ stock: number }>(
        "select stock from public.product_locations where product_id=$1 and location_id=$2",
        [prodA1, companyA.loc1],
      );
      expect(Number(rows[0].stock)).toBe(50);
    });

    it("1e. create_sale (RPC) funciona para el cajero y descuenta stock", async () => {
      await asUser(db, cajeroA, async () => {
        const sale = await createSale(
          db,
          [{ product_id: prodA1, qty: 2, unit_price: 10.0 }],
          companyA.loc1,
        );
        firstSaleId = sale.sale_id;
      });
      const { rows } = await db.query<{ stock: number }>(
        "select stock from public.product_locations where product_id=$1 and location_id=$2",
        [prodA1, companyA.loc1],
      );
      expect(Number(rows[0].stock)).toBe(48);
    });

    it("1f/1g. products: UPDATE directo permitido para admin, bloqueado para cajero", async () => {
      await asUser(db, adminA, async () => {
        const res = await db.query(
          "update public.products set price = 999 where id=$1",
          [prodA2],
        );
        expect(res.affectedRows ?? 0).toBe(1);
      });
      await asUser(db, cajeroA, async () => {
        const res = await db.query(
          "update public.products set price = 1 where id=$1",
          [prodA2],
        );
        expect(res.affectedRows ?? 0).toBe(0);
      });
      const { rows } = await db.query<{ price: number }>(
        "select price from public.products where id=$1",
        [prodA2],
      );
      expect(Number(rows[0].price)).toBe(999);
    });

    it("1h. adjust_stock (RPC) funciona para operador pese a la RLS restrictiva", async () => {
      await asUser(db, operadorA, async () => {
        await db.query("select adjust_stock($1, $2, 5, 'ajuste de prueba')", [
          prodA2,
          companyA.loc1,
        ]);
      });
      const { rows } = await db.query<{ stock: number }>(
        "select stock from public.product_locations where product_id=$1 and location_id=$2",
        [prodA2, companyA.loc1],
      );
      expect(Number(rows[0].stock)).toBe(55);
    });
  });

  describe("2. create_return no confía en el precio enviado por el cliente", () => {
    it("usa el precio real de la venta, no el manipulado", async () => {
      await asUser(db, cajeroA, async () => {
        const { rows: items } = await db.query<{
          id: string;
          unit_price: number;
        }>(
          "select id, unit_price from public.sale_items where sale_id=$1 limit 1",
          [firstSaleId],
        );
        const { id: saleItemId, unit_price: realPrice } = items[0];

        const { rows } = await db.query<{ create_return: string }>(
          "select create_return($1, 'Producto defectuoso', $2::jsonb, $3, false) as create_return",
          [
            firstSaleId,
            JSON.stringify([
              { sale_item_id: saleItemId, qty: 1, unit_price: 999999 },
            ]),
            companyA.loc1,
          ],
        );
        const returnId = rows[0].create_return;

        const { rows: returnItems } = await db.query<{
          unit_price: number;
          total: number;
        }>(
          "select unit_price, total from public.return_items where return_id=$1",
          [returnId],
        );
        expect(Number(returnItems[0].unit_price)).toBe(Number(realPrice));
        expect(Number(returnItems[0].unit_price)).not.toBe(999999);
      });
    });
  });

  describe("3. create_purchase actualiza el costo del producto", () => {
    it("products.cost refleja el último costo de compra", async () => {
      const before = await db.query<{ cost: number }>(
        "select cost from public.products where id=$1",
        [prodA1],
      );
      await asUser(db, cajeroA, async () => {
        await db.query(
          "select create_purchase(null, 'F-001', now(), $1, $2::jsonb)",
          [
            companyA.loc1,
            JSON.stringify([{ product_id: prodA1, qty: 10, unit_cost: 8.75 }]),
          ],
        );
      });
      const after = await db.query<{ cost: number }>(
        "select cost from public.products where id=$1",
        [prodA1],
      );
      expect(Number(before.rows[0].cost)).not.toBe(8.75);
      expect(Number(after.rows[0].cost)).toBe(8.75);
    });
  });

  describe("4. create_sale es idempotente (mismo client_request_id)", () => {
    it("un reintento con la misma clave devuelve la MISMA venta y no duplica el descuento de stock", async () => {
      const crid = crypto.randomUUID();
      const before = await db.query<{ stock: number }>(
        "select stock from public.product_locations where product_id=$1 and location_id=$2",
        [prodA2, companyA.loc1],
      );
      let sale1 = "";
      let sale2 = "";
      await asUser(db, cajeroA, async () => {
        sale1 = (
          await createSale(
            db,
            [{ product_id: prodA2, qty: 1, unit_price: 6.0 }],
            companyA.loc1,
            crid,
          )
        ).sale_id;
        sale2 = (
          await createSale(
            db,
            [{ product_id: prodA2, qty: 1, unit_price: 6.0 }],
            companyA.loc1,
            crid,
          )
        ).sale_id;
      });
      expect(sale2).toBe(sale1);

      const { rows: countRows } = await db.query<{ count: string }>(
        "select count(*) from public.sales where client_request_id=$1",
        [crid],
      );
      expect(Number(countRows[0].count)).toBe(1);

      const after = await db.query<{ stock: number }>(
        "select stock from public.product_locations where product_id=$1 and location_id=$2",
        [prodA2, companyA.loc1],
      );
      expect(Number(before.rows[0].stock) - Number(after.rows[0].stock)).toBe(
        1,
      );
    });
  });

  describe("5. Empresa suspendida/vencida no puede operar", () => {
    it("bloquea venta y edición de catálogo; el Super Admin sí puede reactivar", async () => {
      const companyS = await makeCompany(db, "Empresa Suspendida Test");
      const adminS = await makeUser(db, companyS.id, "admin");
      const cajeroS = await makeUser(db, companyS.id, "user");
      const prodS1 = await makeProduct(
        db,
        companyS.id,
        companyS.loc1,
        "Producto S1",
        2.0,
        4.0,
        20,
      );
      const platformAdmin = await makeUser(db, companyA.id, "admin", true);

      await asUser(db, cajeroS, async () => {
        const sale = await createSale(
          db,
          [{ product_id: prodS1, qty: 1, unit_price: 4.0 }],
          companyS.loc1,
        );
        expect(sale.sale_id).toBeTruthy();
      });

      await db.query(
        "update public.companies set subscription_status='suspended' where id=$1",
        [companyS.id],
      );

      await asUser(db, cajeroS, async () => {
        await expect(
          createSale(
            db,
            [{ product_id: prodS1, qty: 1, unit_price: 4.0 }],
            companyS.loc1,
          ),
        ).rejects.toThrow(/suspendida o vencida/);
      });

      await asUser(db, adminS, async () => {
        const res = await db.query(
          "update public.products set price = 1 where id=$1",
          [prodS1],
        );
        expect(res.affectedRows ?? 0).toBe(0);
      });

      await asUser(db, platformAdmin, async () => {
        await db.query(
          "update public.companies set subscription_status='active' where id=$1",
          [companyS.id],
        );
      });

      await asUser(db, cajeroS, async () => {
        const sale = await createSale(
          db,
          [{ product_id: prodS1, qty: 1, unit_price: 4.0 }],
          companyS.loc1,
        );
        expect(sale.sale_id).toBeTruthy();
      });
    });
  });

  describe("6. Límites de plan (productos y ventas/mes)", () => {
    it("bloquea crear productos sobre el límite y vender sobre el límite mensual", async () => {
      const planTiny = await makePlan(db, "Plan Prueba Chico", 2, 5, 1);
      const companyL = await makeCompany(db, "Empresa Limites Test", {
        planId: planTiny,
      });
      const adminL = await makeUser(db, companyL.id, "admin");
      const prodL1 = await makeProduct(
        db,
        companyL.id,
        companyL.loc1,
        "Producto L1",
        1,
        2,
        100,
      );
      await makeProduct(
        db,
        companyL.id,
        companyL.loc1,
        "Producto L2",
        1,
        2,
        100,
      );

      await asUser(db, adminL, async () => {
        await expect(
          db.query(
            "insert into public.products (company_id, name, cost, price, stock, unit) values ($1,'Producto L3',1,2,10,'und')",
            [companyL.id],
          ),
        ).rejects.toThrow(/limite de productos/);

        const sale = await createSale(
          db,
          [{ product_id: prodL1, qty: 1, unit_price: 2.0 }],
          companyL.loc1,
        );
        expect(sale.sale_id).toBeTruthy();

        await expect(
          createSale(
            db,
            [{ product_id: prodL1, qty: 1, unit_price: 2.0 }],
            companyL.loc1,
          ),
        ).rejects.toThrow(/limite de ventas mensuales/);
      });
    });
  });

  describe("7. Vencimiento automático de periodo de prueba", () => {
    it("una empresa nueva arranca en trial con expires_at futuro", async () => {
      const newUserId = crypto.randomUUID();
      await db.query(
        "insert into auth.users (id, email, raw_user_meta_data) values ($1,$2,$3)",
        [
          newUserId,
          "nuevo@ejemplo.com",
          JSON.stringify({ company_name: "Tienda Nueva" }),
        ],
      );
      const { rows } = await db.query<{
        subscription_status: string;
        expires_at: string;
      }>(
        `select c.subscription_status, c.expires_at
         from public.companies c join public.profiles p on p.company_id = c.id
         where p.id = $1`,
        [newUserId],
      );
      expect(rows[0].subscription_status).toBe("trial");
      expect(rows[0].expires_at).toBeTruthy();
    });

    it("expire_overdue_trials() marca como expired un trial vencido", async () => {
      const overdueId = crypto.randomUUID();
      await db.query(
        `insert into public.companies (id, name, country_code, currency_code, locale, fiscal_id_label, tax_name, tax_rate, subscription_status, expires_at)
         values ($1,'Empresa Vencida','MX','MXN','es-MX','RFC','IVA',0.16,'trial', current_date - 5)`,
        [overdueId],
      );
      const platformAdmin = await makeUser(db, companyA.id, "admin", true);
      await asUser(db, platformAdmin, async () => {
        await db.query("select expire_overdue_trials()");
      });
      const { rows } = await db.query<{ subscription_status: string }>(
        "select subscription_status from public.companies where id=$1",
        [overdueId],
      );
      expect(rows[0].subscription_status).toBe("expired");
    });
  });

  describe("8. Regresión: cierre de caja completo", () => {
    it("open_cash_session -> venta -> close_cash_session calcula bien el esperado", async () => {
      const planTiny = await makePlan(db, "Plan Caja", 10, 5, 10);
      const company = await makeCompany(db, "Empresa Caja Test", {
        planId: planTiny,
      });
      const admin = await makeUser(db, company.id, "admin");
      const prod = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Producto Caja",
        1,
        2,
        50,
      );

      let closeResult:
        | { expected_amount: number; real_amount: number; difference: number }
        | undefined;
      await asUser(db, admin, async () => {
        await db.query("select open_cash_session(200, $1)", [company.loc1]);
        await createSale(
          db,
          [{ product_id: prod, qty: 1, unit_price: 2.0 }],
          company.loc1,
        );
        const { rows: sessionRows } = await db.query<{ id: string }>(
          "select id from public.cash_sessions where company_id=$1 and status='open' order by opened_at desc limit 1",
          [company.id],
        );
        const { rows } = await db.query<{
          close_cash_session: {
            expected_amount: number;
            real_amount: number;
            difference: number;
          };
        }>("select close_cash_session($1, $2) as close_cash_session", [
          sessionRows[0].id,
          202.0,
        ]);
        closeResult = rows[0].close_cash_session;
      });

      expect(closeResult).toBeTruthy();
      expect(Number(closeResult!.expected_amount)).toBe(202);
      expect(Number(closeResult!.real_amount)).toBe(202);
      expect(Number(closeResult!.difference)).toBe(0);
    });
  });
});
