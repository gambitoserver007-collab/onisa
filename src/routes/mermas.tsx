import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ChevronsUpDown, PackageX, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DemoGuardedButton } from "@/components/demo/DemoGuardedButton";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { useBusinessSettings } from "@/hooks/useBusinessSettings";
import { useCompanyCatalog } from "@/hooks/useCompanyCatalog";
import { useCurrentLocation } from "@/hooks/useCurrentLocation";
import { useDemoSession } from "@/hooks/useDemoSession";
import { ALL_LOCATIONS } from "@/lib/currentLocation";
import { blockDemoAction } from "@/lib/demoMode";
import {
  deleteMerma,
  fetchMermas,
  fetchProfileNames,
  getErrorMessage,
  registerMerma,
  type Merma,
  type MermaReasonCategory,
} from "@/services/appData";

export const Route = createFileRoute("/mermas")({ component: Mermas });

const REASON_OPTIONS: { value: MermaReasonCategory; label: string }[] = [
  { value: "danado", label: "Dañado" },
  { value: "vencido", label: "Vencido/caducado" },
  { value: "error_impresion", label: "Error de impresión/copias" },
  { value: "error_caja", label: "Error de caja" },
  { value: "robo_interno", label: "Robo/extravío" },
  { value: "otro", label: "Otro" },
];
const REASON_LABELS = Object.fromEntries(
  REASON_OPTIONS.map((o) => [o.value, o.label]),
) as Record<MermaReasonCategory, string>;

function Mermas() {
  const { formatMoney } = useBusinessSettings();
  const { session, role, isDemo } = useDemoSession();
  const { products } = useCompanyCatalog();
  const { locations, currentLocationId, hasMultiple } = useCurrentLocation();
  const isManager = role === "admin" || role === "finanzas";

  const [mermas, setMermas] = useState<Merma[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [locationFilter, setLocationFilter] = useState("all");
  const [reasonFilter, setReasonFilter] = useState("all");
  const [employeeFilter, setEmployeeFilter] = useState("all");

  const load = async () => {
    if (!session?.companyId) return;
    setIsLoading(true);
    try {
      const data = await fetchMermas(session.companyId, {
        from: from || undefined,
        to: to || undefined,
        locationId: locationFilter === "all" ? undefined : locationFilter,
        employeeId:
          isManager && employeeFilter !== "all" ? employeeFilter : undefined,
        reasonCategory:
          reasonFilter === "all"
            ? undefined
            : (reasonFilter as MermaReasonCategory),
      });
      setMermas(data);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    session?.companyId,
    from,
    to,
    locationFilter,
    reasonFilter,
    employeeFilter,
  ]);

  useEffect(() => {
    if (!session?.companyId) return;
    void fetchProfileNames(session.companyId)
      .then(setProfileNames)
      .catch(() => undefined);
  }, [session?.companyId]);

  const locationNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const loc of locations) map[loc.id] = loc.name;
    return map;
  }, [locations]);

  // --- Formulario de nueva merma ---
  const [open, setOpen] = useState(false);
  const [formLocation, setFormLocation] = useState("");
  const [formEmployee, setFormEmployee] = useState("self");
  const [formReason, setFormReason] = useState<MermaReasonCategory>("danado");
  const [hasProduct, setHasProduct] = useState(false);
  const [productId, setProductId] = useState("");
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [quantity, setQuantity] = useState("1");
  const [estimatedLoss, setEstimatedLoss] = useState("");
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFormLocation(
      currentLocationId && currentLocationId !== ALL_LOCATIONS
        ? currentLocationId
        : (locations[0]?.id ?? ""),
    );
    setFormEmployee("self");
    setFormReason("danado");
    setHasProduct(false);
    setProductId("");
    setQuantity("1");
    setEstimatedLoss("");
    setNotes("");
  }, [open, currentLocationId, locations]);

  const selectedProduct = products.find((p) => p.id === productId) ?? null;
  const previewLoss = selectedProduct
    ? selectedProduct.cost * (Number(quantity) || 0)
    : Number(estimatedLoss) || 0;

  const colCount = 4 + (hasMultiple ? 1 : 0) + (isManager ? 2 : 0); // Fecha+Producto+Motivo+Pérdida + Sucursal? + (Empleado + acción)?

  const handleSave = async () => {
    if (!formLocation) {
      toast.error("Selecciona una sucursal.");
      return;
    }
    if (hasProduct && !productId) {
      toast.error("Selecciona un producto.");
      return;
    }
    setIsSaving(true);
    try {
      await registerMerma({
        locationId: formLocation,
        reasonCategory: formReason,
        employeeId: formEmployee === "self" ? null : formEmployee,
        productId: hasProduct ? productId : null,
        quantity: hasProduct ? Number(quantity) || 1 : null,
        estimatedLoss: hasProduct ? null : Number(estimatedLoss) || 0,
        notes: notes.trim() || null,
      });
      toast.success("Merma registrada.");
      setOpen(false);
      void load();
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    if (
      !window.confirm(
        "¿Eliminar esta merma? Si tenía producto, se repone el stock.",
      )
    ) {
      return;
    }
    try {
      await deleteMerma(id);
      toast.success("Merma eliminada.");
      void load();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  return (
    <AppShell>
      <PageHeader
        eyebrow="Operaciones"
        icon={PackageX}
        title="Mermas"
        description="Artículos dañados, caducados o errores que representan una pérdida."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {isManager && (
              <Link to="/mermas/monitor">
                <Button variant="outline">Monitor de mermas</Button>
              </Link>
            )}
            <Dialog open={open} onOpenChange={setOpen}>
              <DialogTrigger asChild>
                <Button variant="brand">
                  <Plus className="mr-1 h-4 w-4" /> Nueva merma
                </Button>
              </DialogTrigger>
              <DialogContent className="max-w-lg">
                <DialogHeader>
                  <DialogTitle>Registrar merma</DialogTitle>
                </DialogHeader>
                <div className="space-y-3">
                  {hasMultiple && (
                    <div className="space-y-1">
                      <Label>Sucursal</Label>
                      <Select
                        value={formLocation}
                        onValueChange={setFormLocation}
                      >
                        <SelectTrigger>
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
                  {isManager && (
                    <div className="space-y-1">
                      <Label>Empleado</Label>
                      <Select
                        value={formEmployee}
                        onValueChange={setFormEmployee}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="self">Para mí</SelectItem>
                          {Object.entries(profileNames).map(([id, name]) => (
                            <SelectItem key={id} value={id}>
                              {name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Para artículos de alto valor, puedes registrar la merma
                        a nombre del empleado responsable.
                      </p>
                    </div>
                  )}
                  <div className="space-y-1">
                    <Label>Motivo</Label>
                    <Select
                      value={formReason}
                      onValueChange={(v) =>
                        setFormReason(v as MermaReasonCategory)
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {REASON_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={hasProduct}
                      onChange={(event) => setHasProduct(event.target.checked)}
                      className="h-4 w-4 rounded border-input"
                    />
                    Es un producto del inventario
                  </label>

                  {hasProduct ? (
                    <>
                      <div className="space-y-1">
                        <Label>Producto</Label>
                        <Popover
                          open={productPickerOpen}
                          onOpenChange={setProductPickerOpen}
                        >
                          <PopoverTrigger asChild>
                            <Button
                              type="button"
                              variant="outline"
                              role="combobox"
                              className="w-full justify-between font-normal"
                            >
                              <span className="truncate">
                                {selectedProduct
                                  ? selectedProduct.name
                                  : "Selecciona un producto"}
                              </span>
                              <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent
                            className="w-[--radix-popover-trigger-width] p-0"
                            align="start"
                          >
                            <Command>
                              <CommandInput placeholder="Buscar producto..." />
                              <CommandList>
                                <CommandEmpty>Sin resultados.</CommandEmpty>
                                <CommandGroup>
                                  {products.map((product) => (
                                    <CommandItem
                                      key={product.id}
                                      value={`${product.name} ${product.barcode} ${product.sku ?? ""}`}
                                      onSelect={() => {
                                        setProductId(product.id);
                                        setProductPickerOpen(false);
                                      }}
                                    >
                                      <span className="truncate">
                                        {product.name}
                                      </span>
                                    </CommandItem>
                                  ))}
                                </CommandGroup>
                              </CommandList>
                            </Command>
                          </PopoverContent>
                        </Popover>
                      </div>
                      <div className="space-y-1">
                        <Label>Cantidad</Label>
                        <Input
                          type="number"
                          min={0.001}
                          step="0.001"
                          value={quantity}
                          onChange={(event) => setQuantity(event.target.value)}
                        />
                      </div>
                      {selectedProduct && (
                        <p className="text-sm text-muted-foreground">
                          Pérdida estimada:{" "}
                          <span className="font-semibold text-foreground">
                            {formatMoney(previewLoss)}
                          </span>{" "}
                          (costo del producto al momento de guardar)
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="space-y-1">
                      <Label>Pérdida estimada (opcional)</Label>
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={estimatedLoss}
                        onChange={(event) =>
                          setEstimatedLoss(event.target.value)
                        }
                        placeholder="0.00"
                      />
                    </div>
                  )}

                  <div className="space-y-1">
                    <Label>Notas</Label>
                    <Textarea
                      value={notes}
                      onChange={(event) => setNotes(event.target.value)}
                      placeholder="Describe qué pasó..."
                    />
                  </div>
                </div>
                <DialogFooter>
                  <DemoGuardedButton
                    variant="brand"
                    disabled={isSaving}
                    onAllowedClick={handleSave}
                  >
                    {isSaving ? "Guardando..." : "Guardar"}
                  </DemoGuardedButton>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        }
      />

      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Input
              type="date"
              className="w-44"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              aria-label="Desde"
            />
            <Input
              type="date"
              className="w-44"
              value={to}
              onChange={(event) => setTo(event.target.value)}
              aria-label="Hasta"
            />
            {hasMultiple && (
              <Select value={locationFilter} onValueChange={setLocationFilter}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todas las sucursales</SelectItem>
                  {locations.map((loc) => (
                    <SelectItem key={loc.id} value={loc.id}>
                      {loc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={reasonFilter} onValueChange={setReasonFilter}>
              <SelectTrigger className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los motivos</SelectItem>
                {REASON_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isManager && (
              <Select value={employeeFilter} onValueChange={setEmployeeFilter}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="Empleado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los empleados</SelectItem>
                  {Object.entries(profileNames).map(([id, name]) => (
                    <SelectItem key={id} value={id}>
                      {name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  {hasMultiple && <TableHead>Sucursal</TableHead>}
                  {isManager && <TableHead>Empleado</TableHead>}
                  <TableHead>Producto</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead className="text-right">Pérdida</TableHead>
                  {isManager && <TableHead></TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell
                      colSpan={colCount}
                      className="py-8 text-center text-muted-foreground"
                    >
                      Cargando mermas...
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && mermas.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={colCount}>
                      <EmptyState
                        emoji="📦"
                        title="Sin mermas"
                        description="Aún no hay mermas registradas para este filtro."
                      />
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  mermas.map((merma) => (
                    <TableRow key={merma.id}>
                      <TableCell>
                        {new Date(merma.createdAt).toLocaleString(undefined, {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </TableCell>
                      {hasMultiple && (
                        <TableCell>
                          {locationNames[merma.locationId] ?? "—"}
                        </TableCell>
                      )}
                      {isManager && (
                        <TableCell>
                          {profileNames[merma.employeeId] ?? "—"}
                        </TableCell>
                      )}
                      <TableCell>
                        {merma.productName
                          ? `${merma.productName}${merma.quantity ? ` × ${merma.quantity}` : ""}`
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant="soft">
                          {REASON_LABELS[merma.reasonCategory] ??
                            merma.reasonCategory}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatMoney(merma.estimatedLoss)}
                      </TableCell>
                      {isManager && (
                        <TableCell>
                          <Button
                            variant="ghost"
                            size="icon"
                            aria-label="Eliminar merma"
                            onClick={() => handleDelete(merma.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}
