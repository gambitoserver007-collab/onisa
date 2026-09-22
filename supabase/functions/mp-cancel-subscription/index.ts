// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCorsHeaders } from "../_shared/cors.ts";

// Cancela la suscripción activa de Mercado Pago de la empresa del admin que
// llama. Actualiza company_subscriptions/companies de inmediato para que la
// UI responda rápido; mp-webhook confirma después el mismo estado cuando
// Mercado Pago notifique el cambio (actualización idempotente, no duplica
// nada raro si llega ese webhook más tarde).
Deno.serve(async (req) => {
  const headers = buildCorsHeaders(req);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...headers, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  try {
    const mpAccessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
    if (!mpAccessToken) {
      return json(
        { error: "Mercado Pago no está configurado (falta MERCADOPAGO_ACCESS_TOKEN)." },
        500,
      );
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "No autenticado." }, 401);
    const { data: userRes, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userRes?.user) return json({ error: "No autenticado." }, 401);
    const callerId = userRes.user.id;

    const { data: caller, error: callerErr } = await admin
      .from("profiles")
      .select("role, company_id, is_active, is_demo")
      .eq("id", callerId)
      .maybeSingle();
    if (callerErr || !caller) return json({ error: "Perfil del llamador no encontrado." }, 403);
    if (!caller.is_active || caller.is_demo) {
      return json({ error: "Esta acción no está disponible en este perfil." }, 403);
    }
    if (caller.role !== "admin" || !caller.company_id) {
      return json({ error: "Solo el administrador de la empresa puede cancelar la suscripción." }, 403);
    }

    const { data: subscription, error: subErr } = await admin
      .from("company_subscriptions")
      .select("provider_subscription_id, status")
      .eq("company_id", caller.company_id)
      .maybeSingle();
    if (subErr || !subscription) {
      return json({ error: "Esta empresa no tiene una suscripción activa." }, 404);
    }
    if (subscription.status === "cancelled") {
      return json({ ok: true }, 200);
    }

    const mpRes = await fetch(
      `https://api.mercadopago.com/preapproval/${subscription.provider_subscription_id}`,
      {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${mpAccessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ status: "cancelled" }),
      },
    );
    if (!mpRes.ok) {
      const mpData = await mpRes.json().catch(() => ({}));
      return json(
        { error: mpData?.message || "No se pudo cancelar la suscripción en Mercado Pago." },
        502,
      );
    }

    await admin
      .from("company_subscriptions")
      .update({ status: "cancelled" })
      .eq("company_id", caller.company_id);

    await admin
      .from("companies")
      .update({ subscription_status: "cancelled" })
      .eq("id", caller.company_id);

    return json({ ok: true }, 200);
  } catch (e: any) {
    return json({ error: e?.message ?? "Error inesperado." }, 500);
  }
});
