// Auditoría de seguridad 2026-10 (8ª pasada): ciclo de vida de las cajas.
//   - authorize_cash_session no revisaba la sucursal (contar y cerrar sí).
//   - Un cajero podía abrir TODAS las cajas de la sucursal y dejarlas abiertas
//     (solo él o un administrador las cierra), bloqueando a sus compañeros.
//   - La inserción directa en cash_movements aceptaba cualquier tipo, signo o
//     monto cero, y un movimiento con location_id distinto al de su caja.
// Cada puerta trae CONTROLES: lo legítimo sigue funcionando.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asUser,
  authorizeCashSession,
  createTestDb,
  errMessage,
  finishTillCount,
  makeCompany,
  makeCustomer,
  makeProduct,
  makeUser,
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

const COUNT_100 = [{ denomination: 100, quantity: 1 }];

describe("authorize_cash_session respeta la sucursal", () => {
  let db: PGlite;
  let C: TestCompany;
  let restrictedFin: string;
  let freeFin: string;
  let session1: string;
  let session2: string;

  const closedSession = async (loc: string) => {
    const opener = await makeUser(db, C.id, "user");
    const s = (
      await asUser(db, opener, () =>
        db.query<{ s: string }>("select open_cash_session(100,$1) as s", [loc]),
      )
    ).rows[0].s;

    await asUser(db, opener, () => submitTillCount(db, s, COUNT_100));
    await asUser(db, opener, () => finishTillCount(db, s));

    return s;
  };

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa autorizar");
    restrictedFin = await makeUser(db, C.id, "finanzas");
    freeFin = await makeUser(db, C.id, "finanzas");
    await db.query(
      "insert into public.profile_locations (company_id, profile_id, location_id) values ($1,$2,$3)",
      [C.id, restrictedFin, C.loc1],
    );
    session1 = await closedSession(C.loc1);
    session2 = await closedSession(C.loc2);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("un finanzas restringido a la sucursal 1 NO puede autorizar el corte de la sucursal 2", async () => {
    const err = await rejects(() =>
      asUser(db, restrictedFin, () => authorizeCashSession(db, session2, null)),
    );

    expect(err).toMatch(/acceso a esta sucursal/i);

    const { rows } = await db.query<{ review_status: string }>(
      "select review_status from public.cash_sessions where id=$1",
      [session2],
    );

    expect(rows[0].review_status).not.toBe("authorized");
  });

  it("CONTROL: el mismo finanzas sí autoriza el corte de su propia sucursal", async () => {
    expect(
      await rejects(() =>
        asUser(db, restrictedFin, () =>
          authorizeCashSession(db, session1, null),
        ),
      ),
    ).toBeNull();
  });

  it("CONTROL: un finanzas sin restricción autoriza el corte de la sucursal 2", async () => {
    expect(
      await rejects(() =>
        asUser(db, freeFin, () => authorizeCashSession(db, session2, null)),
      ),
    ).toBeNull();
  });
});

describe("Un cajero tiene una sola caja abierta a la vez", () => {
  let db: PGlite;
  let C: TestCompany;
  let till2: string;
  let cashier: string;
  let admin: string;

  const openAt = (userId: string, tillId: string) =>
    asUser(db, userId, () =>
      db.query<{ s: string }>("select open_cash_session(0,$1,$2) as s", [
        C.loc1,
        tillId,
      ]),
    );

  let till1: string;

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa cajas");
    cashier = await makeUser(db, C.id, "user");
    admin = await makeUser(db, C.id, "admin");
    till1 = (
      await db.query<{ id: string }>(
        "select id from public.tills where company_id=$1 and location_id=$2",
        [C.id, C.loc1],
      )
    ).rows[0].id;
    till2 = crypto.randomUUID();
    await db.query(
      "insert into public.tills (id, company_id, location_id, name) values ($1,$2,$3,'Caja 2')",
      [till2, C.id, C.loc1],
    );
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: el cajero abre su caja", async () => {
    expect(await rejects(() => openAt(cashier, till1))).toBeNull();
  });

  it("el mismo cajero NO puede abrir una segunda caja mientras tenga una abierta", async () => {
    const err = await rejects(() => openAt(cashier, till2));

    expect(err).toMatch(/Ya tienes una caja abierta/i);
  });

  it("CONTROL: un admin sí puede tener más de una caja abierta", async () => {
    expect(await rejects(() => openAt(admin, till2))).toBeNull();
  });

  it("CONTROL: otro cajero abre su propia caja en otra caja libre y, tras cerrar la suya, el primero puede abrir otra", async () => {
    const s = (
      await db.query<{ id: string }>(
        "select id from public.cash_sessions where opened_by=$1 and status='open'",
        [cashier],
      )
    ).rows[0].id;

    await db.query(
      "update public.cash_sessions set status='closed' where id=$1",
      [s],
    );

    expect(await rejects(() => openAt(cashier, till1))).toBeNull();
  });
});

describe("Movimientos directos de caja: tipo, signo y sucursal", () => {
  let db: PGlite;
  let C: TestCompany;
  let cashier: string;
  let admin: string;
  let sessionId: string;

  const insert = (type: string, amount: number, loc: string | null = null) =>
    asUser(db, cashier, () =>
      db.query(
        `insert into public.cash_movements
           (company_id, cash_session_id, location_id, movement_type, concept, amount)
         values ($1,$2,$3,$4,'prueba',$5)`,
        [C.id, sessionId, loc, type, amount],
      ),
    );

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa movimientos");
    cashier = await makeUser(db, C.id, "user");
    admin = await makeUser(db, C.id, "admin");
    sessionId = (
      await asUser(db, cashier, () =>
        db.query<{ s: string }>("select open_cash_session(0,$1) as s", [
          C.loc1,
        ]),
      )
    ).rows[0].s;
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: un ingreso positivo y un egreso negativo en su caja se aceptan", async () => {
    expect(await rejects(() => insert("ingreso", 50))).toBeNull();
    expect(await rejects(() => insert("egreso", -20))).toBeNull();
  });

  it("un 'ingreso' negativo, un 'egreso' positivo, un monto cero o un tipo inventado se rechazan", async () => {
    for (const [type, amount] of [
      ["ingreso", -50],
      ["egreso", 50],
      ["ingreso", 0],
      ["otro", 50],
    ] as const) {
      const err = await rejects(() => insert(type, amount));

      expect(err, `${type} ${amount}`).toMatch(/check|violates/i);
    }
  });

  it("la sucursal de un movimiento SIEMPRE es la de su caja (la que mande el cliente se ignora)", async () => {
    // Auditoría 2026-10 (18ª pasada): antes una sucursal ajena se rechazaba y una
    // ausente quedaba NULL (visible para todas las sucursales). Ahora un trigger
    // copia la de la caja: lo que mande el cliente no importa.
    expect(await rejects(() => insert("ingreso", 5, C.loc2))).toBeNull();
    expect(await rejects(() => insert("ingreso", 5, C.loc1))).toBeNull();
    expect(await rejects(() => insert("ingreso", 5, null))).toBeNull();

    const { rows } = await db.query<{ location_id: string | null }>(
      "select distinct location_id from public.cash_movements where cash_session_id=$1",
      [sessionId],
    );

    expect(rows.map((r) => r.location_id)).toEqual([C.loc1]);
  });

  it("CONTROL: cancelar un apartado con reembolso sigue registrando un 'egreso' negativo", async () => {
    await db.query(
      "update public.companies set apartado_min_deposit_pct = 0 where id=$1",
      [C.id],
    );

    const product = await makeProduct(db, C.id, C.loc1, "P", 1, 100, 50);
    const customer = await makeCustomer(db, C.id, "Cliente", 0);
    const apartado = (
      await asUser(db, cashier, () =>
        db.query<{ r: { apartado_id: string } }>(
          `select create_apartado(
             p_customer_id := $1, p_items := $2::jsonb, p_location_id := $3,
             p_deposit_amount := 50, p_due_date := current_date + 5, p_payment_method := 'Efectivo'
           ) as r`,
          [customer, JSON.stringify([{ product_id: product, qty: 1 }]), C.loc1],
        ),
      )
    ).rows[0].r.apartado_id;

    await asUser(db, admin, () =>
      db.query("select open_cash_session(0,$1,null) as s", [C.loc2]),
    );
    await asUser(db, admin, () =>
      db.query("select cancel_apartado($1, true)", [apartado]),
    );

    const { rows } = await db.query<{ movement_type: string; amount: string }>(
      "select movement_type, amount from public.cash_movements where company_id=$1 and concept like 'Reembolso apartado%'",
      [C.id],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].movement_type).toBe("egreso");
    expect(Number(rows[0].amount)).toBe(-50);
  });
});
