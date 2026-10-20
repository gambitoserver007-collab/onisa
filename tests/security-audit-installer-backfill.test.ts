// Auditoría de seguridad 2026-10 (4ª pasada): los rellenos "de una sola vez"
// del instalador corrían en CADA ejecución. Como se unían por el nombre
// 'Principal' (editable, no único), cada re-ejecución inventaba stock duplicado
// en 'Principal' para los productos que solo estaban en otra sucursal, y
// reasignaba filas sin sucursal o restringía cajeros que el administrador había
// dejado libres. Ahora corren una sola vez (marcas en installer_migrations).
// Cada puerta trae CONTROLES: lo legítimo sigue funcionando.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  asAnon,
  asUser,
  createTestDb,
  errMessage,
  makeCompany,
  makeProduct,
  makeUser,
  type TestCompany,
} from "./helpers/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const rerunInstaller = (db: PGlite) =>
  db.exec(
    readFileSync(
      path.join(__dirname, "../supabase/install/01_install.sql"),
      "utf-8",
    ),
  );

async function rejects(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();

    return null;
  } catch (err) {
    return errMessage(err);
  }
}

describe("Instalador: re-ejecutarlo no toca el inventario ni las asignaciones", () => {
  let db: PGlite;
  let C: TestCompany;
  let cashier: string;
  let productB: string;

  const rows = async (productId: string) =>
    (
      await db.query<{ location_id: string; stock: string }>(
        "select location_id, stock from public.product_locations where product_id=$1 order by stock",
        [productId],
      )
    ).rows;

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa instalador");
    cashier = await makeUser(db, C.id, "user");
    // Producto que SOLO está en la sucursal 2 (no tiene fila en 'Principal').
    productB = await makeProduct(db, C.id, C.loc2, "SoloB", 1, 100, 10);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("re-ejecutar el instalador NO crea existencias en 'Principal' para un producto que solo está en otra sucursal", async () => {
    await rerunInstaller(db);
    await rerunInstaller(db);

    const r = await rows(productB);

    expect(r).toHaveLength(1);
    expect(r[0].location_id).toBe(C.loc2);
    expect(Number(r[0].stock)).toBe(10);
  }, 240_000);

  it("un cajero que crea otra sucursal llamada 'Principal' no multiplica el inventario al re-ejecutar", async () => {
    const plant = await rejects(() =>
      asUser(db, cashier, () =>
        db.query(
          "insert into public.locations (company_id, name) values ($1,'Principal')",
          [C.id],
        ),
      ),
    );

    // La política actual permite crear sucursales a cualquier miembro (decisión
    // documentada); lo que importa es que ya no sirve para duplicar stock.
    expect(plant).toBeNull();

    await rerunInstaller(db);

    expect(await rows(productB)).toHaveLength(1);
  }, 120_000);

  it("las filas sin sucursal NO se reasignan a un 'Principal' al re-ejecutar", async () => {
    await db.query(
      `insert into public.stock_movements (company_id, product_id, location_id, movement_type, qty)
       values ($1,$2,null,'adjustment',1)`,
      [C.id, productB],
    );

    await rerunInstaller(db);

    const { rows: m } = await db.query<{ n: string }>(
      "select count(*)::int as n from public.stock_movements where company_id=$1 and location_id is null",
      [C.id],
    );

    expect(Number(m[0].n)).toBe(1);
  }, 120_000);

  it("un cajero que el administrador dejó SIN restricción de sucursal sigue libre tras re-ejecutar", async () => {
    const free = await makeUser(db, C.id, "user");

    await db.query("update public.profiles set location_id = $2 where id=$1", [
      free,
      C.loc1,
    ]);
    await db.query("delete from public.profile_locations where profile_id=$1", [
      free,
    ]);

    await rerunInstaller(db);

    const { rows: pl } = await db.query<{ n: string }>(
      "select count(*)::int as n from public.profile_locations where profile_id=$1",
      [free],
    );

    expect(Number(pl[0].n)).toBe(0);
  }, 120_000);

  it("la tabla de marcas no es legible por usuarios ni por visitantes", async () => {
    const user = await rejects(() =>
      asUser(db, cashier, () =>
        db.query("select * from public.installer_migrations"),
      ),
    );
    const anon = await rejects(() =>
      asAnon(db, () => db.query("select * from public.installer_migrations")),
    );

    expect(user).toMatch(/permission denied/i);
    expect(anon).toMatch(/permission denied/i);
  });
});

describe("Controles: el relleno antiguo sigue funcionando UNA vez en una base heredada", () => {
  let db: PGlite;
  let C: TestCompany;
  let legacyProduct: string;

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa heredada");
    legacyProduct = await makeProduct(db, C.id, C.loc1, "Legado", 1, 100, 7);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("una instalación nueva deja las dos marcas puestas", async () => {
    const marks = await db.query<{ name: string }>(
      "select name from public.installer_migrations order by name",
    );

    expect(marks.rows.map((r) => r.name)).toEqual([
      "legacy_location_backfill",
      "legacy_profile_locations_backfill",
    ]);
  });

  it("primer arranque en una base de producción (sin marcas): las pone SIN correr el relleno ni duplicar nada", async () => {
    // Estado de la base real del dueño antes de este arreglo: ya existe
    // product_locations, el producto está solo en una sucursal y no hay marcas.
    await db.query("delete from public.installer_migrations");
    await db.query("delete from public.product_locations where product_id=$1", [
      legacyProduct,
    ]);
    await db.query(
      "insert into public.product_locations (company_id, product_id, location_id, stock, is_active) values ($1,$2,$3,7,true)",
      [C.id, legacyProduct, C.loc2],
    );

    await rerunInstaller(db);

    const marks = await db.query<{ name: string }>(
      "select name from public.installer_migrations order by name",
    );
    const pl = await db.query(
      "select location_id, stock from public.product_locations where product_id=$1",
      [legacyProduct],
    );

    expect(marks.rows.map((r) => r.name)).toEqual([
      "legacy_location_backfill",
      "legacy_profile_locations_backfill",
    ]);
    // Sigue con su única fila (sucursal 2, 7 piezas): no se inventó nada en 'Principal'.
    expect(pl.rows).toHaveLength(1);
    expect(pl.rows[0].location_id).toBe(C.loc2);
  }, 120_000);
});
