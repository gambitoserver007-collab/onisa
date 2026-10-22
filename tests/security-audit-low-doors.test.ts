// Auditoría de seguridad 2026-10 (4ª pasada): huecos de severidad baja.
//   - reject_quote respeta el rol (un operador ya no rechaza cotizaciones ajenas).
//   - register_merma rechaza una pérdida negativa también con producto, y la tabla lo exige.
//   - La restricción por sucursal también aplica a apartados, mermas y devoluciones
//     de registros que ya existen en otra sucursal.
//   - El segundo conteo de un testigo solo se permite si el primero no cuadró.
//   - El texto de usuario no mete caracteres de control en el flujo crudo de la
//     impresora de tickets (ESC/POS).
// Cada puerta trae CONTROLES: lo legítimo sigue funcionando.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  asUser,
  createSale,
  createTestDb,
  errMessage,
  makeCompany,
  makeProduct,
  makeUser,
  submitTillCount,
  type TestCompany,
} from "./helpers/db";

vi.mock("qz-tray", () => ({ default: {} }));

async function rejects(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn();

    return null;
  } catch (err) {
    return errMessage(err);
  }
}

describe("reject_quote: solo los roles de cotizaciones", () => {
  let db: PGlite;
  let C: TestCompany;
  let cajero: string;
  let operador: string;
  let product: string;

  const newQuote = async () => {
    const q = await asUser(db, cajero, () =>
      db.query<{ r: { quote_id?: string; id?: string } }>(
        "select create_quote($1::jsonb,null,null,$2) as r",
        [JSON.stringify([{ product_id: product, qty: 1 }]), C.loc1],
      ),
    );

    return (q.rows[0].r.quote_id ?? q.rows[0].r.id) as string;
  };

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa cotizaciones");
    cajero = await makeUser(db, C.id, "user");
    operador = await makeUser(db, C.id, "operador");
    product = await makeProduct(db, C.id, C.loc1, "P", 1, 100, 50);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("un operador NO puede rechazar una cotización y esta sigue pendiente", async () => {
    const id = await newQuote();
    const err = await rejects(() =>
      asUser(db, operador, () => db.query("select reject_quote($1)", [id])),
    );
    const { rows } = await db.query<{ status: string }>(
      "select status from public.quotes where id=$1",
      [id],
    );

    expect(err).toMatch(/No tienes permiso/i);
    expect(rows[0].status).toBe("pendiente");
  });

  it("CONTROL: el cajero y el administrador sí pueden rechazar", async () => {
    const admin = await makeUser(db, C.id, "admin");

    for (const u of [cajero, admin]) {
      const id = await newQuote();

      expect(
        await rejects(() =>
          asUser(db, u, () => db.query("select reject_quote($1)", [id])),
        ),
      ).toBeNull();
    }
  });
});

describe("register_merma: la pérdida nunca es negativa", () => {
  let db: PGlite;
  let C: TestCompany;
  let cajero: string;
  let product: string;

  const merma = (loss: number | null, withProduct = true) =>
    asUser(db, cajero, () =>
      db.query(
        "select register_merma($1,'otro',null,$2,1::numeric,$3,'x') as r",
        [C.loc1, withProduct ? product : null, loss],
      ),
    );

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa mermas");
    cajero = await makeUser(db, C.id, "user");
    product = await makeProduct(db, C.id, C.loc1, "P", 1, 100, 50);
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("rechaza una pérdida negativa CON producto (antes se guardaba)", async () => {
    const err = await rejects(() => merma(-5000));
    const { rows } = await db.query<{ n: string }>(
      "select count(*)::int as n from public.mermas where company_id=$1",
      [C.id],
    );

    expect(err).toMatch(/negativa/i);
    expect(Number(rows[0].n)).toBe(0);
  });

  it("la tabla también lo exige (un insert directo con pérdida negativa falla)", async () => {
    const err = await rejects(() =>
      db.query(
        `insert into public.mermas (company_id, location_id, estimated_loss, reason_category, employee_id, registered_by)
         values ($1,$2,-5,'otro',$3,$3)`,
        [C.id, C.loc1, cajero],
      ),
    );

    expect(err).toMatch(/mermas_estimated_loss_nonneg|check/i);
  });

  it("CONTROL: una merma normal (pérdida calculada o positiva) sigue funcionando", async () => {
    expect(await rejects(() => merma(null))).toBeNull();
    expect(await rejects(() => merma(25))).toBeNull();
    expect(await rejects(() => merma(10, false))).toBeNull();
  });
});

describe("Restricción por sucursal en registros ya existentes", () => {
  let db: PGlite;
  let C: TestCompany;
  let admin: string;
  let cajero: string;
  let fin: string;
  let product: string;
  let apartadoB: string;
  let apartadoA: string;
  let saleB: string;
  let mermaB: string;

  const apartado = async (loc: string) =>
    (
      await asUser(db, admin, () =>
        db.query<{ r: { apartado_id: string } }>(
          "select create_apartado(p_customer_id := $1, p_items := $2::jsonb, p_location_id := $3, p_deposit_amount := 20, p_due_date := null, p_payment_method := 'Efectivo') as r",
          [customerId, JSON.stringify([{ product_id: product, qty: 1 }]), loc],
        ),
      )
    ).rows[0].r.apartado_id;

  let customerId: string;

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa sucursales");
    admin = await makeUser(db, C.id, "admin");
    cajero = await makeUser(db, C.id, "user");
    fin = await makeUser(db, C.id, "finanzas");
    product = await makeProduct(db, C.id, C.loc1, "P", 1, 100, 100);
    await db.query(
      "insert into public.product_locations (company_id, product_id, location_id, stock, is_active) values ($1,$2,$3,50,true)",
      [C.id, product, C.loc2],
    );
    customerId = crypto.randomUUID();
    await db.query(
      "insert into public.customers (id, company_id, name) values ($1,$2,'Cli')",
      [customerId, C.id],
    );
    await db.query(
      "update public.companies set apartado_min_deposit_pct = 0 where id=$1",
      [C.id],
    );
    await asUser(db, admin, () =>
      db.query("select open_cash_session(0,$1)", [C.loc2]),
    );
    apartadoB = await apartado(C.loc2);
    apartadoA = await apartado(C.loc1);
    saleB = (
      await asUser(db, admin, () =>
        createSale(
          db,
          [{ product_id: product, qty: 1, unit_price: 100 }],
          C.loc2,
        ),
      )
    ).sale_id;
    mermaB = (
      await asUser(db, admin, () =>
        db.query<{ r: string }>(
          "select register_merma($1,'otro',null,$2,1::numeric,null,null) as r",
          [C.loc2, product],
        ),
      )
    ).rows[0].r;
    // El cajero y finanzas quedan restringidos a la sucursal 1.
    for (const u of [cajero, fin]) {
      await db.query(
        "insert into public.profile_locations (company_id, profile_id, location_id) values ($1,$2,$3)",
        [C.id, u, C.loc1],
      );
    }
    await asUser(db, cajero, () =>
      db.query("select open_cash_session(0,$1)", [C.loc1]),
    );
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("un cajero restringido NO puede abonar ni completar un apartado de otra sucursal", async () => {
    const pay = await rejects(() =>
      asUser(db, cajero, () =>
        db.query(
          "select add_apartado_payment(p_apartado_id := $1, p_amount := 10, p_payment_method := 'Efectivo')",
          [apartadoB],
        ),
      ),
    );
    const done = await rejects(() =>
      asUser(db, cajero, () =>
        db.query(
          "select complete_apartado(p_apartado_id := $1, p_final_payment_amount := 80, p_payment_method := 'Efectivo')",
          [apartadoB],
        ),
      ),
    );

    expect(pay).toMatch(/acceso a esta sucursal/i);
    expect(done).toMatch(/acceso a esta sucursal/i);
  });

  it("finanzas restringido NO puede cancelar un apartado ni borrar una merma de otra sucursal", async () => {
    const cancel = await rejects(() =>
      asUser(db, fin, () =>
        db.query(
          "select cancel_apartado(p_apartado_id := $1, p_refund_deposit := false)",
          [apartadoB],
        ),
      ),
    );
    const del = await rejects(() =>
      asUser(db, fin, () => db.query("select delete_merma($1)", [mermaB])),
    );

    expect(cancel).toMatch(/acceso a esta sucursal/i);
    expect(del).toMatch(/acceso a esta sucursal/i);
  });

  it("un cajero restringido NO puede devolver una venta de otra sucursal nombrando la suya", async () => {
    const item = (
      await db.query<{ id: string }>(
        "select id from public.sale_items where sale_id=$1 limit 1",
        [saleB],
      )
    ).rows[0].id;
    const err = await rejects(() =>
      asUser(db, cajero, () =>
        db.query("select create_return($1,'x',$2::jsonb,$3,true)", [
          saleB,
          JSON.stringify([{ sale_item_id: item, qty: 1 }]),
          C.loc1,
        ]),
      ),
    );

    expect(err).toMatch(/acceso a esta sucursal/i);
  });

  it("CONTROL: en SU sucursal sí opera (abono) y un admin sin restricción opera en cualquiera", async () => {
    expect(
      await rejects(() =>
        asUser(db, cajero, () =>
          db.query(
            "select add_apartado_payment(p_apartado_id := $1, p_amount := 10, p_payment_method := 'Efectivo')",
            [apartadoA],
          ),
        ),
      ),
    ).toBeNull();
    expect(
      await rejects(() =>
        asUser(db, admin, () =>
          db.query(
            "select add_apartado_payment(p_apartado_id := $1, p_amount := 10, p_payment_method := 'Efectivo')",
            [apartadoB],
          ),
        ),
      ),
    ).toBeNull();
    expect(
      await rejects(() =>
        asUser(db, admin, () => db.query("select delete_merma($1)", [mermaB])),
      ),
    ).toBeNull();
  });
});

describe("Segundo conteo: solo si el primero no cuadró", () => {
  let db: PGlite;
  let C: TestCompany;
  let witness: string;
  let admin: string;

  const openAndCount = async (amount: number) => {
    const o = await makeUser(db, C.id, "user");
    // Una caja física distinta por sesión para no chocar.
    const till = crypto.randomUUID();

    await db.query(
      "insert into public.tills (id, company_id, location_id, name) values ($1,$2,$3,$4)",
      [till, C.id, C.loc1, "Caja " + till.slice(0, 4)],
    );
    const s = (
      await asUser(db, o, () =>
        db.query<{ s: string }>("select open_cash_session(200,$1,$2) as s", [
          C.loc1,
          till,
        ]),
      )
    ).rows[0].s;

    await asUser(db, o, () =>
      submitTillCount(db, s, [{ denomination: 200, quantity: amount }]),
    );

    return s;
  };

  beforeAll(async () => {
    db = await createTestDb();
    C = await makeCompany(db, "Empresa conteos");
    witness = await makeUser(db, C.id, "user");
    admin = await makeUser(db, C.id, "admin");
  }, 120_000);

  afterAll(async () => {
    await db.close();
  });

  it("si el primer conteo CUADRA, un compañero NO puede meter un segundo conteo", async () => {
    const s = await openAndCount(1); // esperado 200, cuenta 200: cuadra

    const err = await rejects(() =>
      asUser(db, witness, () =>
        submitTillCount(db, s, [{ denomination: 100, quantity: 1 }]),
      ),
    );

    expect(err).toMatch(/solo se permite cuando el primero no cuadra/i);
  });

  it("CONTROL: si el primer conteo NO cuadra, el testigo sí puede hacer el segundo", async () => {
    const s = await openAndCount(0); // esperado 200, cuenta 0: no cuadra

    const err = await rejects(() =>
      asUser(db, witness, () =>
        submitTillCount(db, s, [{ denomination: 200, quantity: 1 }]),
      ),
    );

    expect(err).toBeNull();
  });

  it("CONTROL: un administrador puede contar aunque el primero cuadre", async () => {
    const s = await openAndCount(1);

    expect(
      await rejects(() =>
        asUser(db, admin, () =>
          submitTillCount(db, s, [{ denomination: 200, quantity: 1 }]),
        ),
      ),
    ).toBeNull();
  });
});

describe("Impresora de tickets: el texto de usuario no mete comandos", () => {
  const base = {
    widthMm: 58 as const,
    businessName: "Tienda",
    fiscalIdLabel: "RFC",
    fiscalId: "ABC",
    address: "Calle 1",
    phone: "555",
    taxName: "IVA",
    date: "2026-10-22",
    time: "10:00",
    cashierName: "Cajero",
    tillName: "Caja 1",
    folio: "V-1",
    customer: "Cliente",
    documentType: "Ticket",
    paymentMethod: "Efectivo",
    items: [{ qty: 1, name: "Cafe", price: 10 }],
    subtotal: 10,
    tax: 0,
    total: 10,
    loyaltyEarned: 0,
    loyaltyRedeemed: 0,
    footerText: "Gracias",
    formatMoney: (v: number) => `$${v.toFixed(2)}`,
    showFiscalInfo: true,
    showCashierName: true,
    showTill: true,
    showTaxBreakdown: true,
    showLoyaltyPoints: true,
    showPaymentMethod: true,
  };

  it("CONTROL: el ticket normal conserva su texto con acentos y sus comandos propios (negrita, corte)", async () => {
    const { buildReceiptEscPos } = await import("../src/lib/qzPrint");
    const out = buildReceiptEscPos({
      ...base,
      customer: "José Pérez",
      footerText: "¡Gracias por su compra!",
    }).join("");

    expect(out).toContain("José Pérez");
    expect(out).toContain("¡Gracias por su compra!");
    expect(out).toContain("\x1B@"); // INIT
    expect(out).toContain("\x1DV\x00"); // corte
  });

  it("un nombre de cliente, pie, dirección o producto con ESC/GS no llega a la impresora", async () => {
    const { buildReceiptEscPos } = await import("../src/lib/qzPrint");
    const drawer = "\x1Bp\x00\x19\xFA"; // abrir cajón
    const out = buildReceiptEscPos({
      ...base,
      customer: "Ana" + drawer,
      footerText: "Pie" + drawer,
      address: "Calle" + drawer,
      cashierName: "Cajero" + drawer,
      items: [{ qty: 1, name: "Cafe" + drawer, price: 10 }],
    }).join("");

    // La secuencia "ESC p" solo podría venir del texto de usuario: no aparece.
    expect(out).not.toContain("\x1Bp");
    expect(out).toContain("Ana");
    expect(out).toContain("Pie");
  });
});
