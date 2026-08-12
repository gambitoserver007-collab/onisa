import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Product } from "@/types";

export interface ComboItemRow {
  componentProductId: string;
  qty: string;
}

export function ComboItemsEditor({
  items,
  onItemsChange,
  components,
  isLoading,
}: {
  items: ComboItemRow[];
  onItemsChange: (items: ComboItemRow[]) => void;
  /** Productos Estándar disponibles para elegir como pieza. */
  components: Product[];
  isLoading?: boolean;
}) {
  const componentById = new Map(components.map((p) => [p.id, p]));

  const addRow = () => {
    onItemsChange([...items, { componentProductId: "", qty: "1" }]);
  };

  const updateRow = (index: number, patch: Partial<ComboItemRow>) => {
    onItemsChange(
      items.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    );
  };

  const removeRow = (index: number) => {
    onItemsChange(items.filter((_, i) => i !== index));
  };

  const suggestedCost = items.reduce((sum, item) => {
    const qty = Number(item.qty);
    const component = componentById.get(item.componentProductId);
    if (!component || !Number.isFinite(qty)) return sum;
    return sum + component.cost * qty;
  }, 0);

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div>
        <Label>Piezas del combo</Label>
        <p className="text-xs text-muted-foreground">
          Qué productos Estándar lo componen y cuántas piezas de cada uno. Al
          vender el combo, se descuenta automáticamente de cada pieza.
        </p>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : components.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No hay productos Estándar todavía. Crea primero las piezas sueltas.
        </p>
      ) : (
        <div className="space-y-2">
          {items.map((item, index) => (
            <div key={index} className="flex items-center gap-2">
              <Select
                value={item.componentProductId}
                onValueChange={(value) =>
                  updateRow(index, { componentProductId: value })
                }
              >
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Elige una pieza" />
                </SelectTrigger>
                <SelectContent>
                  {components.map((component) => (
                    <SelectItem key={component.id} value={component.id}>
                      {component.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                type="number"
                min="0"
                step="1"
                className="w-20 shrink-0"
                value={item.qty}
                onChange={(event) =>
                  updateRow(index, { qty: event.target.value })
                }
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0 text-destructive hover:text-destructive"
                aria-label="Quitar pieza"
                onClick={() => removeRow(index)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={addRow}
        disabled={components.length === 0}
      >
        <Plus className="mr-1 h-4 w-4" /> Agregar pieza
      </Button>

      {items.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Costo sugerido según las piezas: ${suggestedCost.toFixed(2)} (puedes
          ajustar el Costo del combo a mano arriba).
        </p>
      )}
    </div>
  );
}
