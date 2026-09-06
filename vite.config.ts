import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/tanstack/vite";

// El plugin MCP de Lovable (para su agente) rompe el arranque en Windows: compara
// rutas normalizadas con "/" contra las de Windows con "\" y aborta. Solo aporta en
// el entorno de Lovable, asi que lo activamos donde funciona y lo omitimos en Windows.
const lovableMcpPlugins = process.platform === "win32" ? [] : [mcpPlugin()];

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
