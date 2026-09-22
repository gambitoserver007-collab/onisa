// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCorsHeaders } from "../_shared/cors.ts";

// Crea una suscripción de Mercado Pago (API de Preapproval, cobro
// recurrente mensual) para el plan que pide el admin de la empresa, y
// regresa la URL de checkout (init_point) a la que el frontend redirige
// para que autorice su tarjeta. La activación real del plan (plan_id,
// subscription_status) no ocurre aquí -- pasa cuando Mercado Pago confirma
// el pago vía mp-webhook.
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
      .select("email, role, company_id, is_active, is_demo")
      .eq("id", callerId)
      .maybeSingle();
    if (callerErr || !caller) return json({ error: "Perfil del llamador no encontrado." }, 403);
    if (!caller.is_active || caller.is_demo) {
      return json({ error: "Esta acción no está disponible en este perfil." }, 403);
    }
    if (caller.role !== "admin" || !caller.company_id) {
      return json({ error: "Solo el administrador de la empresa puede suscribirse a un plan." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const planId = body?.plan_id;
    if (!planId) return json({ error: "Falta el plan a contratar." }, 400);

    const { data: plan, error: planErr } = await admin
      .from("subscription_plans")
      .select("id, name, price, is_active")
      .eq("id", planId)
      .maybeSingle();
    if (planErr || !plan || !plan.is_active) {
      return json({ error: "Plan no encontrado." }, 404);
    }
    if (Number(plan.price) <= 0) {
      return json({ error: "Este plan no requiere pago." }, 400);
    }

    const { data: company, error: companyErr } = await admin
      .from("companies")
      .select("id, name, currency_code")
      .eq("id", caller.company_id)
      .maybeSingle();
    if (companyErr || !company) return json({ error: "Empresa no encontrada." }, 404);

    const origin = req.headers.get("Origin") || Deno.env.get("APP_URL") || "";
    const backUrl = origin ? `${origin}/suscripcion` : undefined;

    const mpRes = await fetch("https://api.mercadopago.com/preapproval", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${mpAccessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        reason: `${plan.name} - ${company.name}`,
        external_reference: company.id,
        payer_email: caller.email,
        back_url: backUrl,
        auto_recurring: {
          frequency: 1,
          frequency_type: "months",
          transaction_amount: Number(plan.price),
          currency_id: company.currency_code || "MXN",
        },
        status: "pending",
      }),
    });

    const mpData = await mpRes.json().catch(() => ({}));
    if (!mpRes.ok || !mpData?.id || !mpData?.init_point) {
      return json(
        { error: mpData?.message || "No se pudo crear la suscripción con Mercado Pago." },
        502,
      );
    }

    const { error: upsertErr } = await admin.from("company_subscriptions").upsert(
      {
        company_id: company.id,
        plan_id: plan.id,
        provider: "mercadopago",
        provider_subscription_id: mpData.id,
        provider_payer_email: caller.email,
        status: "pending",
      },
      { onConflict: "company_id" },
    );
    if (upsertErr) {
      return json({ error: `No se pudo registrar la suscripción: ${upsertErr.message}` }, 500);
    }

    return json({ init_point: mpData.init_point }, 200);
  } catch (e: any) {
    return json({ error: e?.message ?? "Error inesperado." }, 500);
  }
});
