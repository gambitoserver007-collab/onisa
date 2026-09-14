// CORS compartido por las Edge Functions administrativas (admin-create-company,
// team-create-user, team-manage-user). Antes cada una tenía
// "Access-Control-Allow-Origin": "*" fijo -- como la autenticación es por
// Bearer token (no cookies), un origen abierto no habilita CSRF, pero sí deja
// que cualquier sitio con un token robado (por ejemplo, vía XSS en otra parte)
// pueda invocarlas desde el navegador. Auditoría 2026-09, hallazgo #8.
//
// ALLOWED_ORIGINS es un secret del proyecto (lista separada por comas, ej.
// "https://miapp.com,https://miapp.lovable.app"). Configúralo con:
//   supabase secrets set ALLOWED_ORIGINS="https://tu-dominio.com"
// Sin configurar, se mantiene el comportamiento anterior (cualquier origen)
// para no romper la app en producción mientras se define el dominio real.
const allowedOrigins = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

export function buildCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("Origin") ?? "";
  const allowOrigin =
    allowedOrigins.length === 0
      ? "*"
      : allowedOrigins.includes(origin)
        ? origin
        : allowedOrigins[0];

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}
