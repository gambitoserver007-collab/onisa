// Auditoría de seguridad 2026-10 (7ª pasada): los 12 hallazgos confirmados.
//   1  cash_movements sin sucursal visibles para empleados de otras sucursales
//   2  devolución: los puntos ya gastados se perdían del recorte (puntos regalados)
//   3  devolución: el gasto anual del cliente (nivel de lealtad) no se deshacía
//   4  devolución: la comisión del vendedor no se deshacía
//   5  cliente archivado: se le podía cargar crédito (deuda oculta)
//   6  asistencia y faltas/vacaciones legibles por cualquier rol
//   7  trigger de límite de plan: oráculo de la capacidad de OTRA empresa
//   8  log_voided_sale sin revisar la sucursal del empleado
//   9  convert_quote_to_sale vendía una variante ya retirada
//  10  normalize_cart_items no unía el mismo id escrito distinto
//  11  register_merma aceptaba la pérdida que mandara el cajero
//  12  lectura por rol: almacenista y arqueo ciego en la API, no solo en el menú
// Cada puerta trae CONTROLES: lo legítimo sigue funcionando.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asUser,
  authorizeCashSession,
  createSale,
  createTestDb,
  errMessage,
  finishTillCount,
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

async function rejects(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();

    return null;
  } catch (err) {
    return errMessage(err);
  }
}

describe("7ª pasada: los 12 confirmados", () => {
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

  const restrictTo = (profile: string, company: string, loc: string) =>
    db.query(
      "insert into public.profile_locations (profile_id, location_id, company_id) values ($1,$2,$3)",
      [profile, loc, company],
    );

  const saleItem = async (saleId: string) =>
    (
      await db.query<{ id: string; qty: string }>(
        "select id, qty from public.sale_items where sale_id=$1",
        [saleId],
      )
    ).rows[0];

  const doReturn = (
    uid: string,
    saleId: string,
    item: { id: string },
    qty: number,
    loc: string,
  ) =>
    asUser(db, uid, () =>
      db.query("select create_return($1,'x',$2::jsonb,$3,true) as r", [
        saleId,
        JSON.stringify([{ sale_item_id: item.id, qty }]),
        loc,
      ]),
    );

  // ---------------------------------------------------------------- 1
  describe("1. movimientos de caja: la sucursal es la de su caja", () => {
    let C: TestCompany;
    let admin: string;
    let cashierB: string;
    let restricted: string;
    let restrictedB: string;

    beforeAll(async () => {
      C = await makeCompany(db, "Puerta 1");
      admin = await makeUser(db, C.id, "admin");
      cashierB = await makeUser(db, C.id, "user");
      restricted = await makeUser(db, C.id, "user");
      restrictedB = await makeUser(db, C.id, "user");
      await restrictTo(restricted, C.id, C.loc1);
      await restrictTo(restrictedB, C.id, C.loc2);
      const session = await openSession(cashierB, C.loc2, 50);

      await asUser(db, cashierB, () =>
        db.query(
          `insert into public.cash_movements
             (company_id, cash_session_id, movement_type, concept, amount)
           values ($1,$2,'egreso','retiro secreto',-500)`,
          [C.id, session],
        ),
      );
    });

    it("el movimiento manual queda con la sucursal de su caja (antes NULL)", async () => {
      const { rows } = await db.query<{ location_id: string | null }>(
        "select location_id from public.cash_movements where concept='retiro secreto'",
      );

      expect(rows[0].location_id).toBe(C.loc2);
    });

    it("un empleado restringido a OTRA sucursal ya no lo lee", async () => {
      const rows = (
        await asUser(db, restricted, () =>
          db.query("select concept from public.cash_movements"),
        )
      ).rows;

      expect(rows).toHaveLength(0);
    });

    it("CONTROL: quien trabaja en esa sucursal, y el admin, sí lo leen", async () => {
      const own = (
        await asUser(db, restrictedB, () =>
          db.query("select concept from public.cash_movements"),
        )
      ).rows;
      const all = (
        await asUser(db, admin, () =>
          db.query("select concept from public.cash_movements"),
        )
      ).rows;

      expect(own).toHaveLength(1);
      expect(all).toHaveLength(1);
    });
  });

  // ------------------------------------------------------- 2, 3 y 4
  describe("2-4. devoluciones: puntos, gasto anual y comisión", () => {
    let C: TestCompany;
    let admin: string;
    let cashier: string;
    let p1000: string;
    let p200: string;

    const points = async (customer: string) =>
      Number(
        (
          await db.query<{ loyalty_points: string }>(
            "select loyalty_points from public.customers where id=$1",
            [customer],
          )
        ).rows[0].loyalty_points,
      );

    const yearSpend = async (customer: string) =>
      Number(
        (
          await db.query<{ loyalty_year_spend: string }>(
            "select loyalty_year_spend from public.customers where id=$1",
            [customer],
          )
        ).rows[0].loyalty_year_spend,
      );

    beforeAll(async () => {
      C = await makeCompany(db, "Puertas 2-4");
      admin = await makeUser(db, C.id, "admin");
      cashier = await makeUser(db, C.id, "user");
      await setLoyaltySettings(db, C.id, {
        enabled: true,
        pointValue: 0.1,
        earnRate: 10,
      });
      await setLoyaltyTiers(db, C.id, {
        enabled: true,
        tier2Min: 1000,
        tier3Min: 5000,
        tier1Rate: 10,
        tier2Rate: 5,
        tier3Rate: 2,
      });
      p1000 = await makeProduct(db, C.id, C.loc1, "Caro", 1, 1000, 50);
      p200 = await makeProduct(db, C.id, C.loc1, "Medio", 1, 200, 50);
      await asUser(db, admin, () =>
        db.query("select set_employee_commission($1, 0.10)", [cashier]),
      );
      await openSession(cashier, C.loc1);
    });

    const sell = (
      product: string,
      customer: string | null,
      pointsRedeemed = 0,
    ) =>
      asUser(db, cashier, () =>
        createSale(
          db,
          [{ product_id: product, qty: 1, unit_price: 0 }],
          C.loc1,
          undefined,
          { customerId: customer, pointsRedeemed },
        ),
      );

    it("2. vender A, canjear en B, devolver A y B: el cliente termina SIN puntos regalados", async () => {
      const customer = await makeCustomer(db, C.id, "Cliente 2", 0);
      const a = await sell(p1000, customer);

      expect(await points(customer)).toBe(100);

      const b = await sell(p200, customer, 100);

      expect(Number(b.points_redeemed)).toBe(100);

      const itemA = await saleItem(a.sale_id);
      const itemB = await saleItem(b.sale_id);

      await doReturn(cashier, a.sale_id, itemA, 1, C.loc1);
      await doReturn(cashier, b.sale_id, itemB, 1, C.loc1);

      expect(await points(customer)).toBe(0);
    });

    it("2. el saldo negativo (puntos que debe) no se puede canjear y lo que gane después lo salda", async () => {
      const customer = await makeCustomer(db, C.id, "Cliente 2b", 0);
      const a = await sell(p1000, customer);
      const b = await sell(p200, customer, 100);
      const itemA = await saleItem(a.sale_id);
      const beforeReturn = await points(customer);

      expect(beforeReturn).toBe(Number(b.points_earned)); // 100 ganados - 100 canjeados + lo de B

      await doReturn(cashier, a.sale_id, itemA, 1, C.loc1);

      // devolver A quita sus 100 puntos aunque ya se hubieran gastado
      const negative = beforeReturn - 100;

      expect(negative).toBeLessThan(0);
      expect(await points(customer)).toBe(negative);

      const c = await sell(p200, customer, 50);

      expect(Number(c.points_redeemed)).toBe(0);
      expect(Number(c.total)).toBe(200);
      expect(await points(customer)).toBe(negative + Number(c.points_earned));
      expect(Number(b.total)).toBe(190);
    });

    it("CONTROL 2: una venta normal devuelta deja los puntos como estaban", async () => {
      const customer = await makeCustomer(db, C.id, "Cliente 2c", 0);
      const a = await sell(p200, customer);

      expect(await points(customer)).toBeGreaterThan(0);
      await doReturn(cashier, a.sale_id, await saleItem(a.sale_id), 1, C.loc1);
      expect(await points(customer)).toBe(0);
    });

    it("3. devolver una venta deshace su gasto anual (y el nivel no se infla)", async () => {
      const customer = await makeCustomer(db, C.id, "Cliente 3", 0);
      const a = await sell(p1000, customer);

      expect(await yearSpend(customer)).toBe(1000);
      await doReturn(cashier, a.sale_id, await saleItem(a.sale_id), 1, C.loc1);
      expect(await yearSpend(customer)).toBe(0);

      // con el contador en cero, la siguiente compra vuelve a ganar con la tasa
      // base (10 -> 20 puntos por 200), no con la del nivel 2.
      const b = await sell(p200, customer);

      expect(Number(b.points_earned)).toBe(20);
    });

    it("3. una devolución parcial resta en proporción y sin pasarse (también en varias)", async () => {
      const customer = await makeCustomer(db, C.id, "Cliente 3b", 0);
      const sale = await asUser(db, cashier, () =>
        createSale(
          db,
          [{ product_id: p200, qty: 4, unit_price: 0 }],
          C.loc1,
          undefined,
          { customerId: customer },
        ),
      );
      const item = await saleItem(sale.sale_id);

      await doReturn(cashier, sale.sale_id, item, 1, C.loc1);
      expect(await yearSpend(customer)).toBeCloseTo(600, 2);
      await doReturn(cashier, sale.sale_id, item, 1, C.loc1);
      expect(await yearSpend(customer)).toBeCloseTo(400, 2);
      await doReturn(cashier, sale.sale_id, item, 2, C.loc1);
      expect(await yearSpend(customer)).toBe(0);
    });

    it("4. la comisión baja con lo devuelto: parcial -> proporcional, total -> cero", async () => {
      const sale = await asUser(db, cashier, () =>
        createSale(db, [{ product_id: p200, qty: 2, unit_price: 0 }], C.loc1),
      );
      const item = await saleItem(sale.sale_id);
      const commission = async () =>
        Number(
          (
            await db.query<{ commission_amount: string }>(
              "select commission_amount from public.sales where id=$1",
              [sale.sale_id],
            )
          ).rows[0].commission_amount,
        );

      expect(await commission()).toBeCloseTo(40, 2);
      await doReturn(cashier, sale.sale_id, item, 1, C.loc1);
      expect(await commission()).toBeCloseTo(20, 2);
      await doReturn(cashier, sale.sale_id, item, 1, C.loc1);
      expect(await commission()).toBe(0);
    });

    it("CONTROL 4: sin devolución la comisión se queda igual", async () => {
      const sale = await sell(p200, null);
      const { rows } = await db.query<{ c: string }>(
        "select commission_amount as c from public.sales where id=$1",
        [sale.sale_id],
      );

      expect(Number(rows[0].c)).toBeCloseTo(20, 2);
    });
  });

  // ---------------------------------------------------------------- 5
  describe("5. un cliente archivado no recibe ventas a crédito", () => {
    let C: TestCompany;
    let cashier: string;
    let product: string;

    beforeAll(async () => {
      C = await makeCompany(db, "Puerta 5");
      cashier = await makeUser(db, C.id, "user");
      product = await makeProduct(db, C.id, C.loc1, "P", 1, 100, 20);
      await openSession(cashier, C.loc1);
    });

    const creditSale = (customer: string) =>
      asUser(db, cashier, () =>
        createSale(
          db,
          [{ product_id: product, qty: 1, unit_price: 0 }],
          C.loc1,
          undefined,
          {
            customerId: customer,
            payments: [{ method: "Credito", amount: 100, kind: "credit" }],
          },
        ),
      );

    it("CONTROL: un cliente activo con crédito sí compra a crédito", async () => {
      const customer = await makeCustomer(db, C.id, "Activo", 0);

      await db.query(
        "update public.customers set credit_limit=1000 where id=$1",
        [customer],
      );
      expect(await rejects(() => creditSale(customer))).toBeNull();
    });

    it("archivar a un cliente sin deuda y venderle a crédito se rechaza (antes: deuda oculta)", async () => {
      const customer = await makeCustomer(db, C.id, "Archivado", 0);

      await db.query(
        "update public.customers set credit_limit=1000 where id=$1",
        [customer],
      );
      await asUser(db, cashier, () =>
        db.query("update public.customers set deleted_at=now() where id=$1", [
          customer,
        ]),
      );

      expect(await rejects(() => creditSale(customer))).toMatch(
        /Cliente no encontrado/i,
      );

      const { rows } = await db.query<{ credit_balance: string }>(
        "select credit_balance from public.customers where id=$1",
        [customer],
      );

      expect(Number(rows[0].credit_balance)).toBe(0);
    });

    it("una cotización de un cliente que luego se archivó no se convierte", async () => {
      const customer = await makeCustomer(db, C.id, "Archivado luego", 0);
      const q = await asUser(db, cashier, () =>
        db.query<{ q: { quote_id?: string; id?: string } }>(
          "select create_quote($1::jsonb,$2,null,$3) as q",
          [JSON.stringify([{ product_id: product, qty: 1 }]), customer, C.loc1],
        ),
      );
      const quoteId = (q.rows[0].q.quote_id ?? q.rows[0].q.id) as string;

      await db.query(
        "update public.customers set deleted_at=now() where id=$1",
        [customer],
      );
      expect(
        await rejects(() =>
          asUser(db, cashier, () =>
            db.query("select convert_quote_to_sale($1,$2,'Efectivo')", [
              quoteId,
              C.loc1,
            ]),
          ),
        ),
      ).toMatch(/archivado/i);
    });
  });

  // ---------------------------------------------------------------- 6
  describe("6. asistencia y faltas: solo admin, el propio empleado y (asistencia) gerente/finanzas", () => {
    let C: TestCompany;
    let admin: string;
    let cashier: string;
    let other: string;
    let finanzas: string;
    let finanzasA: string;

    beforeAll(async () => {
      C = await makeCompany(db, "Puerta 6");
      admin = await makeUser(db, C.id, "admin");
      cashier = await makeUser(db, C.id, "user");
      other = await makeUser(db, C.id, "user");
      finanzas = await makeUser(db, C.id, "finanzas");
      finanzasA = await makeUser(db, C.id, "finanzas");
      await restrictTo(finanzasA, C.id, C.loc1);
      await db.query(
        `insert into public.employee_time_events
           (company_id, profile_id, type, event_date, note, created_by)
         values ($1,$2,'absence',current_date,'cita medica',$3),
                ($1,$4,'vacation',current_date,'viaje',$3)`,
        [C.id, cashier, admin, other],
      );
      await db.query(
        `insert into public.employee_attendance
           (company_id, profile_id, location_id, check_in_at, status)
         values ($1,$2,$3,now(),'open'), ($1,$4,$5,now(),'open')`,
        [C.id, cashier, C.loc1, other, C.loc2],
      );
    });

    const events = (uid: string) =>
      asUser(db, uid, () =>
        db.query<{ note: string }>(
          "select note from public.employee_time_events",
        ),
      ).then((r) => r.rows.map((x) => x.note).sort());
    const attendance = (uid: string) =>
      asUser(db, uid, () =>
        db.query<{ location_id: string }>(
          "select location_id from public.employee_attendance",
        ),
      ).then((r) => r.rows.map((x) => x.location_id));

    it("CONTROL: el admin lee todo", async () => {
      expect(await events(admin)).toEqual(["cita medica", "viaje"]);
      expect(await attendance(admin)).toHaveLength(2);
    });

    it("un cajero solo ve SUS filas (antes: las de todos, con notas)", async () => {
      expect(await events(cashier)).toEqual(["cita medica"]);
      expect(await attendance(cashier)).toEqual([C.loc1]);
    });

    it("finanzas ve la asistencia de sus sucursales, pero no las notas ajenas", async () => {
      expect(await attendance(finanzas)).toHaveLength(2);
      expect(await attendance(finanzasA)).toEqual([C.loc1]);
      expect(await events(finanzas)).toEqual([]);
    });
  });

  // ---------------------------------------------------------------- 7
  describe("7. los triggers de límite no revelan la capacidad de otra empresa", () => {
    it("insertar un producto con el company_id de otra empresa da el MISMO error con o sin cupo; el administrador propio sí ve el límite", async () => {
      const tight = await makePlan(db, "P1", 1, 1, 100);
      const roomy = await makePlan(db, "P50", 50, 5, 100);
      const A = await makeCompany(db, "Atacante");
      const full = await makeCompany(db, "Llena", { planId: tight });
      const free = await makeCompany(db, "Con cupo", { planId: roomy });
      const own = await makeCompany(db, "Propia", { planId: tight });
      const cashierA = await makeUser(db, A.id, "user");
      const ownAdmin = await makeUser(db, own.id, "admin");

      await makeProduct(db, full.id, full.loc1, "Existente", 1, 1, 1);
      await makeProduct(db, own.id, own.loc1, "Existente", 1, 1, 1);

      const insert = (uid: string, company: string) =>
        rejects(() =>
          asUser(db, uid, () =>
            db.query(
              "insert into public.products (company_id, name, price) values ($1,'x',1)",
              [company],
            ),
          ),
        );

      const errFull = await insert(cashierA, full.id);
      const errFree = await insert(cashierA, free.id);

      expect(errFull).toMatch(/row-level security/i);
      expect(errFull).not.toMatch(/limite/i);
      expect(errFree).toMatch(/row-level security/i);
      // CONTROL: el administrador de la empresa llena SÍ recibe el mensaje del límite
      expect(await insert(ownAdmin, own.id)).toMatch(/limite de productos/i);
    });

    it("mover un perfil a una empresa llena no revela su límite de usuarios", async () => {
      const tight = await makePlan(db, "U1", 10, 1, 100);
      const A = await makeCompany(db, "Atacante 2");
      const full = await makeCompany(db, "Llena 2", { planId: tight });
      const cashierA = await makeUser(db, A.id, "user");

      await makeUser(db, full.id, "admin");

      const err = await rejects(() =>
        asUser(db, cashierA, () =>
          db.query("update public.profiles set company_id=$1 where id=$2", [
            full.id,
            cashierA,
          ]),
        ),
      );

      expect(err).not.toBeNull();
      expect(err).not.toMatch(/limite de usuarios/i);
    });
  });

  // ---------------------------------------------------------------- 8
  describe("8. log_voided_sale respeta la sucursal del empleado", () => {
    it("un cajero restringido no registra anulaciones en otra sucursal; en la suya sí", async () => {
      const C = await makeCompany(db, "Puerta 8");
      const cashier = await makeUser(db, C.id, "user");
      const product = await makeProduct(db, C.id, C.loc1, "P", 1, 100, 5);

      await restrictTo(cashier, C.id, C.loc1);

      const log = (loc: string) =>
        rejects(() =>
          asUser(db, cashier, () =>
            db.query("select log_voided_sale($1::jsonb,$2,'x')", [
              JSON.stringify([{ product_id: product, qty: 1 }]),
              loc,
            ]),
          ),
        );

      expect(await log(C.loc2)).toMatch(/acceso a esta sucursal/i);
      expect(await log(C.loc1)).toBeNull();

      const { rows } = await db.query<{ location_id: string }>(
        "select location_id from public.voided_sales where company_id=$1",
        [C.id],
      );

      expect(rows.map((r) => r.location_id)).toEqual([C.loc1]);
    });
  });

  // ---------------------------------------------------------------- 9
  describe("9. convertir una cotización no vende una variante retirada", () => {
    it("rechaza la variante retirada; CONTROL: la activa se vende y el stock del producto cuenta solo las activas", async () => {
      const C = await makeCompany(db, "Puerta 9");
      const admin = await makeUser(db, C.id, "admin");
      const cashier = await makeUser(db, C.id, "user");
      const product = await makeProduct(db, C.id, C.loc1, "Camisa", 5, 10, 10);
      const mk = (talla: string) => ({
        attributes: { Talla: talla },
        price_override: 20,
        cost_override: 8,
        locations: [{ location_id: C.loc1, stock: 5 }],
      });

      await asUser(db, admin, () =>
        db.query("select sync_product_variants($1,$2,$3::jsonb)", [
          product,
          ["Talla"],
          JSON.stringify([mk("S"), mk("L")]),
        ]),
      );

      const variants = (
        await db.query<{ id: string; attributes: { Talla: string } }>(
          "select id, attributes from public.product_variants where product_id=$1",
          [product],
        )
      ).rows;
      const vS = variants.find((v) => v.attributes.Talla === "S")!;
      const vL = variants.find((v) => v.attributes.Talla === "L")!;

      await openSession(cashier, C.loc1);

      const quote = async (variantId: string) => {
        const r = await asUser(db, cashier, () =>
          db.query<{ q: { quote_id?: string; id?: string } }>(
            "select create_quote($1::jsonb,null,null,$2) as q",
            [
              JSON.stringify([
                { product_id: product, variant_id: variantId, qty: 1 },
              ]),
              C.loc1,
            ],
          ),
        );

        return (r.rows[0].q.quote_id ?? r.rows[0].q.id) as string;
      };
      const convert = (quoteId: string) =>
        rejects(() =>
          asUser(db, cashier, () =>
            db.query("select convert_quote_to_sale($1,$2,'Efectivo')", [
              quoteId,
              C.loc1,
            ]),
          ),
        );

      const qL = await quote(vL.id);
      const qS = await quote(vS.id);

      // el admin deja solo la talla S
      await asUser(db, admin, () =>
        db.query("select sync_product_variants($1,$2,$3::jsonb)", [
          product,
          ["Talla"],
          JSON.stringify([
            {
              id: vS.id,
              attributes: { Talla: "S" },
              price_override: 20,
              cost_override: 8,
              locations: [{ location_id: C.loc1, stock: 5 }],
            },
          ]),
        ]),
      );

      expect(await convert(qL)).toMatch(/ya no esta disponible/i);

      const stockL = (
        await db.query<{ stock: string }>(
          "select stock from public.product_variant_locations where product_variant_id=$1",
          [vL.id],
        )
      ).rows[0].stock;

      expect(Number(stockL)).toBe(5); // no se tocó

      expect(await convert(qS)).toBeNull();

      const { rows } = await db.query<{ stock: string }>(
        "select stock from public.products where id=$1",
        [product],
      );

      expect(Number(rows[0].stock)).toBe(4); // solo la talla S activa: 5 - 1
    });
  });

  // --------------------------------------------------------------- 10
  describe("10. el mismo id escrito distinto se une en el carrito", () => {
    it("mayúsculas y minúsculas del mismo uuid dan el mismo total que una sola línea", async () => {
      const C = await makeCompany(db, "Puerta 10");
      const cashier = await makeUser(db, C.id, "user");
      const product = await makeProduct(db, C.id, C.loc1, "P", 0.1, 0.4, 100);

      const total = async (items: unknown[]) => {
        const r = await asUser(db, cashier, () =>
          db.query<{ q: { total?: number; quote_id?: string; id?: string } }>(
            "select create_quote($1::jsonb,null,null,$2) as q",
            [JSON.stringify(items), C.loc1],
          ),
        );
        const id = (r.rows[0].q.quote_id ?? r.rows[0].q.id) as string;
        const { rows } = await db.query<{ n: number; t: string }>(
          "select count(*)::int as n, sum(total) as t from public.quote_items where quote_id=$1",
          [id],
        );

        return { n: rows[0].n, t: Number(rows[0].t) };
      };

      const merged = await total([{ product_id: product, qty: 0.074 }]);
      const sameCase = await total([
        { product_id: product, qty: 0.037 },
        { product_id: product, qty: 0.037 },
      ]);
      const mixedCase = await total([
        { product_id: product, qty: 0.037 },
        { product_id: product.toUpperCase(), qty: 0.037 },
      ]);

      expect(merged).toEqual({ n: 1, t: 0.03 });
      expect(sameCase).toEqual({ n: 1, t: 0.03 });
      expect(mixedCase).toEqual({ n: 1, t: 0.03 });
    });
  });

  // --------------------------------------------------------------- 11
  describe("11. register_merma calcula la pérdida de un producto en el servidor", () => {
    let C: TestCompany;
    let admin: string;
    let cashier: string;
    let product: string;

    beforeAll(async () => {
      C = await makeCompany(db, "Puerta 11");
      admin = await makeUser(db, C.id, "admin");
      cashier = await makeUser(db, C.id, "user");
      product = await makeProduct(db, C.id, C.loc1, "P", 100, 150, 50);
    });

    const merma = (uid: string, qty: number, loss: number | null) =>
      asUser(db, uid, () =>
        db.query("select register_merma($1,'danado',null,$2,$3,$4,null)", [
          C.loc1,
          product,
          qty,
          loss,
        ]),
      );
    const lastLoss = async () =>
      Number(
        (
          await db.query<{ estimated_loss: string }>(
            "select estimated_loss from public.mermas where company_id=$1 order by created_at desc limit 1",
            [C.id],
          )
        ).rows[0].estimated_loss,
      );

    it("un cajero que manda pérdida 0 queda con costo x cantidad", async () => {
      await merma(cashier, 2, 0);
      expect(await lastLoss()).toBe(200);
    });

    it("CONTROL: la pérdida calculada normal y la del admin (override) se respetan", async () => {
      await merma(cashier, 1, null);
      expect(await lastLoss()).toBe(100);
      await merma(admin, 1, 30);
      expect(await lastLoss()).toBe(30);
    });

    it("CONTROL: una merma SIN producto conserva la pérdida que captura quien la registra", async () => {
      await asUser(db, cashier, () =>
        db.query(
          "select register_merma($1,'otro',null,null,null,45,'detalle')",
          [C.loc1],
        ),
      );
      expect(await lastLoss()).toBe(45);
    });
  });

  // --------------------------------------------------------------- 12
  describe("12. lectura por rol: almacenista y arqueo ciego", () => {
    let C: TestCompany;
    let admin: string;
    let cashier: string;
    let other: string;
    let operador: string;
    let finanzas: string;
    let sessionAuthorized: string;
    let sessionPending: string;

    beforeAll(async () => {
      C = await makeCompany(db, "Puerta 12");
      admin = await makeUser(db, C.id, "admin");
      cashier = await makeUser(db, C.id, "user");
      other = await makeUser(db, C.id, "user");
      operador = await makeUser(db, C.id, "operador");
      finanzas = await makeUser(db, C.id, "finanzas");
      const product = await makeProduct(db, C.id, C.loc1, "P", 1, 100, 20);

      await makeCustomer(db, C.id, "Cliente", 0);

      // corte de "other": cuenta, se cierra y el admin lo autoriza
      sessionAuthorized = await openSession(other, C.loc1, 50);
      await asUser(db, other, () =>
        createSale(
          db,
          [{ product_id: product, qty: 1, unit_price: 0 }],
          C.loc1,
        ),
      );
      await asUser(db, other, () =>
        submitTillCount(
          db,
          sessionAuthorized,
          [
            { denomination: 100, quantity: 1 },
            { denomination: 50, quantity: 1 },
          ],
          0,
        ),
      );
      await asUser(db, other, () => finishTillCount(db, sessionAuthorized));
      await asUser(db, admin, () =>
        authorizeCashSession(db, sessionAuthorized, null),
      );

      // corte del cajero principal: sigue abierto
      sessionPending = await openSession(cashier, C.loc1, 0);
    });

    it("el almacenista (operador) ya no lee clientes, ventas, cajas ni pagos por la API", async () => {
      for (const table of [
        "customers",
        "sales",
        "sale_items",
        "sale_payments",
        "cash_sessions",
        "cash_movements",
        "returns",
      ]) {
        const { rows } = await asUser(db, operador, () =>
          db.query<{ n: number }>(
            `select count(*)::int as n from public.${table}`,
          ),
        );

        expect(rows[0].n, table).toBe(0);
      }
    });

    it("CONTROL: el almacenista sigue leyendo productos y movimientos de stock", async () => {
      const prod = await asUser(db, operador, () =>
        db.query<{ n: number }>(
          "select count(*)::int as n from public.products",
        ),
      );
      const mov = await asUser(db, operador, () =>
        db.query<{ n: number }>(
          "select count(*)::int as n from public.stock_movements",
        ),
      );

      expect(prod.rows[0].n).toBeGreaterThan(0);
      expect(mov.rows[0].n).toBeGreaterThan(0);
    });

    it("un cajero no lee las cifras del corte autorizado de OTRA persona", async () => {
      const { rows } = await asUser(db, cashier, () =>
        db.query(
          "select expected_amount, real_amount, difference from public.cash_sessions where id=$1",
          [sessionAuthorized],
        ),
      );

      expect(rows).toHaveLength(0);
    });

    it("CONTROL: ve su propia caja abierta, quien la abrió ve su corte autorizado y admin/finanzas ven todos", async () => {
      const mine = await asUser(db, cashier, () =>
        db.query("select id from public.cash_sessions where id=$1", [
          sessionPending,
        ]),
      );
      const own = await asUser(db, other, () =>
        db.query<{ expected_amount: string }>(
          "select expected_amount from public.cash_sessions where id=$1",
          [sessionAuthorized],
        ),
      );
      const asAdmin = await asUser(db, admin, () =>
        db.query("select id from public.cash_sessions"),
      );
      const asFin = await asUser(db, finanzas, () =>
        db.query("select id from public.cash_sessions"),
      );

      expect(mine.rows).toHaveLength(1);
      expect(Number(own.rows[0].expected_amount)).toBe(150);
      expect(asAdmin.rows).toHaveLength(2);
      expect(asFin.rows).toHaveLength(2);
    });
  });
});
