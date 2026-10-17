import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";

// El plugin MCP de Lovable (para su agente) rompe el arranque en Windows: compara
// rutas normalizadas con "/" contra las de Windows con "\" y aborta. Solo aporta en
// el entorno de Lovable, asi que lo activamos donde funciona y lo omitimos en Windows.
//
// Auditoría 2026-10 (puerta 15): trustForwardedHost se deja en true A PROPÓSITO y
// de forma explícita. Con true, las rutas MCP derivan el origen público de
// X-Forwarded-Host en vez de Host. El proxy web de Lovable reescribe Host hacia
// el backend interno y SOBRESCRIBE X-Forwarded-Host con el dominio público
// real, así que un cliente no puede falsearlo; con false, los dominios
// personalizados anunciarían el host interno y el MCP dejaría de funcionar.
// Cambiar a false SOLO si algún día se despliega detrás de un proxy que no
// sobrescriba esa cabecera (un cliente podría falsearla y envenenar la
// caché pública de /.well-known/oauth-protected-resource, que dura 5 min).
const lovableMcpPlugins =
  process.platform === "win32" ? [] : [mcpPlugin({ trustForwardedHost: true })];

export default defineConfig({
  tanstackStart: {
    server: { entry: "server" },
  },
  plugins: [...lovableMcpPlugins],
  // Ya eran los valores por defecto de Vite (confirmado inspeccionando
  // .output/public/assets tras un build real: JS minificado en una sola
  // línea, sin .map ni comentario sourceMappingURL) -- se dejan explícitos
  // para que no dependan de un default implícito que una futura versión
  // de Vite pudiera cambiar.
  vite: {
    build: {
      sourcemap: false,
      minify: true,
    },
  },
});
