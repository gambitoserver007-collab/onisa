// Traduce los errores de Supabase Auth (que vienen en inglés) a mensajes claros
// en español, cada uno con una recomendación de qué hacer. Se usa como respaldo
// para cualquier error no clasificado, así nunca se le muestra inglés al usuario.

export function translateAuthError(raw?: string): string {
  const m = (raw ?? "").toLowerCase();

  if (!m) {
    return "No se pudo completar la acción. Inténtalo de nuevo en unos minutos.";
  }

  // Correo ya registrado
  if (m.includes("already") || m.includes("registered") || m.includes("exists")) {
    return "Ese correo ya está registrado. Inicia sesión con él, o usa otro correo para crear una cuenta nueva.";
  }

  // Contraseña débil o filtrada (HaveIBeenPwned)
  if (
    m.includes("weak") ||
    m.includes("pwned") ||
    m.includes("leaked") ||
    m.includes("easy to guess")
  ) {
    return "Esa contraseña es muy común o apareció en filtraciones. Elige una más segura: mínimo 8 caracteres, combinando letras y números.";
  }

  // Contraseña muy corta
  if (m.includes("at least") || m.includes("too short") || m.includes("password should")) {
    return "La contraseña es muy corta. Usa al menos 8 caracteres, combinando letras y números.";
  }

  // Correo con formato inválido
  if (m.includes("validate email") || (m.includes("invalid") && m.includes("email"))) {
    return "El correo no parece válido. Revisa que esté bien escrito (ejemplo: nombre@dominio.com).";
  }

  // Demasiados intentos (rate limit)
  if (
    m.includes("rate limit") ||
    m.includes("too many") ||
    m.includes("over_email_send") ||
    (m.includes("after") && m.includes("seconds"))
  ) {
    return "Hiciste varios intentos seguidos. Espera unos minutos y vuelve a intentarlo.";
  }

  // Registro deshabilitado
  if (m.includes("signup") && (m.includes("disabled") || m.includes("not allowed"))) {
    return "El registro está deshabilitado por ahora. Contacta al administrador del sistema.";
  }

  // Falta confirmar el correo
  if (m.includes("confirm") && m.includes("email")) {
    return "Debes confirmar tu correo antes de entrar. Revisa tu bandeja de entrada y la carpeta de spam.";
  }

  // Respaldo genérico
  return "No se pudo crear la cuenta. Revisa tus datos e inténtalo de nuevo; si el problema continúa, espera unos minutos.";
}
