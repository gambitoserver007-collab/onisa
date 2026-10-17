// Pruebas de las 4 pistas más graves de la auditoría de seguridad 2026-10
// (run-1, perfil quick). Cada prueba afirma el comportamiento SEGURO: si una
// falla, la pista queda confirmada; si pasa, la pista queda descartada.
//
//   Puerta 1  create_sale actualiza puntos de lealtad de un cliente de OTRA
//             empresa (UPDATE por id, sin company_id).
//   Puerta 2  Un admin de otra empresa puede insertar filas en
//             product_locations que apuntan a un producto ajeno.
//   Puerta 3  Re-correr 01_install.sql promueve a Super Admin a quien tenga el
//             correo literal owner@tiendaagil.test.
//   Puerta 4  team-manage-user (y la política RLS de borrado) deja que un admin
//             común toque a un Super Admin de su misma empresa.
//
// Cada puerta trae una prueba "de control" que demuestra que el escenario sí
// funciona en el caso legítimo, para que una prueba segura no pase "en vacío".
// Las puertas 1-3 corren contra el mismo Postgres real (PGlite) que usa
// critical-rpcs.test.ts. La puerta 4 también carga la Edge Function real
// (Deno) con un cliente de Supabase simulado, sin red.
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  asUser,
  createSale,
  createTestDb,
  errMessage,
  getCustomerLoyaltyPoints,
  makeCompany,
  makeCustomer,
  makeProduct,
  makeUser,
  setLoyaltySettings,
  type TestCompany,
} from "./helpers/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Puerta 1: puntos de lealtad de otra empresa
// ---------------------------------------------------------------------------
describe("Puerta 1: create_sale y el cliente de otra empresa", () => {
  let db: PGlite;
  let A: TestCompany;
  let B: TestCompany;
  let adminA: string;
  let prodA: string;

  beforeAll(async () => {
    db = await createTestDb();
    A = await makeCompany(db, "Empresa A (atacante)");
    B = await makeCompany(db, "Empresa B (víctima)");
    adminA = await makeUser(db, A.id, "admin");
    await makeUser(db, B.id, "admin");
    await setLoyaltySettings(db, A.id, {
      enabled: true,
      pointValue: 1,
      earnRate: 10,
    });
    prodA = await makeProduct(db, A.id, A.loc1, "Producto A", 1, 1000, 50);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: una venta a un cliente de la propia empresa sí suma puntos", async () => {
    const ownCustomer = await makeCustomer(db, A.id, "Cliente propio", 0);

    await asUser(db, adminA, () =>
      createSale(
        db,
        [{ product_id: prodA, qty: 1, unit_price: 1000 }],
        A.loc1,
        undefined,
        {
          customerId: ownCustomer,
        },
      ),
    );

    expect(await getCustomerLoyaltyPoints(db, ownCustomer)).toBeGreaterThan(0);
  });

  it("una venta de la empresa A NO modifica los puntos ni el gasto anual de un cliente de la empresa B", async () => {
    const victim = await makeCustomer(db, B.id, "Cliente víctima", 10);

    try {
      await asUser(db, adminA, () =>
        createSale(
          db,
          [{ product_id: prodA, qty: 1, unit_price: 1000 }],
          A.loc1,
          undefined,
          {
            customerId: victim,
          },
        ),
      );
    } catch (err) {
      // Rechazar la venta también es un resultado seguro.
      expect(errMessage(err)).toBeTruthy();
    }

    const { rows } = await db.query<{
      loyalty_points: string;
      loyalty_year_spend: string | null;
    }>(
      "select loyalty_points, loyalty_year_spend from public.customers where id=$1",
      [victim],
    );

    expect(Number(rows[0].loyalty_points)).toBe(10);
    expect(Number(rows[0].loyalty_year_spend ?? 0)).toBe(0);
  });

  it("no queda ningún renglón de bitácora de lealtad de la empresa A apuntando al cliente de la empresa B", async () => {
    const victim = await makeCustomer(db, B.id, "Cliente víctima 2", 10);

    try {
      await asUser(db, adminA, () =>
        createSale(
          db,
          [{ product_id: prodA, qty: 1, unit_price: 1000 }],
          A.loc1,
          undefined,
          {
            customerId: victim,
          },
        ),
      );
    } catch {
      /* rechazar la venta es un resultado seguro */
    }

    const { rows } = await db.query<{ n: string }>(
      "select count(*)::int as n from public.loyalty_ledger where customer_id=$1",
      [victim],
    );

    expect(Number(rows[0].n)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Puerta 2: product_locations apuntando a un producto de otra empresa
// ---------------------------------------------------------------------------
describe("Puerta 2: product_locations y productos de otra empresa", () => {
  let db: PGlite;
  let A: TestCompany;
  let B: TestCompany;
  let adminA: string;
  let adminB: string;

  beforeAll(async () => {
    db = await createTestDb();
    A = await makeCompany(db, "Empresa A (atacante)");
    B = await makeCompany(db, "Empresa B (víctima)");
    adminA = await makeUser(db, A.id, "admin");
    adminB = await makeUser(db, B.id, "admin");
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: el admin de A sí puede crear filas de product_locations de SUS productos", async () => {
    const ownProduct = await makeProduct(db, A.id, A.loc1, "Mío", 1, 10, 5);

    await asUser(db, adminA, () =>
      db.query(
        `insert into public.product_locations (company_id, product_id, location_id, stock, is_active)
         values ($1,$2,$3,7,true)`,
        [A.id, ownProduct, A.loc2],
      ),
    );

    const { rows } = await db.query<{ n: string }>(
      "select count(*)::int as n from public.product_locations where product_id=$1 and location_id=$2",
      [ownProduct, A.loc2],
    );

    expect(Number(rows[0].n)).toBe(1);
  });

  it("el admin de A NO puede insertar una fila de product_locations que apunte a un producto de B", async () => {
    const prodB = await makeProduct(db, B.id, B.loc1, "De B", 1, 10, 5);
    let rejected = false;

    try {
      await asUser(db, adminA, () =>
        db.query(
          `insert into public.product_locations (company_id, product_id, location_id, stock, is_active)
           values ($1,$2,$3,1000,true)`,
          [A.id, prodB, A.loc1],
        ),
      );
    } catch {
      rejected = true;
    }

    const { rows } = await db.query<{ n: string }>(
      "select count(*)::int as n from public.product_locations where product_id=$1 and company_id=$2",
      [prodB, A.id],
    );

    // Seguro = el INSERT fue rechazado y no existe ninguna fila inyectada.
    expect(Number(rows[0].n)).toBe(0);
    expect(rejected).toBe(true);
  });

  it("el stock total del producto de B no se infla después de que B venda una unidad", async () => {
    const prodB = await makeProduct(db, B.id, B.loc1, "De B (venta)", 1, 10, 5);

    try {
      await asUser(db, adminA, () =>
        db.query(
          `insert into public.product_locations (company_id, product_id, location_id, stock, is_active)
           values ($1,$2,$3,1000,true)`,
          [A.id, prodB, A.loc1],
        ),
      );
    } catch {
      /* rechazar el INSERT es un resultado seguro */
    }

    await asUser(db, adminB, () =>
      createSale(db, [{ product_id: prodB, qty: 1, unit_price: 10 }], B.loc1),
    );

    const { rows } = await db.query<{ stock: string }>(
      "select stock from public.products where id=$1",
      [prodB],
    );

    expect(Number(rows[0].stock)).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Puerta 3: el correo fijo del instalador
// ---------------------------------------------------------------------------
describe("Puerta 3: re-correr 01_install.sql y owner@tiendaagil.test", () => {
  let db: PGlite;
  let company: TestCompany;

  const installSql = () =>
    readFileSync(
      path.join(__dirname, "../supabase/install/01_install.sql"),
      "utf-8",
    );

  // Re-corre el instalador completo (es el flujo real documentado). Si el
  // instalador no pudiera re-correrse en PGlite por otra razón, cae a ejecutar
  // solo la sentencia que promueve al owner, para no dejar la prueba muda.
  async function rerunInstaller() {
    try {
      await db.exec(installSql());
    } catch (err) {
      const stmt = installSql().match(
        /UPDATE public\.profiles p\s+SET is_platform_admin = true[\s\S]*?owner@tiendaagil\.test';/i,
      );
      if (!stmt) throw err;
      await db.exec(stmt[0]);
    }
  }

  beforeAll(async () => {
    db = await createTestDb();
    company = await makeCompany(db, "Empresa de un cliente cualquiera");
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: un admin con otro correo NO es promovido al re-correr el instalador", async () => {
    const normalAdmin = await makeUser(db, company.id, "admin");

    await rerunInstaller();

    const { rows } = await db.query<{ is_platform_admin: boolean }>(
      "select is_platform_admin from public.profiles where id=$1",
      [normalAdmin],
    );

    expect(rows[0].is_platform_admin).toBe(false);
  }, 120_000);

  it("un usuario ordinario que registra owner@tiendaagil.test NO se vuelve Super Admin al re-correr el instalador", async () => {
    const impostor = await makeUser(db, company.id, "admin");
    await db.query("update auth.users set email=$2 where id=$1", [
      impostor,
      "owner@tiendaagil.test",
    ]);
    await db.query("update public.profiles set email=$2 where id=$1", [
      impostor,
      "owner@tiendaagil.test",
    ]);

    const before = await db.query<{ is_platform_admin: boolean }>(
      "select is_platform_admin from public.profiles where id=$1",
      [impostor],
    );
    expect(before.rows[0].is_platform_admin).toBe(false);

    await rerunInstaller();

    const after = await db.query<{ is_platform_admin: boolean }>(
      "select is_platform_admin from public.profiles where id=$1",
      [impostor],
    );

    expect(after.rows[0].is_platform_admin).toBe(false);
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Puerta 4a: borrar el perfil de un Super Admin por la política RLS
// ---------------------------------------------------------------------------
describe("Puerta 4a: política RLS 'profiles delete admin'", () => {
  let db: PGlite;
  let company: TestCompany;
  let otherCompany: TestCompany;
  let normalAdmin: string;
  let platformAdmin: string;

  beforeAll(async () => {
    db = await createTestDb();
    company = await makeCompany(db, "Onisa (empresa del dueño)");
    otherCompany = await makeCompany(db, "Otra empresa");
    normalAdmin = await makeUser(db, company.id, "admin");
    platformAdmin = await makeUser(db, company.id, "admin", true);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: un admin NO puede borrar perfiles de otra empresa", async () => {
    const stranger = await makeUser(db, otherCompany.id, "user");

    const res = await asUser(db, normalAdmin, () =>
      db.query("delete from public.profiles where id=$1 returning id", [
        stranger,
      ]),
    );

    expect(res.rows.length).toBe(0);
  });

  it("CONTROL: un admin sí puede borrar el perfil de un cajero de su empresa", async () => {
    const cashier = await makeUser(db, company.id, "user");

    const res = await asUser(db, normalAdmin, () =>
      db.query("delete from public.profiles where id=$1 returning id", [
        cashier,
      ]),
    );

    expect(res.rows.length).toBe(1);
  });

  it("un admin común NO puede borrar el perfil de un Super Admin de su misma empresa", async () => {
    let deleted = 0;

    try {
      const res = await asUser(db, normalAdmin, () =>
        db.query("delete from public.profiles where id=$1 returning id", [
          platformAdmin,
        ]),
      );
      deleted = res.rows.length;
    } catch {
      /* un error también es un resultado seguro */
    }

    const { rows } = await db.query<{ n: string }>(
      "select count(*)::int as n from public.profiles where id=$1",
      [platformAdmin],
    );

    expect(deleted).toBe(0);
    expect(Number(rows[0].n)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Puerta 4b: la Edge Function team-manage-user (código real, cliente simulado)
// ---------------------------------------------------------------------------
type Row = {
  id: string;
  company_id: string;
  full_name: string;
  role: string;
  is_active: boolean;
  is_demo: boolean;
  is_platform_admin: boolean;
  allowed_sections: string[] | null;
  location_id: string | null;
};

const h = vi.hoisted(() => ({
  profiles: new Map<string, unknown>(),
  tokens: new Map<string, string>(),
  calls: {
    updateUserById: [] as { id: string; attrs: unknown }[],
    deleteUser: [] as string[],
    profileUpdates: [] as { id: string; payload: unknown }[],
  },
  client: null as unknown,
}));

vi.mock("https://esm.sh/@supabase/supabase-js@2.45.0", () => ({
  createClient: () => h.client,
}));

function buildFakeClient() {
  const from = (table: string) => {
    const q: { filters: [string, unknown][]; op: string; payload: unknown } = {
      filters: [],
      op: "select",
      payload: null,
    };
    const matches = () =>
      [...h.profiles.values()].filter((r) =>
        q.filters.every(([c, v]) => (r as Record<string, unknown>)[c] === v),
      );
    const exec = async () => {
      if (table === "profiles" && q.op === "update") {
        for (const r of matches()) {
          const id = (r as Row).id;
          h.calls.profileUpdates.push({ id, payload: q.payload });
          Object.assign(r as object, q.payload);
        }
      }

      return { data: null, error: null };
    };
    const b: Record<string, unknown> = {
      select: () => b,
      eq: (c: string, v: unknown) => (q.filters.push([c, v]), b),
      in: () => b,
      maybeSingle: async () => ({
        data: table === "profiles" ? (matches()[0] ?? null) : null,
        error: null,
      }),
      update: (p: unknown) => ((q.op = "update"), (q.payload = p), b),
      insert: async () => ({ data: null, error: null }),
      delete: () => ((q.op = "delete"), b),
      then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
        exec().then(res, rej),
    };

    return b;
  };

  return {
    from,
    auth: {
      getUser: async (token: string) => {
        const id = h.tokens.get(token);

        return id
          ? { data: { user: { id } }, error: null }
          : { data: { user: null }, error: { message: "bad token" } };
      },
      admin: {
        updateUserById: async (id: string, attrs: unknown) => {
          h.calls.updateUserById.push({ id, attrs });

          return { error: null };
        },
        deleteUser: async (id: string) => {
          h.calls.deleteUser.push(id);

          return { error: null };
        },
      },
    },
  };
}

describe("Puerta 4b: Edge Function team-manage-user", () => {
  let handler: (req: Request) => Promise<Response>;

  const companyId = "00000000-0000-4000-8000-000000000010";
  const callerId = "11111111-1111-4111-8111-111111111111";
  const superId = "22222222-2222-4222-8222-222222222222";
  const cashierId = "33333333-3333-4333-8333-333333333333";

  const row = (id: string, over: Partial<Row>): Row => ({
    id,
    company_id: companyId,
    full_name: id.slice(0, 4),
    role: "admin",
    is_active: true,
    is_demo: false,
    is_platform_admin: false,
    allowed_sections: null,
    location_id: null,
    ...over,
  });

  const call = (body: Record<string, unknown>) =>
    handler(
      new Request("http://localhost/team-manage-user", {
        method: "POST",
        headers: {
          Authorization: "Bearer tok-caller",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      }),
    );

  beforeAll(async () => {
    h.client = buildFakeClient();
    (globalThis as Record<string, unknown>).Deno = {
      env: { get: (k: string) => (k === "ALLOWED_ORIGINS" ? "" : "x") },
      serve: (fn: (req: Request) => Promise<Response>) => {
        handler = fn;
      },
    };
    await import("../supabase/functions/team-manage-user/index.ts");
    expect(handler).toBeTypeOf("function");
  });

  beforeEach(() => {
    h.profiles.clear();
    h.tokens.clear();
    h.calls.updateUserById.length = 0;
    h.calls.deleteUser.length = 0;
    h.calls.profileUpdates.length = 0;
    h.tokens.set("tok-caller", callerId);
    h.profiles.set(callerId, row(callerId, { role: "admin" }));
    h.profiles.set(
      superId,
      row(superId, { role: "admin", is_platform_admin: true }),
    );
    h.profiles.set(cashierId, row(cashierId, { role: "user" }));
  });

  it("CONTROL: un admin común SÍ puede cambiar la contraseña de un cajero de su empresa", async () => {
    const res = await call({
      action: "update",
      target_user_id: cashierId,
      password: "dummy-pass-1",
    });

    expect(res.status).toBe(200);
    expect(h.calls.updateUserById).toHaveLength(1);
  });

  it("un admin común NO puede cambiar la contraseña de un Super Admin", async () => {
    const res = await call({
      action: "update",
      target_user_id: superId,
      password: "dummy-pass-1",
    });

    expect(res.status).toBe(403);
    expect(h.calls.updateUserById).toHaveLength(0);
  });

  it("un admin común NO puede borrar a un Super Admin", async () => {
    const res = await call({ action: "delete", target_user_id: superId });

    expect(res.status).toBe(403);
    expect(h.calls.deleteUser).toHaveLength(0);
  });

  it("un admin común NO puede desactivar a un Super Admin", async () => {
    const res = await call({
      action: "update",
      target_user_id: superId,
      is_active: false,
    });

    expect(res.status).toBe(403);
    expect(h.calls.profileUpdates).toHaveLength(0);
    expect((h.profiles.get(superId) as Row).is_active).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Segunda pasada, CRÍTICO: profiles INSERT -> Super Admin
// ---------------------------------------------------------------------------
describe("Crítico: borrar el propio perfil + INSERT con is_platform_admin", () => {
  let db: PGlite;
  let c1: TestCompany;
  let c2: TestCompany;
  let u1: string;
  let u2: string;

  beforeAll(async () => {
    db = await createTestDb();
    c1 = await makeCompany(db, "Empresa 1");
    c2 = await makeCompany(db, "Empresa 2");
    u1 = await makeUser(db, c1.id, "admin");
    u2 = await makeUser(db, c2.id, "admin");
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: el registro normal (alta en auth.users) sigue creando su perfil, sin Super Admin", async () => {
    const id = crypto.randomUUID();

    await db.query(
      "insert into auth.users (id, email, raw_user_meta_data) values ($1,$2,$3)",
      [id, "nuevo@test.local", JSON.stringify({ company_name: "Nueva SA" })],
    );

    const { rows } = await db.query<{
      is_platform_admin: boolean;
      role: string;
    }>("select is_platform_admin, role from public.profiles where id=$1", [id]);

    expect(rows).toHaveLength(1);
    expect(rows[0].is_platform_admin).toBe(false);
  });

  it("un admin NO puede insertar filas en profiles (ni con is_platform_admin ni sin él)", async () => {
    const victim = crypto.randomUUID();

    await db.query("insert into auth.users (id, email) values ($1,$2)", [
      victim,
      "victima@test.local",
    ]);
    await db.query("delete from public.profiles where id=$1", [victim]);

    for (const platformFlag of [true, false]) {
      const rejected = await asUser(db, u2, () =>
        db
          .query(
            `insert into public.profiles (id, company_id, email, full_name, role, is_platform_admin)
             values ($1,$2,'x@test.local','x','admin',$3)`,
            [victim, c2.id, platformFlag],
          )
          .then(() => false)
          .catch(() => true),
      );

      expect(rejected).toBe(true);
    }

    const { rows } = await db.query<{ n: string }>(
      "select count(*)::int as n from public.profiles where id=$1",
      [victim],
    );

    expect(Number(rows[0].n)).toBe(0);
  });

  it("la cuenta 1 borra su perfil y la cuenta 2 no puede reinsertarlo como Super Admin", async () => {
    await asUser(db, u1, () =>
      db.query("delete from public.profiles where id=$1", [u1]),
    );

    await asUser(db, u2, () =>
      db
        .query(
          `insert into public.profiles (id, company_id, email, full_name, role, is_platform_admin)
           values ($1,$2,'x@test.local','x','admin',true)`,
          [u1, c2.id],
        )
        .catch(() => undefined),
    );

    const { rows } = await asUser(db, u1, () =>
      db.query<{ p: boolean }>(
        "select public.current_user_is_platform_admin() as p",
      ),
    );

    expect(rows[0].p).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Segunda pasada: el segundo correo fijo del instalador
// ---------------------------------------------------------------------------
describe("Correo fijo anunciosfbads2@gmail.com en el instalador", () => {
  let db: PGlite;
  let company: TestCompany;

  beforeAll(async () => {
    db = await createTestDb();
    company = await makeCompany(db, "Empresa de un cliente");
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  const rerunInstaller = () =>
    db.exec(
      readFileSync(
        path.join(__dirname, "../supabase/install/01_install.sql"),
        "utf-8",
      ),
    );

  it("CONTROL: un empleado sí puede editar su propio correo de perfil y un re-run no cambia su rol", async () => {
    const cashier = await makeUser(db, company.id, "user");

    await asUser(db, cashier, () =>
      db.query(
        "update public.profiles set email='otro@test.local' where id=$1",
        [cashier],
      ),
    );
    await rerunInstaller();

    const { rows } = await db.query<{ role: string }>(
      "select role from public.profiles where id=$1",
      [cashier],
    );

    expect(rows[0].role).toBe("user");
  }, 120_000);

  it("un empleado que se pone ese correo NO queda como admin al re-correr el instalador", async () => {
    const cashier = await makeUser(db, company.id, "user");

    await asUser(db, cashier, () =>
      db.query(
        "update public.profiles set email='anunciosfbads2@gmail.com' where id=$1",
        [cashier],
      ),
    );
    await rerunInstaller();

    const { rows } = await db.query<{ role: string }>(
      "select role from public.profiles where id=$1",
      [cashier],
    );

    expect(rows[0].role).toBe("user");
  }, 120_000);
});

// ---------------------------------------------------------------------------
// Segunda pasada: clientes inventados (INSERT con puntos / saldo)
// ---------------------------------------------------------------------------
describe("Clientes inventados: INSERT con puntos o saldo de crédito", () => {
  let db: PGlite;
  let company: TestCompany;
  let cashier: string;
  let admin: string;
  let product: string;

  const insertCustomer = (
    userId: string,
    cols: string,
    values: (string | number)[],
  ) =>
    asUser(db, userId, () =>
      db.query<{ id: string }>(
        `insert into public.customers (company_id, name, ${cols})
         values ($1, 'Cliente', ${values.map((_, i) => `$${i + 2}`).join(", ")})
         returning id`,
        [company.id, ...values],
      ),
    );

  beforeAll(async () => {
    db = await createTestDb();
    company = await makeCompany(db, "Empresa clientes");
    cashier = await makeUser(db, company.id, "user");
    admin = await makeUser(db, company.id, "admin");
    await setLoyaltySettings(db, company.id, {
      enabled: true,
      pointValue: 1,
      earnRate: 100,
    });
    product = await makeProduct(db, company.id, company.loc1, "P", 1, 100, 50);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: un cajero sí puede crear un cliente normal (saldos en cero) y un admin con límite de crédito", async () => {
    const plain = await insertCustomer(cashier, "phone", ["555"]);
    const withLimit = await insertCustomer(admin, "credit_limit", [500]);

    expect(plain.rows).toHaveLength(1);
    expect(withLimit.rows).toHaveLength(1);
  });

  it("un cajero NO puede crear un cliente con puntos de lealtad inventados", async () => {
    const err = await insertCustomer(cashier, "loyalty_points", [100000])
      .then(() => null)
      .catch((e) => errMessage(e));

    expect(err).toMatch(/cliente nuevo/i);
  });

  it("un cajero NO puede crear un cliente con saldo de crédito (ni negativo) ni gasto anual", async () => {
    for (const [col, val] of [
      ["credit_balance", -50000],
      ["credit_balance", 10],
      ["loyalty_year_spend", 1000],
    ] as const) {
      const err = await insertCustomer(cashier, col, [val])
        .then(() => null)
        .catch((e) => errMessage(e));

      expect(err).toMatch(/cliente nuevo/i);
    }
  });

  it("ni siquiera un admin de empresa puede sembrar puntos o saldo al crear un cliente", async () => {
    const err = await insertCustomer(admin, "loyalty_points", [500])
      .then(() => null)
      .catch((e) => errMessage(e));

    expect(err).toMatch(/cliente nuevo/i);
  });

  it("CONTROL: los puntos siguen ganándose por venta (create_sale con cliente propio)", async () => {
    const created = await insertCustomer(cashier, "phone", ["777"]);

    await asUser(db, cashier, () =>
      createSale(
        db,
        [{ product_id: product, qty: 1, unit_price: 100 }],
        company.loc1,
        undefined,
        { customerId: created.rows[0].id },
      ),
    );

    expect(
      await getCustomerLoyaltyPoints(db, created.rows[0].id),
    ).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Segunda pasada: variantes de producto de otra empresa
// ---------------------------------------------------------------------------
describe("Variantes: colgarlas de un producto de otra empresa", () => {
  let db: PGlite;
  let A: TestCompany;
  let B: TestCompany;
  let adminA: string;
  let ownProduct: string;
  let foreignProduct: string;

  beforeAll(async () => {
    db = await createTestDb();
    A = await makeCompany(db, "Empresa A");
    B = await makeCompany(db, "Empresa B");
    adminA = await makeUser(db, A.id, "admin");
    ownProduct = await makeProduct(db, A.id, A.loc1, "Mío", 1, 10, 5);
    foreignProduct = await makeProduct(db, B.id, B.loc1, "De B", 1, 10, 5);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  const insertVariant = (productId: string) =>
    asUser(db, adminA, () =>
      db.query<{ id: string }>(
        "insert into public.product_variants (company_id, product_id, attributes) values ($1,$2,'{}'::jsonb) returning id",
        [A.id, productId],
      ),
    );

  it("CONTROL: el admin sí puede crear variantes y stock de variante en SU producto y SU sucursal", async () => {
    const variant = await insertVariant(ownProduct);

    await asUser(db, adminA, () =>
      db.query(
        "insert into public.product_variant_locations (company_id, product_variant_id, location_id, stock) values ($1,$2,$3,7)",
        [A.id, variant.rows[0].id, A.loc1],
      ),
    );

    const { rows } = await db.query<{ n: string }>(
      "select count(*)::int as n from public.product_variant_locations where product_variant_id=$1",
      [variant.rows[0].id],
    );

    expect(Number(rows[0].n)).toBe(1);
  });

  it("el admin de A NO puede crear una variante que cuelgue de un producto de B", async () => {
    const err = await insertVariant(foreignProduct)
      .then(() => null)
      .catch((e) => errMessage(e));

    expect(err).toMatch(/row-level security/i);

    const { rows } = await db.query<{ n: string }>(
      "select count(*)::int as n from public.product_variants where product_id=$1",
      [foreignProduct],
    );

    expect(Number(rows[0].n)).toBe(0);
  });

  it("el admin de A NO puede ponerle stock a una variante de B, ni usar una sucursal de B", async () => {
    // Variante legítima de B (la crea el sistema, como superusuario).
    const vB = crypto.randomUUID();

    await db.query(
      "insert into public.product_variants (id, company_id, product_id, attributes) values ($1,$2,$3,'{}'::jsonb)",
      [vB, B.id, foreignProduct],
    );

    const onForeignVariant = await asUser(db, adminA, () =>
      db.query(
        "insert into public.product_variant_locations (company_id, product_variant_id, location_id, stock) values ($1,$2,$3,1000)",
        [A.id, vB, A.loc1],
      ),
    )
      .then(() => null)
      .catch((e) => errMessage(e));

    const ownVariant = (await insertVariant(ownProduct)).rows[0].id;
    const onForeignLocation = await asUser(db, adminA, () =>
      db.query(
        "insert into public.product_variant_locations (company_id, product_variant_id, location_id, stock) values ($1,$2,$3,1000)",
        [A.id, ownVariant, B.loc1],
      ),
    )
      .then(() => null)
      .catch((e) => errMessage(e));

    expect(onForeignVariant).toMatch(/row-level security/i);
    expect(onForeignLocation).toBeTruthy();
  });

  it("CONTROL: sync_product_variants del admin sigue funcionando", async () => {
    const err = await asUser(db, adminA, () =>
      db.query("select sync_product_variants($1, $2, $3::jsonb)", [
        ownProduct,
        ["Talla"],
        JSON.stringify([
          {
            attributes: { Talla: "L" },
            price_override: 12,
            cost_override: 5,
            locations: [{ location_id: A.loc1, stock: 3 }],
          },
        ]),
      ]),
    )
      .then(() => null)
      .catch((e) => errMessage(e));

    expect(err).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Segunda pasada: quién fija el límite de crédito de un cliente
// ---------------------------------------------------------------------------
describe("Límite de crédito de un cliente (credit_limit)", () => {
  let db: PGlite;
  let company: TestCompany;
  let cashier: string;
  let admin: string;
  let product: string;

  const insertWithLimit = (userId: string, limit: number) =>
    asUser(db, userId, () =>
      db.query<{ id: string }>(
        "insert into public.customers (company_id, name, credit_limit) values ($1,'Cliente',$2) returning id",
        [company.id, limit],
      ),
    );

  beforeAll(async () => {
    db = await createTestDb();
    company = await makeCompany(db, "Empresa crédito");
    cashier = await makeUser(db, company.id, "user");
    admin = await makeUser(db, company.id, "admin");
    product = await makeProduct(db, company.id, company.loc1, "P", 1, 100, 50);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: un admin sí puede crear un cliente con límite y editarlo", async () => {
    const created = await insertWithLimit(admin, 500);

    await asUser(db, admin, () =>
      db.query("update public.customers set credit_limit=800 where id=$1", [
        created.rows[0].id,
      ]),
    );

    const { rows } = await db.query<{ credit_limit: string }>(
      "select credit_limit from public.customers where id=$1",
      [created.rows[0].id],
    );

    expect(Number(rows[0].credit_limit)).toBe(800);
  });

  it("CONTROL: un cajero sí puede crear un cliente normal (sin límite) y cambiarle el teléfono", async () => {
    const created = await asUser(db, cashier, () =>
      db.query<{ id: string }>(
        "insert into public.customers (company_id, name, credit_limit) values ($1,'Normal',0) returning id",
        [company.id],
      ),
    );

    await asUser(db, cashier, () =>
      db.query("update public.customers set phone='555' where id=$1", [
        created.rows[0].id,
      ]),
    );

    expect(created.rows).toHaveLength(1);
  });

  it("un cajero NO puede crear un cliente con límite de crédito", async () => {
    const err = await insertWithLimit(cashier, 50000)
      .then(() => null)
      .catch((e) => errMessage(e));

    expect(err).toMatch(/administrador/i);
  });

  it("un cajero NO puede subir el límite de crédito de un cliente existente", async () => {
    const existing = await makeCustomer(db, company.id, "Existente", 0);

    const err = await asUser(db, cashier, () =>
      db.query("update public.customers set credit_limit=9999 where id=$1", [
        existing,
      ]),
    )
      .then(() => null)
      .catch((e) => errMessage(e));

    expect(err).toMatch(/administrador/i);

    const { rows } = await db.query<{ credit_limit: string }>(
      "select credit_limit from public.customers where id=$1",
      [existing],
    );

    expect(Number(rows[0].credit_limit)).toBe(0);
  });

  it("CONTROL: la venta a crédito sigue funcionando con el límite que fijó el admin", async () => {
    const created = await insertWithLimit(admin, 1000);

    await asUser(db, cashier, () =>
      db.query(
        "select create_sale($1,'Ticket','Credito',$2::jsonb,$3,null,null,0,null,'credit')",
        [
          created.rows[0].id,
          JSON.stringify([{ product_id: product, qty: 1, unit_price: 100 }]),
          company.loc1,
        ],
      ),
    );

    const { rows } = await db.query<{ credit_balance: string }>(
      "select credit_balance from public.customers where id=$1",
      [created.rows[0].id],
    );

    expect(Number(rows[0].credit_balance)).toBeGreaterThan(0);
  });
});
