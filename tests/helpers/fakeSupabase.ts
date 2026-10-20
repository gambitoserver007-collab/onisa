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
}

export interface FakeSupabase {
  tables: Record<string, FakeRow[]>;
  tokens: Map<string, string>;
  calls: FakeSupabaseCalls;
  client: unknown;
  reset: () => void;
}

interface QueryState {
  filters: [string, unknown][];
  neq: [string, unknown][];
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
    },
    client: null,
    reset() {
      fake.tables = {};
      fake.tokens.clear();
      fake.calls.updateUserById.length = 0;
      fake.calls.deleteUser.length = 0;
      fake.calls.updates.length = 0;
      fake.calls.upserts.length = 0;
      fake.calls.inserts.length = 0;
    },
  };

  const from = (table: string) => {
    const state: QueryState = {
      filters: [],
      neq: [],
      op: "select",
      payload: null,
      head: false,
      count: false,
      onConflict: [],
    };
    const rows = () => (fake.tables[table] ??= []);
    const matching = () =>
      rows().filter(
        (r) =>
          state.filters.every(([c, v]) => r[c] === v) &&
          state.neq.every(([c, v]) => r[c] !== v),
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
          rows().push({ ...p });
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
      in: () => b,
      maybeSingle: async () => ({ data: matching()[0] ?? null, error: null }),
      single: async () => ({ data: matching()[0] ?? null, error: null }),
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
        deleteUser: async (id: string) => {
          fake.calls.deleteUser.push(id);

          return { error: null };
        },
      },
    },
  };

  return fake;
}
