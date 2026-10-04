// Impresión directa a impresoras de tickets térmicas vía QZ Tray
// (https://qz.io), sin pasar por el diálogo de impresión del navegador.
//
// Por qué: window.print() SIEMPRE abre el diálogo nativo del navegador --
// ningún sitio web puede elegir la impresora ni imprimir en silencio sin
// eso, es una restricción de seguridad del navegador, no de esta app. QZ
// Tray es un programa que el dueño instala UNA VEZ en la PC del punto de
// venta (https://qz.io/download); corre como servicio local y expone un
// WebSocket (wss://localhost:8181) al que esta página se conecta para
// mandarle el ticket directo a la impresora, con el comando de corte real
// (GS V) -- la misma técnica que usan Square/Loyverse/etc.
//
// Sin impresora configurada (ticketQzPrinterName vacío) o si QZ Tray no
// está corriendo, el llamador debe caer de vuelta a window.print() --
// este módulo nunca sustituye esa ruta, solo la evita cuando es posible.
import qz from "qz-tray";

/** true la primera vez que esta pestaña conecta -- QZ Tray muestra un
 * diálogo de "¿permitir que este sitio imprima?" la primera vez (se puede
 * marcar "recordar"); después de eso las conexiones son silenciosas. */
export function isQzConnected(): boolean {
  try {
    return qz.websocket.isActive();
  } catch {
    return false;
  }
}

/** Conecta con QZ Tray si todavía no hay una conexión activa. Falla rápido
 * (sin reintentos) -- si QZ Tray no está instalado/corriendo, se resuelve
 * en rechazo en un par de segundos, no se queda colgado. */
export async function connectQz(): Promise<void> {
  if (isQzConnected()) return;

  await qz.websocket.connect({ retries: 0 });
}

/** Lista los nombres de impresoras que QZ Tray ve en el sistema --
 * para el selector de "Impresora de tickets" en Configuración. */
export async function listQzPrinters(): Promise<string[]> {
  await connectQz();
  const found = await qz.printers.find();

  return Array.isArray(found) ? found : [found];
}

// ---------------------------------------------------------------------
// Construcción del ticket en ESC/POS (comandos crudos de impresora).
// ---------------------------------------------------------------------

const ESC = "\x1B";
const GS = "\x1D";
const INIT = `${ESC}@`;
const BOLD_ON = `${ESC}E\x01`;
const BOLD_OFF = `${ESC}E\x00`;
const DOUBLE_ON = `${GS}!\x11`;
const DOUBLE_OFF = `${GS}!\x00`;
// Corte completo, soportado por la inmensa mayoría de impresoras de
// tickets compatibles con el estándar Epson ESC/POS.
const CUT = `${GS}V\x00`;

// Caracteres por línea a tamaño normal -- fuente A estándar de las
// impresoras térmicas (12x24pt): 32 columnas a 58mm, 48 a 80mm.
function charsForWidth(widthMm: 58 | 80): number {
  return widthMm === 58 ? 32 : 48;
}

function center(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  const left = Math.floor((width - text.length) / 2);

  return " ".repeat(left) + text;
}

function row(left: string, right: string, width: number): string {
  const space = width - left.length - right.length;

  if (space < 1) {
    const maxLeft = Math.max(0, width - right.length - 1);

    return left.slice(0, maxLeft) + " " + right;
  }

  return left + " ".repeat(space) + right;
}

function divider(width: number): string {
  return "-".repeat(width);
}

export interface EscPosReceiptInput {
  widthMm: 58 | 80;
  businessName: string;
  fiscalIdLabel: string;
  fiscalId: string;
  address: string | null;
  phone: string | null;
  taxName: string;
  date: string;
  time: string;
  cashierName: string | null;
  tillName: string | null;
  folio: string;
  customer: string;
  documentType: string;
  paymentMethod: string;
  items: { qty: number; name: string; variantLabel?: string; price: number }[];
  subtotal: number;
  tax: number;
  total: number;
  loyaltyEarned: number;
  loyaltyRedeemed: number;
  footerText: string | null;
  formatMoney: (value: number) => string;
  showFiscalInfo: boolean;
  showCashierName: boolean;
  showTill: boolean;
  showTaxBreakdown: boolean;
  showLoyaltyPoints: boolean;
  showPaymentMethod: boolean;
}

/** Arma el ticket completo como comandos ESC/POS -- mismos datos y mismo
 * orden que la versión impresa por CSS (ver ventas.$id.tsx), pero en
 * texto plano alineado por columnas (la impresora ya es monoespaciada) y
 * con el comando de corte real al final en vez de depender de @page. */
export function buildReceiptEscPos(input: EscPosReceiptInput): string[] {
  const w = charsForWidth(input.widthMm);
  const lines: string[] = [INIT];

  lines.push(
    BOLD_ON,
    DOUBLE_ON,
    center(input.businessName, w) + "\n",
    DOUBLE_OFF,
    BOLD_OFF,
  );

  if (input.showFiscalInfo) {
    lines.push(center(`${input.fiscalIdLabel} ${input.fiscalId}`, w) + "\n");
    if (input.address) lines.push(center(input.address, w) + "\n");
    if (input.phone) lines.push(center(`Tel. ${input.phone}`, w) + "\n");
  }

  lines.push(divider(w) + "\n");
  lines.push(row("Fecha", input.date, w) + "\n");
  lines.push(row("Hora", input.time, w) + "\n");
  if (input.showCashierName && input.cashierName) {
    lines.push(row("Cajero", input.cashierName, w) + "\n");
  }
  if (input.showTill && input.tillName) {
    lines.push(row("Caja", input.tillName, w) + "\n");
  }
  lines.push(row("Folio", input.folio, w) + "\n");

  lines.push(divider(w) + "\n");
  lines.push(row("Cliente", input.customer, w) + "\n");
  lines.push(row("Comprobante", input.documentType, w) + "\n");
  if (input.showPaymentMethod) {
    lines.push(row("Pago", input.paymentMethod, w) + "\n");
  }

  lines.push(divider(w) + "\n");
  lines.push(BOLD_ON, row("Cant. Descripcion", "Importe", w) + "\n", BOLD_OFF);
  for (const item of input.items) {
    const name =
      `${item.qty} ${item.name}` +
      (item.variantLabel ? ` (${item.variantLabel})` : "");
    lines.push(row(name, input.formatMoney(item.qty * item.price), w) + "\n");
  }

  lines.push(divider(w) + "\n");
  if (input.showTaxBreakdown) {
    lines.push(row("Subtotal", input.formatMoney(input.subtotal), w) + "\n");
    lines.push(row(input.taxName, input.formatMoney(input.tax), w) + "\n");
  }
  if (input.showLoyaltyPoints && input.loyaltyEarned > 0) {
    lines.push(row("Puntos ganados", `+${input.loyaltyEarned}`, w) + "\n");
  }
  if (input.showLoyaltyPoints && input.loyaltyRedeemed > 0) {
    lines.push(row("Puntos canjeados", `-${input.loyaltyRedeemed}`, w) + "\n");
  }
  lines.push(
    BOLD_ON,
    row("TOTAL", input.formatMoney(input.total), w) + "\n",
    BOLD_OFF,
  );

  lines.push(divider(w) + "\n");
  lines.push(center(input.footerText || "¡Gracias por su compra!", w) + "\n");

  lines.push("\n\n\n", CUT);

  return lines;
}

/** Manda el ticket a la impresora configurada, sin diálogo. Lanza si QZ
 * Tray no está corriendo o si falla el trabajo de impresión -- el
 * llamador debe atrapar el error y caer de vuelta a window.print(). */
export async function printReceiptViaQz(
  printerName: string,
  receipt: EscPosReceiptInput,
): Promise<void> {
  await connectQz();
  const config = qz.configs.create(printerName);
  const data = buildReceiptEscPos(receipt);

  await qz.print(config, data);
}
