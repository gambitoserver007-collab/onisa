// Vista previa de importes con IVA para los formularios (cotización, apartado, devolución).
// Replica lo que calculan en el servidor create_quote / create_apartado / create_return, para que
// lo que el usuario ve antes de guardar sea lo que de verdad se cobra o se reembolsa.

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Total de un renglón: si el precio ya incluye IVA es precio x cantidad; si no, se le suma el IVA. */
export function lineTotalWithTax(
  price: number,
  qty: number,
  priceIncludesTax: boolean | undefined,
  taxRate: number,
): number {
  const base = price * qty;

  return priceIncludesTax === false
    ? round2(base * (1 + taxRate))
    : round2(base);
}

export interface ReturnLinePreview {
  id: string;
  qty: number;
  alreadyReturned: number;
  /** sale_items.total: lo cobrado por el renglón, con IVA. */
  lineTotal: number;
  /** Suma de lo ya reembolsado de este renglón en devoluciones anteriores. */
  refundedAmount: number;
  /** sales.total / suma de renglones: baja de 1 si se canjearon puntos o hubo descuento. */
  paidRatio: number;
}

/** Reembolso de una devolución: mismo cálculo acumulado y redondeado que create_return. */
export function estimateReturnRefund(
  lines: ReturnLinePreview[],
  qtys: Record<string, string | number | undefined>,
): number {
  let total = 0;

  for (const line of lines) {
    const qty = Number(qtys[line.id] ?? 0);

    if (!qty || qty <= 0 || !line.qty) continue;
    const cumulative = round2(
      (line.lineTotal / line.qty) *
        (line.alreadyReturned + qty) *
        line.paidRatio,
    );

    total += Math.max(0, round2(cumulative - line.refundedAmount));
  }

  return round2(total);
}
