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

    const body = await req.json().catch(() => ({}));
    const {
      action,
      target_user_id,
      full_name,
      role,
      is_active,
      password,
      location_id,
      location_ids,
      allowed_sections,
      saas_panel,
    } = body ?? {};
    if (!["update", "delete"].includes(action)) return json({ error: "Acción inválida." }, 400);
    if (!target_user_id) return json({ error: "Falta el usuario objetivo." }, 400);

    const { data: caller, error: callerErr } = await admin
      .from("profiles")
      .select("role, company_id, is_demo, is_active, is_platform_admin")
      .eq("id", callerId)
      .maybeSingle();
    if (callerErr || !caller) return json({ error: "Perfil del llamador no encontrado." }, 403);
    if (!caller.is_active || caller.is_demo || caller.role !== "admin")
      return json({ error: "No autorizado para gestionar usuarios." }, 403);

    const { data: target, error: targetErr } = await admin
      .from("profiles")
      .select("id, company_id, full_name, role, is_active, allowed_sections, location_id, is_platform_admin")
      .eq("id", target_user_id)
      .maybeSingle();
    if (targetErr || !target) return json({ error: "Usuario no encontrado." }, 404);
    if (target.company_id !== caller.company_id)
      return json({ error: "Ese usuario no pertenece a tu tienda." }, 403);

    const isSelf = target_user_id === callerId;
    if (action === "delete") {
      if (isSelf) return json({ error: "No puedes eliminar tu propia cuenta." }, 400);
      const { error: delErr } = await admin.auth.admin.deleteUser(target_user_id);
      if (delErr) return json({ error: delErr.message }, 400);
      // Auditoría universal: quién dio de baja a quién. auth.uid() no sirve
      // aquí para atribuir el cambio (esta función corre con la service
      // role key), así que se escribe directo con el callerId que sí se
      // conoce del token recibido.
      await admin.from("audit_log").insert({
        company_id: caller.company_id,
        actor_id: callerId,
        entity_type: "profile",
        entity_id: target_user_id,
        action: "deleted",
        detail: { full_name: target.full_name, role: target.role },
      });
      return json({ ok: true }, 200);
    }

    const updates: Record<string, unknown> = {};
    if (typeof full_name === "string" && full_name.trim()) updates.full_name = full_name.trim();

    let finalRole: string = target.role;
    if (role !== undefined) {
      if (!VALID_ROLES.includes(role)) return json({ error: "Rol inválido." }, 400);
      if (isSelf && role !== "admin")
        return json({ error: "No puedes quitarte el rol de administrador a ti mismo." }, 400);
      updates.role = role;
      finalRole = role;
    }
    if (is_active !== undefined) {
      if (isSelf && is_active === false)
        return json({ error: "No puedes desactivar tu propia cuenta." }, 400);
      updates.is_active = !!is_active;
    }

    // Normalize location_ids (array preferred; fallback a single location_id)
    let locIds: string[] | undefined;
    if (Array.isArray(location_ids)) {
      locIds = location_ids.filter((x: unknown) => typeof x === "string" && x.length > 0);
    } else if (location_id !== undefined) {
      if (location_id === null) locIds = [];
      else if (typeof location_id === "string" && location_id.length > 0) locIds = [location_id];
    }

    if (locIds !== undefined && locIds.length > 0) {
      const { data: locs, error: locsErr } = await admin
        .from("locations")
        .select("id")
        .eq("company_id", caller.company_id)
        .in("id", locIds);
      if (locsErr) return json({ error: "No se pudieron validar los puntos de venta." }, 500);
      if (!locs || locs.length !== locIds.length)
        return json({ error: "Punto de venta inválido." }, 400);
    }

    if (locIds !== undefined) {
      updates.location_id = locIds[0] ?? null;
    }

    if (allowed_sections !== undefined) {
      if (allowed_sections === null) {
        updates.allowed_sections = null;
      } else if (Array.isArray(allowed_sections)) {
        const cleaned = allowed_sections.filter(
          (s: unknown) => typeof s === "string" && s.length > 0,
        );
        updates.allowed_sections = cleaned.length > 0 ? cleaned : null;
      }
    }

    if (saas_panel !== undefined || role !== undefined) {
      if (finalRole === "admin") {
        if (saas_panel !== undefined) {
          const desired = saas_panel === true;
          const current = !!target.is_platform_admin;
          if (desired !== current) {
            if (!caller.is_platform_admin)
              return json({ error: "Solo un administrador de la plataforma puede modificar el acceso al Panel SaaS." }, 403);
            updates.is_platform_admin = desired;
          }
        }
      } else {
        // Demoting from admin to another role: revoke platform access if it was set.
        if (target.is_platform_admin) {
          if (!caller.is_platform_admin)
            return json({ error: "Solo un administrador de la plataforma puede quitar el acceso al Panel SaaS." }, 403);
          updates.is_platform_admin = false;
        }
      }
    }

    // Auditoría universal: cambios de rol/permisos de usuario. Se compara
    // contra el valor previo de "target" para no registrar un "cambio" que
    // en realidad no mueve nada (ej. reenviar el mismo rol).
    const sensitiveChanges: Record<string, { antes: unknown; despues: unknown }> = {};
    if ("role" in updates && updates.role !== target.role) {
      sensitiveChanges.role = { antes: target.role, despues: updates.role };
    }
    if ("is_active" in updates && updates.is_active !== target.is_active) {
      sensitiveChanges.is_active = { antes: target.is_active, despues: updates.is_active };
    }
    if (
      "allowed_sections" in updates &&
      JSON.stringify(updates.allowed_sections) !== JSON.stringify(target.allowed_sections ?? null)
    ) {
      sensitiveChanges.allowed_sections = {
        antes: target.allowed_sections ?? null,
        despues: updates.allowed_sections,
      };
    }
    if ("location_id" in updates && updates.location_id !== target.location_id) {
      sensitiveChanges.location_id = { antes: target.location_id, despues: updates.location_id };
    }

    if (Object.keys(updates).length > 0) {
      updates.updated_at = new Date().toISOString();
      const { error: updErr } = await admin
        .from("profiles")
        .update(updates)
        .eq("id", target_user_id);
      if (updErr) return json({ error: updErr.message }, 500);
    }

    if (Object.keys(sensitiveChanges).length > 0) {
      await admin.from("audit_log").insert({
        company_id: caller.company_id,
        actor_id: callerId,
        entity_type: "profile",
        entity_id: target_user_id,
        action: "updated",
        detail: { full_name: target.full_name, ...sensitiveChanges },
      });
    }

    // Replace assignments if location_ids provided
    if (locIds !== undefined) {
      const { error: delErr } = await admin
        .from("profile_locations")
        .delete()
        .eq("profile_id", target_user_id);
      if (delErr) return json({ error: `No se pudo limpiar asignaciones: ${delErr.message}` }, 500);
      if (locIds.length > 0) {
        const rows = locIds.map((lid) => ({
          profile_id: target_user_id,
          location_id: lid,
          company_id: caller.company_id,
        }));
        const { error: insErr } = await admin.from("profile_locations").insert(rows);
        if (insErr)
          return json({ error: `No se pudieron asignar puntos de venta: ${insErr.message}` }, 500);
      }
    }

    if (typeof password === "string" && password.length > 0) {
      if (password.length < 6)
        return json({ error: "La contraseña debe tener al menos 6 caracteres." }, 400);
      const { error: pwErr } = await admin.auth.admin.updateUserById(target_user_id, { password });
      if (pwErr) return json({ error: pwErr.message }, 400);
    }
    return json({ ok: true }, 200);
  } catch (e: any) {
    return json({ error: e?.message ?? "Error inesperado." }, 500);
  }
});
