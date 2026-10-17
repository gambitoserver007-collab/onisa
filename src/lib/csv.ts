// Celda de CSV segura para abrir en Excel/LibreOffice.
//
// Auditoría 2026-10 (puerta 14): los exports solo duplicaban las comillas.
// Una celda cuyo texto empieza con = + - @ (o tabulador / retorno) se evalúa
// como FÓRMULA al abrir el archivo aunque esté entre comillas, y ese texto
// puede venir de alguien con menos permisos que quien exporta (por ejemplo,
// el nombre del método de pago que escribe un cajero al vender). Se antepone
// un apóstrofo, que las hojas de cálculo muestran como texto.
type CsvValue = string | number | boolean | null | undefined;

const FORMULA_LEADER = /^[=+\-@\t\r]/;
// Un número legítimo (p. ej. una ganancia negativa "-12.50") no es una fórmula.
const PLAIN_NUMBER = /^[-+]?\d+(\.\d+)?([eE][-+]?\d+)?$/;

export function csvCell(value: CsvValue): string {
  let text = value === null || value === undefined ? "" : String(value);

  if (FORMULA_LEADER.test(text) && !PLAIN_NUMBER.test(text)) {
    text = `'${text}`;
  }

  return `"${text.replace(/"/g, '""')}"`;
}
