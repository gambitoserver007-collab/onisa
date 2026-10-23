// Protección contra clickjacking de la pantalla de consentimiento OAuth
// (/.lovable/oauth/consent): un botón "Aprobar" de un solo clic que concede a un
// cliente externo acceso como el usuario no debe poder cargarse dentro de un
// iframe de otro sitio.
//
// Solo se protege esa ruta (no toda la app) porque el editor/vista previa de
// Lovable sí necesita enmarcar el resto de las pantallas.
export const CONSENT_PATH = "/.lovable/oauth/consent";

/** true si la página está dentro de un iframe (o no se puede saber: se asume que sí). */
export function isEmbeddedInFrame(
  win: { top: unknown; self: unknown } | undefined = typeof window ===
  "undefined"
    ? undefined
    : window,
): boolean {
  if (!win) return false;

  try {
    return win.top !== win.self;
  } catch {
    return true;
  }
}

/** Agrega X-Frame-Options / frame-ancestors a la respuesta de la ruta de consentimiento. */
export function withFramingProtection(
  request: Request,
  response: Response,
): Response {
  let pathname = "";

  try {
    pathname = new URL(request.url).pathname;
  } catch {
    return response;
  }

  if (pathname.replace(/\/+$/, "") !== CONSENT_PATH) return response;

  const headers = new Headers(response.headers);

  headers.set("X-Frame-Options", "DENY");

  const csp = headers.get("Content-Security-Policy");

  headers.set(
    "Content-Security-Policy",
    csp ? `${csp}; frame-ancestors 'none'` : "frame-ancestors 'none'",
  );

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
