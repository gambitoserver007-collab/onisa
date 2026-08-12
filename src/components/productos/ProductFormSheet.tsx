import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Package, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { toast } from "sonner";
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
import { Switch } from "@/components/ui/switch";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { LogoUploader } from "@/components/settings/LogoUploader";
import { useBusinessSettings } from "@/hooks/useBusinessSettings";
import { useCompanyCatalog } from "@/hooks/useCompanyCatalog";
import { useDemoSession } from "@/hooks/useDemoSession";
import { useBusinessProfile } from "@/hooks/useBusinessProfile";
import { blockDemoAction } from "@/lib/demoMode";
import { getSampleProductName } from "@/lib/businessProfiles";
import {
  createCategory,
  createProduct,
  createUnit,
  fetchLocations,
  fetchProductLocations,
  fetchProductVariants,
  fetchVariantLocations,
  fetchUnits,
  syncProductVariants,
  updateProduct,
  getErrorMessage,
  type Location,
  type Unit,
} from "@/services/appData";
import type { Product } from "@/types";
import {
  VariantEditor,
  type AttrDef,
  type VariantRow,
} from "@/components/productos/VariantEditor";

// Valor centinela del desplegable de categoría para "crear una nueva ahí mismo".
const NEW_CATEGORY = "__new_category__";

// Generates a valid EAN-13 barcode using the in-store prefix "20" so it never
// collides with manufacturer codes. Useful for loose/bulk products without one.
export function generateBarcode(): string {
  const base = (
    "20" +
    Date.now().toString().slice(-7) +
    Math.floor(Math.random() * 1000)
      .toString()
      .padStart(3, "0")
  )
    .slice(0, 12)
    .padEnd(12, "0");
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(base[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return base + String(check);
}

const NONE_SUPPLIER = "none";

export function ProductFormSheet({
  open,
  onOpenChange,
  editingProduct,
  onSaved,
  defaultSupplierId,
  lockSupplier,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Si se pasa, el panel edita ese producto; si no, crea uno nuevo. */
  editingProduct?: Product | null;
  /** Se llama tras guardar con éxito (el padre debe recargar su catálogo). */
  onSaved?: (productId: string) => void | Promise<void>;
  /** Proveedor preseleccionado al crear (ej. al crear desde una compra). */
  defaultSupplierId?: string | null;
  /** Si es true, el proveedor queda fijo (no editable) en defaultSupplierId. */
  lockSupplier?: boolean;
}) {
  const { products, categories, suppliers, session } = useCompanyCatalog();
  const { isDemo } = useDemoSession();
  const { usesVariants, profile } = useBusinessProfile();
  const { settings } = useBusinessSettings();
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [barcode, setBarcode] = useState("");
  const [sku, setSku] = useState("");
  const [categoryId, setCategoryId] = useState("none");
  const [newCategory, setNewCategory] = useState("");
  const [supplierId, setSupplierId] = useState(NONE_SUPPLIER);
  const [cost, setCost] = useState("");
  const [price, setPrice] = useState("");
  // % de utilidad deseado: calculadora de precio (Costo, % Utilidad, comisión
  // de tarjeta + IVA configurados en Configuración) -> llena Precio en vivo.
  // No se guarda en el producto -- es solo la fórmula de un momento; el
  // precio resultante sí se guarda, y se puede seguir editando a mano.
  const [marginPct, setMarginPct] = useState("");
  const [unit, setUnit] = useState("");
  const [unitMode, setUnitMode] = useState<"select" | "custom">("select");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [priceIncludesTax, setPriceIncludesTax] = useState(true);
  const [lowStockThreshold, setLowStockThreshold] = useState("");
  const barcodeRef = useRef<HTMLInputElement>(null);
  // Stock por punto de venta (multi-local).
  const [locations, setLocations] = useState<Location[]>([]);
  const [locStock, setLocStock] = useState<
    Record<string, { checked: boolean; stock: string }>
  >({});
  const [locStockLoading, setLocStockLoading] = useState(false);
  // Variantes (talla, color…): solo para perfiles que las usan (ej. Ropa).
  const [hasVariants, setHasVariants] = useState(false);
  const [attrDefs, setAttrDefs] = useState<AttrDef[]>([]);
  const [variants, setVariants] = useState<VariantRow[]>([]);
  // Etiquetas (unidades de medida) que alimentan el desplegable de unidad.
  const [units, setUnits] = useState<Unit[]>([]);

  useEffect(() => {
    if (!session?.companyId) return;
    void fetchLocations(session.companyId, true)
      .then(setLocations)
      .catch(() => setLocations([]));
    void fetchUnits(session.companyId)
      .then(setUnits)
      .catch(() => setUnits([]));
  }, [session?.companyId]);

  // Inicializa el stock por local: null = nuevo (todos marcados, vacío); un mapa
  // = edición (marca solo donde el producto ya está, con su stock actual).
  const initLocStock = useCallback(
    (stockByLoc: Map<string, number> | null) => {
      const next: Record<string, { checked: boolean; stock: string }> = {};
      for (const loc of locations) {
        const has = stockByLoc?.has(loc.id) ?? false;
        next[loc.id] = stockByLoc
          ? { checked: has, stock: has ? String(stockByLoc.get(loc.id)) : "" }
          : { checked: true, stock: "" };
      }
      setLocStock(next);
    },
    [locations],
  );

  const existingBarcodes = useMemo(
    () => new Set(products.map((product) => product.barcode).filter(Boolean)),
    [products],
  );

  // Generate a barcode that does not collide with any product already loaded.
  const generateUniqueBarcode = () => {
    let code = generateBarcode();
    for (
      let attempt = 0;
      attempt < 25 && existingBarcodes.has(code);
      attempt += 1
    ) {
      code = generateBarcode();
    }
    setBarcode(code);
  };

  // Calculadora de precio: Precio = (Costo / (1 - %Utilidad)) * (1 +
  // %ComisiónTarjeta * (1 + IVA)). Se recalcula en vivo con Costo/%Utilidad;
  // editar Precio a mano después no toca el % de utilidad (es de un solo
  // sentido, a propósito).
  useEffect(() => {
    if (!marginPct.trim()) return;
    const costNum = Number(cost);
    const marginFrac = Number(marginPct) / 100;
    if (!Number.isFinite(costNum) || costNum < 0) return;
    if (!Number.isFinite(marginFrac) || marginFrac < 0 || marginFrac >= 1)
      return;
    const base = costNum / (1 - marginFrac);
    const commissionFrac = settings.cardCommissionRate * (1 + settings.taxRate);
    setPrice((base * (1 + commissionFrac)).toFixed(2));
  }, [cost, marginPct, settings.cardCommissionRate, settings.taxRate]);

  const resetForm = useCallback(() => {
    setEditingId(null);
    setName("");
    setBarcode("");
    setSku("");
    setCategoryId("none");
    setNewCategory("");
    setSupplierId(defaultSupplierId ?? NONE_SUPPLIER);
    setCost("");
    setPrice("");
    setMarginPct("");
    setUnit(
      units.find((u) => u.name === "Unidad")?.name ?? units[0]?.name ?? "",
    );
    setUnitMode("select");
    setImageUrl(null);
    setPriceIncludesTax(true);
    setLowStockThreshold("");
    initLocStock(null);
    setHasVariants(false);
    setAttrDefs([]);
    setVariants([]);
  }, [units, initLocStock, defaultSupplierId]);

  const loadProduct = useCallback(
    (product: Product) => {
      setEditingId(product.id);
      setName(product.name);
      setBarcode(product.barcode ?? "");
      setSku(product.sku ?? "");
      setCategoryId(product.categoryId ?? "none");
      setNewCategory("");
      setSupplierId(product.supplierId ?? NONE_SUPPLIER);
      setCost(String(product.cost));
      setPrice(String(product.price));
      setMarginPct("");
      setUnit(product.unit);
      setUnitMode(
        units.some((u) => u.name === product.unit) ? "select" : "custom",
      );
      setImageUrl(product.image ?? null);
      setPriceIncludesTax(product.priceIncludesTax ?? true);
      setLowStockThreshold(
        product.lowStockThreshold != null
          ? String(product.lowStockThreshold)
          : "",
      );
      // Carga el stock por local que ya tiene el producto.
      setLocStockLoading(true);
      initLocStock(null);
      void fetchProductLocations(product.id)
        .then((rows) =>
          initLocStock(new Map(rows.map((row) => [row.locationId, row.stock]))),
        )
        .catch(() => toast.error("No se pudo cargar el stock por sucursal."))
        .finally(() => setLocStockLoading(false));
      // Variantes existentes del producto.
      setHasVariants(product.hasVariants ?? false);
      setAttrDefs([]);
      setVariants([]);
      if (product.hasVariants) {
        void fetchProductVariants(product.id)
          .then(async (vs) => {
            const rows: VariantRow[] = [];
            for (const v of vs) {
              const locs = await fetchVariantLocations(v.id);
              const locStockMap: Record<string, string> = {};
              for (const l of locs) locStockMap[l.locationId] = String(l.stock);
              rows.push({
                id: v.id,
                attributes: v.attributes,
                label: v.label,
                barcode: v.barcode ?? "",
                price: v.priceOverride != null ? String(v.priceOverride) : "",
                cost: v.costOverride != null ? String(v.costOverride) : "",
                locStock: locStockMap,
              });
            }
            const names =
              product.variantAttributes ?? Object.keys(vs[0]?.attributes ?? {});
            setAttrDefs(
              names.map((nm) => ({
                name: nm,
                values: Array.from(
                  new Set(vs.map((v) => v.attributes[nm]).filter(Boolean)),
                ),
              })),
            );
            setVariants(rows);
          })
          .catch(() => toast.error("No se pudieron cargar las variantes."));
      }
    },
    [units, initLocStock],
  );

  // Al abrir: carga el producto a editar o limpia para uno nuevo.
  useEffect(() => {
    if (!open) return;
    if (editingProduct) loadProduct(editingProduct);
    else resetForm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingProduct]);

  // Activa/desactiva variantes; al activar precarga los atributos sugeridos del rubro.
  const toggleVariants = (value: boolean) => {
    setHasVariants(value);
    if (value && attrDefs.length === 0) {
      setAttrDefs(
        profile.suggestedAttributes.map((nameAttr) => ({
          name: nameAttr,
          values: [],
        })),
      );
    }
  };

  const handleSave = async () => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    if (!session) return;

    const locationsInput = locations
      .filter((loc) => locStock[loc.id]?.checked)
      .map((loc) => ({
        locationId: loc.id,
        stock: Number(locStock[loc.id]?.stock) || 0,
      }));
    if (!hasVariants && locations.length > 0 && locationsInput.length === 0) {
      toast.error("Asigna el producto a al menos una sucursal.");
      return;
    }
    const validVariants = variants.filter(
      (v) => Object.keys(v.attributes).length > 0,
    );
    if (hasVariants && validVariants.length === 0) {
      toast.error(
        "Genera al menos una variante (define atributos y pulsa “Generar combinaciones”).",
      );
      return;
    }

    // Precio y costo no pueden ser negativos (producto base ni variantes).
    const numPrice = Number(price);
    const numCost = Number(cost);
    if (
      !Number.isFinite(numPrice) ||
      numPrice < 0 ||
      !Number.isFinite(numCost) ||
      numCost < 0
    ) {
      toast.error("El precio y el costo no pueden ser negativos.");
      return;
    }
    if (
      hasVariants &&
      validVariants.some((v) => {
        const p = v.price.trim() ? Number(v.price) : 0;
        const c = v.cost.trim() ? Number(v.cost) : 0;
        return !Number.isFinite(p) || p < 0 || !Number.isFinite(c) || c < 0;
      })
    ) {
      toast.error(
        "El precio y el costo de las variantes no pueden ser negativos.",
      );
      return;
    }
    const numLowStockThreshold = lowStockThreshold.trim()
      ? Number(lowStockThreshold)
      : null;
    if (
      numLowStockThreshold !== null &&
      (!Number.isFinite(numLowStockThreshold) || numLowStockThreshold < 0)
    ) {
      toast.error("La alerta de stock bajo debe ser un número positivo.");
      return;
    }

    setIsSaving(true);

    try {
      // Si eligió "Crear nueva categoría", la crea primero y usa su id.
      let resolvedCategoryId =
        categoryId === "none" || categoryId === NEW_CATEGORY
          ? undefined
          : categoryId || undefined;
      if (categoryId === NEW_CATEGORY) {
        const cleanCategory = newCategory.trim();
        if (!cleanCategory)
          throw new Error("Escribe el nombre de la nueva categoría.");
        resolvedCategoryId = await createCategory(session, cleanCategory);
      }

      // "+ Crear nueva etiqueta": si la unidad escrita no existe, la guarda para reutilizarla.
      const cleanUnit = unit.trim();
      if (
        unitMode === "custom" &&
        cleanUnit &&
        !units.some((u) => u.name.toLowerCase() === cleanUnit.toLowerCase())
      ) {
        try {
          await createUnit(session, cleanUnit);
        } catch {
          /* la etiqueta es opcional; el producto se guarda igual */
        }
      }

      const input = {
        name,
        barcode,
        sku,
        categoryId: resolvedCategoryId,
        supplierId: supplierId === NONE_SUPPLIER ? null : supplierId,
        cost: Number(cost),
        price: Number(price),
        stock: 0,
        unit,
        priceIncludesTax,
        imageUrl,
        lowStockThreshold: numLowStockThreshold,
        locations: hasVariants
          ? undefined
          : locations.length > 0
            ? locationsInput
            : undefined,
      };

      let productId = editingId;
      if (editingId) {
        await updateProduct(editingId, input, session.companyId);
      } else {
        productId = await createProduct(session, input);
        // Marca el producto como "en edición" de inmediato: si la sincronización de
        // variantes falla después, un reintento actualiza este producto en vez de
        // crear un duplicado.
        setEditingId(productId);
      }

      // Guarda las variantes (si el producto las maneja).
      if (hasVariants && productId) {
        const attributeNames = attrDefs
          .map((def) => def.name.trim())
          .filter(Boolean);
        const variantInputs = validVariants.map((v) => ({
          id: v.id,
          attributes: v.attributes,
          barcode: v.barcode.trim() || null,
          priceOverride: v.price.trim() ? Number(v.price) : null,
          costOverride: v.cost.trim() ? Number(v.cost) : null,
          locations: locations
            .filter(
              (loc) =>
                v.locStock[loc.id] !== undefined && v.locStock[loc.id] !== "",
            )
            .map((loc) => ({
              locationId: loc.id,
              stock: Number(v.locStock[loc.id]) || 0,
            })),
        }));
        await syncProductVariants(
          session,
          productId,
          attributeNames,
          variantInputs,
        );
      } else if (editingId && productId) {
        // Producto sin variantes (incluida la conversión de con→sin variantes):
        // limpia variantes previas y resetea has_variants/variant_attributes.
        await syncProductVariants(session, productId, [], []);
      }

      toast.success(editingId ? "Producto actualizado." : "Producto creado.");
      const savedId = productId;
      resetForm();
      onOpenChange(false);
      if (savedId) await onSaved?.(savedId);
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo guardar el producto."));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(value) => {
        onOpenChange(value);
        if (!value) resetForm();
      }}
    >
      <SheetContent className="flex w-full flex-col sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>
            {editingId ? "Editar producto" : "Nuevo producto"}
          </SheetTitle>
        </SheetHeader>
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          <p className="text-xs font-bold uppercase tracking-wider text-primary">
            Datos del producto
          </p>
          <div className="space-y-1">
            <Label>Foto del producto</Label>
            <LogoUploader
              value={imageUrl}
              onChange={setImageUrl}
              disabled={isDemo}
              fallback={<Package className="h-7 w-7 text-muted-foreground" />}
              hint="PNG o JPG. Aparece en el catálogo y en el carrito."
            />
          </div>
          <div className="space-y-1">
            <Label>Nombre</Label>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={getSampleProductName(profile.id)}
            />
          </div>
          <div className="space-y-1">
            <Label>Código de barras</Label>
            <div className="flex items-center gap-2">
              <Input
                ref={barcodeRef}
                className="flex-1"
                value={barcode}
                onChange={(event) => setBarcode(event.target.value)}
                placeholder="Escanea, escribe o genera"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Editar código manualmente"
                onClick={() => barcodeRef.current?.focus()}
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Generar código automáticamente"
                onClick={generateUniqueBarcode}
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                variant="outline"
                size="icon"
                aria-label="Borrar código"
                className="text-destructive hover:text-destructive"
                onClick={() => setBarcode("")}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="space-y-1">
            <Label>SKU</Label>
            <Input
              value={sku}
              onChange={(event) => setSku(event.target.value)}
              placeholder="Código interno (opcional)"
            />
          </div>
          <div className="space-y-1">
            <Label>Alerta de stock bajo</Label>
            <Input
              type="number"
              min="0"
              step="1"
              value={lowStockThreshold}
              onChange={(event) => setLowStockThreshold(event.target.value)}
              placeholder={`Usa el valor general de la tienda (${settings.lowStockThresholdDefault})`}
            />
          </div>
          <div className="space-y-1">
            <Label>Categoría</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger>
                <SelectValue placeholder="Sin categoría" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin categoría</SelectItem>
                {categories.map((category) => (
                  <SelectItem key={category.id} value={category.id}>
                    {category.name}
                  </SelectItem>
                ))}
                <SelectItem value={NEW_CATEGORY}>
                  + Crear nueva categoría
                </SelectItem>
              </SelectContent>
            </Select>
            {categoryId === NEW_CATEGORY && (
              <Input
                className="mt-2"
                placeholder="Nombre de la nueva categoría"
                value={newCategory}
                onChange={(event) => setNewCategory(event.target.value)}
              />
            )}
          </div>
          <div className="space-y-1">
            <Label>Proveedor</Label>
            <Select
              value={supplierId}
              onValueChange={setSupplierId}
              disabled={lockSupplier}
            >
              <SelectTrigger>
                <SelectValue placeholder="Sin proveedor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE_SUPPLIER}>Sin proveedor</SelectItem>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              A quién le compras este producto. Aparecerá en las compras de ese
              proveedor.
            </p>
          </div>
          <p className="border-t pt-3 text-xs font-bold uppercase tracking-wider text-primary">
            Precio
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Label>Costo</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={cost}
                onChange={(event) => setCost(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Lo que te cuesta a ti. No lo ve el cliente.
              </p>
            </div>
            <div className="space-y-1">
              <Label>Precio</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={price}
                onChange={(event) => setPrice(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Lo que le cobras al cliente.
              </p>
            </div>
          </div>
          <div className="space-y-1">
            <Label>% Utilidad (opcional)</Label>
            <Input
              type="number"
              min="0"
              max="99"
              step="0.01"
              value={marginPct}
              onChange={(event) => setMarginPct(event.target.value)}
              placeholder="Ej. 30"
            />
            <p className="text-xs text-muted-foreground">
              Con Costo + % Utilidad, calcula el Precio solo (incluye la
              comisión de tarjeta de Configuración +{" "}
              {(settings.taxRate * 100).toFixed(0)}% de IVA). Puedes seguir
              editando el Precio a mano después.
            </p>
          </div>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="pr-3">
              <Label>El precio incluye IVA</Label>
              <p className="text-xs text-muted-foreground">
                Actívalo si el precio ya trae el impuesto adentro.
              </p>
            </div>
            <Switch
              checked={priceIncludesTax}
              onCheckedChange={setPriceIncludesTax}
            />
          </div>
          <p className="border-t pt-3 text-xs font-bold uppercase tracking-wider text-primary">
            Inventario
          </p>
          <div className="space-y-1">
            <Select
              value={unitMode === "custom" ? "__custom__" : unit}
              onValueChange={(value) => {
                if (value === "__custom__") {
                  setUnitMode("custom");
                  setUnit("");
                } else {
                  setUnitMode("select");
                  setUnit(value);
                }
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Elige una etiqueta" />
              </SelectTrigger>
              <SelectContent>
                {units.map((option) => (
                  <SelectItem key={option.id} value={option.name}>
                    {option.name}
                  </SelectItem>
                ))}
                <SelectItem value="__custom__">
                  + Crear nueva etiqueta
                </SelectItem>
              </SelectContent>
            </Select>
            {unitMode === "custom" && (
              <Input
                className="mt-2"
                placeholder="Escribe la medida (ej. Caja, Paquete, Docena)"
                value={unit}
                maxLength={16}
                onChange={(event) => setUnit(event.target.value)}
              />
            )}
          </div>

          {usesVariants && (
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div className="pr-3">
                <Label>Este producto maneja variantes</Label>
                <p className="text-xs text-muted-foreground">
                  Talla, color, etc. Cada combinación tiene su propio stock y
                  código.
                </p>
              </div>
              <Switch checked={hasVariants} onCheckedChange={toggleVariants} />
            </div>
          )}
          {hasVariants ? (
            <VariantEditor
              attrDefs={attrDefs}
              onAttrDefsChange={setAttrDefs}
              variants={variants}
              onVariantsChange={setVariants}
              locations={locations}
              generateBarcode={generateBarcode}
            />
          ) : (
            <div className="space-y-2 rounded-lg border p-3">
              <div>
                <Label>Stock por sucursal</Label>
                <p className="text-xs text-muted-foreground">
                  Marca dónde se vende y cuánto stock hay en cada sucursal.
                </p>
              </div>
              {locStockLoading ? (
                <p className="text-sm text-muted-foreground">Cargando…</p>
              ) : locations.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Crea una sucursal en Sistema → Sucursales.
                </p>
              ) : (
                locations.map((loc) => {
                  const row = locStock[loc.id] ?? { checked: false, stock: "" };
                  return (
                    <div key={loc.id} className="flex items-center gap-3">
                      <Switch
                        checked={row.checked}
                        onCheckedChange={(checked) =>
                          setLocStock((current) => ({
                            ...current,
                            [loc.id]: {
                              checked,
                              stock: current[loc.id]?.stock ?? "",
                            },
                          }))
                        }
                      />
                      <span className="w-28 shrink-0 truncate text-sm">
                        {loc.name}
                      </span>
                      <Input
                        type="number"
                        min="0"
                        step="1"
                        className="w-24 shrink-0"
                        placeholder="0"
                        value={row.stock}
                        disabled={!row.checked}
                        onChange={(event) =>
                          setLocStock((current) => ({
                            ...current,
                            [loc.id]: {
                              checked: true,
                              stock: event.target.value,
                            },
                          }))
                        }
                      />
                      <span className="whitespace-nowrap text-xs text-muted-foreground">
                        {unit}
                      </span>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>
        <SheetFooter>
          <Button variant="brand" disabled={isSaving} onClick={handleSave}>
            {isSaving
              ? "Guardando..."
              : editingId
                ? "Guardar cambios"
                : "Guardar"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
