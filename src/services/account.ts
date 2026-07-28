import { normalizeEmail } from "@/data/demoCredentials";
import { supabase } from "@/integrations/supabase/client";
import type { DemoSession } from "@/types";

export async function updateProfileName(session: DemoSession, fullName: string) {
  const cleanName = fullName.trim();
  if (!session.userId) throw new Error("La sesión no tiene usuario asociado.");
  if (!cleanName) throw new Error("Ingresa un nombre válido.");

  const { error } = await supabase
    .from("profiles")
    .update({ full_name: cleanName })
    .eq("id", session.userId);

  if (error) throw error;
}

export async function updateAccountEmail(email: string) {
  const cleanEmail = normalizeEmail(email);
  if (!cleanEmail) throw new Error("Ingresa un correo válido.");

  const { data, error } = await supabase.auth.updateUser({ email: cleanEmail });
  if (error) throw error;

  return data.user;
}

export async function updateAccountPassword(password: string) {
  const cleanPassword = password.trim();
  if (cleanPassword.length < 6) throw new Error("La contraseña debe tener al menos 6 caracteres.");

  const { error } = await supabase.auth.updateUser({ password: cleanPassword });
  if (error) throw error;
}
