// Auditoría de seguridad 2026-10 (5ª pasada): reset_company_data.
// La lista de tablas a borrar estaba escrita a mano y omitía mermas, apartados,
// cotizaciones, ventas anuladas, calendario y bloqueos del checador. Cuatro
// llaves ON DELETE RESTRICT (mermas -> sucursal, apartados -> sucursal/cliente,
// apartado_items -> producto) abortaban TODO el restablecimiento en cuanto
// existía una merma o un apartado, y cualquier cajero podía registrar la merma
// que lo bloqueaba. Además borrar la cuenta del empleado que registró una merma
// fallaba (mermas.employee_id / registered_by eran RESTRICT).
// Cada puerta trae CONTROLES: lo legítimo sigue funcionando.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asUser,
  createTestDb,
  errMessage,
  makeCompany,
  makeCustomer,
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

describe("Restablecer sistema: no lo bloquean mermas, apartados ni cotizaciones", () => {
  let db: PGlite;

  const count = async (table: string, companyId: string) =>
    Number(
      (
        await db.query<{ n: string }>(
          `select count(*)::int as n from public.${table} where company_id=$1`,
          [companyId],
        )
      ).rows[0].n,
    );

  const reset = (admin: string, name: string) =>
    asUser(db, admin, () => db.query("select reset_company_data($1)", [name]));

  const seed = async (name: string) => {
    const C = await makeCompany(db, name);
    const admin = await makeUser(db, C.id, "admin");
    const cashier = await makeUser(db, C.id, "user");
    const product = await makeProduct(db, C.id, C.loc1, "P", 1, 100, 500);
    const customer = await makeCustomer(db, C.id, "Cliente", 0);

    await db.query(
      "update public.companies set apartado_min_deposit_pct = 0 where id=$1",
      [C.id],
    );

    return { C, admin, cashier, product, customer };
  };

  const plantMerma = (userId: string, C: TestCompany, product: string) =>
    asUser(db, userId, () =>
      db.query(
        "select register_merma($1,'otro',null,$2,1::numeric,null,null)",
        [C.loc1, product],
      ),
    );

  const plantApartado = (
    userId: string,
    C: TestCompany,
    product: string,
    customer: string,
  ) =>
    asUser(db, userId, () =>
      db.query(
        `select create_apartado(
           p_customer_id := $1, p_items := $2::jsonb, p_location_id := $3,
           p_deposit_amount := 0, p_due_date := null, p_payment_method := 'Efectivo'
         )`,
        [customer, JSON.stringify([{ product_id: product, qty: 1 }]), C.loc1],
      ),
    );

  const plantQuote = (userId: string, C: TestCompany, product: string) =>
    asUser(db, userId, () =>
      db.query("select create_quote($1::jsonb,null,null,$2)", [
        JSON.stringify([{ product_id: product, qty: 1 }]),
        C.loc1,
      ]),
    );

  beforeAll(async () => {
    db = await createTestDb();
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: una empresa limpia se restablece y queda con una sucursal nueva", async () => {
    const e = await seed("Empresa limpia");

    expect(await rejects(() => reset(e.admin, "Empresa limpia"))).toBeNull();
    expect(await count("products", e.C.id)).toBe(0);
    expect(await count("locations", e.C.id)).toBe(1);
  });

  it("CONTROL: un cajero NO puede restablecer, ni con el nombre correcto", async () => {
    const e = await seed("Empresa cajero");
    const err = await rejects(() => reset(e.cashier, "Empresa cajero"));

    expect(err).toMatch(/No tienes permiso/i);
    expect(await count("products", e.C.id)).toBe(1);
  });

  it("una merma plantada por un cajero NO bloquea el restablecimiento", async () => {
    const e = await seed("Empresa merma");

    await plantMerma(e.cashier, e.C, e.product);

    expect(await count("mermas", e.C.id)).toBe(1);
    expect(await rejects(() => reset(e.admin, "Empresa merma"))).toBeNull();
    expect(await count("mermas", e.C.id)).toBe(0);
    expect(await count("products", e.C.id)).toBe(0);
  });

  it("un apartado y una cotización tampoco bloquean, y se borran", async () => {
    const e = await seed("Empresa apartado");

    await plantApartado(e.cashier, e.C, e.product, e.customer);
    await plantQuote(e.cashier, e.C, e.product);

    expect(await count("apartados", e.C.id)).toBe(1);
    expect(await count("quotes", e.C.id)).toBe(1);
    expect(await rejects(() => reset(e.admin, "Empresa apartado"))).toBeNull();
    expect(await count("apartados", e.C.id)).toBe(0);
    expect(await count("apartado_items", e.C.id)).toBe(0);
    expect(await count("quotes", e.C.id)).toBe(0);
    expect(await count("quote_items", e.C.id)).toBe(0);
    expect(await count("products", e.C.id)).toBe(0);
    expect(await count("customers", e.C.id)).toBe(0);
  });

  it("CONTROL: restablecer una empresa NO toca los datos de otra", async () => {
    const a = await seed("Empresa A");
    const b = await seed("Empresa B");

    await plantMerma(b.cashier, b.C, b.product);
    await plantApartado(b.cashier, b.C, b.product, b.customer);
    await reset(a.admin, "Empresa A");

    expect(await count("mermas", b.C.id)).toBe(1);
    expect(await count("apartados", b.C.id)).toBe(1);
    expect(await count("products", b.C.id)).toBe(1);
  });

  it("CONTROL: con el nombre equivocado no se borra nada", async () => {
    const e = await seed("Empresa nombre");
    const err = await rejects(() => reset(e.admin, "otra cosa"));

    expect(err).toMatch(/nombre no coincide/i);
    expect(await count("products", e.C.id)).toBe(1);
  });
});

describe("Borrar la cuenta de un empleado que registró mermas", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createTestDb();
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: el empleado sin mermas se borra", async () => {
    const C = await makeCompany(db, "Empresa empleados");
    const worker = await makeUser(db, C.id, "user");

    expect(
      await rejects(() =>
        db.query("delete from public.profiles where id=$1", [worker]),
      ),
    ).toBeNull();
  });

  it("el empleado con mermas se borra y la merma se conserva sin empleado", async () => {
    const C = await makeCompany(db, "Empresa mermas empleado");
    const worker = await makeUser(db, C.id, "user");
    const product = await makeProduct(db, C.id, C.loc1, "P", 1, 100, 500);

    await asUser(db, worker, () =>
      db.query(
        "select register_merma($1,'otro',null,$2,1::numeric,null,null)",
        [C.loc1, product],
      ),
    );

    const err = await rejects(() =>
      db.query("delete from public.profiles where id=$1", [worker]),
    );

    expect(err).toBeNull();

    const { rows } = await db.query<{
      employee_id: string | null;
      registered_by: string | null;
      estimated_loss: string;
    }>(
      "select employee_id, registered_by, estimated_loss from public.mermas where company_id=$1",
      [C.id],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].employee_id).toBeNull();
    expect(rows[0].registered_by).toBeNull();
    expect(Number(rows[0].estimated_loss)).toBe(1);
  });
});
