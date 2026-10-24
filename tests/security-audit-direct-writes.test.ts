// Auditoría de seguridad 2026-10 (13ª pasada): escrituras directas del cliente vs
// los roles de la pantalla. Solo la UI ocultaba estas pantallas; un REST directo
// las permitía igual:
//   - locations: un cajero creaba sucursales y desactivaba la principal.
//   - customers: el operador de almacén (que no ve /clientes) los escribía, y
//     cualquier rol podía "eliminar" (archivar) a un cliente con deuda.
// Se conserva lo decidido en la auditoría 2026-09: cualquier miembro edita
// nombre / dirección / config de ticket de una sucursal.
// Cada puerta trae CONTROLES: lo legítimo sigue funcionando.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asUser,
  createTestDb,
  errMessage,
  makeCompany,
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

describe("Escrituras directas: sucursales y clientes", () => {
  let db: PGlite;
  let C: TestCompany;
  let admin: string;
  let cashier: string;
  let operador: string;
  let gerente: string;

  const customer = async (balance = 0) => {
    const id = crypto.randomUUID();

    await db.query(
      "insert into public.customers (id, company_id, name, credit_balance, credit_limit) values ($1,$2,'Cliente',$3,500)",
      [id, C.id, balance],
    );

    return id;
  };

  const archive = (userId: string, id: string) =>
    asUser(db, userId, () =>
      db.query(
        "update public.customers set deleted_at = now() where id=$1 returning id",
        [id],
      ),
    );

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa escrituras");
    admin = await makeUser(db, C.id, "admin");
    cashier = await makeUser(db, C.id, "user");
    operador = await makeUser(db, C.id, "operador");
    gerente = await makeUser(db, C.id, "gerente");
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: el admin crea sucursales y las activa / desactiva", async () => {
    const id = crypto.randomUUID();

    expect(
      await rejects(() =>
        asUser(db, admin, () =>
          db.query(
            "insert into public.locations (id, company_id, name) values ($1,$2,'Nueva')",
            [id, C.id],
          ),
        ),
      ),
    ).toBeNull();
    expect(
      await rejects(() =>
        asUser(db, admin, () =>
          db.query("update public.locations set is_active=false where id=$1", [
            id,
          ]),
        ),
      ),
    ).toBeNull();
  });

  it("un cajero NO crea sucursales ni las desactiva", async () => {
    const insert = await rejects(() =>
      asUser(db, cashier, () =>
        db.query(
          "insert into public.locations (company_id, name) values ($1,'Fantasma')",
          [C.id],
        ),
      ),
    );
    const deactivate = await rejects(() =>
      asUser(db, cashier, () =>
        db.query("update public.locations set is_active=false where id=$1", [
          C.loc1,
        ]),
      ),
    );

    expect(insert).toMatch(/row-level security/i);
    expect(deactivate).toMatch(/administrador/i);

    const { rows } = await db.query<{ is_active: boolean }>(
      "select is_active from public.locations where id=$1",
      [C.loc1],
    );

    expect(rows[0].is_active).toBe(true);
  });

  it("CONTROL: un cajero sigue pudiendo editar el nombre de una sucursal (decisión 2026-09)", async () => {
    expect(
      await rejects(() =>
        asUser(db, cashier, () =>
          db.query(
            "update public.locations set name='Renombrada' where id=$1",
            [C.loc1],
          ),
        ),
      ),
    ).toBeNull();
  });

  it("CONTROL: cajero, gerente y admin crean y editan clientes", async () => {
    for (const user of [cashier, gerente, admin]) {
      expect(
        await rejects(() =>
          asUser(db, user, () =>
            db.query(
              "insert into public.customers (company_id, name) values ($1,'Nuevo')",
              [C.id],
            ),
          ),
        ),
      ).toBeNull();
    }
  });

  it("el operador de almacén NO escribe clientes (ni crea ni edita)", async () => {
    const id = await customer();
    const insert = await rejects(() =>
      asUser(db, operador, () =>
        db.query(
          "insert into public.customers (company_id, name) values ($1,'Nuevo')",
          [C.id],
        ),
      ),
    );
    const edit = await asUser(db, operador, () =>
      db.query(
        "update public.customers set name='x' where id=$1 returning id",
        [id],
      ),
    );

    expect(insert).toMatch(/row-level security/i);
    expect(edit.rows).toHaveLength(0);
  });

  it("un cajero NO puede eliminar a un cliente con saldo pendiente; sí a uno sin deuda", async () => {
    const debtor = await customer(120);
    const clean = await customer(0);

    expect(await rejects(() => archive(cashier, debtor))).toMatch(
      /saldo pendiente/i,
    );
    expect(await rejects(() => archive(cashier, clean))).toBeNull();

    const { rows } = await db.query<{ deleted_at: string | null }>(
      "select deleted_at from public.customers where id=$1",
      [debtor],
    );

    expect(rows[0].deleted_at).toBeNull();
  });

  it("CONTROL: un admin sí puede archivar a un cliente con deuda", async () => {
    const debtor = await customer(80);

    expect(await rejects(() => archive(admin, debtor))).toBeNull();
  });
});
