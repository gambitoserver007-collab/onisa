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

const VALID_ROLES = ["admin", "user", "finanzas", "operador"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "No autenticado." }, 401);

    const { data: userRes, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userRes?.user) return json({ error: "No autenticado." }, 401);
    const callerId = userRes.user.id;

    const body = await req.json().catch(() => ({}));
    const {
      company_id,
      full_name,
      email,
      password,
      role,
      location_id,
      location_ids,
      allowed_sections,
      saas_panel,
    } = body ?? {};

    if (!company_id || !full_name || !email || !password || !role) {
      return json({ error: "Faltan campos requeridos." }, 400);
    }
    if (!VALID_ROLES.includes(role)) {
      return json({ error: "Rol inválido." }, 400);
    }

    // Normalize location_ids: prefer array; fall back to single location_id
    let locIds: string[] = [];
    if (Array.isArray(location_ids)) {
      locIds = location_ids.filter((x: unknown) => typeof x === "string" && x.length > 0);
    } else if (typeof location_id === "string" && location_id.length > 0) {
      locIds = [location_id];
    }

    if (locIds.length > 0) {
      const { data: locs, error: locsErr } = await admin
        .from("locations")
        .select("id")
        .eq("company_id", company_id)
        .in("id", locIds);
      if (locsErr) return json({ error: "No se pudieron validar los puntos de venta." }, 500);
      if (!locs || locs.length !== locIds.length) {
        return json({ error: "Punto de venta inválido." }, 400);
      }
    }

    const primaryLocationId: string | null = locIds[0] ?? null;

    let resolvedAllowedSections: string[] | null = null;
    if (Array.isArray(allowed_sections)) {
      const cleaned = allowed_sections.filter(
        (s: unknown) => typeof s === "string" && s.length > 0,
      );
      resolvedAllowedSections = cleaned.length > 0 ? cleaned : null;
    }

    // Validar que el llamador es admin de la empresa
    const { data: callerProfile, error: callerErr } = await admin
      .from("profiles")
      .select("role, company_id, is_demo, is_active, is_platform_admin")
      .eq("id", callerId)
      .maybeSingle();

    if (callerErr || !callerProfile) {
      return json({ error: "Perfil del llamador no encontrado." }, 403);
    }
    if (saas_panel === true && !callerProfile.is_platform_admin) {
      return json({ error: "Solo un administrador de la plataforma puede otorgar acceso al Panel SaaS." }, 403);
    }
    if (
      !callerProfile.is_active ||
      callerProfile.is_demo ||
      callerProfile.role !== "admin" ||
      callerProfile.company_id !== company_id
    ) {
      return json({ error: "No autorizado para crear usuarios en esta empresa." }, 403);
    }

    // Verificar límite del plan
    const { data: company, error: companyErr } = await admin
      .from("companies")
      .select("id, plan_id")
      .eq("id", company_id)
      .maybeSingle();
    if (companyErr || !company) return json({ error: "Empresa no encontrada." }, 404);

    let userLimit = 1;
    if (company.plan_id) {
      const { data: plan } = await admin
        .from("subscription_plans")
        .select("user_limit")
        .eq("id", company.plan_id)
        .maybeSingle();
      if (plan?.user_limit != null) userLimit = plan.user_limit;
    }

    const { count, error: countErr } = await admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .eq("company_id", company_id)
      .eq("is_active", true);
    if (countErr) return json({ error: "No se pudo verificar el límite de usuarios." }, 500);

    if ((count ?? 0) >= userLimit) {
      return json(
        {
          error: `Se alcanzó el límite de usuarios del plan (${userLimit}). Actualiza el plan para agregar más usuarios.`,
        },
        409,
      );
    }

    // Crear usuario en Auth
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name, company_id },
    });

    if (createErr || !created?.user) {
      const msg = (createErr?.message ?? "").toLowerCase();
      if (
        msg.includes("already") ||
        msg.includes("registered") ||
        msg.includes("exists") ||
        msg.includes("duplicate")
      ) {
        return json({ error: "Ya existe un usuario con ese correo." }, 409);
      }
      return json({ error: createErr?.message ?? "No se pudo crear el usuario." }, 400);
    }

    const newUserId = created.user.id;

    // handle_new_user() (el trigger AFTER INSERT ON auth.users) ya NO confía
    // en ningún company_id que venga en user_metadata -- por seguridad
    // (ver comentario extenso en 01_install.sql), siempre crea una empresa
    // nueva "fantasma" para cualquier usuario recién insertado. Aquí se
    // corrige el perfil a la empresa REAL (ya validada arriba) y luego se
    // borra esa empresa fantasma, que nunca tuvo ni tendrá otro dato.
    const { data: phantomProfile } = await admin
      .from("profiles")
      .select("company_id")
      .eq("id", newUserId)
      .maybeSingle();
    const phantomCompanyId = phantomProfile?.company_id ?? null;

    const isPlatformAdmin = role === "admin" && saas_panel === true;

    // Upsert profile
    const { data: profile, error: profileErr } = await admin
      .from("profiles")
      .upsert(
        {
          id: newUserId,
          company_id,
          email,
          full_name,
          role,
          location_id: primaryLocationId,
          allowed_sections: resolvedAllowedSections,
          is_platform_admin: isPlatformAdmin,
          is_demo: false,
          demo_mode: "none",
          is_active: true,
        },
        { onConflict: "id" },
      )
      .select()
      .single();

    if (profileErr) {
      return json({ error: `Usuario creado pero falló el perfil: ${profileErr.message}` }, 500);
    }

    if (phantomCompanyId && phantomCompanyId !== company_id) {
      // Best-effort: si falla, queda una empresa vacía sin dueño real y sin
      // ningún dato -- inofensivo, no vale la pena fallar la creación del
      // usuario por esto.
      await admin.from("companies").delete().eq("id", phantomCompanyId);
    }

    if (locIds.length > 0) {
      const rows = locIds.map((lid) => ({
        profile_id: newUserId,
        location_id: lid,
        company_id,
      }));
      const { error: plErr } = await admin
        .from("profile_locations")
        .upsert(rows, { onConflict: "profile_id,location_id" });
      if (plErr) {
        return json(
          { error: `Usuario creado pero falló asignar puntos de venta: ${plErr.message}` },
          500,
        );
      }
    }

    return json({ profile }, 200);
  } catch (e: any) {
    return json({ error: e?.message ?? "Error inesperado." }, 500);
  }
});
