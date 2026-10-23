// Auditoría de seguridad 2026-10 (5ª pasada): la pantalla de consentimiento
// OAuth (/.lovable/oauth/consent) tiene un botón "Aprobar" de un clic que da a
// un cliente externo acceso como el usuario; no debe poder enmarcarse en otro
// sitio (clickjacking). Solo se protege esa ruta: la vista previa de Lovable
// necesita enmarcar el resto de la app.
import { describe, expect, it } from "vitest";
import {
  CONSENT_PATH,
  isEmbeddedInFrame,
  withFramingProtection,
} from "../src/lib/framing";

const page = () =>
  new Response("<html></html>", {
    status: 200,
    headers: { "content-type": "text/html" },
  });

describe("Consentimiento OAuth: protección contra iframes", () => {
  it("la ruta de consentimiento responde con X-Frame-Options y frame-ancestors", () => {
    const res = withFramingProtection(
      new Request(
        `https://app.example.com${CONSENT_PATH}?authorization_id=abc`,
      ),
      page(),
    );

    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Content-Security-Policy")).toBe(
      "frame-ancestors 'none'",
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/html");
  });

  it("conserva una CSP existente y le agrega frame-ancestors", () => {
    const original = new Response("x", {
      headers: { "Content-Security-Policy": "default-src 'self'" },
    });
    const res = withFramingProtection(
      new Request(`https://app.example.com${CONSENT_PATH}/`),
      original,
    );

    expect(res.headers.get("Content-Security-Policy")).toBe(
      "default-src 'self'; frame-ancestors 'none'",
    );
  });

  it("CONTROL: el resto de las rutas NO se tocan (la vista previa de Lovable las enmarca)", () => {
    for (const path of ["/", "/pos", "/login", "/.lovable/oauth/other"]) {
      const original = page();
      const res = withFramingProtection(
        new Request(`https://app.example.com${path}`),
        original,
      );

      expect(res, path).toBe(original);
      expect(res.headers.get("X-Frame-Options"), path).toBeNull();
    }
  });

  it("dentro de un iframe no se ofrece aprobar; fuera de él sí", () => {
    const top = {};

    expect(isEmbeddedInFrame({ top, self: top })).toBe(false);
    expect(isEmbeddedInFrame({ top: {}, self: {} })).toBe(true);
    // Sin ventana (servidor): no hay iframe.
    expect(isEmbeddedInFrame(undefined)).toBe(false);
  });

  it("si leer window.top lanza (ventana de otro origen), se asume que está enmarcada", () => {
    const win = {
      get top(): unknown {
        throw new Error("SecurityError");
      },
      self: {},
    };

    expect(isEmbeddedInFrame(win)).toBe(true);
  });
});
