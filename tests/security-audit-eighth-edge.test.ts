// Auditoría de seguridad 2026-10 (8ª pasada): Edge Functions.
//   · El predicado de "cuenta demo" de las funciones es el mismo de la base
//     (is_demo O demo_mode = 'read_only').
//   · team-manage-user cierra las sesiones al cambiar la contraseña o desactivar.
//   · create-quote-request: tope de solicitudes pendientes, cantidades acotadas y
//     sin encabezados huérfanos.
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createFakeSupabase, type FakeSupabase } from "./helpers/fakeSupabase";

const h = vi.hoisted(() => ({ fake: null as unknown as { client: unknown } }));

vi.mock("https://esm.sh/@supabase/supabase-js@2.45.0", () => ({
  createClient: () => h.fake.client,
}));

const fake: FakeSupabase = createFakeSupabase();

h.fake = fake;

type Handler = (req: Request) => Promise<Response>;

const handlers: Record<string, Handler> = {};
const order = [
  "team-manage-user",
  "team-create-user",
  "mp-cancel-subscription",
  "mp-create-subscription",
  "create-quote-request",
  "admin-create-company",
];

beforeAll(async () => {
  let n = 0;

  (globalThis as Record<string, unknown>).Deno = {
    env: { get: (k: string) => ({ ALLOWED_ORIGINS: "" })[k] ?? "x" },
    serve: (fn: Handler) => {
      handlers[order[n++]] = fn;
    },
  };
  for (const name of order) {
    await import(`../supabase/functions/${name}/index.ts`);
  }
});

beforeEach(() => {
  fake.reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const post = (name: string, body: unknown, token = "tok") =>
  handlers[name](
    new Request(`http://localhost/${name}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );

const company = "c0000000-0000-4000-8000-000000000001";
const adminId = "a0000000-0000-4000-8000-000000000001";
const targetId = "a0000000-0000-4000-8000-000000000002";

const profile = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  company_id: company,
  full_name: id.slice(-4),
  role: "user",
  is_active: true,
  is_demo: false,
  demo_mode: "none",
  is_platform_admin: false,
  allowed_sections: null,
  location_id: null,
  email: "a@example.test",
  ...over,
});

const seedTeam = (adminOver: Record<string, unknown> = {}) => {
  fake.tokens.set("tok", adminId);
  fake.tables.profiles = [
    profile(adminId, { role: "admin", ...adminOver }),
    profile(targetId),
  ];
  fake.tables.companies = [{ id: company, plan_id: null }];
};

describe("Cuenta demo: el predicado de las funciones es el de la base", () => {
  const readOnlyAdmin = { demo_mode: "read_only" };

  it("team-manage-user: un admin con demo_mode='read_only' (is_demo=false) se rechaza", async () => {
    seedTeam(readOnlyAdmin);

    const res = await post("team-manage-user", {
      action: "update",
      target_user_id: targetId,
      password: "nueva-clave-1",
    });

    expect(res.status).toBe(403);
    expect(fake.calls.updateUserById).toHaveLength(0);
  });

  it("CONTROL: el mismo admin con demo_mode='none' sí cambia la contraseña", async () => {
    seedTeam();

    const res = await post("team-manage-user", {
      action: "update",
      target_user_id: targetId,
      password: "nueva-clave-1",
    });

    expect(res.status).toBe(200);
    expect(fake.calls.updateUserById).toHaveLength(1);
  });

  it("team-create-user rechaza a un admin con demo_mode='read_only'", async () => {
    seedTeam(readOnlyAdmin);

    const res = await post("team-create-user", {
      company_id: company,
      full_name: "Nuevo",
      email: "nuevo@example.test",
      password: "clave-larga-1",
      role: "admin",
    });

    expect(res.status).toBe(403);
    expect(fake.calls.createUser).toHaveLength(0);
  });

  it("mp-cancel-subscription y mp-create-subscription rechazan a un admin con demo_mode='read_only'", async () => {
    seedTeam(readOnlyAdmin);
    fake.tables.company_subscriptions = [
      { company_id: company, status: "active" },
    ];

    const cancel = await post("mp-cancel-subscription", {});
    const create = await post("mp-create-subscription", { plan_id: "p" });

    expect(cancel.status).toBe(403);
    expect(create.status).toBe(403);
    expect(
      (fake.tables.companies[0] as { subscription_status?: string })
        .subscription_status,
    ).toBeUndefined();
  });

  it("admin-create-company rechaza a un super admin con demo_mode='read_only'", async () => {
    seedTeam({ is_platform_admin: true, demo_mode: "read_only" });

    const res = await post("admin-create-company", {
      name: "Nueva",
      owner_email: "dueno@example.test",
      owner_password: "clave-larga-1",
    });

    expect(res.status).toBe(403);
    expect(fake.tables.companies).toHaveLength(1);
  });
});

describe("team-manage-user cierra las sesiones de la cuenta", () => {
  it("al cambiar la contraseña se revocan las sesiones del empleado", async () => {
    seedTeam();

    const res = await post("team-manage-user", {
      action: "update",
      target_user_id: targetId,
      password: "nueva-clave-1",
    });
    const body = (await res.json()) as {
      ok: boolean;
      sessions_revoked: boolean;
    };

    expect(res.status).toBe(200);
    expect(body.sessions_revoked).toBe(true);
    expect(fake.calls.rpc).toEqual([
      { name: "revoke_user_sessions", args: { p_user_id: targetId } },
    ]);
  });

  it("al desactivar a un empleado se revocan sus sesiones", async () => {
    seedTeam();

    const res = await post("team-manage-user", {
      action: "update",
      target_user_id: targetId,
      is_active: false,
    });

    expect(res.status).toBe(200);
    expect(fake.calls.rpc.map((c) => c.name)).toEqual(["revoke_user_sessions"]);
  });

  it("CONTROL: cambiar solo el nombre o el rol no toca las sesiones", async () => {
    seedTeam();

    const res = await post("team-manage-user", {
      action: "update",
      target_user_id: targetId,
      role: "finanzas",
    });

    expect(res.status).toBe(200);
    expect(fake.calls.rpc).toHaveLength(0);
  });
});

describe("create-quote-request: tope, cantidades y encabezados huérfanos", () => {
  const items = [{ product_id: "p1", qty: 2 }];
  const request = (over: Record<string, unknown> = {}) =>
    post(
      "create-quote-request",
      {
        company_slug: "tienda",
        customer_name: "Visitante",
        phone: "5551234567",
        turnstile_token: "ok",
        items,
        ...over,
      },
      "anon",
    );

  const seed = (pending = 0) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ success: true }))),
    );
    fake.tables.companies = [
      { id: company, slug: "tienda", online_catalog_enabled: true },
    ];
    fake.tables.products = [
      {
        id: "p1",
        name: "Producto",
        company_id: company,
        show_online: true,
        active: true,
      },
    ];
    fake.tables.quote_requests = Array.from({ length: pending }, (_, i) => ({
      id: `r${i}`,
      company_id: company,
      status: "nueva",
    }));
  };

  it("CONTROL: una solicitud normal se guarda", async () => {
    seed();

    const res = await request();

    expect(res.status).toBe(200);
    expect(fake.tables.quote_requests).toHaveLength(1);
    expect(fake.tables.quote_request_items).toHaveLength(1);
  });

  it("con 300 solicitudes sin atender ya no se aceptan más (429)", async () => {
    seed(300);

    const res = await request();

    expect(res.status).toBe(429);
    expect(fake.tables.quote_requests).toHaveLength(300);
  });

  it("cantidades fuera de rango (1e9, 0.0004, Infinity) se rechazan antes de tocar la base", async () => {
    seed();

    for (const qty of [1e9, 0.0004, "Infinity", -1]) {
      const res = await request({ items: [{ product_id: "p1", qty }] });

      expect(res.status, String(qty)).toBe(400);
    }
    expect(fake.tables.quote_requests).toHaveLength(0);
  });

  it("si fallan los renglones, no queda un encabezado huérfano", async () => {
    seed();
    fake.failWrites.push({
      table: "quote_request_items",
      op: "insert",
      message: "boom",
    });

    const res = await request();

    expect(res.status).toBe(500);
    expect(fake.tables.quote_requests).toHaveLength(0);
  });
});
