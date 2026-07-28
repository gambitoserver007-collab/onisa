import type { Product } from "@/types";

/**
 * Visual identity for a product tile.
 *
 * Until real photography is available (generated via the image MCP and stored
 * under /img/products), every product still gets an intentional, branded look:
 * a pastel gradient derived from its category and an emoji derived from its
 * name (or category as fallback). This keeps catalogs feeling "complete" and
 * never shows a bland grey placeholder.
 */
export interface ProductVisual {
  emoji: string;
  /** Tailwind gradient classes for the tile background. */
  gradient: string;
}

// Keyword → emoji. Matched case-insensitively against the product name.
const NAME_EMOJI: { match: string; emoji: string }[] = [
  { match: "arroz", emoji: "🍚" },
  { match: "azúcar", emoji: "🧂" },
  { match: "azucar", emoji: "🧂" },
  { match: "aceite", emoji: "🫒" },
  { match: "fideos", emoji: "🍝" },
  { match: "atún", emoji: "🥫" },
  { match: "atun", emoji: "🥫" },
  { match: "leche", emoji: "🥛" },
  { match: "yogurt", emoji: "🥛" },
  { match: "coca", emoji: "🥤" },
  { match: "kola", emoji: "🥤" },
  { match: "gaseosa", emoji: "🥤" },
  { match: "agua", emoji: "💧" },
  { match: "cerveza", emoji: "🍺" },
  { match: "detergente", emoji: "🧴" },
  { match: "jabón", emoji: "🧼" },
  { match: "jabon", emoji: "🧼" },
  { match: "papel", emoji: "🧻" },
  { match: "shampoo", emoji: "🧴" },
  { match: "dental", emoji: "🪥" },
  { match: "plátano", emoji: "🍌" },
  { match: "platano", emoji: "🍌" },
  { match: "tomate", emoji: "🍅" },
  { match: "manzana", emoji: "🍎" },
  { match: "naranja", emoji: "🍊" },
  { match: "papas", emoji: "🥔" },
  { match: "lays", emoji: "🍟" },
  { match: "galleta", emoji: "🍪" },
  { match: "oreo", emoji: "🍪" },
  { match: "chocolate", emoji: "🍫" },
  { match: "pan", emoji: "🥖" },
  { match: "huevo", emoji: "🥚" },
  { match: "café", emoji: "☕" },
  { match: "cafe", emoji: "☕" },
  { match: "queso", emoji: "🧀" },
  { match: "pollo", emoji: "🍗" },
];

const CATEGORY_VISUAL: Record<string, ProductVisual> = {
  Abarrotes: { emoji: "🛒", gradient: "from-amber-50 to-orange-100" },
  Lácteos: { emoji: "🥛", gradient: "from-sky-50 to-blue-100" },
  Bebidas: { emoji: "🥤", gradient: "from-cyan-50 to-teal-100" },
  Limpieza: { emoji: "🧼", gradient: "from-teal-50 to-emerald-100" },
  "Cuidado Personal": { emoji: "🧴", gradient: "from-violet-50 to-fuchsia-100" },
  "Frutas y Verduras": { emoji: "🥦", gradient: "from-lime-50 to-green-100" },
  Snacks: { emoji: "🍪", gradient: "from-orange-50 to-amber-100" },
  Panadería: { emoji: "🥖", gradient: "from-yellow-50 to-amber-100" },
};

const DEFAULT_VISUAL: ProductVisual = { emoji: "🛍️", gradient: "from-slate-50 to-slate-100" };

/**
 * Real product photos keyed by barcode (stable across data sources — works
 * whether the product comes from Supabase or the demo catalog). Only add an
 * entry once the file actually exists under public/img/products to avoid
 * broken images; products without an entry fall back to the emoji tile.
 */
const PRODUCT_IMAGES: Record<string, string> = {
  "7750001000011": "/img/products/p1.png", // Arroz Costeño 750g
  "7750001000028": "/img/products/p2.png", // Azúcar Rubia 1kg
  "7750001000035": "/img/products/p3.png", // Aceite Primor 1L
  "7750001000042": "/img/products/p4.png", // Fideos Don Vittorio 500g
  "7750001000059": "/img/products/p5.png", // Atún Florida
  "7750001000066": "/img/products/p6.png", // Leche Gloria 400g
  "7750001000073": "/img/products/p7.png", // Yogurt Gloria 1L
  "7750001000080": "/img/products/p8.png", // Coca Cola 1.5L
  "7750001000097": "/img/products/p9.png", // Inca Kola 1.5L
  "7750001000103": "/img/products/p10.png", // Agua San Luis
  "7750001000110": "/img/products/p11.png", // Detergente Bolívar
  "7750001000127": "/img/products/p12.jpg", // Papel Higiénico
  "7750001000134": "/img/products/p13.png", // Shampoo
  "7750001000141": "/img/products/p14.png", // Pasta Dental
  "7750001000158": "/img/products/p15.png", // Plátano kg
  "7750001000165": "/img/products/p16.png", // Tomate kg
  "7750001000172": "/img/products/p17.png", // Papas Lays
  "7750001000189": "/img/products/p18.png", // Galletas Oreo
  "7750001000196": "/img/products/p19.png", // Pan Francés
};

export function getProductVisual(product: Pick<Product, "name" | "category">): ProductVisual {
  const categoryVisual = CATEGORY_VISUAL[product.category] ?? DEFAULT_VISUAL;
  const name = product.name.toLowerCase();
  const byName = NAME_EMOJI.find((entry) => name.includes(entry.match));
  return {
    emoji: byName?.emoji ?? categoryVisual.emoji,
    gradient: categoryVisual.gradient,
  };
}

/** Real photo URL when available, else null (callers render the branded tile). */
export function getProductImage(product: Pick<Product, "image" | "barcode">): string | null {
  if (product.image?.trim()) return product.image;
  return PRODUCT_IMAGES[product.barcode] ?? null;
}
