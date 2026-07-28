import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listProductsTool from "./tools/list-products";
import listRecentSalesTool from "./tools/list-recent-sales";
import lowStockTool from "./tools/low-stock";

// The OAuth issuer must be the direct Supabase host (not the .lovable.cloud proxy).
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "onisa-mcp",
  title: "Onisa MCP",
  version: "0.1.0",
  instructions:
    "Herramientas de solo lectura para consultar productos, ventas y stock bajo de la empresa del usuario autenticado en Onisa.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [listProductsTool, listRecentSalesTool, lowStockTool],
});
