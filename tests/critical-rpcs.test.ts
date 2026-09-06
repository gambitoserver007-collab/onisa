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
  authorizeCashSession,
  createSale,
  createTestDb,
  finishTillCount,
  getCustomerLoyaltyPoints,
  makeCompany,
  makeCustomer,
  makePlan,
  makeProduct,
  makeUser,
  setLoyaltySettings,
  setLoyaltyTiers,
  submitTillCount,
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

  describe("8. Regresión: cierre de caja completo (conteo ciego -> cierre -> autorización)", () => {
    it("abrir caja -> venta -> conteo exacto -> cierra solo -> autorizar calcula bien el esperado", async () => {
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

      let authResult:
        | {
            expected_amount: number;
            real_amount: number;
            difference: number;
            classification: string;
          }
        | undefined;
      await asUser(db, admin, async () => {
        const { rows: openRows } = await db.query<{
          open_cash_session: string;
        }>("select open_cash_session(200, $1) as open_cash_session", [
          company.loc1,
        ]);
        const sessionId = openRows[0].open_cash_session;
        await createSale(
          db,
          [{ product_id: prod, qty: 1, unit_price: 2.0 }],
          company.loc1,
        );

        // 200 fondo + 2 de venta = 202: 1 billete de 200 + 1 moneda de 2.
        await submitTillCount(db, sessionId, [
          { denomination: 200, quantity: 1 },
          { denomination: 2, quantity: 1 },
        ]);
        const finish = await finishTillCount(db, sessionId);
        expect(finish.status).toBe("closed");
        expect(finish.second_count_required).toBe(false);

        authResult = await authorizeCashSession(db, sessionId);
      });

      expect(authResult).toBeTruthy();
      expect(Number(authResult!.expected_amount)).toBe(202);
      expect(Number(authResult!.real_amount)).toBe(202);
      expect(Number(authResult!.difference)).toBe(0);
      expect(authResult!.classification).toBe("cuadrado");
    });
  });

  describe("9. Cajas físicas (tills) — Etapa 1 del módulo de arqueo", () => {
    it("toda sucursal (existente o nueva) recibe su 'Caja 1' automáticamente", async () => {
      // companyA.loc1/loc2 se crearon en el beforeAll de arriba, ya con el
      // trigger locations_create_default_till instalado -- confirma que el
      // backfill de sucursales nuevas funciona sin intervención manual.
      for (const locId of [companyA.loc1, companyA.loc2]) {
        const { rows } = await db.query<{
          name: string;
          code: string | null;
          is_active: boolean;
        }>(
          "select name, code, is_active from public.tills where location_id=$1",
          [locId],
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].name).toBe("Caja 1");
        expect(rows[0].code).toBe("CAJA-1");
        expect(rows[0].is_active).toBe(true);
      }

      // Una sucursal creada después de la migración (ej. desde "Nueva
      // sucursal" en Puntos de venta) también debe recibir su caja sola.
      const { rows: newLoc } = await db.query<{ id: string }>(
        "insert into public.locations (company_id, name) values ($1,'Sucursal Nueva') returning id",
        [companyA.id],
      );
      const { rows: newTill } = await db.query<{ name: string }>(
        "select name from public.tills where location_id=$1",
        [newLoc[0].id],
      );
      expect(newTill).toHaveLength(1);
      expect(newTill[0].name).toBe("Caja 1");
    });

    it("cualquier rol puede leer las cajas de su sucursal, pero solo admin las administra", async () => {
      await asUser(db, cajeroA, async () => {
        const { rows } = await db.query(
          "select id from public.tills where location_id=$1",
          [companyA.loc1],
        );
        expect(rows.length).toBeGreaterThan(0);

        await expect(
          db.query(
            "insert into public.tills (company_id, location_id, name, code) values ($1,$2,'Caja 2','CAJA-2')",
            [companyA.id, companyA.loc1],
          ),
        ).rejects.toThrow();
      });

      let newTillId: string;
      await asUser(db, adminA, async () => {
        const { rows } = await db.query<{ id: string }>(
          "insert into public.tills (company_id, location_id, name, code) values ($1,$2,'Caja 2','CAJA-2') returning id",
          [companyA.id, companyA.loc1],
        );
        newTillId = rows[0].id;

        // Único por sucursal+nombre: repetir "Caja 2" en la misma sucursal falla.
        await expect(
          db.query(
            "insert into public.tills (company_id, location_id, name) values ($1,$2,'Caja 2')",
            [companyA.id, companyA.loc1],
          ),
        ).rejects.toThrow();

        await db.query("update public.tills set is_active=false where id=$1", [
          newTillId,
        ]);
      });

      const { rows: finalRows } = await db.query<{ is_active: boolean }>(
        "select is_active from public.tills where id=$1",
        [newTillId!],
      );
      expect(finalRows[0].is_active).toBe(false);
    });
  });

  describe("10. Etapa 2 del arqueo: varias cajas simultáneas + atribución de ventas", () => {
    it("dos cajas abiertas a la vez en la misma sucursal no mezclan sus ventas", async () => {
      const company = await makeCompany(db, "Empresa Multi-Caja Test");
      const prod = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Producto Multi-Caja",
        1,
        10,
        50,
      );
      const cajeroX = await makeUser(db, company.id, "user");
      const cajeroY = await makeUser(db, company.id, "user");

      const { rows: tillRows } = await db.query<{ id: string; name: string }>(
        "select id, name from public.tills where location_id=$1",
        [company.loc1],
      );
      expect(tillRows).toHaveLength(1); // "Caja 1" del trigger de Etapa 1
      const caja1 = tillRows[0].id;
      const { rows: caja2Rows } = await db.query<{ id: string }>(
        "insert into public.tills (company_id, location_id, name, code) values ($1,$2,'Caja 2','CAJA-2') returning id",
        [company.id, company.loc1],
      );
      const caja2 = caja2Rows[0].id;

      let sessionX = "";
      let sessionY = "";
      await asUser(db, cajeroX, async () => {
        const { rows } = await db.query<{ open_cash_session: string }>(
          "select open_cash_session(200, $1, $2) as open_cash_session",
          [company.loc1, caja1],
        );
        sessionX = rows[0].open_cash_session;
      });
      // Caja1 sigue abierta -> abrir OTRA sesión en la misma caja debe fallar,
      // pero abrir Caja2 (misma sucursal) debe funcionar sin problema.
      await asUser(db, cajeroY, async () => {
        await expect(
          db.query("select open_cash_session(100, $1, $2)", [
            company.loc1,
            caja1,
          ]),
        ).rejects.toThrow(/ya hay una caja abierta/i);

        const { rows } = await db.query<{ open_cash_session: string }>(
          "select open_cash_session(100, $1, $2) as open_cash_session",
          [company.loc1, caja2],
        );
        sessionY = rows[0].open_cash_session;
      });

      // Cada cajero vende sin mandar till_id -- debe autoatribuirse a SU
      // propia sesión abierta, no a la del otro.
      let saleXId = "";
      let saleYId = "";
      await asUser(db, cajeroX, async () => {
        const { rows } = await db.query<{ create_sale: { sale_id: string } }>(
          "select create_sale(null,'Ticket','Efectivo',$1::jsonb,$2) as create_sale",
          [
            JSON.stringify([{ product_id: prod, qty: 1, unit_price: 10 }]),
            company.loc1,
          ],
        );
        saleXId = rows[0].create_sale.sale_id;
      });
      await asUser(db, cajeroY, async () => {
        const { rows } = await db.query<{ create_sale: { sale_id: string } }>(
          "select create_sale(null,'Ticket','Efectivo',$1::jsonb,$2) as create_sale",
          [
            JSON.stringify([{ product_id: prod, qty: 2, unit_price: 10 }]),
            company.loc1,
          ],
        );
        saleYId = rows[0].create_sale.sale_id;
      });

      const { rows: saleTills } = await db.query<{
        id: string;
        till_id: string;
      }>("select id, till_id from public.sales where id in ($1,$2)", [
        saleXId,
        saleYId,
      ]);
      const tillOf = (id: string) =>
        saleTills.find((s) => s.id === id)?.till_id;
      expect(tillOf(saleXId)).toBe(caja1);
      expect(tillOf(saleYId)).toBe(caja2);

      // Cerrar cada caja con conteo ciego exacto: el esperado debe reflejar
      // SOLO la venta de su propio cajero, no la del otro (la prueba de que
      // no se mezclan). 200 fondo + 10 de venta = 210: 1x200 + 1x10.
      await asUser(db, cajeroX, async () => {
        await submitTillCount(db, sessionX, [
          { denomination: 200, quantity: 1 },
          { denomination: 10, quantity: 1 },
        ]);
        const finish = await finishTillCount(db, sessionX);
        expect(finish.status).toBe("closed");
      });
      // 100 fondo + 20 de venta = 120: 1x100 + 1x20.
      await asUser(db, cajeroY, async () => {
        await submitTillCount(db, sessionY, [
          { denomination: 100, quantity: 1 },
          { denomination: 20, quantity: 1 },
        ]);
        const finish = await finishTillCount(db, sessionY);
        expect(finish.status).toBe("closed");
      });

      const admin = await makeUser(db, company.id, "admin");
      let authX: { expected_amount: number } | undefined;
      let authY: { expected_amount: number } | undefined;
      await asUser(db, admin, async () => {
        authX = await authorizeCashSession(db, sessionX);
        authY = await authorizeCashSession(db, sessionY);
      });

      expect(Number(authX!.expected_amount)).toBe(210);
      expect(Number(authY!.expected_amount)).toBe(120);
    });

    it("create_sale nunca bloquea la venta aunque no haya ninguna caja abierta", async () => {
      const company = await makeCompany(db, "Empresa Sin Caja Abierta Test");
      const prod = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Producto Sin Caja",
        1,
        5,
        50,
      );
      const admin = await makeUser(db, company.id, "admin");

      let saleId = "";
      let tillId: string | null = "unset";
      await asUser(db, admin, async () => {
        const { rows } = await db.query<{ create_sale: { sale_id: string } }>(
          "select create_sale(null,'Ticket','Efectivo',$1::jsonb,$2) as create_sale",
          [
            JSON.stringify([{ product_id: prod, qty: 1, unit_price: 5 }]),
            company.loc1,
          ],
        );
        saleId = rows[0].create_sale.sale_id;
      });

      const { rows } = await db.query<{ till_id: string | null }>(
        "select till_id from public.sales where id=$1",
        [saleId],
      );
      tillId = rows[0].till_id;
      expect(saleId).toBeTruthy(); // la venta se completó de todos modos
      expect(tillId).toBeNull(); // pero sin caja abierta, no hay a qué atribuirla
    });

    it("un solo caja por sucursal (caso Onisa hoy) sigue funcionando exactamente igual que antes", async () => {
      const company = await makeCompany(db, "Empresa Una Sola Caja Test");
      const admin = await makeUser(db, company.id, "admin");
      const prod = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Producto Una Caja",
        1,
        3,
        50,
      );

      let authResult:
        | { expected_amount: number; difference: number }
        | undefined;
      await asUser(db, admin, async () => {
        // Sin p_till_id: con una sola caja activa en la sucursal, se
        // autoasigna sola -- cero cambios de comportamiento para Onisa.
        const { rows: openRows } = await db.query<{
          open_cash_session: string;
        }>("select open_cash_session(50, $1) as open_cash_session", [
          company.loc1,
        ]);
        const sessionId = openRows[0].open_cash_session;
        await db.query(
          "select create_sale(null,'Ticket','Efectivo',$1::jsonb,$2) as create_sale",
          [
            JSON.stringify([{ product_id: prod, qty: 1, unit_price: 3 }]),
            company.loc1,
          ],
        );
        // 50 fondo + 3 de venta = 53: 1x50 + 1x2 + 1x1.
        await submitTillCount(db, sessionId, [
          { denomination: 50, quantity: 1 },
          { denomination: 2, quantity: 1 },
          { denomination: 1, quantity: 1 },
        ]);
        const finish = await finishTillCount(db, sessionId);
        expect(finish.status).toBe("closed");
        authResult = await authorizeCashSession(db, sessionId);
      });

      expect(Number(authResult!.expected_amount)).toBe(53);
      expect(Number(authResult!.difference)).toBe(0);
    });
  });

  describe("11. Etapas 3+4: arqueo ciego, segundo conteo y autorización", () => {
    it("submit_till_count nunca devuelve el monto esperado ni la diferencia", async () => {
      const company = await makeCompany(db, "Empresa Ciego Test");
      const cajero = await makeUser(db, company.id, "user");
      let result: Record<string, unknown> = {};
      await asUser(db, cajero, async () => {
        const { rows: openRows } = await db.query<{
          open_cash_session: string;
        }>("select open_cash_session(100, $1) as open_cash_session", [
          company.loc1,
        ]);
        result = await submitTillCount(db, openRows[0].open_cash_session, [
          { denomination: 100, quantity: 1 },
        ]);
      });
      expect(Object.keys(result).sort()).toEqual(
        [
          "card_total",
          "count_id",
          "count_number",
          "counted_cash_total",
          "manual_adjustment",
          "other_total",
          "transfer_total",
        ].sort(),
      );
      expect(result.expected_amount).toBeUndefined();
      expect(result.difference).toBeUndefined();
    });

    it("rechaza denominaciones que no son de la lista mexicana permitida", async () => {
      const company = await makeCompany(db, "Empresa Denominación Test");
      const cajero = await makeUser(db, company.id, "user");
      await asUser(db, cajero, async () => {
        const { rows: openRows } = await db.query<{
          open_cash_session: string;
        }>("select open_cash_session(100, $1) as open_cash_session", [
          company.loc1,
        ]);
        await expect(
          submitTillCount(db, openRows[0].open_cash_session, [
            { denomination: 999, quantity: 1 },
          ]),
        ).rejects.toThrow(/denominaci[oó]n inv[aá]lida/i);
      });
    });

    it("el ajuste manual se suma al total contado, para poder cuadrar montos con centavos que no caben en las denominaciones", async () => {
      const company = await makeCompany(db, "Empresa Ajuste Decimal Test");
      const cajero = await makeUser(db, company.id, "user");
      let sessionId = "";
      await asUser(db, cajero, async () => {
        // Fondo de $100.25 -- ese ".25" no se puede armar con la
        // denominación más chica ($0.50), solo con el ajuste manual.
        const { rows: openRows } = await db.query<{
          open_cash_session: string;
        }>("select open_cash_session(100.25, $1) as open_cash_session", [
          company.loc1,
        ]);
        sessionId = openRows[0].open_cash_session;

        const result = await submitTillCount(
          db,
          sessionId,
          [{ denomination: 100, quantity: 1 }],
          0.25,
        );
        expect(Number(result.manual_adjustment)).toBeCloseTo(0.25, 2);
        expect(Number(result.counted_cash_total)).toBeCloseTo(100.25, 2);

        const finish = await finishTillCount(db, sessionId);
        expect(finish.status).toBe("closed");
      });
    });

    it("rechaza un ajuste manual negativo", async () => {
      const company = await makeCompany(db, "Empresa Ajuste Negativo Test");
      const cajero = await makeUser(db, company.id, "user");
      await asUser(db, cajero, async () => {
        const { rows: openRows } = await db.query<{
          open_cash_session: string;
        }>("select open_cash_session(100, $1) as open_cash_session", [
          company.loc1,
        ]);
        await expect(
          submitTillCount(
            db,
            openRows[0].open_cash_session,
            [{ denomination: 100, quantity: 1 }],
            -0.5,
          ),
        ).rejects.toThrow(/ajuste manual debe ser un monto v[aá]lido/i);
      });
    });

    it("finish_till_count exige al menos un conteo antes de cerrar", async () => {
      const company = await makeCompany(db, "Empresa Sin Conteo Test");
      const cajero = await makeUser(db, company.id, "user");
      await asUser(db, cajero, async () => {
        const { rows: openRows } = await db.query<{
          open_cash_session: string;
        }>("select open_cash_session(100, $1) as open_cash_session", [
          company.loc1,
        ]);
        await expect(
          finishTillCount(db, openRows[0].open_cash_session),
        ).rejects.toThrow(/primero registra el conteo/i);
      });
    });

    it("si el primer conteo no cuadra, exige un segundo conteo de OTRA persona -- y con dos conteos, cierra sí o sí", async () => {
      const company = await makeCompany(db, "Empresa Segundo Conteo Test");
      const cajeroA = await makeUser(db, company.id, "user");
      const cajeroB = await makeUser(db, company.id, "user");
      const admin = await makeUser(db, company.id, "admin");

      let sessionId = "";
      await asUser(db, cajeroA, async () => {
        const { rows: openRows } = await db.query<{
          open_cash_session: string;
        }>("select open_cash_session(100, $1) as open_cash_session", [
          company.loc1,
        ]);
        sessionId = openRows[0].open_cash_session;

        // Conteo 1: 80 -- no cuadra contra el fondo de 100.
        await submitTillCount(db, sessionId, [
          { denomination: 50, quantity: 1 },
          { denomination: 20, quantity: 1 },
          { denomination: 10, quantity: 1 },
        ]);
        const finish1 = await finishTillCount(db, sessionId);
        expect(finish1.status).toBe("open");
        expect(finish1.second_count_required).toBe(true);

        // La misma persona no puede hacer el segundo conteo.
        await expect(
          submitTillCount(db, sessionId, [{ denomination: 100, quantity: 1 }]),
        ).rejects.toThrow(/persona distinta/i);
      });

      await asUser(db, cajeroB, async () => {
        // Conteo 2 (otra persona), también equivocado (95) -- con dos
        // conteos ya hechos, se cierra de todos modos.
        await submitTillCount(db, sessionId, [
          { denomination: 50, quantity: 1 },
          { denomination: 20, quantity: 2 },
          { denomination: 5, quantity: 1 },
        ]);
        const finish2 = await finishTillCount(db, sessionId);
        expect(finish2.status).toBe("closed");
        expect(finish2.second_count_required).toBe(false);
      });

      // Cerrada pero sin autorizar: expected/real/difference siguen sin
      // calcularse -- ESO es lo que hace que sea "INCOMPLETA" hasta que
      // alguien de admin/finanzas la autorice.
      const { rows: pending } = await db.query<{
        review_status: string;
        classification: string | null;
        expected_amount: number;
        real_amount: number | null;
      }>(
        "select review_status, classification, expected_amount, real_amount from public.cash_sessions where id=$1",
        [sessionId],
      );
      expect(pending[0].review_status).toBe("pending");
      expect(pending[0].classification).toBeNull();

      // Un cajero (no admin/finanzas) no puede autorizar.
      await asUser(db, cajeroA, async () => {
        await expect(authorizeCashSession(db, sessionId)).rejects.toThrow(
          /solo un administrador o finanzas/i,
        );
      });

      // El SEGUNDO conteo (95) es el que manda para el real -- no el primero.
      let auth:
        | { real_amount: number; difference: number; classification: string }
        | undefined;
      await asUser(db, admin, async () => {
        auth = await authorizeCashSession(db, sessionId);
      });
      expect(Number(auth!.real_amount)).toBe(95);
      expect(Number(auth!.difference)).toBe(-5);
      expect(auth!.classification).toBe("faltante");
    });

    it("clasifica SOBRANTE cuando el conteo final supera el esperado, y finanzas también puede autorizar", async () => {
      const company = await makeCompany(db, "Empresa Sobrante Test");
      const cajeroA = await makeUser(db, company.id, "user");
      const cajeroB = await makeUser(db, company.id, "user");
      const finanzas = await makeUser(db, company.id, "finanzas");

      let sessionId = "";
      await asUser(db, cajeroA, async () => {
        const { rows: openRows } = await db.query<{
          open_cash_session: string;
        }>("select open_cash_session(100, $1) as open_cash_session", [
          company.loc1,
        ]);
        sessionId = openRows[0].open_cash_session;
        await submitTillCount(db, sessionId, [
          { denomination: 50, quantity: 1 },
          { denomination: 20, quantity: 1 },
        ]); // 70, no cuadra
        await finishTillCount(db, sessionId);
      });
      await asUser(db, cajeroB, async () => {
        await submitTillCount(db, sessionId, [
          { denomination: 100, quantity: 1 },
          { denomination: 10, quantity: 1 },
        ]); // 110, sigue sin cuadrar -> cierra de todos modos
        const finish = await finishTillCount(db, sessionId);
        expect(finish.status).toBe("closed");
      });

      let auth: { difference: number; classification: string } | undefined;
      await asUser(db, finanzas, async () => {
        auth = await authorizeCashSession(db, sessionId);
      });
      expect(Number(auth!.difference)).toBe(10);
      expect(auth!.classification).toBe("sobrante");
    });

    it("no se puede enviar un tercer conteo", async () => {
      const company = await makeCompany(db, "Empresa Tercer Conteo Test");
      const cajeroA = await makeUser(db, company.id, "user");
      const cajeroB = await makeUser(db, company.id, "user");
      const cajeroC = await makeUser(db, company.id, "user");

      let sessionId = "";
      await asUser(db, cajeroA, async () => {
        const { rows: openRows } = await db.query<{
          open_cash_session: string;
        }>("select open_cash_session(100, $1) as open_cash_session", [
          company.loc1,
        ]);
        sessionId = openRows[0].open_cash_session;
        await submitTillCount(db, sessionId, [
          { denomination: 50, quantity: 1 },
        ]); // 50, no cuadra
      });
      await asUser(db, cajeroB, async () => {
        // No se llama finishTillCount entre el 2º y el intento de 3º, para
        // probar el candado de ">2 conteos" directamente (no solo el de
        // "la caja ya está cerrada").
        await submitTillCount(db, sessionId, [
          { denomination: 20, quantity: 2 },
          { denomination: 10, quantity: 1 },
        ]); // 50, tampoco cuadra
      });
      await asUser(db, cajeroC, async () => {
        await expect(
          submitTillCount(db, sessionId, [{ denomination: 100, quantity: 1 }]),
        ).rejects.toThrow(/ya se registraron los dos conteos|ya está cerrada/i);
      });
    });
  });

  describe("12. Etapa 5: bitácora (audit_log)", () => {
    it("registra abrir/contar/cerrar/autorizar, y un cajero no puede leerla", async () => {
      const company = await makeCompany(db, "Empresa Bitácora Test");
      const cajero = await makeUser(db, company.id, "user");
      const admin = await makeUser(db, company.id, "admin");

      let sessionId = "";
      await asUser(db, cajero, async () => {
        const { rows: openRows } = await db.query<{
          open_cash_session: string;
        }>("select open_cash_session(100, $1) as open_cash_session", [
          company.loc1,
        ]);
        sessionId = openRows[0].open_cash_session;

        await db.query(
          `insert into public.cash_movements (company_id, cash_session_id, movement_type, concept, amount, location_id)
           values ($1,$2,'ingreso','venta suelta',10,$3)`,
          [company.id, sessionId, company.loc1],
        );

        // 100 fondo + 10 ingreso = 110: cuadra al primer conteo.
        await submitTillCount(db, sessionId, [
          { denomination: 100, quantity: 1 },
          { denomination: 10, quantity: 1 },
        ]);
        await finishTillCount(db, sessionId);
      });

      // El cajero no puede leer la bitácora de su propia sesión (RLS la
      // filtra por completo -- no da error, simplemente no devuelve filas).
      await asUser(db, cajero, async () => {
        const { rows } = await db.query(
          "select id from public.audit_log where entity_id=$1",
          [sessionId],
        );
        expect(rows).toHaveLength(0);
      });

      let auditActions: string[] = [];
      await asUser(db, admin, async () => {
        await authorizeCashSession(db, sessionId);

        const { rows } = await db.query<{ action: string }>(
          "select action from public.audit_log where entity_id=$1 order by created_at asc",
          [sessionId],
        );
        auditActions = rows.map((r) => r.action);
      });

      expect(auditActions).toEqual([
        "opened",
        "movement_added",
        "count_submitted",
        "closed",
        "authorized",
      ]);

      // El detalle de 'authorized' sí trae las cifras completas -- es
      // seguro porque solo admin/finanzas pueden leer audit_log.
      const { rows: authRow } = await db.query<{ detail: unknown }>(
        "select detail from public.audit_log where entity_id=$1 and action='authorized'",
        [sessionId],
      );
      const detail = authRow[0].detail as { classification: string };
      expect(detail.classification).toBe("cuadrado");
    });
  });

  describe("12. SKU en productos y comisión de tarjeta configurable", () => {
    it("sku es único por empresa, pero permite null repetido y el mismo sku en otra empresa", async () => {
      const companyA = await makeCompany(db, "Empresa SKU A");
      const companyB = await makeCompany(db, "Empresa SKU B");
      const admin = await makeUser(db, companyA.id, "admin");

      await asUser(db, admin, async () => {
        await db.query(
          "insert into public.products (company_id, name, cost, price, sku) values ($1,'Producto 1',1,2,'SKU-1')",
          [companyA.id],
        );
        // Mismo sku, misma empresa -> falla.
        await expect(
          db.query(
            "insert into public.products (company_id, name, cost, price, sku) values ($1,'Producto 2',1,2,'SKU-1')",
            [companyA.id],
          ),
        ).rejects.toThrow();

        // sku null, varias veces, misma empresa -> no hay conflicto.
        await db.query(
          "insert into public.products (company_id, name, cost, price) values ($1,'Producto sin sku 1',1,2)",
          [companyA.id],
        );
        await db.query(
          "insert into public.products (company_id, name, cost, price) values ($1,'Producto sin sku 2',1,2)",
          [companyA.id],
        );
      });

      // Mismo sku, OTRA empresa -> permitido (único es por empresa, no global).
      const adminB = await makeUser(db, companyB.id, "admin");
      await asUser(db, adminB, async () => {
        await db.query(
          "insert into public.products (company_id, name, cost, price, sku) values ($1,'Producto B',1,2,'SKU-1')",
          [companyB.id],
        );
      });

      const { rows } = await db.query<{ count: string }>(
        "select count(*) from public.products where company_id=$1 and sku='SKU-1'",
        [companyB.id],
      );
      expect(Number(rows[0].count)).toBe(1);
    });

    it("card_commission_rate tiene 0.03 por defecto y admin puede actualizarlo", async () => {
      const company = await makeCompany(db, "Empresa Comisión Test");
      const admin = await makeUser(db, company.id, "admin");

      const { rows: before } = await db.query<{ card_commission_rate: number }>(
        "select card_commission_rate from public.companies where id=$1",
        [company.id],
      );
      expect(Number(before[0].card_commission_rate)).toBe(0.03);

      await asUser(db, admin, async () => {
        await db.query(
          "update public.companies set card_commission_rate=0.045 where id=$1",
          [company.id],
        );
      });

      const { rows: after } = await db.query<{ card_commission_rate: number }>(
        "select card_commission_rate from public.companies where id=$1",
        [company.id],
      );
      expect(Number(after[0].card_commission_rate)).toBe(0.045);
    });
  });

  describe("13. Puntos de lealtad (ganar/canjear en create_sale)", () => {
    async function setupLoyaltyCompany() {
      const company = await makeCompany(db, "Empresa Lealtad Test");
      const admin = await makeUser(db, company.id, "admin");
      // price_includes_tax=true por defecto -> total de línea = price*qty
      // exacto, sin que la tasa de IVA complique la aritmética de puntos.
      const product = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Producto Lealtad",
        50,
        100,
        1000,
      );
      return { company, admin, product };
    }

    it("con loyalty_enabled=false (default) no gana ni permite canjear puntos, aunque haya cliente y saldo", async () => {
      const { company, admin, product } = await setupLoyaltyCompany();
      const customer = await makeCustomer(
        db,
        company.id,
        "Cliente Sin Lealtad",
        50,
      );

      const result = await asUser(db, admin, () =>
        createSale(
          db,
          [{ product_id: product, qty: 1, unit_price: 100 }],
          company.loc1,
          undefined,
          { customerId: customer, pointsRedeemed: 30 },
        ),
      );

      expect(result.discount_total).toBe(0);
      expect(result.points_earned).toBe(0);
      expect(result.points_redeemed).toBe(0);
      expect(result.total).toBe(100);
      expect(await getCustomerLoyaltyPoints(db, customer)).toBe(50);
    });

    it("gana puntos por venta según loyalty_earn_rate cuando hay cliente", async () => {
      const { company, admin, product } = await setupLoyaltyCompany();
      await setLoyaltySettings(db, company.id, {
        enabled: true,
        pointValue: 1,
        earnRate: 10,
      });
      const customer = await makeCustomer(db, company.id, "Cliente Gana");

      const result = await asUser(db, admin, () =>
        createSale(
          db,
          [{ product_id: product, qty: 1, unit_price: 100 }],
          company.loc1,
          undefined,
          { customerId: customer },
        ),
      );

      expect(result.points_earned).toBe(10);
      expect(result.discount_total).toBe(0);
      expect(await getCustomerLoyaltyPoints(db, customer)).toBe(10);
    });

    it("canjea puntos como descuento del total, respetando el saldo real del cliente (nunca lo que mande el cliente)", async () => {
      const { company, admin, product } = await setupLoyaltyCompany();
      await setLoyaltySettings(db, company.id, {
        enabled: true,
        pointValue: 1,
        earnRate: 0,
      });
      const customer = await makeCustomer(db, company.id, "Cliente Canjea", 50);

      const result = await asUser(db, admin, () =>
        createSale(
          db,
          [{ product_id: product, qty: 1, unit_price: 100 }],
          company.loc1,
          undefined,
          { customerId: customer, pointsRedeemed: 30 },
        ),
      );

      expect(result.points_redeemed).toBe(30);
      expect(result.discount_total).toBe(30);
      expect(result.total).toBe(70);
      expect(await getCustomerLoyaltyPoints(db, customer)).toBe(20);
    });

    it("el canje se limita al saldo real del cliente, no a lo que pida el cliente", async () => {
      const { company, admin, product } = await setupLoyaltyCompany();
      await setLoyaltySettings(db, company.id, {
        enabled: true,
        pointValue: 1,
        earnRate: 0,
      });
      const customer = await makeCustomer(
        db,
        company.id,
        "Cliente Saldo Corto",
        5,
      );

      const result = await asUser(db, admin, () =>
        createSale(
          db,
          [{ product_id: product, qty: 1, unit_price: 100 }],
          company.loc1,
          undefined,
          { customerId: customer, pointsRedeemed: 100 },
        ),
      );

      expect(result.points_redeemed).toBe(5);
      expect(result.discount_total).toBe(5);
      expect(result.total).toBe(95);
      expect(await getCustomerLoyaltyPoints(db, customer)).toBe(0);
    });

    it("el canje se limita al total de la venta, no puede dejarla en negativo", async () => {
      const { company, admin } = await setupLoyaltyCompany();
      await setLoyaltySettings(db, company.id, {
        enabled: true,
        pointValue: 1,
        earnRate: 0,
      });
      const cheapProduct = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Producto Barato",
        10,
        20,
        1000,
      );
      const customer = await makeCustomer(
        db,
        company.id,
        "Cliente Saldo Alto",
        1000,
      );

      const result = await asUser(db, admin, () =>
        createSale(
          db,
          [{ product_id: cheapProduct, qty: 1, unit_price: 20 }],
          company.loc1,
          undefined,
          { customerId: customer, pointsRedeemed: 1000 },
        ),
      );

      expect(result.points_redeemed).toBe(20);
      expect(result.discount_total).toBe(20);
      expect(result.total).toBe(0);
      expect(await getCustomerLoyaltyPoints(db, customer)).toBe(980);
    });

    it("sin cliente seleccionado no gana ni canjea puntos, aunque loyalty esté habilitado", async () => {
      const { company, admin, product } = await setupLoyaltyCompany();
      await setLoyaltySettings(db, company.id, {
        enabled: true,
        pointValue: 1,
        earnRate: 10,
      });

      const result = await asUser(db, admin, () =>
        createSale(
          db,
          [{ product_id: product, qty: 1, unit_price: 100 }],
          company.loc1,
          undefined,
          { pointsRedeemed: 30 },
        ),
      );

      expect(result.points_earned).toBe(0);
      expect(result.points_redeemed).toBe(0);
      expect(result.discount_total).toBe(0);
      expect(result.total).toBe(100);
    });

    it("rechaza puntos a canjear negativos", async () => {
      const { company, admin, product } = await setupLoyaltyCompany();
      await setLoyaltySettings(db, company.id, {
        enabled: true,
        pointValue: 1,
        earnRate: 10,
      });
      const customer = await makeCustomer(
        db,
        company.id,
        "Cliente Negativo",
        10,
      );

      await expect(
        asUser(db, admin, () =>
          createSale(
            db,
            [{ product_id: product, qty: 1, unit_price: 100 }],
            company.loc1,
            undefined,
            { customerId: customer, pointsRedeemed: -5 },
          ),
        ),
      ).rejects.toThrow(/puntos invalidos/i);
    });

    it("regresión: sales.total queda neto post-descuento, igual a lo que devuelve create_sale (no rompe el pipeline de arqueo/reportes que suma sales.total)", async () => {
      const { company, admin, product } = await setupLoyaltyCompany();
      await setLoyaltySettings(db, company.id, {
        enabled: true,
        pointValue: 1,
        earnRate: 0,
      });
      const customer = await makeCustomer(
        db,
        company.id,
        "Cliente Regresión",
        40,
      );

      const result = await asUser(db, admin, () =>
        createSale(
          db,
          [{ product_id: product, qty: 1, unit_price: 100 }],
          company.loc1,
          undefined,
          { customerId: customer, pointsRedeemed: 40 },
        ),
      );

      const { rows } = await db.query<{
        total: number;
        subtotal: number;
        tax: number;
        discount_total: number;
      }>(
        "select total, subtotal, tax, discount_total from public.sales where id=$1",
        [result.sale_id],
      );
      const row = rows[0];
      expect(Number(row.total)).toBe(60);
      expect(Number(row.total)).toBe(result.total);
      expect(Number(row.discount_total)).toBe(40);
      // subtotal/tax siguen reflejando el valor real de los artículos
      // vendidos (para reportes de ganancia), sin el descuento aplicado.
      expect(Number(row.subtotal) + Number(row.tax)).toBe(100);
    });
  });

  describe("14. Módulo de empleados: PIN, checador, asistencia, faltas/vacaciones", () => {
    async function setupEmployeeCompany() {
      const company = await makeCompany(db, "Empresa Empleados Test");
      const admin = await makeUser(db, company.id, "admin");
      const employee = await makeUser(db, company.id, "user");
      return { company, admin, employee };
    }

    it("admin asigna PIN a un empleado; el mismo PIN no se puede repetir en la empresa", async () => {
      const { company, admin, employee } = await setupEmployeeCompany();
      const employee2 = await makeUser(db, company.id, "user");

      await asUser(db, admin, async () => {
        await db.query("select set_employee_pin($1, '1234')", [employee]);
        await expect(
          db.query("select set_employee_pin($1, '1234')", [employee2]),
        ).rejects.toThrow(/ya esta en uso/i);
      });
    });

    it("el PIN debe ser numérico de 4 a 6 dígitos", async () => {
      const { admin, employee } = await setupEmployeeCompany();
      await asUser(db, admin, async () => {
        await expect(
          db.query("select set_employee_pin($1, 'abcd')", [employee]),
        ).rejects.toThrow(/numerico/i);
        await expect(
          db.query("select set_employee_pin($1, '123')", [employee]),
        ).rejects.toThrow(/numerico/i);
      });
    });

    it("solo un admin puede asignar o quitar el PIN de un empleado", async () => {
      const { admin, employee } = await setupEmployeeCompany();
      await asUser(db, admin, async () => {
        await db.query("select set_employee_pin($1, '4321')", [employee]);
      });
      await asUser(db, employee, async () => {
        await expect(
          db.query("select set_employee_pin($1, '9999')", [employee]),
        ).rejects.toThrow(/no tienes permiso/i);
        await expect(
          db.query("select clear_employee_pin($1)", [employee]),
        ).rejects.toThrow(/no tienes permiso/i);
      });
    });

    it("punch_employee: primer PIN correcto hace check-in, el segundo hace check-out", async () => {
      const { company, admin, employee } = await setupEmployeeCompany();
      await asUser(db, admin, async () => {
        await db.query("select set_employee_pin($1, '1111')", [employee]);

        const { rows: inRows } = await db.query<{ punch_employee: unknown }>(
          "select punch_employee('1111', $1) as punch_employee",
          [company.loc1],
        );
        const checkIn = inRows[0].punch_employee as {
          action: string;
          profile_id: string;
        };
        expect(checkIn.action).toBe("check_in");
        expect(checkIn.profile_id).toBe(employee);

        const { rows: outRows } = await db.query<{ punch_employee: unknown }>(
          "select punch_employee('1111', $1) as punch_employee",
          [company.loc1],
        );
        const checkOut = outRows[0].punch_employee as { action: string };
        expect(checkOut.action).toBe("check_out");
      });

      const { rows } = await db.query<{
        status: string;
        check_out_at: string | null;
      }>(
        "select status, check_out_at from public.employee_attendance where profile_id=$1",
        [employee],
      );
      expect(rows[0].status).toBe("closed");
      expect(rows[0].check_out_at).not.toBeNull();
    });

    it("punch_employee marca retardo comparando la hora de entrada contra el horario de la sucursal", async () => {
      const { company, admin, employee } = await setupEmployeeCompany();
      // Abre "00:01" -- prácticamente cualquier check-in del día es tarde.
      await db.query(
        "update public.locations set opening_hours='00:01 - 23:59' where id=$1",
        [company.loc1],
      );
      await asUser(db, admin, async () => {
        await db.query("select set_employee_pin($1, '2222')", [employee]);
        const { rows } = await db.query<{ punch_employee: unknown }>(
          "select punch_employee('2222', $1) as punch_employee",
          [company.loc1],
        );
        const checkIn = rows[0].punch_employee as { is_late: boolean };
        expect(checkIn.is_late).toBe(true);
      });
    });

    it("el horario propio del empleado tiene prioridad sobre el de la sucursal", async () => {
      const { company, admin, employee } = await setupEmployeeCompany();
      // Sucursal abre "00:01" (prácticamente siempre tarde), pero el
      // empleado tiene turno propio que abre "23:58" (prácticamente nunca
      // tarde) -- debe ganar el horario propio.
      await db.query(
        "update public.locations set opening_hours='00:01 - 23:59' where id=$1",
        [company.loc1],
      );
      await db.query(
        "update public.profiles set shift_start='23:58', shift_end='23:59' where id=$1",
        [employee],
      );
      await asUser(db, admin, async () => {
        await db.query("select set_employee_pin($1, '2233')", [employee]);
        const { rows } = await db.query<{ punch_employee: unknown }>(
          "select punch_employee('2233', $1) as punch_employee",
          [company.loc1],
        );
        const checkIn = rows[0].punch_employee as { is_late: boolean };
        expect(checkIn.is_late).toBe(false);
      });
    });

    it("dos empleados de la misma sucursal con turnos distintos se evalúan cada uno con el suyo", async () => {
      const {
        company,
        admin,
        employee: lateEmployee,
      } = await setupEmployeeCompany();
      const onTimeEmployee = await makeUser(db, company.id, "user");
      await db.query(
        "update public.profiles set shift_start='00:01' where id=$1",
        [lateEmployee],
      );
      await db.query(
        "update public.profiles set shift_start='23:58' where id=$1",
        [onTimeEmployee],
      );
      await asUser(db, admin, async () => {
        await db.query("select set_employee_pin($1, '3344')", [lateEmployee]);
        await db.query("select set_employee_pin($1, '4455')", [onTimeEmployee]);
        const { rows: lateRows } = await db.query<{
          punch_employee: unknown;
        }>("select punch_employee('3344', $1) as punch_employee", [
          company.loc1,
        ]);
        const { rows: onTimeRows } = await db.query<{
          punch_employee: unknown;
        }>("select punch_employee('4455', $1) as punch_employee", [
          company.loc1,
        ]);
        expect(
          (lateRows[0].punch_employee as { is_late: boolean }).is_late,
        ).toBe(true);
        expect(
          (onTimeRows[0].punch_employee as { is_late: boolean }).is_late,
        ).toBe(false);
      });
    });

    it("punch_employee marca salida anticipada comparando contra el turno del empleado", async () => {
      const { company, admin, employee } = await setupEmployeeCompany();
      // Turno hasta "23:59" -- casi cualquier check-out del día es anticipado.
      await db.query(
        "update public.profiles set shift_start='00:00', shift_end='23:59' where id=$1",
        [employee],
      );
      await asUser(db, admin, async () => {
        await db.query("select set_employee_pin($1, '5566')", [employee]);
        await db.query("select punch_employee('5566', $1)", [company.loc1]);
        const { rows } = await db.query<{ punch_employee: unknown }>(
          "select punch_employee('5566', $1) as punch_employee",
          [company.loc1],
        );
        const checkOut = rows[0].punch_employee as {
          action: string;
          is_early_leave: boolean;
        };
        expect(checkOut.action).toBe("check_out");
        expect(checkOut.is_early_leave).toBe(true);
      });
    });

    it("PIN incorrecto es rechazado", async () => {
      const { company, admin, employee } = await setupEmployeeCompany();
      await asUser(db, admin, async () => {
        await db.query("select set_employee_pin($1, '3333')", [employee]);
        await expect(
          db.query("select punch_employee('0000', $1) as punch_employee", [
            company.loc1,
          ]),
        ).rejects.toThrow(/pin no reconocido/i);
      });
    });

    it("el PIN de un empleado de otra empresa no funciona (aislamiento entre empresas)", async () => {
      const { admin: adminA } = await setupEmployeeCompany();
      const { company: companyB, employee: employeeB } =
        await setupEmployeeCompany();
      const adminB2 = await makeUser(db, companyB.id, "admin");
      await asUser(db, adminB2, async () => {
        await db.query("select set_employee_pin($1, '7777')", [employeeB]);
      });

      await asUser(db, adminA, async () => {
        await expect(
          db.query("select punch_employee('7777') as punch_employee"),
        ).rejects.toThrow(/pin no reconocido/i);
      });
    });

    it("solo un admin puede operar el checador", async () => {
      const { admin, employee } = await setupEmployeeCompany();
      await asUser(db, admin, async () => {
        await db.query("select set_employee_pin($1, '8888')", [employee]);
      });
      await asUser(db, employee, async () => {
        await expect(
          db.query("select punch_employee('8888') as punch_employee"),
        ).rejects.toThrow(/no tienes permiso/i);
      });
    });

    it("adjust_stock graba quién hizo el ajuste (created_by), para calcular mermas por empleado", async () => {
      const { company, admin } = await setupEmployeeCompany();
      const product = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Producto Merma",
        5,
        10,
        20,
      );
      await asUser(db, admin, async () => {
        await db.query("select adjust_stock($1, $2, -3, 'merma de prueba')", [
          product,
          company.loc1,
        ]);
      });
      const { rows } = await db.query<{ created_by: string }>(
        "select created_by from public.stock_movements where product_id=$1 and movement_type='adjustment'",
        [product],
      );
      expect(rows[0].created_by).toBe(admin);
    });

    it("employee_time_events: solo el admin puede registrar faltas/vacaciones", async () => {
      const { company, admin, employee } = await setupEmployeeCompany();
      await asUser(db, admin, async () => {
        await db.query(
          `insert into public.employee_time_events (company_id, profile_id, type, event_date, note, created_by)
           values ($1, $2, 'absence', current_date, 'Cita medica', $3)`,
          [company.id, employee, admin],
        );
      });
      const { rows } = await db.query<{ count: string }>(
        "select count(*) from public.employee_time_events where profile_id=$1",
        [employee],
      );
      expect(Number(rows[0].count)).toBe(1);

      await asUser(db, employee, async () => {
        await expect(
          db.query(
            `insert into public.employee_time_events (company_id, profile_id, type, event_date, created_by)
             values ($1, $2, 'vacation', current_date, $2)`,
            [company.id, employee],
          ),
        ).rejects.toThrow(/row-level security/i);
      });
    });

    it("employee_time_events: una vacación guarda fecha de salida y de regreso; una falta solo un día", async () => {
      const { company, admin, employee } = await setupEmployeeCompany();
      await asUser(db, admin, async () => {
        await db.query(
          `insert into public.employee_time_events (company_id, profile_id, type, event_date, end_date, created_by)
           values ($1, $2, 'vacation', '2026-08-10', '2026-08-20', $2)`,
          [company.id, employee],
        );
        await db.query(
          `insert into public.employee_time_events (company_id, profile_id, type, event_date, created_by)
           values ($1, $2, 'absence', '2026-08-05', $2)`,
          [company.id, employee],
        );
      });

      const { rows } = await db.query<{
        type: string;
        event_date: string;
        end_date: string | null;
      }>(
        "select type, event_date, end_date from public.employee_time_events where profile_id=$1 order by event_date",
        [employee],
      );
      expect(rows[0].type).toBe("absence");
      expect(rows[0].end_date).toBeNull();
      expect(rows[1].type).toBe("vacation");
      expect(rows[1].end_date).not.toBeNull();
    });
  });

  describe("16. Promociones automáticas por cantidad (create_sale)", () => {
    async function makePromotion(
      companyId: string,
      opts: {
        scopeType: "product" | "category" | "none";
        productId?: string | null;
        categoryId?: string | null;
        minQty?: number | null;
        valueText?: string | null;
        promotionType?: string;
        active?: boolean;
        startsAt?: string | null;
        endsAt?: string | null;
      },
    ): Promise<string> {
      const { rows } = await db.query<{ id: string }>(
        `insert into public.promotions
           (company_id, name, promotion_type, scope_type, product_id, category_id, min_qty, value_text, active, starts_at, ends_at)
         values ($1, 'Promo test', $2, $3, $4, $5, $6, $7, $8, $9, $10)
         returning id`,
        [
          companyId,
          opts.promotionType ?? "discount",
          opts.scopeType,
          opts.productId ?? null,
          opts.categoryId ?? null,
          opts.minQty ?? null,
          opts.valueText ?? null,
          opts.active ?? true,
          opts.startsAt ?? null,
          opts.endsAt ?? null,
        ],
      );
      return rows[0].id;
    }

    it("aplica el descuento automático cuando la cantidad de un producto llega al mínimo", async () => {
      const company = await makeCompany(db, "Empresa Promo Producto");
      const admin = await makeUser(db, company.id, "admin");
      const product = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Copias",
        3,
        10,
        1000,
      );
      await makePromotion(company.id, {
        scopeType: "product",
        productId: product,
        minQty: 20,
        valueText: "50%",
      });

      const result = await asUser(db, admin, () =>
        createSale(
          db,
          [{ product_id: product, qty: 20, unit_price: 10 }],
          company.loc1,
        ),
      );

      expect(result.total).toBe(100);
      expect(result.promo_discount).toBe(100);
      expect(result.discount_total).toBe(100);
    });

    it("no aplica el descuento si la cantidad no alcanza el mínimo", async () => {
      const company = await makeCompany(db, "Empresa Promo Bajo Minimo");
      const admin = await makeUser(db, company.id, "admin");
      const product = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Copias",
        3,
        10,
        1000,
      );
      await makePromotion(company.id, {
        scopeType: "product",
        productId: product,
        minQty: 20,
        valueText: "50%",
      });

      const result = await asUser(db, admin, () =>
        createSale(
          db,
          [{ product_id: product, qty: 19, unit_price: 10 }],
          company.loc1,
        ),
      );

      expect(result.total).toBe(190);
      expect(result.promo_discount).toBe(0);
    });

    it("una promoción por categoría suma cantidades de varios productos de esa categoría", async () => {
      const company = await makeCompany(db, "Empresa Promo Categoria");
      const admin = await makeUser(db, company.id, "admin");
      const { rows: catRows } = await db.query<{ id: string }>(
        "insert into public.categories (company_id, name) values ($1, 'Copias') returning id",
        [company.id],
      );
      const categoryId = catRows[0].id;
      const productA = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Copias BN",
        3,
        10,
        1000,
      );
      const productB = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Copias Color",
        6,
        20,
        1000,
      );
      await db.query(
        "update public.products set category_id=$1 where id in ($2,$3)",
        [categoryId, productA, productB],
      );
      await makePromotion(company.id, {
        scopeType: "category",
        categoryId,
        minQty: 20,
        valueText: "50%",
      });

      // 10 de A + 10 de B = 20 en la categoría -- ninguno solo llega al
      // mínimo, pero juntos sí.
      const result = await asUser(db, admin, () =>
        createSale(
          db,
          [
            { product_id: productA, qty: 10, unit_price: 10 },
            { product_id: productB, qty: 10, unit_price: 20 },
          ],
          company.loc1,
        ),
      );

      expect(result.total).toBe(150); // (10*5) + (10*10)
      expect(result.promo_discount).toBe(150); // (10*5) + (10*10) ahorrado
    });

    it("una promoción inactiva o fuera de rango de fechas no se aplica", async () => {
      const company = await makeCompany(db, "Empresa Promo Inactiva");
      const admin = await makeUser(db, company.id, "admin");
      const product = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Copias",
        3,
        10,
        1000,
      );
      await makePromotion(company.id, {
        scopeType: "product",
        productId: product,
        minQty: 20,
        valueText: "50%",
        active: false,
      });
      await makePromotion(company.id, {
        scopeType: "product",
        productId: product,
        minQty: 20,
        valueText: "50%",
        startsAt: "2099-01-01",
      });

      const result = await asUser(db, admin, () =>
        createSale(
          db,
          [{ product_id: product, qty: 30, unit_price: 10 }],
          company.loc1,
        ),
      );

      expect(result.promo_discount).toBe(0);
      expect(result.total).toBe(300);
    });

    it("si compiten dos promociones sobre el mismo producto, gana la de mayor porcentaje (no se acumulan)", async () => {
      const company = await makeCompany(db, "Empresa Promo Competencia");
      const admin = await makeUser(db, company.id, "admin");
      const { rows: catRows } = await db.query<{ id: string }>(
        "insert into public.categories (company_id, name) values ($1, 'Copias') returning id",
        [company.id],
      );
      const categoryId = catRows[0].id;
      const product = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Copias",
        3,
        10,
        1000,
      );
      await db.query("update public.products set category_id=$1 where id=$2", [
        categoryId,
        product,
      ]);
      await makePromotion(company.id, {
        scopeType: "category",
        categoryId,
        minQty: 1,
        valueText: "30%",
      });
      await makePromotion(company.id, {
        scopeType: "product",
        productId: product,
        minQty: 20,
        valueText: "50%",
      });

      const result = await asUser(db, admin, () =>
        createSale(
          db,
          [{ product_id: product, qty: 20, unit_price: 10 }],
          company.loc1,
        ),
      );

      // Gana el 50% (mayor descuento), no se suma al 30%.
      expect(result.total).toBe(100);
      expect(result.promo_discount).toBe(100);
    });

    it("promociones 2x1 o combo no se aplican solas (solo 'discount' se automatiza)", async () => {
      const company = await makeCompany(db, "Empresa Promo 2x1");
      const admin = await makeUser(db, company.id, "admin");
      const product = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Copias",
        3,
        10,
        1000,
      );
      await makePromotion(company.id, {
        scopeType: "product",
        productId: product,
        minQty: 1,
        valueText: null,
        promotionType: "2x1",
      });

      const result = await asUser(db, admin, () =>
        createSale(
          db,
          [{ product_id: product, qty: 10, unit_price: 10 }],
          company.loc1,
        ),
      );

      expect(result.promo_discount).toBe(0);
      expect(result.total).toBe(100);
    });

    it("la promoción automática funciona junto con el canje de puntos de lealtad", async () => {
      const company = await makeCompany(db, "Empresa Promo Lealtad");
      const admin = await makeUser(db, company.id, "admin");
      await setLoyaltySettings(db, company.id, {
        enabled: true,
        pointValue: 1,
        earnRate: 0,
      });
      const customer = await makeCustomer(db, company.id, "Cliente Promo", 30);
      const product = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Copias",
        3,
        10,
        1000,
      );
      await makePromotion(company.id, {
        scopeType: "product",
        productId: product,
        minQty: 20,
        valueText: "50%",
      });

      // 20 * 10 = 200 -> promo 50% -> 100 -> canje 30 puntos ($30) -> 70.
      const result = await asUser(db, admin, () =>
        createSale(
          db,
          [{ product_id: product, qty: 20, unit_price: 10 }],
          company.loc1,
          undefined,
          { customerId: customer, pointsRedeemed: 30 },
        ),
      );

      expect(result.promo_discount).toBe(100);
      expect(result.points_redeemed).toBe(30);
      expect(result.total).toBe(70);
      expect(result.discount_total).toBe(130);
    });

    it("regresión: subtotal + tax sigue siendo igual a total en una venta con promoción automática", async () => {
      const company = await makeCompany(db, "Empresa Promo Regresion");
      const admin = await makeUser(db, company.id, "admin");
      const product = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Copias",
        3,
        10,
        1000,
      );
      await makePromotion(company.id, {
        scopeType: "product",
        productId: product,
        minQty: 20,
        valueText: "50%",
      });

      const result = await asUser(db, admin, () =>
        createSale(
          db,
          [{ product_id: product, qty: 20, unit_price: 10 }],
          company.loc1,
        ),
      );

      expect(Math.round((result.subtotal + result.tax) * 100) / 100).toBe(
        result.total,
      );
    });
  });

  describe("17. Pago dividido (sale_payments) y arqueo por método", () => {
    async function setupPaymentCompany() {
      const company = await makeCompany(db, "Empresa Pago Dividido");
      const admin = await makeUser(db, company.id, "admin");
      const product = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Producto Pago",
        50,
        200,
        1000,
      );
      return { company, admin, product };
    }

    it("un pago dividido que suma exacto al total se acepta y guarda el desglose", async () => {
      const { company, admin, product } = await setupPaymentCompany();
      const result = await asUser(db, admin, () =>
        createSale(
          db,
          [{ product_id: product, qty: 1, unit_price: 200 }],
          company.loc1,
          undefined,
          {
            payments: [
              { method: "Efectivo", amount: 60 },
              { method: "Tarjeta", amount: 140 },
            ],
          },
        ),
      );
      expect(result.total).toBe(200);

      const { rows } = await db.query<{ method: string; amount: number }>(
        "select method, amount from public.sale_payments where sale_id=$1 order by method",
        [result.sale_id],
      );
      expect(rows).toHaveLength(2);
      expect(rows.find((r) => r.method === "Efectivo")?.amount).toBe("60.00");
      expect(rows.find((r) => r.method === "Tarjeta")?.amount).toBe("140.00");

      const { rows: saleRows } = await db.query<{ payment_method: string }>(
        "select payment_method from public.sales where id=$1",
        [result.sale_id],
      );
      expect(saleRows[0].payment_method).toBe("Mixto");
    });

    it("un pago dividido que no cuadra con el total se rechaza", async () => {
      const { company, admin, product } = await setupPaymentCompany();
      await asUser(db, admin, async () => {
        await expect(
          createSale(
            db,
            [{ product_id: product, qty: 1, unit_price: 200 }],
            company.loc1,
            undefined,
            {
              payments: [
                { method: "Efectivo", amount: 60 },
                { method: "Tarjeta", amount: 100 },
              ],
            },
          ),
        ).rejects.toThrow(/no coincide con el total/i);
      });
    });

    it("sin desglose de pagos se guarda una sola fila, igual que antes (regresión)", async () => {
      const { company, admin, product } = await setupPaymentCompany();
      const result = await asUser(db, admin, () =>
        createSale(
          db,
          [{ product_id: product, qty: 1, unit_price: 200 }],
          company.loc1,
        ),
      );
      const { rows } = await db.query<{ method: string; amount: number }>(
        "select method, amount from public.sale_payments where sale_id=$1",
        [result.sale_id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].method).toBe("Efectivo");
      expect(rows[0].amount).toBe("200.00");
    });

    it("el arqueo solo cuenta la porción en efectivo de una venta con pago dividido", async () => {
      const { company, admin, product } = await setupPaymentCompany();
      await asUser(db, admin, async () => {
        const { rows: openRows } = await db.query<{
          open_cash_session: string;
        }>("select open_cash_session(100, $1) as open_cash_session", [
          company.loc1,
        ]);
        const sessionId = openRows[0].open_cash_session;

        await createSale(
          db,
          [{ product_id: product, qty: 1, unit_price: 200 }],
          company.loc1,
          undefined,
          {
            payments: [
              { method: "Efectivo", amount: 50, kind: "cash" },
              { method: "Tarjeta de débito", amount: 150, kind: "card" },
            ],
          },
        );

        // Esperado: 100 (fondo) + 50 (solo la porción en efectivo) = 150,
        // NO 100 + 200 (el total completo de la venta).
        const count = await submitTillCount(db, sessionId, [
          { denomination: 100, quantity: 1 },
          { denomination: 50, quantity: 1 },
        ]);
        expect(Number(count.card_total)).toBe(150);

        await finishTillCount(db, sessionId);
        const authResult = await authorizeCashSession(db, sessionId);
        expect(Number(authResult.expected_amount)).toBe(150);
        expect(Number(authResult.real_amount)).toBe(150);
        expect(authResult.classification).toBe("cuadrado");
      });
    });

    it("sales_by_payment_method atribuye cada porción de una venta dividida a su método", async () => {
      const { company, admin, product } = await setupPaymentCompany();
      await asUser(db, admin, async () => {
        await createSale(
          db,
          [{ product_id: product, qty: 1, unit_price: 200 }],
          company.loc1,
          undefined,
          {
            payments: [
              { method: "Efectivo", amount: 70 },
              { method: "Tarjeta", amount: 130 },
            ],
          },
        );

        const { rows } = await db.query<{ method: string; total: number }>(
          "select * from sales_by_payment_method()",
        );
        const byMethod = new Map(rows.map((r) => [r.method, Number(r.total)]));
        expect(byMethod.get("Efectivo")).toBe(70);
        expect(byMethod.get("Tarjeta")).toBe(130);
      });
    });
  });

  describe("18. Venta a crédito (customers.credit_limit/credit_balance)", () => {
    async function setupCreditCompany() {
      const company = await makeCompany(db, "Empresa Credito Test");
      const admin = await makeUser(db, company.id, "admin");
      const product = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Producto Credito",
        50,
        200,
        1000,
      );
      return { company, admin, product };
    }

    it("una venta a crédito dentro del límite se acepta y aumenta el saldo del cliente", async () => {
      const { company, admin, product } = await setupCreditCompany();
      const customer = await makeCustomer(db, company.id, "Cliente Credito");
      await db.query(
        "update public.customers set credit_limit=500 where id=$1",
        [customer],
      );

      const result = await asUser(db, admin, () =>
        createSale(
          db,
          [{ product_id: product, qty: 1, unit_price: 200 }],
          company.loc1,
          undefined,
          {
            customerId: customer,
            payments: [{ method: "Crédito", amount: 200, kind: "credit" }],
          },
        ),
      );
      expect(result.total).toBe(200);

      const { rows } = await db.query<{ credit_balance: number }>(
        "select credit_balance from public.customers where id=$1",
        [customer],
      );
      expect(Number(rows[0].credit_balance)).toBe(200);
    });

    it("una venta a crédito que excede el límite disponible se rechaza", async () => {
      const { company, admin, product } = await setupCreditCompany();
      const customer = await makeCustomer(db, company.id, "Cliente Limite");
      await db.query(
        "update public.customers set credit_limit=100 where id=$1",
        [customer],
      );

      await asUser(db, admin, async () => {
        await expect(
          createSale(
            db,
            [{ product_id: product, qty: 1, unit_price: 200 }],
            company.loc1,
            undefined,
            {
              customerId: customer,
              payments: [{ method: "Crédito", amount: 200, kind: "credit" }],
            },
          ),
        ).rejects.toThrow(/credito disponible/i);
      });

      const { rows } = await db.query<{ credit_balance: number }>(
        "select credit_balance from public.customers where id=$1",
        [customer],
      );
      expect(Number(rows[0].credit_balance)).toBe(0);
    });

    it("vender a crédito sin cliente seleccionado se rechaza", async () => {
      const { company, admin, product } = await setupCreditCompany();
      await asUser(db, admin, async () => {
        await expect(
          createSale(
            db,
            [{ product_id: product, qty: 1, unit_price: 200 }],
            company.loc1,
            undefined,
            {
              payments: [{ method: "Crédito", amount: 200, kind: "credit" }],
            },
          ),
        ).rejects.toThrow(/elige un cliente/i);
      });
    });

    it("un cliente sin límite de crédito asignado no puede comprar a crédito", async () => {
      const { company, admin, product } = await setupCreditCompany();
      const customer = await makeCustomer(
        db,
        company.id,
        "Cliente Sin Credito",
      );
      await asUser(db, admin, async () => {
        await expect(
          createSale(
            db,
            [{ product_id: product, qty: 1, unit_price: 200 }],
            company.loc1,
            undefined,
            {
              customerId: customer,
              payments: [{ method: "Crédito", amount: 200, kind: "credit" }],
            },
          ),
        ).rejects.toThrow(/no tiene credito habilitado/i);
      });
    });

    it("el crédito se puede combinar con efectivo en la misma venta", async () => {
      const { company, admin, product } = await setupCreditCompany();
      const customer = await makeCustomer(db, company.id, "Cliente Mixto");
      await db.query(
        "update public.customers set credit_limit=500 where id=$1",
        [customer],
      );

      const result = await asUser(db, admin, () =>
        createSale(
          db,
          [{ product_id: product, qty: 1, unit_price: 200 }],
          company.loc1,
          undefined,
          {
            customerId: customer,
            payments: [
              { method: "Efectivo", amount: 100, kind: "cash" },
              { method: "Crédito", amount: 100, kind: "credit" },
            ],
          },
        ),
      );
      expect(result.total).toBe(200);

      const { rows } = await db.query<{ credit_balance: number }>(
        "select credit_balance from public.customers where id=$1",
        [customer],
      );
      expect(Number(rows[0].credit_balance)).toBe(100);
    });

    it("una venta a crédito nunca cuenta como dinero cobrado en el arqueo", async () => {
      const { company, admin, product } = await setupCreditCompany();
      const customer = await makeCustomer(db, company.id, "Cliente Arqueo");
      await db.query(
        "update public.customers set credit_limit=500 where id=$1",
        [customer],
      );

      await asUser(db, admin, async () => {
        const { rows: openRows } = await db.query<{
          open_cash_session: string;
        }>("select open_cash_session(100, $1) as open_cash_session", [
          company.loc1,
        ]);
        const sessionId = openRows[0].open_cash_session;

        await createSale(
          db,
          [{ product_id: product, qty: 1, unit_price: 200 }],
          company.loc1,
          undefined,
          {
            customerId: customer,
            payments: [{ method: "Crédito", amount: 200, kind: "credit" }],
          },
        );

        // Solo el fondo (100) -- la venta a crédito no metió nada a la caja.
        const count = await submitTillCount(db, sessionId, [
          { denomination: 100, quantity: 1 },
        ]);
        expect(Number(count.card_total)).toBe(0);
        expect(Number(count.transfer_total)).toBe(0);
        expect(Number(count.other_total)).toBe(0);

        await finishTillCount(db, sessionId);
        const authResult = await authorizeCashSession(db, sessionId);
        expect(Number(authResult.expected_amount)).toBe(100);
        expect(authResult.classification).toBe("cuadrado");
      });
    });

    it("collect_customer_credit reduce el saldo y, en efectivo con caja abierta, también entra a cash_movements", async () => {
      const { company, admin, product } = await setupCreditCompany();
      const customer = await makeCustomer(db, company.id, "Cliente Cobro");
      await db.query(
        "update public.customers set credit_limit=500 where id=$1",
        [customer],
      );

      await asUser(db, admin, async () => {
        await createSale(
          db,
          [{ product_id: product, qty: 1, unit_price: 200 }],
          company.loc1,
          undefined,
          {
            customerId: customer,
            payments: [{ method: "Crédito", amount: 200, kind: "credit" }],
          },
        );

        const { rows: openRows } = await db.query<{
          open_cash_session: string;
        }>("select open_cash_session(0, $1) as open_cash_session", [
          company.loc1,
        ]);
        const sessionId = openRows[0].open_cash_session;

        const { rows } = await db.query<{ collect_customer_credit: unknown }>(
          "select collect_customer_credit($1, 150, 'Efectivo', 'cash') as collect_customer_credit",
          [customer],
        );
        const collected = rows[0].collect_customer_credit as {
          applied: number;
          remaining_balance: number;
        };
        expect(Number(collected.applied)).toBe(150);
        expect(Number(collected.remaining_balance)).toBe(50);

        const { rows: balRows } = await db.query<{ credit_balance: number }>(
          "select credit_balance from public.customers where id=$1",
          [customer],
        );
        expect(Number(balRows[0].credit_balance)).toBe(50);

        const { rows: movRows } = await db.query<{ amount: number }>(
          "select amount from public.cash_movements where cash_session_id=$1 and concept='Cobro de credito'",
          [sessionId],
        );
        expect(movRows).toHaveLength(1);
        expect(Number(movRows[0].amount)).toBe(150);
      });
    });

    it("collect_customer_credit topa el cobro al saldo real, nunca lo excede", async () => {
      const { company, admin, product } = await setupCreditCompany();
      const customer = await makeCustomer(db, company.id, "Cliente Topado");
      await db.query(
        "update public.customers set credit_limit=500 where id=$1",
        [customer],
      );
      await asUser(db, admin, async () => {
        await createSale(
          db,
          [{ product_id: product, qty: 1, unit_price: 200 }],
          company.loc1,
          undefined,
          {
            customerId: customer,
            payments: [{ method: "Crédito", amount: 200, kind: "credit" }],
          },
        );

        const { rows } = await db.query<{ collect_customer_credit: unknown }>(
          "select collect_customer_credit($1, 500, 'Efectivo', 'cash') as collect_customer_credit",
          [customer],
        );
        const collected = rows[0].collect_customer_credit as {
          applied: number;
          remaining_balance: number;
        };
        expect(Number(collected.applied)).toBe(200);
        expect(Number(collected.remaining_balance)).toBe(0);
      });
    });

    it("un cobro de crédito por tarjeta no se registra en cash_movements (no afecta el cajón físico)", async () => {
      const { company, admin, product } = await setupCreditCompany();
      const customer = await makeCustomer(db, company.id, "Cliente Tarjeta");
      await db.query(
        "update public.customers set credit_limit=500 where id=$1",
        [customer],
      );

      await asUser(db, admin, async () => {
        await createSale(
          db,
          [{ product_id: product, qty: 1, unit_price: 200 }],
          company.loc1,
          undefined,
          {
            customerId: customer,
            payments: [{ method: "Crédito", amount: 200, kind: "credit" }],
          },
        );

        const { rows: openRows } = await db.query<{
          open_cash_session: string;
        }>("select open_cash_session(0, $1) as open_cash_session", [
          company.loc1,
        ]);
        const sessionId = openRows[0].open_cash_session;

        await db.query(
          "select collect_customer_credit($1, 200, 'Tarjeta de débito', 'card')",
          [customer],
        );

        const { rows: movRows } = await db.query<{ id: string }>(
          "select id from public.cash_movements where cash_session_id=$1",
          [sessionId],
        );
        expect(movRows).toHaveLength(0);

        const { rows: balRows } = await db.query<{ credit_balance: number }>(
          "select credit_balance from public.customers where id=$1",
          [customer],
        );
        expect(Number(balRows[0].credit_balance)).toBe(0);
      });
    });
  });

  describe("19. Restablecer sistema (reset_company_data)", () => {
    async function setupDirtyCompany() {
      const company = await makeCompany(db, "Empresa Sucia Test");
      await db.query(
        "update public.companies set tax_rate=0.99, tax_name='X', fiscal_id_label='Y', card_commission_rate=0.5, loyalty_enabled=true, loyalty_point_value=1, loyalty_earn_rate=1, name='Empresa Sucia Test' where id=$1",
        [company.id],
      );
      const admin = await makeUser(db, company.id, "admin");
      const cashier = await makeUser(db, company.id, "user");
      const product = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Producto Sucio",
        50,
        200,
        100,
      );
      const customer = await makeCustomer(db, company.id, "Cliente Sucio");
      await asUser(db, admin, () =>
        createSale(
          db,
          [{ product_id: product, qty: 1, unit_price: 200 }],
          company.loc1,
          undefined,
          { customerId: customer },
        ),
      );
      await db.query(
        "update public.profiles set location_id=$2, allowed_sections=$3, pin_hash='x', shift_start='08:00', shift_end='14:00' where id=$1",
        [admin, company.loc1, ["pos"]],
      );
      return { company, admin, cashier, product, customer };
    }

    it("borra ventas, productos, clientes y demás datos operativos de la empresa", async () => {
      const { company, admin } = await setupDirtyCompany();

      await asUser(db, admin, () =>
        db.query("select reset_company_data($1)", ["Empresa Sucia Test"]),
      );

      const tables = [
        "sales",
        "sale_items",
        "sale_payments",
        "products",
        "categories",
        "customers",
        "product_locations",
      ];
      for (const table of tables) {
        const { rows } = await db.query<{ count: string }>(
          `select count(*)::int as count from public.${table} where company_id=$1`,
          [company.id],
        );
        expect(Number(rows[0].count)).toBe(0);
      }
    });

    it("no toca los datos de otra empresa (aislamiento entre tenants)", async () => {
      const { admin } = await setupDirtyCompany();
      const otherCompany = await makeCompany(db, "Empresa Intacta Test");
      const otherAdmin = await makeUser(db, otherCompany.id, "admin");
      await makeProduct(
        db,
        otherCompany.id,
        otherCompany.loc1,
        "Producto Intacto",
        10,
        20,
        5,
      );

      await asUser(db, admin, () =>
        db.query("select reset_company_data($1)", ["Empresa Sucia Test"]),
      );

      const { rows } = await db.query<{ count: string }>(
        "select count(*)::int as count from public.products where company_id=$1",
        [otherCompany.id],
      );
      expect(Number(rows[0].count)).toBe(1);
      void otherAdmin;
    });

    it("solo un admin puede restablecer; un cajero es rechazado", async () => {
      const { cashier } = await setupDirtyCompany();
      await expect(
        asUser(db, cashier, () =>
          db.query("select reset_company_data($1)", ["Empresa Sucia Test"]),
        ),
      ).rejects.toThrow(/permiso/i);
    });

    it("rechaza la operación si el nombre de confirmación no coincide exactamente", async () => {
      const { admin } = await setupDirtyCompany();
      await expect(
        asUser(db, admin, () =>
          db.query("select reset_company_data($1)", ["nombre incorrecto"]),
        ),
      ).rejects.toThrow(/no coincide/i);
    });

    it("recrea la sucursal Principal con su Caja 1 después del reset", async () => {
      const { company, admin } = await setupDirtyCompany();

      await asUser(db, admin, () =>
        db.query("select reset_company_data($1)", ["Empresa Sucia Test"]),
      );

      const { rows: locRows } = await db.query<{ id: string; name: string }>(
        "select id, name from public.locations where company_id=$1",
        [company.id],
      );
      expect(locRows).toHaveLength(1);
      expect(locRows[0].name).toBe("Principal");

      const { rows: tillRows } = await db.query<{ name: string }>(
        "select name from public.tills where company_id=$1 and location_id=$2",
        [company.id, locRows[0].id],
      );
      expect(tillRows).toHaveLength(1);
      expect(tillRows[0].name).toBe("Caja 1");
    });

    it("regresa impuestos, comisión y lealtad a los valores por defecto de una empresa nueva", async () => {
      const { company, admin } = await setupDirtyCompany();

      await asUser(db, admin, () =>
        db.query("select reset_company_data($1)", ["Empresa Sucia Test"]),
      );

      const { rows } = await db.query<{
        tax_rate: string;
        tax_name: string;
        fiscal_id_label: string;
        card_commission_rate: string;
        loyalty_enabled: boolean;
        loyalty_point_value: string;
        name: string;
      }>(
        "select tax_rate, tax_name, fiscal_id_label, card_commission_rate, loyalty_enabled, loyalty_point_value, name from public.companies where id=$1",
        [company.id],
      );
      const row = rows[0];
      expect(Number(row.tax_rate)).toBeCloseTo(0.16);
      expect(row.tax_name).toBe("IVA");
      expect(row.fiscal_id_label).toBe("RFC");
      expect(Number(row.card_commission_rate)).toBeCloseTo(0.03);
      expect(row.loyalty_enabled).toBe(false);
      expect(Number(row.loyalty_point_value)).toBe(0);
      expect(row.name).toBe("Mi Negocio");
    });

    it("limpia el perfil del admin que restablece, pero no lo borra ni borra a otros miembros del equipo", async () => {
      const { admin, cashier } = await setupDirtyCompany();

      await asUser(db, admin, () =>
        db.query("select reset_company_data($1)", ["Empresa Sucia Test"]),
      );

      const { rows: adminRows } = await db.query<{
        location_id: string | null;
        allowed_sections: unknown;
        pin_hash: string | null;
        shift_start: string | null;
      }>(
        "select location_id, allowed_sections, pin_hash, shift_start from public.profiles where id=$1",
        [admin],
      );
      expect(adminRows).toHaveLength(1);
      expect(adminRows[0].location_id).toBeNull();
      expect(adminRows[0].allowed_sections).toBeNull();
      expect(adminRows[0].pin_hash).toBeNull();
      expect(adminRows[0].shift_start).toBeNull();

      const { rows: cashierRows } = await db.query<{ id: string }>(
        "select id from public.profiles where id=$1",
        [cashier],
      );
      expect(cashierRows).toHaveLength(1);
    });

    // Regresión: al restablecer el sistema se borra a todo el equipo (menos
    // quien ejecuta la acción) vía el mismo camino que usa /usuarios --
    // auth.admin.deleteUser(), que en Postgres es un DELETE FROM auth.users
    // que hace cascada hasta profiles. till_counts.counted_by tenía "not
    // null" + "on delete set null" al mismo tiempo (contradictorio): en
    // producción, borrar a cualquiera que hubiera contado una caja alguna
    // vez tumbaba el DELETE completo con "Database error deleting user".
    it("borrar la cuenta de alguien que contó una caja no falla (till_counts.counted_by queda en null)", async () => {
      const company = await makeCompany(db, "Empresa Conteo Borrado Test");
      const cajero = await makeUser(db, company.id, "user");

      let countId = "";
      await asUser(db, cajero, async () => {
        const { rows: openRows } = await db.query<{
          open_cash_session: string;
        }>("select open_cash_session(100, $1) as open_cash_session", [
          company.loc1,
        ]);
        const result = await submitTillCount(
          db,
          openRows[0].open_cash_session,
          [{ denomination: 100, quantity: 1 }],
        );
        countId = result.count_id;
      });

      await expect(
        db.query("delete from auth.users where id=$1", [cajero]),
      ).resolves.toBeDefined();

      const { rows } = await db.query<{ counted_by: string | null }>(
        "select counted_by from public.till_counts where id=$1",
        [countId],
      );
      expect(rows[0].counted_by).toBeNull();
    });
  });

  describe("20. Seguridad: el registro público no puede autoasignarse a una empresa existente", () => {
    // Auditoría 2026-08: handle_new_user() confiaba en un "company_id" que
    // viene en raw_user_meta_data -- valor que controla el propio cliente al
    // registrarse (supabase.auth.signUp() u /auth/v1/signup directo, con la
    // anon key pública). Cualquiera podía "registrarse" con el company_id de
    // una empresa ajena y quedar adentro como miembro, sin invitación.
    it("una cuenta nueva con company_id de una empresa ajena NO se une a ella -- se crea su propia empresa", async () => {
      const victima = await makeCompany(db, "Bodega Don José (víctima)");
      await makeProduct(
        db,
        victima.id,
        victima.loc1,
        "Producto secreto de la víctima",
        10,
        50,
        20,
      );

      const atacanteId = crypto.randomUUID();
      await db.query(
        "insert into auth.users (id, email, raw_user_meta_data) values ($1,$2,$3)",
        [
          atacanteId,
          "atacante@fuera-de-la-empresa.com",
          JSON.stringify({ full_name: "Atacante", company_id: victima.id }),
        ],
      );

      const { rows } = await db.query<{
        company_id: string;
        role: string;
      }>("select company_id, role from public.profiles where id=$1", [
        atacanteId,
      ]);
      expect(rows[0].company_id).not.toBe(victima.id);
      expect(rows[0].role).toBe("admin"); // dueño de SU propia empresa nueva

      await asUser(db, atacanteId, async () => {
        const { rows: leaked } = await db.query(
          "select name from public.products where company_id=$1",
          [victima.id],
        );
        expect(leaked).toHaveLength(0);

        const { rows: canRead } = await db.query<{ ok: boolean }>(
          "select public.can_select_company($1) as ok",
          [victima.id],
        );
        expect(canRead[0].ok).toBe(false);
      });
    });

    it("el registro público normal (sin company_id) sigue creando su propia empresa como admin", async () => {
      const nuevoId = crypto.randomUUID();
      await db.query(
        "insert into auth.users (id, email, raw_user_meta_data) values ($1,$2,$3)",
        [
          nuevoId,
          "dueno@tienda-nueva.com",
          JSON.stringify({ company_name: "Tienda Nueva" }),
        ],
      );
      const { rows } = await db.query<{ role: string; company_id: string }>(
        "select role, company_id from public.profiles where id=$1",
        [nuevoId],
      );
      expect(rows[0].role).toBe("admin");
      expect(rows[0].company_id).toBeTruthy();
    });
  });

  describe("21. Alertas de stock bajo (low_stock_summary)", () => {
    it("un producto sin umbral propio usa el default de la empresa", async () => {
      const company = await makeCompany(db, "Empresa Stock Test");
      const admin = await makeUser(db, company.id, "admin");
      // Default de la empresa es 10: 8 está bajo, 12 no.
      const bajo = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Bajo",
        5,
        10,
        8,
      );
      await makeProduct(db, company.id, company.loc1, "Normal", 5, 10, 12);

      const { rows } = await asUser(db, admin, () =>
        db.query<{
          low_stock_summary: { count: number; items: { id: string }[] };
        }>("select low_stock_summary() as low_stock_summary"),
      );
      const result = rows[0].low_stock_summary;
      expect(result.count).toBe(1);
      expect(result.items[0].id).toBe(bajo);
    });

    it("un producto con umbral propio lo usa en vez del default de la empresa", async () => {
      const company = await makeCompany(db, "Empresa Umbral Propio Test");
      const admin = await makeUser(db, company.id, "admin");
      const producto = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Insumo caro",
        5,
        10,
        15,
      );
      // Con el default (10) NO estaría bajo; con un umbral propio de 20, sí.
      await db.query(
        "update public.products set low_stock_threshold=20 where id=$1",
        [producto],
      );

      const { rows } = await asUser(db, admin, () =>
        db.query<{
          low_stock_summary: { count: number; items: { id: string }[] };
        }>("select low_stock_summary() as low_stock_summary"),
      );
      expect(rows[0].low_stock_summary.count).toBe(1);
      expect(rows[0].low_stock_summary.items[0].id).toBe(producto);
    });

    it("un producto agotado (stock=0) aparece incluido -- antes se excluía del resumen", async () => {
      const company = await makeCompany(db, "Empresa Agotado Test");
      const admin = await makeUser(db, company.id, "admin");
      const agotado = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Agotado",
        5,
        10,
        0,
      );

      const { rows } = await asUser(db, admin, () =>
        db.query<{
          low_stock_summary: {
            count: number;
            items: { id: string; stock: number }[];
          };
        }>("select low_stock_summary() as low_stock_summary"),
      );
      expect(rows[0].low_stock_summary.count).toBe(1);
      expect(rows[0].low_stock_summary.items[0].id).toBe(agotado);
      expect(Number(rows[0].low_stock_summary.items[0].stock)).toBe(0);
    });

    it("con p_location_id usa el stock de ESA sucursal, no el agregado de la empresa", async () => {
      const company = await makeCompany(db, "Empresa Multisucursal Test");
      const admin = await makeUser(db, company.id, "admin");
      // 8 en loc1 (bajo) + 8 en loc2 (bajo) -> products.stock agregado = 16 (NO bajo),
      // pero cada sucursal individualmente SÍ está baja.
      const producto = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Repartido",
        5,
        10,
        8,
      );
      await db.query(
        "insert into public.product_locations (company_id, product_id, location_id, stock, is_active) values ($1,$2,$3,8,true)",
        [company.id, producto, company.loc2],
      );
      await db.query("update public.products set stock=16 where id=$1", [
        producto,
      ]);

      const { rows: aggRows } = await asUser(db, admin, () =>
        db.query<{ low_stock_summary: { count: number } }>(
          "select low_stock_summary() as low_stock_summary",
        ),
      );
      expect(aggRows[0].low_stock_summary.count).toBe(0);

      const { rows: locRows } = await asUser(db, admin, () =>
        db.query<{
          low_stock_summary: { count: number; items: { stock: number }[] };
        }>("select low_stock_summary($1) as low_stock_summary", [company.loc1]),
      );
      expect(locRows[0].low_stock_summary.count).toBe(1);
      expect(Number(locRows[0].low_stock_summary.items[0].stock)).toBe(8);
    });

    it("respeta el límite y ordena por stock ascendente (los más urgentes primero)", async () => {
      const company = await makeCompany(db, "Empresa Orden Test");
      const admin = await makeUser(db, company.id, "admin");
      const p5 = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Stock 5",
        5,
        10,
        5,
      );
      await makeProduct(db, company.id, company.loc1, "Stock 2", 5, 10, 2);
      await makeProduct(db, company.id, company.loc1, "Stock 0", 5, 10, 0);
      await makeProduct(db, company.id, company.loc1, "Stock 8", 5, 10, 8);

      const { rows } = await asUser(db, admin, () =>
        db.query<{
          low_stock_summary: { count: number; items: { stock: number }[] };
        }>("select low_stock_summary(null, 2) as low_stock_summary"),
      );
      expect(rows[0].low_stock_summary.count).toBe(4);
      expect(rows[0].low_stock_summary.items).toHaveLength(2);
      expect(Number(rows[0].low_stock_summary.items[0].stock)).toBe(0);
      expect(Number(rows[0].low_stock_summary.items[1].stock)).toBe(2);
      void p5;
    });

    it("no filtra productos con stock bajo de otra empresa (aislamiento)", async () => {
      const companyA = await makeCompany(db, "Empresa A Aislamiento Stock");
      const companyB = await makeCompany(db, "Empresa B Aislamiento Stock");
      const adminA = await makeUser(db, companyA.id, "admin");
      await makeProduct(
        db,
        companyB.id,
        companyB.loc1,
        "Producto de B, muy bajo",
        5,
        10,
        1,
      );
      await makeProduct(
        db,
        companyA.id,
        companyA.loc1,
        "Producto de A, normal",
        5,
        10,
        50,
      );

      const { rows } = await asUser(db, adminA, () =>
        db.query<{ low_stock_summary: { count: number } }>(
          "select low_stock_summary() as low_stock_summary",
        ),
      );
      expect(rows[0].low_stock_summary.count).toBe(0);
    });

    it("un cajero restringido a otra sucursal no ve el stock bajo de una sucursal ajena", async () => {
      const company = await makeCompany(db, "Empresa Acceso Sucursal Test");
      const cajero = await makeUser(db, company.id, "user");
      await db.query(
        "insert into public.profile_locations (company_id, profile_id, location_id) values ($1,$2,$3)",
        [company.id, cajero, company.loc2],
      );
      await makeProduct(db, company.id, company.loc1, "Bajo en loc1", 5, 10, 3);

      const { rows } = await asUser(db, cajero, () =>
        db.query<{ low_stock_summary: { count: number } }>(
          "select low_stock_summary($1) as low_stock_summary",
          [company.loc1],
        ),
      );
      expect(rows[0].low_stock_summary.count).toBe(0);
    });
  });

  describe("22. Proyección de compra (purchase_projection)", () => {
    it("calcula la velocidad de venta real y los días de cobertura restantes", async () => {
      const company = await makeCompany(db, "Empresa Proyección Test");
      const admin = await makeUser(db, company.id, "admin");
      const customer = await makeCustomer(db, company.id, "Cliente Proyección");
      // 30 unidades vendidas en la ventana de 30 días -> velocidad = 1/día.
      const producto = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Producto Constante",
        5,
        10,
        1000,
      );
      await asUser(db, admin, () =>
        createSale(
          db,
          [{ product_id: producto, qty: 30, unit_price: 10 }],
          company.loc1,
          undefined,
          { customerId: customer },
        ),
      );
      // Deja el stock en un valor limpio para el cálculo de cobertura.
      await db.query("update public.products set stock=10 where id=$1", [
        producto,
      ]);

      const { rows } = await asUser(db, admin, () =>
        db.query<{
          purchase_projection: {
            items: {
              id: string;
              velocity: number;
              daysOfCoverage: number;
              stock: number;
            }[];
          };
        }>("select purchase_projection(30, 30) as purchase_projection"),
      );
      const item = rows[0].purchase_projection.items.find(
        (i) => i.id === producto,
      );
      expect(item).toBeDefined();
      expect(Number(item!.velocity)).toBeCloseTo(1);
      expect(Number(item!.daysOfCoverage)).toBeCloseTo(10); // stock 10 / velocidad 1
    });

    it("una venta fuera de la ventana no cuenta para la velocidad", async () => {
      const company = await makeCompany(db, "Empresa Venta Vieja Test");
      const admin = await makeUser(db, company.id, "admin");
      const customer = await makeCustomer(db, company.id, "Cliente Viejo");
      const producto = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Solo vendido hace tiempo",
        5,
        10,
        20,
      );
      const result = await asUser(db, admin, () =>
        createSale(
          db,
          [{ product_id: producto, qty: 5, unit_price: 10 }],
          company.loc1,
          undefined,
          { customerId: customer },
        ),
      );
      // La venta ocurrió, pero hace 60 días -- fuera de la ventana de 30.
      await db.query(
        "update public.sales set sale_date = now() - interval '60 days' where id=$1",
        [result.sale_id],
      );

      const { rows } = await asUser(db, admin, () =>
        db.query<{ purchase_projection: { items: { id: string }[] } }>(
          "select purchase_projection(30, 30) as purchase_projection",
        ),
      );
      expect(
        rows[0].purchase_projection.items.some((i) => i.id === producto),
      ).toBe(false);
    });

    it("las devoluciones dentro de la ventana se restan de la velocidad neta", async () => {
      const company = await makeCompany(db, "Empresa Devolución Test");
      const admin = await makeUser(db, company.id, "admin");
      const customer = await makeCustomer(db, company.id, "Cliente Devuelve");
      const producto = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Con devoluciones",
        5,
        10,
        50,
      );
      let saleId = "";
      let saleItemId = "";
      await asUser(db, admin, async () => {
        const result = await createSale(
          db,
          [{ product_id: producto, qty: 20, unit_price: 10 }],
          company.loc1,
          undefined,
          { customerId: customer },
        );
        saleId = result.sale_id;
        const { rows: items } = await db.query<{ id: string }>(
          "select id from public.sale_items where sale_id=$1",
          [saleId],
        );
        saleItemId = items[0].id;
        // Se devuelven 8 de las 20 -> neto vendido = 12 en la ventana de 30 días.
        await db.query(
          "select create_return($1, 'No le gustó', $2::jsonb, $3, true) as create_return",
          [
            saleId,
            JSON.stringify([
              { sale_item_id: saleItemId, qty: 8, unit_price: 10 },
            ]),
            company.loc1,
          ],
        );
      });

      const { rows } = await asUser(db, admin, () =>
        db.query<{
          purchase_projection: { items: { id: string; velocity: number }[] };
        }>("select purchase_projection(30, 30) as purchase_projection"),
      );
      const item = rows[0].purchase_projection.items.find(
        (i) => i.id === producto,
      );
      expect(item).toBeDefined();
      expect(Number(item!.velocity)).toBeCloseTo(12 / 30);
    });

    it("un producto sin ventas en la ventana no aparece en la proyección", async () => {
      const company = await makeCompany(db, "Empresa Sin Ventas Test");
      const admin = await makeUser(db, company.id, "admin");
      const producto = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Nunca vendido",
        5,
        10,
        20,
      );

      const { rows } = await asUser(db, admin, () =>
        db.query<{ purchase_projection: { items: { id: string }[] } }>(
          "select purchase_projection(30, 30) as purchase_projection",
        ),
      );
      expect(
        rows[0].purchase_projection.items.some((i) => i.id === producto),
      ).toBe(false);
    });

    it("suggestedQty cubre exactamente los días de cobertura pedidos, sin bajar de 0", async () => {
      const company = await makeCompany(db, "Empresa Sugerencia Test");
      const admin = await makeUser(db, company.id, "admin");
      const customer = await makeCustomer(db, company.id, "Cliente Sugerencia");
      // Velocidad = 30/30 = 1/día, stock = 5, cobertura pedida = 15 días
      // -> sugerido = 1*15 - 5 = 10.
      const producto = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Para sugerir",
        5,
        10,
        1000,
      );
      await asUser(db, admin, () =>
        createSale(
          db,
          [{ product_id: producto, qty: 30, unit_price: 10 }],
          company.loc1,
          undefined,
          { customerId: customer },
        ),
      );
      await db.query("update public.products set stock=5 where id=$1", [
        producto,
      ]);

      const { rows } = await asUser(db, admin, () =>
        db.query<{
          purchase_projection: {
            items: { id: string; suggestedQty: number }[];
          };
        }>("select purchase_projection(30, 15) as purchase_projection"),
      );
      const item = rows[0].purchase_projection.items.find(
        (i) => i.id === producto,
      );
      expect(item).toBeDefined();
      expect(Number(item!.suggestedQty)).toBe(10);
    });

    it("no mezcla ventas de otra empresa (aislamiento)", async () => {
      const companyA = await makeCompany(
        db,
        "Empresa A Proyección Aislamiento",
      );
      const companyB = await makeCompany(
        db,
        "Empresa B Proyección Aislamiento",
      );
      const adminA = await makeUser(db, companyA.id, "admin");
      const adminB = await makeUser(db, companyB.id, "admin");
      const customerB = await makeCustomer(db, companyB.id, "Cliente B");
      const productoB = await makeProduct(
        db,
        companyB.id,
        companyB.loc1,
        "Producto de B",
        5,
        10,
        1000,
      );
      await asUser(db, adminB, () =>
        createSale(
          db,
          [{ product_id: productoB, qty: 30, unit_price: 10 }],
          companyB.loc1,
          undefined,
          { customerId: customerB },
        ),
      );

      const { rows } = await asUser(db, adminA, () =>
        db.query<{ purchase_projection: { items: unknown[] } }>(
          "select purchase_projection(30, 30) as purchase_projection",
        ),
      );
      expect(rows[0].purchase_projection.items).toHaveLength(0);
    });

    it("ordena por menor cobertura primero y respeta el límite", async () => {
      const company = await makeCompany(db, "Empresa Orden Proyección Test");
      const admin = await makeUser(db, company.id, "admin");
      const customer = await makeCustomer(db, company.id, "Cliente Orden");
      // Misma velocidad (30/30=1/día) para los tres, distinto stock ->
      // distintos días de cobertura: 2, 5, 20.
      const urgente = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Urgente",
        5,
        10,
        1000,
      );
      const medio = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Medio",
        5,
        10,
        1000,
      );
      const holgado = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Holgado",
        5,
        10,
        1000,
      );
      await asUser(db, admin, async () => {
        for (const productId of [urgente, medio, holgado]) {
          await createSale(
            db,
            [{ product_id: productId, qty: 30, unit_price: 10 }],
            company.loc1,
            undefined,
            { customerId: customer },
          );
        }
      });
      // Deja cada uno en el stock exacto que define su cobertura (2, 5, 20 días).
      await db.query("update public.products set stock=2 where id=$1", [
        urgente,
      ]);
      await db.query("update public.products set stock=5 where id=$1", [medio]);
      await db.query("update public.products set stock=20 where id=$1", [
        holgado,
      ]);

      const { rows } = await asUser(db, admin, () =>
        db.query<{
          purchase_projection: { items: { id: string }[] };
        }>("select purchase_projection(30, 30, 2) as purchase_projection"),
      );
      const ids = rows[0].purchase_projection.items.map((i) => i.id);
      expect(ids).toHaveLength(2);
      expect(ids[0]).toBe(urgente);
      expect(ids[1]).toBe(medio);
    });

    it("incluye el costo actual y el proveedor asignado -- null si el producto no tiene proveedor (para agrupar por proveedor en Resurtido)", async () => {
      const company = await makeCompany(db, "Empresa Resurtido Test");
      const admin = await makeUser(db, company.id, "admin");
      const customer = await makeCustomer(db, company.id, "Cliente Resurtido");
      const { rows: supplierRows } = await db.query<{ id: string }>(
        "insert into public.suppliers (company_id, name) values ($1, $2) returning id",
        [company.id, "Proveedor Resurtido"],
      );
      const supplierId = supplierRows[0].id;

      const conProveedor = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Con Proveedor",
        7,
        10,
        1000,
      );
      await db.query(
        "update public.products set supplier_id = $2 where id = $1",
        [conProveedor, supplierId],
      );
      const sinProveedor = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Sin Proveedor",
        3,
        10,
        1000,
      );

      await asUser(db, admin, async () => {
        for (const productId of [conProveedor, sinProveedor]) {
          await createSale(
            db,
            [{ product_id: productId, qty: 30, unit_price: 10 }],
            company.loc1,
            undefined,
            { customerId: customer },
          );
        }
      });

      const { rows } = await asUser(db, admin, () =>
        db.query<{
          purchase_projection: {
            items: {
              id: string;
              cost: number;
              supplierId: string | null;
              supplierName: string | null;
            }[];
          };
        }>("select purchase_projection(30, 30) as purchase_projection"),
      );
      const items = rows[0].purchase_projection.items;
      const withSupplier = items.find((i) => i.id === conProveedor);
      const withoutSupplier = items.find((i) => i.id === sinProveedor);

      expect(Number(withSupplier!.cost)).toBeCloseTo(7, 2);
      expect(withSupplier!.supplierId).toBe(supplierId);
      expect(withSupplier!.supplierName).toBe("Proveedor Resurtido");

      expect(Number(withoutSupplier!.cost)).toBeCloseTo(3, 2);
      expect(withoutSupplier!.supplierId).toBeNull();
      expect(withoutSupplier!.supplierName).toBeNull();
    });
  });

  describe("23. Tipos de producto: Combo y Servicio", () => {
    async function makeComboProduct(
      companyId: string,
      name: string,
      price: number,
    ): Promise<string> {
      const { rows } = await db.query<{ id: string }>(
        "insert into public.products (company_id, name, price, cost, unit, product_type) values ($1,$2,$3,0,'und','combo') returning id",
        [companyId, name, price],
      );
      return rows[0].id;
    }

    async function makeServiceProduct(
      companyId: string,
      name: string,
      cost: number,
      price: number,
    ): Promise<string> {
      const { rows } = await db.query<{ id: string }>(
        "insert into public.products (company_id, name, price, cost, unit, product_type) values ($1,$2,$3,$4,'und','service') returning id",
        [companyId, name, price, cost],
      );
      return rows[0].id;
    }

    async function addComboItem(
      companyId: string,
      comboId: string,
      componentId: string,
      qty: number,
    ) {
      await db.query(
        "insert into public.product_combo_items (company_id, combo_product_id, component_product_id, qty) values ($1,$2,$3,$4)",
        [companyId, comboId, componentId, qty],
      );
    }

    it("vender un combo descuenta cada pieza según su cantidad, no el combo mismo", async () => {
      const company = await makeCompany(db, "Empresa Combo Test");
      const admin = await makeUser(db, company.id, "admin");
      const boligrafo = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Bolígrafo negro",
        2,
        5,
        100,
      );
      const combo = await makeComboProduct(company.id, "Caja de 12", 50);
      await addComboItem(company.id, combo, boligrafo, 12);

      await asUser(db, admin, () =>
        createSale(
          db,
          [{ product_id: combo, qty: 2, unit_price: 50 }],
          company.loc1,
        ),
      );

      const { rows: pieza } = await db.query<{ stock: number }>(
        "select stock from public.products where id=$1",
        [boligrafo],
      );
      // 100 - (12 piezas * 2 cajas) = 76
      expect(Number(pieza[0].stock)).toBe(76);

      const { rows: comboRow } = await db.query<{ stock: number }>(
        "select stock from public.products where id=$1",
        [combo],
      );
      expect(Number(comboRow[0].stock)).toBe(0);

      const { rows: items } = await db.query<{
        product_id: string;
        qty: number;
        cost: number;
      }>(
        "select product_id, qty, cost from public.sale_items where product_id=$1",
        [combo],
      );
      expect(items).toHaveLength(1);
      expect(Number(items[0].qty)).toBe(2);
      // Costo del combo = costo de la pieza (2) * 12 = 24 por caja.
      expect(Number(items[0].cost)).toBeCloseTo(24);
    });

    it("un combo con varias piezas distintas descuenta todas correctamente", async () => {
      const company = await makeCompany(db, "Empresa Combo Múltiple Test");
      const admin = await makeUser(db, company.id, "admin");
      const lapiz = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Lápiz",
        1,
        3,
        50,
      );
      const goma = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Goma",
        0.5,
        2,
        50,
      );
      const combo = await makeComboProduct(company.id, "Kit escolar", 10);
      await addComboItem(company.id, combo, lapiz, 2);
      await addComboItem(company.id, combo, goma, 1);

      await asUser(db, admin, () =>
        createSale(
          db,
          [{ product_id: combo, qty: 3, unit_price: 10 }],
          company.loc1,
        ),
      );

      const { rows: lapizRow } = await db.query<{ stock: number }>(
        "select stock from public.products where id=$1",
        [lapiz],
      );
      const { rows: gomaRow } = await db.query<{ stock: number }>(
        "select stock from public.products where id=$1",
        [goma],
      );
      expect(Number(lapizRow[0].stock)).toBe(50 - 2 * 3);
      expect(Number(gomaRow[0].stock)).toBe(50 - 1 * 3);
    });

    it("rechaza vender un combo si falta stock de alguna pieza -- sin descontar nada (atómico)", async () => {
      const company = await makeCompany(db, "Empresa Combo Falta Stock Test");
      const admin = await makeUser(db, company.id, "admin");
      const conStock = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Con stock",
        1,
        3,
        100,
      );
      const sinStock = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Sin stock",
        1,
        3,
        1,
      );
      const combo = await makeComboProduct(company.id, "Combo incompleto", 10);
      await addComboItem(company.id, combo, conStock, 1);
      await addComboItem(company.id, combo, sinStock, 5); // pide 5, solo hay 1

      await asUser(db, admin, () =>
        expect(
          createSale(
            db,
            [{ product_id: combo, qty: 1, unit_price: 10 }],
            company.loc1,
          ),
        ).rejects.toThrow(/stock insuficiente/i),
      );

      // La pieza que sí alcanzaba no debe haberse tocado -- todo o nada.
      const { rows: conStockRow } = await db.query<{ stock: number }>(
        "select stock from public.products where id=$1",
        [conStock],
      );
      expect(Number(conStockRow[0].stock)).toBe(100);
    });

    it("un combo sin piezas configuradas no se puede vender", async () => {
      const company = await makeCompany(db, "Empresa Combo Vacío Test");
      const admin = await makeUser(db, company.id, "admin");
      const combo = await makeComboProduct(company.id, "Combo vacío", 10);

      await asUser(db, admin, () =>
        expect(
          createSale(
            db,
            [{ product_id: combo, qty: 1, unit_price: 10 }],
            company.loc1,
          ),
        ).rejects.toThrow(/no tiene piezas configuradas/i),
      );
    });

    it("vender un Servicio no valida ni descuenta stock, ni genera movimientos", async () => {
      const company = await makeCompany(db, "Empresa Servicio Test");
      const admin = await makeUser(db, company.id, "admin");
      const servicio = await makeServiceProduct(
        company.id,
        "Instalación a domicilio",
        20,
        100,
      );

      const result = await asUser(db, admin, () =>
        createSale(
          db,
          [{ product_id: servicio, qty: 1, unit_price: 100 }],
          company.loc1,
        ),
      );
      expect(result.total).toBe(100);

      const { rows: movs } = await db.query<{ id: string }>(
        "select id from public.stock_movements where product_id=$1",
        [servicio],
      );
      expect(movs).toHaveLength(0);
    });

    it("no se puede borrar un producto Estándar que es pieza de un combo activo", async () => {
      const company = await makeCompany(db, "Empresa Borrado Pieza Test");
      const admin = await makeUser(db, company.id, "admin");
      const pieza = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Pieza en uso",
        1,
        3,
        10,
      );
      const combo = await makeComboProduct(company.id, "Combo con pieza", 10);
      await addComboItem(company.id, combo, pieza, 1);

      await asUser(db, admin, () =>
        expect(
          db.query("select soft_delete_product($1)", [pieza]),
        ).rejects.toThrow(/pieza del combo/i),
      );
    });

    it("el trigger rechaza una pieza que no sea de tipo Estándar (ej. otro combo o un servicio)", async () => {
      const company = await makeCompany(db, "Empresa Pieza Inválida Test");
      const admin = await makeUser(db, company.id, "admin");
      const servicio = await makeServiceProduct(
        company.id,
        "Un servicio",
        5,
        20,
      );
      const combo = await makeComboProduct(
        company.id,
        "Combo con pieza inválida",
        10,
      );

      await asUser(db, admin, () =>
        expect(addComboItem(company.id, combo, servicio, 1)).rejects.toThrow(
          /no es un producto Estándar/i,
        ),
      );
    });

    it("el trigger rechaza usar un producto que no es Combo como combo_product_id", async () => {
      const company = await makeCompany(db, "Empresa Combo Inválido Test");
      const admin = await makeUser(db, company.id, "admin");
      const estandar1 = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Producto A",
        1,
        3,
        10,
      );
      const estandar2 = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Producto B",
        1,
        3,
        10,
      );

      await asUser(db, admin, () =>
        expect(
          addComboItem(company.id, estandar1, estandar2, 1),
        ).rejects.toThrow(/no es un producto de tipo Combo/i),
      );
    });
  });

  describe("24. Comisión por venta (por empleado, snapshot en la venta)", () => {
    async function setCommission(
      adminId: string,
      profileId: string,
      rate: number | null,
    ) {
      await asUser(db, adminId, () =>
        db.query("select set_employee_commission($1, $2)", [profileId, rate]),
      );
    }

    async function getCommission(profileId: string): Promise<number | null> {
      const { rows } = await db.query<{ commission_rate: string | null }>(
        "select commission_rate from public.profiles where id = $1",
        [profileId],
      );
      return rows[0].commission_rate === null
        ? null
        : Number(rows[0].commission_rate);
    }

    it("el admin fija el % de un cajero y la venta guarda su comisión sobre el total cobrado", async () => {
      const company = await makeCompany(db, "Empresa Comisión Test");
      const admin = await makeUser(db, company.id, "admin");
      const cajero = await makeUser(db, company.id, "user");
      const prod = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Producto Comisión",
        5,
        10,
        100,
      );

      await setCommission(admin, cajero, 0.05); // 5%
      expect(await getCommission(cajero)).toBeCloseTo(0.05, 4);

      const sale = await asUser(db, cajero, () =>
        createSale(
          db,
          [{ product_id: prod, qty: 2, unit_price: 10 }],
          company.loc1,
        ),
      );
      expect(sale.total).toBeCloseTo(20, 2);

      const { rows } = await db.query<{
        commission_rate: string;
        commission_amount: string;
      }>(
        "select commission_rate, commission_amount from public.sales where id = $1",
        [sale.sale_id],
      );
      expect(Number(rows[0].commission_rate)).toBeCloseTo(0.05, 4);
      expect(Number(rows[0].commission_amount)).toBeCloseTo(1, 2); // 5% de 20
    });

    it("sin % configurado, la venta no genera comisión (y no bloquea la venta)", async () => {
      const company = await makeCompany(db, "Empresa Sin Comisión Test");
      const cajero = await makeUser(db, company.id, "user");
      const prod = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Producto Sin Comisión",
        5,
        10,
        100,
      );

      const sale = await asUser(db, cajero, () =>
        createSale(
          db,
          [{ product_id: prod, qty: 1, unit_price: 10 }],
          company.loc1,
        ),
      );

      const { rows } = await db.query<{
        commission_rate: string | null;
        commission_amount: string;
      }>(
        "select commission_rate, commission_amount from public.sales where id = $1",
        [sale.sale_id],
      );
      expect(rows[0].commission_rate).toBeNull();
      expect(Number(rows[0].commission_amount)).toBe(0);
    });

    it("cambiar el % después NO recalcula ventas ya hechas (snapshot histórico intacto)", async () => {
      const company = await makeCompany(db, "Empresa Snapshot Comisión Test");
      const admin = await makeUser(db, company.id, "admin");
      const cajero = await makeUser(db, company.id, "user");
      const prod = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Producto Snapshot",
        5,
        10,
        100,
      );

      await setCommission(admin, cajero, 0.1); // 10%
      const sale1 = await asUser(db, cajero, () =>
        createSale(
          db,
          [{ product_id: prod, qty: 1, unit_price: 10 }],
          company.loc1,
        ),
      );

      // El admin sube la comisión DESPUÉS de la primera venta.
      await setCommission(admin, cajero, 0.2); // 20%
      const sale2 = await asUser(db, cajero, () =>
        createSale(
          db,
          [{ product_id: prod, qty: 1, unit_price: 10 }],
          company.loc1,
        ),
      );

      const { rows: rows1 } = await db.query<{ commission_amount: string }>(
        "select commission_amount from public.sales where id = $1",
        [sale1.sale_id],
      );
      const { rows: rows2 } = await db.query<{ commission_amount: string }>(
        "select commission_amount from public.sales where id = $1",
        [sale2.sale_id],
      );
      expect(Number(rows1[0].commission_amount)).toBeCloseTo(1, 2); // 10% de 10, no cambia
      expect(Number(rows2[0].commission_amount)).toBeCloseTo(2, 2); // 20% de 10
    });

    it("un cajero no puede configurar comisiones (solo el admin de la empresa)", async () => {
      const company = await makeCompany(db, "Empresa Comisión No Admin Test");
      const cajero = await makeUser(db, company.id, "user");
      const otroCajero = await makeUser(db, company.id, "user");

      await expect(
        asUser(db, cajero, () =>
          db.query("select set_employee_commission($1, $2)", [otroCajero, 0.5]),
        ),
      ).rejects.toThrow(/Solo el administrador/i);
    });

    it("el admin no puede configurar la comisión de un empleado de OTRA empresa", async () => {
      const companyA = await makeCompany(db, "Empresa Comisión A Test");
      const companyB = await makeCompany(db, "Empresa Comisión B Test");
      const adminA = await makeUser(db, companyA.id, "admin");
      const cajeroB = await makeUser(db, companyB.id, "user");

      await expect(
        asUser(db, adminA, () =>
          db.query("select set_employee_commission($1, $2)", [cajeroB, 0.5]),
        ),
      ).rejects.toThrow(/no pertenece a tu empresa/i);
    });

    it("set_employee_commission rechaza porcentajes fuera de rango (0 a 1)", async () => {
      const company = await makeCompany(db, "Empresa Comisión Rango Test");
      const admin = await makeUser(db, company.id, "admin");
      const cajero = await makeUser(db, company.id, "user");

      await expect(
        asUser(db, admin, () =>
          db.query("select set_employee_commission($1, $2)", [cajero, 1.5]),
        ),
      ).rejects.toThrow(/entre 0 y 100/i);

      await expect(
        asUser(db, admin, () =>
          db.query("select set_employee_commission($1, $2)", [cajero, -0.1]),
        ),
      ).rejects.toThrow(/entre 0 y 100/i);
    });

    it("nadie puede subir su propia comisión con un UPDATE directo a profiles (ni el propio admin)", async () => {
      const company = await makeCompany(db, "Empresa Anti-Escalación Test");
      const admin = await makeUser(db, company.id, "admin");
      const cajero = await makeUser(db, company.id, "user");

      await expect(
        asUser(db, cajero, () =>
          db.query(
            "update public.profiles set commission_rate = 0.9 where id = $1",
            [cajero],
          ),
        ),
      ).rejects.toThrow(/campos protegidos/i);

      // Ni siquiera el admin puede escribirlo directo -- debe pasar por
      // set_employee_commission, que limpia el claim de sesión antes del UPDATE.
      await expect(
        asUser(db, admin, () =>
          db.query(
            "update public.profiles set commission_rate = 0.9 where id = $1",
            [admin],
          ),
        ),
      ).rejects.toThrow(/campos protegidos/i);
    });

    it("restablecer el sistema limpia la comisión propia del admin que restablece", async () => {
      const companyName = "Empresa Reset Comisión Test";
      const company = await makeCompany(db, companyName);
      const admin = await makeUser(db, company.id, "admin");
      // El admin también vende y tiene su propia comisión configurada.
      await setCommission(admin, admin, 0.07);
      expect(await getCommission(admin)).toBeCloseTo(0.07, 4);

      await asUser(db, admin, () =>
        db.query("select reset_company_data($1)", [companyName]),
      );

      expect(await getCommission(admin)).toBeNull();
    });
  });

  describe("25. Configuración de ticket por sucursal", () => {
    interface TicketSettingsRow {
      ticket_show_logo: boolean;
      ticket_show_fiscal_info: boolean;
      ticket_show_cashier_name: boolean;
      ticket_footer_text: string | null;
      ticket_show_tax_breakdown: boolean;
      ticket_show_loyalty_points: boolean;
      ticket_show_payment_method: boolean;
    }

    async function getTicketSettings(
      locationId: string,
    ): Promise<TicketSettingsRow> {
      const { rows } = await db.query<TicketSettingsRow>(
        `select ticket_show_logo, ticket_show_fiscal_info, ticket_show_cashier_name,
                ticket_footer_text, ticket_show_tax_breakdown, ticket_show_loyalty_points,
                ticket_show_payment_method
         from public.locations where id = $1`,
        [locationId],
      );
      return rows[0];
    }

    it("una sucursal nueva trae los valores por defecto esperados", async () => {
      const company = await makeCompany(db, "Empresa Ticket Defaults Test");
      const settings = await getTicketSettings(company.loc1);
      expect(settings.ticket_show_logo).toBe(true);
      expect(settings.ticket_show_fiscal_info).toBe(true);
      expect(settings.ticket_show_cashier_name).toBe(false);
      expect(settings.ticket_footer_text).toBeNull();
      expect(settings.ticket_show_tax_breakdown).toBe(true);
      expect(settings.ticket_show_loyalty_points).toBe(true);
      expect(settings.ticket_show_payment_method).toBe(true);
    });

    it("el admin de la empresa puede editar la configuración de ticket de su sucursal", async () => {
      const company = await makeCompany(db, "Empresa Ticket Edit Test");
      const admin = await makeUser(db, company.id, "admin");

      await asUser(db, admin, () =>
        db.query(
          `update public.locations set
             ticket_show_logo = false,
             ticket_show_cashier_name = true,
             ticket_footer_text = 'Gracias por su compra'
           where id = $1`,
          [company.loc1],
        ),
      );

      const settings = await getTicketSettings(company.loc1);
      expect(settings.ticket_show_logo).toBe(false);
      expect(settings.ticket_show_cashier_name).toBe(true);
      expect(settings.ticket_footer_text).toBe("Gracias por su compra");
    });

    it("un admin de OTRA empresa no puede leer ni editar la configuración de ticket ajena", async () => {
      const companyA = await makeCompany(db, "Empresa Ticket A Test");
      const companyB = await makeCompany(db, "Empresa Ticket B Test");
      const adminB = await makeUser(db, companyB.id, "admin");

      await asUser(db, adminB, async () => {
        const { rows } = await db.query(
          "select id from public.locations where id = $1",
          [companyA.loc1],
        );
        expect(rows.length).toBe(0);

        const result = await db.query(
          "update public.locations set ticket_footer_text = 'hackeado' where id = $1",
          [companyA.loc1],
        );
        expect(result.affectedRows ?? 0).toBe(0);
      });

      const settings = await getTicketSettings(companyA.loc1);
      expect(settings.ticket_footer_text).toBeNull();
    });
  });

  describe("26. Mermas (artículos dañados y errores de empleados)", () => {
    async function registerMerma(
      userId: string,
      params: {
        locationId: string;
        reason: string;
        employeeId?: string | null;
        productId?: string | null;
        quantity?: number | null;
        estimatedLoss?: number | null;
        notes?: string | null;
      },
    ): Promise<string> {
      const { rows } = await asUser(db, userId, () =>
        db.query<{ register_merma: string }>(
          `select register_merma(
             p_location_id := $1,
             p_reason_category := $2,
             p_employee_id := $3,
             p_product_id := $4,
             p_quantity := $5,
             p_estimated_loss := $6,
             p_notes := $7
           ) as register_merma`,
          [
            params.locationId,
            params.reason,
            params.employeeId ?? null,
            params.productId ?? null,
            params.quantity ?? null,
            params.estimatedLoss ?? null,
            params.notes ?? null,
          ],
        ),
      );
      return rows[0].register_merma;
    }

    async function getProductStock(productId: string): Promise<number> {
      const { rows } = await db.query<{ stock: string }>(
        "select stock from public.products where id = $1",
        [productId],
      );
      return Number(rows[0].stock);
    }

    it("un cajero registra su propia merma de un producto dañado y se descuenta el stock", async () => {
      const company = await makeCompany(db, "Empresa Merma Test");
      const cajero = await makeUser(db, company.id, "user");
      const prod = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Vaso",
        5,
        10,
        20,
      );

      const mermaId = await registerMerma(cajero, {
        locationId: company.loc1,
        reason: "danado",
        productId: prod,
        quantity: 3,
      });
      expect(mermaId).toBeTruthy();
      expect(await getProductStock(prod)).toBe(17);

      const { rows } = await db.query<{
        employee_id: string;
        registered_by: string;
        unit_cost: string;
        estimated_loss: string;
      }>(
        "select employee_id, registered_by, unit_cost, estimated_loss from public.mermas where id = $1",
        [mermaId],
      );
      expect(rows[0].employee_id).toBe(cajero);
      expect(rows[0].registered_by).toBe(cajero);
      expect(Number(rows[0].unit_cost)).toBeCloseTo(5, 2); // costo congelado
      expect(Number(rows[0].estimated_loss)).toBeCloseTo(15, 2); // 3 * 5
    });

    it("un cajero NO puede registrar una merma a nombre de otro empleado", async () => {
      const company = await makeCompany(db, "Empresa Merma Ajena Test");
      const cajero = await makeUser(db, company.id, "user");
      const otroCajero = await makeUser(db, company.id, "user");

      await expect(
        registerMerma(cajero, {
          locationId: company.loc1,
          reason: "otro",
          employeeId: otroCajero,
          estimatedLoss: 50,
        }),
      ).rejects.toThrow(/Solo un administrador o finanzas/i);
    });

    it("un admin sí puede registrar una merma de alto valor a nombre de un empleado", async () => {
      const company = await makeCompany(db, "Empresa Merma Admin Test");
      const admin = await makeUser(db, company.id, "admin");
      const cajero = await makeUser(db, company.id, "user");

      const mermaId = await registerMerma(admin, {
        locationId: company.loc1,
        reason: "danado",
        employeeId: cajero,
        estimatedLoss: 500,
        notes: "Pantalla rota",
      });

      const { rows } = await db.query<{
        employee_id: string;
        registered_by: string;
        estimated_loss: string;
      }>(
        "select employee_id, registered_by, estimated_loss from public.mermas where id = $1",
        [mermaId],
      );
      expect(rows[0].employee_id).toBe(cajero);
      expect(rows[0].registered_by).toBe(admin);
      expect(Number(rows[0].estimated_loss)).toBe(500);
    });

    it("finanzas también puede registrar una merma a nombre de otro empleado", async () => {
      const company = await makeCompany(db, "Empresa Merma Finanzas Test");
      const finanzas = await makeUser(db, company.id, "finanzas");
      const cajero = await makeUser(db, company.id, "user");

      await expect(
        registerMerma(finanzas, {
          locationId: company.loc1,
          reason: "otro",
          employeeId: cajero,
          estimatedLoss: 20,
        }),
      ).resolves.toBeTruthy();
    });

    it("una merma sin producto no toca el inventario, solo registra la pérdida capturada", async () => {
      const company = await makeCompany(db, "Empresa Merma Sin Producto Test");
      const cajero = await makeUser(db, company.id, "user");

      const mermaId = await registerMerma(cajero, {
        locationId: company.loc1,
        reason: "error_impresion",
        estimatedLoss: 30,
        notes: "10 copias mal impresas",
      });

      const { rows } = await db.query<{
        product_id: string | null;
        quantity: string | null;
        estimated_loss: string;
      }>(
        "select product_id, quantity, estimated_loss from public.mermas where id = $1",
        [mermaId],
      );
      expect(rows[0].product_id).toBeNull();
      expect(rows[0].quantity).toBeNull();
      expect(Number(rows[0].estimated_loss)).toBe(30);
    });

    it("no se puede registrar una merma que deje el stock de la sucursal en negativo", async () => {
      const company = await makeCompany(db, "Empresa Merma Sin Stock Test");
      const cajero = await makeUser(db, company.id, "user");
      const prod = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Escaso",
        2,
        5,
        1,
      );

      await expect(
        registerMerma(cajero, {
          locationId: company.loc1,
          reason: "danado",
          productId: prod,
          quantity: 5,
        }),
      ).rejects.toThrow(/No hay suficiente stock/i);
      expect(await getProductStock(prod)).toBe(1);
    });

    it("delete_merma repone el stock descontado y solo lo puede hacer admin/finanzas", async () => {
      const company = await makeCompany(db, "Empresa Merma Delete Test");
      const admin = await makeUser(db, company.id, "admin");
      const cajero = await makeUser(db, company.id, "user");
      const prod = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Taza",
        4,
        8,
        10,
      );

      const mermaId = await registerMerma(cajero, {
        locationId: company.loc1,
        reason: "danado",
        productId: prod,
        quantity: 4,
      });
      expect(await getProductStock(prod)).toBe(6);

      // Ni siquiera el cajero dueño de la merma puede eliminarla.
      await expect(
        asUser(db, cajero, () =>
          db.query("select delete_merma($1)", [mermaId]),
        ),
      ).rejects.toThrow(/Solo un administrador o finanzas/i);

      await asUser(db, admin, () =>
        db.query("select delete_merma($1)", [mermaId]),
      );
      expect(await getProductStock(prod)).toBe(10);

      const { rows } = await db.query<{ deleted_at: string | null }>(
        "select deleted_at from public.mermas where id = $1",
        [mermaId],
      );
      expect(rows[0].deleted_at).not.toBeNull();
    });

    it("un cajero solo ve sus propias mermas; admin ve las de todos (RLS)", async () => {
      const company = await makeCompany(db, "Empresa Merma RLS Test");
      const admin = await makeUser(db, company.id, "admin");
      const cajeroA = await makeUser(db, company.id, "user");
      const cajeroB = await makeUser(db, company.id, "user");

      await registerMerma(cajeroA, {
        locationId: company.loc1,
        reason: "otro",
        estimatedLoss: 10,
      });
      await registerMerma(cajeroB, {
        locationId: company.loc1,
        reason: "otro",
        estimatedLoss: 15,
      });

      const seenByA = await asUser(db, cajeroA, () =>
        db.query("select id from public.mermas"),
      );
      expect(seenByA.rows.length).toBe(1);

      const seenByAdmin = await asUser(db, admin, () =>
        db.query("select id from public.mermas"),
      );
      expect(seenByAdmin.rows.length).toBe(2);
    });

    it("no se puede registrar una merma en una sucursal de otra empresa", async () => {
      const companyA = await makeCompany(db, "Empresa Merma Cruzada A Test");
      const companyB = await makeCompany(db, "Empresa Merma Cruzada B Test");
      const cajeroA = await makeUser(db, companyA.id, "user");

      await expect(
        registerMerma(cajeroA, {
          locationId: companyB.loc1,
          reason: "otro",
          estimatedLoss: 10,
        }),
      ).rejects.toThrow(/Sucursal invalida/i);
    });
  });

  describe("27. Niveles de fidelidad (Bronce/Plata/Oro)", () => {
    async function setupTierCompany() {
      const company = await makeCompany(db, "Empresa Niveles Test");
      const admin = await makeUser(db, company.id, "admin");
      const product = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Producto Niveles",
        50,
        100,
        1000,
      );
      await setLoyaltySettings(db, company.id, {
        enabled: true,
        pointValue: 1,
        earnRate: 999999, // tasa plana absurda -- si algo usa esta por error, se nota (0 puntos)
      });
      return { company, admin, product };
    }

    async function setYearSpend(
      customerId: string,
      spend: number,
      year?: number,
    ) {
      await db.query(
        "update public.customers set loyalty_year_spend = $2, loyalty_year_spend_year = $3 where id = $1",
        [customerId, spend, year ?? new Date().getFullYear()],
      );
    }

    it("con loyalty_tiers_enabled=false (default) usa la tasa plana, sin importar el gasto acumulado", async () => {
      const { company, admin, product } = await setupTierCompany();
      await setLoyaltySettings(db, company.id, {
        enabled: true,
        pointValue: 1,
        earnRate: 10,
      });
      const customer = await makeCustomer(db, company.id, "Cliente Plano");
      await setYearSpend(customer, 10000); // ya sería Oro si los niveles estuvieran activos

      const result = await asUser(db, admin, () =>
        createSale(
          db,
          [{ product_id: product, qty: 1, unit_price: 100 }],
          company.loc1,
          undefined,
          { customerId: customer },
        ),
      );

      expect(result.points_earned).toBe(10); // 100 / 10, tasa plana normal
    });

    it("un cliente sin gasto acumulado (Bronce) gana puntos según la tasa de Bronce", async () => {
      const { company, admin, product } = await setupTierCompany();
      await setLoyaltyTiers(db, company.id, {
        enabled: true,
        tier2Min: 1500,
        tier3Min: 5000,
        tier1Rate: 65,
        tier2Rate: 50,
        tier3Rate: 33,
      });
      const customer = await makeCustomer(db, company.id, "Cliente Bronce");

      const result = await asUser(db, admin, () =>
        createSale(
          db,
          // precio real del producto = 100 (unit_price del carrito se
          // ignora server-side); qty=6.5 -> total=650.
          [{ product_id: product, qty: 6.5, unit_price: 100 }],
          company.loc1,
          undefined,
          { customerId: customer },
        ),
      );

      expect(result.points_earned).toBe(10); // floor(650 / 65)
    });

    it("caso reportado por el cliente: primera compra de $1,560 sin descuentos ni canje debe ganar 24 puntos en Bronce", async () => {
      const { company, admin, product } = await setupTierCompany();
      await setLoyaltyTiers(db, company.id, {
        enabled: true,
        tier2Min: 1500,
        tier3Min: 5000,
        tier1Rate: 65,
        tier2Rate: 50,
        tier3Rate: 33,
      });
      const customer = await makeCustomer(db, company.id, "Cliente 1560");

      const result = await asUser(db, admin, () =>
        createSale(
          db,
          // precio real del producto = 100 (unit_price del carrito se
          // ignora server-side); qty=15.6 -> total=1560, sin promoción ni
          // canje de puntos de por medio.
          [{ product_id: product, qty: 15.6, unit_price: 100 }],
          company.loc1,
          undefined,
          { customerId: customer },
        ),
      );

      expect(result.discount_total).toBe(0);
      expect(result.total).toBe(1560);
      expect(result.points_earned).toBe(24); // floor(1560 / 65)
    });

    it("un cliente con $1,500+ acumulados este año (Plata) gana a la tasa de Plata en su siguiente compra", async () => {
      const { company, admin, product } = await setupTierCompany();
      await setLoyaltyTiers(db, company.id, {
        enabled: true,
        tier2Min: 1500,
        tier3Min: 5000,
        tier1Rate: 65,
        tier2Rate: 50,
        tier3Rate: 33,
      });
      const customer = await makeCustomer(db, company.id, "Cliente Plata");
      await setYearSpend(customer, 2000);

      const result = await asUser(db, admin, () =>
        createSale(
          db,
          [{ product_id: product, qty: 5, unit_price: 100 }], // total=500
          company.loc1,
          undefined,
          { customerId: customer },
        ),
      );

      expect(result.points_earned).toBe(10); // floor(500 / 50)
    });

    it("un cliente con $5,000+ acumulados este año (Oro) gana a la tasa de Oro", async () => {
      const { company, admin, product } = await setupTierCompany();
      await setLoyaltyTiers(db, company.id, {
        enabled: true,
        tier2Min: 1500,
        tier3Min: 5000,
        tier1Rate: 65,
        tier2Rate: 50,
        tier3Rate: 33,
      });
      const customer = await makeCustomer(db, company.id, "Cliente Oro");
      await setYearSpend(customer, 6000);

      const result = await asUser(db, admin, () =>
        createSale(
          db,
          [{ product_id: product, qty: 3.3, unit_price: 100 }], // total=330
          company.loc1,
          undefined,
          { customerId: customer },
        ),
      );

      expect(result.points_earned).toBe(10); // floor(330 / 33)
    });

    it("la compra que hace CRUZAR el umbral se cobra con la tasa vieja; la tasa nueva aplica hasta la siguiente venta", async () => {
      const { company, admin, product } = await setupTierCompany();
      await setLoyaltyTiers(db, company.id, {
        enabled: true,
        tier2Min: 1500,
        tier3Min: 5000,
        tier1Rate: 65,
        tier2Rate: 50,
        tier3Rate: 33,
      });
      const customer = await makeCustomer(db, company.id, "Cliente Cruza");

      // Primera venta: arranca en $0 acumulado (Bronce), aunque esta misma
      // compra de $2,000 ya lo dejaría por encima del umbral de Plata.
      const sale1 = await asUser(db, admin, () =>
        createSale(
          db,
          [{ product_id: product, qty: 20, unit_price: 100 }], // total=2000
          company.loc1,
          undefined,
          { customerId: customer },
        ),
      );
      expect(sale1.points_earned).toBe(30); // floor(2000 / 65), tasa de Bronce

      // Segunda venta: ahora sí acumulado > $1,500 -> tasa de Plata.
      const sale2 = await asUser(db, admin, () =>
        createSale(
          db,
          [{ product_id: product, qty: 5, unit_price: 100 }], // total=500
          company.loc1,
          undefined,
          { customerId: customer },
        ),
      );
      expect(sale2.points_earned).toBe(10); // floor(500 / 50)
    });

    it("el acumulado del año se reinicia solo al llegar un año calendario nuevo", async () => {
      const { company, admin, product } = await setupTierCompany();
      await setLoyaltyTiers(db, company.id, {
        enabled: true,
        tier2Min: 1500,
        tier3Min: 5000,
        tier1Rate: 65,
        tier2Rate: 50,
        tier3Rate: 33,
      });
      const customer = await makeCustomer(db, company.id, "Cliente Año Viejo");
      // Simula que el año pasado ya era Oro ($6,000), pero eso quedó en el
      // año calendario anterior -- este año debe arrancar otra vez en Bronce.
      await setYearSpend(customer, 6000, new Date().getFullYear() - 1);

      const result = await asUser(db, admin, () =>
        createSale(
          db,
          [{ product_id: product, qty: 6.5, unit_price: 100 }], // total=650
          company.loc1,
          undefined,
          { customerId: customer },
        ),
      );

      expect(result.points_earned).toBe(10); // floor(650 / 65), Bronce otra vez
    });

    it("el valor de canje (loyalty_point_value) no cambia entre niveles -- 1 punto sigue valiendo lo mismo", async () => {
      const { company, admin, product } = await setupTierCompany();
      await setLoyaltyTiers(db, company.id, {
        enabled: true,
        tier2Min: 1500,
        tier3Min: 5000,
        tier1Rate: 65,
        tier2Rate: 50,
        tier3Rate: 33,
      });
      const customer = await makeCustomer(
        db,
        company.id,
        "Cliente Oro Canjea",
        20,
      );
      await setYearSpend(customer, 6000); // Oro

      const result = await asUser(db, admin, () =>
        createSale(
          db,
          [{ product_id: product, qty: 1, unit_price: 100 }],
          company.loc1,
          undefined,
          { customerId: customer, pointsRedeemed: 20 },
        ),
      );

      expect(result.discount_total).toBe(20); // 20 puntos * $1, igual en cualquier nivel
      expect(result.total).toBe(80);
    });
  });

  describe("28. Cotizaciones (crear sin tocar stock, convertir con precio congelado)", () => {
    interface QuoteResult {
      quote_id: string;
      quote_number: string;
      subtotal: number;
      tax: number;
      total: number;
      valid_until: string;
    }
    interface ConvertResult {
      sale_id: string;
      sale_number: string;
      quote_id: string;
      total: number;
      points_earned: number;
      points_redeemed: number;
    }

    async function createQuote(
      userId: string,
      params: {
        items: { productId: string; variantId?: string; qty: number }[];
        customerId?: string | null;
        customerName?: string | null;
        locationId?: string | null;
        validUntil?: string | null;
        notes?: string | null;
      },
    ): Promise<QuoteResult> {
      const itemsJson = JSON.stringify(
        params.items.map((i) => ({
          product_id: i.productId,
          variant_id: i.variantId ?? null,
          qty: i.qty,
        })),
      );
      const { rows } = await asUser(db, userId, () =>
        db.query<{ create_quote: QuoteResult }>(
          `select create_quote(
             p_items := $1::jsonb,
             p_customer_id := $2,
             p_customer_name := $3,
             p_location_id := $4,
             p_valid_until := $5,
             p_notes := $6
           ) as create_quote`,
          [
            itemsJson,
            params.customerId ?? null,
            params.customerName ?? null,
            params.locationId ?? null,
            params.validUntil ?? null,
            params.notes ?? null,
          ],
        ),
      );
      return rows[0].create_quote;
    }

    async function convertQuote(
      userId: string,
      params: {
        quoteId: string;
        locationId: string;
        paymentMethod?: string;
        paymentKind?: string;
        tillId?: string | null;
        pointsRedeemed?: number;
      },
    ): Promise<ConvertResult> {
      const { rows } = await asUser(db, userId, () =>
        db.query<{ convert_quote_to_sale: ConvertResult }>(
          `select convert_quote_to_sale(
             p_quote_id := $1,
             p_location_id := $2,
             p_payment_method := $3,
             p_payment_kind := $4,
             p_till_id := $5,
             p_points_redeemed := $6
           ) as convert_quote_to_sale`,
          [
            params.quoteId,
            params.locationId,
            params.paymentMethod ?? "Efectivo",
            params.paymentKind ?? null,
            params.tillId ?? null,
            params.pointsRedeemed ?? 0,
          ],
        ),
      );
      return rows[0].convert_quote_to_sale;
    }

    async function rejectQuote(userId: string, quoteId: string) {
      await asUser(db, userId, () =>
        db.query("select reject_quote($1)", [quoteId]),
      );
    }

    async function getProductStock(productId: string): Promise<number> {
      const { rows } = await db.query<{ stock: string }>(
        "select stock from public.products where id = $1",
        [productId],
      );
      return Number(rows[0].stock);
    }

    it("crea una cotización sin validar ni tocar el stock (es una promesa de precio, no de inventario)", async () => {
      const company = await makeCompany(db, "Empresa Cotizacion Test");
      const admin = await makeUser(db, company.id, "admin");
      const product = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Producto Cotizado",
        50,
        100,
        5,
      );

      const quote = await createQuote(admin, {
        items: [{ productId: product, qty: 20 }], // más que el stock (5) -- se permite
      });

      expect(quote.quote_number).toMatch(/^COT-\d{8}-[A-F0-9]{6}$/);
      expect(quote.total).toBeCloseTo(2000, 2); // 100 * 20, price_includes_tax=true
      expect(await getProductStock(product)).toBe(5); // intacto
    });

    it("un operador no puede crear cotizaciones", async () => {
      const company = await makeCompany(db, "Empresa Cotizacion Rol Test");
      const operador = await makeUser(db, company.id, "operador");
      const product = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Producto",
        5,
        10,
        10,
      );

      await expect(
        createQuote(operador, { items: [{ productId: product, qty: 1 }] }),
      ).rejects.toThrow(/No tienes permiso/i);
    });

    it("convertir respeta el precio YA CONGELADO aunque el precio del producto haya cambiado después", async () => {
      const company = await makeCompany(db, "Empresa Cotizacion Precio Test");
      const admin = await makeUser(db, company.id, "admin");
      const product = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Producto Precio",
        50,
        100,
        10,
      );

      const quote = await createQuote(admin, {
        items: [{ productId: product, qty: 3 }],
      });
      expect(quote.total).toBeCloseTo(300, 2);

      // El precio del producto sube DESPUÉS de cotizar.
      await db.query("update public.products set price = 200 where id = $1", [
        product,
      ]);

      const result = await convertQuote(admin, {
        quoteId: quote.quote_id,
        locationId: company.loc1,
      });

      expect(result.total).toBeCloseTo(300, 2); // NO 600 -- el precio cotizado, no el nuevo
      expect(await getProductStock(product)).toBe(7); // 10 - 3

      const { rows } = await db.query<{ unit_price: string }>(
        "select unit_price from public.sale_items where sale_id = $1",
        [result.sale_id],
      );
      expect(Number(rows[0].unit_price)).toBeCloseTo(100, 2);
    });

    it("no se puede convertir una cotización vencida", async () => {
      const company = await makeCompany(db, "Empresa Cotizacion Vencida Test");
      const admin = await makeUser(db, company.id, "admin");
      const product = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Producto Vence",
        5,
        10,
        10,
      );
      const quote = await createQuote(admin, {
        items: [{ productId: product, qty: 1 }],
      });

      // Simula que pasó el tiempo: la vigencia ya quedó en el pasado.
      await db.query(
        "update public.quotes set valid_until = current_date - 1 where id = $1",
        [quote.quote_id],
      );

      await expect(
        convertQuote(admin, {
          quoteId: quote.quote_id,
          locationId: company.loc1,
        }),
      ).rejects.toThrow(/vencio/i);
    });

    it("no se puede convertir dos veces la misma cotización", async () => {
      const company = await makeCompany(db, "Empresa Cotizacion Doble Test");
      const admin = await makeUser(db, company.id, "admin");
      const product = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Producto Doble",
        5,
        10,
        10,
      );
      const quote = await createQuote(admin, {
        items: [{ productId: product, qty: 1 }],
      });

      await convertQuote(admin, {
        quoteId: quote.quote_id,
        locationId: company.loc1,
      });

      await expect(
        convertQuote(admin, {
          quoteId: quote.quote_id,
          locationId: company.loc1,
        }),
      ).rejects.toThrow(/ya esta convertida/i);
    });

    it("rechazar una cotización pendiente le impide convertirse después", async () => {
      const company = await makeCompany(db, "Empresa Cotizacion Rechazo Test");
      const admin = await makeUser(db, company.id, "admin");
      const product = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Producto Rechazo",
        5,
        10,
        10,
      );
      const quote = await createQuote(admin, {
        items: [{ productId: product, qty: 1 }],
      });

      await rejectQuote(admin, quote.quote_id);

      await expect(
        convertQuote(admin, {
          quoteId: quote.quote_id,
          locationId: company.loc1,
        }),
      ).rejects.toThrow(/ya esta rechazada/i);

      // Tampoco se puede rechazar dos veces.
      await expect(rejectQuote(admin, quote.quote_id)).rejects.toThrow(
        /no existe o ya no esta pendiente/i,
      );
    });

    it("si no alcanza el stock al convertir, se rechaza todo sin descontar nada", async () => {
      const company = await makeCompany(
        db,
        "Empresa Cotizacion Sin Stock Test",
      );
      const admin = await makeUser(db, company.id, "admin");
      const product = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Producto Escaso",
        5,
        10,
        2,
      );
      const quote = await createQuote(admin, {
        items: [{ productId: product, qty: 5 }], // se permitió al cotizar
      });

      await expect(
        convertQuote(admin, {
          quoteId: quote.quote_id,
          locationId: company.loc1,
        }),
      ).rejects.toThrow(/Stock insuficiente/i);
      expect(await getProductStock(product)).toBe(2); // intacto, nada se descontó
    });

    it("una cotización con un producto tipo Servicio se convierte sin tocar stock", async () => {
      const company = await makeCompany(db, "Empresa Cotizacion Servicio Test");
      const admin = await makeUser(db, company.id, "admin");
      const { rows } = await db.query<{ id: string }>(
        "insert into public.products (company_id, name, price, cost, unit, product_type) values ($1,$2,$3,$4,'und','service') returning id",
        [company.id, "Instalación", 500, 100],
      );
      const service = rows[0].id;

      const quote = await createQuote(admin, {
        items: [{ productId: service, qty: 1 }],
      });

      const result = await convertQuote(admin, {
        quoteId: quote.quote_id,
        locationId: company.loc1,
      });
      expect(result.total).toBeCloseTo(500, 2);

      const { rows: itemRows } = await db.query<{ cost: string }>(
        "select cost from public.sale_items where sale_id = $1",
        [result.sale_id],
      );
      expect(Number(itemRows[0].cost)).toBeCloseTo(100, 2);
    });

    it("una cotización con un Combo descuenta cada pieza y recalcula el costo en vivo al convertir", async () => {
      const company = await makeCompany(db, "Empresa Cotizacion Combo Test");
      const admin = await makeUser(db, company.id, "admin");
      const boligrafo = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Bolígrafo negro",
        2,
        5,
        100,
      );
      const { rows } = await db.query<{ id: string }>(
        "insert into public.products (company_id, name, price, cost, unit, product_type) values ($1,$2,$3,0,'und','combo') returning id",
        [company.id, "Caja de 12", 50],
      );
      const combo = rows[0].id;
      await db.query(
        "insert into public.product_combo_items (company_id, combo_product_id, component_product_id, qty) values ($1,$2,$3,$4)",
        [company.id, combo, boligrafo, 12],
      );

      const quote = await createQuote(admin, {
        items: [{ productId: combo, qty: 2 }], // 2 cajas -> 24 bolígrafos
      });
      expect(quote.total).toBeCloseTo(100, 2); // 2 * 50

      // El costo del bolígrafo sube DESPUÉS de cotizar -- el costo del
      // combo se recalcula en vivo con el costo actual, igual que
      // create_sale (nunca se congela el costo, solo el precio de venta).
      await db.query("update public.products set cost = 3 where id = $1", [
        boligrafo,
      ]);

      const result = await convertQuote(admin, {
        quoteId: quote.quote_id,
        locationId: company.loc1,
      });
      expect(result.total).toBeCloseTo(100, 2);
      expect(await getProductStock(boligrafo)).toBe(76); // 100 - 24

      const { rows: itemRows } = await db.query<{ cost: string }>(
        "select cost from public.sale_items where sale_id = $1",
        [result.sale_id],
      );
      // costo de 1 caja = 12 * 3 (costo actual del bolígrafo) = 36
      expect(Number(itemRows[0].cost)).toBeCloseTo(36, 2);
    });

    it("un combo sin piezas configuradas no se puede convertir", async () => {
      const company = await makeCompany(
        db,
        "Empresa Cotizacion Combo Vacio Test",
      );
      const admin = await makeUser(db, company.id, "admin");
      const { rows } = await db.query<{ id: string }>(
        "insert into public.products (company_id, name, price, cost, unit, product_type) values ($1,$2,$3,0,'und','combo') returning id",
        [company.id, "Combo Vacío", 50],
      );
      const combo = rows[0].id;

      const quote = await createQuote(admin, {
        items: [{ productId: combo, qty: 1 }],
      });

      await expect(
        convertQuote(admin, {
          quoteId: quote.quote_id,
          locationId: company.loc1,
        }),
      ).rejects.toThrow(/no tiene piezas configuradas/i);
    });

    it("la venta convertida gana comisión del vendedor y puntos de lealtad, con las reglas vigentes al convertir", async () => {
      const company = await makeCompany(db, "Empresa Cotizacion Comision Test");
      const admin = await makeUser(db, company.id, "admin");
      const cajero = await makeUser(db, company.id, "user");
      const product = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Producto Comision",
        50,
        100,
        10,
      );
      const customer = await makeCustomer(db, company.id, "Cliente Cotizacion");
      await setLoyaltySettings(db, company.id, {
        enabled: true,
        pointValue: 1,
        earnRate: 10,
      });
      await asUser(db, admin, () =>
        db.query("select set_employee_commission($1, $2)", [cajero, 0.1]),
      );

      const quote = await createQuote(cajero, {
        items: [{ productId: product, qty: 2 }],
        customerId: customer,
      });
      expect(quote.total).toBeCloseTo(200, 2);

      const result = await convertQuote(cajero, {
        quoteId: quote.quote_id,
        locationId: company.loc1,
      });

      expect(result.points_earned).toBe(20); // floor(200/10)
      expect(await getCustomerLoyaltyPoints(db, customer)).toBe(20);

      const { rows } = await db.query<{
        commission_amount: string;
        created_by: string;
      }>(
        "select commission_amount, created_by from public.sales where id = $1",
        [result.sale_id],
      );
      expect(Number(rows[0].commission_amount)).toBeCloseTo(20, 2); // 10% de 200
      expect(rows[0].created_by).toBe(cajero);
    });

    it("todos en la empresa ven todas las cotizaciones, no solo las que crearon (a diferencia de Mermas)", async () => {
      const company = await makeCompany(db, "Empresa Cotizacion RLS Test");
      const cajeroA = await makeUser(db, company.id, "user");
      const cajeroB = await makeUser(db, company.id, "user");
      const product = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Producto RLS",
        5,
        10,
        10,
      );

      await createQuote(cajeroA, { items: [{ productId: product, qty: 1 }] });

      const seenByB = await asUser(db, cajeroB, () =>
        db.query("select id from public.quotes"),
      );
      expect(seenByB.rows.length).toBe(1);
    });

    it("una empresa no ve ni puede convertir las cotizaciones de otra empresa", async () => {
      const companyA = await makeCompany(
        db,
        "Empresa Cotizacion Cruzada A Test",
      );
      const companyB = await makeCompany(
        db,
        "Empresa Cotizacion Cruzada B Test",
      );
      const adminA = await makeUser(db, companyA.id, "admin");
      const adminB = await makeUser(db, companyB.id, "admin");
      const productA = await makeProduct(
        db,
        companyA.id,
        companyA.loc1,
        "Producto A",
        5,
        10,
        10,
      );

      const quote = await createQuote(adminA, {
        items: [{ productId: productA, qty: 1 }],
      });

      const seenByB = await asUser(db, adminB, () =>
        db.query("select id from public.quotes where id = $1", [
          quote.quote_id,
        ]),
      );
      expect(seenByB.rows.length).toBe(0);

      await expect(
        convertQuote(adminB, {
          quoteId: quote.quote_id,
          locationId: companyB.loc1,
        }),
      ).rejects.toThrow(/no encontrada/i);
    });
  });

  describe("29. Apartados (stock reservado desde que se crea, abonos, completar/cancelar)", () => {
    interface ApartadoResult {
      apartado_id: string;
      apartado_number: string;
      subtotal: number;
      tax: number;
      total: number;
      paid_total: number;
      due_date: string;
    }
    interface PaymentResult {
      apartado_id: string;
      applied: number;
      paid_total: number;
      remaining: number;
    }
    interface CompleteResult {
      sale_id: string;
      sale_number: string;
      apartado_id: string;
      total: number;
      points_earned: number;
    }
    interface CancelResult {
      apartado_id: string;
      refunded: boolean;
      refunded_amount: number;
    }

    async function openCashSession(
      userId: string,
      locationId: string,
      openingAmount = 100,
    ): Promise<string> {
      const { rows } = await asUser(db, userId, () =>
        db.query<{ open_cash_session: string }>(
          "select open_cash_session($1, $2) as open_cash_session",
          [openingAmount, locationId],
        ),
      );
      return rows[0].open_cash_session;
    }

    async function getCashMovementsSum(sessionId: string): Promise<number> {
      const { rows } = await db.query<{ total: string | null }>(
        "select coalesce(sum(amount), 0) as total from public.cash_movements where cash_session_id = $1",
        [sessionId],
      );
      return Number(rows[0].total ?? 0);
    }

    async function getProductStock(productId: string): Promise<number> {
      const { rows } = await db.query<{ stock: string }>(
        "select stock from public.products where id = $1",
        [productId],
      );
      return Number(rows[0].stock);
    }

    async function setMinDeposit(companyId: string, pct: number) {
      await db.query(
        "update public.companies set apartado_min_deposit_pct = $2 where id = $1",
        [companyId, pct],
      );
    }

    async function createApartado(
      userId: string,
      params: {
        customerId: string | null;
        items: { productId: string; qty: number }[];
        locationId: string;
        depositAmount: number;
        dueDate?: string | null;
        paymentMethod?: string;
      },
    ): Promise<ApartadoResult> {
      const itemsJson = JSON.stringify(
        params.items.map((i) => ({ product_id: i.productId, qty: i.qty })),
      );
      const { rows } = await asUser(db, userId, () =>
        db.query<{ create_apartado: ApartadoResult }>(
          `select create_apartado(
             p_customer_id := $1,
             p_items := $2::jsonb,
             p_location_id := $3,
             p_deposit_amount := $4,
             p_due_date := $5,
             p_payment_method := $6
           ) as create_apartado`,
          [
            params.customerId,
            itemsJson,
            params.locationId,
            params.depositAmount,
            params.dueDate ?? null,
            params.paymentMethod ?? "Efectivo",
          ],
        ),
      );
      return rows[0].create_apartado;
    }

    async function addApartadoPayment(
      userId: string,
      params: { apartadoId: string; amount: number; paymentMethod?: string },
    ): Promise<PaymentResult> {
      const { rows } = await asUser(db, userId, () =>
        db.query<{ add_apartado_payment: PaymentResult }>(
          `select add_apartado_payment(
             p_apartado_id := $1,
             p_amount := $2,
             p_payment_method := $3
           ) as add_apartado_payment`,
          [
            params.apartadoId,
            params.amount,
            params.paymentMethod ?? "Efectivo",
          ],
        ),
      );
      return rows[0].add_apartado_payment;
    }

    async function completeApartado(
      userId: string,
      params: {
        apartadoId: string;
        finalPaymentAmount?: number;
        paymentMethod?: string;
      },
    ): Promise<CompleteResult> {
      const { rows } = await asUser(db, userId, () =>
        db.query<{ complete_apartado: CompleteResult }>(
          `select complete_apartado(
             p_apartado_id := $1,
             p_final_payment_amount := $2,
             p_payment_method := $3
           ) as complete_apartado`,
          [
            params.apartadoId,
            params.finalPaymentAmount ?? 0,
            params.paymentMethod ?? "Efectivo",
          ],
        ),
      );
      return rows[0].complete_apartado;
    }

    async function cancelApartado(
      userId: string,
      params: { apartadoId: string; refundDeposit: boolean },
    ): Promise<CancelResult> {
      const { rows } = await asUser(db, userId, () =>
        db.query<{ cancel_apartado: CancelResult }>(
          `select cancel_apartado(
             p_apartado_id := $1,
             p_refund_deposit := $2
           ) as cancel_apartado`,
          [params.apartadoId, params.refundDeposit],
        ),
      );
      return rows[0].cancel_apartado;
    }

    async function setupApartadoCompany() {
      const company = await makeCompany(db, "Empresa Apartado Test");
      const admin = await makeUser(db, company.id, "admin");
      const cajero = await makeUser(db, company.id, "user");
      const product = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Producto Apartado",
        50,
        100,
        10,
      );
      const customer = await makeCustomer(db, company.id, "Cliente Apartado");
      await setMinDeposit(company.id, 0); // sin mínimo, salvo que la prueba lo cambie
      return { company, admin, cajero, product, customer };
    }

    it("crea un apartado: el stock se descuenta DESDE que se crea (a diferencia de una cotización)", async () => {
      const { company, admin, product, customer } =
        await setupApartadoCompany();

      const apartado = await createApartado(admin, {
        customerId: customer,
        items: [{ productId: product, qty: 3 }],
        locationId: company.loc1,
        depositAmount: 100,
      });

      expect(apartado.apartado_number).toMatch(/^APT-\d{8}-[A-F0-9]{6}$/);
      expect(apartado.total).toBeCloseTo(300, 2);
      expect(apartado.paid_total).toBeCloseTo(100, 2);
      expect(await getProductStock(product)).toBe(7); // 10 - 3, ya reservado

      // Mismo shape de columnas que usa fetchApartados/fetchApartado en el
      // cliente -- si falta alguna, esto revienta con "column does not
      // exist" igual que le pasó al usuario en producción.
      const { rows } = await db.query<{
        customer_name: string;
        apartado_number: string;
      }>(
        "select id, apartado_number, created_at, customer_id, customer_name, location_id, subtotal, tax, total, paid_total, due_date, status, notes, converted_sale_id, cancel_refunded from public.apartados where id = $1",
        [apartado.apartado_id],
      );
      expect(rows[0].customer_name).toBe("Cliente Apartado");
    });

    it("se requiere un cliente registrado -- no se puede apartar sin cliente", async () => {
      const { admin, product, company } = await setupApartadoCompany();

      await expect(
        createApartado(admin, {
          customerId: null,
          items: [{ productId: product, qty: 1 }],
          locationId: company.loc1,
          depositAmount: 0,
        }),
      ).rejects.toThrow(/elige un cliente/i);
    });

    it("el anticipo mínimo se exige según el % configurado en la empresa", async () => {
      const { company, admin, product, customer } =
        await setupApartadoCompany();
      await setMinDeposit(company.id, 0.2); // 20%

      await expect(
        createApartado(admin, {
          customerId: customer,
          items: [{ productId: product, qty: 2 }], // total = 200, mínimo = 40
          locationId: company.loc1,
          depositAmount: 30,
        }),
      ).rejects.toThrow(/anticipo minimo/i);

      const apartado = await createApartado(admin, {
        customerId: customer,
        items: [{ productId: product, qty: 2 }],
        locationId: company.loc1,
        depositAmount: 40,
      });
      expect(apartado.paid_total).toBeCloseTo(40, 2);
    });

    it("no se pueden apartar productos con variantes (v1)", async () => {
      const { company, admin, customer } = await setupApartadoCompany();
      const { rows: variantRows } = await db.query<{ id: string }>(
        "insert into public.products (company_id, name, price, cost, unit, has_variants) values ($1,$2,$3,0,'und',true) returning id",
        [company.id, "Playera", 200],
      );
      await expect(
        createApartado(admin, {
          customerId: customer,
          items: [{ productId: variantRows[0].id, qty: 1 }],
          locationId: company.loc1,
          depositAmount: 0,
        }),
      ).rejects.toThrow(/tiene variantes/i);
    });

    it("el anticipo en efectivo entra al arqueo de quien lo cobra; en tarjeta no", async () => {
      const { company, admin, product, customer } =
        await setupApartadoCompany();
      const sessionId = await openCashSession(admin, company.loc1);

      await createApartado(admin, {
        customerId: customer,
        items: [{ productId: product, qty: 1 }],
        locationId: company.loc1,
        depositAmount: 40,
        paymentMethod: "Efectivo",
      });
      expect(await getCashMovementsSum(sessionId)).toBeCloseTo(40, 2);

      await createApartado(admin, {
        customerId: customer,
        items: [{ productId: product, qty: 1 }],
        locationId: company.loc1,
        depositAmount: 40,
        paymentMethod: "Tarjeta",
      });
      // Sigue igual -- el anticipo con tarjeta no mueve el efectivo del cajón.
      expect(await getCashMovementsSum(sessionId)).toBeCloseTo(40, 2);
    });

    it("un abono posterior topa al saldo pendiente y también entra al arqueo", async () => {
      const { company, admin, product, customer } =
        await setupApartadoCompany();
      const sessionId = await openCashSession(admin, company.loc1);

      const apartado = await createApartado(admin, {
        customerId: customer,
        items: [{ productId: product, qty: 2 }], // total = 200
        locationId: company.loc1,
        depositAmount: 50,
      });

      // Intenta abonar de más -- se topa a lo que realmente falta (150).
      const payment = await addApartadoPayment(admin, {
        apartadoId: apartado.apartado_id,
        amount: 500,
      });
      expect(payment.applied).toBeCloseTo(150, 2);
      expect(payment.remaining).toBeCloseTo(0, 2);
      expect(await getCashMovementsSum(sessionId)).toBeCloseTo(200, 2); // 50 + 150
    });

    it("completar sin terminar de pagar se rechaza, indicando cuánto falta", async () => {
      const { company, admin, product, customer } =
        await setupApartadoCompany();

      const apartado = await createApartado(admin, {
        customerId: customer,
        items: [{ productId: product, qty: 2 }], // total = 200
        locationId: company.loc1,
        depositAmount: 50,
      });

      await expect(
        completeApartado(admin, { apartadoId: apartado.apartado_id }),
      ).rejects.toThrow(/aun falta un saldo de 150/i);
    });

    it("completar un apartado ya pagado genera la venta SIN volver a descontar stock ni a contar el dinero en caja hoy", async () => {
      const { company, admin, product, customer } =
        await setupApartadoCompany();
      const sessionId = await openCashSession(admin, company.loc1);

      const apartado = await createApartado(admin, {
        customerId: customer,
        items: [{ productId: product, qty: 2 }], // total = 200
        locationId: company.loc1,
        depositAmount: 200, // pagado de una vez
      });
      expect(await getProductStock(product)).toBe(8); // 10 - 2, ya se había reservado
      const cashAfterDeposit = await getCashMovementsSum(sessionId);
      expect(cashAfterDeposit).toBeCloseTo(200, 2);

      const result = await completeApartado(admin, {
        apartadoId: apartado.apartado_id,
      });
      expect(result.total).toBeCloseTo(200, 2);
      // El stock NO vuelve a moverse -- ya se descontó al crear el apartado.
      expect(await getProductStock(product)).toBe(8);
      // El arqueo de HOY no cambia -- esos $200 ya se contaron cuando se
      // cobró el anticipo, no ahora al completar.
      expect(await getCashMovementsSum(sessionId)).toBeCloseTo(200, 2);

      const { rows: paymentRows } = await db.query<{
        kind: string;
        method: string;
        amount: string;
      }>(
        "select kind, method, amount from public.sale_payments where sale_id = $1",
        [result.sale_id],
      );
      expect(paymentRows[0].kind).toBe("other"); // nunca 'cash', para no duplicar el arqueo
      expect(paymentRows[0].method).toBe("Apartado");
      expect(Number(paymentRows[0].amount)).toBeCloseTo(200, 2);
    });

    it("completar con el pago final incluido en la misma llamada cierra el apartado de una vez", async () => {
      const { company, admin, product, customer } =
        await setupApartadoCompany();
      const sessionId = await openCashSession(admin, company.loc1);

      const apartado = await createApartado(admin, {
        customerId: customer,
        items: [{ productId: product, qty: 1 }], // total = 100
        locationId: company.loc1,
        depositAmount: 30,
      });

      const result = await completeApartado(admin, {
        apartadoId: apartado.apartado_id,
        finalPaymentAmount: 70,
      });
      expect(result.total).toBeCloseTo(100, 2);
      expect(await getCashMovementsSum(sessionId)).toBeCloseTo(100, 2); // 30 + 70, ambos abonos reales

      const { rows } = await db.query<{ status: string; paid_total: string }>(
        "select status, paid_total from public.apartados where id = $1",
        [apartado.apartado_id],
      );
      expect(rows[0].status).toBe("completado");
      expect(Number(rows[0].paid_total)).toBeCloseTo(100, 2);
    });

    it("completar un apartado gana puntos de lealtad sobre el total, como cualquier compra", async () => {
      const { company, admin, product, customer } =
        await setupApartadoCompany();
      await setLoyaltySettings(db, company.id, {
        enabled: true,
        pointValue: 1,
        earnRate: 10,
      });

      const apartado = await createApartado(admin, {
        customerId: customer,
        items: [{ productId: product, qty: 2 }], // total = 200
        locationId: company.loc1,
        depositAmount: 200,
      });
      const result = await completeApartado(admin, {
        apartadoId: apartado.apartado_id,
      });
      expect(result.points_earned).toBe(20); // floor(200/10)
      expect(await getCustomerLoyaltyPoints(db, customer)).toBe(20);
    });

    it("no se puede abonar ni completar un apartado ya cancelado o completado", async () => {
      const { company, admin, product, customer } =
        await setupApartadoCompany();
      const apartado = await createApartado(admin, {
        customerId: customer,
        items: [{ productId: product, qty: 1 }],
        locationId: company.loc1,
        depositAmount: 100,
      });
      await completeApartado(admin, { apartadoId: apartado.apartado_id });

      await expect(
        addApartadoPayment(admin, {
          apartadoId: apartado.apartado_id,
          amount: 10,
        }),
      ).rejects.toThrow(/ya esta completado/i);
      await expect(
        completeApartado(admin, { apartadoId: apartado.apartado_id }),
      ).rejects.toThrow(/ya esta completado/i);
      await expect(
        cancelApartado(admin, {
          apartadoId: apartado.apartado_id,
          refundDeposit: false,
        }),
      ).rejects.toThrow(/no se puede cancelar/i);
    });

    it("cancelar repone el stock de cada producto; sin reembolso no mueve caja", async () => {
      const { company, admin, product, customer } =
        await setupApartadoCompany();
      const sessionId = await openCashSession(admin, company.loc1);

      const apartado = await createApartado(admin, {
        customerId: customer,
        items: [{ productId: product, qty: 3 }],
        locationId: company.loc1,
        depositAmount: 100,
      });
      expect(await getProductStock(product)).toBe(7);

      const result = await cancelApartado(admin, {
        apartadoId: apartado.apartado_id,
        refundDeposit: false,
      });
      expect(result.refunded).toBe(false);
      expect(await getProductStock(product)).toBe(10); // repuesto por completo
      expect(await getCashMovementsSum(sessionId)).toBeCloseTo(100, 2); // solo el anticipo, sin egreso
    });

    it("cancelar con reembolso saca el anticipo de caja como egreso", async () => {
      const { company, admin, product, customer } =
        await setupApartadoCompany();
      const sessionId = await openCashSession(admin, company.loc1);

      const apartado = await createApartado(admin, {
        customerId: customer,
        items: [{ productId: product, qty: 2 }],
        locationId: company.loc1,
        depositAmount: 80,
      });

      await cancelApartado(admin, {
        apartadoId: apartado.apartado_id,
        refundDeposit: true,
      });
      expect(await getCashMovementsSum(sessionId)).toBeCloseTo(0, 2); // 80 ingreso - 80 egreso
    });

    it("un cajero no puede cancelar un apartado (solo admin/finanzas)", async () => {
      const { company, cajero, product, customer } =
        await setupApartadoCompany();
      const apartado = await createApartado(cajero, {
        customerId: customer,
        items: [{ productId: product, qty: 1 }],
        locationId: company.loc1,
        depositAmount: 0,
      });

      await expect(
        cancelApartado(cajero, {
          apartadoId: apartado.apartado_id,
          refundDeposit: false,
        }),
      ).rejects.toThrow(/Solo un administrador o finanzas/i);
    });

    it("todos en la empresa ven todos los apartados, no solo los que crearon", async () => {
      const { company, cajero, product, customer } =
        await setupApartadoCompany();
      const otroCajero = await makeUser(db, company.id, "user");

      await createApartado(cajero, {
        customerId: customer,
        items: [{ productId: product, qty: 1 }],
        locationId: company.loc1,
        depositAmount: 0,
      });

      const seenByOther = await asUser(db, otroCajero, () =>
        db.query("select id from public.apartados"),
      );
      expect(seenByOther.rows.length).toBe(1);
    });

    it("una empresa no ve ni puede cancelar los apartados de otra empresa", async () => {
      const {
        company: companyA,
        admin: adminA,
        product: productA,
        customer: customerA,
      } = await setupApartadoCompany();
      const companyB = await makeCompany(db, "Empresa Apartado B Test");
      const adminB = await makeUser(db, companyB.id, "admin");

      const apartado = await createApartado(adminA, {
        customerId: customerA,
        items: [{ productId: productA, qty: 1 }],
        locationId: companyA.loc1,
        depositAmount: 0,
      });

      const seenByB = await asUser(db, adminB, () =>
        db.query("select id from public.apartados where id = $1", [
          apartado.apartado_id,
        ]),
      );
      expect(seenByB.rows.length).toBe(0);

      await expect(
        cancelApartado(adminB, {
          apartadoId: apartado.apartado_id,
          refundDeposit: false,
        }),
      ).rejects.toThrow(/no encontrado/i);
    });

    it("un combo en un apartado descuenta el stock de cada pieza (no del combo) y congela el costo", async () => {
      const { company, admin, customer } = await setupApartadoCompany();
      const boligrafo = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Bolígrafo negro (apartado)",
        2,
        5,
        100,
      );
      const { rows } = await db.query<{ id: string }>(
        "insert into public.products (company_id, name, price, cost, unit, product_type) values ($1,$2,$3,0,'und','combo') returning id",
        [company.id, "Caja de 12 (apartado)", 50],
      );
      const combo = rows[0].id;
      await db.query(
        "insert into public.product_combo_items (company_id, combo_product_id, component_product_id, qty) values ($1,$2,$3,$4)",
        [company.id, combo, boligrafo, 12],
      );

      const apartado = await createApartado(admin, {
        customerId: customer,
        items: [{ productId: combo, qty: 2 }], // 2 cajas -> 24 bolígrafos
        locationId: company.loc1,
        depositAmount: 0,
      });
      expect(apartado.total).toBeCloseTo(100, 2); // 2 * 50
      expect(await getProductStock(boligrafo)).toBe(76); // 100 - 24
      expect(await getProductStock(combo)).toBe(0); // el combo nunca tiene stock propio

      // El costo sube DESPUÉS de apartar -- igual que una cotización, el
      // costo del combo se congela en apartado_items al crear, así que
      // complete_apartado no debe recalcularlo con el costo nuevo.
      await db.query("update public.products set cost = 3 where id = $1", [
        boligrafo,
      ]);

      const result = await completeApartado(admin, {
        apartadoId: apartado.apartado_id,
        finalPaymentAmount: apartado.total,
      });

      const { rows: itemRows } = await db.query<{ cost: string }>(
        "select cost from public.sale_items where sale_id = $1",
        [result.sale_id],
      );
      // costo POR UNIDAD de combo, congelado = 12 * 2 (costo ORIGINAL del
      // bolígrafo) = 24 -- igual que sale_items.cost, no se multiplica por
      // la cantidad de combos apartados.
      expect(Number(itemRows[0].cost)).toBeCloseTo(24, 2);
    });

    it("un combo sin piezas configuradas no se puede apartar", async () => {
      const { company, admin, customer } = await setupApartadoCompany();
      const { rows } = await db.query<{ id: string }>(
        "insert into public.products (company_id, name, price, cost, unit, product_type) values ($1,$2,$3,0,'und','combo') returning id",
        [company.id, "Combo Vacío (apartado)", 50],
      );
      const combo = rows[0].id;

      await expect(
        createApartado(admin, {
          customerId: customer,
          items: [{ productId: combo, qty: 1 }],
          locationId: company.loc1,
          depositAmount: 0,
        }),
      ).rejects.toThrow(/no tiene piezas configuradas/i);
    });

    it("cancelar un apartado con un combo repone el stock de cada pieza", async () => {
      const { company, admin, customer } = await setupApartadoCompany();
      const boligrafo = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Bolígrafo negro (cancelar combo)",
        2,
        5,
        100,
      );
      const { rows } = await db.query<{ id: string }>(
        "insert into public.products (company_id, name, price, cost, unit, product_type) values ($1,$2,$3,0,'und','combo') returning id",
        [company.id, "Caja de 12 (cancelar)", 50],
      );
      const combo = rows[0].id;
      await db.query(
        "insert into public.product_combo_items (company_id, combo_product_id, component_product_id, qty) values ($1,$2,$3,$4)",
        [company.id, combo, boligrafo, 12],
      );

      const apartado = await createApartado(admin, {
        customerId: customer,
        items: [{ productId: combo, qty: 2 }],
        locationId: company.loc1,
        depositAmount: 0,
      });
      expect(await getProductStock(boligrafo)).toBe(76);

      await cancelApartado(admin, {
        apartadoId: apartado.apartado_id,
        refundDeposit: false,
      });
      expect(await getProductStock(boligrafo)).toBe(100); // repuesto por completo
    });

    it("un servicio no se puede apartar (sin stock que reservar)", async () => {
      const { company, admin, customer } = await setupApartadoCompany();
      const { rows } = await db.query<{ id: string }>(
        "insert into public.products (company_id, name, price, cost, unit, product_type) values ($1,$2,$3,$4,'und','service') returning id",
        [company.id, "Instalación (apartado)", 500, 100],
      );
      const service = rows[0].id;

      await expect(
        createApartado(admin, {
          customerId: customer,
          items: [{ productId: service, qty: 1 }],
          locationId: company.loc1,
          depositAmount: 0,
        }),
      ).rejects.toThrow(/es un servicio/i);
    });
  });

  describe("30. Alertas generales y auditoría universal", () => {
    async function openCashSession(
      userId: string,
      locationId: string,
      openingAmount = 100,
    ): Promise<string> {
      const { rows } = await asUser(db, userId, () =>
        db.query<{ open_cash_session: string }>(
          "select open_cash_session($1, $2) as open_cash_session",
          [openingAmount, locationId],
        ),
      );
      return rows[0].open_cash_session;
    }

    async function createApartado(
      userId: string,
      params: {
        customerId: string | null;
        items: { productId: string; qty: number }[];
        locationId: string;
        depositAmount: number;
      },
    ): Promise<{ apartado_id: string }> {
      const itemsJson = JSON.stringify(
        params.items.map((i) => ({ product_id: i.productId, qty: i.qty })),
      );
      const { rows } = await asUser(db, userId, () =>
        db.query<{ create_apartado: { apartado_id: string } }>(
          `select create_apartado(
             p_customer_id := $1,
             p_items := $2::jsonb,
             p_location_id := $3,
             p_deposit_amount := $4
           ) as create_apartado`,
          [
            params.customerId,
            itemsJson,
            params.locationId,
            params.depositAmount,
          ],
        ),
      );
      return rows[0].create_apartado;
    }

    async function cancelApartado(
      userId: string,
      params: { apartadoId: string; refundDeposit: boolean },
    ): Promise<void> {
      await asUser(db, userId, () =>
        db.query(
          "select cancel_apartado(p_apartado_id := $1, p_refund_deposit := $2)",
          [params.apartadoId, params.refundDeposit],
        ),
      );
    }

    interface CompanyAlertsPayload {
      stock_bajo: {
        id: string;
        name: string;
        stock: number;
        threshold: number;
      }[];
      apartados_vencidos: {
        id: string;
        apartado_number: string;
        due_date: string;
      }[];
      cotizaciones_vencidas: {
        id: string;
        quote_number: string;
        valid_until: string;
      }[];
      cajas_abiertas: { id: string; opened_at: string }[];
      clientes_credito: {
        id: string;
        name: string;
        credit_limit: string;
        credit_balance: string;
      }[];
    }

    async function getAlerts(userId: string): Promise<CompanyAlertsPayload> {
      const { rows } = await asUser(db, userId, () =>
        db.query<{ get_company_alerts: CompanyAlertsPayload }>(
          "select get_company_alerts() as get_company_alerts",
        ),
      );
      return rows[0].get_company_alerts;
    }

    async function getAuditRows(
      companyId: string,
      entityType: string,
    ): Promise<
      {
        actor_id: string | null;
        action: string;
        detail: Record<string, unknown>;
      }[]
    > {
      const { rows } = await db.query<{
        actor_id: string | null;
        action: string;
        detail: Record<string, unknown>;
      }>(
        "select actor_id, action, detail from public.audit_log where company_id = $1 and entity_type = $2 order by created_at desc",
        [companyId, entityType],
      );
      return rows;
    }

    it("un cajero no puede ver las alertas (solo admin/finanzas)", async () => {
      const company = await makeCompany(db, "Empresa Alertas Permiso Test");
      const cajero = await makeUser(db, company.id, "user");
      await expect(getAlerts(cajero)).rejects.toThrow(/no tienes permiso/i);
    });

    it("get_company_alerts detecta stock bajo, apartados vencidos, cotizaciones vencidas y clientes al límite de crédito", async () => {
      const company = await makeCompany(db, "Empresa Alertas Test");
      const admin = await makeUser(db, company.id, "admin");
      const customer = await makeCustomer(db, company.id, "Cliente Alertas");
      await db.query(
        "update public.companies set apartado_min_deposit_pct = 0 where id = $1",
        [company.id],
      );

      // Stock bajo: producto con 2 unidades, umbral default 10.
      const lowStockProduct = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Producto Stock Bajo",
        10,
        20,
        2,
      );

      // Apartado vencido: due_date en el pasado, status activo.
      const apartadoProduct = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Producto Apartado Alertas",
        10,
        20,
        50,
      );
      const apartado = await createApartado(admin, {
        customerId: customer,
        items: [{ productId: apartadoProduct, qty: 1 }],
        locationId: company.loc1,
        depositAmount: 0,
      });
      await db.query(
        "update public.apartados set due_date = current_date - interval '5 days' where id = $1",
        [apartado.apartado_id],
      );

      // Cotización vencida: valid_until en el pasado, status pendiente.
      const quoteProduct = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Producto Cotizacion Alertas",
        10,
        20,
        50,
      );
      const { rows: quoteRows } = await asUser(db, admin, () =>
        db.query<{ create_quote: { quote_id: string } }>(
          `select create_quote(
             p_items := $1::jsonb,
             p_customer_id := $2,
             p_location_id := $3
           ) as create_quote`,
          [
            JSON.stringify([{ product_id: quoteProduct, qty: 1 }]),
            customer,
            company.loc1,
          ],
        ),
      );
      const quoteId = quoteRows[0].create_quote.quote_id;
      await db.query(
        "update public.quotes set valid_until = current_date - interval '1 day' where id = $1",
        [quoteId],
      );

      // Cliente al límite de crédito.
      await db.query(
        "update public.customers set credit_limit = 1000, credit_balance = 950 where id = $1",
        [customer],
      );

      const alerts = await getAlerts(admin);

      expect(alerts.stock_bajo.map((i) => i.id)).toContain(lowStockProduct);
      expect(alerts.apartados_vencidos.map((i) => i.id)).toContain(
        apartado.apartado_id,
      );
      expect(alerts.cotizaciones_vencidas.map((i) => i.id)).toContain(quoteId);
      expect(alerts.clientes_credito.map((i) => i.id)).toContain(customer);
    });

    it("get_company_alerts detecta una caja abierta desde un turno anterior", async () => {
      const company = await makeCompany(db, "Empresa Alertas Caja Test");
      const admin = await makeUser(db, company.id, "admin");
      const sessionId = await openCashSession(admin, company.loc1);
      await db.query(
        "update public.cash_sessions set opened_at = now() - interval '2 days' where id = $1",
        [sessionId],
      );

      const alerts = await getAlerts(admin);
      expect(alerts.cajas_abiertas.map((i) => i.id)).toContain(sessionId);
    });

    it("register_merma y delete_merma quedan en la bitácora universal", async () => {
      const company = await makeCompany(db, "Empresa Auditoria Merma Test");
      const admin = await makeUser(db, company.id, "admin");
      const product = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Producto Merma Auditoria",
        10,
        20,
        50,
      );
      const { rows } = await asUser(db, admin, () =>
        db.query<{ register_merma: string }>(
          `select register_merma(
             p_location_id := $1,
             p_reason_category := 'danado',
             p_product_id := $2,
             p_quantity := 3
           ) as register_merma`,
          [company.loc1, product],
        ),
      );
      const mermaId = rows[0].register_merma;

      let audit = await getAuditRows(company.id, "merma");
      expect(audit).toHaveLength(1);
      expect(audit[0].action).toBe("registered");
      expect(audit[0].actor_id).toBe(admin);

      await asUser(db, admin, () =>
        db.query("select delete_merma($1)", [mermaId]),
      );
      audit = await getAuditRows(company.id, "merma");
      expect(audit).toHaveLength(2);
      expect(audit.map((a) => a.action).sort()).toEqual([
        "deleted",
        "registered",
      ]);
    });

    it("rechazar una cotización y cancelar un apartado quedan en la bitácora", async () => {
      const company = await makeCompany(db, "Empresa Auditoria Rechazo Test");
      const admin = await makeUser(db, company.id, "admin");
      const customer = await makeCustomer(db, company.id, "Cliente Auditoria");
      await db.query(
        "update public.companies set apartado_min_deposit_pct = 0 where id = $1",
        [company.id],
      );
      const product = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Producto Auditoria",
        10,
        20,
        50,
      );

      const { rows: quoteRows } = await asUser(db, admin, () =>
        db.query<{ create_quote: { quote_id: string } }>(
          `select create_quote(p_items := $1::jsonb, p_customer_id := $2, p_location_id := $3) as create_quote`,
          [
            JSON.stringify([{ product_id: product, qty: 1 }]),
            customer,
            company.loc1,
          ],
        ),
      );
      await asUser(db, admin, () =>
        db.query("select reject_quote($1)", [
          quoteRows[0].create_quote.quote_id,
        ]),
      );
      const quoteAudit = await getAuditRows(company.id, "quote");
      expect(quoteAudit).toHaveLength(1);
      expect(quoteAudit[0].action).toBe("rejected");

      const apartado = await createApartado(admin, {
        customerId: customer,
        items: [{ productId: product, qty: 1 }],
        locationId: company.loc1,
        depositAmount: 0,
      });
      await cancelApartado(admin, {
        apartadoId: apartado.apartado_id,
        refundDeposit: false,
      });
      const apartadoAudit = await getAuditRows(company.id, "apartado");
      expect(apartadoAudit).toHaveLength(1);
      expect(apartadoAudit[0].action).toBe("cancelled");
    });

    it("cambiar el límite de crédito de un cliente queda en la bitácora, atribuido a quien lo hizo", async () => {
      const company = await makeCompany(db, "Empresa Auditoria Credito Test");
      const admin = await makeUser(db, company.id, "admin");
      const customer = await makeCustomer(
        db,
        company.id,
        "Cliente Credito Auditoria",
      );

      await asUser(db, admin, () =>
        db.query(
          "update public.customers set credit_limit = 500 where id = $1",
          [customer],
        ),
      );

      const audit = await getAuditRows(company.id, "customer");
      expect(audit).toHaveLength(1);
      expect(audit[0].action).toBe("credit_limit_changed");
      expect(audit[0].actor_id).toBe(admin);
      expect(audit[0].detail).toMatchObject({ despues: 500 });
    });

    it("cambiar la configuración de lealtad de la empresa queda en la bitácora", async () => {
      const company = await makeCompany(db, "Empresa Auditoria Config Test");
      const admin = await makeUser(db, company.id, "admin");

      await asUser(db, admin, () =>
        db.query(
          "update public.companies set loyalty_enabled = true, apartado_min_deposit_pct = 0.3 where id = $1",
          [company.id],
        ),
      );

      const audit = await getAuditRows(company.id, "company");
      expect(audit).toHaveLength(1);
      expect(audit[0].action).toBe("settings_changed");
      expect(audit[0].detail).toMatchObject({
        loyalty_enabled: { antes: false, despues: true },
      });
    });
  });

  describe("31. Ventas canceladas sin cobrar (prevención de robo)", () => {
    async function logVoidedSaleAs(
      userId: string,
      params: {
        items: { productId: string; qty: number }[];
        locationId?: string | null;
        reason?: string | null;
      },
    ): Promise<string> {
      const itemsJson = JSON.stringify(
        params.items.map((i) => ({ product_id: i.productId, qty: i.qty })),
      );
      const { rows } = await asUser(db, userId, () =>
        db.query<{ log_voided_sale: string }>(
          `select log_voided_sale(
             p_items := $1::jsonb,
             p_location_id := $2,
             p_reason := $3
           ) as log_voided_sale`,
          [itemsJson, params.locationId ?? null, params.reason ?? null],
        ),
      );
      return rows[0].log_voided_sale;
    }

    async function setupVoidedSaleCompany() {
      const company = await makeCompany(db, "Empresa Venta Cancelada Test");
      const admin = await makeUser(db, company.id, "admin");
      const cajero = await makeUser(db, company.id, "user");
      const product = await makeProduct(
        db,
        company.id,
        company.loc1,
        "Producto Cancelado",
        20,
        50,
        100,
      );
      return { company, admin, cajero, product };
    }

    it("un cajero puede registrar la cancelación de su propio carrito, con el precio ACTUAL del producto (no el que mande el cliente)", async () => {
      const { company, cajero, product } = await setupVoidedSaleCompany();

      const voidedId = await logVoidedSaleAs(cajero, {
        items: [{ productId: product, qty: 2 }],
        locationId: company.loc1,
        reason: "El cliente se arrepintió",
      });

      const { rows: headerRows } = await db.query<{
        total: string;
        item_count: number;
        reason: string;
        created_by: string;
      }>(
        "select total, item_count, reason, created_by from public.voided_sales where id = $1",
        [voidedId],
      );
      expect(Number(headerRows[0].total)).toBeCloseTo(100, 2); // 2 * 50
      expect(headerRows[0].item_count).toBe(1);
      expect(headerRows[0].reason).toBe("El cliente se arrepintió");
      expect(headerRows[0].created_by).toBe(cajero);

      const { rows: itemRows } = await db.query<{
        product_name: string;
        qty: string;
        unit_price: string;
      }>(
        "select product_name, qty, unit_price from public.voided_sale_items where voided_sale_id = $1",
        [voidedId],
      );
      expect(itemRows).toHaveLength(1);
      expect(itemRows[0].product_name).toBe("Producto Cancelado");
      expect(Number(itemRows[0].unit_price)).toBeCloseTo(50, 2);

      const { rows: auditRows } = await db.query<{
        action: string;
        actor_id: string;
      }>(
        "select action, actor_id from public.audit_log where company_id = $1 and entity_type = 'voided_sale'",
        [company.id],
      );
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].action).toBe("cancelled");
      expect(auditRows[0].actor_id).toBe(cajero);
    });

    it("un carrito vacío (o con productos que ya no existen) se rechaza", async () => {
      const { cajero } = await setupVoidedSaleCompany();
      await expect(logVoidedSaleAs(cajero, { items: [] })).rejects.toThrow(
        /carrito esta vacio/i,
      );

      await expect(
        logVoidedSaleAs(cajero, {
          items: [{ productId: crypto.randomUUID(), qty: 1 }],
        }),
      ).rejects.toThrow(/carrito esta vacio/i);
    });

    it("un precio manipulado por el cliente se ignora -- siempre se recalcula server-side", async () => {
      const { cajero, product } = await setupVoidedSaleCompany();
      // El RPC solo acepta product_id/qty -- ni siquiera hay un campo de
      // precio que un cliente manipulado pueda mandar; esta prueba lo deja
      // explícito para que quede documentado el diseño.
      const voidedId = await logVoidedSaleAs(cajero, {
        items: [{ productId: product, qty: 1 }],
      });
      const { rows } = await db.query<{ total: string }>(
        "select total from public.voided_sales where id = $1",
        [voidedId],
      );
      expect(Number(rows[0].total)).toBeCloseTo(50, 2); // precio real del producto, no otro
    });

    it("un cajero no puede leer las ventas canceladas -- solo admin/finanzas", async () => {
      const { cajero, product } = await setupVoidedSaleCompany();
      await logVoidedSaleAs(cajero, {
        items: [{ productId: product, qty: 1 }],
        reason: "Prueba",
      });

      const seenByCajero = await asUser(db, cajero, () =>
        db.query("select id from public.voided_sales"),
      );
      expect(seenByCajero.rows).toHaveLength(0);
    });

    it("get_company_alerts incluye una cancelación reciente y excluye una de hace más de 48h", async () => {
      const { company, admin, cajero, product } =
        await setupVoidedSaleCompany();

      const reciente = await logVoidedSaleAs(cajero, {
        items: [{ productId: product, qty: 1 }],
        reason: "Reciente",
      });
      const vieja = await logVoidedSaleAs(cajero, {
        items: [{ productId: product, qty: 1 }],
        reason: "Vieja",
      });
      await db.query(
        "update public.voided_sales set created_at = now() - interval '5 days' where id = $1",
        [vieja],
      );

      const { rows } = await asUser(db, admin, () =>
        db.query<{
          get_company_alerts: {
            ventas_canceladas: { id: string; cashier_name: string }[];
          };
        }>("select get_company_alerts() as get_company_alerts"),
      );
      const ids = rows[0].get_company_alerts.ventas_canceladas.map((v) => v.id);
      expect(ids).toContain(reciente);
      expect(ids).not.toContain(vieja);
      const recienteAlert = rows[0].get_company_alerts.ventas_canceladas.find(
        (v) => v.id === reciente,
      );
      expect(recienteAlert?.cashier_name).toBeTruthy();
    });
  });
});
