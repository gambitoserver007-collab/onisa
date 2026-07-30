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
  name: "list_recent_sales",
  title: "Ventas recientes",
  description: "Devuelve las ventas más recientes de la empresa del usuario.",
  inputSchema: {
    limit: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("Máximo de ventas (default 20)."),
  },
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: async ({ limit }, ctx) => {
    if (!ctx.isAuthenticated())
      return {
        content: [{ type: "text", text: "No autenticado" }],
        isError: true,
      };
    const client = supabaseForUser(ctx);
    const { data, error } = await client
      .from("sales")
      .select("id,created_at,total,payment_method,customer_id,status")
      .order("created_at", { ascending: false })
      .limit(limit ?? 20);
    if (error)
      return {
        content: [{ type: "text", text: error.message }],
        isError: true,
      };
    return {
      content: [{ type: "text", text: JSON.stringify(data ?? []) }],
      structuredContent: { sales: data ?? [] },
    };
  },
});
