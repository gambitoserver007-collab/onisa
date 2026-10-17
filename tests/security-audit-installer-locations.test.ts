// Auditoría de seguridad 2026-10 (3ª pasada):
//   - Re-correr 01_install.sql ya no autoriza las cajas pendientes de revisión.
//   - profile_locations: perfil y sucursal deben ser de la empresa de la fila,
//     y las filas ajenas no restringen a nadie.
// Cada puerta trae CONTROLES: lo legítimo sigue funcionando.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  asUser,
  createSale,
  createTestDb,
  errMessage,
  makeCompany,
  makeProduct,
  makeUser,
  type TestCompany,
} from "./helpers/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function rejects(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();

    return null;
  } catch (err) {
    return errMessage(err);
  }
}

const rerunInstaller = (db: PGlite) =>
  db.exec(
    readFileSync(
      path.join(__dirname, "../supabase/install/01_install.sql"),
      "utf-8",
    ),
  );

describe("Instalador: cajas pendientes de revisión", () => {
  let db: PGlite;
  let C: TestCompany;
  let cashier: string;
  let admin: string;

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa instalador");
    cashier = await makeUser(db, C.id, "user");
    admin = await makeUser(db, C.id, "admin");
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("una caja cerrada por el cajero sigue PENDIENTE de revisión después de re-correr el instalador", async () => {
    const sessionId = (
      await asUser(db, cashier, () =>
        db.query<{ s: string }>("select open_cash_session(100,$1) as s", [
          C.loc1,
        ]),
      )
    ).rows[0].s;

    await asUser(db, cashier, () =>
      db.query("select submit_till_count($1,$2::jsonb,0)", [
        sessionId,
        JSON.stringify([{ denomination: 100, quantity: 1 }]),
      ]),
    );
    await asUser(db, cashier, () =>
      db.query("select finish_till_count($1)", [sessionId]),
    );

    await rerunInstaller(db);

    const { rows } = await db.query<{
      status: string;
      review_status: string;
    }>("select status, review_status from public.cash_sessions where id=$1", [
      sessionId,
    ]);

    expect(rows[0].status).toBe("closed");
    expect(rows[0].review_status).toBe("pending");

    // El administrador todavía puede autorizarla y se calcula la clasificación.
    const auth = await asUser(db, admin, () =>
      db.query<{ r: { classification: string } }>(
        "select authorize_cash_session($1,null) as r",
        [sessionId],
      ),
    );

    expect(auth.rows[0].r.classification).toBe("cuadrado");
  }, 120_000);

  it("CONTROL: una caja cerrada con el flujo VIEJO (sin ningún conteo) sí se marca como ya autorizada", async () => {
    const legacy = crypto.randomUUID();

    await db.query(
      `insert into public.cash_sessions
         (id, company_id, location_id, till_id, opened_by, opening_amount, status, closed_at, review_status)
       select $1, $2, $3, t.id, $4, 100, 'closed', now(), 'pending'
       from public.tills t where t.company_id=$2 and t.location_id=$3 limit 1`,
      [legacy, C.id, C.loc1, cashier],
    );

    await rerunInstaller(db);

    const { rows } = await db.query<{ review_status: string }>(
      "select review_status from public.cash_sessions where id=$1",
      [legacy],
    );

    expect(rows[0].review_status).toBe("authorized");
  }, 120_000);
});

describe("profile_locations: perfil y sucursal de la misma empresa", () => {
  let db: PGlite;
  let A: TestCompany;
  let B: TestCompany;
  let adminA: string;
  let cashierA: string;
  let victim: string;
  let productB: string;

  const insertRow = (
    userId: string,
    companyId: string,
    profileId: string,
    locationId: string,
  ) =>
    asUser(db, userId, () =>
      db.query(
        "insert into public.profile_locations (company_id, profile_id, location_id) values ($1,$2,$3)",
        [companyId, profileId, locationId],
      ),
    );

  const sellB = () =>
    asUser(db, victim, () =>
      createSale(
        db,
        [{ product_id: productB, qty: 1, unit_price: 100 }],
        B.loc1,
      ),
    );

  beforeAll(async () => {
    db = await createTestDb();
    // Refleja los permisos por defecto de Supabase (el instalador solo
    // concede SELECT explícitamente).
    await db.exec(
      "grant insert, update, delete on public.profile_locations to authenticated",
    );
    A = await makeCompany(db, "Empresa A");
    B = await makeCompany(db, "Empresa B");
    adminA = await makeUser(db, A.id, "admin");
    cashierA = await makeUser(db, A.id, "user");
    victim = await makeUser(db, B.id, "admin");
    productB = await makeProduct(db, B.id, B.loc1, "P", 1, 100, 100);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: un admin sí puede restringir a su PROPIO empleado a su PROPIA sucursal, y quitar la restricción", async () => {
    const err = await rejects(() => insertRow(adminA, A.id, cashierA, A.loc1));

    expect(err).toBeNull();

    const del = await asUser(db, adminA, () =>
      db.query(
        "delete from public.profile_locations where profile_id=$1 returning profile_id",
        [cashierA],
      ),
    );

    expect(del.rows).toHaveLength(1);
  });

  it("CONTROL: la víctima vende normalmente en su sucursal", async () => {
    expect(await rejects(() => sellB())).toBeNull();
  });

  it("un admin de A NO puede restringir a un usuario de B", async () => {
    const err = await rejects(() => insertRow(adminA, A.id, victim, A.loc1));

    expect(err).toMatch(/row-level security/i);
    expect(await rejects(() => sellB())).toBeNull();
  });

  it("un admin de A NO puede apuntar una fila de su empresa a una sucursal de B", async () => {
    const err = await rejects(() => insertRow(adminA, A.id, cashierA, B.loc1));

    expect(err).toMatch(/row-level security/i);
  });

  it("un admin de A NO puede reapuntar (UPDATE) una fila suya hacia un usuario de B", async () => {
    await insertRow(adminA, A.id, cashierA, A.loc1);

    const err = await rejects(() =>
      asUser(db, adminA, () =>
        db.query(
          "update public.profile_locations set profile_id=$1 where profile_id=$2",
          [victim, cashierA],
        ),
      ),
    );

    expect(err).toMatch(/row-level security/i);
  });

  it("una fila ajena que YA estaba plantada no restringe a la víctima", async () => {
    // Simula una fila plantada antes del arreglo (la escribe el superusuario).
    await db.query(
      "insert into public.profile_locations (company_id, profile_id, location_id) values ($1,$2,$3)",
      [A.id, victim, A.loc1],
    );

    expect(await rejects(() => sellB())).toBeNull();
  });

  it("re-correr el instalador borra las filas ajenas plantadas, y conserva las legítimas", async () => {
    await rerunInstaller(db);

    const foreign = await db.query<{ n: string }>(
      "select count(*)::int as n from public.profile_locations where profile_id=$1",
      [victim],
    );
    const legit = await db.query<{ n: string }>(
      "select count(*)::int as n from public.profile_locations where profile_id=$1",
      [cashierA],
    );

    expect(Number(foreign.rows[0].n)).toBe(0);
    expect(Number(legit.rows[0].n)).toBe(1);
  }, 120_000);

  it("CONTROL: un empleado restringido a SU sucursal sigue restringido (no puede usar otra)", async () => {
    const productA = await makeProduct(db, A.id, A.loc2, "PA", 1, 100, 100);
    const err = await rejects(() =>
      asUser(db, cashierA, () =>
        createSale(
          db,
          [{ product_id: productA, qty: 1, unit_price: 100 }],
          A.loc2,
        ),
      ),
    );

    expect(err).toMatch(/acceso a esta sucursal/i);
  });
});
