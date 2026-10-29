// Cliente de Supabase simulado, en memoria, para probar las Edge Functions
// (Deno) reales sin red ni Supabase. Solo implementa lo que usan
// team-manage-user y mp-webhook: select/eq/in/maybeSingle/count, update,
// insert, upsert, delete y auth.getUser / auth.admin.*.
export type FakeRow = Record<string, unknown>;

export interface FakeSupabaseCalls {
  updateUserById: { id: string; attrs: unknown }[];
  deleteUser: string[];
  updates: { table: string; row: FakeRow; payload: FakeRow }[];
  upserts: { table: string; row: FakeRow }[];
  inserts: { table: string; row: FakeRow }[];
  createUser: FakeRow[];
  rpc: { name: string; args: unknown }[];
}

/** Hace fallar una escritura (como lo haría un trigger de la base). */
export interface FakeWriteFailure {
  table: string;
  op: "update" | "insert" | "upsert" | "delete";
  message: string;
}

export interface FakeSupabase {
  tables: Record<string, FakeRow[]>;
  tokens: Map<string, string>;
  calls: FakeSupabaseCalls;
  failWrites: FakeWriteFailure[];
  client: unknown;
  reset: () => void;
}

interface QueryState {
  filters: [string, unknown][];
  neq: [string, unknown][];
  gte: [string, unknown][];
  nulls: string[];
  op: "select" | "update" | "insert" | "upsert" | "delete";
  payload: FakeRow | FakeRow[] | null;
  head: boolean;
  count: boolean;
  onConflict: string[];
}

export function createFakeSupabase(): FakeSupabase {
  const fake: FakeSupabase = {
    tables: {},
    tokens: new Map(),
    calls: {
      updateUserById: [],
      deleteUser: [],
      updates: [],
      upserts: [],
      inserts: [],
      createUser: [],
      rpc: [],
    },
    failWrites: [],
    client: null,
    reset() {
      fake.tables = {};
      fake.tokens.clear();
      fake.calls.updateUserById.length = 0;
      fake.calls.deleteUser.length = 0;
      fake.calls.updates.length = 0;
      fake.calls.upserts.length = 0;
      fake.calls.inserts.length = 0;
      fake.calls.createUser.length = 0;
      fake.calls.rpc.length = 0;
      fake.failWrites.length = 0;
    },
  };

  const from = (table: string) => {
    const state: QueryState = {
      filters: [],
      neq: [],
      gte: [],
      nulls: [],
      op: "select",
      payload: null,
      head: false,
      count: false,
      onConflict: [],
    };
    const rows = () => (fake.tables[table] ??= []);
    let lastInserted: FakeRow | null = null;
    const matching = () =>
      rows().filter(
        (r) =>
          state.filters.every(([c, v]) => r[c] === v) &&
          state.neq.every(([c, v]) => r[c] !== v) &&
          state.gte.every(([c, v]) => (r[c] as string) >= (v as string)) &&
          state.nulls.every((c) => (r[c] ?? null) === null),
      );

    const exec = async () => {
      if (state.op === "select") {
        const m = matching();

        return {
          data: state.head ? null : m,
          count: state.count ? m.length : null,
          error: null,
        };
      }
      const failure = fake.failWrites.find(
        (f) => f.table === table && f.op === state.op,
      );

      if (failure) {
        return { data: null, count: null, error: { message: failure.message } };
      }
      if (state.op === "update") {
        for (const r of matching()) {
          fake.calls.updates.push({
            table,
            row: r,
            payload: state.payload as FakeRow,
          });
          Object.assign(r, state.payload);
        }
      }
      if (state.op === "insert") {
        const payloads = Array.isArray(state.payload)
          ? state.payload
          : [state.payload as FakeRow];

        for (const p of payloads) {
          // Valores por defecto de la base (columnas con default) que las pruebas necesitan.
          const dbDefaults: FakeRow =
            table === "quote_requests"
              ? { status: "nueva", created_at: new Date().toISOString() }
              : {};

          lastInserted = {
            id: `fake-${table}-${rows().length + 1}`,
            ...dbDefaults,
            ...p,
          };
          rows().push(lastInserted);
          fake.calls.inserts.push({ table, row: p });
        }
      }
      if (state.op === "upsert") {
        const p = state.payload as FakeRow;
        const existing = rows().find((r) =>
          state.onConflict.every((c) => r[c] === p[c]),
        );

        if (existing) Object.assign(existing, p);
        else rows().push({ ...p });
        fake.calls.upserts.push({ table, row: p });
      }
      if (state.op === "delete") {
        fake.tables[table] = rows().filter((r) => !matching().includes(r));
      }

      return { data: null, count: null, error: null };
    };

    const b = {
      select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
        state.head = Boolean(opts?.head);
        state.count = opts?.count === "exact";

        return b;
      },
      eq: (c: string, v: unknown) => {
        state.filters.push([c, v]);

        return b;
      },
      neq: (c: string, v: unknown) => {
        state.neq.push([c, v]);

        return b;
      },
      gte: (c: string, v: unknown) => {
        state.gte.push([c, v]);

        return b;
      },
      is: (c: string, v: unknown) => {
        if (v === null) state.nulls.push(c);
        else state.filters.push([c, v]);

        return b;
      },
      in: () => b,
      maybeSingle: async () => ({ data: matching()[0] ?? null, error: null }),
      single: async () => {
        if (state.op === "select") {
          return { data: matching()[0] ?? null, error: null };
        }
        const res = await exec();

        return {
          data: res.error ? null : (lastInserted ?? state.payload),
          error: res.error,
        };
      },
      update: (p: FakeRow) => {
        state.op = "update";
        state.payload = p;

        return b;
      },
      insert: (p: FakeRow | FakeRow[]) => {
        state.op = "insert";
        state.payload = p;

        return b;
      },
      upsert: (p: FakeRow, opts?: { onConflict?: string }) => {
        state.op = "upsert";
        state.payload = p;
        state.onConflict = (opts?.onConflict ?? "id").split(",");

        return b;
      },
      delete: () => {
        state.op = "delete";

        return b;
      },
      then: (
        resolve: (v: Awaited<ReturnType<typeof exec>>) => unknown,
        reject: (e: unknown) => unknown,
      ) => exec().then(resolve, reject),
    };

    return b;
  };

  fake.client = {
    from,
    rpc: async (name: string, args: unknown) => {
      fake.calls.rpc.push({ name, args });

      return { data: null, error: null };
    },
    auth: {
      getUser: async (token: string) => {
        const id = fake.tokens.get(token);

        return id
          ? { data: { user: { id } }, error: null }
          : { data: { user: null }, error: { message: "bad token" } };
      },
      admin: {
        updateUserById: async (id: string, attrs: unknown) => {
          fake.calls.updateUserById.push({ id, attrs });

          return { error: null };
        },
        createUser: async (attrs: FakeRow) => {
          fake.calls.createUser.push(attrs);

          return {
            data: { user: { id: `new-user-${fake.calls.createUser.length}` } },
            error: null,
          };
        },
        deleteUser: async (id: string) => {
          fake.calls.deleteUser.push(id);

          return { error: null };
        },
      },
    },
  };

  return fake;
}
