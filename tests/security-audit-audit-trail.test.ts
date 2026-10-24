// Auditoría de seguridad 2026-10 (14ª pasada): integridad de la bitácora.
//   - Un admin podía hacer DELETE de un producto por la API (borra en cascada
//     TODO su kardex) o de la fila de su empresa (borra todo, bitácora incluida).
//   - Alta / baja / cambios de rol de usuarios hechos directo sobre profiles no
//     dejaban rastro.
//   - La bitácora perdía la atribución si luego borraban la cuenta del actor.
//   - reset_company_data borraba la bitácora sin dejar constancia.
// Cada puerta trae CONTROLES: lo legítimo sigue funcionando.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asUser,
  createTestDb,
  errMessage,
  makeCompany,
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

describe("Bitácora y libros: un administrador no puede destruir evidencia por la API", () => {
  let db: PGlite;
  let C: TestCompany;
  let admin: string;
  let cashier: string;
  let product: string;

  const movements = async () =>
    Number(
      (
        await db.query<{ n: string }>(
          "select count(*)::int as n from public.stock_movements where product_id=$1",
          [product],
        )
      ).rows[0].n,
    );

  const auditRows = (entityType: string, action: string) =>
    db
      .query<{
        actor_id: string | null;
        actor_label: string | null;
        detail: Record<string, unknown>;
      }>(
        "select actor_id, actor_label, detail from public.audit_log where company_id=$1 and entity_type=$2 and action=$3 order by created_at",
        [C.id, entityType, action],
      )
      .then((r) => r.rows);

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa bitácora");
    admin = await makeUser(db, C.id, "admin");
    cashier = await makeUser(db, C.id, "user");
    product = await makeProduct(db, C.id, C.loc1, "P", 1, 100, 20);
    await asUser(db, admin, () =>
      db.query("select adjust_stock($1,$2,3::numeric,'prueba')", [
        product,
        C.loc1,
      ]),
    );
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("un admin NO puede borrar un producto por la API (el kardex queda intacto)", async () => {
    const before = await movements();
    const err = await rejects(() =>
      asUser(db, admin, () =>
        db.query("delete from public.products where id=$1", [product]),
      ),
    );

    expect(before).toBeGreaterThan(0);
    expect(err).toMatch(/permission denied/i);
    expect(await movements()).toBe(before);
  });

  it("CONTROL: borrar un producto sigue siendo posible por la vía normal (soft_delete_product)", async () => {
    const other = await makeProduct(db, C.id, C.loc1, "Otro", 1, 10, 5);

    expect(
      await rejects(() =>
        asUser(db, admin, () =>
          db.query("select soft_delete_product($1)", [other]),
        ),
      ),
    ).toBeNull();
  });

  it("un admin NO puede borrar la fila de su empresa por la API", async () => {
    const err = await rejects(() =>
      asUser(db, admin, () =>
        db.query("delete from public.companies where id=$1", [C.id]),
      ),
    );
    const { rows } = await db.query<{ n: string }>(
      "select count(*)::int as n from public.companies where id=$1",
      [C.id],
    );

    expect(err).toMatch(/permission denied/i);
    expect(Number(rows[0].n)).toBe(1);
  });

  it("CONTROL: el admin sí actualiza los datos de su empresa", async () => {
    expect(
      await rejects(() =>
        asUser(db, admin, () =>
          db.query("update public.companies set phone='555' where id=$1", [
            C.id,
          ]),
        ),
      ),
    ).toBeNull();
  });

  it("borrar a un empleado directo en profiles deja bitácora con el actor", async () => {
    const worker = await makeUser(db, C.id, "user");

    await asUser(db, admin, () =>
      db.query("delete from public.profiles where id=$1", [worker]),
    );

    const deleted = await auditRows("profile", "deleted");

    expect(deleted).toHaveLength(1);
    expect(deleted[0].actor_id).toBe(admin);
  });

  it("un cambio de rol hecho por la plataforma directo en profiles también deja bitácora", async () => {
    const platform = await makeUser(db, C.id, "admin", true);
    const worker = await makeUser(db, C.id, "user");

    await asUser(db, platform, () =>
      db.query("update public.profiles set role='finanzas' where id=$1", [
        worker,
      ]),
    );

    const updated = await auditRows("profile", "updated");

    expect(
      updated.some((r) => (r.detail.changed as string[]).includes("role")),
    ).toBe(true);
  });

  it("CONTROL: renombrarse a sí mismo no llena la bitácora de ruido", async () => {
    const before = (await auditRows("profile", "updated")).length;

    await asUser(db, cashier, () =>
      db.query(
        "update public.profiles set full_name='Nombre nuevo' where id=$1",
        [cashier],
      ),
    );

    expect((await auditRows("profile", "updated")).length).toBe(before);
  });

  it("la bitácora conserva el nombre del actor aunque luego borren su cuenta", async () => {
    const actor = await makeUser(db, C.id, "finanzas");

    await db.query(
      "update public.profiles set full_name='Ana Auditora' where id=$1",
      [actor],
    );
    await asUser(db, actor, () =>
      db.query("select open_cash_session(0,$1)", [C.loc1]),
    );
    await db.query("delete from public.profiles where id=$1", [actor]);

    const { rows } = await db.query<{
      actor_id: string | null;
      actor_label: string | null;
    }>(
      "select actor_id, actor_label from public.audit_log where company_id=$1 and entity_type='cash_session' and action='opened'",
      [C.id],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].actor_id).toBeNull();
    expect(rows[0].actor_label).toBe("Ana Auditora");
  });

  it("restablecer el sistema borra la bitácora pero deja UNA entrada con quién lo hizo", async () => {
    const R = await makeCompany(db, "Empresa a restablecer");
    const owner = await makeUser(db, R.id, "admin");

    await db.query("update public.profiles set full_name='Dueño' where id=$1", [
      owner,
    ]);
    await asUser(db, owner, () =>
      db.query("select open_cash_session(0,$1)", [R.loc1]),
    );
    await asUser(db, owner, () =>
      db.query("select reset_company_data($1)", ["Empresa a restablecer"]),
    );

    const { rows } = await db.query<{
      entity_type: string;
      action: string;
      actor_id: string | null;
      actor_label: string | null;
    }>(
      "select entity_type, action, actor_id, actor_label from public.audit_log where company_id=$1",
      [R.id],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].entity_type).toBe("company");
    expect(rows[0].action).toBe("reset");
    expect(rows[0].actor_id).toBe(owner);
    expect(rows[0].actor_label).toBe("Dueño");
  });
});
