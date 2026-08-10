import {
  categories as demoCategories,
  customers as demoCustomers,
  products as demoProducts,
  sales as demoSales,
  suppliers as demoSuppliers,
} from "@/data/demo";
import { getMarketByCountryCode } from "@/data/markets";
import { supabase } from "@/integrations/supabase/client";
import type { Json, Tables } from "@/integrations/supabase/types";

type CategoryRow = Tables<"categories">;
type CompanyRow = Tables<"companies">;
type CustomerRow = Tables<"customers">;
type ProductRow = Tables<"products">;
type SaleItemRow = Tables<"sale_items">;
type SaleRow = Tables<"sales">;
type SupplierRow = Tables<"suppliers">;
import type { BusinessSettings } from "@/lib/businessSettings";
import type {
  CartItem,
  Category,
  Customer,
  DemoSession,
  DocumentType,
  Product,
  ProductVariant,
  Sale,
  Supplier,
} from "@/types";

export interface CompanyCatalog {
  categories: Category[];
  products: Product[];
  customers: Customer[];
  suppliers: Supplier[];
}

export interface DashboardData {
  totalToday: number;
  salesTodayCount: number;
  totalMonth: number;
  productsCount: number;
  customersCount: number;
  lowStockCount: number;
  lowStockProducts: { id: string; name: string; stock: number; unit: string }[];
  recentSales: {
    id: string;
    date: string;
    customer: string;
    method: string;
    total: number;
  }[];
  salesLast7Days: { day: string; total: number }[];
  salesByCategory: { name: string; value: number }[];
  salesByMethod: { name: string; value: number }[];
}

/** Stock de un producto en un punto de venta concreto. */
export interface ProductLocationStock {
  locationId: string;
  stock: number;
}

export interface CreateProductInput {
  name: string;
  barcode?: string;
  /** SKU / código interno, distinto del código de barras. */
  sku?: string;
  categoryId?: string;
  /** Proveedor habitual del producto (a quién se le compra). */
  supplierId?: string | null;
  cost: number;
  price: number;
  stock: number;
  unit: string;
  /** Whether the entered price already includes tax (IVA). */
  priceIncludesTax?: boolean;
  /** Optional product photo (data URL or image URL). Pass null to clear. */
  imageUrl?: string | null;
  /**
   * Puntos de venta donde está el producto + su stock en cada uno. Si se pasa,
   * `stock` (total) se calcula como la suma y se sincroniza product_locations.
   */
  locations?: ProductLocationStock[];
}

export interface CreateCustomerInput {
  name: string;
  documentNumber?: string;
  phone?: string;
  email?: string;
  address?: string;
}

export interface CreateSupplierInput {
  name: string;
  documentNumber?: string;
  phone?: string;
  email?: string;
}

export interface UpdateCompanySettingsInput {
  businessName: string;
  fiscalId?: string;
  address?: string;
  phone?: string;
  /** Pass to set/clear the store logo; omit to leave it unchanged. */
  logoUrl?: string | null;
  /** Rubro/perfil de la empresa; omitir para no cambiarlo. */
  businessType?: string;
  /** % de comisión de pago con tarjeta (fracción, ej. 0.03 = 3%). */
  cardCommissionRate?: number;
  /** Si el programa de puntos de lealtad está activo. */
  loyaltyEnabled?: boolean;
  /** Cuánto vale 1 punto en la moneda de la empresa (ej. 1 = $1). */
  loyaltyPointValue?: number;
  /** Cuánto gasto equivale a 1 punto ganado. */
  loyaltyEarnRate?: number;
}

// Single-row platform branding (SaaS name + logo). Seeded by the installer.
const PLATFORM_SETTINGS_ID = "00000000-0000-4000-8000-0000000000a1";

export interface PlatformBranding {
  name: string;
  logoUrl: string | null;
}

export async function fetchPlatformBranding(): Promise<PlatformBranding> {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const { data, error } = await (supabase as any)
      .from("platform_settings")
      .select("brand_name, logo_url")
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return {
      name: (data?.brand_name as string) || "Onisa",
      logoUrl: (data?.logo_url as string | null) ?? null,
    };
  } catch {
    return { name: "Onisa", logoUrl: null };
  }
}

export async function updatePlatformLogo(logoUrl: string | null) {
  const { error } = await (supabase as any)
    .from("platform_settings")
    .update({ logo_url: logoUrl, updated_at: new Date().toISOString() })
    .eq("id", PLATFORM_SETTINGS_ID);
  if (error) throw error;
}

export async function updatePlatformBrandName(name: string) {
  const cleanName = name.trim();
  if (!cleanName) throw new Error("Ingresa el nombre de la plataforma.");
  const { error } = await (supabase as any)
    .from("platform_settings")
    .update({ brand_name: cleanName, updated_at: new Date().toISOString() })
    .eq("id", PLATFORM_SETTINGS_ID);
  if (error) throw error;
}

export const demoCatalog: CompanyCatalog = {
  categories: demoCategories,
  products: demoProducts,
  customers: demoCustomers,
  suppliers: demoSuppliers,
};

function toNumber(value: unknown, fallback = 0) {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toSaleType(value: string): Sale["type"] {
  return value?.trim() || "Ticket";
}

function toPaymentMethod(value: string): Sale["method"] {
  return value?.trim() || "Efectivo";
}

// Fecha LOCAL en formato YYYY-MM-DD (no UTC). Antes se usaba toISOString() (UTC),
// por lo que las ventas de la tarde/noche en zonas con offset negativo (ej. Ecuador
// UTC-5) caían al día siguiente en reportes y dashboard. Ahora se agrupan por el día
// local del negocio.
function localDateKey(value: string | number | Date) {
  const d = value instanceof Date ? value : new Date(value);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function normalizeDate(value: string) {
  return localDateKey(value);
}

function mapCategory(
  row: Pick<CategoryRow, "id" | "name" | "active">,
): Category {
  return {
    id: row.id,
    name: row.name,
    active: row.active,
  };
}

function mapProduct(
  row: ProductRow,
  categoryById: Map<string, string>,
): Product {
  return {
    id: row.id,
    categoryId: row.category_id ?? undefined,
    supplierId: (row as { supplier_id?: string | null }).supplier_id ?? null,
    name: row.name,
    category: row.category_id
      ? (categoryById.get(row.category_id) ?? "Sin categoría")
      : "Sin categoría",
    barcode: row.barcode ?? "",
    sku: (row as { sku?: string | null }).sku ?? undefined,
    cost: toNumber(row.cost),
    price: toNumber(row.price),
    stock: toNumber(row.stock),
    unit: row.unit,
    image: (row as { image_url?: string | null }).image_url ?? undefined,
    priceIncludesTax:
      (row as { price_includes_tax?: boolean | null }).price_includes_tax ??
      true,
    hasVariants:
      (row as { has_variants?: boolean | null }).has_variants ?? false,
    variantAttributes:
      (row as { variant_attributes?: string[] | null }).variant_attributes ??
      undefined,
  };
}

function mapCustomer(row: CustomerRow): Customer {
  return {
    id: row.id,
    name: row.name,
    doc: row.document_number ?? "-",
    phone: row.phone ?? "-",
    loyaltyPoints: toNumber(
      (row as { loyalty_points?: number }).loyalty_points,
      0,
    ),
  };
}

function mapSupplier(row: SupplierRow): Supplier {
  return {
    id: row.id,
    name: row.name,
    ruc: row.document_number ?? "-",
    phone: row.phone ?? "-",
  };
}

function mapSale(row: SaleRow, items: SaleItemRow[]): Sale {
  return {
    id: row.sale_number || row.id,
    databaseId: row.id,
    date: normalizeDate(row.sale_date),
    createdAt: row.created_at ?? row.sale_date,
    type: toSaleType(row.document_type),
    method: toPaymentMethod(row.payment_method),
    customer: row.customer_name,
    customerId: row.customer_id ?? null,
    createdBy: (row as { created_by?: string | null }).created_by ?? null,
    items: items.map((item) => ({
      productId: item.product_id ?? item.id,
      name: item.product_name,
      qty: toNumber(item.qty, 1),
      price: toNumber(item.unit_price),
      variantLabel:
        (item as { variant_label?: string | null }).variant_label ?? undefined,
    })),
    subtotal: toNumber(row.subtotal),
    igv: toNumber(row.tax),
    total: toNumber(row.total),
  };
}

function groupSaleItemsBySale(items: SaleItemRow[]) {
  return items.reduce((map, item) => {
    const saleItems = map.get(item.sale_id) ?? [];
    saleItems.push(item);
    map.set(item.sale_id, saleItems);
    return map;
  }, new Map<string, SaleItemRow[]>());
}

// Friendly, schema-free error messages. We never surface raw PostgREST / Postgres
// payloads to end users — they can leak table/column names. Validation errors
// thrown by our own code (lowercase first letter, no codes) pass through.
const SAFE_USER_MESSAGE_RE = /^[A-ZÁÉÍÓÚÑa-záéíóúñ]/; // starts with a letter, looks like prose

function isSafeUserMessage(message: string): boolean {
  if (!message) return false;
  if (message.length > 240) return false;
  // Hide anything that looks like a Postgres/PostgREST error.
  if (
    /\b(relation|column|schema|constraint|operator|policy|rls)\b/i.test(message)
  ) {
    return false;
  }
  // Raw Postgres "function name(args) ..." leaks (e.g. "function does not exist").
  // Narrower than banning the word "function" outright, porque el propio código
  // usa "Edge Function" en mensajes legítimos (ver createCompany) y ese texto no
  // debe tratarse como si fuera un error crudo de Postgres.
  if (/\bfunction\s+\S+\([^)]*\)/i.test(message)) return false;
  if (/(SQLSTATE|pg_|duplicate key value|violates)/i.test(message))
    return false;
  return SAFE_USER_MESSAGE_RE.test(message);
}

export function getErrorMessage(
  error: unknown,
  fallback = "No se pudo completar la operación.",
) {
  let raw = "";
  if (error instanceof Error) raw = error.message;
  else if (typeof error === "object" && error && "message" in error) {
    raw = String((error as { message: unknown }).message ?? "");
  } else if (typeof error === "string") raw = error;

  // Log full error to console for the dev / browser debugger.
  if (typeof console !== "undefined") console.warn("[App]", error);

  // Map a few common Postgres signals to friendly Spanish.
  if (/permission denied|row-level security|policy/i.test(raw)) {
    return "No tienes permisos para realizar esta acción.";
  }
  if (/duplicate key value|unique constraint/i.test(raw)) {
    return "Ya existe un registro con esos datos.";
  }
  if (/foreign key/i.test(raw)) {
    return "No se puede completar: hay datos relacionados que dependen de este registro.";
  }
  if (/network|fetch failed|failed to fetch/i.test(raw)) {
    return "Sin conexión con el servidor. Intenta de nuevo.";
  }
  return isSafeUserMessage(raw) ? raw : fallback;
}

function requireCompanyId(session: DemoSession) {
  if (!session.companyId)
    throw new Error("La sesión no tiene empresa asociada.");
  return session.companyId;
}

export async function fetchCompanyCatalog(
  companyId?: string,
): Promise<CompanyCatalog> {
  const categoriesQuery = supabase
    .from("categories")
    .select("id, name, active")
    .is("deleted_at", null);
  const productsQuery = supabase
    .from("products")
    .select(
      "id, company_id, category_id, supplier_id, name, barcode, sku, cost, price, stock, unit, image_url, price_includes_tax, has_variants, variant_attributes, active, is_demo_data, created_at, updated_at, deleted_at",
    )
    .is("deleted_at", null)
    .eq("active", true);
  const customersQuery = supabase
    .from("customers")
    .select(
      "id, company_id, name, document_number, phone, email, loyalty_points, is_demo_data, created_at, updated_at, deleted_at",
    )
    .is("deleted_at", null);
  const suppliersQuery = supabase
    .from("suppliers")
    .select(
      "id, company_id, name, document_number, phone, email, is_demo_data, created_at, updated_at, deleted_at",
    )
    .is("deleted_at", null);

  const [categoriesResult, productsResult, customersResult, suppliersResult] =
    await Promise.all([
      (companyId
        ? categoriesQuery.eq("company_id", companyId)
        : categoriesQuery
      ).order("name"),
      (companyId
        ? productsQuery.eq("company_id", companyId)
        : productsQuery
      ).order("name"),
      (companyId
        ? customersQuery.eq("company_id", companyId)
        : customersQuery
      ).order("name"),
      (companyId
        ? suppliersQuery.eq("company_id", companyId)
        : suppliersQuery
      ).order("name"),
    ]);

  const error =
    categoriesResult.error ||
    productsResult.error ||
    customersResult.error ||
    suppliersResult.error;
  if (error) throw error;

  const categories = (categoriesResult.data ?? []).map(mapCategory);
  const categoryById = new Map(
    categories.map((category) => [category.id, category.name]),
  );

  return {
    categories,
    products: ((productsResult.data ?? []) as unknown as ProductRow[]).map(
      (row) => mapProduct(row, categoryById),
    ),
    customers: ((customersResult.data ?? []) as CustomerRow[]).map(mapCustomer),
    suppliers: ((suppliersResult.data ?? []) as SupplierRow[]).map(mapSupplier),
  };
}

/** Cuenta productos y clientes activos sin traer las filas completas -- a
 * diferencia de `fetchCompanyCatalog`, esto no se trunca en silencio por el
 * límite por defecto de PostgREST (1000 filas) en catálogos grandes. */
export async function fetchCompanyCounts(
  companyId?: string,
): Promise<{ productsCount: number; customersCount: number }> {
  const productsQuery = supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .eq("active", true);
  const customersQuery = supabase
    .from("customers")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null);

  const [{ count: productsCount }, { count: customersCount }] =
    await Promise.all([
      companyId ? productsQuery.eq("company_id", companyId) : productsQuery,
      companyId ? customersQuery.eq("company_id", companyId) : customersQuery,
    ]);

  return {
    productsCount: productsCount ?? 0,
    customersCount: customersCount ?? 0,
  };
}

const LOW_STOCK_THRESHOLD = 10;

export interface LowStockProduct {
  id: string;
  name: string;
  stock: number;
  unit: string;
}

export interface LowStockSummary {
  count: number;
  items: LowStockProduct[];
}

/** Resumen de bajo stock para el dashboard: total de productos con
 * 0 < stock < 10 y los de menor stock (hasta `limit`), calculado por el
 * servidor -- evita traer el catálogo completo solo para filtrarlo. */
export async function fetchLowStockSummary(
  companyId?: string,
  locationId?: string,
  limit = 4,
): Promise<LowStockSummary> {
  if (locationId) {
    const countQuery = supabase
      .from("product_locations")
      .select("product_id", { count: "exact", head: true })
      .eq("location_id", locationId)
      .eq("is_active", true)
      .gt("stock", 0)
      .lt("stock", LOW_STOCK_THRESHOLD);
    const rowsQuery = supabase
      .from("product_locations")
      .select("product_id, stock")
      .eq("location_id", locationId)
      .eq("is_active", true)
      .gt("stock", 0)
      .lt("stock", LOW_STOCK_THRESHOLD)
      .order("stock", { ascending: true })
      .limit(limit);

    const [{ count }, { data: rows, error: rowsError }] = await Promise.all([
      countQuery,
      rowsQuery,
    ]);
    if (rowsError) throw rowsError;

    const productIds = (rows ?? []).map((row) => row.product_id);
    if (!productIds.length) return { count: count ?? 0, items: [] };

    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id, name, unit")
      .in("id", productIds);
    if (productsError) throw productsError;

    const productById = new Map((products ?? []).map((p) => [p.id, p]));
    const items = (rows ?? []).flatMap((row) => {
      const product = productById.get(row.product_id);
      if (!product) return [];
      return [
        {
          id: product.id,
          name: product.name,
          stock: toNumber(row.stock),
          unit: product.unit,
        },
      ];
    });
    return { count: count ?? 0, items };
  }

  const countQuery = supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .eq("active", true)
    .gt("stock", 0)
    .lt("stock", LOW_STOCK_THRESHOLD);
  const rowsQuery = supabase
    .from("products")
    .select("id, name, stock, unit")
    .is("deleted_at", null)
    .eq("active", true)
    .gt("stock", 0)
    .lt("stock", LOW_STOCK_THRESHOLD)
    .order("stock", { ascending: true })
    .limit(limit);

  const [{ count }, { data: rows, error: rowsError }] = await Promise.all([
    companyId ? countQuery.eq("company_id", companyId) : countQuery,
    companyId ? rowsQuery.eq("company_id", companyId) : rowsQuery,
  ]);
  if (rowsError) throw rowsError;

  return {
    count: count ?? 0,
    items: (rows ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      stock: toNumber(row.stock),
      unit: row.unit,
    })),
  };
}

export async function fetchSales(
  companyId?: string,
  locationId?: string,
): Promise<Sale[]> {
  let salesQuery = supabase
    .from("sales")
    .select(
      "id, company_id, customer_id, sale_number, document_type, payment_method, customer_name, sale_date, subtotal, tax, total, status, created_by, is_demo_data, created_at, updated_at, deleted_at",
    )
    .is("deleted_at", null);
  if (companyId) salesQuery = salesQuery.eq("company_id", companyId);
  if (locationId) salesQuery = salesQuery.eq("location_id", locationId);
  const { data: salesRows, error: salesError } = await salesQuery.order(
    "sale_date",
    {
      ascending: false,
    },
  );

  if (salesError) throw salesError;
  if (!salesRows?.length) return [];

  const saleIds = salesRows.map((sale) => sale.id);
  const { data: itemRows, error: itemsError } = await supabase
    .from("sale_items")
    .select(
      "id, company_id, sale_id, product_id, product_name, variant_label, qty, unit_price, total, cost, is_demo_data, created_at",
    )
    .in("sale_id", saleIds);

  if (itemsError) throw itemsError;

  const itemsBySale = groupSaleItemsBySale((itemRows ?? []) as SaleItemRow[]);
  return (salesRows as SaleRow[]).map((sale) =>
    mapSale(sale, itemsBySale.get(sale.id) ?? []),
  );
}

/**
 * Ventas recientes (limitadas) para widgets — evita traer todas las ventas.
 * Solo cabecera; no carga sale_items.
 */
export async function fetchRecentSales(
  companyId?: string,
  locationId?: string,
  limit = 4,
): Promise<
  {
    id: string;
    date: string;
    customer: string;
    method: string;
    total: number;
  }[]
> {
  let q = supabase
    .from("sales")
    .select("id, customer_name, payment_method, sale_date, total")
    .is("deleted_at", null);
  if (companyId) q = q.eq("company_id", companyId);
  if (locationId) q = q.eq("location_id", locationId);
  const { data, error } = await q
    .order("sale_date", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id as string,
    date: localDateKey(new Date(row.sale_date as string)),
    customer: (row.customer_name as string) ?? "Público general",
    method: (row.payment_method as string) ?? "Efectivo",
    total: Number(row.total) || 0,
  }));
}

/**
 * Agregados calculados en Postgres (RPCs) — sin el tope de 1000 filas de la Data API.
 * `tz` debe ser la zona horaria del negocio (ej. 'America/Lima').
 */
export interface SalesAggregates {
  totalToday: number;
  salesTodayCount: number;
  totalMonth: number;
  salesLast7Days: { day: string; total: number }[];
  salesByCategory: { name: string; value: number }[];
  salesByMethod: { name: string; value: number }[];
}

export async function fetchSalesAggregates(
  tz: string,
  locationId?: string,
  from?: string,
  to?: string,
): Promise<SalesAggregates> {
  const locParam = (locationId ?? null) as unknown as string;
  const tzParam = tz || "UTC";
  const fromParam = (from ?? null) as unknown as string;
  const toParam = (to ?? null) as unknown as string;

  const [totalsRes, byDayRes, byCatRes, byMethodRes] = await Promise.all([
    supabase.rpc("dashboard_sales_totals", {
      p_location_id: locParam,
      p_tz: tzParam,
    }),
    supabase.rpc("sales_by_day", {
      p_location_id: locParam,
      p_tz: tzParam,
      p_days: 7,
    }),
    supabase.rpc("sales_by_category", {
      p_location_id: locParam,
      p_tz: tzParam,
      p_from: fromParam,
      p_to: toParam,
    }),
    supabase.rpc("sales_by_payment_method", {
      p_location_id: locParam,
      p_tz: tzParam,
      p_from: fromParam,
      p_to: toParam,
    }),
  ]);

  if (totalsRes.error) throw totalsRes.error;
  if (byDayRes.error) throw byDayRes.error;
  if (byCatRes.error) throw byCatRes.error;
  if (byMethodRes.error) throw byMethodRes.error;

  const totals = (totalsRes.data?.[0] ?? {
    total_today: 0,
    count_today: 0,
    total_month: 0,
    count_month: 0,
  }) as {
    total_today: number | string;
    count_today: number | string;
    total_month: number | string;
    count_month: number | string;
  };

  return {
    totalToday: Number(totals.total_today) || 0,
    salesTodayCount: Number(totals.count_today) || 0,
    totalMonth: Number(totals.total_month) || 0,
    salesLast7Days: (
      (byDayRes.data ?? []) as { day: string; total: number | string }[]
    ).map((row) => ({
      day: new Date(`${row.day}T00:00:00`).toLocaleDateString("es", {
        weekday: "short",
        day: "2-digit",
      }),
      total: Number(row.total) || 0,
    })),
    salesByCategory: (
      (byCatRes.data ?? []) as { category: string; total: number | string }[]
    ).map((row) => ({
      name: row.category ?? "Sin categoría",
      value: Number(row.total) || 0,
    })),
    salesByMethod: (
      (byMethodRes.data ?? []) as { method: string; total: number | string }[]
    ).map((row) => ({
      name: row.method ?? "Otro",
      value: Number(row.total) || 0,
    })),
  };
}

export async function fetchSaleById(
  publicId: string,
  companyId?: string,
): Promise<Sale | null> {
  const sales = await fetchSales(companyId);
  return (
    sales.find(
      (sale) => sale.id === publicId || sale.databaseId === publicId,
    ) ?? null
  );
}

export async function createSaleFromCart({
  customerId,
  documentType,
  paymentMethod,
  items,
  companyId,
  locationId,
  clientRequestId,
  pointsRedeemed,
}: {
  customerId: string | null;
  documentType: Sale["type"];
  paymentMethod: Sale["method"];
  items: CartItem[];
  companyId?: string;
  locationId?: string | null;
  /**
   * Clave estable por intento de cobro (mismo carrito). Si el cobro se
   * reintenta tras perder la respuesta por un corte de red, reenviar la
   * MISMA clave evita que create_sale duplique la venta y descuente stock
   * dos veces.
   */
  clientRequestId?: string | null;
  /** Puntos de lealtad que el cajero pide canjear; el servidor los revalida
   * y los topa al saldo real del cliente y al total de la venta. */
  pointsRedeemed?: number;
}) {
  const { data, error } = await supabase.rpc("create_sale", {
    p_customer_id: (customerId ?? null) as unknown as string,
    p_document_type: documentType,
    p_payment_method: paymentMethod,
    p_items: items.map((item) => ({
      product_id: item.productId,
      qty: item.qty,
      unit_price: item.price,
      variant_id: item.variantId ?? null,
    })),
    p_location_id: locationId ?? undefined,
    p_client_request_id: clientRequestId ?? undefined,
    p_points_redeemed: pointsRedeemed || 0,
  });

  if (error) throw error;
  if (!data) throw new Error("Supabase no devolvió la venta.");

  const payload = (typeof data === "object" && data !== null ? data : {}) as {
    sale_id?: string;
    subtotal?: number;
    tax?: number;
    total?: number;
    discount_total?: number;
    points_earned?: number;
    points_redeemed?: number;
  };
  const saleId = payload.sale_id ?? (typeof data === "string" ? data : null);
  if (!saleId) throw new Error("Supabase no devolvió el ID de la venta.");

  const sale = await fetchSaleById(saleId, companyId);
  if (!sale) return null;
  return {
    ...sale,
    subtotal: payload.subtotal ?? sale.subtotal,
    igv: payload.tax ?? sale.igv,
    total: payload.total ?? sale.total,
    discountTotal: payload.discount_total ?? 0,
    pointsEarned: payload.points_earned ?? 0,
    pointsRedeemed: payload.points_redeemed ?? 0,
  };
}

export async function createCategory(session: DemoSession, name: string) {
  const cleanName = name.trim();
  if (!cleanName) throw new Error("Ingresa el nombre de la categoría.");

  const { data, error } = await supabase
    .from("categories")
    .insert({ company_id: requireCompanyId(session), name: cleanName })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function updateCategory(categoryId: string, name: string) {
  const cleanName = name.trim();
  if (!cleanName) throw new Error("Ingresa el nombre de la categoría.");
  const { error } = await supabase
    .from("categories")
    .update({ name: cleanName })
    .eq("id", categoryId);
  if (error) throw error;
}

export async function deleteCategory(categoryId: string) {
  const { error } = await supabase
    .from("categories")
    .update({ deleted_at: new Date().toISOString(), active: false })
    .eq("id", categoryId);
  if (error) throw error;
}

// ---- Etiquetas (unidades de medida) ----

export interface Unit {
  id: string;
  name: string;
  active: boolean;
}

export async function fetchUnits(companyId?: string): Promise<Unit[]> {
  const query = supabase
    .from("units")
    .select("id, name, active")
    .is("deleted_at", null)
    .order("name");
  const { data, error } = await (companyId
    ? query.eq("company_id", companyId)
    : query);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    active: row.active,
  }));
}

export async function createUnit(session: DemoSession, name: string) {
  const cleanName = name.trim();
  if (!cleanName) throw new Error("Ingresa el nombre de la etiqueta.");
  const { data, error } = await supabase
    .from("units")
    .insert({ company_id: requireCompanyId(session), name: cleanName })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function updateUnit(
  session: DemoSession,
  unitId: string,
  name: string,
  previousName: string,
) {
  const cleanName = name.trim();
  if (!cleanName) throw new Error("Ingresa el nombre de la etiqueta.");
  const companyId = requireCompanyId(session);
  const { error } = await supabase
    .from("units")
    .update({ name: cleanName })
    .eq("id", unitId);
  if (error) throw error;
  // Cascada: renombra la unidad en los productos que la usaban (no hay FK por nombre).
  if (previousName && previousName !== cleanName) {
    await supabase
      .from("products")
      .update({ unit: cleanName })
      .eq("company_id", companyId)
      .eq("unit", previousName);
  }
}

export async function deleteUnit(unitId: string) {
  const { error } = await supabase
    .from("units")
    .update({ deleted_at: new Date().toISOString(), active: false })
    .eq("id", unitId);
  if (error) throw error;
}

// True when PostgREST rejects a write because a column isn't in the schema yet
// (e.g. `address` before its migration is applied). Lets writes degrade safely.
function isMissingColumnError(
  error: { code?: string; message?: string } | null,
): boolean {
  if (!error) return false;
  return (
    error.code === "PGRST204" ||
    /could not find the .* column|column .* does not exist/i.test(
      error.message ?? "",
    )
  );
}

export async function createCustomer(
  session: DemoSession,
  input: CreateCustomerInput,
) {
  const name = input.name.trim();
  if (!name) throw new Error("Ingresa el nombre del cliente.");

  const base = {
    company_id: requireCompanyId(session),
    name,
    document_number: input.documentNumber?.trim() || null,
    phone: input.phone?.trim() || null,
    email: input.email?.trim() || null,
  };
  const address = input.address?.trim() || null;

  let res = await supabase
    .from("customers")
    .insert({ ...base, address } as never)
    .select("id")
    .single();
  if (res.error && isMissingColumnError(res.error)) {
    res = await supabase.from("customers").insert(base).select("id").single();
  }
  if (res.error) throw res.error;
  return res.data!.id as string;
}

// Reads a customer's address on demand (used to prefill the edit form).
export async function getCustomerAddress(customerId: string): Promise<string> {
  const { data, error } = await supabase
    .from("customers")
    .select("address")
    .eq("id", customerId)
    .maybeSingle();
  if (error || !data) return "";
  return (data as { address?: string | null }).address ?? "";
}

export async function createSupplier(
  session: DemoSession,
  input: CreateSupplierInput,
) {
  const name = input.name.trim();
  if (!name) throw new Error("Ingresa la razón social.");

  const { error } = await supabase.from("suppliers").insert({
    company_id: requireCompanyId(session),
    name,
    document_number: input.documentNumber?.trim() || null,
    phone: input.phone?.trim() || null,
    email: input.email?.trim() || null,
  });
  if (error) throw error;
}

export async function updateSupplier(
  supplierId: string,
  input: CreateSupplierInput,
) {
  const name = input.name.trim();
  if (!name) throw new Error("Ingresa la razón social.");
  const payload: Record<string, unknown> = {
    name,
    document_number: input.documentNumber?.trim() || null,
    phone: input.phone?.trim() || null,
    updated_at: new Date().toISOString(),
  };
  // No pisar el email si el formulario no lo gestiona (input.email === undefined).
  if (input.email !== undefined) payload.email = input.email.trim() || null;
  const { error } = await supabase
    .from("suppliers")
    .update(payload as never)
    .eq("id", supplierId);
  if (error) throw error;
}

export async function deleteSupplier(supplierId: string) {
  const { error } = await supabase
    .from("suppliers")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", supplierId);
  if (error) throw error;
}

// Total stock = suma del stock asignado por punto de venta (cuando se usa multi-local).
function totalStock(input: CreateProductInput) {
  if (input.locations && input.locations.length > 0) {
    return input.locations.reduce((sum, loc) => sum + (loc.stock || 0), 0);
  }
  return input.stock;
}

// Stock de un local: Map product_id -> stock (solo productos activos en ese local).
// La presencia en el Map = el producto se vende en ese punto de venta.
export async function fetchLocationStock(
  locationId: string,
): Promise<Map<string, number>> {
  const { data, error } = await supabase
    .from("product_locations")
    .select("product_id, stock")
    .eq("location_id", locationId)
    .eq("is_active", true);
  if (error) throw error;
  return new Map(
    (data ?? []).map((row) => [row.product_id, toNumber(row.stock)]),
  );
}

// ---- Variantes de producto (talla, color, …) ----

export interface ProductVariantInput {
  /** Si viene con id, actualiza esa variante; si no, crea una nueva. */
  id?: string;
  attributes: Record<string, string>;
  barcode?: string | null;
  sku?: string | null;
  priceOverride?: number | null;
  costOverride?: number | null;
  /** Stock por sucursal de esta variante. */
  locations?: ProductLocationStock[];
}

function variantLabel(attributes: Record<string, string>): string {
  return Object.entries(attributes)
    .map(([key, value]) => `${key} ${value}`)
    .join(" / ");
}

// Variantes activas de un producto.
export async function fetchProductVariants(
  productId: string,
): Promise<ProductVariant[]> {
  const { data, error } = await supabase
    .from("product_variants")
    .select(
      "id, product_id, attributes, barcode, sku, price_override, cost_override",
    )
    .eq("product_id", productId)
    .eq("is_active", true)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => {
    const attributes = (row.attributes ?? {}) as Record<string, string>;
    return {
      id: row.id,
      productId: row.product_id,
      attributes,
      label: variantLabel(attributes),
      barcode: row.barcode ?? undefined,
      sku: row.sku ?? undefined,
      priceOverride:
        row.price_override == null ? null : toNumber(row.price_override),
      costOverride:
        row.cost_override == null ? null : toNumber(row.cost_override),
    };
  });
}

// Stock de variantes en un local, agrupado por variante Y por producto (para que
// el POS sepa qué productos con variantes están disponibles en la sucursal y el
// stock de cada combinación).
export async function fetchLocationVariantStock(locationId: string): Promise<{
  byVariant: Map<string, number>;
  byProduct: Map<string, number>;
}> {
  const { data, error } = await supabase
    .from("product_variant_locations")
    .select("stock, product_variant_id, product_variants!inner(product_id)")
    .eq("location_id", locationId)
    .eq("is_active", true);
  if (error) throw error;
  const byVariant = new Map<string, number>();
  const byProduct = new Map<string, number>();
  for (const row of (data ?? []) as Array<{
    stock: number;
    product_variant_id: string;
    product_variants?: { product_id?: string } | null;
  }>) {
    const stock = toNumber(row.stock);
    byVariant.set(row.product_variant_id, stock);
    const productId = row.product_variants?.product_id;
    if (productId)
      byProduct.set(productId, (byProduct.get(productId) ?? 0) + stock);
  }
  return { byVariant, byProduct };
}

// Stock por sucursal de UNA variante (para precargar el editor).
export async function fetchVariantLocations(
  variantId: string,
): Promise<ProductLocationStock[]> {
  const { data, error } = await supabase
    .from("product_variant_locations")
    .select("location_id, stock")
    .eq("product_variant_id", variantId)
    .eq("is_active", true);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    locationId: row.location_id,
    stock: toNumber(row.stock),
  }));
}

// Guarda las variantes de un producto en UNA sola transacción del servidor.
// La RPC `sync_product_variants` se encarga de: marcar has_variants +
// variant_attributes, crear/actualizar variantes con su stock por sucursal,
// soft-delete de las que ya no están, desactivar stocks huérfanos, recalcular
// products.stock como suma del stock activo de sus variantes y desactivar el
// stock plano (product_locations) si el producto pasa a manejar variantes.
// Si `variants` viene vacío, vuelve el producto a "sin variantes".
export async function syncProductVariants(
  session: DemoSession,
  productId: string,
  attributeNames: string[],
  variants: ProductVariantInput[],
) {
  requireCompanyId(session);
  const payload = variants.map((v) => ({
    id: v.id ?? null,
    attributes: v.attributes ?? {},
    barcode: v.barcode ?? null,
    sku: v.sku ?? null,
    price_override: v.priceOverride ?? null,
    cost_override: v.costOverride ?? null,
    locations: (v.locations ?? []).map((loc) => ({
      location_id: loc.locationId,
      stock: loc.stock || 0,
    })),
  }));
  const { error } = await supabase.rpc("sync_product_variants", {
    p_product_id: productId,
    p_attribute_names: attributeNames,
    p_variants: payload as never,
  });
  if (error) throw error;
}

export interface LowStockRow {
  productId: string;
  productName: string;
  locationId: string;
  locationName: string;
  stock: number;
}

// Productos por debajo del mínimo en cada punto de venta (vista consolidada
// "qué reponer y dónde", sin tener que cambiar de local uno por uno).
export async function fetchLowStockByLocation(
  companyId?: string,
  threshold = 10,
): Promise<LowStockRow[]> {
  let query: any = supabase
    .from("product_locations")
    .select(
      "product_id, location_id, stock, products!inner(name, deleted_at), locations!inner(name)",
    )
    .eq("is_active", true)
    .lt("stock", threshold)
    .order("stock", { ascending: true });
  if (companyId) query = query.eq("company_id", companyId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? [])
    .filter(
      (row: { products?: { deleted_at?: string | null } }) =>
        !row.products?.deleted_at,
    )
    .map(
      (row: {
        product_id: string;
        location_id: string;
        stock: number;
        products?: { name?: string };
        locations?: { name?: string };
      }) => ({
        productId: row.product_id,
        productName: row.products?.name ?? "—",
        locationId: row.location_id,
        locationName: row.locations?.name ?? "—",
        stock: toNumber(row.stock),
      }),
    );
}

// Mueve stock de un producto entre dos puntos de venta. Transaccional vía RPC
// `transfer_stock` (SECURITY DEFINER): lock FOR UPDATE en ambas filas, escribe
// stock_movements y recalcula products.stock. Bypassea la RLS admin-only de
// products, así operadores también pueden transferir.
export async function transferStock(
  session: DemoSession,
  input: {
    productId: string;
    fromLocationId: string;
    toLocationId: string;
    qty: number;
  },
) {
  requireCompanyId(session);
  if (!input.productId) throw new Error("Elige un producto.");
  if (!input.fromLocationId || !input.toLocationId)
    throw new Error("Elige la sucursal de origen y la de destino.");
  if (input.fromLocationId === input.toLocationId)
    throw new Error("El origen y el destino deben ser distintos.");
  if (!(input.qty > 0)) throw new Error("Ingresa una cantidad mayor a cero.");

  const { data, error } = await supabase.rpc("transfer_stock", {
    p_product_id: input.productId,
    p_from_location: input.fromLocationId,
    p_to_location: input.toLocationId,
    p_qty: input.qty,
    p_notes: undefined,
  });
  if (error) throw error;
  return data as {
    product_id: string;
    from_stock: number;
    to_stock: number;
    product_total: number;
  };
}

// Stock por punto de venta de un producto (solo locales activos para ese producto).
export async function fetchProductLocations(
  productId: string,
): Promise<ProductLocationStock[]> {
  const { data, error } = await supabase
    .from("product_locations")
    .select("location_id, stock")
    .eq("product_id", productId)
    .eq("is_active", true);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    locationId: row.location_id,
    stock: toNumber(row.stock),
  }));
}

export interface StockMovementRow {
  id: string;
  createdAt: string;
  productId: string;
  productName: string;
  locationId: string | null;
  locationName: string | null;
  movementType: string;
  qty: number;
  referenceType: string | null;
  notes: string | null;
  /** Id del perfil que hizo el ajuste (para mermas por empleado). Solo se graba en ajustes manuales. */
  createdBy: string | null;
}

// Movimientos de inventario reales (Kardex): ventas, compras, transferencias y
// ajustes manuales. Filtra por empresa y, si se indica, por sucursal. Devuelve
// los 200 más recientes con el nombre del producto y del local.
export async function fetchStockMovements(
  companyId?: string,
  locationId?: string,
): Promise<StockMovementRow[]> {
  let query: any = supabase
    .from("stock_movements")
    .select(
      "id, created_at, product_id, location_id, movement_type, qty, reference_type, notes, created_by, products!inner(name), locations(name)",
    )
    .order("created_at", { ascending: false })
    .limit(200);
  if (companyId) query = query.eq("company_id", companyId);
  if (locationId) query = query.eq("location_id", locationId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map(
    (row: {
      id: string;
      created_at: string;
      product_id: string;
      location_id: string | null;
      movement_type: string;
      qty: number;
      reference_type: string | null;
      notes: string | null;
      created_by: string | null;
      products?: { name?: string };
      locations?: { name?: string } | null;
    }) => ({
      id: row.id,
      createdAt: row.created_at,
      productId: row.product_id,
      productName: row.products?.name ?? "—",
      locationId: row.location_id,
      locationName: row.locations?.name ?? null,
      movementType: row.movement_type,
      qty: toNumber(row.qty),
      referenceType: row.reference_type,
      notes: row.notes,
      createdBy: row.created_by,
    }),
  );
}

// Ajuste manual de inventario (merma, pérdida, conteo físico): RPC `adjust_stock`
// SECURITY DEFINER, transaccional (FOR UPDATE), valida rol y recalcula total.
// Devuelve location_stock y product_total para refrescar la UI.
export async function createStockAdjustment(
  session: DemoSession,
  input: { productId: string; locationId: string; qty: number; notes?: string },
) {
  requireCompanyId(session);
  if (!input.productId) throw new Error("Elige un producto.");
  if (!input.locationId) throw new Error("Elige una sucursal.");
  if (!input.qty)
    throw new Error(
      "Ingresa una cantidad distinta de cero (usa - para descontar).",
    );

  const { data, error } = await supabase.rpc("adjust_stock", {
    p_product_id: input.productId,
    p_location_id: input.locationId,
    p_qty: input.qty,
    p_notes: input.notes?.trim() || undefined,
  });
  if (error) throw error;
  return data as {
    product_id: string;
    location_id: string;
    location_stock: number;
    product_total: number;
  };
}

// Sincroniza en qué locales está el producto y su stock: activa/actualiza los
// elegidos y desactiva los demás (sin borrar, para no perder referencias).
async function syncProductLocations(
  companyId: string,
  productId: string,
  locations: ProductLocationStock[],
) {
  if (locations.length > 0) {
    const rows = locations.map((loc) => ({
      company_id: companyId,
      product_id: productId,
      location_id: loc.locationId,
      stock: loc.stock || 0,
      is_active: true,
    }));
    const { error } = await supabase
      .from("product_locations")
      .upsert(rows, { onConflict: "product_id,location_id" });
    if (error) throw error;
  }
  const keep = locations.map((loc) => loc.locationId);
  let deactivate = supabase
    .from("product_locations")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("product_id", productId)
    .eq("is_active", true);
  if (keep.length > 0)
    deactivate = deactivate.not("location_id", "in", `(${keep.join(",")})`);
  const { error } = await deactivate;
  if (error) throw error;
}

export async function createProduct(
  session: DemoSession,
  input: CreateProductInput,
) {
  const name = input.name.trim();
  if (!name) throw new Error("Ingresa el nombre del producto.");
  const stock = totalStock(input);
  if (input.price < 0 || input.cost < 0 || stock < 0) {
    throw new Error("Costo, precio y stock deben ser valores positivos.");
  }

  const companyId = requireCompanyId(session);
  const { data, error } = await supabase
    .from("products")
    .insert({
      company_id: companyId,
      name,
      barcode: input.barcode?.trim() || null,
      sku: input.sku?.trim() || null,
      category_id: input.categoryId || null,
      supplier_id: input.supplierId || null,
      cost: input.cost,
      price: input.price,
      stock,
      unit: input.unit.trim() || "und",
      ...(input.priceIncludesTax !== undefined
        ? { price_includes_tax: input.priceIncludesTax }
        : {}),
      ...(input.imageUrl !== undefined
        ? { image_url: input.imageUrl || null }
        : {}),
    } as never)
    .select("id")
    .single();
  if (error) throw error;
  const productId = (data as { id: string }).id;
  if (input.locations) {
    await syncProductLocations(companyId, productId, input.locations);
  }
  return productId;
}

export async function updateProduct(
  productId: string,
  input: CreateProductInput,
  companyId?: string,
) {
  const name = input.name.trim();
  if (!name) throw new Error("Ingresa el nombre del producto.");
  const stock = totalStock(input);
  if (input.price < 0 || input.cost < 0 || stock < 0) {
    throw new Error("Costo, precio y stock deben ser valores positivos.");
  }

  const updates: Record<string, unknown> = {
    name,
    barcode: input.barcode?.trim() || null,
    sku: input.sku?.trim() || null,
    category_id: input.categoryId || null,
    supplier_id: input.supplierId ?? null,
    cost: input.cost,
    price: input.price,
    stock,
    unit: input.unit.trim() || "und",
    updated_at: new Date().toISOString(),
  };
  if (input.imageUrl !== undefined) updates.image_url = input.imageUrl || null;
  if (input.priceIncludesTax !== undefined)
    updates.price_includes_tax = input.priceIncludesTax;
  const { error } = await supabase
    .from("products")
    .update(updates as never)
    .eq("id", productId);
  if (error) throw error;

  if (input.locations) {
    let cid = companyId;
    if (!cid) {
      const { data } = await supabase
        .from("products")
        .select("company_id")
        .eq("id", productId)
        .maybeSingle();
      cid = (data as { company_id?: string } | null)?.company_id;
    }
    if (cid) await syncProductLocations(cid, productId, input.locations);
  }
}

// Soft-delete en cascada vía RPC: producto + variantes (libera índice único de
// barcode) + product_variant_locations + product_locations.
export async function deleteProduct(productId: string) {
  const { error } = await supabase.rpc("soft_delete_product", {
    p_product_id: productId,
  });
  if (error) throw error;
}

export interface SubscriptionPlan {
  id: string;
  name: string;
  price: number;
  productLimit: number;
  userLimit: number;
  salesLimit: number;
  isActive: boolean;
}

export interface PlanInput {
  name: string;
  price: number;
  productLimit: number;
  userLimit: number;
  salesLimit: number;
}

export async function fetchPlans(): Promise<SubscriptionPlan[]> {
  const { data, error } = await supabase
    .from("subscription_plans")
    .select(
      "id, name, price, product_limit, user_limit, monthly_sales_limit, is_active",
    )
    .eq("is_active", true)
    .order("price", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    price: toNumber(row.price),
    productLimit: toNumber(row.product_limit),
    userLimit: toNumber(row.user_limit),
    salesLimit: toNumber(row.monthly_sales_limit),
    isActive: row.is_active,
  }));
}

function planPayload(input: PlanInput) {
  const name = input.name.trim();
  if (!name) throw new Error("Ingresa el nombre del plan.");
  return {
    name,
    price: Math.max(0, input.price),
    product_limit: Math.max(0, Math.round(input.productLimit)),
    user_limit: Math.max(0, Math.round(input.userLimit)),
    monthly_sales_limit: Math.max(0, Math.round(input.salesLimit)),
  };
}

export async function createPlan(input: PlanInput) {
  const { error } = await supabase
    .from("subscription_plans")
    .insert(planPayload(input));
  if (error) throw error;
}

export async function updatePlan(planId: string, input: PlanInput) {
  const { error } = await supabase
    .from("subscription_plans")
    .update({ ...planPayload(input), updated_at: new Date().toISOString() })
    .eq("id", planId);
  if (error) throw error;
}

export async function deletePlan(planId: string) {
  const { error } = await supabase
    .from("subscription_plans")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", planId);
  if (error) throw error;
}

// ---- Caja (cash register) ----

export interface CashSession {
  id: string;
  status: string;
  openingAmount: number;
  openedAt: string;
  closedAt: string | null;
  realAmount: number | null;
  expectedAmount: number;
  difference: number | null;
  openedBy: string | null;
  closedBy: string | null;
  tillId: string | null;
  reviewStatus: "pending" | "authorized";
  classification: "cuadrado" | "faltante" | "sobrante" | null;
}

export interface CashMovement {
  id: string;
  type: string;
  concept: string;
  amount: number;
  movementAt: string;
}

// Dos listas de columnas: la "segura" (sin cifras) es la que debe usar
// cualquier lectura que un cajero pueda disparar -- el arqueo ciego exige
// que nunca vea el esperado/real/diferencia, ni siquiera de sesiones ya
// autorizadas de otras personas. No es un reemplazo de RLS (que es por
// fila, no por columna): es un allowlist a nivel de código, igual que el
// resto de los controles por rol en este proyecto (ver src/lib/permissions.ts).
const CASH_SESSION_COLS_SAFE =
  "id, status, opening_amount, opened_at, closed_at, opened_by, closed_by, till_id, review_status";
const CASH_SESSION_COLS_FULL = `${CASH_SESSION_COLS_SAFE}, real_amount, expected_amount, difference, classification`;

function mapCashSession(row: {
  id: string;
  status: string;
  opening_amount: number;
  opened_at: string;
  closed_at: string | null;
  real_amount?: number | null;
  expected_amount?: number | null;
  difference?: number | null;
  opened_by?: string | null;
  closed_by?: string | null;
  till_id?: string | null;
  review_status?: string | null;
  classification?: string | null;
}): CashSession {
  return {
    id: row.id,
    status: row.status,
    openingAmount: toNumber(row.opening_amount),
    openedAt: row.opened_at,
    closedAt: row.closed_at,
    realAmount: row.real_amount == null ? null : toNumber(row.real_amount),
    expectedAmount: toNumber(row.expected_amount ?? 0),
    difference: row.difference == null ? null : toNumber(row.difference),
    openedBy: row.opened_by ?? null,
    closedBy: row.closed_by ?? null,
    tillId: row.till_id ?? null,
    reviewStatus: row.review_status === "authorized" ? "authorized" : "pending",
    classification:
      row.classification === "cuadrado" ||
      row.classification === "faltante" ||
      row.classification === "sobrante"
        ? row.classification
        : null,
  };
}

// Mapa id de usuario → nombre, para mostrar quién abrió/cerró la caja.
export async function fetchProfileNames(
  companyId?: string,
): Promise<Record<string, string>> {
  if (!companyId) return {};
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, full_name")
      .eq("company_id", companyId);
    if (error) throw error;
    const map: Record<string, string> = {};
    for (const row of data ?? []) map[row.id] = row.full_name;
    return map;
  } catch {
    return {};
  }
}

// `openedBy`: acota a la sesión abierta por ESE usuario. Necesario desde que
// puede haber varias cajas abiertas a la vez en la misma sucursal -- sin
// esto, un cajero vería (y podría cerrar) la caja de otro compañero.
// `includeFigures`: false para cualquier lectura que dispare un cajero (ver
// comentario en CASH_SESSION_COLS_SAFE) -- solo admin/finanzas piden true.
export async function fetchOpenCashSession(
  companyId?: string,
  locationId?: string,
  openedBy?: string,
  includeFigures = false,
): Promise<CashSession | null> {
  let query = supabase
    .from("cash_sessions")
    .select(includeFigures ? CASH_SESSION_COLS_FULL : CASH_SESSION_COLS_SAFE)
    .eq("status", "open")
    .is("closed_at", null)
    .order("opened_at", { ascending: false })
    .limit(1);
  if (companyId) query = query.eq("company_id", companyId);
  if (locationId) query = query.eq("location_id", locationId);
  if (openedBy) query = query.eq("opened_by", openedBy);
  const { data, error } = await query;
  if (error) throw error;
  const row = data?.[0];
  return row ? mapCashSession(row as never) : null;
}

export async function fetchCashClosings(
  companyId?: string,
  locationId?: string,
  openedBy?: string,
  includeFigures = false,
): Promise<CashSession[]> {
  let query = supabase
    .from("cash_sessions")
    .select(includeFigures ? CASH_SESSION_COLS_FULL : CASH_SESSION_COLS_SAFE)
    .eq("status", "closed")
    .order("closed_at", { ascending: false })
    .limit(20);
  if (companyId) query = query.eq("company_id", companyId);
  if (locationId) query = query.eq("location_id", locationId);
  if (openedBy) query = query.eq("opened_by", openedBy);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => mapCashSession(row as never));
}

export async function fetchCashMovements(
  sessionId: string,
): Promise<CashMovement[]> {
  const { data, error } = await supabase
    .from("cash_movements")
    .select("id, movement_type, concept, amount, movement_at")
    .eq("cash_session_id", sessionId)
    .order("movement_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    type: row.movement_type,
    concept: row.concept,
    amount: toNumber(row.amount),
    movementAt: row.movement_at,
  }));
}

export async function openCashSession(
  _session: DemoSession,
  openingAmount: number,
  locationId?: string,
  tillId?: string,
) {
  const { data, error } = await supabase.rpc("open_cash_session", {
    p_opening_amount: Math.max(0, openingAmount),
    p_location_id: locationId ?? undefined,
    p_till_id: tillId ?? undefined,
  });
  if (error) throw error;
  return data as string;
}

export async function createCashMovement(
  session: DemoSession,
  sessionId: string,
  type: "ingreso" | "egreso",
  concept: string,
  amount: number,
) {
  const magnitude = Math.abs(amount);
  if (!magnitude) throw new Error("Ingresa un monto válido.");
  const { error } = await supabase.from("cash_movements").insert({
    company_id: requireCompanyId(session),
    cash_session_id: sessionId,
    movement_type: type,
    concept: concept.trim() || (type === "ingreso" ? "Ingreso" : "Egreso"),
    amount: type === "egreso" ? -magnitude : magnitude,
  });
  if (error) throw error;
}

// ---- Arqueo ciego: conteo por denominación, segundo conteo, autorización ----
// (Etapas 3-4 del módulo de caja). Reemplaza al viejo closeCashSession de
// un solo paso.

export interface TillCountLine {
  denomination: number;
  quantity: number;
  subtotal: number;
}

export interface TillCount {
  id: string;
  countNumber: 1 | 2;
  countedBy: string;
  countedAt: string;
  countedCashTotal: number;
  cardTotal: number;
  transferTotal: number;
  otherTotal: number;
  lines: TillCountLine[];
}

// Respuesta de submit_till_count: a propósito NO incluye expected_amount ni
// difference -- esa RPC literalmente no los calcula. No agregar esos campos
// aquí aunque el backend algún día los mande por error: el punto es que este
// tipo documente el contrato "nunca se le revela el esperado al cajero".
export interface SubmitTillCountResult {
  countId: string;
  countNumber: 1 | 2;
  countedCashTotal: number;
  cardTotal: number;
  transferTotal: number;
  otherTotal: number;
}

export async function submitTillCount(
  sessionId: string,
  denominations: { denomination: number; quantity: number }[],
): Promise<SubmitTillCountResult> {
  const { data, error } = await supabase.rpc("submit_till_count", {
    p_session_id: sessionId,
    p_denominations: denominations,
  });
  if (error) throw error;
  const row = data as {
    count_id: string;
    count_number: number;
    counted_cash_total: number;
    card_total: number;
    transfer_total: number;
    other_total: number;
  };
  return {
    countId: row.count_id,
    countNumber: row.count_number === 2 ? 2 : 1,
    countedCashTotal: toNumber(row.counted_cash_total),
    cardTotal: toNumber(row.card_total),
    transferTotal: toNumber(row.transfer_total),
    otherTotal: toNumber(row.other_total),
  };
}

export async function finishTillCount(
  sessionId: string,
): Promise<{ status: string; secondCountRequired: boolean }> {
  const { data, error } = await supabase.rpc("finish_till_count", {
    p_session_id: sessionId,
  });
  if (error) throw error;
  const row = data as { status: string; second_count_required: boolean };
  return { status: row.status, secondCountRequired: row.second_count_required };
}

// Admin/finanzas únicamente -- aquí (y solo aquí) se calculan y devuelven
// expected_amount/real_amount/difference/classification.
export async function authorizeCashSession(
  sessionId: string,
  notes?: string,
): Promise<{
  expectedAmount: number;
  realAmount: number;
  difference: number;
  classification: "cuadrado" | "faltante" | "sobrante";
}> {
  const { data, error } = await supabase.rpc("authorize_cash_session", {
    p_session_id: sessionId,
    p_notes: notes ?? undefined,
  });
  if (error) throw error;
  const row = data as {
    expected_amount: number;
    real_amount: number;
    difference: number;
    classification: string;
  };
  return {
    expectedAmount: toNumber(row.expected_amount),
    realAmount: toNumber(row.real_amount),
    difference: toNumber(row.difference),
    classification: row.classification as "cuadrado" | "faltante" | "sobrante",
  };
}

export async function fetchTillCounts(sessionId: string): Promise<TillCount[]> {
  const { data: counts, error } = await supabase
    .from("till_counts")
    .select(
      "id, count_number, counted_by, counted_at, counted_cash_total, card_total, transfer_total, other_total",
    )
    .eq("cash_session_id", sessionId)
    .order("count_number", { ascending: true });
  if (error) throw error;
  const countIds = (counts ?? []).map((c) => c.id);
  let linesByCount: Record<string, TillCountLine[]> = {};
  if (countIds.length) {
    const { data: lines, error: linesError } = await supabase
      .from("till_count_lines")
      .select("till_count_id, denomination, quantity, subtotal")
      .in("till_count_id", countIds);
    if (linesError) throw linesError;
    linesByCount = {};
    for (const line of lines ?? []) {
      const arr = (linesByCount[line.till_count_id] ??= []);
      arr.push({
        denomination: toNumber(line.denomination),
        quantity: line.quantity,
        subtotal: toNumber(line.subtotal),
      });
    }
  }
  return (counts ?? []).map((c) => ({
    id: c.id,
    countNumber: c.count_number === 2 ? 2 : 1,
    countedBy: c.counted_by,
    countedAt: c.counted_at,
    countedCashTotal: toNumber(c.counted_cash_total),
    cardTotal: toNumber(c.card_total),
    transferTotal: toNumber(c.transfer_total),
    otherTotal: toNumber(c.other_total),
    lines: (linesByCount[c.id] ?? []).sort(
      (a, b) => b.denomination - a.denomination,
    ),
  }));
}

// Cajas abiertas por OTRA persona en esta sucursal que ya tienen su primer
// conteo (no cuadró) y esperan que alguien distinto haga el segundo. Sin
// esto, cada quien solo puede ver su propia caja (fetchOpenCashSession la
// acota por opened_by) y nadie tendría forma de ayudar a cerrar la de un
// compañero -- se quedarían todas abiertas para siempre.
export async function fetchSessionsNeedingSecondCount(
  companyId: string,
  locationId: string,
  excludeCountedBy: string,
): Promise<CashSession[]> {
  const { data, error } = await supabase
    .from("cash_sessions")
    .select(CASH_SESSION_COLS_SAFE)
    .eq("company_id", companyId)
    .eq("location_id", locationId)
    .eq("status", "open")
    .order("opened_at", { ascending: true });
  if (error) throw error;
  const sessions = (data ?? []).map((row) => mapCashSession(row as never));
  const matches: CashSession[] = [];
  for (const s of sessions) {
    const counts = await fetchTillCounts(s.id);
    const count1 = counts.find((c) => c.countNumber === 1);
    const count2 = counts.find((c) => c.countNumber === 2);
    if (count1 && !count2 && count1.countedBy !== excludeCountedBy) {
      matches.push(s);
    }
  }
  return matches;
}

export interface PendingReviewSession extends CashSession {
  locationName: string;
  tillName: string | null;
}

// Cola de revisión para /caja/revision (admin/finanzas): cierres que ya
// pasaron por finish_till_count pero nadie ha autorizado todavía.
export async function fetchPendingReviewSessions(
  companyId?: string,
  locationId?: string,
): Promise<PendingReviewSession[]> {
  let query = supabase
    .from("cash_sessions")
    .select(`${CASH_SESSION_COLS_FULL}, locations(name), tills(name)`)
    .eq("status", "closed")
    .eq("review_status", "pending")
    .order("closed_at", { ascending: true });
  if (companyId) query = query.eq("company_id", companyId);
  if (locationId) query = query.eq("location_id", locationId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => {
    const r = row as unknown as {
      locations: { name: string } | null;
      tills: { name: string } | null;
    };
    return {
      ...mapCashSession(row as never),
      locationName: r.locations?.name ?? "—",
      tillName: r.tills?.name ?? null,
    };
  });
}

// Reportes (Etapa 6): solo cortes ya AUTORIZADOS -- lo que reemplaza la
// consolidación manual en Excel. admin/finanzas únicamente.
export interface CashReportRow extends CashSession {
  locationName: string;
  tillName: string | null;
  cardTotal: number;
  transferTotal: number;
  otherTotal: number;
}

export interface CashReportFilters {
  locationId?: string;
  tillId?: string;
  openedBy?: string;
  dateFrom?: string;
  dateTo?: string;
}

export async function fetchCashReport(
  companyId: string,
  filters: CashReportFilters = {},
): Promise<CashReportRow[]> {
  let query = supabase
    .from("cash_sessions")
    .select(`${CASH_SESSION_COLS_FULL}, locations(name), tills(name)`)
    .eq("company_id", companyId)
    .eq("status", "closed")
    .eq("review_status", "authorized")
    .order("closed_at", { ascending: false });
  if (filters.locationId) query = query.eq("location_id", filters.locationId);
  if (filters.tillId) query = query.eq("till_id", filters.tillId);
  if (filters.openedBy) query = query.eq("opened_by", filters.openedBy);
  // closed_at es timestamptz; dateFrom/dateTo vienen como "YYYY-MM-DD" del
  // selector de periodo -- se compara por el día completo en hora local del
  // negocio no hace falta aquí (a diferencia de ventas): un corte casi
  // siempre cae dentro del mismo día en el que se autorizó, y una
  // diferencia de husos horarios de a lo más unas horas no cambia qué
  // corte del día aparece en el reporte.
  if (filters.dateFrom) query = query.gte("closed_at", filters.dateFrom);
  if (filters.dateTo)
    query = query.lte("closed_at", `${filters.dateTo}T23:59:59`);
  const { data, error } = await query;
  if (error) throw error;
  const sessions = data ?? [];
  const sessionIds = sessions.map((s) => s.id);

  // Tarjeta/transferencia/otros del conteo FINAL de cada sesión (el mismo
  // que authorize_cash_session usa como "real" -- el de mayor count_number).
  // Ordenado ascendente y sobreescribiendo por session_id: lo último que se
  // procese por sesión siempre es el conteo más alto (1 o, si existe, 2).
  const latestCountBySession: Record<
    string,
    { cardTotal: number; transferTotal: number; otherTotal: number }
  > = {};
  if (sessionIds.length) {
    const { data: counts, error: countsError } = await supabase
      .from("till_counts")
      .select(
        "cash_session_id, count_number, card_total, transfer_total, other_total",
      )
      .in("cash_session_id", sessionIds)
      .order("count_number", { ascending: true });
    if (countsError) throw countsError;
    for (const c of counts ?? []) {
      latestCountBySession[c.cash_session_id] = {
        cardTotal: toNumber(c.card_total),
        transferTotal: toNumber(c.transfer_total),
        otherTotal: toNumber(c.other_total),
      };
    }
  }

  return sessions.map((row) => {
    const r = row as unknown as {
      locations: { name: string } | null;
      tills: { name: string } | null;
    };
    const totals = latestCountBySession[row.id] ?? {
      cardTotal: 0,
      transferTotal: 0,
      otherTotal: 0,
    };
    return {
      ...mapCashSession(row as never),
      locationName: r.locations?.name ?? "—",
      tillName: r.tills?.name ?? null,
      ...totals,
    };
  });
}

// Bitácora (Etapa 5) -- admin/finanzas únicamente, ya acotado por RLS en
// audit_log; no hace falta filtrar por rol aquí también.
export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  action: string;
  detail: Record<string, unknown>;
  createdAt: string;
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  opened: "Abrió la caja",
  movement_added: "Registró un movimiento",
  count_submitted: "Envió un conteo",
  second_count_required: "Se pidió un segundo conteo",
  closed: "Cerró la caja",
  authorized: "Autorizó el corte",
};

export function describeAuditAction(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

export async function fetchAuditLog(
  entityType: string,
  entityId: string,
): Promise<AuditLogEntry[]> {
  const { data, error } = await supabase
    .from("audit_log")
    .select("id, actor_id, action, detail, created_at")
    .eq("entity_type", entityType)
    .eq("entity_id", entityId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    actorId: row.actor_id,
    action: row.action,
    detail: (row.detail ?? {}) as Record<string, unknown>,
    createdAt: row.created_at,
  }));
}

export interface CompanyProfile {
  name: string;
  countryCode: string;
  fiscalId: string;
  address: string;
  phone: string;
}

export async function fetchCompanyProfile(
  companyId: string,
): Promise<CompanyProfile> {
  const { data, error } = await supabase
    .from("companies")
    .select("name, country_code, fiscal_id, address, phone")
    .eq("id", companyId)
    .single();
  if (error) throw error;
  return {
    name: data.name ?? "",
    countryCode: data.country_code ?? "",
    fiscalId: data.fiscal_id ?? "",
    address: data.address ?? "",
    phone: data.phone ?? "",
  };
}

export async function updateCompanySettings(
  session: DemoSession,
  input: UpdateCompanySettingsInput,
) {
  if (!session.companyId)
    throw new Error("La sesión no tiene empresa asociada.");

  // The store owner only edits its own profile fields. Country, currency, tax
  // and comprobantes are managed centrally per country by the platform admin.
  const updates: Record<string, unknown> = {
    name: input.businessName.trim(),
    fiscal_id: input.fiscalId?.trim() || null,
    address: input.address?.trim() || null,
    phone: input.phone?.trim() || null,
    updated_at: new Date().toISOString(),
  };
  if (input.logoUrl !== undefined) updates.logo_url = input.logoUrl || null;
  if (input.businessType !== undefined)
    updates.business_type = input.businessType;
  if (input.cardCommissionRate !== undefined)
    updates.card_commission_rate = input.cardCommissionRate;
  if (input.loyaltyEnabled !== undefined)
    updates.loyalty_enabled = input.loyaltyEnabled;
  if (input.loyaltyPointValue !== undefined)
    updates.loyalty_point_value = input.loyaltyPointValue;
  if (input.loyaltyEarnRate !== undefined)
    updates.loyalty_earn_rate = input.loyaltyEarnRate;
  const { data, error } = await supabase
    .from("companies")
    .update(updates as never)
    .eq("id", session.companyId)
    .select("*")
    .single();

  if (error) throw error;
  return data as CompanyRow;
}

// ---- Country tax settings (platform admin; applies to every store in a country) ----

export interface CountrySetting {
  countryCode: string;
  taxRate: number;
  taxName: string;
  fiscalIdLabel: string;
  currencyCode: string | null;
  documentTypes: DocumentType[];
}

export interface UpdateCountrySettingInput {
  taxRate: number;
  taxName: string;
  fiscalIdLabel: string;
  documentTypes: DocumentType[];
}

function parseDocTypesJson(raw: unknown): DocumentType[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (entry): entry is Record<string, unknown> =>
        !!entry && typeof entry === "object",
    )
    .map((entry) => ({
      name: String(entry.name ?? "").trim(),
      chargesIva: Boolean(entry.charges_iva),
    }))
    .filter((entry) => entry.name.length > 0);
}

export async function fetchCountrySettings(): Promise<CountrySetting[]> {
  const client = supabase as any;
  const { data, error } = await client
    .from("country_settings")
    .select(
      "country_code, tax_rate, tax_name, fiscal_id_label, currency_code, document_types",
    )
    .order("country_code");
  if (error) throw error;
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    countryCode: String(row.country_code),
    taxRate: toNumber(row.tax_rate),
    taxName: (row.tax_name as string) ?? "IVA",
    fiscalIdLabel: (row.fiscal_id_label as string) ?? "ID fiscal",
    currencyCode: (row.currency_code as string | null) ?? null,
    documentTypes: parseDocTypesJson(row.document_types),
  }));
}

export async function updateCountrySetting(
  countryCode: string,
  input: UpdateCountrySettingInput,
) {
  const docs = input.documentTypes
    .map((doc) => ({ name: doc.name.trim(), charges_iva: doc.chargesIva }))
    .filter((doc) => doc.name.length > 0);

  const client = supabase as any;
  const { error } = await client
    .from("country_settings")
    .update({
      tax_rate: input.taxRate,
      tax_name: input.taxName.trim() || "IVA",
      fiscal_id_label: input.fiscalIdLabel.trim() || "ID fiscal",
      document_types: docs,
      updated_at: new Date().toISOString(),
    })
    .eq("country_code", countryCode);
  if (error) throw error;
}

export async function updateCompanyLogo(
  session: DemoSession,
  logoUrl: string | null,
) {
  const companyId = requireCompanyId(session);
  const { data, error } = await supabase
    .from("companies")
    .update({
      logo_url: logoUrl,
      updated_at: new Date().toISOString(),
    } as never)
    .eq("id", companyId)
    .select("*")
    .single();
  if (error) throw error;
  return data as CompanyRow;
}

export function mapCompanyToBusinessSettings(
  row: CompanyRow,
): Partial<BusinessSettings> {
  const market = getMarketByCountryCode(row.country_code);
  return {
    businessName: row.name,
    countryCode: market.countryCode,
    countryName: market.countryName,
    currencyCode: row.currency_code,
    currencyName: market.currencyName,
    locale: row.locale,
    fiscalIdLabel: row.fiscal_id_label,
    sampleFiscalId: row.fiscal_id || market.sampleFiscalId,
    sampleAddress: row.address || market.sampleAddress,
    taxName: row.tax_name,
    taxRate: toNumber(row.tax_rate, market.taxRate),
    cardCommissionRate: toNumber(
      (row as { card_commission_rate?: number }).card_commission_rate,
      0.03,
    ),
    loyaltyEnabled:
      (row as { loyalty_enabled?: boolean }).loyalty_enabled ?? false,
    loyaltyPointValue: toNumber(
      (row as { loyalty_point_value?: number }).loyalty_point_value,
      0,
    ),
    loyaltyEarnRate: toNumber(
      (row as { loyalty_earn_rate?: number }).loyalty_earn_rate,
      0,
    ),
    logoUrl: (row as { logo_url?: string | null }).logo_url ?? undefined,
    businessType:
      (row as { business_type?: string | null }).business_type ?? undefined,
  };
}

// ---- Ganancias (utilidad = precio de venta - costo) ----

export interface ProfitRow {
  productName: string;
  qty: number;
  revenue: number;
  cost: number;
  profit: number;
}

export interface ProfitReport {
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
  marginPct: number;
  rows: ProfitRow[];
}

// Ingreso NETO (sin IVA) - Costo. Calculado por la RPC profit_report en el servidor:
// usa sale_items.net_revenue (total - tax_amount), respeta RLS por company y sucursal.
// No descuenta devoluciones.
export async function fetchProfitReport(
  _companyId?: string,
  fromDate?: string,
  toDate?: string,
  locationId?: string,
): Promise<ProfitReport> {
  // Convertir yyyy-mm-dd a límites LOCALes (mismo criterio que useDashboardData), para
  // que el rango de Ganancias coincida con Dashboard/Reportes (antes "from" usaba
  // medianoche UTC y "to" medianoche local → el periodo no cuadraba entre pantallas).
  const fromTs = fromDate
    ? new Date(`${fromDate}T00:00:00`).toISOString()
    : null;
  const toTs = toDate
    ? new Date(
        new Date(`${toDate}T00:00:00`).getTime() + 24 * 60 * 60 * 1000,
      ).toISOString()
    : null;
  const { data, error } = await supabase.rpc("profit_report", {
    p_from: fromTs as unknown as string,
    p_to: toTs as unknown as string,
    p_location_id: (locationId ?? null) as unknown as string,
  });

  if (error) throw error;

  let totalRevenue = 0;
  let totalCost = 0;
  const rows: ProfitRow[] = (data ?? []).map((row: Record<string, unknown>) => {
    const revenue = toNumber(row.revenue, 0);
    const cost = toNumber(row.cost, 0);
    const profit = toNumber(row.profit, revenue - cost);
    totalRevenue += revenue;
    totalCost += cost;
    return {
      productName: (row.product_name as string) ?? "—",
      qty: toNumber(row.qty, 0),
      revenue,
      cost,
      profit,
    };
  });

  const totalProfit = totalRevenue - totalCost;
  return {
    totalRevenue,
    totalCost,
    totalProfit,
    marginPct: totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0,
    rows: rows.sort((a, b) => b.profit - a.profit),
  };
}

// ---- Puntos de venta (locales / tiendas / bodegas) ----

export interface Location {
  id: string;
  name: string;
  shortCode: string | null;
  address: string | null;
  city: string | null;
  phone: string | null;
  managerName: string | null;
  openingHours: string | null;
  isActive: boolean;
}

export interface LocationInput {
  name: string;
  shortCode?: string;
  city?: string;
  address?: string;
  phone?: string;
  managerName?: string;
  openingHours?: string;
  isActive?: boolean;
}

// `onlyActive` para selectores de operación (POS); el gestor pide todos.
// `select("*")` para tolerar que city/phone/manager_name aún no existan en la BD.
export async function fetchLocations(
  companyId?: string,
  onlyActive = false,
): Promise<Location[]> {
  let query = supabase.from("locations").select("*").order("name");
  if (companyId) query = query.eq("company_id", companyId);
  if (onlyActive) query = query.eq("is_active", true);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    shortCode: (row as { short_code?: string | null }).short_code ?? null,
    address: row.address,
    city: (row as { city?: string | null }).city ?? null,
    phone: (row as { phone?: string | null }).phone ?? null,
    managerName: (row as { manager_name?: string | null }).manager_name ?? null,
    openingHours:
      (row as { opening_hours?: string | null }).opening_hours ?? null,
    isActive: row.is_active,
  }));
}

export async function createLocation(
  session: DemoSession,
  input: LocationInput,
) {
  const name = input.name.trim();
  if (!name) throw new Error("Ingresa el nombre de la sucursal.");
  const base = {
    company_id: requireCompanyId(session),
    name,
    address: input.address?.trim() || null,
  };
  const full = {
    ...base,
    short_code: input.shortCode?.trim() || null,
    city: input.city?.trim() || null,
    phone: input.phone?.trim() || null,
    manager_name: input.managerName?.trim() || null,
    opening_hours: input.openingHours?.trim() || null,
  };
  let res = await supabase.from("locations").insert(full as never);
  if (res.error && isMissingColumnError(res.error)) {
    res = await supabase.from("locations").insert(base);
  }
  if (res.error) throw res.error;
}

export async function updateLocation(locationId: string, input: LocationInput) {
  const name = input.name.trim();
  if (!name) throw new Error("Ingresa el nombre de la sucursal.");
  const base = {
    name,
    address: input.address?.trim() || null,
    is_active: input.isActive ?? true,
    updated_at: new Date().toISOString(),
  };
  const full = {
    ...base,
    short_code: input.shortCode?.trim() || null,
    city: input.city?.trim() || null,
    phone: input.phone?.trim() || null,
    manager_name: input.managerName?.trim() || null,
    opening_hours: input.openingHours?.trim() || null,
  };
  let res = await supabase
    .from("locations")
    .update(full as never)
    .eq("id", locationId);
  if (res.error && isMissingColumnError(res.error)) {
    res = await supabase
      .from("locations")
      .update(base as never)
      .eq("id", locationId);
  }
  if (res.error) throw res.error;
}

export async function setLocationActive(locationId: string, isActive: boolean) {
  const { error } = await supabase
    .from("locations")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", locationId);
  if (error) throw error;
}

// ---- Cajas físicas (tills) — Etapa 1 del módulo de arqueo de caja ----
// Cada sucursal recibe una "Caja 1" automática (trigger locations_create_
// default_till en 01_install.sql); esto solo es el catálogo para
// crear/renombrar/desactivar cajas adicionales. No cambia apertura/cierre.

export interface Till {
  id: string;
  locationId: string;
  name: string;
  code: string | null;
  isActive: boolean;
}

export interface TillInput {
  name: string;
  code?: string;
  isActive?: boolean;
}

export async function fetchTills(locationId: string): Promise<Till[]> {
  const { data, error } = await supabase
    .from("tills")
    .select("id, location_id, name, code, is_active")
    .eq("location_id", locationId)
    .order("name");
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    locationId: row.location_id,
    name: row.name,
    code: row.code,
    isActive: row.is_active,
  }));
}

export async function createTill(
  session: DemoSession,
  locationId: string,
  input: TillInput,
) {
  const name = input.name.trim();
  if (!name) throw new Error("Ingresa el nombre de la caja.");
  const { error } = await supabase.from("tills").insert({
    company_id: requireCompanyId(session),
    location_id: locationId,
    name,
    code: input.code?.trim() || null,
  });
  if (error) throw error;
}

export async function updateTill(tillId: string, input: TillInput) {
  const name = input.name.trim();
  if (!name) throw new Error("Ingresa el nombre de la caja.");
  const { error } = await supabase
    .from("tills")
    .update({
      name,
      code: input.code?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", tillId);
  if (error) throw error;
}

export async function setTillActive(tillId: string, isActive: boolean) {
  const { error } = await supabase
    .from("tills")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", tillId);
  if (error) throw error;
}

export function buildDashboardData(
  catalog: CompanyCatalog,
  sales: Sale[],
): DashboardData {
  const today = localDateKey(new Date());
  const month = today.slice(0, 7);
  const lowStock = catalog.products.filter(
    (product) => product.stock > 0 && product.stock < 10,
  );
  const productById = new Map(
    catalog.products.map((product) => [product.id, product]),
  );

  const totalToday = sales
    .filter((sale) => sale.date === today)
    .reduce((total, sale) => total + sale.total, 0);
  const totalMonth = sales
    .filter((sale) => sale.date.startsWith(month))
    .reduce((total, sale) => total + sale.total, 0);

  const dates = Array.from(new Set(sales.map((sale) => sale.date)))
    .sort()
    .slice(-7);
  const salesLast7Days = dates.map((date) => ({
    day: new Date(`${date}T00:00:00`).toLocaleDateString("es", {
      weekday: "short",
      day: "2-digit",
    }),
    total: sales
      .filter((sale) => sale.date === date)
      .reduce((total, sale) => total + sale.total, 0),
  }));

  const methodMap = new Map<string, number>();
  for (const sale of sales)
    methodMap.set(sale.method, (methodMap.get(sale.method) ?? 0) + sale.total);

  const categoryMap = new Map<string, number>();
  for (const sale of sales) {
    for (const item of sale.items) {
      const category =
        productById.get(item.productId)?.category ?? "Sin categoría";
      categoryMap.set(
        category,
        (categoryMap.get(category) ?? 0) + item.qty * item.price,
      );
    }
  }

  return {
    totalToday,
    salesTodayCount: sales.filter((sale) => sale.date === today).length,
    totalMonth,
    productsCount: catalog.products.length,
    customersCount: catalog.customers.length,
    lowStockCount: lowStock.length,
    lowStockProducts: lowStock
      .slice()
      .sort((a, b) => a.stock - b.stock)
      .slice(0, 4)
      .map((product) => ({
        id: product.id,
        name: product.name,
        stock: product.stock,
        unit: product.unit,
      })),
    recentSales: sales
      .slice()
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
      .slice(0, 4)
      .map((sale) => ({
        id: sale.id,
        date: sale.date,
        customer: sale.customer,
        method: sale.method,
        total: sale.total,
      })),
    salesLast7Days,
    salesByCategory: Array.from(categoryMap, ([name, value]) => ({
      name,
      value,
    })),
    salesByMethod: Array.from(methodMap, ([name, value]) => ({ name, value })),
  };
}

export function buildDemoDashboardData() {
  return buildDashboardData(demoCatalog, demoSales);
}

export function emptyDashboardData(): DashboardData {
  return {
    totalToday: 0,
    salesTodayCount: 0,
    totalMonth: 0,
    productsCount: 0,
    customersCount: 0,
    lowStockCount: 0,
    lowStockProducts: [],
    recentSales: [],
    salesLast7Days: [],
    salesByCategory: [],
    salesByMethod: [],
  };
}

// ---- Clientes (update / delete) ----

export async function updateCustomer(
  customerId: string,
  input: CreateCustomerInput,
) {
  const name = input.name.trim();
  if (!name) throw new Error("Ingresa el nombre del cliente.");
  const base: Record<string, unknown> = {
    name,
    document_number: input.documentNumber?.trim() || null,
    phone: input.phone?.trim() || null,
    updated_at: new Date().toISOString(),
  };
  // No pisar el email si el formulario no lo gestiona (input.email === undefined).
  if (input.email !== undefined) base.email = input.email.trim() || null;
  const address = input.address?.trim() || null;

  let res = await supabase
    .from("customers")
    .update({ ...base, address } as never)
    .eq("id", customerId);
  if (res.error && isMissingColumnError(res.error)) {
    res = await supabase
      .from("customers")
      .update(base as never)
      .eq("id", customerId);
  }
  if (res.error) throw res.error;
}

export async function deleteCustomer(customerId: string) {
  const { error } = await supabase
    .from("customers")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", customerId);
  if (error) throw error;
}

function documentNumber(prefix: string) {
  const now = new Date();
  const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
    now.getDate(),
  ).padStart(2, "0")}`;
  const rand = Math.floor(Math.random() * 0x10000)
    .toString(16)
    .toUpperCase()
    .padStart(4, "0");
  return `${prefix}-${stamp}-${rand}`;
}

// ---- Promociones ----

export type PromotionType = "discount" | "2x1" | "combo";

export interface Promotion {
  id: string;
  name: string;
  type: string;
  valueText: string | null;
  valueAmount: number | null;
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
}

export interface PromotionInput {
  name: string;
  type: PromotionType;
  valueText?: string | null;
  valueAmount?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
}

export async function fetchPromotions(
  companyId?: string,
): Promise<Promotion[]> {
  const query = supabase
    .from("promotions")
    .select(
      "id, name, promotion_type, value_text, value_amount, starts_at, ends_at, active",
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  const { data, error } = await (companyId
    ? query.eq("company_id", companyId)
    : query);
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    type: row.promotion_type,
    valueText: row.value_text,
    valueAmount: row.value_amount == null ? null : toNumber(row.value_amount),
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    active: row.active,
  }));
}

export async function createPromotion(
  session: DemoSession,
  input: PromotionInput,
) {
  const name = input.name.trim();
  if (!name) throw new Error("Ingresa el nombre de la promoción.");
  const { error } = await supabase.from("promotions").insert({
    company_id: requireCompanyId(session),
    name,
    promotion_type: input.type,
    value_text: input.valueText?.trim() || null,
    value_amount: input.valueAmount ?? null,
    starts_at: input.startsAt || null,
    ends_at: input.endsAt || null,
    active: true,
  });
  if (error) throw error;
}

export async function updatePromotion(
  promotionId: string,
  input: PromotionInput,
) {
  const name = input.name.trim();
  if (!name) throw new Error("Ingresa el nombre de la promoción.");
  const { error } = await supabase
    .from("promotions")
    .update({
      name,
      promotion_type: input.type,
      value_text: input.valueText?.trim() || null,
      value_amount: input.valueAmount ?? null,
      starts_at: input.startsAt || null,
      ends_at: input.endsAt || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", promotionId);
  if (error) throw error;
}

export async function setPromotionActive(promotionId: string, active: boolean) {
  const { error } = await supabase
    .from("promotions")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", promotionId);
  if (error) throw error;
}

export async function deletePromotion(promotionId: string) {
  const { error } = await supabase
    .from("promotions")
    .update({ deleted_at: new Date().toISOString(), active: false })
    .eq("id", promotionId);
  if (error) throw error;
}

// ---- Compras (purchases + stock) ----

export interface Purchase {
  id: string;
  number: string;
  date: string;
  supplier: string;
  supplierId: string | null;
  document: string | null;
  total: number;
}

export interface PurchaseItemInput {
  productId: string;
  variantId?: string | null;
  qty: number;
  unitCost: number;
}

export interface CreatePurchaseInput {
  supplierId: string | null;
  documentNumber?: string;
  date?: string;
  locationId?: string | null;
  items: PurchaseItemInput[];
}

export async function fetchPurchases(companyId?: string): Promise<Purchase[]> {
  const query = supabase
    .from("purchases")
    .select(
      "id, purchase_number, purchase_date, document_number, total, supplier_id",
    )
    .is("deleted_at", null)
    .order("purchase_date", { ascending: false });
  const { data, error } = await (companyId
    ? query.eq("company_id", companyId)
    : query);
  if (error) throw error;
  const rows = data ?? [];

  const supplierIds = Array.from(
    new Set(
      rows
        .map((row) => row.supplier_id)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  const supplierName = new Map<string, string>();
  if (supplierIds.length) {
    const { data: suppliers } = await supabase
      .from("suppliers")
      .select("id, name")
      .in("id", supplierIds);
    (suppliers ?? []).forEach((supplier) =>
      supplierName.set(supplier.id, supplier.name),
    );
  }

  return rows.map((row) => ({
    id: row.id,
    number: row.purchase_number,
    date: normalizeDate(row.purchase_date),
    supplier: row.supplier_id
      ? (supplierName.get(row.supplier_id) ?? "—")
      : "—",
    supplierId: row.supplier_id ?? null,
    document: row.document_number,
    total: toNumber(row.total),
  }));
}

export async function createPurchase(
  session: DemoSession,
  input: CreatePurchaseInput,
) {
  requireCompanyId(session);
  const items = input.items.filter((item) => item.productId && item.qty > 0);
  if (!items.length)
    throw new Error("Agrega al menos un producto a la compra.");

  const { data, error } = await supabase.rpc("create_purchase", {
    p_supplier_id: (input.supplierId || null) as unknown as string,
    p_document_number: (input.documentNumber?.trim() ||
      null) as unknown as string,
    p_date: input.date
      ? new Date(input.date).toISOString()
      : new Date().toISOString(),
    p_location_id: (input.locationId || null) as unknown as string,
    p_items: items.map((item) => ({
      product_id: item.productId,
      variant_id: item.variantId || null,
      qty: item.qty,
      unit_cost: item.unitCost,
    })),
  });
  if (error) throw error;
  return data as string;
}

// ---- Devoluciones (returns) ----

export interface ReturnDoc {
  id: string;
  number: string;
  date: string;
  saleNumber: string;
  reason: string;
  total: number;
  status: string;
  /** Total de unidades devueltas (que vuelven al stock). */
  units: number;
  /** Resumen de lo devuelto, ej. "4 × Arroz Costeño 750g". */
  itemsLabel: string;
}

export interface CreateReturnItemInput {
  saleItemId?: string | null;
  productId: string;
  variantId?: string | null;
  qty: number;
  unitPrice?: number;
}

export interface CreateReturnInput {
  saleId: string | null;
  reason: string;
  locationId?: string | null;
  refundCash?: boolean;
  items: CreateReturnItemInput[];
}

export async function fetchReturns(companyId?: string): Promise<ReturnDoc[]> {
  const query = supabase
    .from("returns")
    .select("id, return_number, created_at, reason, total, status, sale_id")
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  const { data, error } = await (companyId
    ? query.eq("company_id", companyId)
    : query);
  if (error) throw error;
  const rows = data ?? [];

  const saleIds = Array.from(
    new Set(
      rows.map((row) => row.sale_id).filter((id): id is string => Boolean(id)),
    ),
  );
  const saleNumber = new Map<string, string>();
  if (saleIds.length) {
    const { data: sales } = await supabase
      .from("sales")
      .select("id, sale_number")
      .in("id", saleIds);
    (sales ?? []).forEach((sale) => saleNumber.set(sale.id, sale.sale_number));
  }

  // Productos/unidades devueltos por cada nota (las que vuelven al stock).
  const returnIds = rows.map((row) => row.id);
  const itemsByReturn = new Map<
    string,
    { productName: string; variantLabel: string | null; qty: number }[]
  >();
  if (returnIds.length) {
    const { data: ritems } = await supabase
      .from("return_items")
      .select("return_id, product_name, variant_label, qty")
      .in("return_id", returnIds);
    (ritems ?? []).forEach((it) => {
      const list = itemsByReturn.get(it.return_id) ?? [];
      list.push({
        productName: it.product_name,
        variantLabel: it.variant_label,
        qty: toNumber(it.qty),
      });
      itemsByReturn.set(it.return_id, list);
    });
  }

  return rows.map((row) => {
    const its = itemsByReturn.get(row.id) ?? [];
    const units = its.reduce((sum, i) => sum + i.qty, 0);
    const itemsLabel = its
      .map(
        (i) =>
          `${i.qty} × ${i.productName}${i.variantLabel ? ` (${i.variantLabel})` : ""}`,
      )
      .join(", ");
    return {
      id: row.id,
      number: row.return_number,
      date: normalizeDate(row.created_at),
      saleNumber: row.sale_id ? (saleNumber.get(row.sale_id) ?? "—") : "—",
      reason: row.reason,
      total: toNumber(row.total),
      status: row.status,
      units,
      itemsLabel: itemsLabel || "—",
    };
  });
}

export interface SaleItemForReturn {
  id: string;
  productId: string | null;
  productName: string;
  variantId: string | null;
  variantLabel: string | null;
  qty: number;
  unitPrice: number;
  alreadyReturned: number;
}

export async function fetchSaleItemsForReturn(
  saleId: string,
): Promise<SaleItemForReturn[]> {
  const { data, error } = await supabase
    .from("sale_items")
    .select(
      "id, product_id, product_name, product_variant_id, variant_label, qty, unit_price",
    )
    .eq("sale_id", saleId);
  if (error) throw error;
  const items = data ?? [];
  if (!items.length) return [];
  const { data: prev } = await supabase
    .from("return_items")
    .select("sale_item_id, qty")
    .in(
      "sale_item_id",
      items.map((i) => i.id),
    );
  const returned = new Map<string, number>();
  (prev ?? []).forEach((r) => {
    if (!r.sale_item_id) return;
    returned.set(
      r.sale_item_id,
      (returned.get(r.sale_item_id) ?? 0) + toNumber(r.qty),
    );
  });
  return items.map((i) => ({
    id: i.id,
    productId: i.product_id,
    productName: i.product_name,
    variantId: i.product_variant_id,
    variantLabel: i.variant_label,
    qty: toNumber(i.qty),
    unitPrice: toNumber(i.unit_price),
    alreadyReturned: returned.get(i.id) ?? 0,
  }));
}

export async function createReturn(
  _session: DemoSession,
  input: CreateReturnInput,
) {
  const reason = input.reason.trim();
  if (!reason) throw new Error("Describe el motivo de la devolución.");
  if (!input.items || input.items.length === 0) {
    throw new Error("Agrega al menos un producto a la devolución.");
  }
  const { data, error } = await supabase.rpc("create_return", {
    p_sale_id: input.saleId as string,
    p_reason: reason,
    p_location_id: input.locationId ?? undefined,
    p_refund_cash: input.refundCash ?? true,
    p_items: input.items.map((it) => ({
      sale_item_id: it.saleItemId ?? null,
      product_id: it.productId,
      variant_id: it.variantId ?? null,
      qty: it.qty,
      unit_price: it.unitPrice,
    })) as unknown as Json,
  });
  if (error) throw error;
  return data as string;
}

// ---- Suscripción (uso real del plan) ----

export interface PlanUsage {
  plan: SubscriptionPlan | null;
  status: string;
  expiresAt: string | null;
  productsCount: number;
  salesThisMonth: number;
  usersCount: number;
}

export async function fetchPlanUsage(companyId?: string): Promise<PlanUsage> {
  let plan: SubscriptionPlan | null = null;
  let status = "trial";
  let expiresAt: string | null = null;

  if (companyId) {
    const { data: company } = await supabase
      .from("companies")
      .select("plan_id, subscription_status, expires_at")
      .eq("id", companyId)
      .maybeSingle();
    status = company?.subscription_status ?? "trial";
    expiresAt = company?.expires_at ?? null;
    if (company?.plan_id) {
      const { data: planRow } = await supabase
        .from("subscription_plans")
        .select(
          "id, name, price, product_limit, user_limit, monthly_sales_limit, is_active",
        )
        .eq("id", company.plan_id)
        .maybeSingle();
      if (planRow) {
        plan = {
          id: planRow.id,
          name: planRow.name,
          price: toNumber(planRow.price),
          productLimit: toNumber(planRow.product_limit),
          userLimit: toNumber(planRow.user_limit),
          salesLimit: toNumber(planRow.monthly_sales_limit),
          isActive: planRow.is_active,
        };
      }
    }
  }

  const productsQuery = supabase
    .from("products")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .eq("active", true);
  const { count: productsCount } = await (companyId
    ? productsQuery.eq("company_id", companyId)
    : productsQuery);

  const month = localDateKey(new Date()).slice(0, 7);
  const salesQuery = supabase
    .from("sales")
    .select("id", { count: "exact", head: true })
    .is("deleted_at", null)
    .gte("sale_date", `${month}-01`);
  const { count: salesThisMonth } = await (companyId
    ? salesQuery.eq("company_id", companyId)
    : salesQuery);

  const usersQuery = supabase
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);
  const { count: usersCount } = await (companyId
    ? usersQuery.eq("company_id", companyId)
    : usersQuery);

  return {
    plan,
    status,
    expiresAt,
    productsCount: productsCount ?? 0,
    salesThisMonth: salesThisMonth ?? 0,
    usersCount: usersCount ?? 0,
  };
}

export async function setCompanyPlan(companyId: string, planId: string) {
  const { error } = await supabase
    .from("companies")
    .update({
      plan_id: planId,
      subscription_status: "active",
      updated_at: new Date().toISOString(),
    })
    .eq("id", companyId);
  if (error) throw error;
}

// ---- Equipo (Usuarios) ----

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  active: boolean;
  /** Sucursal primaria/por defecto (compat). */
  locationId: string | null;
  /** Sucursales asignadas. Vacío = todas las sucursales. */
  locationIds: string[];
  /** Accesos personalizados (rutas del panel). null = usar defaults del rol. */
  allowedSections: string[] | null;
  /** Acceso al Panel SaaS (solo aplica a administradores). */
  isPlatformAdmin: boolean;
  /** Si ya tiene un PIN de checador asignado (nunca se expone el PIN/hash real). */
  hasPin: boolean;
}

export interface CreateTeamUserInput {
  fullName: string;
  email: string;
  password: string;
  role: "user" | "admin" | "finanzas" | "operador";
  /** Sucursales asignadas. Vacío = todas las sucursales. */
  locationIds?: string[];
  /** Accesos personalizados (rutas del panel izquierdo). */
  allowedSections?: string[];
  /** Otorgar acceso al Panel SaaS (solo admin). */
  saasPanel?: boolean;
}

// Surface the real error message returned by an Edge Function body. supabase-js
// wraps non-2xx responses in a generic error; the JSON body lives in `.context`.
async function invokeFunctionError(
  error: unknown,
  fallback: string,
): Promise<string> {
  const context = (
    error as { context?: { json?: () => Promise<{ error?: string }> } }
  )?.context;
  if (context && typeof context.json === "function") {
    try {
      const body = await context.json();
      if (body?.error) return body.error;
    } catch {
      // ignore parse errors and use the fallback
    }
  }
  return fallback;
}

export async function createTeamUser(
  session: DemoSession,
  input: CreateTeamUserInput,
) {
  const companyId = requireCompanyId(session);
  const fullName = input.fullName.trim();
  const email = input.email.trim();
  if (!fullName || !email) throw new Error("Ingresa nombre y correo.");
  if (input.password.length < 6)
    throw new Error("La contraseña debe tener al menos 6 caracteres.");

  const { data, error } = await supabase.functions.invoke("team-create-user", {
    body: {
      company_id: companyId,
      full_name: fullName,
      email,
      password: input.password,
      role: input.role,
      location_ids: input.locationIds ?? [],
      allowed_sections: input.allowedSections ?? [],
      saas_panel: input.role === "admin" ? !!input.saasPanel : false,
    },
  });
  if (error) {
    throw new Error(
      await invokeFunctionError(
        error,
        "No se pudo crear el usuario. Verifica que la Edge Function 'team-create-user' esté desplegada en Supabase.",
      ),
    );
  }
  return data;
}

export interface UpdateTeamUserInput {
  userId: string;
  fullName?: string;
  role?: "user" | "admin" | "finanzas" | "operador";
  isActive?: boolean;
  password?: string;
  /** undefined = no cambiar; lista (vacía = todas) = reemplaza las sucursales. */
  locationIds?: string[];
  /** undefined = no cambiar; lista = reemplaza los accesos del panel. */
  allowedSections?: string[];
  /** undefined = no cambiar; bool = otorga/quita el Panel SaaS (solo admin). */
  saasPanel?: boolean;
}

export async function updateTeamUser(
  session: DemoSession,
  input: UpdateTeamUserInput,
) {
  requireCompanyId(session);
  const password =
    input.password && input.password.length > 0 ? input.password : undefined;
  const { data, error } = await supabase.functions.invoke("team-manage-user", {
    body: {
      action: "update",
      target_user_id: input.userId,
      full_name: input.fullName,
      role: input.role,
      is_active: input.isActive,
      password,
      location_ids: input.locationIds,
      allowed_sections: input.allowedSections,
      saas_panel: input.saasPanel,
    },
  });
  if (error) {
    throw new Error(
      await invokeFunctionError(
        error,
        "No se pudo actualizar el usuario. Verifica que la Edge Function 'team-manage-user' esté desplegada en Supabase.",
      ),
    );
  }
  return data;
}

export async function deleteTeamUser(session: DemoSession, userId: string) {
  requireCompanyId(session);
  const { data, error } = await supabase.functions.invoke("team-manage-user", {
    body: { action: "delete", target_user_id: userId },
  });
  if (error) {
    throw new Error(
      await invokeFunctionError(
        error,
        "No se pudo eliminar el usuario. Verifica que la Edge Function 'team-manage-user' esté desplegada en Supabase.",
      ),
    );
  }
  return data;
}

export async function fetchTeam(companyId?: string): Promise<TeamMember[]> {
  const query = supabase
    .from("profiles")
    .select(
      "id, full_name, email, role, is_active, location_id, is_platform_admin, pin_hash, created_at",
    )
    .order("created_at", { ascending: true });
  const { data, error } = await (companyId
    ? query.eq("company_id", companyId)
    : query);
  if (error) throw error;
  const members = (data ?? []).map((row) => ({
    id: row.id,
    name: row.full_name,
    email: row.email,
    hasPin: Boolean((row as { pin_hash?: string | null }).pin_hash),
    role: row.role,
    active: row.is_active,
    locationId: (row as { location_id?: string | null }).location_id ?? null,
    locationIds: [] as string[],
    allowedSections: null as string[] | null,
    isPlatformAdmin: Boolean(
      (row as { is_platform_admin?: boolean | null }).is_platform_admin,
    ),
  }));

  // Accesos personalizados (columna nueva). Best-effort: si aún no existe, queda
  // en null (= usar defaults del rol) para no romper.
  try {
    let secQuery = supabase.from("profiles").select("id, allowed_sections");
    if (companyId) secQuery = secQuery.eq("company_id", companyId);
    const { data: secs, error: secErr } = await secQuery;
    if (secErr) throw secErr;
    const byId = new Map<string, string[] | null>();
    for (const row of secs ?? []) {
      byId.set(
        (row as { id: string }).id,
        (row as { allowed_sections?: string[] | null }).allowed_sections ??
          null,
      );
    }
    for (const member of members) {
      member.allowedSections = byId.get(member.id) ?? null;
    }
  } catch {
    /* columna aún no existe → defaults del rol */
  }

  // Sucursales asignadas (tabla nueva). Best-effort: si aún no existe, se cae al
  // campo único `location_id` para no romper.
  try {
    let plQuery = supabase
      .from("profile_locations")
      .select("profile_id, location_id");
    if (companyId) plQuery = plQuery.eq("company_id", companyId);
    const { data: pl, error: plErr } = await plQuery;
    if (plErr) throw plErr;
    const byProfile = new Map<string, string[]>();
    for (const row of pl ?? []) {
      const list = byProfile.get(row.profile_id) ?? [];
      list.push(row.location_id);
      byProfile.set(row.profile_id, list);
    }
    for (const member of members) {
      member.locationIds = byProfile.get(member.id) ?? [];
    }
  } catch {
    for (const member of members) {
      member.locationIds = member.locationId ? [member.locationId] : [];
    }
  }
  return members;
}

// Sucursales asignadas a un usuario. Best-effort: [] (= todas) si la tabla no
// existe todavía o el usuario no tiene asignaciones.
export async function fetchAssignedLocationIds(
  userId?: string,
): Promise<string[]> {
  if (!userId) return [];
  try {
    const { data, error } = await supabase
      .from("profile_locations")
      .select("location_id")
      .eq("profile_id", userId);
    if (error) throw error;
    return (data ?? []).map((row) => row.location_id as string);
  } catch {
    return [];
  }
}

// Accesos personalizados del panel para un usuario. Best-effort: null (= usar
// defaults del rol) si la columna aún no existe o no tiene lista propia.
export async function fetchAllowedSections(
  userId?: string,
): Promise<string[] | null> {
  if (!userId) return null;
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("allowed_sections")
      .eq("id", userId)
      .maybeSingle();
    if (error) throw error;
    const sections = (data as { allowed_sections?: string[] | null } | null)
      ?.allowed_sections;
    return sections && sections.length > 0 ? sections : null;
  } catch {
    return null;
  }
}

// ---- Módulo de empleados: checador por PIN, asistencia, faltas/vacaciones ----

export interface AttendanceEntry {
  id: string;
  profileId: string;
  locationId: string | null;
  checkInAt: string;
  checkOutAt: string | null;
  isLate: boolean;
  status: "open" | "closed";
}

export async function fetchAttendance(
  companyId?: string,
): Promise<AttendanceEntry[]> {
  let query = supabase
    .from("employee_attendance")
    .select(
      "id, profile_id, location_id, check_in_at, check_out_at, is_late, status",
    )
    .order("check_in_at", { ascending: false })
    .limit(200);
  if (companyId) query = query.eq("company_id", companyId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    profileId: row.profile_id,
    locationId: row.location_id,
    checkInAt: row.check_in_at,
    checkOutAt: row.check_out_at,
    isLate: row.is_late,
    status: row.status as "open" | "closed",
  }));
}

/** Registra el PIN capturado en el checador: hace check-in o check-out según
 * si el empleado dueño de ese PIN ya tiene una entrada abierta hoy. El PIN se
 * valida solo server-side (crypt/pgcrypto); nunca se compara en el cliente. */
export async function punchEmployee(
  pin: string,
  locationId?: string | null,
): Promise<{
  action: "check_in" | "check_out";
  profileId: string;
  fullName: string;
  isLate?: boolean;
  at: string;
}> {
  let tz = "UTC";
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    /* usa UTC por defecto */
  }
  const { data, error } = await supabase.rpc("punch_employee", {
    p_pin: pin,
    p_location_id: locationId ?? undefined,
    p_tz: tz,
  });
  if (error) throw error;
  const payload = (data ?? {}) as {
    action: "check_in" | "check_out";
    profile_id: string;
    full_name: string;
    is_late?: boolean;
    at: string;
  };
  return {
    action: payload.action,
    profileId: payload.profile_id,
    fullName: payload.full_name,
    isLate: payload.is_late,
    at: payload.at,
  };
}

export async function setEmployeePin(profileId: string, pin: string) {
  const { error } = await supabase.rpc("set_employee_pin", {
    p_profile_id: profileId,
    p_pin: pin,
  });
  if (error) throw error;
}

export async function clearEmployeePin(profileId: string) {
  const { error } = await supabase.rpc("clear_employee_pin", {
    p_profile_id: profileId,
  });
  if (error) throw error;
}

export interface TimeEvent {
  id: string;
  profileId: string;
  type: "absence" | "vacation";
  date: string;
  note: string | null;
  createdAt: string;
}

export async function fetchTimeEvents(
  companyId?: string,
): Promise<TimeEvent[]> {
  let query = supabase
    .from("employee_time_events")
    .select("id, profile_id, type, event_date, note, created_at")
    .order("event_date", { ascending: false })
    .limit(200);
  if (companyId) query = query.eq("company_id", companyId);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    profileId: row.profile_id,
    type: row.type as "absence" | "vacation",
    date: row.event_date,
    note: row.note,
    createdAt: row.created_at,
  }));
}

export async function createTimeEvent(
  session: DemoSession,
  input: {
    profileId: string;
    type: "absence" | "vacation";
    date: string;
    note?: string;
  },
) {
  const companyId = requireCompanyId(session);
  const { error } = await supabase.from("employee_time_events").insert({
    company_id: companyId,
    profile_id: input.profileId,
    type: input.type,
    event_date: input.date,
    note: input.note?.trim() || null,
    created_by: session.userId ?? null,
  } as never);
  if (error) throw error;
}

export async function deleteTimeEvent(id: string) {
  const { error } = await supabase
    .from("employee_time_events")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

// ---- Backup (export real) ----

export async function buildBackupExport(companyId?: string) {
  const [catalog, sales] = await Promise.all([
    fetchCompanyCatalog(companyId),
    fetchSales(companyId),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    companyId: companyId ?? null,
    counts: {
      products: catalog.products.length,
      categories: catalog.categories.length,
      customers: catalog.customers.length,
      suppliers: catalog.suppliers.length,
      sales: sales.length,
    },
    products: catalog.products,
    categories: catalog.categories,
    customers: catalog.customers,
    suppliers: catalog.suppliers,
    sales,
  };
}

// ---- Admin (plataforma) ----

export interface AdminCompany {
  id: string;
  name: string;
  fiscalId: string | null;
  address: string | null;
  planId: string | null;
  planName: string;
  status: string;
  expiresAt: string | null;
  usersCount: number;
  isDemo: boolean;
  createdAt: string;
}

export interface AdminStats {
  totalCompanies: number;
  active: number;
  trial: number;
  expired: number;
  users: number;
  mrr: number;
  byPlan: { name: string; value: number }[];
  byStatus: { name: string; value: number }[];
  growth: { m: string; v: number }[];
}

export async function fetchAdminCompanies(): Promise<AdminCompany[]> {
  // Antes de listar, pasa a "expired" cualquier trial cuya fecha ya venció
  // (ver expire_overdue_trials en el instalador). No pasa nada si falla o si
  // quien llama no es Super Admin: la RPC simplemente no hace nada en ese
  // caso, y el listado se sigue mostrando con lo que ya había.
  try {
    await supabase.rpc("expire_overdue_trials");
  } catch {
    // ignorar: el listado se muestra igual con lo que ya había
  }

  const { data: companies, error } = await supabase
    .from("companies")
    .select(
      "id, name, fiscal_id, address, subscription_status, expires_at, plan_id, is_demo_data, created_at",
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  if (error) throw error;

  const { data: plans } = await supabase
    .from("subscription_plans")
    .select("id, name");
  const planName = new Map((plans ?? []).map((plan) => [plan.id, plan.name]));

  const { data: profiles } = await supabase
    .from("profiles")
    .select("company_id");
  const usersByCompany = new Map<string, number>();
  (profiles ?? []).forEach((profile) => {
    if (profile.company_id) {
      usersByCompany.set(
        profile.company_id,
        (usersByCompany.get(profile.company_id) ?? 0) + 1,
      );
    }
  });

  return (companies ?? []).map((company) => ({
    id: company.id,
    name: company.name,
    fiscalId: company.fiscal_id,
    address: company.address ?? null,
    planId: company.plan_id ?? null,
    planName: company.plan_id
      ? (planName.get(company.plan_id) ?? "—")
      : "Sin plan",
    status: company.subscription_status,
    expiresAt: company.expires_at,
    usersCount: usersByCompany.get(company.id) ?? 0,
    isDemo: company.is_demo_data,
    createdAt: company.created_at,
  }));
}

export interface CreateCompanyInput {
  name: string;
  fiscalId?: string;
  address?: string;
  planId?: string;
  status?: string;
  ownerEmail?: string;
  ownerPassword?: string;
  ownerFullName?: string;
}

export interface AdminCompanyUpdate {
  name?: string;
  fiscalId?: string | null;
  address?: string | null;
  status?: string;
  planId?: string | null;
  expiresAt?: string | null;
}

// Platform super admin edits any store's company record (RLS allows platform admin).
export async function adminUpdateCompany(
  companyId: string,
  input: AdminCompanyUpdate,
) {
  const { error } = await supabase
    .from("companies")
    .update({
      name: input.name?.trim() || undefined,
      fiscal_id:
        input.fiscalId === undefined
          ? undefined
          : input.fiscalId?.trim() || null,
      address:
        input.address === undefined ? undefined : input.address?.trim() || null,
      subscription_status: input.status,
      plan_id: input.planId === undefined ? undefined : input.planId || null,
      expires_at:
        input.expiresAt === undefined
          ? undefined
          : input.expiresAt
            ? new Date(input.expiresAt).toISOString()
            : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", companyId);
  if (error) throw error;
}

// Catálogo global de métodos de pago por país (lectura: cualquier autenticado; escritura: platform admin)
export interface CountryPaymentMethodRow {
  id: string;
  countryCode: string;
  methodCode: string;
  label: string;
  kind: string;
  description: string | null;
  recommended: boolean;
  sortOrder: number;
  isActive: boolean;
}

export async function fetchCountryPaymentMethods(
  countryCode?: string,
): Promise<CountryPaymentMethodRow[]> {
  let query = supabase
    .from("country_payment_methods")
    .select(
      "id, country_code, method_code, label, kind, description, recommended, sort_order, is_active",
    )
    .order("country_code", { ascending: true })
    .order("sort_order", { ascending: true });
  if (countryCode) query = query.eq("country_code", countryCode);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    countryCode: row.country_code,
    methodCode: row.method_code,
    label: row.label,
    kind: row.kind,
    description: row.description,
    recommended: row.recommended,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  }));
}

export interface CountryPaymentMethodUpsert {
  id?: string;
  countryCode: string;
  methodCode: string;
  label: string;
  kind: string;
  description?: string | null;
  recommended?: boolean;
  sortOrder?: number;
  isActive?: boolean;
}

export async function upsertCountryPaymentMethod(
  input: CountryPaymentMethodUpsert,
) {
  const payload = {
    country_code: input.countryCode.trim().toUpperCase(),
    method_code: input.methodCode.trim(),
    label: input.label.trim(),
    kind: input.kind,
    description: input.description ?? null,
    recommended: input.recommended ?? false,
    sort_order: input.sortOrder ?? 0,
    is_active: input.isActive ?? true,
  };
  if (input.id) {
    const { error } = await supabase
      .from("country_payment_methods")
      .update(payload)
      .eq("id", input.id);
    if (error) throw error;
    return input.id;
  }
  const { data, error } = await supabase
    .from("country_payment_methods")
    .insert(payload)
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

export async function deleteCountryPaymentMethod(id: string) {
  const { error } = await supabase
    .from("country_payment_methods")
    .delete()
    .eq("id", id);
  if (error) throw error;
}

// Soft-deletes a store and deactivates its users so it can no longer be accessed.
export async function adminDeleteCompany(companyId: string) {
  const now = new Date().toISOString();
  const { error } = await supabase
    .from("companies")
    .update({ deleted_at: now, updated_at: now })
    .eq("id", companyId);
  if (error) throw error;
  await supabase
    .from("profiles")
    .update({ is_active: false })
    .eq("company_id", companyId);
}

// Platform super admin creates a new store (and optionally its first admin login).
export async function createCompany(input: CreateCompanyInput) {
  const name = input.name.trim();
  if (!name) throw new Error("Ingresa el nombre de la tienda.");
  const ownerEmail = input.ownerEmail?.trim();
  if (ownerEmail && (!input.ownerPassword || input.ownerPassword.length < 6)) {
    throw new Error(
      "Si creas un administrador, la contraseña debe tener al menos 6 caracteres.",
    );
  }
  const { data, error } = await supabase.functions.invoke(
    "admin-create-company",
    {
      body: {
        name,
        fiscal_id: input.fiscalId?.trim() || null,
        plan_id: input.planId || null,
        subscription_status: input.status || "active",
        owner_email: ownerEmail || undefined,
        owner_password: ownerEmail ? input.ownerPassword : undefined,
        owner_full_name: input.ownerFullName?.trim() || undefined,
      },
    },
  );
  if (error) {
    throw new Error(
      await invokeFunctionError(
        error,
        "No se pudo crear la tienda. Verifica que la Edge Function 'admin-create-company' esté desplegada en Supabase.",
      ),
    );
  }
  // The Edge Function does not set address; persist it now if provided.
  const companyId = (data as { company?: { id?: string } } | null)?.company?.id;
  if (companyId && input.address?.trim()) {
    try {
      await adminUpdateCompany(companyId, { address: input.address });
    } catch {
      /* non-fatal: store was created; address can be set later from the edit dialog */
    }
  }
  return data;
}

export async function fetchAdminStats(): Promise<AdminStats> {
  const [companies, plans] = await Promise.all([
    fetchAdminCompanies(),
    fetchPlans(),
  ]);
  const planPriceById = new Map(plans.map((plan) => [plan.id, plan.price]));

  const active = companies.filter(
    (company) => company.status === "active",
  ).length;
  const trial = companies.filter(
    (company) => company.status === "trial",
  ).length;
  const expired = companies.filter(
    (company) => company.status === "expired" || company.status === "suspended",
  ).length;
  const users = companies.reduce((sum, company) => sum + company.usersCount, 0);
  const mrr = companies.reduce(
    (sum, company) =>
      company.status === "active" && company.planId
        ? sum + (planPriceById.get(company.planId) ?? 0)
        : sum,
    0,
  );

  const planMap = new Map<string, number>();
  for (const company of companies) {
    planMap.set(company.planName, (planMap.get(company.planName) ?? 0) + 1);
  }
  const statusLabels: Record<string, string> = {
    active: "Activa",
    trial: "Prueba",
    expired: "Vencida",
    suspended: "Suspendida",
  };
  const statusMap = new Map<string, number>();
  for (const company of companies) {
    const label = statusLabels[company.status] ?? company.status;
    statusMap.set(label, (statusMap.get(label) ?? 0) + 1);
  }

  const monthsLabels = [
    "Ene",
    "Feb",
    "Mar",
    "Abr",
    "May",
    "Jun",
    "Jul",
    "Ago",
    "Sep",
    "Oct",
    "Nov",
    "Dic",
  ];
  const now = new Date();
  const growth = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
    const prefix = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
    const value = companies.filter((company) =>
      company.createdAt.startsWith(prefix),
    ).length;
    return { m: monthsLabels[date.getMonth()], v: value };
  });

  return {
    totalCompanies: companies.length,
    active,
    trial,
    expired,
    users,
    mrr,
    byPlan: Array.from(planMap, ([name, value]) => ({ name, value })),
    byStatus: Array.from(statusMap, ([name, value]) => ({ name, value })),
    growth,
  };
}
