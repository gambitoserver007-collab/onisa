// Auditoría de seguridad 2026-10 (17ª pasada):
//   - El pie del ticket y la impresora de una sucursal los edita solo un admin
//     (cualquier miembro seguía pudiendo editar nombre / dirección, decisión 2026-09).
//   - Un ajuste negativo de inventario exige un motivo (antes se guardaba como
//     "Ajuste manual" y servía para esconder faltantes).
// Cada puerta trae CONTROLES: lo legítimo sigue funcionando.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asUser,
  createTestDb,
  errMessage,
  makeCompany,
  makeProduct,
  makeUser,
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

describe("Pie del ticket e impresora: solo el administrador", () => {
  let db: PGlite;
  let C: TestCompany;
  let admin: string;
  let cashier: string;

  const update = (userId: string, set: string, params: unknown[] = []) =>
    asUser(db, userId, () =>
      db.query(`update public.locations set ${set} where id=$1`, [
        C.loc1,
        ...params,
      ]),
    );

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa tickets");
    admin = await makeUser(db, C.id, "admin");
    cashier = await makeUser(db, C.id, "user");
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: el admin cambia el pie del ticket y la impresora", async () => {
    expect(
      await rejects(() =>
        update(admin, "ticket_footer_text=$2, ticket_qz_printer_name=$3", [
          "Gracias por su compra",
          "EPSON-TM20",
        ]),
      ),
    ).toBeNull();
  });

  it("un cajero NO puede cambiar el pie del ticket ni la impresora", async () => {
    const footer = await rejects(() =>
      update(cashier, "ticket_footer_text=$2", ["Paga a la cuenta 0000"]),
    );
    const printer = await rejects(() =>
      update(cashier, "ticket_qz_printer_name=$2", ["OTRA"]),
    );

    expect(footer).toMatch(/administrador/i);
    expect(printer).toMatch(/administrador/i);

    const { rows } = await db.query<{ f: string; p: string }>(
      "select ticket_footer_text f, ticket_qz_printer_name p from public.locations where id=$1",
      [C.loc1],
    );

    expect(rows[0].f).toBe("Gracias por su compra");
    expect(rows[0].p).toBe("EPSON-TM20");
  });

  it("CONTROL: el cajero sigue editando el nombre y no choca si manda el mismo pie sin cambiarlo", async () => {
    expect(
      await rejects(() => update(cashier, "name=$2", ["Sucursal renombrada"])),
    ).toBeNull();
    expect(
      await rejects(() =>
        update(cashier, "name=$2, ticket_footer_text=$3", [
          "Sucursal otra vez",
          "Gracias por su compra",
        ]),
      ),
    ).toBeNull();
  });
});

describe("Ajustes negativos de inventario: el motivo es obligatorio", () => {
  let db: PGlite;
  let C: TestCompany;
  let admin: string;
  let product: string;

  const adjust = (qty: number, notes: string | null) =>
    asUser(db, admin, () =>
      db.query("select adjust_stock($1,$2,$3::numeric,$4)", [
        product,
        C.loc1,
        qty,
        notes,
      ]),
    );

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa ajustes");
    admin = await makeUser(db, C.id, "admin");
    product = await makeProduct(db, C.id, C.loc1, "P", 1, 10, 50);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("un ajuste negativo sin motivo, con motivo vacío o demasiado corto se rechaza (el stock no cambia)", async () => {
    for (const notes of [null, "", "   ", "x", "abc"]) {
      const err = await rejects(() => adjust(-3, notes));

      expect(err, String(notes)).toMatch(/motivo del ajuste negativo/i);
    }

    const { rows } = await db.query<{ stock: string }>(
      "select stock from public.product_locations where product_id=$1 and location_id=$2",
      [product, C.loc1],
    );

    expect(Number(rows[0].stock)).toBe(50);
  });

  it("CONTROL: un ajuste negativo con motivo se acepta y el motivo queda en el kardex", async () => {
    expect(await rejects(() => adjust(-3, "Merma por humedad"))).toBeNull();

    const { rows } = await db.query<{ notes: string }>(
      "select notes from public.stock_movements where product_id=$1 and movement_type='adjustment'",
      [product],
    );

    expect(rows[0].notes).toBe("Merma por humedad");
  });

  it("CONTROL: un ajuste POSITIVO no pide motivo", async () => {
    expect(await rejects(() => adjust(5, null))).toBeNull();
  });

  it("CONTROL: el conteo físico (motivo fijo de la pantalla) sigue funcionando al descontar", async () => {
    expect(await rejects(() => adjust(-1, "Conteo físico"))).toBeNull();
  });
});
