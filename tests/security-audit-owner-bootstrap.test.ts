// Auditoría de seguridad 2026-10 (6ª pasada): el Super Admin solo puede ser una
// cuenta que el OPERADOR creó o marcó. Si el registro público seguía abierto,
// alguien pudo registrarse con el correo del dueño antes del bootstrap y
// quedarse con su propia contraseña; el script solo la confirmaba y
// bootstrap_owner_profile la volvía Super Admin.
// La marca vive en raw_app_meta_data (solo la escribe la service_role); la que
// escribe un registro público (raw_user_meta_data) NO cuenta.
// Cada puerta trae CONTROLES: el flujo legítimo sigue funcionando.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestDb, errMessage } from "./helpers/db";
import {
  OWNER_MARK,
  decideOwnerUserAction,
  hasOwnerMark,
} from "../scripts/owner-bootstrap-policy.mjs";

async function rejects(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();

    return null;
  } catch (err) {
    return errMessage(err);
  }
}

describe("bootstrap_owner_profile exige una cuenta creada o marcada por el operador", () => {
  let db: PGlite;

  const authUser = async (
    email: string,
    userMeta: Record<string, unknown> = {},
    appMeta: Record<string, unknown> = {},
  ) => {
    const id = crypto.randomUUID();

    await db.query(
      "insert into auth.users (id, email, raw_user_meta_data, raw_app_meta_data) values ($1,$2,$3,$4)",
      [id, email, JSON.stringify(userMeta), JSON.stringify(appMeta)],
    );

    return id;
  };

  const isPlatformAdmin = async (id: string) =>
    (
      await db.query<{ p: boolean }>(
        "select coalesce(bool_or(is_platform_admin), false) as p from public.profiles where id=$1",
        [id],
      )
    ).rows[0].p;

  beforeAll(async () => {
    db = await createTestDb();
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("una cuenta registrada por otra persona (sin marca) NO se promueve a Super Admin", async () => {
    const squatter = await authUser("dueno@tienda.test", {
      full_name: "Intruso",
    });
    const err = await rejects(() =>
      db.query("select public.bootstrap_owner_profile('dueno@tienda.test')"),
    );

    expect(err).toMatch(/no fue creada ni marcada por el operador/i);
    expect(await isPlatformAdmin(squatter)).toBe(false);
  });

  it("la marca puesta en user_metadata (la que escribe un registro público) NO sirve", async () => {
    const squatter = await authUser("otro@tienda.test", {
      [OWNER_MARK]: true,
    });
    const err = await rejects(() =>
      db.query("select public.bootstrap_owner_profile('otro@tienda.test')"),
    );

    expect(err).toMatch(/no fue creada ni marcada/i);
    expect(await isPlatformAdmin(squatter)).toBe(false);
  });

  it("CONTROL: una cuenta con la marca del operador (app_metadata) sí se vuelve Super Admin", async () => {
    const owner = await authUser(
      "real@tienda.test",
      {},
      { [OWNER_MARK]: true },
    );

    expect(
      await rejects(() =>
        db.query("select public.bootstrap_owner_profile('real@tienda.test')"),
      ),
    ).toBeNull();
    expect(await isPlatformAdmin(owner)).toBe(true);
  });

  it("CONTROL: un correo que no existe sigue dando el aviso de crear la cuenta primero", async () => {
    const err = await rejects(() =>
      db.query("select public.bootstrap_owner_profile('nadie@tienda.test')"),
    );

    expect(err).toMatch(/Create Auth user/i);
  });
});

describe("create-owner-user.mjs: qué hace con una cuenta que ya existía", () => {
  const marked = { app_metadata: { [OWNER_MARK]: true } };
  const unmarked = { user_metadata: { company_name: "x" } };

  it("sin cuenta previa la crea", () => {
    expect(
      decideOwnerUserAction({
        existingUser: null,
        adoptExisting: false,
        resetPassword: false,
      }).action,
    ).toBe("create");
  });

  it("CONTROL: una cuenta que el propio script marcó se puede volver a correr", () => {
    expect(hasOwnerMark(marked)).toBe(true);
    expect(
      decideOwnerUserAction({
        existingUser: marked,
        adoptExisting: false,
        resetPassword: false,
      }).action,
    ).toBe("update");
  });

  it("una cuenta existente SIN marca no se adopta en silencio (se detiene y explica)", () => {
    const d = decideOwnerUserAction({
      existingUser: unmarked,
      adoptExisting: false,
      resetPassword: false,
    });

    expect(d.action).toBe("abort");
    expect(d.reason).toMatch(/ADOPT_EXISTING_OWNER/);
    expect(d.reason).toMatch(/bórrala|borrala/i);
  });

  it("adoptarla exige ADOPT_EXISTING_OWNER y también rotar la contraseña", () => {
    expect(
      decideOwnerUserAction({
        existingUser: unmarked,
        adoptExisting: true,
        resetPassword: false,
      }).action,
    ).toBe("abort");
    expect(
      decideOwnerUserAction({
        existingUser: unmarked,
        adoptExisting: true,
        resetPassword: true,
      }).action,
    ).toBe("adopt");
  });

  it("la marca puesta en user_metadata no cuenta como marca del operador", () => {
    expect(hasOwnerMark({ user_metadata: { [OWNER_MARK]: true } })).toBe(false);
    expect(hasOwnerMark({ app_metadata: { [OWNER_MARK]: "true" } })).toBe(
      false,
    );
  });
});
