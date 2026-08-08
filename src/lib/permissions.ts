// Role-based access for store team members.
//
//  - "admin"    = Administrador de tienda (dueño / encargado): acceso total a su tienda.
//  - "finanzas" = Finanzas: reportes, caja, compras, ventas, devoluciones, contactos.
//  - "user"     = Cajero/a: vender (POS), caja, ventas, devoluciones, clientes.
//  - "operador" = Operador: inventario, productos, compras (operación de almacén).
//
// Además del rol, el dueño puede otorgar accesos PERSONALIZADOS por usuario
// (qué secciones del panel izquierdo ve). Si un usuario tiene una lista propia
// (`allowed_sections`), esa manda; si no, se usan los accesos por defecto del rol.
//
// El Super Admin de plataforma (dueño del SaaS) se maneja aparte con
// `session.isSuperAdmin` y es el único que entra al panel /admin.

export type StoreRole = "admin" | "finanzas" | "user" | "operador";

export const STORE_ROLE_LABELS: Record<StoreRole, string> = {
  admin: "Administrador de tienda",
  finanzas: "Finanzas",
  user: "Cajero",
  operador: "Operador",
};

export function normalizeStoreRole(role?: string | null): StoreRole {
  if (
    role === "admin" ||
    role === "finanzas" ||
    role === "user" ||
    role === "operador"
  )
    return role;
  return "user"; // privilegio mínimo por defecto
}

// Catálogo de secciones del panel izquierdo que el dueño puede otorgar. La clave
// es la ruta (estable). Se usa tanto en la pantalla de Usuarios (casillas) como
// en el chequeo de acceso.
export interface SectionDef {
  key: string;
  label: string;
  group: string;
}

export const GRANTABLE_SECTIONS: SectionDef[] = [
  { key: "/dashboard", label: "Dashboard", group: "Principal" },
  { key: "/pos", label: "Punto de venta", group: "Principal" },
  { key: "/ventas", label: "Ventas", group: "Operaciones" },
  { key: "/devoluciones", label: "Devoluciones", group: "Operaciones" },
  { key: "/compras", label: "Compras", group: "Operaciones" },
  { key: "/caja", label: "Caja", group: "Operaciones" },
  { key: "/promociones", label: "Promociones", group: "Operaciones" },
  { key: "/productos", label: "Productos", group: "Inventario" },
  { key: "/inventario", label: "Control de Stock", group: "Inventario" },
  { key: "/categorias", label: "Categorías", group: "Inventario" },
  { key: "/etiquetas", label: "Unidades", group: "Inventario" },
  { key: "/clientes", label: "Clientes", group: "Contactos" },
  { key: "/proveedores", label: "Proveedores", group: "Contactos" },
  { key: "/reportes", label: "Reportes", group: "Análisis" },
  { key: "/ganancias", label: "Ganancias", group: "Análisis" },
  { key: "/perfil", label: "Mi Perfil", group: "Ajustes" },
  { key: "/puntos-de-venta", label: "Sucursales", group: "Ajustes" },
  { key: "/usuarios", label: "Usuarios", group: "Ajustes" },
  { key: "/suscripcion", label: "Mi Suscripción", group: "Ajustes" },
  { key: "/configuracion", label: "Configuración", group: "Ajustes" },
  { key: "/backup", label: "Respaldo", group: "Ajustes" },
];

const ALL_SECTION_KEYS = GRANTABLE_SECTIONS.map((s) => s.key);

// Accesos que quedan PRE-MARCADOS al elegir cada rol (el dueño los puede ajustar).
export const ROLE_DEFAULT_SECTIONS: Record<StoreRole, string[]> = {
  admin: [...ALL_SECTION_KEYS],
  finanzas: [
    "/dashboard",
    "/ventas",
    "/devoluciones",
    "/compras",
    "/caja",
    "/productos",
    "/inventario",
    "/clientes",
    "/proveedores",
    "/reportes",
    "/ganancias",
    "/perfil",
  ],
  user: [
    "/dashboard",
    "/pos",
    "/ventas",
    "/devoluciones",
    "/caja",
    "/productos",
    "/inventario",
    "/clientes",
    "/perfil",
  ],
  operador: [
    "/dashboard",
    "/productos",
    "/inventario",
    "/categorias",
    "/etiquetas",
    "/compras",
    "/proveedores",
    "/perfil",
  ],
};

// Qué roles pueden abrir cada ruta cuando NO hay accesos personalizados. El admin
// de tienda siempre pasa (cortocircuito en canAccessPath).
const ROUTE_ACCESS: Record<string, StoreRole[]> = {
  "/dashboard": ["admin", "finanzas", "user", "operador"],
  "/pos": ["admin", "user"],
  "/ventas": ["admin", "finanzas", "user"],
  "/devoluciones": ["admin", "finanzas", "user"],
  "/compras": ["admin", "finanzas", "operador"],
  "/caja": ["admin", "finanzas", "user"],
  // Nota: no se agrega a GRANTABLE_SECTIONS (sin casilla propia en Usuarios)
  // a propósito -- por el prefix-match de allowedSections abajo, otorgar
  // "/caja" a un cajero también le abriría "/caja/revision" si esta ruta
  // tuviera su propia casilla independiente. Al no ser otorgable aparte,
  // solo entra por ROUTE_ACCESS (admin/finanzas), nunca por un acceso
  // personalizado mal entendido.
  "/caja/revision": ["admin", "finanzas"],
  // Mismo criterio que "/caja/revision" arriba: sin casilla propia en
  // GRANTABLE_SECTIONS, para no heredar acceso por el prefix-match de
  // "/caja".
  "/caja/reportes": ["admin", "finanzas"],
  "/promociones": ["admin"],
  "/productos": ["admin", "finanzas", "user", "operador"],
  "/inventario": ["admin", "finanzas", "user", "operador"],
  "/categorias": ["admin", "operador"],
  "/etiquetas": ["admin", "operador"],
  "/clientes": ["admin", "finanzas", "user"],
  "/proveedores": ["admin", "finanzas", "operador"],
  "/reportes": ["admin", "finanzas"],
  "/ganancias": ["admin", "finanzas"],
  "/perfil": ["admin", "finanzas", "user", "operador"],
  "/usuarios": ["admin"],
  "/puntos-de-venta": ["admin"],
  "/suscripcion": ["admin"],
  "/configuracion": ["admin"],
  "/backup": ["admin"],
};

// `allowedSections` (opcional): accesos personalizados del usuario. Si viene con
// elementos, manda sobre los defaults del rol.
export function canAccessPath(
  role: string | null | undefined,
  pathname: string,
  allowedSections?: string[] | null,
): boolean {
  const storeRole = normalizeStoreRole(role);

  // Mi Perfil siempre disponible para que nadie quede sin acceso a su cuenta.
  if (pathname === "/perfil" || pathname.startsWith("/perfil/")) return true;

  // Accesos personalizados: si el usuario tiene una lista propia, esa decide.
  if (allowedSections && allowedSections.length > 0) {
    return allowedSections.some(
      (section) => pathname === section || pathname.startsWith(section + "/"),
    );
  }

  // Sin lista propia → defaults por rol.
  if (storeRole === "admin") return true;
  const key = Object.keys(ROUTE_ACCESS)
    .filter((route) => pathname === route || pathname.startsWith(route + "/"))
    .sort((a, b) => b.length - a.length)[0];
  if (!key) return true; // ruta desconocida → no bloquear
  return ROUTE_ACCESS[key].includes(storeRole);
}

// Solo el administrador de tienda gestiona el catálogo (crear/editar/eliminar
// productos, categorías, etc.). Finanzas, Cajero y Operador solo ven.
export function canManageCatalog(role: string | null | undefined): boolean {
  return normalizeStoreRole(role) === "admin";
}

// Acceso al panel SaaS (todas las empresas, planes, MRR): solo Super Admin.
// Si el flag de plataforma aún no existe en la BD (undefined), se mantiene el
// comportamiento previo (admin de tienda) para no perder acceso durante el rollout.
export function canAccessSaaS(
  session: { isSuperAdmin?: boolean; role?: string | null } | null | undefined,
): boolean {
  // Default seguro: solo el Super Admin de plataforma entra al panel /admin. Si el
  // flag no cargó (undefined por un fallo transitorio del perfil), NO se asume acceso
  // (antes caía a role==='admin', lo que habilitaba a cualquier dueño de tienda).
  return session?.isSuperAdmin === true;
}
