// Auditoría de seguridad 2026-10 (8ª pasada): las puertas "por validar" que se cierran en
// el código. Cada una con CONTROLES (lo legítimo sigue funcionando).
import { readFileSync } from "node:fs";
import path from "node:path";
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
  makeProduct,
  makeUser,
  setLoyaltySettings,
  submitTillCount,
} from "./helpers/db";

const INSTALL = readFileSync(
  path.join(__dirname, "../supabase/install/01_install.sql"),
  "utf-8",
);

async function rejects(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();

    return null;
  } catch (err) {
    return errMessage(err);
  }
}

describe("8ª pasada: puertas por validar", () => {
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

  const scalar = async (sql: string, params: unknown[] = []) =>
    (await db.query<{ v: unknown }>(sql, params)).rows[0]?.v;

  // ------------------------------------------------------------ instalador
  describe("instalador: una sola transacción (salvo los valores del enum)", () => {
    it("solo queda UN begin/commit (el de los valores del enum) y los tres valores existen", async () => {
      const lines = INSTALL.split("\n");

      expect(lines.filter((l) => l === "begin;")).toHaveLength(1);
      expect(lines.filter((l) => l === "commit;")).toHaveLength(1);

      const { rows } = await db.query<{ enumlabel: string }>(
        "select enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='app_role'",
      );
      const labels = rows.map((r) => r.enumlabel);

      for (const l of ["finanzas", "operador", "gerente"]) {
        expect(labels).toContain(l);
      }
    });

    it("si algo falla al final de una re-corrida, NO queda nada a medias (las funciones no se degradan)", async () => {
      const body = () =>
        scalar(
          "select md5(pg_get_functiondef('public.can_write_company(uuid)'::regprocedure)) as v",
        );
      const policies = () =>
        scalar(
          "select count(*)::int as v from pg_policies where policyname in ('sales write scoped','sale_items write scoped')",
        );
      const before = { body: await body(), policies: await policies() };

      // Un error en la ÚLTIMA línea: antes, tras el 2º `commit` intermedio, las secciones
      // iniciales (funciones y políticas viejas) ya estaban confirmadas.
      const broken = INSTALL + "\nselect 1/0;\n";
      const err = await rejects(() => db.exec(broken));

      expect(err).toMatch(/division by zero/i);
      expect(await body()).toBe(before.body);
      expect(await policies()).toBe(before.policies);
      expect(before.policies).toBe(0);
    }, 120_000);
  });

  // ------------------------------------------------------ largo de textos
  describe("textos con largo máximo", () => {
    let C: Awaited<ReturnType<typeof makeCompany>>;
    let cashier: string;
    let product: string;

    beforeAll(async () => {
      C = await makeCompany(db, "Textos");
      cashier = await makeUser(db, C.id, "user");
      product = await makeProduct(db, C.id, C.loc1, "P", 1, 10, 50);
    });

    it("un cliente con nombre de 201 caracteres se rechaza; con 200 se acepta", async () => {
      const ins = (name: string) =>
        rejects(() =>
          asUser(db, cashier, () =>
            db.query(
              "insert into public.customers (company_id, name) values ($1,$2)",
              [C.id, name],
            ),
          ),
        );

      expect(await ins("N".repeat(201))).toMatch(/len_chk|check/i);
      expect(await ins("N".repeat(200))).toBeNull();
    });

    it("el concepto de un movimiento de caja (501) y el nombre propio (201) se rechazan", async () => {
      const session = await openSession(cashier, C.loc1);
      const concept = (c: string) =>
        rejects(() =>
          asUser(db, cashier, () =>
            db.query(
              "insert into public.cash_movements (company_id, cash_session_id, movement_type, concept, amount) values ($1,$2,'ingreso',$3,1)",
              [C.id, session, c],
            ),
          ),
        );
      const rename = (n: string) =>
        rejects(() =>
          asUser(db, cashier, () =>
            db.query("update public.profiles set full_name=$1 where id=$2", [
              n,
              cashier,
            ]),
          ),
        );

      expect(await concept("c".repeat(501))).toMatch(/len_chk|check/i);
      expect(await concept("c".repeat(500))).toBeNull();
      expect(await rename("x".repeat(201))).toMatch(/len_chk|check/i);
      expect(await rename("Nombre normal")).toBeNull();
    });

    it("un método de pago de 101 caracteres en una venta se rechaza; CONTROL: una venta normal pasa", async () => {
      const sell = (method: string) =>
        rejects(() =>
          asUser(db, cashier, () =>
            createSale(
              db,
              [{ product_id: product, qty: 1, unit_price: 0 }],
              C.loc1,
              undefined,
              { paymentMethod: method },
            ),
          ),
        );

      expect(await sell("M".repeat(101))).toMatch(/len_chk|check/i);
      expect(await sell("Efectivo")).toBeNull();
    });
  });

  // ------------------------------------------------- marca is_demo_data
  describe("is_demo_data lo fija el servidor", () => {
    it("un miembro no marca como demo sus filas ni su empresa; la plataforma sí", async () => {
      const C = await makeCompany(db, "Marca demo");
      const admin = await makeUser(db, C.id, "admin");
      const cashier = await makeUser(db, C.id, "user");
      const product = await makeProduct(db, C.id, C.loc1, "P", 1, 10, 5);
      const customer = await makeCustomer(db, C.id, "Cli", 0);
      const flag = async (sql: string, id: string) =>
        (await db.query<{ v: boolean }>(sql, [id])).rows[0].v;

      await asUser(db, admin, () =>
        db.query("update public.products set is_demo_data=true where id=$1", [
          product,
        ]),
      );
      await asUser(db, cashier, () =>
        db.query("update public.customers set is_demo_data=true where id=$1", [
          customer,
        ]),
      );
      await asUser(db, admin, () =>
        db.query("update public.companies set is_demo_data=true where id=$1", [
          C.id,
        ]),
      );
      expect(
        await flag(
          "select is_demo_data as v from public.products where id=$1",
          product,
        ),
      ).toBe(false);
      expect(
        await flag(
          "select is_demo_data as v from public.customers where id=$1",
          customer,
        ),
      ).toBe(false);
      expect(
        await flag(
          "select is_demo_data as v from public.companies where id=$1",
          C.id,
        ),
      ).toBe(false);

      // insertar con la marca encendida tampoco la deja
      await asUser(db, admin, () =>
        db.query(
          "insert into public.suppliers (company_id, name, is_demo_data) values ($1,'Prov',true)",
          [C.id],
        ),
      );
      expect(
        (
          await db.query<{ v: boolean }>(
            "select is_demo_data as v from public.suppliers where company_id=$1",
            [C.id],
          )
        ).rows[0].v,
      ).toBe(false);

      // CONTROL: el dueño de la plataforma (proceso de servicio, sin sesión) sí la fija
      await db.query(
        "update public.products set is_demo_data=true where id=$1",
        [product],
      );
      expect(
        await flag(
          "select is_demo_data as v from public.products where id=$1",
          product,
        ),
      ).toBe(true);
    });
  });

  // -------------------------------------------- sesiones al revocar
  describe("revoke_user_sessions", () => {
    it("solo service_role la ejecuta y borra las sesiones y tokens de ESA cuenta", async () => {
      const C = await makeCompany(db, "Sesiones");
      const victim = await makeUser(db, C.id, "user");
      const other = await makeUser(db, C.id, "user");

      for (const [uid, tokens] of [
        [victim, 2],
        [other, 1],
      ] as const) {
        const s = (
          await db.query<{ id: string }>(
            "insert into auth.sessions (user_id) values ($1) returning id",
            [uid],
          )
        ).rows[0].id;

        for (let i = 0; i < tokens; i++) {
          await db.query(
            "insert into auth.refresh_tokens (user_id, session_id) values ($1,$2)",
            [uid, s],
          );
        }
      }

      const denied = await rejects(() =>
        asUser(db, victim, () =>
          db.query("select public.revoke_user_sessions($1)", [victim]),
        ),
      );

      expect(denied).toMatch(/permission denied/i);

      await db.exec("set role service_role");
      await db.query("select public.revoke_user_sessions($1)", [victim]);
      await db.exec("reset role");

      const left = async (uid: string) =>
        Number(
          await scalar(
            "select count(*)::int as v from auth.sessions where user_id=$1",
            [uid],
          ),
        );

      expect(await left(victim)).toBe(0);
      expect(
        await scalar(
          "select count(*)::int as v from auth.refresh_tokens where user_id=$1",
          [victim],
        ),
      ).toBe(0);
      expect(await left(other)).toBe(1); // CONTROL: no toca a los demás
    });
  });

  // ------------------------------------------- credenciales de la demo
  describe("la cuenta demo no cambia correo ni contraseña por la API de Auth", () => {
    it("GoTrue (supabase_auth_admin) no puede; el SQL Editor (dueño) sí; una cuenta normal sí", async () => {
      const C = await makeCompany(db, "Demo auth");
      const demo = await makeUser(db, C.id, "admin");
      const normal = await makeUser(db, C.id, "user");

      await db.query(
        "update public.profiles set is_demo=true, demo_mode='read_only' where id=$1",
        [demo],
      );
      await db.query(
        "update auth.users set encrypted_password='h0' where id in ($1,$2)",
        [demo, normal],
      );

      const asAuth = async (sql: string, params: unknown[]) => {
        await db.exec("set session authorization supabase_auth_admin");
        try {
          return await rejects(() => db.query(sql, params));
        } finally {
          // PGlite no restaura con RESET: se vuelve explícitamente al dueño.
          await db.exec("set session authorization postgres");
        }
      };

      expect(
        await asAuth(
          "update auth.users set encrypted_password='h1' where id=$1",
          [demo],
        ),
      ).toMatch(/solo lectura/i);
      expect(
        await asAuth(
          "update auth.users set email='otro@demo.test' where id=$1",
          [demo],
        ),
      ).toMatch(/solo lectura/i);
      // CONTROL: una cuenta normal cambia su contraseña por Auth
      expect(
        await asAuth(
          "update auth.users set encrypted_password='h1' where id=$1",
          [normal],
        ),
      ).toBeNull();
      // CONTROL: el dueño (SQL Editor) sí puede rotar la de la demo
      await db.query(
        "update auth.users set encrypted_password='h2' where id=$1",
        [demo],
      );
      expect(
        await scalar(
          "select encrypted_password as v from auth.users where id=$1",
          [demo],
        ),
      ).toBe("h2");
    });
  });

  // ------------------------------------------ GUC de un solo uso
  describe("la autorización de customers.* es de un solo uso", () => {
    it("vender y luego editar puntos/saldo/límite del cliente en la MISMA transacción se rechaza", async () => {
      const C = await makeCompany(db, "GUC");
      const cashier = await makeUser(db, C.id, "user");
      const product = await makeProduct(db, C.id, C.loc1, "P", 1, 100, 10);
      const customer = await makeCustomer(db, C.id, "Cli", 0);

      await setLoyaltySettings(db, C.id, {
        enabled: true,
        pointValue: 1,
        earnRate: 10,
      });
      await openSession(cashier, C.loc1);

      const err = await rejects(() =>
        asUser(db, cashier, async () => {
          await db.exec("begin");
          try {
            await createSale(
              db,
              [{ product_id: product, qty: 1, unit_price: 0 }],
              C.loc1,
              undefined,
              { customerId: customer },
            );
            await db.query(
              "update public.customers set loyalty_points=100000 where id=$1",
              [customer],
            );
            await db.exec("commit");
          } catch (e) {
            await db.exec("rollback");
            throw e;
          }
        }),
      );

      expect(err).toMatch(/solo se modifican mediante una venta/i);
      expect(
        Number(
          await scalar(
            "select loyalty_points as v from public.customers where id=$1",
            [customer],
          ),
        ),
      ).toBe(0);

      // CONTROL: la venta legítima sí gana puntos
      await asUser(db, cashier, () =>
        createSale(
          db,
          [{ product_id: product, qty: 1, unit_price: 0 }],
          C.loc1,
          undefined,
          { customerId: customer },
        ),
      );
      expect(
        Number(
          await scalar(
            "select loyalty_points as v from public.customers where id=$1",
            [customer],
          ),
        ),
      ).toBeGreaterThan(0);
    });
  });

  // ------------------------------------ vigencia de cotizaciones
  describe("cotizaciones con vigencia mayor a 90 días", () => {
    it("una cotización anterior al tope no se convierte; CONTROL: una normal sí", async () => {
      const C = await makeCompany(db, "Vigencia");
      const cashier = await makeUser(db, C.id, "user");
      const product = await makeProduct(db, C.id, C.loc1, "P", 1, 10, 20);

      await openSession(cashier, C.loc1);

      const quote = async () => {
        const r = await asUser(db, cashier, () =>
          db.query<{ q: { quote_id?: string; id?: string } }>(
            "select create_quote($1::jsonb,null,null,$2) as q",
            [JSON.stringify([{ product_id: product, qty: 1 }]), C.loc1],
          ),
        );

        return (r.rows[0].q.quote_id ?? r.rows[0].q.id) as string;
      };
      const convert = (q: string) =>
        rejects(() =>
          asUser(db, cashier, () =>
            db.query("select convert_quote_to_sale($1,$2,'Efectivo')", [
              q,
              C.loc1,
            ]),
          ),
        );

      const legacy = await quote();

      await db.query(
        "update public.quotes set valid_until='2099-12-31' where id=$1",
        [legacy],
      );
      await db.query("update public.products set price=50 where id=$1", [
        product,
      ]);
      expect(await convert(legacy)).toMatch(/excede el maximo de 90 dias/i);
      expect(await convert(await quote())).toBeNull();
    });
  });

  // ------------------------------------------------ stock del producto
  describe("products.stock: una sola regla y devoluciones de productos con variantes", () => {
    it("vender otra variante NO suma el stock de una variante retirada al total del producto", async () => {
      const C = await makeCompany(db, "Stock agg");
      const admin = await makeUser(db, C.id, "admin");
      const cashier = await makeUser(db, C.id, "user");
      const product = await makeProduct(db, C.id, C.loc1, "Camisa", 5, 10, 10);
      const mk = (talla: string, stock: number) => ({
        attributes: { Talla: talla },
        price_override: 20,
        cost_override: 8,
        locations: [{ location_id: C.loc1, stock }],
      });
      const sync = (variants: unknown[]) =>
        asUser(db, admin, () =>
          db.query("select sync_product_variants($1,$2,$3::jsonb)", [
            product,
            ["Talla"],
            JSON.stringify(variants),
          ]),
        );

      await sync([mk("M", 3), mk("XL", 50)]);

      const vs = (
        await db.query<{ id: string; attributes: { Talla: string } }>(
          "select id, attributes from public.product_variants where product_id=$1",
          [product],
        )
      ).rows;
      const vM = vs.find((v) => v.attributes.Talla === "M")!;

      await sync([{ id: vM.id, ...mk("M", 3) }]); // XL queda retirada con 50 piezas
      expect(
        Number(
          await scalar("select stock as v from public.products where id=$1", [
            product,
          ]),
        ),
      ).toBe(3);

      await openSession(cashier, C.loc1);
      await asUser(db, cashier, () =>
        db.query("select create_sale(null,'Ticket','Efectivo',$1::jsonb,$2)", [
          JSON.stringify([{ product_id: product, variant_id: vM.id, qty: 1 }]),
          C.loc1,
        ]),
      );
      expect(
        Number(
          await scalar("select stock as v from public.products where id=$1", [
            product,
          ]),
        ),
      ).toBe(2);
    });

    it("devolver un renglón vendido ANTES de tener variantes reembolsa, no pisa el total y deja constancia", async () => {
      const C = await makeCompany(db, "Devolución variantes");
      const admin = await makeUser(db, C.id, "admin");
      const cashier = await makeUser(db, C.id, "user");
      const product = await makeProduct(
        db,
        C.id,
        C.loc1,
        "Playera",
        5,
        100,
        10,
      );

      await openSession(cashier, C.loc1, 0);

      const sale = await asUser(db, cashier, () =>
        createSale(
          db,
          [{ product_id: product, qty: 2, unit_price: 0 }],
          C.loc1,
        ),
      );
      const item = (
        await db.query<{ id: string }>(
          "select id from public.sale_items where sale_id=$1",
          [sale.sale_id],
        )
      ).rows[0].id;

      await asUser(db, admin, () =>
        db.query("select sync_product_variants($1,$2,$3::jsonb)", [
          product,
          ["Talla"],
          JSON.stringify([
            {
              attributes: { Talla: "S" },
              price_override: 100,
              cost_override: 5,
              locations: [{ location_id: C.loc1, stock: 40 }],
            },
          ]),
        ]),
      );
      expect(
        Number(
          await scalar("select stock as v from public.products where id=$1", [
            product,
          ]),
        ),
      ).toBe(40);

      await asUser(db, cashier, () =>
        db.query("select create_return($1,'x',$2::jsonb,$3,true)", [
          sale.sale_id,
          JSON.stringify([{ sale_item_id: item, qty: 1 }]),
          C.loc1,
        ]),
      );

      expect(
        Number(
          await scalar("select stock as v from public.products where id=$1", [
            product,
          ]),
        ),
      ).toBe(40);
      expect(
        Number(
          await scalar(
            "select count(*)::int as v from public.returns where sale_id=$1",
            [sale.sale_id],
          ),
        ),
      ).toBe(1);
      expect(
        Number(
          await scalar(
            "select count(*)::int as v from public.audit_log where action='return_stock_not_restored'",
          ),
        ),
      ).toBe(1);
    });

    it("no se vende de una asignación de sucursal desactivada; CONTROL: la activa sí", async () => {
      const C = await makeCompany(db, "Asignación");
      const cashier = await makeUser(db, C.id, "user");
      const product = await makeProduct(db, C.id, C.loc1, "P", 1, 10, 10);

      await openSession(cashier, C.loc1);
      expect(
        await rejects(() =>
          asUser(db, cashier, () =>
            createSale(
              db,
              [{ product_id: product, qty: 1, unit_price: 0 }],
              C.loc1,
            ),
          ),
        ),
      ).toBeNull();

      await db.query(
        "update public.product_locations set is_active=false where product_id=$1",
        [product],
      );
      expect(
        await rejects(() =>
          asUser(db, cashier, () =>
            createSale(
              db,
              [{ product_id: product, qty: 1, unit_price: 0 }],
              C.loc1,
            ),
          ),
        ),
      ).toMatch(/asignado|stock/i);
    });
  });

  // ----------------------------------------------- sucursal desactivada
  describe("una sucursal desactivada no opera", () => {
    it("no se abre caja, no se vende ni se ajusta stock; devolver y cerrar un turno ya abierto siguen", async () => {
      const C = await makeCompany(db, "Sucursal off");
      const admin = await makeUser(db, C.id, "admin");
      const cashier = await makeUser(db, C.id, "user");
      const product = await makeProduct(db, C.id, C.loc2, "P", 1, 100, 10);

      // turno abierto ANTES de apagar la sucursal
      const session = await openSession(cashier, C.loc2, 50);
      const sale = await asUser(db, cashier, () =>
        createSale(
          db,
          [{ product_id: product, qty: 1, unit_price: 0 }],
          C.loc2,
        ),
      );

      await db.query(
        "update public.locations set is_active=false where id=$1",
        [C.loc2],
      );

      const sell = () =>
        asUser(db, cashier, () =>
          createSale(
            db,
            [{ product_id: product, qty: 1, unit_price: 0 }],
            C.loc2,
          ),
        );
      const open = (uid: string) =>
        asUser(db, uid, () =>
          db.query("select open_cash_session(0,$1)", [C.loc2]),
        );
      const adjust = () =>
        asUser(db, admin, () =>
          db.query("select adjust_stock($1,$2,5,'x')", [product, C.loc2]),
        );

      expect(await rejects(sell)).toMatch(/desactivada/i);
      expect(await rejects(() => open(admin))).toMatch(/desactivada/i);
      expect(await rejects(adjust)).toMatch(/desactivada/i);

      // CONTROL: contar, cerrar y autorizar el turno que ya estaba abierto
      await asUser(db, cashier, () =>
        submitTillCount(
          db,
          session,
          [
            { denomination: 100, quantity: 1 },
            { denomination: 50, quantity: 1 },
          ],
          0,
        ),
      );
      await asUser(db, cashier, () => finishTillCount(db, session));
      await asUser(db, admin, () => authorizeCashSession(db, session, null));

      // CONTROL: una devolución sigue posible
      const item = (
        await db.query<{ id: string }>(
          "select id from public.sale_items where sale_id=$1",
          [sale.sale_id],
        )
      ).rows[0].id;

      await db.query("update public.locations set is_active=true where id=$1", [
        C.loc2,
      ]);
      await openSession(cashier, C.loc2, 0);
      await db.query(
        "update public.locations set is_active=false where id=$1",
        [C.loc2],
      );
      expect(
        await rejects(() =>
          asUser(db, cashier, () =>
            db.query("select create_return($1,'x',$2::jsonb,$3,true)", [
              sale.sale_id,
              JSON.stringify([{ sale_item_id: item, qty: 1 }]),
              C.loc2,
            ]),
          ),
        ),
      ).toBeNull();

      // CONTROL: la otra sucursal sigue operando
      await db.query("update public.locations set is_active=true where id=$1", [
        C.loc2,
      ]);
      expect(await rejects(sell)).toBeNull();
    });
  });

  // -------------------------------------- caja abierta una por cajero
  describe("una caja por cajero", () => {
    it("CONTROL: abrir una segunda caja sigue rechazándose y el candado existe en la función", async () => {
      const C = await makeCompany(db, "Una caja");
      const cashier = await makeUser(db, C.id, "user");

      await db.query(
        "insert into public.tills (company_id, location_id, name) values ($1,$2,'Caja 2')",
        [C.id, C.loc1],
      );

      const tills = (
        await db.query<{ id: string }>(
          "select id from public.tills where location_id=$1 order by name",
          [C.loc1],
        )
      ).rows.map((r) => r.id);
      const openOn = (till: string) =>
        asUser(db, cashier, () =>
          db.query("select open_cash_session(0,$1,$2)", [C.loc1, till]),
        );

      expect(tills).toHaveLength(2);
      await openOn(tills[0]);
      expect(await rejects(() => openOn(tills[1]))).toMatch(
        /Ya tienes una caja abierta/i,
      );
      expect(
        await scalar(
          "select prosrc like '%pg_advisory_xact_lock%cash-open%' as v from pg_proc where proname='open_cash_session' and pronargs=3",
        ),
      ).toBe(true);
    });
  });

  // -------------------------------------- conciliación sin declarar
  describe("conciliación de tarjeta: sin cobros no hay diferencia que marcar", () => {
    it("CONTROL: un turno solo en efectivo y sin declarar deja la diferencia de tarjeta en null", async () => {
      const C = await makeCompany(db, "Solo efectivo");
      const admin = await makeUser(db, C.id, "admin");
      const cashier = await makeUser(db, C.id, "user");
      const product = await makeProduct(db, C.id, C.loc1, "P", 1, 100, 10);
      const session = await openSession(cashier, C.loc1, 0);

      await asUser(db, cashier, () =>
        createSale(
          db,
          [{ product_id: product, qty: 1, unit_price: 0 }],
          C.loc1,
        ),
      );
      await asUser(db, cashier, () =>
        submitTillCount(db, session, [{ denomination: 100, quantity: 1 }], 0),
      );
      await asUser(db, cashier, () => finishTillCount(db, session));
      await asUser(db, admin, () => authorizeCashSession(db, session, null));
      expect(
        await scalar(
          "select card_difference as v from public.cash_sessions where id=$1",
          [session],
        ),
      ).toBeNull();
    });
  });
});
