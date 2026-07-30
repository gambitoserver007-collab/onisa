// Genera una copia LISTA PARA ENTREGAR del proyecto, sin tus secretos ni archivos internos.
//
// Uso:  node scripts/package-plr.mjs   (o:  npm run package:plr)
// Salida: carpeta ./entrega-plr/  -> comprímela y esa es la que le das al comprador.
//
// Qué hace:
//   - Copia el proyecto EXCLUYENDO: node_modules, dist, .git, .lovable, .tanstack,
//     .codex, .claude, logs y la propia carpeta de salida.
//   - NO copia .env ni .env.local (tienen TUS claves de Supabase).
//     El comprador crea su propio .env desde .env.example.

import { cpSync, rmSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const OUT = "entrega-plr";

// Entradas de primer nivel que NO se entregan (carpetas internas + archivos con secretos).
const EXCLUDE_TOP = new Set([
  ".git",
  ".lovable",
  ".tanstack",
  ".codex",
  ".claude",
  "node_modules",
  "dist",
  "dist-ssr",
  ".output",
  ".wrangler",
  "ficha_tecnica",
  OUT,
  ".env",
  ".env.local",
  ".dev.vars",
]);

// Filtro para subniveles: nunca copiar .env(.local) ni logs aunque estén anidados.
function keepNested(src) {
  const name = src.replace(/\\/g, "/").split("/").pop();
  if (name === ".env" || name === ".env.local" || name === ".dev.vars")
    return false;
  if (/\.log$/.test(name)) return false;
  return true;
}

if (existsSync(OUT)) rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const entry of readdirSync(".")) {
  if (EXCLUDE_TOP.has(entry)) continue;
  cpSync(entry, join(OUT, entry), { recursive: true, filter: keepNested });
}

// Seguridad extra: borra cualquier .env que se haya colado.
for (const f of [".env", ".env.local"]) {
  const p = join(OUT, f);
  if (existsSync(p)) rmSync(p, { force: true });
}

const top = readdirSync(OUT).sort().join(", ");
console.log("\n[OK] Copia de entrega lista en  ./" + OUT);
console.log("   - SIN .env / .env.local (sin tus claves de Supabase).");
console.log("   - SIN node_modules, dist, .git, .lovable, .tanstack, logs.");
console.log("   - El comprador crea su .env desde .env.example.");
console.log("\nContenido (primer nivel): " + top);
console.log(
  "\nSiguiente paso: comprime la carpeta ./" + OUT + " y entrega ese .zip.\n",
);
