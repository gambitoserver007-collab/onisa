export type Role = "user" | "admin" | "finanzas" | "operador";

export interface DocumentType {
  name: string;
  chargesIva: boolean;
}

export interface DemoSession {
  userId?: string;
  companyId?: string;
  /** Punto de venta asignado al usuario (cajero); admin no lo necesita. */
  locationId?: string;
  email: string;
  role: Role;
  name: string;
  company?: string;
  countryCode?: string;
  currencyCode?: string;
  locale?: string;
  fiscalId?: string;
  fiscalIdLabel?: string;
  sampleFiscalId?: string;
  sampleAddress?: string;
  phone?: string;
  taxName?: string;
  taxRate?: number;
  isDemo: boolean;
  demoMode?: "none" | "read_only";
  demoAccountId?: string;
  /** Platform-level super admin (SaaS owner). Undefined when the DB flag isn't available yet. */
  isSuperAdmin?: boolean;
  /** Store logo (data URL or image URL) for this company. */
  logoUrl?: string;
  /** Receipt/invoice types configured for this store (POS dropdown + IVA rule). */
  documentTypes?: DocumentType[];
  /** Rubro de la empresa (perfil): 'general' | 'minimarket' | 'ropa' | 'electronica' | 'farmacia'… */
  businessType?: string;
}

export interface Product {
  id: string;
  categoryId?: string;
  /** Proveedor habitual (a quién se le compra). null = sin proveedor asignado. */
  supplierId?: string | null;
  name: string;
  category: string;
  barcode: string;
  cost: number;
  price: number;
  stock: number;
  unit: string;
  /** Optional product photo URL (e.g. /img/products/p1.jpg). */
  image?: string;
  /** Whether the price already includes tax (IVA). Defaults to true. */
  priceIncludesTax?: boolean;
  /** Si el producto maneja variantes (talla, color…). */
  hasVariants?: boolean;
  /** Nombres de los atributos de variante que usa el producto, ej. ["Talla","Color"]. */
  variantAttributes?: string[];
}

/** Una variante (SKU) de un producto: una combinación concreta de atributos. */
export interface ProductVariant {
  id: string;
  productId: string;
  /** Valores de atributos, ej. { Talla: "M", Color: "Rojo" }. */
  attributes: Record<string, string>;
  /** Texto legible de la combinación, ej. "Talla M / Color Rojo". */
  label: string;
  barcode?: string;
  sku?: string;
  /** Precio propio de la variante; si no, hereda el del producto. */
  priceOverride?: number | null;
  costOverride?: number | null;
  /** Precio efectivo (override o el del producto), para mostrar/usar. */
  price?: number;
}

export interface Category {
  id: string;
  name: string;
  active: boolean;
}
export interface Supplier {
  id: string;
  name: string;
  ruc: string;
  phone: string;
}
export interface Customer {
  id: string;
  name: string;
  doc: string;
  phone: string;
}
export interface Sale {
  id: string;
  databaseId?: string;
  date: string;
  /** Marca de tiempo completa (ISO) de la venta, para arqueos por turno. */
  createdAt?: string;
  type: string;
  method: string;
  customer: string;
  /** Id del cliente (para cruzar con su documento/cédula al buscar). */
  customerId?: string | null;
  items: { productId: string; name: string; qty: number; price: number; variantLabel?: string }[];
  subtotal: number;
  igv: number;
  total: number;
}
export interface Purchase {
  id: string;
  date: string;
  supplier: string;
  doc: string;
  total: number;
}
export interface Plan {
  id: string;
  name: string;
  price: number;
  products: number;
  users: number;
  sales: number;
  active: number;
}
export interface Company {
  id: string;
  name: string;
  ruc: string;
  plan: string;
  users: number;
  expires: string;
  status: "Trial" | "Activa" | "Suspendida" | "Vencida";
}

export interface CartItem {
  productId: string;
  name: string;
  qty: number;
  price: number;
  image?: string;
  priceIncludesTax?: boolean;
  /** Código/código de barras del producto, para buscar en el carrito. */
  barcode?: string;
  /** Variante elegida (si el producto maneja variantes). */
  variantId?: string;
  /** Texto legible de la variante, ej. "Talla M / Color Rojo". */
  variantLabel?: string;
}
