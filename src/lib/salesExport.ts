import type { Sale } from "@/types";

// Datos del negocio que aparecen en el encabezado del recibo / archivo.
export interface SalesExportSettings {
  businessName: string;
  fiscalIdLabel?: string;
  sampleFiscalId?: string;
  taxName?: string;
  address?: string;
  phone?: string;
}

// Qué partes del ticket se muestran, por sucursal (ver puntos-de-venta.tsx).
// Cuando no hay configuración para una sucursal (o la venta no trae
// locationId) se usan los mismos valores por defecto que la base de datos.
export interface TicketDisplaySettings {
  showFiscalInfo: boolean;
  showTaxBreakdown: boolean;
  showPaymentMethod: boolean;
  footerText: string | null;
}

const DEFAULT_TICKET_DISPLAY: TicketDisplaySettings = {
  showFiscalInfo: true,
  showTaxBreakdown: true,
  showPaymentMethod: true,
  footerText: null,
};

function resolveTicketDisplay(
  sale: Sale,
  byLocation?: Map<string, TicketDisplaySettings>,
): TicketDisplaySettings {
  if (!byLocation || !sale.locationId) return DEFAULT_TICKET_DISPLAY;
  return byLocation.get(sale.locationId) ?? DEFAULT_TICKET_DISPLAY;
}

// Filtra ventas por rango de fechas. `from`/`to` son "YYYY-MM-DD"; como las fechas
// de venta también vienen en ese formato ISO, basta comparar como texto.
export function filterSalesByDate(
  sales: Sale[],
  from: string,
  to: string,
): Sale[] {
  return sales.filter(
    (sale) => (!from || sale.date >= from) && (!to || sale.date <= to),
  );
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function rangeStamp(from: string, to: string): string {
  if (from && to) return `${from}_a_${to}`;
  if (from) return `desde_${from}`;
  if (to) return `hasta_${to}`;
  return "todas";
}

// Exporta las ventas a un Excel real (.xlsx). SheetJS se carga de forma diferida
// (solo al exportar) para no pesar en el bundle inicial.
export async function exportSalesToExcel(
  sales: Sale[],
  settings: SalesExportSettings,
  range: { from: string; to: string },
): Promise<void> {
  const XLSX = await import("xlsx");
  const taxLabel = settings.taxName || "IVA";
  const rows = sales.map((sale) => ({
    "N°": sale.id,
    Fecha: sale.date,
    Tipo: sale.type,
    Cliente: sale.customer,
    Método: sale.method,
    Subtotal: round2(sale.subtotal),
    [taxLabel]: round2(sale.igv),
    Total: round2(sale.total),
  }));

  const ws = XLSX.utils.json_to_sheet(rows);
  const totalGeneral = round2(sales.reduce((sum, sale) => sum + sale.total, 0));
  XLSX.utils.sheet_add_aoa(
    ws,
    [[], ["TOTAL GENERAL", "", "", "", "", "", "", totalGeneral]],
    {
      origin: -1,
    },
  );
  ws["!cols"] = [
    { wch: 22 },
    { wch: 12 },
    { wch: 16 },
    { wch: 22 },
    { wch: 16 },
    { wch: 12 },
    { wch: 12 },
    { wch: 12 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Ventas");
  XLSX.writeFile(wb, `ventas_${rangeStamp(range.from, range.to)}.xlsx`);
}

function escapeHtml(value: string): string {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ] as string,
  );
}

function receiptHtml(
  sale: Sale,
  settings: SalesExportSettings,
  money: (n: number) => string,
  ticketByLocation?: Map<string, TicketDisplaySettings>,
): string {
  const display = resolveTicketDisplay(sale, ticketByLocation);
  const items = sale.items
    .map((item) => {
      const variant = item.variantLabel
        ? ` <span style="color:#777">(${escapeHtml(item.variantLabel)})</span>`
        : "";
      return `<tr><td>${item.qty}× ${escapeHtml(item.name)}${variant}</td><td class="r">${money(item.qty * item.price)}</td></tr>`;
    })
    .join("");
  const fiscal =
    display.showFiscalInfo &&
    (settings.fiscalIdLabel || settings.sampleFiscalId)
      ? `<p>${escapeHtml(settings.fiscalIdLabel || "")} ${escapeHtml(settings.sampleFiscalId || "")}</p>`
      : "";
  const addressLine =
    display.showFiscalInfo && settings.address
      ? `<p>${escapeHtml(settings.address)}</p>`
      : "";
  const phoneLine =
    display.showFiscalInfo && settings.phone
      ? `<p>${escapeHtml(settings.phone)}</p>`
      : "";
  const tags = display.showPaymentMethod
    ? `${escapeHtml(sale.type)} · ${escapeHtml(sale.method)}`
    : escapeHtml(sale.type);
  const totalsRows = display.showTaxBreakdown
    ? `<tr><td>Subtotal</td><td class="r">${money(sale.subtotal)}</td></tr>
       <tr><td>${escapeHtml(settings.taxName || "IVA")}</td><td class="r">${money(sale.igv)}</td></tr>
       <tr class="grand"><td>Total</td><td class="r">${money(sale.total)}</td></tr>`
    : `<tr class="grand"><td>Total</td><td class="r">${money(sale.total)}</td></tr>`;
  const footer = display.footerText
    ? `<p class="footer">${escapeHtml(display.footerText)}</p>`
    : "";
  return `<section class="receipt">
    <div class="head">
      <h1>${escapeHtml(settings.businessName)}</h1>
      ${fiscal}
      ${addressLine}
      ${phoneLine}
      <p class="tags">${tags}</p>
    </div>
    <div class="meta"><span>${escapeHtml(sale.id)}</span><span>${escapeHtml(sale.date)}</span></div>
    <div class="cust">Cliente: ${escapeHtml(sale.customer)}</div>
    <table class="items">${items}</table>
    <table class="totals">${totalsRows}</table>
    ${footer}
  </section>`;
}

// Genera un documento imprimible con uno o varios recibos (uno por página) y abre
// el diálogo de impresión, donde el usuario puede "Guardar como PDF". Usa un iframe
// oculto para evitar bloqueadores de pop-ups.
export function printReceipts(
  sales: Sale[],
  settings: SalesExportSettings,
  money: (n: number) => string,
  ticketByLocation?: Map<string, TicketDisplaySettings>,
): void {
  if (!sales.length) return;
  const body = sales
    .map((sale) => receiptHtml(sale, settings, money, ticketByLocation))
    .join("");
  const title =
    sales.length === 1
      ? `Recibo ${sales[0].id}`
      : `Recibos ${settings.businessName}`;
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  *{font-family:ui-sans-serif,system-ui,Arial,sans-serif;box-sizing:border-box;}
  body{margin:0;color:#111;}
  .receipt{width:80mm;margin:0 auto;padding:8mm 6mm;page-break-after:always;}
  .receipt:last-child{page-break-after:auto;}
  .head{text-align:center;border-bottom:1px dashed #999;padding-bottom:8px;margin-bottom:8px;}
  .head h1{font-size:16px;margin:0;font-weight:800;}
  .head p{margin:2px 0;font-size:11px;color:#555;}
  .tags{font-weight:600;color:#111;}
  .meta{display:flex;justify-content:space-between;font-size:11px;color:#555;margin-bottom:6px;}
  .cust{font-size:12px;margin-bottom:8px;}
  table{width:100%;border-collapse:collapse;font-size:12px;}
  .r{text-align:right;}
  .items td{padding:3px 0;border-bottom:1px dotted #ccc;}
  .totals{margin-top:8px;}
  .totals td{padding:2px 0;}
  .totals .grand td{font-weight:800;font-size:14px;border-top:1px solid #333;padding-top:6px;}
  .footer{margin-top:8px;padding-top:8px;border-top:1px dashed #999;font-size:10px;color:#777;text-align:center;}
  @page{margin:8mm;}
</style></head><body>${body}</body></html>`;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);
  const win = iframe.contentWindow;
  if (!win) {
    iframe.remove();
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
  const cleanup = () => setTimeout(() => iframe.remove(), 800);
  win.onafterprint = cleanup;
  setTimeout(() => {
    win.focus();
    win.print();
    cleanup();
  }, 350);
}
