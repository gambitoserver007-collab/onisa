// Rango de fecha por defecto para pantallas de reportes/historial -- antes
// varias pedían "todo" (sin fecha) por defecto, lo que hacía que las
// consultas/RPC de ventas recorrieran el historial completo de la empresa
// (auditoría de rendimiento 2026-09). El usuario puede seguir ensanchando
// el rango con sus propios inputs de fecha.

/** yyyy-mm-dd en hora LOCAL (no UTC) -- toISOString() correría la fecha un
 * día en zonas con offset negativo cerca de la medianoche. */
export function toDateInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");

  return `${y}-${m}-${day}`;
}

export function defaultDateRange(days = 30): { from: string; to: string } {
  const to = new Date();
  const from = new Date();

  from.setDate(from.getDate() - (days - 1));

  return { from: toDateInput(from), to: toDateInput(to) };
}
