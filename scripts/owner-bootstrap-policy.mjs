// Decide qué hace create-owner-user.mjs con la cuenta de Auth del dueño.
//
// Auditoría 2026-10 (6ª pasada, hallazgo "pre-registro del Super Admin"): el registro
// público de Supabase Auth puede seguir abierto cuando se instala. Si alguien se
// registra con el correo del dueño ANTES de que corra el script, esa cuenta ya existe
// con la contraseña que el intruso eligió; el script solo la confirmaba y
// bootstrap_owner_profile la volvía Super Admin de la plataforma.
//
// La marca `app_metadata.owner_bootstrap` solo la puede escribir la service_role
// (un registro público solo escribe user_metadata), así que distingue "la creó el
// operador con este script" de "ya existía". Una cuenta existente SIN la marca no se
// adopta a menos que el operador lo pida de forma explícita Y rote la contraseña.

export const OWNER_MARK = "owner_bootstrap";

export function hasOwnerMark(user) {
  return Boolean(user?.app_metadata?.[OWNER_MARK] === true);
}

/**
 * @param {{ existingUser: object | null, adoptExisting: boolean, resetPassword: boolean }} input
 * @returns {{ action: "create" | "update" | "adopt" | "abort", reason?: string }}
 */
export function decideOwnerUserAction({
  existingUser,
  adoptExisting,
  resetPassword,
}) {
  if (!existingUser) return { action: "create" };

  if (hasOwnerMark(existingUser)) return { action: "update" };

  if (!adoptExisting) {
    return {
      action: "abort",
      reason:
        "Ya existe una cuenta con ese correo que NO fue creada por este script (no trae la marca owner_bootstrap). " +
        "Si te registraste tú, vuelve a correr con ADOPT_EXISTING_OWNER=true y RESET_OWNER_PASSWORD=true " +
        "(la contraseña se cambia a la tuya). Si no estás seguro de que sea tuya, bórrala en " +
        "Authentication > Users y corre el script de nuevo para crearla limpia.",
    };
  }

  if (!resetPassword) {
    return {
      action: "abort",
      reason:
        "ADOPT_EXISTING_OWNER=true exige también RESET_OWNER_PASSWORD=true: la contraseña de una cuenta " +
        "que ya existía se cambia por la tuya antes de darle permisos de Super Admin.",
    };
  }

  return { action: "adopt" };
}
