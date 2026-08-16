import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PESO_DENOMINATIONS } from "@/lib/denominations";

// Arqueo ciego: esta pantalla SOLO conoce lo que la cajera va tecleando --
// nunca recibe (ni podría mostrar) el monto esperado. El total que se ve
// aquí es únicamente la suma de lo que ella misma está contando.
export interface DenominationLine {
  denomination: number;
  quantity: number;
}

function formatDenomination(value: number) {
  return value >= 1
    ? `$${value.toLocaleString("es-MX")}`
    : `${Math.round(value * 100)}¢`;
}

export function DenominationCountForm({
  busy,
  onSubmit,
  submitLabel = "Enviar conteo",
  formatMoney,
}: {
  busy: boolean;
  onSubmit: (lines: DenominationLine[], manualAdjustment: number) => void;
  submitLabel?: string;
  formatMoney: (amount: number) => string;
}) {
  const [quantities, setQuantities] = useState<Record<number, string>>({});
  // Monto exacto en pesos y centavos que no se puede armar con billetes y
  // monedas (ej. $3.75 sueltos de ventas con precio decimal) -- sin esto,
  // un corte con productos de precio decimal nunca podía cuadrar, porque la
  // denominación más chica es $0.50.
  const [manualAdjustmentInput, setManualAdjustmentInput] = useState("");

  const lines: DenominationLine[] = useMemo(
    () =>
      PESO_DENOMINATIONS.map((denomination) => ({
        denomination,
        quantity: Math.max(
          0,
          Math.trunc(Number(quantities[denomination]) || 0),
        ),
      })),
    [quantities],
  );

  const manualAdjustment = Math.max(
    0,
    Math.round((Number(manualAdjustmentInput) || 0) * 100) / 100,
  );

  const total = useMemo(
    () =>
      lines.reduce((sum, l) => sum + l.denomination * l.quantity, 0) +
      manualAdjustment,
    [lines, manualAdjustment],
  );

  const hasAny = lines.some((l) => l.quantity > 0) || manualAdjustment > 0;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3">
        {PESO_DENOMINATIONS.map((denomination) => (
          <div key={denomination} className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              {formatDenomination(denomination)}
            </Label>
            <Input
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              placeholder="0"
              value={quantities[denomination] ?? ""}
              onChange={(event) =>
                setQuantities((current) => ({
                  ...current,
                  [denomination]: event.target.value,
                }))
              }
            />
          </div>
        ))}
      </div>
      <div className="space-y-1 border-t border-dashed border-border/60 pt-3">
        <Label className="text-xs text-muted-foreground">
          Otros / ajuste exacto (sueltos que no cuadran en billetes o monedas)
        </Label>
        <Input
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          placeholder="$0.00"
          value={manualAdjustmentInput}
          onChange={(event) => setManualAdjustmentInput(event.target.value)}
        />
      </div>
      <div className="flex items-center justify-between rounded-2xl bg-muted/50 p-3">
        <span className="text-sm text-muted-foreground">Total contado</span>
        <span className="text-lg font-black tabular-nums">
          {formatMoney(total)}
        </span>
      </div>
      <Button
        variant="brand"
        className="w-full"
        disabled={busy || !hasAny}
        onClick={() =>
          onSubmit(
            lines.filter((l) => l.quantity > 0),
            manualAdjustment,
          )
        }
      >
        {busy ? "Enviando..." : submitLabel}
      </Button>
    </div>
  );
}
