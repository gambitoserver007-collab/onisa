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
});
