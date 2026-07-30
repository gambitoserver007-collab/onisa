import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";
import { z } from "zod";

function supabaseForUser(ctx: ToolContext) {
  return createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_PUBLISHABLE_KEY!,
    {
      global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
}

export default defineTool({
  name: "low_stock_products",
  title: "Productos con bajo stock",
  description:
    "Lista productos de la empresa cuyo stock actual está por debajo del umbral indicado (default 5).",
  inputSchema: {
    threshold: z
      .number()
      .min(0)
      .max(1000)
      .optional()
      .describe("Umbral de stock (default 5)."),
    limit: z
      .number()
      .int()
      .min(1)
      .max(200)
      .optional()
      .describe("Máximo de filas (default 50)."),
  },
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: async ({ threshold, limit }, ctx) => {
    if (!ctx.isAuthenticated())
      return {
        content: [{ type: "text", text: "No autenticado" }],
        isError: true,
      };
    const client = supabaseForUser(ctx);
    const { data, error } = await client
      .from("products")
      .select("id,name,sku,stock,price,supplier_id")
      .lt("stock", threshold ?? 5)
      .order("stock", { ascending: true })
      .limit(limit ?? 50);
    if (error)
      return {
        content: [{ type: "text", text: error.message }],
        isError: true,
      };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { products: data ?? [] },
    };
  },
});
