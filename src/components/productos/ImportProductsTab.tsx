import { useEffect, useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCompanyCatalog } from "@/hooks/useCompanyCatalog";
import { useCurrentLocation } from "@/hooks/useCurrentLocation";
import { useDemoSession } from "@/hooks/useDemoSession";
import { blockDemoAction } from "@/lib/demoMode";
import {
  createCategory,
  createProduct,
  createUnit,
  fetchUnits,
  getErrorMessage,
  type Unit,
} from "@/services/appData";
import type { Product } from "@/types";

interface ParsedRow {
  rowNumber: number;
  name: string;
  barcode: string;
  sku: string;
  categoryName: string;
  supplierName: string;
  cost: number;
  price: number;
  stock: number;
  unitName: string;
  status: "ok" | "duplicate" | "invalid";
  issue?: string;
}

type RawField =
  | "name"
  | "barcode"
  | "sku"
  | "category"
  | "supplier"
  | "cost"
  | "price"
  | "stock"
  | "unit";

// Encabezados aceptados, normalizados (sin acentos, minúsculas, sin
// espacios) -- así "Código de Barras" y "codigo de barras" caen en la
// misma columna sin exigirle al usuario un formato exacto.
const HEADER_MAP: Record<string, RawField> = {
  nombre: "name",
  producto: "name",
  codigodebarras: "barcode",
  codigobarras: "barcode",
  codigo: "barcode",
  sku: "sku",
  categoria: "category",
  proveedor: "supplier",
  costo: "cost",
  preciodecosto: "cost",
  precio: "price",
  preciodeventa: "price",
  stock: "stock",
  cantidad: "stock",
  existencias: "stock",
  unidad: "unit",
};

function normalizeHeader(value: string): string {
  return value
    .toString()
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "");
}

function buildRows(
  raw: Record<string, unknown>[],
  existingProducts: Product[],
): ParsedRow[] {
  const existingByBarcode = new Map(
    existingProducts
      .filter((p) => p.barcode)
      .map((p) => [p.barcode.trim().toLowerCase(), p]),
  );
  const existingByName = new Map(
    existingProducts.map((p) => [p.name.trim().toLowerCase(), p]),
  );
  const seenBarcodes = new Set<string>();
  const seenNames = new Set<string>();

  return raw.map((row, index) => {
    const rowNumber = index + 2; // fila 1 = encabezados
    const fields: Partial<Record<RawField, string>> = {};
    for (const [key, value] of Object.entries(row)) {
      const field = HEADER_MAP[normalizeHeader(key)];
      if (field) fields[field] = String(value ?? "").trim();
    }

    const name = fields.name ?? "";
    const barcode = fields.barcode ?? "";
    const sku = fields.sku ?? "";
    const categoryName = fields.category ?? "";
    const supplierName = fields.supplier ?? "";
    const unitName = fields.unit || "pza";
    const costNum = fields.cost ? Number(fields.cost) : 0;
    const priceNum = fields.price ? Number(fields.price) : NaN;
    const stockNum = fields.stock ? Number(fields.stock) : 0;

    let status: ParsedRow["status"] = "ok";
    let issue: string | undefined;

    if (!name) {
      status = "invalid";
      issue = "Falta el nombre.";
    } else if (!Number.isFinite(priceNum) || priceNum < 0) {
      status = "invalid";
      issue = "Precio inválido o vacío.";
    } else if (fields.cost && (!Number.isFinite(costNum) || costNum < 0)) {
      status = "invalid";
      issue = "Costo inválido.";
    } else if (fields.stock && (!Number.isFinite(stockNum) || stockNum < 0)) {
      status = "invalid";
      issue = "Stock inválido.";
    }

    if (status === "ok") {
      const barcodeKey = barcode.toLowerCase();
      const nameKey = name.toLowerCase();
      if (
        (barcode && existingByBarcode.has(barcodeKey)) ||
        existingByName.has(nameKey)
      ) {
        status = "duplicate";
        issue = "Ya existe un producto con ese nombre o código de barras.";
      } else if (
        (barcode && seenBarcodes.has(barcodeKey)) ||
        seenNames.has(nameKey)
      ) {
        status = "duplicate";
        issue = "Repetido dentro del mismo archivo.";
      } else {
        if (barcode) seenBarcodes.add(barcodeKey);
        seenNames.add(nameKey);
      }
    }

    return {
      rowNumber,
      name,
      barcode,
      sku,
      categoryName,
      supplierName,
      cost: Number.isFinite(costNum) ? costNum : 0,
      price: Number.isFinite(priceNum) ? priceNum : 0,
      stock: Number.isFinite(stockNum) ? stockNum : 0,
      unitName,
      status,
      issue,
    };
  });
}

// Importación masiva de productos desde Excel: SOLO crea productos nuevos
// (nunca actualiza uno existente por nombre/código repetido, para no pisar
// precios o costos ya capturados a mano por error). Categorías y unidades
// que no existan se crean sobre la marcha, igual que el "+crear" del
// formulario normal; proveedores solo se enlazan si el nombre ya existe --
// no se crean para evitar proveedores basura por una errata de dedo.
export function ImportProductsTab({ onImported }: { onImported: () => void }) {
  const { products, categories, suppliers, session, reload } =
    useCompanyCatalog();
  const { locations, hasMultiple } = useCurrentLocation();
  const { isDemo } = useDemoSession();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [targetLocationId, setTargetLocationId] = useState("");
  const [units, setUnits] = useState<Unit[]>([]);

  useEffect(() => {
    if (!session?.companyId) return;
    void fetchUnits(session.companyId)
      .then(setUnits)
      .catch(() => undefined);
  }, [session?.companyId]);

  useEffect(() => {
    if (!targetLocationId && locations[0]) {
      setTargetLocationId(locations[0].id);
    }
  }, [locations, targetLocationId]);

  const handleFile = async (file: File) => {
    setFileName(file.name);
    setIsParsing(true);
    setRows([]);
    try {
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
        defval: "",
      });
      const parsed = buildRows(raw, products);
      setRows(parsed);
      if (parsed.length === 0) {
        toast.error("El archivo no tiene filas de datos.");
      }
    } catch {
      toast.error(
        "No se pudo leer el archivo. Verifica que sea un Excel válido.",
      );
    } finally {
      setIsParsing(false);
    }
  };

  const handleDownloadTemplate = async () => {
    const XLSX = await import("xlsx");
    const ws = XLSX.utils.aoa_to_sheet([
      [
        "Nombre",
        "Código de barras",
        "SKU",
        "Categoría",
        "Proveedor",
        "Costo",
        "Precio",
        "Stock",
        "Unidad",
      ],
      [
        "Refresco 600ml",
        "7501234567890",
        "REF600",
        "Bebidas",
        "",
        10,
        18,
        50,
        "pza",
      ],
    ]);
    ws["!cols"] = [
      { wch: 24 },
      { wch: 18 },
      { wch: 12 },
      { wch: 16 },
      { wch: 16 },
      { wch: 10 },
      { wch: 10 },
      { wch: 8 },
      { wch: 10 },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Productos");
    XLSX.writeFile(wb, "plantilla-productos.xlsx");
  };

  const validRows = rows.filter((r) => r.status === "ok");

  const handleImport = async () => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    if (!session) return;
    if (validRows.length === 0) {
      toast.error("No hay productos válidos para importar.");
      return;
    }
    if (hasMultiple && !targetLocationId) {
      toast.error("Selecciona la sucursal para el stock inicial.");
      return;
    }
    if (
      !window.confirm(
        `¿Importar ${validRows.length} producto(s) nuevo(s) al catálogo?`,
      )
    ) {
      return;
    }

    setIsImporting(true);
    const categoryMap = new Map(
      categories.map((c) => [c.name.trim().toLowerCase(), c.id]),
    );
    const unitMap = new Map(
      units.map((u) => [u.name.trim().toLowerCase(), u.name]),
    );
    const supplierMap = new Map(
      suppliers.map((s) => [s.name.trim().toLowerCase(), s.id]),
    );

    let created = 0;
    const failures: string[] = [];

    for (const row of validRows) {
      try {
        let categoryId: string | undefined;
        if (row.categoryName) {
          const key = row.categoryName.toLowerCase();
          categoryId = categoryMap.get(key);
          if (!categoryId) {
            categoryId = await createCategory(session, row.categoryName);
            categoryMap.set(key, categoryId);
          }
        }
        const unitKey = row.unitName.toLowerCase();
        let unitName = unitMap.get(unitKey);
        if (!unitName) {
          await createUnit(session, row.unitName);
          unitName = row.unitName;
          unitMap.set(unitKey, unitName);
        }
        const supplierId = row.supplierName
          ? (supplierMap.get(row.supplierName.toLowerCase()) ?? null)
          : null;

        await createProduct(session, {
          name: row.name,
          barcode: row.barcode || undefined,
          sku: row.sku || undefined,
          categoryId,
          supplierId,
          cost: row.cost,
          price: row.price,
          stock: row.stock,
          unit: unitName,
          locations: targetLocationId
            ? [{ locationId: targetLocationId, stock: row.stock }]
            : undefined,
        });
        created += 1;
      } catch (error) {
        failures.push(
          `Fila ${row.rowNumber} (${row.name}): ${getErrorMessage(error)}`,
        );
      }
    }

    setIsImporting(false);
    if (created > 0) {
      toast.success(`Se importaron ${created} producto(s).`);
      setRows([]);
      setFileName("");
      await reload();
      onImported();
    }
    if (failures.length > 0) {
      toast.error(
        `${failures.length} fila(s) fallaron: ${failures.slice(0, 3).join(" · ")}${failures.length > 3 ? "…" : ""}`,
      );
    }
  };

  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="rounded-xl border border-dashed border-border/60 p-4">
          <p className="text-sm font-medium">Archivo de Excel</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Encabezados aceptados: Nombre, Código de barras, SKU, Categoría,
            Proveedor, Costo, Precio, Stock, Unidad. Solo{" "}
            <strong>Nombre</strong> y <strong>Precio</strong> son obligatorios.
            Solo se crean productos nuevos -- si el nombre o código ya existe en
            tu catálogo, esa fila se omite.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handleFile(file);
                event.target.value = "";
              }}
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={isParsing}
            >
              <Upload className="mr-1 h-4 w-4" />
              {isParsing ? "Leyendo..." : "Elegir archivo..."}
            </Button>
            <Button
              variant="ghost"
              onClick={() => void handleDownloadTemplate()}
            >
              <Download className="mr-1 h-4 w-4" /> Descargar plantilla
            </Button>
            {fileName && (
              <span className="text-sm text-muted-foreground">{fileName}</span>
            )}
          </div>
        </div>

        {rows.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              {hasMultiple && (
                <div className="space-y-1">
                  <Label>Sucursal para el stock inicial</Label>
                  <Select
                    value={targetLocationId}
                    onValueChange={setTargetLocationId}
                  >
                    <SelectTrigger className="w-52">
                      <SelectValue placeholder="Selecciona una sucursal" />
                    </SelectTrigger>
                    <SelectContent>
                      {locations.map((loc) => (
                        <SelectItem key={loc.id} value={loc.id}>
                          {loc.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <Button
                variant="brand"
                className="sm:ml-auto"
                disabled={isImporting || validRows.length === 0}
                onClick={handleImport}
              >
                {isImporting
                  ? "Importando..."
                  : `Importar ${validRows.length} producto(s)`}
              </Button>
            </div>

            <div className="overflow-x-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fila</TableHead>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Categoría</TableHead>
                    <TableHead>Proveedor</TableHead>
                    <TableHead className="text-right">Costo</TableHead>
                    <TableHead className="text-right">Precio</TableHead>
                    <TableHead className="text-right">Stock</TableHead>
                    <TableHead>Estado</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.rowNumber}>
                      <TableCell className="text-muted-foreground">
                        {row.rowNumber}
                      </TableCell>
                      <TableCell className="font-medium">
                        {row.name || "—"}
                      </TableCell>
                      <TableCell>{row.categoryName || "—"}</TableCell>
                      <TableCell>{row.supplierName || "—"}</TableCell>
                      <TableCell className="text-right">{row.cost}</TableCell>
                      <TableCell className="text-right">{row.price}</TableCell>
                      <TableCell className="text-right">{row.stock}</TableCell>
                      <TableCell>
                        {row.status === "ok" && (
                          <Badge variant="success">Listo</Badge>
                        )}
                        {row.status === "duplicate" && (
                          <Badge variant="warm" title={row.issue}>
                            Duplicado
                          </Badge>
                        )}
                        {row.status === "invalid" && (
                          <Badge variant="destructive" title={row.issue}>
                            Inválido
                          </Badge>
                        )}
                        {row.issue && (
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {row.issue}
                          </p>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
