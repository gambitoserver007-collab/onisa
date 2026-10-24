// Auditoría de seguridad 2026-10 (2ª pasada): checador y horarios.
//   - Solo un admin cambia el horario de la sucursal (weekly_hours /
//     opening_hours); antes cualquier miembro podía escribirlo directo.
//   - El checador se bloquea tras 5 PIN incorrectos en 15 minutos, y un PIN
//     correcto no reinicia la cuenta.
// Cada puerta trae CONTROLES: lo legítimo sigue funcionando.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asUser,
  createTestDb,
  errMessage,
  makeCompany,
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

const WEEK = (from: string, to: string) =>
  JSON.stringify(
    Object.fromEntries(
      [1, 2, 3, 4, 5, 6, 7].map((d) => [String(d), { open: true, from, to }]),
    ),
  );

describe("Horario de la sucursal", () => {
  let db: PGlite;
  let C: TestCompany;
  let cashier: string;
  let admin: string;

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa horarios");
    cashier = await makeUser(db, C.id, "user");
    admin = await makeUser(db, C.id, "admin");
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: un admin sí puede cambiar el horario, directo y por la RPC validada", async () => {
    const direct = await rejects(() =>
      asUser(db, admin, () =>
        db.query(
          "update public.locations set opening_hours='9 a 6' where id=$1",
          [C.loc1],
        ),
      ),
    );
    const viaRpc = await rejects(() =>
      asUser(db, admin, () =>
        db.query("select update_location_weekly_hours($1,$2::jsonb)", [
          C.loc1,
          WEEK("09:00", "18:00"),
        ]),
      ),
    );

    expect(direct).toBeNull();
    expect(viaRpc).toBeNull();
  });

  it("CONTROL: un cajero sí puede seguir editando el resto de la configuración de la sucursal", async () => {
    const err = await rejects(() =>
      asUser(db, cashier, () =>
        db.query(
          "update public.locations set name='Sucursal Centro' where id=$1",
          [C.loc1],
        ),
      ),
    );

    expect(err).toBeNull();
  });

  it("un cajero NO puede escribir weekly_hours ni opening_hours directo", async () => {
    const weekly = await rejects(() =>
      asUser(db, cashier, () =>
        db.query(
          "update public.locations set weekly_hours=$2::jsonb where id=$1",
          [C.loc1, WEEK("23:59", "23:59")],
        ),
      ),
    );
    const legacy = await rejects(() =>
      asUser(db, cashier, () =>
        db.query(
          "update public.locations set opening_hours='24 horas' where id=$1",
          [C.loc1],
        ),
      ),
    );

    expect(weekly).toMatch(/administrador/i);
    expect(legacy).toMatch(/administrador/i);

    const { rows } = await db.query<{ opening_hours: string }>(
      "select opening_hours from public.locations where id=$1",
      [C.loc1],
    );

    expect(rows[0].opening_hours).toBe("9 a 6");
  });

  it("un cajero NO puede crear una sucursal, ni con horario ni sin él (solo el admin)", async () => {
    // Auditoría 2026-10 (13ª pasada): INSERT de sucursales solo para admin.
    const withHours = await rejects(() =>
      asUser(db, cashier, () =>
        db.query(
          "insert into public.locations (company_id, name, opening_hours) values ($1,'Nueva','24 horas')",
          [C.id],
        ),
      ),
    );
    const without = await rejects(() =>
      asUser(db, cashier, () =>
        db.query(
          "insert into public.locations (company_id, name) values ($1,'Otra')",
          [C.id],
        ),
      ),
    );

    // El trigger del horario se evalúa antes que la política de RLS.
    expect(withHours).toMatch(/administrador|row-level security/i);
    expect(without).toMatch(/row-level security/i);
  });
});

describe("Checador: límite de intentos del PIN", () => {
  let db: PGlite;
  let C: TestCompany;
  let admin: string;
  let employee: string;

  const punch = (pin: string) =>
    asUser(db, admin, () =>
      db.query<{ r: { ok?: boolean; error?: string; action?: string } }>(
        "select punch_employee($1,$2,'UTC') as r",
        [pin, C.loc1],
      ),
    ).then((r) => r.rows[0].r);

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa checador");
    admin = await makeUser(db, C.id, "admin");
    employee = await makeUser(db, C.id, "user");
    await asUser(db, admin, () =>
      db.query("select set_employee_pin($1,'4821')", [employee]),
    );
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("CONTROL: el PIN correcto registra la asistencia", async () => {
    const result = await punch("4821");

    expect(result.action).toBe("check_in");
  });

  it("un PIN incorrecto responde error (sin excepción) y deja registro del intento", async () => {
    const result = await punch("0001");

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/pin no reconocido/i);

    const { rows } = await db.query<{ n: string }>(
      "select count(*)::int as n from public.punch_failed_attempts where company_id=$1",
      [C.id],
    );

    expect(Number(rows[0].n)).toBe(1);
  });

  it("tras 5 intentos fallidos el checador se bloquea, incluso con el PIN correcto", async () => {
    for (const pin of ["0002", "0003", "0004", "0005"]) {
      const r = await punch(pin);

      expect(r.ok).toBe(false);
    }

    const locked = await rejects(() => punch("4821"));

    expect(locked).toMatch(/demasiados intentos/i);

    const lockedWrong = await rejects(() => punch("9999"));

    expect(lockedWrong).toMatch(/demasiados intentos/i);
  });

  it("un PIN correcto NO reinicia la cuenta de intentos fallidos", async () => {
    const { rows } = await db.query<{ n: string }>(
      "select count(*)::int as n from public.punch_failed_attempts where company_id=$1",
      [C.id],
    );

    // Siguen los 5 intentos fallidos: nadie puede "limpiar" la cuenta.
    expect(Number(rows[0].n)).toBe(5);
  });

  it("CONTROL: pasada la ventana de 15 minutos, el checador vuelve a funcionar", async () => {
    await db.query(
      "update public.punch_failed_attempts set attempted_at = now() - interval '16 minutes' where company_id=$1",
      [C.id],
    );

    const result = await punch("4821");

    expect(result.action).toBe("check_out");
  });

  it("la tabla de intentos no es accesible directamente para usuarios", async () => {
    const err = await rejects(() =>
      asUser(db, admin, () =>
        db.query("select * from public.punch_failed_attempts"),
      ),
    );

    expect(err).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 3ª pasada: el bloqueo es por sucursal, con un tope mayor para la empresa
// ---------------------------------------------------------------------------
describe("Checador: el bloqueo no deja sin checador a toda la empresa", () => {
  let db: PGlite;
  let C: TestCompany;
  let admin: string;
  let employee: string;

  const punchAt = (pin: string, locationId: string | null) =>
    asUser(db, admin, () =>
      db.query<{ r: { ok?: boolean; error?: string; action?: string } }>(
        "select punch_employee($1,$2,'UTC') as r",
        [pin, locationId],
      ),
    ).then((r) => r.rows[0].r);

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa checador por sucursal");
    admin = await makeUser(db, C.id, "admin");
    employee = await makeUser(db, C.id, "user");
    await asUser(db, admin, () =>
      db.query("select set_employee_pin($1,'4821')", [employee]),
    );
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("tras 5 fallos en una sucursal esa sucursal se bloquea, incluso con el PIN correcto", async () => {
    for (const pin of ["0001", "0002", "0003", "0004", "0005"]) {
      expect((await punchAt(pin, C.loc1)).ok).toBe(false);
    }

    const locked = await rejects(() => punchAt("4821", C.loc1));

    expect(locked).toMatch(/demasiados intentos/i);
  });

  it("CONTROL: la OTRA sucursal sigue pudiendo checar con normalidad", async () => {
    const result = await punchAt("4821", C.loc2);

    expect(result.action).toBe("check_in");
  });

  it("al bloquearse una sucursal queda UN rastro en la auditoría", async () => {
    const { rows } = await db.query<{ n: string }>(
      "select count(*)::int as n from public.audit_log where company_id=$1 and action='punch_locked'",
      [C.id],
    );

    expect(Number(rows[0].n)).toBe(1);
  });

  it("cambiar de sucursal para seguir adivinando no sirve: tope de 25 fallos por empresa", async () => {
    // Cada sucursal inventada es una cuenta nueva; el tope de empresa las suma.
    // Ya hay 5 fallos en loc1; faltan 20 para llegar a 25.
    for (let i = 0; i < 20; i++) {
      const fresh = crypto.randomUUID();

      expect((await punchAt("9999", fresh)).ok).toBe(false);
    }

    const locked = await rejects(() => punchAt("4821", C.loc2));

    expect(locked).toMatch(/demasiados intentos/i);
  });

  it("CONTROL: pasada la ventana de 15 minutos todo vuelve a funcionar", async () => {
    await db.query(
      "update public.punch_failed_attempts set attempted_at = now() - interval '16 minutes' where company_id=$1",
      [C.id],
    );

    const result = await punchAt("4821", C.loc1);

    expect(result.action).toBe("check_out");
  });
});
