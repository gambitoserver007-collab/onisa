// Auditoría de seguridad 2026-10 (5ª pasada): los cinco candidatos "por validar".
// PGlite es una sola conexión, así que no puede reproducir dos transacciones
// pisándose; estas pruebas verifican (a) el comportamiento secuencial y (b) que
// el candado que impide la carrera de verdad se toma (pg_locks / código de la
// función), que es lo que cierra la puerta.
//   - delete_merma: la segunda llamada ya no repone el stock otra vez.
//   - límite de productos / ventas del mes / usuarios del plan: candado por empresa.
//   - triggers del corte de conteo: FOR SHARE (ver blind-count-visibility).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asUser,
  createSale,
  createTestDb,
  errMessage,
  makeCompany,
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

describe("delete_merma: una merma solo repone el stock una vez", () => {
  let db: PGlite;
  let C: TestCompany;
  let admin: string;
  let product: string;
  let mermaId: string;

  const stock = async () =>
    Number(
      (
        await db.query<{ stock: string }>(
          "select stock from public.product_locations where product_id=$1 and location_id=$2",
          [product, C.loc1],
        )
      ).rows[0].stock,
    );

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa merma doble");
    admin = await makeUser(db, C.id, "admin");
    product = await makeProduct(db, C.id, C.loc1, "P", 1, 100, 10);
    mermaId = (
      await asUser(db, admin, () =>
        db.query<{ r: string }>(
          "select register_merma($1,'otro',null,$2,3::numeric,null,null) as r",
          [C.loc1, product],
        ),
      )
    ).rows[0].r;
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: la primera eliminación repone el stock descontado", async () => {
    expect(await stock()).toBe(7);

    await asUser(db, admin, () =>
      db.query("select delete_merma($1)", [mermaId]),
    );

    expect(await stock()).toBe(10);
  });

  it("la segunda eliminación se rechaza y NO repone el stock otra vez", async () => {
    const err = await rejects(() =>
      asUser(db, admin, () => db.query("select delete_merma($1)", [mermaId])),
    );

    expect(err).toMatch(/Merma no encontrada/i);
    expect(await stock()).toBe(10);

    const { rows } = await db.query<{ n: string }>(
      "select count(*)::int as n from public.stock_movements where reference_id=$1 and movement_type='merma_revertida'",
      [mermaId],
    );

    expect(Number(rows[0].n)).toBe(1);
  });

  it("la lectura de la merma toma el candado de fila (FOR UPDATE)", async () => {
    const { rows } = await db.query<{ src: string }>(
      "select prosrc as src from pg_proc where proname='delete_merma'",
    );
    const src = rows[0].src
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n")
      .toLowerCase();

    expect(src).toMatch(
      /from public\.mermas\s+where id = p_merma_id[^;]*for update;/,
    );
    expect(src).toContain("deleted_at is null");
  });
});

describe("Límites del plan: el conteo y el alta comparten un candado por empresa", () => {
  let db: PGlite;
  let C: TestCompany;
  let planned: TestCompany;
  let cashier: string;
  let product: string;

  const advisoryLocks = async () =>
    Number(
      (
        await db.query<{ n: string }>(
          "select count(*)::int as n from pg_locks where locktype='advisory' and pid = pg_backend_pid()",
        )
      ).rows[0].n,
    );

  beforeAll(async () => {
    db = await createTestDb();
    const plan = await makePlan(db, "Plan chico", 5, 3, 100);

    planned = await makeCompany(db, "Con plan", { planId: plan });
    C = await makeCompany(db, "Sin plan");
    cashier = await makeUser(db, planned.id, "user");
    product = await makeProduct(db, planned.id, planned.loc1, "P", 1, 100, 50);
    await asUser(db, cashier, () =>
      db.query("select open_cash_session(0,$1)", [planned.loc1]),
    );
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("alta de producto: toma el candado hasta el commit (con plan) y no lo toma sin plan", async () => {
    await db.exec("begin");
    await makeProduct(db, C.id, C.loc1, "Libre", 1, 10, 1);
    const free = await advisoryLocks();

    await db.exec("rollback");

    await db.exec("begin");
    await makeProduct(db, planned.id, planned.loc1, "Limitado", 1, 10, 1);
    const limited = await advisoryLocks();

    await db.exec("rollback");

    expect(free).toBe(0);
    expect(limited).toBeGreaterThanOrEqual(1);
    expect(await advisoryLocks()).toBe(0);
  });

  it("venta: toma el candado del mes hasta el commit en un plan con límite", async () => {
    await db.exec("begin");
    await asUser(db, cashier, () =>
      createSale(
        db,
        [{ product_id: product, qty: 1, unit_price: 100 }],
        planned.loc1,
      ),
    );
    const held = await advisoryLocks();

    await db.exec("rollback");

    expect(held).toBeGreaterThanOrEqual(1);
    expect(await advisoryLocks()).toBe(0);
  });

  it("alta de usuario: toma el candado por empresa hasta el commit", async () => {
    await db.exec("begin");
    await makeUser(db, planned.id, "user");
    const held = await advisoryLocks();

    await db.exec("rollback");

    expect(held).toBeGreaterThanOrEqual(1);
  });

  it("CONTROL: el límite sigue haciéndose valer en secuencia (productos)", async () => {
    // 1 producto ya creado arriba; el plan permite 5.
    for (let i = 0; i < 4; i++) {
      await makeProduct(db, planned.id, planned.loc1, `X${i}`, 1, 10, 1);
    }

    const err = await rejects(() =>
      makeProduct(db, planned.id, planned.loc1, "Sobra", 1, 10, 1),
    );

    expect(err).toMatch(/limite de productos/i);
  });
});

describe("Límite de usuarios del plan en la base (trigger enforce_user_limit)", () => {
  let db: PGlite;
  let C: TestCompany;

  const activeCount = async () =>
    Number(
      (
        await db.query<{ n: string }>(
          "select count(*)::int as n from public.profiles where company_id=$1 and is_active",
          [C.id],
        )
      ).rows[0].n,
    );

  beforeAll(async () => {
    db = await createTestDb();
    const plan = await makePlan(db, "Plan 3 usuarios", 100, 3, 100);

    C = await makeCompany(db, "Empresa usuarios", { planId: plan });
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: hasta el límite del plan se pueden dar de alta usuarios", async () => {
    await makeUser(db, C.id, "admin");
    await makeUser(db, C.id, "user");
    await makeUser(db, C.id, "user");

    expect(await activeCount()).toBe(3);
  });

  it("un cuarto usuario activo se rechaza aunque venga de una petición 'simultánea'", async () => {
    const err = await rejects(() => makeUser(db, C.id, "user"));

    expect(err).toMatch(/limite de usuarios/i);
    expect(await activeCount()).toBe(3);
  });

  it("reactivar a un usuario que ya no cabe se rechaza; con espacio sí", async () => {
    const { rows } = await db.query<{ id: string }>(
      "select id from public.profiles where company_id=$1 order by created_at limit 2",
      [C.id],
    );
    const [a, b] = rows.map((r) => r.id);

    await db.query("update public.profiles set is_active=false where id=$1", [
      a,
    ]);
    // Un usuario nuevo ocupa el lugar libre.
    await makeUser(db, C.id, "user");

    const err = await rejects(() =>
      db.query("update public.profiles set is_active=true where id=$1", [a]),
    );

    expect(err).toMatch(/limite de usuarios/i);

    // CONTROL: tocar a un usuario ya activo (cambio de nombre/rol) no se revisa.
    expect(
      await rejects(() =>
        db.query("update public.profiles set full_name='x' where id=$1", [b]),
      ),
    ).toBeNull();

    // CONTROL: liberando el lugar, la reactivación pasa.
    await db.query("update public.profiles set is_active=false where id=$1", [
      b,
    ]);
    expect(
      await rejects(() =>
        db.query("update public.profiles set is_active=true where id=$1", [a]),
      ),
    ).toBeNull();
  });

  it("CONTROL: una empresa sin plan no queda limitada por el trigger", async () => {
    const free = await makeCompany(db, "Sin plan usuarios");

    for (let i = 0; i < 5; i++) await makeUser(db, free.id, "user");

    const { rows } = await db.query<{ n: string }>(
      "select count(*)::int as n from public.profiles where company_id=$1 and is_active",
      [free.id],
    );

    expect(Number(rows[0].n)).toBe(5);
  });
});
