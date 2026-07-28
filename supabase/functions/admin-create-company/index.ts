// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  try {
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      {
        auth: { persistSession: false, autoRefreshToken: false },
      },
    );
    const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "No autenticado." }, 401);
    const { data: userRes, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userRes?.user) return json({ error: "No autenticado." }, 401);
    const callerId = userRes.user.id;

    const body = await req.json().catch(() => ({}));
    const {
      name,
      fiscal_id,
      plan_id,
      subscription_status,
      owner_email,
      owner_password,
      owner_full_name,
    } = body ?? {};
    if (!name || !String(name).trim()) return json({ error: "Falta el nombre de la tienda." }, 400);

    const { data: caller, error: callerErr } = await admin
      .from("profiles")
      .select("is_platform_admin, is_active, is_demo")
      .eq("id", callerId)
      .maybeSingle();
    if (callerErr || !caller) return json({ error: "Perfil del llamador no encontrado." }, 403);
    if (!caller.is_active || caller.is_demo || !caller.is_platform_admin)
      return json({ error: "Solo el administrador de la plataforma puede crear tiendas." }, 403);

    const status = ["active", "trial", "expired", "suspended"].includes(subscription_status)
      ? subscription_status
      : "active";

    const { data: company, error: companyErr } = await admin
      .from("companies")
      .insert({
        name: String(name).trim(),
        fiscal_id: fiscal_id ? String(fiscal_id).trim() : null,
        plan_id: plan_id || null,
        subscription_status: status,
        is_demo_data: false,
      })
      .select("id, name")
      .single();
    if (companyErr || !company)
      return json({ error: companyErr?.message ?? "No se pudo crear la tienda." }, 500);

    let owner = null;
    if (owner_email && owner_password) {
      if (String(owner_password).length < 6)
        return json(
          { error: "La contraseña del administrador debe tener al menos 6 caracteres." },
          400,
        );
      const fullName = owner_full_name ? String(owner_full_name).trim() : "Administrador";
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: String(owner_email).trim(),
        password: String(owner_password),
        email_confirm: true,
        user_metadata: { full_name: fullName, company_id: company.id },
      });
      if (createErr || !created?.user) {
        const msg = (createErr?.message ?? "").toLowerCase();
        if (msg.includes("already") || msg.includes("registered") || msg.includes("exists"))
          return json({ error: "Tienda creada, pero ya existe un usuario con ese correo." }, 409);
        return json(
          { error: `Tienda creada, pero falló el administrador: ${createErr?.message}` },
          207,
        );
      }
      const { data: profile, error: profileErr } = await admin
        .from("profiles")
        .upsert(
          {
            id: created.user.id,
            company_id: company.id,
            email: String(owner_email).trim(),
            full_name: fullName,
            role: "admin",
            is_demo: false,
            demo_mode: "none",
            is_active: true,
            is_platform_admin: false,
          },
          { onConflict: "id" },
        )
        .select()
        .single();
      if (profileErr)
        return json({ error: `Tienda creada, pero falló el perfil: ${profileErr.message}` }, 207);
      owner = profile;
    }
    return json({ company, owner }, 200);
  } catch (e: any) {
    return json({ error: e?.message ?? "Error inesperado." }, 500);
  }
});
