// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildCorsHeaders } from "../_shared/cors.ts";

// Recibe la lista que arma un visitante SIN sesión en /tienda/:slug y la
// guarda como "solicitud de cotización" -- nunca un precio ni una venta.
// Pública (sin Bearer, cualquiera puede llamarla), así que:
//   1) Verifica Turnstile contra Cloudflare antes de tocar la base.
//   2) Nunca confía en nada que mande el cliente salvo `qty` -- cada
//      product_id se vuelve a leer de la base con service_role para
//      confirmar que pertenece a esa empresa y sigue siendo público.
const MAX_ITEMS = 60;
const MAX_TEXT = 500;

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
    const turnstileSecret = Deno.env.get("TURNSTILE_SECRET_KEY");
    if (!turnstileSecret) {
      return json(
        { error: "El catálogo en línea no está configurado (falta TURNSTILE_SECRET_KEY)." },
        500,
      );
    }

    const body = await req.json().catch(() => ({}));

    const turnstileToken = String(body?.turnstile_token ?? "");
    if (!turnstileToken) return json({ error: "Falta la verificación anti-spam." }, 400);

    const verifyRes = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: turnstileSecret,
          response: turnstileToken,
          remoteip: req.headers.get("CF-Connecting-IP") ?? undefined,
        }),
      },
    );
    const verifyData = await verifyRes.json().catch(() => ({}));
    if (!verifyData?.success) {
      return json({ error: "No se pudo verificar que eres una persona. Intenta de nuevo." }, 400);
    }

    const companySlug = String(body?.company_slug ?? "").trim().toLowerCase();
    const customerName = String(body?.customer_name ?? "").trim().slice(0, MAX_TEXT);
    const phone = String(body?.phone ?? "").trim().slice(0, MAX_TEXT) || null;
    const email = String(body?.email ?? "").trim().slice(0, MAX_TEXT) || null;
    const notes = String(body?.notes ?? "").trim().slice(0, MAX_TEXT) || null;
    const items = Array.isArray(body?.items) ? body.items : [];

    if (!companySlug) return json({ error: "Falta la tienda." }, 400);
    if (!customerName) return json({ error: "Ingresa tu nombre." }, 400);
    if (!phone && !email) return json({ error: "Ingresa un teléfono o un correo de contacto." }, 400);
    if (items.length === 0) return json({ error: "Agrega al menos un producto a tu lista." }, 400);
    if (items.length > MAX_ITEMS) return json({ error: "Tu lista tiene demasiados productos." }, 400);

    const parsedItems = items.map((it: any) => ({
      productId: String(it?.product_id ?? ""),
      qty: Number(it?.qty),
    }));
    if (parsedItems.some((it) => !it.productId || !(it.qty > 0))) {
      return json({ error: "Hay un producto o cantidad inválida en tu lista." }, 400);
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const { data: company, error: companyErr } = await admin
      .from("companies")
      .select("id, online_catalog_enabled")
      .eq("slug", companySlug)
      .maybeSingle();
    if (companyErr || !company || !company.online_catalog_enabled) {
      return json({ error: "Esta tienda no tiene catálogo en línea disponible." }, 404);
    }

    const productIds = [...new Set(parsedItems.map((it) => it.productId))];
    const { data: products, error: productsErr } = await admin
      .from("products")
      .select("id, name")
      .eq("company_id", company.id)
      .eq("show_online", true)
      .eq("active", true)
      .is("deleted_at", null)
      .in("id", productIds);
    if (productsErr) return json({ error: "No se pudo validar tu lista." }, 500);

    const nameById = new Map((products ?? []).map((p) => [p.id, p.name as string]));
    const validItems = parsedItems.filter((it) => nameById.has(it.productId));
    if (validItems.length === 0) {
      return json({ error: "Ningún producto de tu lista está disponible." }, 400);
    }

    const { data: request, error: requestErr } = await admin
      .from("quote_requests")
      .insert({
        company_id: company.id,
        customer_name: customerName,
        phone,
        email,
        notes,
      })
      .select("id")
      .single();
    if (requestErr || !request) {
      return json({ error: "No se pudo guardar tu solicitud." }, 500);
    }

    const { error: itemsErr } = await admin.from("quote_request_items").insert(
      validItems.map((it) => ({
        company_id: company.id,
        quote_request_id: request.id,
        product_id: it.productId,
        product_name: nameById.get(it.productId)!,
        qty: it.qty,
      })),
    );
    if (itemsErr) return json({ error: "No se pudo guardar tu solicitud." }, 500);

    return json({ ok: true }, 200);
  } catch (e: any) {
    return json({ error: e?.message ?? "Error inesperado." }, 500);
  }
});
