// Auditoría de seguridad 2026-10 (3ª pasada): permisos del rol `anon`.
// Supabase concede por defecto ALL sobre cada tabla nueva de `public` a anon;
// con eso, las políticas RLS "public catalog" dejaban a un visitante sin
// sesión leer TODAS las columnas (products.cost, products.stock, datos
// fiscales y de contacto de companies). El instalador debe quitar esos
// permisos y dejar solo los de columna que usa la tienda en línea.
// El arnés emula los permisos por defecto de Supabase con
// `createTestDb({ supabaseDefaultPrivileges: true })`.
// Cada puerta trae CONTROLES: lo legítimo sigue funcionando.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asAnon,
  createTestDb,
  errMessage,
  makeCompany,
  makeProduct,
  type TestCompany,
} from "./helpers/db";

async function rejects(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();

    return null;
  } catch (err) {
    return errMessage(err);
  }
}

const PUBLIC_COLUMNS: Record<string, string[]> = {
  companies: [
    "id",
    "name",
    "slug",
    "locale",
    "currency_code",
    "online_catalog_enabled",
    // Solo la fecha de baja: la política de la tienda la necesita para no mostrar empresas eliminadas.
    "deleted_at",
  ],
  products: [
    "id",
    "company_id",
    "category_id",
    "name",
    "price",
    "image_url",
    "unit",
    "is_public_available",
    "show_online",
    "active",
    "deleted_at",
  ],
  categories: ["id", "company_id", "name"],
};

const PUBLIC_TABLES = ["subscription_plans", "platform_settings"];

describe("Rol anon: permisos mínimos aun con los permisos por defecto de Supabase", () => {
  let db: PGlite;
  let C: TestCompany;
  let hiddenId: string;

  beforeAll(async () => {
    db = await createTestDb({ supabaseDefaultPrivileges: true });
    C = await makeCompany(db, "Tienda pública");
    await db.query(
      "update public.companies set online_catalog_enabled = true, slug = 'tienda-publica', fiscal_id = 'RFC-SECRETO' where id=$1",
      [C.id],
    );
    await makeProduct(db, C.id, C.loc1, "Visible", 1, 100, 7);
    hiddenId = await makeProduct(db, C.id, C.loc1, "Oculto", 1, 100, 7);
    await db.query(
      "update public.products set show_online = false where id=$1",
      [hiddenId],
    );
    // Costo conocido para detectar fugas.
    await db.query("update public.products set cost = 42 where company_id=$1", [
      C.id,
    ]);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: el catálogo público sigue legible con sus columnas de tienda", async () => {
    const { rows } = await asAnon(db, () =>
      db.query<{ name: string; price: string }>(
        "select name, price from public.products where company_id=$1",
        [C.id],
      ),
    );

    expect(rows.map((r) => r.name)).toEqual(["Visible"]);

    const co = await asAnon(db, () =>
      db.query<{ name: string }>(
        "select id, name, slug, currency_code from public.companies where slug='tienda-publica'",
      ),
    );

    expect(co.rows).toHaveLength(1);

    const cats = await asAnon(db, () =>
      db.query("select id, company_id, name from public.categories"),
    );

    expect(cats.rows).toBeDefined();
  });

  it("CONTROL: la landing sigue viendo los planes y la marca de plataforma", async () => {
    expect(
      await rejects(() =>
        asAnon(db, () =>
          db.query("select name, price from public.subscription_plans"),
        ),
      ),
    ).toBeNull();
    expect(
      await rejects(() =>
        asAnon(db, () =>
          db.query("select brand_name, logo_url from public.platform_settings"),
        ),
      ),
    ).toBeNull();
  });

  it("anon NO puede leer el costo ni el stock de los productos", async () => {
    for (const col of ["cost", "stock", "barcode", "sku"]) {
      const err = await rejects(() =>
        asAnon(db, () =>
          db.query(`select ${col} from public.products where company_id=$1`, [
            C.id,
          ]),
        ),
      );

      expect(err, col).toMatch(/permission denied/i);
    }

    const star = await rejects(() =>
      asAnon(db, () =>
        db.query("select * from public.products where company_id=$1", [C.id]),
      ),
    );

    expect(star).toMatch(/permission denied/i);
  });

  it("anon NO puede leer datos fiscales ni de contacto de la empresa", async () => {
    const fiscalId = await rejects(() =>
      asAnon(db, () =>
        db.query(
          "select fiscal_id from public.companies where slug='tienda-publica'",
        ),
      ),
    );
    const star = await rejects(() =>
      asAnon(db, () =>
        db.query("select * from public.companies where slug='tienda-publica'"),
      ),
    );

    expect(fiscalId).toMatch(/permission denied/i);
    expect(star).toMatch(/permission denied/i);
  });

  it("anon solo tiene permiso de columna sobre las columnas de la tienda", async () => {
    for (const [table, allowed] of Object.entries(PUBLIC_COLUMNS)) {
      const { rows } = await db.query<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_schema='public' and table_name=$1`,
        [table],
      );
      const readable: string[] = [];

      for (const { column_name } of rows) {
        const r = await db.query<{ ok: boolean }>(
          "select has_column_privilege('anon', $1, $2, 'SELECT') as ok",
          [`public.${table}`, column_name],
        );

        if (r.rows[0].ok) readable.push(column_name);
      }

      expect(readable.sort(), table).toEqual([...allowed].sort());
    }
  });

  it("anon no tiene NINGÚN permiso de escritura en ninguna tabla de public", async () => {
    const { rows } = await db.query<{ t: string }>(
      `select c.relname as t
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname='public' and c.relkind in ('r','p','v','m')
         and (has_table_privilege('anon', c.oid, 'INSERT')
           or has_table_privilege('anon', c.oid, 'UPDATE')
           or has_table_privilege('anon', c.oid, 'DELETE')
           or has_table_privilege('anon', c.oid, 'TRUNCATE')
           or has_table_privilege('anon', c.oid, 'REFERENCES')
           or has_table_privilege('anon', c.oid, 'TRIGGER'))`,
    );

    expect(rows.map((r) => r.t)).toEqual([]);
  });

  it("anon solo lee (tabla completa) las tablas públicas esperadas", async () => {
    const { rows } = await db.query<{ t: string }>(
      `select c.relname as t
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname='public' and c.relkind in ('r','p','v','m')
         and has_table_privilege('anon', c.oid, 'SELECT')
       order by 1`,
    );

    expect(rows.map((r) => r.t)).toEqual([...PUBLIC_TABLES].sort());
  });

  it("una tabla creada DESPUÉS de instalar no hereda permisos para anon", async () => {
    await db.exec("create table public.zz_tabla_futura (id int, secreto text)");

    const { rows } = await db.query<{ ok: boolean }>(
      "select has_table_privilege('anon','public.zz_tabla_futura','SELECT') as ok",
    );

    expect(rows[0].ok).toBe(false);

    const err = await rejects(() =>
      asAnon(db, () => db.query("select * from public.zz_tabla_futura")),
    );

    expect(err).toMatch(/permission denied/i);

    // CONTROL: authenticated y service_role conservan los permisos por defecto.
    const auth = await db.query<{ ok: boolean }>(
      "select has_table_privilege('authenticated','public.zz_tabla_futura','SELECT') as ok",
    );

    expect(auth.rows[0].ok).toBe(true);
  });

  it("re-correr el instalador es idempotente y mantiene los permisos mínimos", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");

    await db.exec(
      readFileSync(
        path.join(
          path.dirname(fileURLToPath(import.meta.url)),
          "../supabase/install/01_install.sql",
        ),
        "utf-8",
      ),
    );

    const err = await rejects(() =>
      asAnon(db, () =>
        db.query("select cost from public.products where company_id=$1", [
          C.id,
        ]),
      ),
    );
    const ok = await rejects(() =>
      asAnon(db, () => db.query("select name, price from public.products")),
    );

    expect(err).toMatch(/permission denied/i);
    expect(ok).toBeNull();
  }, 120_000);
});
