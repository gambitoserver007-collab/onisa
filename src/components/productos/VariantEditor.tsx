import { Plus, RefreshCw, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Definición de un atributo de variante: nombre + valores posibles. */
export interface AttrDef {
  name: string;
  values: string[];
}

/** Una fila de variante en el editor (combinación concreta de atributos). */
export interface VariantRow {
  /** Si existe, es una variante ya guardada que se actualizará. */
  id?: string;
  attributes: Record<string, string>;
  label: string;
  barcode: string;
  /** Precio propio; vacío = hereda el del producto. */
  price: string;
  /** Costo propio; vacío = hereda el del producto. */
  cost: string;
  /** Stock por sucursal: locationId -> texto. */
  locStock: Record<string, string>;
}

export function variantLabel(attributes: Record<string, string>): string {
  return Object.entries(attributes)
    .map(([key, value]) => `${key} ${value}`)
    .join(" / ");
}

// Producto cartesiano de los atributos definidos (todas las combinaciones).
// Deduplica valores repetidos dentro de cada atributo y atributos con el mismo
// nombre, para no generar variantes con label repetido ni perder dimensiones.
export function buildVariantCombos(defs: AttrDef[]): Record<string, string>[] {
  const seenNames = new Set<string>();
  const clean = defs
    .map((d) => ({
      name: d.name.trim(),
      values: Array.from(
        new Set(d.values.map((v) => v.trim()).filter(Boolean)),
      ),
    }))
    .filter((d) => {
      if (!d.name || d.values.length === 0) return false;
      const key = d.name.toLowerCase();
      if (seenNames.has(key)) return false; // ignora atributos con nombre duplicado
      seenNames.add(key);
      return true;
    });
  if (!clean.length) return [];
  let combos: Record<string, string>[] = [{}];
  for (const def of clean) {
    const next: Record<string, string>[] = [];
    for (const combo of combos) {
      for (const value of def.values) {
        next.push({ ...combo, [def.name]: value });
      }
    }
    combos = next;
  }
  return combos;
}

interface VariantEditorProps {
  attrDefs: AttrDef[];
  onAttrDefsChange: (defs: AttrDef[]) => void;
  variants: VariantRow[];
  onVariantsChange: (rows: VariantRow[]) => void;
  locations: { id: string; name: string }[];
  generateBarcode: () => string;
}

export function VariantEditor({
  attrDefs,
  onAttrDefsChange,
  variants,
  onVariantsChange,
  locations,
  generateBarcode,
}: VariantEditorProps) {
  const setAttr = (index: number, patch: Partial<AttrDef>) =>
    onAttrDefsChange(
      attrDefs.map((d, i) => (i === index ? { ...d, ...patch } : d)),
    );
  const addAttr = () =>
    onAttrDefsChange([...attrDefs, { name: "", values: [] }]);
  const removeAttr = (index: number) =>
    onAttrDefsChange(attrDefs.filter((_, i) => i !== index));

  // Genera la matriz preservando código/precio/stock de las combinaciones que ya existían.
  const regenerate = () => {
    const byLabel = new Map(variants.map((v) => [v.label, v]));
    const next: VariantRow[] = buildVariantCombos(attrDefs).map(
      (attributes) => {
        const label = variantLabel(attributes);
        const existing = byLabel.get(label);
        return existing
          ? { ...existing, attributes, label }
          : {
              attributes,
              label,
              barcode: "",
              price: "",
              cost: "",
              locStock: {},
            };
      },
    );
    onVariantsChange(next);
  };

  const setVariant = (index: number, patch: Partial<VariantRow>) =>
    onVariantsChange(
      variants.map((v, i) => (i === index ? { ...v, ...patch } : v)),
    );
  const setVariantStock = (index: number, locationId: string, value: string) =>
    onVariantsChange(
      variants.map((v, i) =>
        i === index
          ? { ...v, locStock: { ...v.locStock, [locationId]: value } }
          : v,
      ),
    );

  return (
    <div className="space-y-3 rounded-lg border p-3">
      <div>
        <Label>Atributos de la variante</Label>
        <p className="text-xs text-muted-foreground">
          Define las dimensiones (ej. Talla, Color) y sus valores separados por
          coma.
        </p>
      </div>

      {attrDefs.map((def, i) => (
        <div key={i} className="flex items-center gap-2">
          <Input
            className="w-28 shrink-0"
            placeholder="Atributo"
            value={def.name}
            onChange={(event) => setAttr(i, { name: event.target.value })}
          />
          <Input
            className="flex-1"
            placeholder="Valores: S, M, L"
            value={def.values.join(", ")}
            onChange={(event) =>
              // Texto crudo separado por coma; el trim/filtrado/dedupe se hace al
              // generar combinaciones (buildVariantCombos). Normalizar en cada tecla
              // rompía el tipeo (no se podían escribir varios valores).
              setAttr(i, {
                values: event.target.value.split(",").map((s) => s.trim()),
              })
            }
          />
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            aria-label="Quitar atributo"
            onClick={() => removeAttr(i)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={addAttr}>
          <Plus className="mr-1 h-4 w-4" /> Atributo
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={regenerate}>
          <Wand2 className="mr-1 h-4 w-4" /> Generar combinaciones
        </Button>
      </div>

      {variants.length > 0 && (
        <div className="space-y-2 border-t pt-3">
          <Label>Variantes ({variants.length})</Label>
          {variants.map((variant, i) => (
            <div
              key={variant.id ?? `v-${i}`}
              className="space-y-2 rounded-md border bg-muted/30 p-2"
            >
              <p className="text-sm font-semibold">{variant.label}</p>
              <div className="flex items-center gap-2">
                <Input
                  className="flex-1"
                  placeholder="Código de barras"
                  value={variant.barcode}
                  onChange={(event) =>
                    setVariant(i, { barcode: event.target.value })
                  }
                />
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  aria-label="Generar código"
                  onClick={() => setVariant(i, { barcode: generateBarcode() })}
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  className="w-24 shrink-0"
                  placeholder="Precio"
                  value={variant.price}
                  onChange={(event) =>
                    setVariant(i, { price: event.target.value })
                  }
                />
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  className="w-24 shrink-0"
                  placeholder="Costo"
                  value={variant.cost}
                  onChange={(event) =>
                    setVariant(i, { cost: event.target.value })
                  }
                />
              </div>
              {locations.length > 0 && (
                <div className="flex flex-wrap gap-3">
                  {locations.map((loc) => (
                    <div key={loc.id} className="flex items-center gap-1">
                      <span className="text-xs text-muted-foreground">
                        {loc.name}
                      </span>
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        className="w-16"
                        placeholder="—"
                        value={variant.locStock[loc.id] ?? ""}
                        onChange={(event) =>
                          setVariantStock(i, loc.id, event.target.value)
                        }
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
