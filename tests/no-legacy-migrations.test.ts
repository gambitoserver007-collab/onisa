// Auditoría de seguridad 2026-10 (8ª pasada): el historial viejo de migraciones tiene
// definiciones más débiles que el instalador (ver docs/legacy-migrations/README.md). Si
// vuelve a estar en supabase/migrations/, `supabase db push`, una rama de vista previa o una
// sincronización de Lovable lo aplicarían sobre la base real.
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.join(__dirname, "..");

describe("Historial de migraciones", () => {
  it("supabase/migrations/ no contiene archivos .sql", () => {
    const dir = path.join(root, "supabase", "migrations");
    const sql = existsSync(dir)
      ? readdirSync(dir).filter((f) => f.endsWith(".sql"))
      : [];

    expect(sql).toEqual([]);
  });

  it("CONTROL: el historial sigue guardado (solo lectura) en docs/legacy-migrations/", () => {
    const dir = path.join(root, "docs", "legacy-migrations");

    expect(
      readdirSync(dir).filter((f) => f.endsWith(".sql")).length,
    ).toBeGreaterThan(0);
  });
});
