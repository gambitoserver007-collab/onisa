// Registro público activado por defecto (la tienda se vende con auto-registro).
// Se puede apagar con VITE_ENABLE_PUBLIC_REGISTRATION="false".
export const PUBLIC_REGISTRATION_ENABLED =
  import.meta.env.VITE_ENABLE_PUBLIC_REGISTRATION !== "false";

// Acceso demo (Super Admin de solo lectura) apagado por defecto.
// Se puede encender con VITE_SHOW_DEMO_ACCESS="true" si se quiere una demo de ventas.
export const SHOW_DEMO_ACCESS = import.meta.env.VITE_SHOW_DEMO_ACCESS === "true";
