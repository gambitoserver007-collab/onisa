// Auditoría de seguridad 2026-10 (4ª pasada): la suspensión de la plataforma.
// mp-cancel-subscription pisaba cualquier estado con 'cancelled' (también
// 'suspended') y mp-create-subscription no revisaba el estado, así que una
// empresa suspendida podía borrar su suspensión: cancelar -> volver a
// suscribirse -> el webhook ya no la veía como 'suspended' y la activaba.
// Cada puerta trae CONTROLES: lo legítimo sigue funcionando.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeSupabase, type FakeSupabase } from "./helpers/fakeSupabase";

const h = vi.hoisted(() => ({ fake: null as unknown as { client: unknown } }));

vi.mock("https://esm.sh/@supabase/supabase-js@2.45.0", () => ({
  createClient: () => h.fake.client,
}));

const fake: FakeSupabase = createFakeSupabase();

h.fake = fake;

type Handler = (req: Request) => Promise<Response>;

const handlers: Handler[] = [];

beforeAll(async () => {
  (globalThis as Record<string, unknown>).Deno = {
    env: {
      get: (k: string) =>
        ({
          MERCADOPAGO_WEBHOOK_SECRET: "whsec-dummy",
          MERCADOPAGO_ACCESS_TOKEN: "mp-token-dummy",
          ALLOWED_ORIGINS: "",
        })[k] ?? "x",
    },
    serve: (fn: Handler) => {
      handlers.push(fn);
    },
  };
  await import("../supabase/functions/mp-cancel-subscription/index.ts");
  await import("../supabase/functions/mp-create-subscription/index.ts");
  await import("../supabase/functions/mp-webhook/index.ts");
});

beforeEach(() => {
  fake.reset();
});

const companyId = "c0000000-0000-4000-8000-000000000009";
const adminId = "a0000000-0000-4000-8000-000000000001";

const AUTH = {
  Authorization: "Bearer tok",
  "Content-Type": "application/json",
};

const seed = (status: string) => {
  fake.tokens.set("tok", adminId);
  fake.tables.profiles = [
    {
      id: adminId,
      company_id: companyId,
      role: "admin",
      is_active: true,
      is_demo: false,
      email: "a@x.test",
    },
  ];
  fake.tables.companies = [
    {
      id: companyId,
      name: "C",
      subscription_status: status,
      plan_id: "plan-A",
    },
  ];
  fake.tables.subscription_plans = [
    { id: "plan-P", name: "P", price: 299, is_active: true },
  ];
  fake.tables.company_subscriptions = [
    {
      company_id: companyId,
      plan_id: "plan-P",
      provider_subscription_id: "pre-1",
      status: "authorized",
    },
  ];
  vi.stubGlobal("fetch", async (url: string, init?: { method?: string }) => {
    const u = String(url);

    if (u.endsWith("/preapproval") && init?.method === "POST") {
      return {
        ok: true,
        json: async () => ({ id: "pre-2", init_point: "https://mp/x" }),
      };
    }
    if (u.includes("preapproval/pre-1") && init?.method === "PUT") {
      return { ok: true, json: async () => ({}) };
    }
    if (u.includes("preapproval/pre-2")) {
      return {
        ok: true,
        json: async () => ({
          status: "authorized",
          external_reference: companyId,
          auto_recurring: { transaction_amount: 299, currency_id: "MXN" },
        }),
      };
    }

    return { ok: false, json: async () => ({}) };
  });
};

const status = () =>
  (
    fake.tables.companies.find((r) => r.id === companyId) as {
      subscription_status: string;
    }
  ).subscription_status;

const subscriptionId = () =>
  (
    fake.tables.company_subscriptions.find(
      (r) => r.company_id === companyId,
    ) as { provider_subscription_id: string }
  ).provider_subscription_id;

const cancel = () =>
  handlers[0](
    new Request("http://localhost/mp-cancel-subscription", {
      method: "POST",
      headers: AUTH,
      body: "{}",
    }),
  );

const create = () =>
  handlers[1](
    new Request("http://localhost/mp-create-subscription", {
      method: "POST",
      headers: AUTH,
      body: JSON.stringify({ plan_id: "plan-P" }),
    }),
  );

async function signedWebhook(dataId: string) {
  const ts = "1700000000";
  const manifest = `id:${dataId.toLowerCase()};request-id:req-1;ts:${ts};`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode("whsec-dummy"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(manifest),
  );
  const hex = Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return handlers[2](
    new Request("http://localhost/mp-webhook", {
      method: "POST",
      headers: {
        "x-signature": `ts=${ts},v1=${hex}`,
        "x-request-id": "req-1",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type: "subscription_preapproval",
        data: { id: dataId },
      }),
    }),
  );
}

describe("Empresa suspendida por la plataforma", () => {
  it("NO puede cancelar su suscripción (no borra la suspensión)", async () => {
    seed("suspended");

    const res = await cancel();

    expect(res.status).toBe(403);
    expect(status()).toBe("suspended");
  });

  it("NO puede crear una suscripción nueva", async () => {
    seed("suspended");

    const res = await create();

    expect(res.status).toBe(403);
    expect(subscriptionId()).toBe("pre-1");
  });

  it("la cadena completa cancelar -> crear -> pagar sigue dejándola suspendida", async () => {
    seed("suspended");

    await cancel();
    await create();
    await signedWebhook("pre-2");
    await signedWebhook("pre-1");

    expect(status()).toBe("suspended");
  });
});

describe("Controles: las empresas que no están suspendidas siguen funcionando", () => {
  it("una empresa activa sí cancela su suscripción", async () => {
    seed("active");

    const res = await cancel();

    expect(res.status).toBe(200);
    expect(status()).toBe("cancelled");
  });

  it("una empresa activa sí crea una suscripción", async () => {
    seed("active");

    const res = await create();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.init_point).toBeTruthy();
    expect(subscriptionId()).toBe("pre-2");
  });

  it("una empresa vencida ('expired') puede volver a contratar un plan para renovar", async () => {
    seed("expired");

    expect((await create()).status).toBe(200);

    await signedWebhook("pre-2");

    expect(status()).toBe("active");
  });
});
