// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Recibe las notificaciones de Mercado Pago (servidor a servidor, sin
// sesión de usuario -- la autenticación es la firma x-signature, no un
// Bearer token). Nunca confía en el contenido del body para decidir nada
// de dinero: con el id que trae, vuelve a pedirle el recurso completo a la
// API de Mercado Pago antes de aplicar cualquier cambio.
//
// json() no usa buildCorsHeaders a propósito -- este endpoint nunca lo
// llama un navegador, así que no aplica la lista blanca de orígenes.
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// Formato documentado por Mercado Pago: header "x-signature: ts=...,v1=..."
// más "x-request-id", contra un manifest "id:{dataId};request-id:{reqId};ts:{ts};"
// firmado con HMAC-SHA256 usando el secret del webhook.
async function verifySignature(
  secret: string,
  signatureHeader: string,
  requestId: string,
  dataId: string,
): Promise<boolean> {
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const [key, value] = part.split("=");
      return [key?.trim(), value?.trim()];
    }),
  );
  const ts = parts["ts"];
  const v1 = parts["v1"];
  if (!ts || !v1) return false;

  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuffer = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(manifest),
  );
  const computedHex = Array.from(new Uint8Array(sigBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  try {
    return timingSafeEqual(hexToBytes(computedHex), hexToBytes(v1));
  } catch {
    return false;
  }
}

// Auditoría 2026-10 (3ª pasada): los planes se cobran en la moneda de la
// plataforma, no en la que la empresa tenga configurada (esa la edita el
// propio cliente). Debe coincidir con mp-create-subscription.
const PLATFORM_CURRENCY = "MXN";

const todayIso = () => new Date().toISOString().slice(0, 10);

function oneMonthFromToday(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
}

// Monto y moneda cobrados deben corresponder al plan guardado. Si Mercado
// Pago no manda alguno de los dos campos no se puede comprobar y se acepta
// (el recurso ya se re-consultó directo a su API); solo se rechaza una
// diferencia real.
function paymentMatchesPlan(
  amount: unknown,
  currency: unknown,
  planPrice: unknown,
): boolean {
  if (currency != null && String(currency).toUpperCase() !== PLATFORM_CURRENCY) {
    return false;
  }
  if (amount != null && planPrice != null) {
    if (Number(amount) + 0.009 < Number(planPrice)) return false;
  }
  return true;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  try {
    const webhookSecret = Deno.env.get("MERCADOPAGO_WEBHOOK_SECRET");
    const mpAccessToken = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
    if (!webhookSecret || !mpAccessToken) {
      // 200 para que Mercado Pago no reintente indefinidamente un error de
      // configuración que solo se arregla desplegando el secret.
      return json({ error: "Mercado Pago no está configurado en este proyecto." }, 200);
    }

    const url = new URL(req.url);
    const rawBody = await req.text();
    const body = JSON.parse(rawBody || "{}");

    const dataId: string | undefined =
      body?.data?.id ?? url.searchParams.get("data.id") ?? undefined;
    const eventType: string | undefined =
      body?.type ?? url.searchParams.get("type") ?? undefined;

    if (!dataId || !eventType) {
      return json({ ok: true, ignored: "sin data.id/type" }, 200);
    }

    const signatureHeader = req.headers.get("x-signature") ?? "";
    const requestId = req.headers.get("x-request-id") ?? "";
    const validSignature = await verifySignature(
      webhookSecret,
      signatureHeader,
      requestId,
      dataId,
    );
    if (!validSignature) {
      return json({ error: "Firma inválida." }, 401);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    // Idempotencia: si ya existe un evento con este id+tipo, no se procesa
    // de nuevo (Mercado Pago puede reintentar la misma notificación).
    const { data: existing } = await admin
      .from("company_subscription_events")
      .select("id, processed_at")
      .eq("provider", "mercadopago")
      .eq("provider_event_type", eventType)
      .eq("provider_resource_id", String(dataId))
      .maybeSingle();
    // Auditoría 2026-10 (puerta 12): Mercado Pago vuelve a avisar con el MISMO
    // id de preapproval en cada cambio de estado (autorizada -> pausada ->
    // cancelada); deduplicar por (tipo, id) descartaba todos los avisos después
    // del primero. El estado se toma siempre del recurso re-consultado, así que
    // reprocesar un preapproval es idempotente. Los pagos autorizados sí se
    // deduplican (cada uno tiene su propio id y reprocesar extiende la vigencia).
    if (existing?.processed_at && eventType !== "subscription_preapproval") {
      return json({ ok: true, already_processed: true }, 200);
    }

    // Nunca se confía en el body del webhook para decidir nada de dinero --
    // se vuelve a pedir el recurso completo directo a Mercado Pago.
    let resourcePath: string | null = null;
    if (eventType === "subscription_preapproval") {
      resourcePath = `preapproval/${dataId}`;
    } else if (eventType === "subscription_authorized_payment") {
      resourcePath = `authorized_payments/${dataId}`;
    }

    let companyId: string | null = null;

    if (resourcePath) {
      const resRes = await fetch(`https://api.mercadopago.com/${resourcePath}`, {
        headers: { Authorization: `Bearer ${mpAccessToken}` },
      });
      const resource = await resRes.json().catch(() => ({}));

      // Auditoría 2026-10 (puerta 12): si Mercado Pago no respondió bien no se
      // marca el evento como procesado y se responde 502 para que reintente.
      if (!resRes.ok) {
        return json({ error: "No se pudo consultar el recurso en Mercado Pago." }, 502);
      }

      if (eventType === "subscription_preapproval" && resRes.ok) {
        companyId = resource.external_reference ?? null;
        const mpStatus: string = resource.status ?? "pending";
        const status =
          mpStatus === "authorized"
            ? "authorized"
            : mpStatus === "paused"
              ? "paused"
              : mpStatus === "cancelled"
                ? "cancelled"
                : "pending";

        if (companyId) {
          const { data: sub } = await admin
            .from("company_subscriptions")
            .select("plan_id, provider_subscription_id")
            .eq("company_id", companyId)
            .maybeSingle();

          // Auditoría 2026-10 (puerta 5): mp-create-subscription sobrescribe
          // plan_id y provider_subscription_id en cada llamada; sin esta
          // comparación, autorizar un preapproval viejo (plan barato) activaba
          // el plan guardado por el más reciente (plan caro). Solo cuenta el
          // aviso del preapproval que corresponde al plan guardado.
          const isCurrentPreapproval =
            !sub?.provider_subscription_id ||
            sub.provider_subscription_id === String(dataId);

          if (isCurrentPreapproval) {
            await admin
              .from("company_subscriptions")
              .update({ status, provider_subscription_id: String(dataId) })
              .eq("company_id", companyId);
          }

          // Una empresa suspendida a mano por el administrador de la
          // plataforma (abuso, contracargo) no se reactiva por un aviso de
          // Mercado Pago: ningún cambio de estado automático la toca.
          const { data: co } = await admin
            .from("companies")
            .select("subscription_status, expires_at")
            .eq("id", companyId)
            .maybeSingle();
          const isSuspended = co?.subscription_status === "suspended";

          const { data: plan } = sub?.plan_id
            ? await admin
                .from("subscription_plans")
                .select("price")
                .eq("id", sub.plan_id)
                .maybeSingle()
            : { data: null };

          if (!isCurrentPreapproval || isSuspended) {
            // preapproval anterior reemplazado por otro más reciente, o
            // empresa suspendida por la plataforma: se ignora
          } else if (status === "authorized" && sub?.plan_id) {
            if (
              !paymentMatchesPlan(
                resource.auto_recurring?.transaction_amount,
                resource.auto_recurring?.currency_id,
                plan?.price,
              )
            ) {
              // El cobro pactado no es el del plan: no se activa nada.
            } else {
              // Autorizar la suscripción NO es un pago: solo da acceso si la
              // empresa no tiene vigencia (nueva o vencida). Cada pago
              // aprobado extiende la vigencia (ver abajo); sin esta
              // condición, pausar y reautorizar regalaba un mes por aviso.
              const update: Record<string, unknown> = {
                plan_id: sub.plan_id,
                subscription_status: "active",
              };
              if (!co?.expires_at || String(co.expires_at) < todayIso()) {
                update.expires_at = oneMonthFromToday();
              }
              await admin.from("companies").update(update).eq("id", companyId);
            }
          } else if (status === "paused" || status === "cancelled") {
            await admin
              .from("companies")
              .update({ subscription_status: status })
              .eq("id", companyId);
          }
        }
      } else if (eventType === "subscription_authorized_payment" && resRes.ok) {
        const preapprovalId: string | undefined = resource.preapproval_id;
        const approved = resource.status === "approved" || resource.status === "processed";

        if (preapprovalId) {
          const { data: sub } = await admin
            .from("company_subscriptions")
            .select("company_id, plan_id")
            .eq("provider_subscription_id", preapprovalId)
            .maybeSingle();
          companyId = sub?.company_id ?? null;

          if (companyId && approved) {
            const { data: co } = await admin
              .from("companies")
              .select("subscription_status, expires_at")
              .eq("id", companyId)
              .maybeSingle();
            const { data: plan } = sub?.plan_id
              ? await admin
                  .from("subscription_plans")
                  .select("price")
                  .eq("id", sub.plan_id)
                  .maybeSingle()
              : { data: null };

            // No reactiva una empresa suspendida por la plataforma, ni acepta
            // un cobro de otro monto o moneda que el del plan.
            if (
              co?.subscription_status !== "suspended" &&
              paymentMatchesPlan(
                resource.transaction_amount,
                resource.currency_id,
                plan?.price,
              )
            ) {
              const next = oneMonthFromToday();
              await admin
                .from("companies")
                .update({
                  subscription_status: "active",
                  expires_at:
                    co?.expires_at && String(co.expires_at) > next
                      ? String(co.expires_at)
                      : next,
                })
                .eq("id", companyId);
            }
          }
        }
      }
    }

    await admin.from("company_subscription_events").upsert(
      {
        company_id: companyId,
        provider: "mercadopago",
        provider_event_type: eventType,
        provider_resource_id: String(dataId),
        raw_payload: body,
        processed_at: new Date().toISOString(),
      },
      { onConflict: "provider,provider_event_type,provider_resource_id" },
    );

    return json({ ok: true }, 200);
  } catch (e: any) {
    return json({ error: e?.message ?? "Error inesperado." }, 200);
  }
});
