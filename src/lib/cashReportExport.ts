import type { CashReportRow } from "@/services/appData";

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function rangeStamp(from?: string, to?: string): string {
  if (from && to) return `${from}_a_${to}`;
  if (from) return `desde_${from}`;
  if (to) return `hasta_${to}`;
  return "todo";
}

const CLASSIFICATION_LABELS: Record<string, string> = {
  cuadrado: "Cuadrado",
  faltante: "Faltante",
  sobrante: "Sobrante",
};

// Exporta el reporte de cortes de caja autorizados a un Excel real (.xlsx),
// como reemplazo directo de la hoja "Datos" que antes se llenaba a mano.
// SheetJS se carga de forma diferida (solo al exportar).
export async function exportCashReportToExcel(
  rows: CashReportRow[],
  nameOf: (id: string | null) => string,
  range: { from?: string; to?: string },
): Promise<void> {
  const XLSX = await import("xlsx");
  const sheetRows = rows.map((row) => ({
    Fecha: row.closedAt ? row.closedAt.slice(0, 10) : "",
    Sucursal: row.locationName,
    Caja: row.tillName ?? "",
    Cajero: nameOf(row.openedBy),
    Apertura: round2(row.openingAmount),
    Esperado: round2(row.expectedAmount),
    Real: round2(row.realAmount ?? 0),
    Diferencia: round2(row.difference ?? 0),
    Estado: row.classification
      ? (CLASSIFICATION_LABELS[row.classification] ?? row.classification)
      : "",
    Tarjeta: round2(row.cardTotal),
    Transferencia: round2(row.transferTotal),
    Otros: round2(row.otherTotal),
  }));

  const ws = XLSX.utils.json_to_sheet(sheetRows);
  ws["!cols"] = [
    { wch: 12 },
    { wch: 18 },
    { wch: 10 },
    { wch: 22 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
    { wch: 14 },
    { wch: 12 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Cortes de caja");
  XLSX.writeFile(wb, `cortes_de_caja_${rangeStamp(range.from, range.to)}.xlsx`);
}
