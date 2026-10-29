// Auditoría de seguridad 2026-10 (9ª pasada): los 9 hallazgos confirmados.
//   1  el tipo de cobro (sale_payments.kind) lo mandaba el cliente: el arqueo se saltaba
//   2  devolución: el recorte de puntos usaba el total ya descontado como denominador
//   3  devolución: un renglón con IVA aparte reembolsaba solo el precio sin IVA
//   4  devolución: reactivaba la asignación del producto y permitía otra sucursal
//   5  devolución: dejaba encendida la autorización de crédito/puntos de clientes
//   6  operador (almacén) y cajero leían tablas que su rol no usa
//   7  la comisión del vendedor la leían sus compañeros (ahora, tabla propia)
//   8  log_voided_sale: motivo sin acotar en la bitácora
//   9  correo del perfil, datos de sucursal y proveedores sin tope de largo
// Cada puerta trae CONTROLES: lo legítimo sigue funcionando.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asUser,
  createSale,
  createTestDb,
  errMessage,
  finishTillCount,
  makeCompany,
  makeCustomer,
  makeProduct,
  makeUser,
  setLoyaltySettings,
  submitTillCount,
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

describe("9ª pasada: los 9 confirmados", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDb();
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  const openSession = (uid: string, loc: string, opening = 0) =>
    asUser(db, uid, () =>
      db.query<{ s: string }>("select open_cash_session($1,$2) as s", [
        opening,
        loc,
      ]),
    ).then((r) => r.rows[0].s);

  const saleItems = async (saleId: string) =>
    (
      await db.query<{ id: string }>(
        "select id from public.sale_items where sale_id=$1 order by id",
        [saleId],
      )
    ).rows;

  const doReturn = (
    uid: string,
    saleId: string,
    itemId: string,
    qty: number,
    loc: string | null,
    cash = true,
  ) =>
    asUser(db, uid, () =>
      db.query("select create_return($1,'x',$2::jsonb,$3,$4) as r", [
        saleId,
        JSON.stringify([{ sale_item_id: itemId, qty }]),
        loc,
        cash,
      ]),
    );

  // ---------------------------------------------------------------- 1
  describe("1. el tipo de cobro no lo decide el cliente", () => {
    let C: TestCompany;
    let admin: string;
    let cashier: string;
    let product: string;

    beforeAll(async () => {
      C = await makeCompany(db, "Puerta 1");
      admin = await makeUser(db, C.id, "admin");
      cashier = await makeUser(db, C.id, "user");
      product = await makeProduct(db, C.id, C.loc1, "P1", 1, 100, 500);
      await openSession(cashier, C.loc1);
    });

    const sellWith = (opts: Parameters<typeof createSale>[4]) =>
      asUser(db, cashier, () =>
        createSale(
          db,
          [{ product_id: product, qty: 1, unit_price: 100 }],
          C.loc1,
          undefined,
          opts,
        ),
      );

    it("efectivo marcado como 'other' se rechaza (ya no se esconde del arqueo)", async () => {
      const err = await rejects(() =>
        sellWith({
          payments: [{ method: "Efectivo", amount: 100, kind: "other" }],
        }),
      );

      expect(err).toMatch(/no corresponde al metodo/i);
    });

    it("tarjeta marcada como 'other' se rechaza; tipo desconocido se rechaza", async () => {
      expect(
        await rejects(() =>
          sellWith({
            payments: [{ method: "Tarjeta", amount: 100, kind: "other" }],
          }),
        ),
      ).toMatch(/no corresponde al metodo/i);
      expect(
        await rejects(() =>
          sellWith({
            payments: [{ method: "Yape", amount: 100, kind: "lo-que-sea" }],
          }),
        ),
      ).toMatch(/tipo de pago invalido/i);
    });

    it("la rama de un solo pago (p_payment_kind) aplica la misma regla", async () => {
      expect(
        await rejects(() =>
          sellWith({ paymentMethod: "Efectivo", paymentKind: "other" }),
        ),
      ).toMatch(/no corresponde al metodo/i);
    });

    it("convert_quote_to_sale aplica la misma regla", async () => {
      const q = (
        await asUser(db, cashier, () =>
          db.query<{ r: { quote_id: string } }>(
            "select create_quote($1::jsonb,null,null,$2,null) as r",
            [JSON.stringify([{ product_id: product, qty: 1 }]), C.loc1],
          ),
        )
      ).rows[0].r.quote_id;
      const err = await rejects(() =>
        asUser(db, cashier, () =>
          db.query("select convert_quote_to_sale($1,$2,'Efectivo','other')", [
            q,
            C.loc1,
          ]),
        ),
      );

      expect(err).toMatch(/no corresponde al metodo/i);
    });

    it("CONTROLES: sin tipo se deduce del método; billeteras y QR personalizados siguen funcionando", async () => {
      const a = await sellWith({ paymentMethod: "Efectivo" });
      const b = await sellWith({
        payments: [
          { method: "Efectivo", amount: 50, kind: "CASH" },
          { method: "Mercado Pago", amount: 50, kind: "wallet" },
        ],
      });
      const c = await sellWith({
        paymentMethod: "Pix",
        paymentKind: "instant_transfer",
      });
      const kinds = async (saleId: string) =>
        (
          await db.query<{ kind: string }>(
            "select kind from public.sale_payments where sale_id=$1 order by kind",
            [saleId],
          )
        ).rows.map((r) => r.kind);

      expect(await kinds(a.sale_id)).toEqual(["cash"]);
      expect(await kinds(b.sale_id)).toEqual(["cash", "wallet"]);
      expect(await kinds(c.sale_id)).toEqual(["instant_transfer"]);
    });

    it("el efectivo vendido SÍ entra al esperado: sin el truco, la caja no cuadra a cero", async () => {
      const C2 = await makeCompany(db, "Puerta 1b");
      const cash2 = await makeUser(db, C2.id, "user");
      const admin2 = await makeUser(db, C2.id, "admin");
      const p = await makeProduct(db, C2.id, C2.loc1, "P", 1, 100, 50);
      const session = await openSession(cash2, C2.loc1);

      await asUser(db, cash2, () =>
        createSale(db, [{ product_id: p, qty: 1, unit_price: 100 }], C2.loc1),
      );
      await asUser(db, cash2, () =>
        submitTillCount(db, session, [{ denomination: 1, quantity: 0 }]),
      );
      const fin = await asUser(db, cash2, () => finishTillCount(db, session));

      expect(fin.second_count_required).toBe(true);
      void admin2;
    });
  });

  // ---------------------------------------------------------------- 2 y 3
  describe("2 y 3. devoluciones: puntos y renglones con IVA aparte", () => {
    it("2. con puntos canjeados, devolver la mitad quita la mitad de los puntos ganados", async () => {
      const C = await makeCompany(db, "Puerta 2");
      const cashier = await makeUser(db, C.id, "user");

      await setLoyaltySettings(db, C.id, {
        enabled: true,
        pointValue: 0.1,
        earnRate: 10,
      });
      const customer = await makeCustomer(db, C.id, "Cli", 1000);
      const p1 = await makeProduct(db, C.id, C.loc1, "A", 1, 100, 50);
      const p2 = await makeProduct(db, C.id, C.loc1, "B", 1, 100, 50);

      await openSession(cashier, C.loc1);
      const sale = await asUser(db, cashier, () =>
        createSale(
          db,
          [
            { product_id: p1, qty: 1, unit_price: 100 },
            { product_id: p2, qty: 1, unit_price: 100 },
          ],
          C.loc1,
          undefined,
          { customerId: customer, pointsRedeemed: 1000 },
        ),
      );
      const earned = Number(sale.points_earned);

      expect(earned).toBeGreaterThan(1);
      const items = await saleItems(sale.sale_id);

      await doReturn(cashier, sale.sale_id, items[0].id, 1, C.loc1);
      const clawed = Number(
        (
          await db.query<{ p: string }>(
            "select coalesce(sum(-points),0) as p from public.loyalty_ledger where sale_id=$1 and type='adjustment' and points<0",
            [sale.sale_id],
          )
        ).rows[0].p,
      );

      // la mitad de lo devuelto (en valor bruto) -> la mitad de los puntos ganados
      expect(clawed).toBe(Math.floor(earned * 0.5));
    });

    it("3. un renglón con IVA aparte se reembolsa completo (lo que pagó, con IVA)", async () => {
      const C = await makeCompany(db, "Puerta 3");
      const cashier = await makeUser(db, C.id, "user");
      const p = await makeProduct(db, C.id, C.loc1, "SinIVA", 1, 100, 50);

      await db.query(
        "update public.products set price_includes_tax=false where id=$1",
        [p],
      );
      await openSession(cashier, C.loc1);
      const sale = await asUser(db, cashier, () =>
        createSale(db, [{ product_id: p, qty: 1, unit_price: 100 }], C.loc1),
      );
      const [item] = await saleItems(sale.sale_id);

      expect(Number(sale.total)).toBeCloseTo(116, 2);
      await doReturn(cashier, sale.sale_id, item.id, 1, C.loc1);
      const ret = (
        await db.query<{ total: string; refund_cash_amount: string }>(
          "select total, refund_cash_amount from public.returns where sale_id=$1",
          [sale.sale_id],
        )
      ).rows[0];

      expect(Number(ret.total)).toBeCloseTo(116, 2);
      expect(Number(ret.refund_cash_amount)).toBeCloseTo(116, 2);
    });

    it("CONTROL 3: un renglón con IVA incluido se reembolsa igual que antes", async () => {
      const C = await makeCompany(db, "Puerta 3b");
      const cashier = await makeUser(db, C.id, "user");
      const p = await makeProduct(db, C.id, C.loc1, "ConIVA", 1, 100, 50);

      await openSession(cashier, C.loc1);
      const sale = await asUser(db, cashier, () =>
        createSale(db, [{ product_id: p, qty: 3, unit_price: 100 }], C.loc1),
      );
      const [item] = await saleItems(sale.sale_id);

      await doReturn(cashier, sale.sale_id, item.id, 1, C.loc1);
      await doReturn(cashier, sale.sale_id, item.id, 2, C.loc1);
      const sum = (
        await db.query<{ t: string }>(
          "select sum(total) as t from public.returns where sale_id=$1",
          [sale.sale_id],
        )
      ).rows[0].t;

      expect(Number(sum)).toBeCloseTo(Number(sale.total), 2);
    });
  });

  // ---------------------------------------------------------------- 4 y 5
  describe("4 y 5. devoluciones: la asignación del producto y la autorización de crédito", () => {
    it("4. una devolución no reactiva una asignación que el admin apagó", async () => {
      const C = await makeCompany(db, "Puerta 4");
      const cashier = await makeUser(db, C.id, "user");
      const p = await makeProduct(db, C.id, C.loc1, "P", 1, 10, 10);

      await openSession(cashier, C.loc1);
      const sale = await asUser(db, cashier, () =>
        createSale(db, [{ product_id: p, qty: 2, unit_price: 10 }], C.loc1),
      );
      const [item] = await saleItems(sale.sale_id);

      await db.query(
        "update public.product_locations set is_active=false where product_id=$1 and location_id=$2",
        [p, C.loc1],
      );
      await doReturn(cashier, sale.sale_id, item.id, 1, null);
      const row = (
        await db.query<{ is_active: boolean; stock: string }>(
          "select is_active, stock from public.product_locations where product_id=$1 and location_id=$2",
          [p, C.loc1],
        )
      ).rows[0];

      expect(row.is_active).toBe(false);
      expect(Number(row.stock)).toBe(9); // 10 - 2 vendidas + 1 devuelta: el stock sí vuelve
    });

    it("4. un cajero no devuelve a otra sucursal; el administrador sí; el flujo normal sigue igual", async () => {
      const C = await makeCompany(db, "Puerta 4b");
      const admin = await makeUser(db, C.id, "admin");
      const cashier = await makeUser(db, C.id, "user");
      const p = await makeProduct(db, C.id, C.loc1, "P", 1, 10, 10);

      await openSession(cashier, C.loc1);
      const sale = await asUser(db, cashier, () =>
        createSale(db, [{ product_id: p, qty: 3, unit_price: 10 }], C.loc1),
      );
      const [item] = await saleItems(sale.sale_id);

      expect(
        await rejects(() =>
          doReturn(cashier, sale.sale_id, item.id, 1, C.loc2, false),
        ),
      ).toMatch(/sucursal de la venta/i);
      // normal: sin sucursal o con la de la venta
      await doReturn(cashier, sale.sale_id, item.id, 1, null);
      await doReturn(cashier, sale.sale_id, item.id, 1, C.loc1);
      // administrador: puede elegir otra
      expect(
        await rejects(() =>
          doReturn(admin, sale.sale_id, item.id, 1, C.loc2, false),
        ),
      ).toBeNull();
    });

    it("5. tras devolver, la autorización de crédito/puntos NO queda encendida en la transacción", async () => {
      const C = await makeCompany(db, "Puerta 5");
      const cashier = await makeUser(db, C.id, "user");
      const p = await makeProduct(db, C.id, C.loc1, "P", 1, 10, 50);
      const customer = await makeCustomer(db, C.id, "Cli");

      await db.query(
        "update public.customers set credit_balance=500, credit_limit=1000 where id=$1",
        [customer],
      );
      await openSession(cashier, C.loc1);
      const sale = await asUser(db, cashier, () =>
        createSale(
          db,
          [{ product_id: p, qty: 2, unit_price: 10 }],
          C.loc1,
          undefined,
          {
            customerId: customer,
          },
        ),
      );
      const [item] = await saleItems(sale.sale_id);

      const err = await asUser(db, cashier, () =>
        rejects(async () => {
          await db.exec("begin");
          try {
            await db.query("select create_return($1,'x',$2::jsonb,$3,true)", [
              sale.sale_id,
              JSON.stringify([{ sale_item_id: item.id, qty: 1 }]),
              C.loc1,
            ]);
            await db.query(
              "update public.customers set credit_balance=0, credit_limit=99999, loyalty_points=100000 where id=$1",
              [customer],
            );
            await db.exec("commit");
          } catch (e) {
            await db.exec("rollback");
            throw e;
          }
        }),
      );

      expect(err).toMatch(
        /solo se modifican mediante una venta o un cobro|limite de credito/i,
      );
      const row = (
        await db.query<{ credit_limit: string; loyalty_points: string }>(
          "select credit_limit, loyalty_points from public.customers where id=$1",
          [customer],
        )
      ).rows[0];

      expect(Number(row.credit_limit)).toBe(1000);
      expect(Number(row.loyalty_points)).toBe(0);
    });
  });

  // ---------------------------------------------------------------- 6
  describe("6. lectura por rol", () => {
    let C: TestCompany;
    let admin: string;
    let cashier: string;
    let operador: string;
    let granted: string;

    beforeAll(async () => {
      C = await makeCompany(db, "Puerta 6");
      admin = await makeUser(db, C.id, "admin");
      cashier = await makeUser(db, C.id, "user");
      operador = await makeUser(db, C.id, "operador");
      granted = await makeUser(db, C.id, "user");
      await db.query(
        "update public.profiles set allowed_sections=array['/proveedores','/pos'] where id=$1",
        [granted],
      );
      const customer = await makeCustomer(db, C.id, "Cli");
      const p = await makeProduct(db, C.id, C.loc1, "P", 1, 10, 50);

      await db.query(
        "insert into public.suppliers (company_id, name) values ($1,'Prov')",
        [C.id],
      );
      await db.query(
        "insert into public.loyalty_ledger (company_id, customer_id, points, type) values ($1,$2,5,'earned')",
        [C.id, customer],
      );
      await db.query(
        "insert into public.customer_credit_payments (company_id, customer_id, amount, method) values ($1,$2,5,'Efectivo')",
        [C.id, customer],
      );
      await db.query(
        "insert into public.quote_requests (company_id, customer_name, phone, email) values ($1,'Visitante','555','a@b.c')",
        [C.id],
      );
      await asUser(db, cashier, () =>
        db.query("select create_quote($1::jsonb,null,null,$2,null)", [
          JSON.stringify([{ product_id: p, qty: 1 }]),
          C.loc1,
        ]),
      );
    });

    const count = (uid: string, table: string) =>
      asUser(db, uid, () =>
        db.query<{ n: string }>(`select count(*) as n from public.${table}`),
      ).then((r) => Number(r.rows[0].n));

    it("el operador no lee cotizaciones, solicitudes, cobros de crédito ni puntos", async () => {
      for (const t of [
        "quotes",
        "quote_items",
        "quote_requests",
        "customer_credit_payments",
        "loyalty_ledger",
      ]) {
        expect(await count(operador, t), t).toBe(0);
      }
    });

    it("CONTROL: el administrador y el cajero siguen leyéndolas", async () => {
      expect(await count(admin, "loyalty_ledger")).toBe(1);
      expect(await count(admin, "customer_credit_payments")).toBe(1);
      expect(await count(admin, "quote_requests")).toBe(1);
      expect(await count(cashier, "quotes")).toBe(1);
    });

    it("el cajero no lee proveedores salvo que el admin le otorgó /proveedores", async () => {
      expect(await count(cashier, "suppliers")).toBe(0);
      expect(await count(granted, "suppliers")).toBe(1);
      expect(await count(operador, "suppliers")).toBe(1);
      expect(await count(admin, "suppliers")).toBe(1);
    });
  });

  // ---------------------------------------------------------------- 7
  describe("7. la comisión del vendedor no la lee un compañero", () => {
    it("el vendedor y el admin la leen; otro cajero no; la devolución la baja", async () => {
      const C = await makeCompany(db, "Puerta 7");
      const admin = await makeUser(db, C.id, "admin");
      const sellerB = await makeUser(db, C.id, "user");
      const peerA = await makeUser(db, C.id, "user");
      const p = await makeProduct(db, C.id, C.loc1, "P", 1, 100, 50);

      await asUser(db, admin, () =>
        db.query("select set_employee_commission($1, 0.05)", [sellerB]),
      );
      await openSession(sellerB, C.loc1);
      const sale = await asUser(db, sellerB, () =>
        createSale(db, [{ product_id: p, qty: 2, unit_price: 100 }], C.loc1),
      );
      const read = (uid: string) =>
        asUser(db, uid, () =>
          db.query<{ commission_amount: string }>(
            "select commission_amount from public.sale_commissions where sale_id=$1",
            [sale.sale_id],
          ),
        );

      expect(
        Number((await read(sellerB)).rows[0].commission_amount),
      ).toBeCloseTo(10, 2);
      expect(Number((await read(admin)).rows[0].commission_amount)).toBeCloseTo(
        10,
        2,
      );
      expect((await read(peerA)).rows).toHaveLength(0);

      // ya no existe como columna de sales (que lee toda la sucursal)
      const err = await asUser(db, peerA, () =>
        rejects(() =>
          db.query("select commission_amount from public.sales where id=$1", [
            sale.sale_id,
          ]),
        ),
      );

      expect(err).toMatch(/commission_amount/i);
      // un compañero tampoco puede escribirla
      const writeErr = await asUser(db, peerA, () =>
        rejects(() =>
          db.query(
            "update public.sale_commissions set commission_amount=999 where sale_id=$1",
            [sale.sale_id],
          ),
        ),
      );
      const after = await db.query<{ commission_amount: string }>(
        "select commission_amount from public.sale_commissions where sale_id=$1",
        [sale.sale_id],
      );

      void writeErr;
      expect(Number(after.rows[0].commission_amount)).toBeCloseTo(10, 2);

      const [item] = await saleItems(sale.sale_id);

      await doReturn(sellerB, sale.sale_id, item.id, 1, C.loc1);
      expect(
        Number((await read(sellerB)).rows[0].commission_amount),
      ).toBeCloseTo(5, 2);
    });
  });

  // ---------------------------------------------------------------- 8 y 9
  describe("8 y 9. textos acotados", () => {
    it("8. log_voided_sale: el motivo relleno de espacios queda acotado en la bitácora", async () => {
      const C = await makeCompany(db, "Puerta 8");
      const cashier = await makeUser(db, C.id, "user");
      const p = await makeProduct(db, C.id, C.loc1, "P", 1, 10, 50);

      await openSession(cashier, C.loc1);
      const padded = "ok" + " ".repeat(300_000);
      const voidedId = (
        await asUser(db, cashier, () =>
          db.query<{ v: string }>(
            "select log_voided_sale($1::jsonb,$2,$3) as v",
            [JSON.stringify([{ product_id: p, qty: 1 }]), C.loc1, padded],
          ),
        )
      ).rows[0].v;
      const len = (
        await db.query<{ n: string }>(
          "select length(detail::text) as n from public.audit_log where entity_id=$1 and entity_type='voided_sale'",
          [voidedId],
        )
      ).rows[0].n;

      expect(Number(len)).toBeLessThan(500);
    });

    it("9. correo del perfil, sucursal y proveedores no aceptan megabytes; lo normal sí", async () => {
      const C = await makeCompany(db, "Puerta 9");
      const cashier = await makeUser(db, C.id, "user");
      const fin = await makeUser(db, C.id, "finanzas");
      const big = "x".repeat(200_000);

      expect(
        await asUser(db, cashier, () =>
          rejects(() =>
            db.query("update public.profiles set email=$2 where id=$1", [
              cashier,
              big,
            ]),
          ),
        ),
      ).toMatch(/profiles_email_len_chk/i);
      expect(
        await asUser(db, cashier, () =>
          rejects(() =>
            db.query("update public.locations set city=$2 where id=$1", [
              C.loc1,
              big,
            ]),
          ),
        ),
      ).toMatch(/locations_city_len_chk/i);
      expect(
        await asUser(db, fin, () =>
          rejects(() =>
            db.query(
              "insert into public.suppliers (company_id, name, document_number) values ($1,'P',$2)",
              [C.id, big],
            ),
          ),
        ),
      ).toMatch(/suppliers_document_number_len_chk/i);
      // CONTROL: valores normales
      expect(
        await asUser(db, fin, () =>
          rejects(() =>
            db.query(
              "insert into public.suppliers (company_id, name, document_number) values ($1,'Proveedor','RFC123')",
              [C.id],
            ),
          ),
        ),
      ).toBeNull();
      expect(
        await asUser(db, cashier, () =>
          rejects(() =>
            db.query("update public.locations set city='Lima' where id=$1", [
              C.loc1,
            ]),
          ),
        ),
      ).toBeNull();
    });
  });
});

// ============================================================ puertas "por validar"
describe("9ª pasada: los 9 por validar", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDb();
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("A. filas viejas con textos largos NO rompen la venta a crédito y el instalador las recorta", async () => {
    const C = await makeCompany(db, "Legado largo");
    const cashier = await makeUser(db, C.id, "user");
    const p = await makeProduct(db, C.id, C.loc1, "P", 1, 10, 50);
    const customer = await makeCustomer(db, C.id, "Cli");

    // base "vieja": sin topes, con un cliente de nombre y dirección enormes
    for (const c of ["customers_name_len_chk", "customers_address_len_chk"]) {
      await db.query(`alter table public.customers drop constraint ${c}`);
    }
    await db.query(
      "update public.customers set name=$2, address=$3, credit_limit=1000 where id=$1",
      [customer, "N".repeat(500), "D".repeat(900)],
    );
    // se vuelve a correr el instalador (como hace el dueño al actualizar)
    const { readFileSync } = await import("node:fs");

    await db.exec(readFileSync("supabase/install/01_install.sql", "utf-8"));
    const row = (
      await db.query<{ n: number; a: number }>(
        "select char_length(name) n, char_length(address) a from public.customers where id=$1",
        [customer],
      )
    ).rows[0];

    expect(row.n).toBe(200);
    expect(row.a).toBe(300);
    await db.query("select 1");
    await asUser(db, cashier, () =>
      db.query("select open_cash_session(0,$1)", [C.loc1]),
    );
    const sale = await asUser(db, cashier, () =>
      createSale(
        db,
        [{ product_id: p, qty: 1, unit_price: 10 }],
        C.loc1,
        undefined,
        {
          customerId: customer,
          payments: [{ method: "Crédito", amount: 10, kind: "credit" }],
        },
      ),
    );

    expect(Number(sale.total)).toBeCloseTo(10, 2);
    // el tope sigue vigente para lo nuevo
    expect(
      await rejects(() =>
        db.query("update public.customers set name=$2 where id=$1", [
          customer,
          "x".repeat(201),
        ]),
      ),
    ).toMatch(/customers_name_len_chk/i);
  }, 120_000);

  it("B. un movimiento de caja viejo con signo inválido NO aborta el instalador", async () => {
    const C = await makeCompany(db, "Legado caja");
    const cashier = await makeUser(db, C.id, "user");
    const { readFileSync } = await import("node:fs");

    const session = (
      await asUser(db, cashier, () =>
        db.query<{ s: string }>("select open_cash_session(0,$1) as s", [
          C.loc1,
        ]),
      )
    ).rows[0].s;

    await db.exec(
      "alter table public.cash_movements drop constraint cash_movements_type_sign_chk",
    );
    await db.exec(
      "alter table public.cash_movements disable trigger cash_movements_set_location",
    );
    await db.query(
      "insert into public.cash_movements (company_id, cash_session_id, movement_type, concept, amount) values ($1,$2,'ingreso','viejo',-50)",
      [C.id, session],
    );
    await db.exec(
      "alter table public.cash_movements enable trigger cash_movements_set_location",
    );

    expect(
      await rejects(() =>
        db.exec(readFileSync("supabase/install/01_install.sql", "utf-8")),
      ),
    ).toBeNull();
    const loc = (
      await db.query<{ location_id: string | null }>(
        "select location_id from public.cash_movements where concept='viejo'",
      )
    ).rows[0].location_id;

    expect(loc).toBe(C.loc1); // el relleno de sucursal sí se hizo
  }, 120_000);

  it("C. filas marcadas como demo por un inquilino dentro de una empresa normal se desmarcan", async () => {
    const C = await makeCompany(db, "Empresa real");
    const customer = await makeCustomer(db, C.id, "Cli");
    const { readFileSync } = await import("node:fs");

    await db.query(
      "update public.customers set is_demo_data=true where id=$1",
      [customer],
    );
    await db.exec(readFileSync("supabase/install/01_install.sql", "utf-8"));
    const flag = (
      await db.query<{ is_demo_data: boolean }>(
        "select is_demo_data from public.customers where id=$1",
        [customer],
      )
    ).rows[0].is_demo_data;

    expect(flag).toBe(false);
  }, 120_000);

  it("D. venta a crédito contra un cliente archivado se rechaza aunque el chequeo previo pasara", async () => {
    const C = await makeCompany(db, "Archivado");
    const cashier = await makeUser(db, C.id, "user");
    const p = await makeProduct(db, C.id, C.loc1, "P", 1, 10, 50);
    const customer = await makeCustomer(db, C.id, "Cli");

    await db.query(
      "update public.customers set credit_limit=1000 where id=$1",
      [customer],
    );
    await asUser(db, cashier, () =>
      db.query("select open_cash_session(0,$1)", [C.loc1]),
    );
    // control: cliente activo, venta a crédito normal
    await asUser(db, cashier, () =>
      createSale(
        db,
        [{ product_id: p, qty: 1, unit_price: 10 }],
        C.loc1,
        undefined,
        {
          customerId: customer,
          payments: [{ method: "Crédito", amount: 10, kind: "credit" }],
        },
      ),
    );
    await db.query("update public.customers set deleted_at=now() where id=$1", [
      customer,
    ]);
    const err = await asUser(db, cashier, () =>
      rejects(() =>
        createSale(
          db,
          [{ product_id: p, qty: 1, unit_price: 10 }],
          C.loc1,
          undefined,
          {
            customerId: customer,
            payments: [{ method: "Crédito", amount: 10, kind: "credit" }],
          },
        ),
      ),
    );

    expect(err).toMatch(/archivado|no encontrado/i);
    // La carrera real (archivar entre el chequeo y el candado) necesita dos conexiones; aquí se
    // comprueba que cada candado de crédito vuelve a exigir que el cliente siga activo.
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/install/01_install.sql", "utf-8");
    const lastSale = sql.lastIndexOf(
      "create or replace function public.create_sale(",
    );
    const saleBody = sql.slice(
      lastSale,
      sql.indexOf("\n$function$;", lastSale),
    );
    const lastConv = sql.lastIndexOf(
      "create or replace function public.convert_quote_to_sale(",
    );
    const convBody = sql.slice(lastConv, sql.indexOf("\n$$;", lastConv));
    const locks = (b: string) =>
      b.match(/select credit_limit, credit_balance[^;]*for update;/g) ?? [];

    expect(locks(saleBody)).toHaveLength(2);
    expect(locks(convBody)).toHaveLength(1);
    for (const l of [...locks(saleBody), ...locks(convBody)]) {
      expect(l).toMatch(/deleted_at is null/);
    }
    const bal = (
      await db.query<{ b: string }>(
        "select credit_balance b from public.customers where id=$1",
        [customer],
      )
    ).rows[0].b;

    expect(Number(bal)).toBeCloseTo(10, 2); // solo la venta previa
  }, 120_000);

  it("E. create_return bloquea la venta antes de leer lo devuelto (la carrera de comisión queda serializada)", async () => {
    const { readFileSync } = await import("node:fs");
    const sql = readFileSync("supabase/install/01_install.sql", "utf-8");
    const i = sql.lastIndexOf(
      "create or replace function public.create_return(",
    );
    const body = sql.slice(i, sql.indexOf("\n$$;", i));
    const lockAt = body.indexOf("deleted_at is null for update;");
    const readAt = body.indexOf("from public.return_items ri");

    expect(lockAt).toBeGreaterThan(0);
    expect(lockAt).toBeLessThan(readAt);
    // y devolver líneas distintas de una venta sin cliente sigue bajando la comisión al cero
    const C = await makeCompany(db, "Carrera");
    const admin = await makeUser(db, C.id, "admin");
    const cashier = await makeUser(db, C.id, "user");
    const a = await makeProduct(db, C.id, C.loc1, "A", 1, 100, 50);
    const b = await makeProduct(db, C.id, C.loc1, "B", 1, 100, 50);

    await asUser(db, admin, () =>
      db.query("select set_employee_commission($1, 0.1)", [cashier]),
    );
    await asUser(db, cashier, () =>
      db.query("select open_cash_session(0,$1)", [C.loc1]),
    );
    const sale = await asUser(db, cashier, () =>
      createSale(
        db,
        [
          { product_id: a, qty: 1, unit_price: 100 },
          { product_id: b, qty: 1, unit_price: 100 },
        ],
        C.loc1,
      ),
    );
    const items = (
      await db.query<{ id: string }>(
        "select id from public.sale_items where sale_id=$1 order by id",
        [sale.sale_id],
      )
    ).rows;

    for (const it of items) {
      await asUser(db, cashier, () =>
        db.query("select create_return($1,'x',$2::jsonb,$3,true)", [
          sale.sale_id,
          JSON.stringify([{ sale_item_id: it.id, qty: 1 }]),
          C.loc1,
        ]),
      );
    }
    const c = (
      await db.query<{ commission_amount: string }>(
        "select commission_amount from public.sale_commissions where sale_id=$1",
        [sale.sale_id],
      )
    ).rows[0].commission_amount;

    expect(Number(c)).toBe(0);
  }, 120_000);
});
