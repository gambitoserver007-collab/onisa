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
  /** % de comisión de pago con tarjeta (fracción, ej. 0.03 = 3%), para la calculadora de precio. */
  cardCommissionRate?: number;
  /** Umbral de stock bajo por defecto (unidades) para productos sin uno propio. */
  lowStockThresholdDefault?: number;
  /** Si el programa de puntos de lealtad está activo para esta empresa. */
  loyaltyEnabled?: boolean;
  /** Cuánto vale 1 punto en la moneda de la empresa (ej. 1 = $1 por punto). */
  loyaltyPointValue?: number;
  /** Cuánto gasto (en la moneda de la empresa) equivale a 1 punto ganado. */
  loyaltyEarnRate?: number;
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

export type ProductType = "standard" | "combo" | "service";

export interface Product {
  id: string;
  categoryId?: string;
  /** Estándar (normal), Combo (se arma de otros productos al vender, sin
   * stock propio) o Servicio (como Estándar pero sin manejar inventario).
   * Fijo desde que se crea el producto. */
  productType: ProductType;
  /** Proveedor habitual (a quién se le compra). null = sin proveedor asignado. */
  supplierId?: string | null;
  name: string;
  category: string;
  barcode: string;
  /** SKU / código interno, distinto del código de barras. */
  sku?: string;
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
  /** Umbral propio de alerta de stock bajo (unidades). null = usa el default de la empresa. */
  lowStockThreshold?: number | null;
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
  /** Saldo de puntos de lealtad acumulados, canjeables como descuento en el POS. */
  loyaltyPoints?: number;
  /** Límite de crédito asignado por el admin. 0 = sin crédito habilitado. */
  creditLimit?: number;
  /** Cuánto debe actualmente el cliente (nunca puede superar creditLimit). */
  creditBalance?: number;
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
  /** Id del perfil que registró la venta (para ventas por empleado). */
  createdBy?: string | null;
  items: {
    productId: string;
    name: string;
    qty: number;
    price: number;
    variantLabel?: string;
  }[];
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
