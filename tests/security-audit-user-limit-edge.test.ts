// Auditoría de seguridad 2026-10 (5ª pasada): límite de usuarios del plan.
// Las Edge Functions contaban los usuarios y DESPUÉS creaban/reactivaban; ahora
// la base (trigger enforce_user_limit) lo hace valer con candado por empresa y
// las funciones traducen ese rechazo a 409 (y, al crear, borran la cuenta de
// Auth recién creada para no dejar un login huérfano).
// Cargan el código REAL con un cliente de Supabase simulado; sin red.
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

beforeAll(async () => {
  let loading = "";

  (globalThis as Record<string, unknown>).Deno = {
    env: { get: (k: string) => (k === "ALLOWED_ORIGINS" ? "" : "x") },
    serve: (fn: Handler) => {
      handlers[loading] = fn;
    },
  };
  loading = "create";
  await import("../supabase/functions/team-create-user/index.ts");
  loading = "manage";
  await import("../supabase/functions/team-manage-user/index.ts");
});

beforeEach(() => {
  fake.reset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

const companyId = "c0000000-0000-4000-8000-000000000001";
const adminId = "a0000000-0000-4000-8000-000000000001";
const inactiveId = "a0000000-0000-4000-8000-000000000003";

const profile = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  company_id: companyId,
  full_name: id.slice(-4),
  role: "user",
  is_active: true,
  is_demo: false,
  is_platform_admin: false,
  allowed_sections: null,
  location_id: null,
  ...over,
});

const seed = (
  userLimit: number,
  extraProfiles: Record<string, unknown>[] = [],
) => {
  fake.tokens.set("tok", adminId);
  fake.tables.profiles = [
    profile(adminId, { role: "admin" }),
    ...extraProfiles,
  ];
  fake.tables.companies = [{ id: companyId, plan_id: "plan-1" }];
  fake.tables.subscription_plans = [{ id: "plan-1", user_limit: userLimit }];
};

const post = (name: "create" | "manage", body: unknown) =>
  handlers[name](
    new Request(`http://localhost/${name}`, {
      method: "POST",
      headers: {
        Authorization: "Bearer tok",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );

const newUser = {
  company_id: companyId,
  full_name: "Nuevo",
  email: "nuevo@example.com",
  password: "una-clave-larga-123",
  role: "user",
};

describe("team-create-user: límite de usuarios que hace valer la base", () => {
  it("CONTROL: con espacio en el plan el usuario se crea", async () => {
    seed(3);

    const res = await post("create", newUser);

    expect(res.status).toBe(200);
    expect(fake.calls.createUser).toHaveLength(1);
    expect(fake.calls.deleteUser).toHaveLength(0);
  });

  it("si la base rechaza el perfil por el límite (petición simultánea), responde 409 y borra la cuenta de Auth", async () => {
    seed(3);
    fake.failWrites.push({
      table: "profiles",
      op: "upsert",
      message:
        "Se alcanzo el limite de usuarios de tu plan (3). Actualiza tu plan para agregar mas usuarios.",
    });

    const res = await post("create", newUser);
    const body = (await res.json()) as { error: string };

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/límite de usuarios/i);
    expect(fake.calls.deleteUser).toEqual(["new-user-1"]);
  });

  it("CONTROL: otro fallo del perfil NO se confunde con el límite (sigue siendo 500, sin borrar nada)", async () => {
    seed(3);
    fake.failWrites.push({
      table: "profiles",
      op: "upsert",
      message: "violates foreign key constraint",
    });

    const res = await post("create", newUser);

    expect(res.status).toBe(500);
    expect(fake.calls.deleteUser).toHaveLength(0);
  });
});

describe("team-manage-user: reactivación simultánea contra el límite", () => {
  it("si la base rechaza la reactivación por el límite, responde 409", async () => {
    seed(3, [profile(inactiveId, { is_active: false })]);
    fake.failWrites.push({
      table: "profiles",
      op: "update",
      message: "Se alcanzo el limite de usuarios de tu plan (3).",
    });

    const res = await post("manage", {
      action: "update",
      target_user_id: inactiveId,
      is_active: true,
    });

    expect(res.status).toBe(409);
    expect(
      (
        fake.tables.profiles.find((r) => r.id === inactiveId) as {
          is_active: boolean;
        }
      ).is_active,
    ).toBe(false);
  });
});
