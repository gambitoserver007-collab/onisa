// Perfiles de tipo de negocio (rubro). El perfil que elige la empresa activa o no
// ciertas capacidades de la app. Es la "cara" de la estrategia: un mismo motor de
// retail, opciones a medida por rubro.
//
// IMPORTANTE: muchos rubros comparten capacidades. El perfil NO es uno por tienda
// posible, sino un rubro reconocible que se mapea a un conjunto de capacidades.
// `usesVariants` controla si el editor de producto ofrece variantes (talla, color…)
// y si el POS pide elegir variante. Por defecto la empresa es 'general' (sin
// variantes), así que las tiendas existentes siguen exactamente igual hasta que
// elijan un rubro que las use.
//
// Capacidades futuras (placeholders por ahora, se activan en fases siguientes):
//   - serie / IMEI  → electrónica, celulares (Fase 3)
//   - lote + vencimiento → farmacia, perecederos (Fase 2)

export interface BusinessProfile {
  id: string;
  label: string;
  description: string;
  /** Grupo para agrupar el menú. */
  group: string;
  /** Este rubro maneja variantes de producto (talla, color, etc.). */
  usesVariants: boolean;
  /** Atributos sugeridos al crear variantes en este rubro (precarga la UI). */
  suggestedAttributes: string[];
}

const TALLA_COLOR = ["Talla", "Color"];
const COLOR_CAP = ["Color", "Capacidad"];

export const BUSINESS_PROFILES: Record<string, BusinessProfile> = {
  // --- Retail general (sin variantes) ---
  general: {
    id: "general",
    label: "Retail general",
    description: "Tienda que vende productos sueltos de un catálogo.",
    group: "General",
    usesVariants: false,
    suggestedAttributes: [],
  },
  minimarket: {
    id: "minimarket",
    label: "Minimarket / Abarrotes",
    description: "Bodega, minimarket, autoservicio.",
    group: "General",
    usesVariants: false,
    suggestedAttributes: [],
  },
  licoreria: {
    id: "licoreria",
    label: "Licorería / Bebidas",
    description: "Licorería, distribuidora de bebidas, cigarrería.",
    group: "General",
    usesVariants: false,
    suggestedAttributes: [],
  },
  bazar: {
    id: "bazar",
    label: "Bazar / Variedades / Regalos",
    description: "Bazar, variedades, regalos, souvenirs.",
    group: "General",
    usesVariants: false,
    suggestedAttributes: [],
  },
  papeleria: {
    id: "papeleria",
    label: "Papelería / Librería",
    description: "Papelería, librería, útiles.",
    group: "General",
    usesVariants: false,
    suggestedAttributes: [],
  },
  jugueteria: {
    id: "jugueteria",
    label: "Juguetería",
    description: "Juguetes y artículos para niños.",
    group: "General",
    usesVariants: false,
    suggestedAttributes: [],
  },
  ferreteria: {
    id: "ferreteria",
    label: "Ferretería / Construcción",
    description: "Ferretería, materiales de construcción.",
    group: "General",
    usesVariants: false,
    suggestedAttributes: [],
  },
  petshop: {
    id: "petshop",
    label: "Pet shop / Agroveterinaria",
    description: "Mascotas, alimentos y agro-insumos.",
    group: "General",
    usesVariants: false,
    suggestedAttributes: [],
  },
  distribuidora: {
    id: "distribuidora",
    label: "Distribuidora / Mayorista",
    description: "Venta al por mayor.",
    group: "General",
    usesVariants: false,
    suggestedAttributes: [],
  },

  // --- Con variantes (talla, color, capacidad…) ---
  ropa: {
    id: "ropa",
    label: "Ropa / Boutique",
    description: "Prendas con variantes de talla y color.",
    group: "Con variantes",
    usesVariants: true,
    suggestedAttributes: TALLA_COLOR,
  },
  calzado: {
    id: "calzado",
    label: "Calzado / Zapatería",
    description: "Calzado con variantes de talla y color.",
    group: "Con variantes",
    usesVariants: true,
    suggestedAttributes: TALLA_COLOR,
  },
  deportiva: {
    id: "deportiva",
    label: "Tienda deportiva",
    description: "Ropa y calzado deportivo.",
    group: "Con variantes",
    usesVariants: true,
    suggestedAttributes: TALLA_COLOR,
  },
  accesorios: {
    id: "accesorios",
    label: "Accesorios / Bisutería",
    description: "Bolsos, gorras, bisutería por color.",
    group: "Con variantes",
    usesVariants: true,
    suggestedAttributes: ["Color"],
  },
  electronica: {
    id: "electronica",
    label: "Electrónica / Computación",
    description: "Electrónica y computación (color, capacidad).",
    group: "Con variantes",
    usesVariants: true,
    suggestedAttributes: COLOR_CAP,
  },
  celulares: {
    id: "celulares",
    label: "Celulares / Telefonía",
    description: "Celulares por color y capacidad.",
    group: "Con variantes",
    usesVariants: true,
    suggestedAttributes: COLOR_CAP,
  },
  electrodomesticos: {
    id: "electrodomesticos",
    label: "Electrodomésticos",
    description: "Línea blanca y electrodomésticos.",
    group: "Con variantes",
    usesVariants: true,
    suggestedAttributes: ["Color"],
  },

  // --- Farmacia / perecederos (lote + vencimiento llega en una fase próxima) ---
  farmacia: {
    id: "farmacia",
    label: "Farmacia / Botica",
    description: "Botica, droguería.",
    group: "Farmacia / Perecederos",
    usesVariants: false,
    suggestedAttributes: [],
  },
  perecederos: {
    id: "perecederos",
    label: "Minimarket con perecederos",
    description: "Perecederos y alimentos con vencimiento.",
    group: "Farmacia / Perecederos",
    usesVariants: false,
    suggestedAttributes: [],
  },
};

export const DEFAULT_BUSINESS_TYPE = "general";

export function getBusinessProfile(businessType?: string | null): BusinessProfile {
  return BUSINESS_PROFILES[businessType ?? ""] ?? BUSINESS_PROFILES[DEFAULT_BUSINESS_TYPE];
}

export function getAllBusinessProfiles(): BusinessProfile[] {
  return Object.values(BUSINESS_PROFILES);
}

// Ejemplo de nombre de producto para el placeholder del editor, según el rubro
// (para que una tienda de ropa no vea "Ej. Arroz 750g", etc.).
const SAMPLE_PRODUCT_NAMES: Record<string, string> = {
  general: "Ej. Producto",
  minimarket: "Ej. Arroz 750g",
  licoreria: "Ej. Cerveza 330ml",
  bazar: "Ej. Juego de vasos",
  papeleria: "Ej. Cuaderno A4",
  jugueteria: "Ej. Carro a control remoto",
  ferreteria: "Ej. Taladro 600W",
  petshop: "Ej. Alimento para perro 3kg",
  distribuidora: "Ej. Caja de fideos x24",
  ropa: "Ej. Polo manga corta",
  calzado: "Ej. Zapatilla running",
  deportiva: "Ej. Short deportivo",
  accesorios: "Ej. Gorra / Mochila",
  electronica: "Ej. Audífonos Bluetooth",
  celulares: "Ej. Smartphone 128 GB",
  electrodomesticos: "Ej. Licuadora 600W",
  farmacia: "Ej. Paracetamol 500 mg",
  perecederos: "Ej. Yogurt 1L",
};

export function getSampleProductName(businessType?: string | null): string {
  return SAMPLE_PRODUCT_NAMES[businessType ?? ""] ?? "Ej. nombre del producto";
}
