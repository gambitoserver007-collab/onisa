// Pruebas de las Edge Functions (Deno) de la auditoría de seguridad 2026-10:
//   Puerta 5   mp-webhook: el plan solo se otorga si el aviso es del
//              preapproval guardado (no de uno viejo/más barato).
//   Puerta 11  team-manage-user: reactivar usuarios respeta el límite del plan.
//   Puerta 12  mp-webhook: los cambios de estado (pausa/cancelación) se
//              aplican, y un fallo de Mercado Pago no se marca como procesado.
// Cargan el código REAL de cada función con un cliente de Supabase simulado
// (tests/helpers/fakeSupabase.ts) y un fetch simulado; sin red.
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
  await import("../supabase/functions/team-manage-user/index.ts");
  await import("../supabase/functions/mp-webhook/index.ts");
});

beforeEach(() => {
  fake.reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Puerta 11: límite de usuarios al reactivar
// ---------------------------------------------------------------------------
describe("Puerta 11: team-manage-user y el límite de usuarios del plan", () => {
  const companyId = "c0000000-0000-4000-8000-000000000001";
  const adminId = "a0000000-0000-4000-8000-000000000001";
  const activeId = "a0000000-0000-4000-8000-000000000002";
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

  const reactivate = () =>
    handlers[0](
      new Request("http://localhost/team-manage-user", {
        method: "POST",
        headers: {
          Authorization: "Bearer tok",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "update",
          target_user_id: inactiveId,
          is_active: true,
        }),
      }),
    );

  const seed = (userLimit: number) => {
    fake.tokens.set("tok", adminId);
    fake.tables.profiles = [
      profile(adminId, { role: "admin" }),
      profile(activeId),
      profile(inactiveId, { is_active: false }),
    ];
    fake.tables.companies = [{ id: companyId, plan_id: "plan-1" }];
    fake.tables.subscription_plans = [{ id: "plan-1", user_limit: userLimit }];
  };

  it("CONTROL: con espacio en el plan, reactivar a un usuario sí funciona", async () => {
    seed(3);

    const res = await reactivate();

    expect(res.status).toBe(200);
    expect(
      (
        fake.tables.profiles.find((r) => r.id === inactiveId) as {
          is_active: boolean;
        }
      ).is_active,
    ).toBe(true);
  });

  it("con el plan lleno, reactivar a un usuario se rechaza y sigue inactivo", async () => {
    seed(2);

    const res = await reactivate();

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

// ---------------------------------------------------------------------------
// Puertas 5 y 12: mp-webhook
// ---------------------------------------------------------------------------
describe("mp-webhook (puertas 5 y 12)", () => {
  const companyId = "c0000000-0000-4000-8000-000000000009";
  const SECRET = "whsec-dummy";

  async function signedRequest(type: string, dataId: string) {
    const ts = "1700000000";
    const requestId = "req-1";
    const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(SECRET),
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

    return new Request("http://localhost/mp-webhook", {
      method: "POST",
      headers: {
        "x-signature": `ts=${ts},v1=${hex}`,
        "x-request-id": requestId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ type, data: { id: dataId } }),
    });
  }

  const call = async (type: string, dataId: string) =>
    handlers[1](await signedRequest(type, dataId));

  // Respuestas de la API de Mercado Pago por ruta.
  const stubMp = (
    resources: Record<string, { ok?: boolean; body: Record<string, unknown> }>,
  ) => {
    vi.stubGlobal("fetch", async (url: string) => {
      const path = String(url).replace("https://api.mercadopago.com/", "");
      const r = resources[path];

      if (!r) return { ok: false, json: async () => ({}) };

      return { ok: r.ok ?? true, json: async () => r.body };
    });
  };

  const company = () =>
    fake.tables.companies.find((r) => r.id === companyId) as {
      plan_id: string;
      subscription_status: string;
    };

  const subscription = () =>
    fake.tables.company_subscriptions.find(
      (r) => r.company_id === companyId,
    ) as {
      provider_subscription_id: string;
      status: string;
    };

  // La empresa pidió primero el plan A (preapproval P1) y después el plan B
  // (preapproval P2): mp-create-subscription dejó guardado plan B / P2.
  beforeEach(() => {
    fake.tables.companies = [
      { id: companyId, plan_id: "plan-A", subscription_status: "trial" },
    ];
    fake.tables.company_subscriptions = [
      {
        company_id: companyId,
        plan_id: "plan-B",
        provider_subscription_id: "P2",
        status: "pending",
      },
    ];
    fake.tables.company_subscription_events = [];
  });

  it("CONTROL: el aviso del preapproval vigente (P2) sí activa el plan guardado", async () => {
    stubMp({
      "preapproval/P2": {
        body: { status: "authorized", external_reference: companyId },
      },
    });

    const res = await call("subscription_preapproval", "P2");

    expect(res.status).toBe(200);
    expect(company().plan_id).toBe("plan-B");
    expect(company().subscription_status).toBe("active");
  });

  it("puerta 5: el aviso de un preapproval anterior (P1) NO activa el plan guardado (B)", async () => {
    stubMp({
      "preapproval/P1": {
        body: { status: "authorized", external_reference: companyId },
      },
    });

    const res = await call("subscription_preapproval", "P1");

    expect(res.status).toBe(200);
    expect(company().plan_id).toBe("plan-A");
    expect(company().subscription_status).toBe("trial");
    expect(subscription().provider_subscription_id).toBe("P2");
  });

  it("puerta 12: una cancelación posterior del mismo preapproval SÍ se aplica", async () => {
    stubMp({
      "preapproval/P2": {
        body: { status: "authorized", external_reference: companyId },
      },
    });
    await call("subscription_preapproval", "P2");
    expect(company().subscription_status).toBe("active");

    stubMp({
      "preapproval/P2": {
        body: { status: "cancelled", external_reference: companyId },
      },
    });
    const res = await call("subscription_preapproval", "P2");

    expect(res.status).toBe(200);
    expect(company().subscription_status).toBe("cancelled");
  });

  it("puerta 12: si Mercado Pago falla, no se marca el evento como procesado y se pide reintento", async () => {
    stubMp({ "preapproval/P2": { ok: false, body: {} } });

    const res = await call("subscription_preapproval", "P2");

    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(
      fake.tables.company_subscription_events.some((e) => e.processed_at),
    ).toBe(false);

    // Reintento con Mercado Pago ya sano: ahora sí se procesa.
    stubMp({
      "preapproval/P2": {
        body: { status: "authorized", external_reference: companyId },
      },
    });
    const retry = await call("subscription_preapproval", "P2");

    expect(retry.status).toBe(200);
    expect(company().subscription_status).toBe("active");
  });

  it("CONTROL: un pago autorizado repetido (mismo id) sigue deduplicado", async () => {
    stubMp({
      "authorized_payments/PAY1": {
        body: { preapproval_id: "P2", status: "approved" },
      },
    });

    await call("subscription_authorized_payment", "PAY1");
    expect(company().subscription_status).toBe("active");

    // Si el aviso del mismo pago se reprocesara, volvería a poner "active".
    company().subscription_status = "paused";
    const res = await call("subscription_authorized_payment", "PAY1");
    const body = await res.json();

    expect(body.already_processed).toBe(true);
    expect(company().subscription_status).toBe("paused");
  });
});
