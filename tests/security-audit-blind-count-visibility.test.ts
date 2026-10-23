// Auditoría de seguridad 2026-10 (4ª pasada): arqueo ciego del lado del servidor.
//   - get_cash_session_cash_sales (el efectivo esperado) solo para admin/finanzas,
//     ni siquiera para quien abrió la caja.
//   - Los conteos (y sus renglones por denominación) solo los ven admin/finanzas/
//     gerente, quien los hizo, o quien abrió la caja: el testigo del segundo
//     conteo ya no lee el total del primero, así que su conteo es independiente.
//   - sessions_needing_second_count le dice al testigo qué cajas esperan segundo
//     conteo y quién hizo el primero, sin ningún monto.
//   - Los candados de corte se toman sobre la caja SIEMPRE (no solo cuando el
//     corte ya está guardado): ver el último test.
// Cada puerta trae CONTROLES: lo legítimo sigue funcionando.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asUser,
  createSale,
  createTestDb,
  errMessage,
  finishTillCount,
  makeCompany,
  makeProduct,
  makeUser,
  submitTillCount,
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

describe("Arqueo ciego: lo que el servidor entrega a cada rol", () => {
  let db: PGlite;
  let C: TestCompany;
  let opener: string;
  let witness: string;
  let admin: string;
  let finanzas: string;
  let operador: string;
  let sessionId: string;

  const sessionCounts = (userId: string) =>
    asUser(db, userId, () =>
      db.query<{ count_number: number; counted_cash_total: string }>(
        "select count_number, counted_cash_total from public.till_counts where cash_session_id=$1 order by count_number",
        [sessionId],
      ),
    );

  const countLines = (userId: string) =>
    asUser(db, userId, () => db.query("select 1 from public.till_count_lines"));

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa arqueo ciego");
    opener = await makeUser(db, C.id, "user");
    witness = await makeUser(db, C.id, "user");
    admin = await makeUser(db, C.id, "admin");
    finanzas = await makeUser(db, C.id, "finanzas");
    operador = await makeUser(db, C.id, "operador");
    const product = await makeProduct(db, C.id, C.loc1, "P", 1, 50, 100);

    sessionId = (
      await asUser(db, opener, () =>
        db.query<{ s: string }>("select open_cash_session(200,$1) as s", [
          C.loc1,
        ]),
      )
    ).rows[0].s;
    await asUser(db, opener, () =>
      createSale(db, [{ product_id: product, qty: 1, unit_price: 50 }], C.loc1),
    );
    // Primer conteo corto (esperado 250, cuenta 100): pide segundo conteo.
    await asUser(db, opener, () =>
      submitTillCount(db, sessionId, [{ denomination: 100, quantity: 1 }]),
    );
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: admin y finanzas sí obtienen el efectivo de ventas del turno", async () => {
    for (const u of [admin, finanzas]) {
      const { rows } = await asUser(db, u, () =>
        db.query<{ v: string }>("select get_cash_session_cash_sales($1) as v", [
          sessionId,
        ]),
      );

      expect(Number(rows[0].v)).toBe(50);
    }
  });

  it("ni quien abrió la caja, ni otro cajero, ni un operador pueden pedir el efectivo de ventas del turno", async () => {
    for (const u of [opener, witness, operador]) {
      const err = await rejects(() =>
        asUser(db, u, () =>
          db.query("select get_cash_session_cash_sales($1)", [sessionId]),
        ),
      );

      expect(err).toMatch(/no autorizado/i);
    }
  });

  it("CONTROL: quien hizo el conteo y quien abrió la caja ven el conteo; admin/finanzas ven todo", async () => {
    expect((await sessionCounts(opener)).rows).toHaveLength(1);
    expect((await sessionCounts(admin)).rows).toHaveLength(1);
    expect((await sessionCounts(finanzas)).rows).toHaveLength(1);
    expect((await countLines(opener)).rows.length).toBeGreaterThan(0);
  });

  it("el testigo NO puede leer el total ni los renglones del primer conteo", async () => {
    expect((await sessionCounts(witness)).rows).toHaveLength(0);
    expect((await countLines(witness)).rows).toHaveLength(0);
  });

  it("el testigo sí encuentra la caja que espera segundo conteo y quién hizo el primero, sin montos", async () => {
    const { rows, fields } = await asUser(db, witness, () =>
      db.query<{ session_id: string; first_counted_by: string }>(
        "select * from sessions_needing_second_count($1)",
        [C.loc1],
      ),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0].session_id).toBe(sessionId);
    expect(rows[0].first_counted_by).toBe(opener);
    expect(fields.map((f) => f.name).sort()).toEqual([
      "first_counted_by",
      "session_id",
    ]);
  });

  it("quien hizo el primer conteo y un operador no reciben cajas para 'ayudar'", async () => {
    for (const u of [opener, operador]) {
      const { rows } = await asUser(db, u, () =>
        db.query("select * from sessions_needing_second_count($1)", [C.loc1]),
      );

      expect(rows).toHaveLength(0);
    }
  });

  it("CONTROL: el testigo hace su conteo, ve el suyo pero no el primero, y el flujo cierra", async () => {
    await asUser(db, witness, () =>
      submitTillCount(db, sessionId, [{ denomination: 200, quantity: 1 }]),
    );

    const mine = await sessionCounts(witness);

    expect(mine.rows).toHaveLength(1);
    expect(mine.rows[0].count_number).toBe(2);

    // Quien abrió la caja ve ambos conteos de SU caja.
    expect((await sessionCounts(opener)).rows).toHaveLength(2);

    const done = await asUser(db, witness, () =>
      finishTillCount(db, sessionId),
    );

    expect(done.status).toBe("closed");
    // Una caja que ya tiene segundo conteo deja de aparecer en la lista.
    const { rows } = await asUser(db, admin, () =>
      db.query("select * from sessions_needing_second_count($1)", [C.loc1]),
    );

    expect(rows).toHaveLength(0);
  });
});

describe("Cortes de conteo: el candado se toma siempre", () => {
  it("los triggers bloquean la caja sin filtrar por el corte (no solo cuando ya está guardado)", async () => {
    const db = await createTestDb();

    try {
      const { rows } = await db.query<{ proname: string; src: string }>(
        `select proname, prosrc as src from pg_proc
         where proname in ('reject_sale_on_counting_till','reject_cash_movement_on_counting_till')`,
      );

      expect(rows).toHaveLength(2);

      for (const r of rows) {
        // Sin comentarios: solo cuenta el SQL ejecutable.
        const src = r.src
          .split("\n")
          .filter((l) => !l.trim().startsWith("--"))
          .join("\n")
          .toLowerCase();

        // FOR SHARE (no KEY SHARE): debe esperar también al UPDATE sin llave del conteo.
        expect(src, r.proname).toMatch(/for share/);
        expect(src, r.proname).not.toContain("for key share");
        // El corte se LEE de la fila bloqueada; no es parte del WHERE.
        expect(src, r.proname).not.toMatch(/count_cutoff_at\s+is\s+not\s+null/);
      }
    } finally {
      await db.close();
    }
  }, 120_000);
});
