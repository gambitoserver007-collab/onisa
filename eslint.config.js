import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // Los últimos 3 patrones son emitidos por el plugin @lovable.dev/mcp-js
    // (banner "AUTO-GENERATED ... do not edit" en cada archivo) en cada build/dev
    // con un formato que no coincide con Prettier -- lintearlos hace que el
    // repo "falle" lint tras cada build aunque nadie haya tocado nada a mano.
    ignores: [
      "dist",
      ".output",
      ".vinxi",
      "supabase/functions",
      "src/routes/\\[.mcp\\]/**",
      "src/routes/\\[.well-known\\]/**",
      "src/routes/mcp.ts",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "server-only",
              message:
                "TanStack Start does not use the Next.js `server-only` package. Rename the module to `*.server.ts` or mark it with `@tanstack/react-start/server-only`.",
            },
          ],
        },
      ],
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  eslintPluginPrettier,
);
