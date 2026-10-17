// Valida el parámetro ?next= del login antes de navegar a él después de
// iniciar sesión. Solo acepta rutas internas de la propia app.
//
// Auditoría 2026-10 (puerta 13): la validación anterior solo miraba que
// empezara con "/" y no con "//". Pero el navegador (parser de URL WHATWG)
// trata "\" como "/" y descarta tabuladores/saltos de línea, así que
// "/\sitio-malo.com" o "/<TAB>/sitio-malo.com" pasaban la revisión y
// terminaban siendo "//sitio-malo.com": una redirección a otro sitio justo
// después de que la persona escribió su contraseña en el login real.
const PLACEHOLDER_ORIGIN = "https://safe-next.invalid";

function hasBackslashOrControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);

    if (code === 0x5c || code < 0x20 || code === 0x7f) return true;
  }

  return false;
}

export function safeNext(next: string | undefined): string | null {
  if (!next) return null;
  // Barras invertidas y caracteres de control: el navegador los normaliza de
  // forma que el destino final ya no es el que se ve en la cadena.
  if (hasBackslashOrControlChar(next)) return null;
  if (!next.startsWith("/") || next.startsWith("//")) return null;

  let url: URL;
  try {
    url = new URL(next, PLACEHOLDER_ORIGIN);
  } catch {
    return null;
  }

  // Si al resolverla contra un origen de mentira cambia de origen, no es una
  // ruta interna.
  if (url.origin !== PLACEHOLDER_ORIGIN) return null;

  // La normalización de "." y ".." puede producir otra vez "//host"
  // (p. ej. "/..//host" -> "//host"): se revisa el resultado final.
  const result = url.pathname + url.search + url.hash;

  if (result.startsWith("//")) return null;

  return result;
}
