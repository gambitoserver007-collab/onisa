import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ChevronsUpDown, PackageCheck, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { FallbackNotice } from "@/components/layout/FallbackNotice";
import { EmptyState } from "@/components/layout/EmptyState";
import { ProductSearchDialog } from "@/components/pos/ProductSearchDialog";
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
  createApartado,
  fetchApartados,
  getErrorMessage,
  type Apartado,
  type ApartadoStatus,
} from "@/services/appData";
import type { Product } from "@/types";

export const Route = createFileRoute("/apartados")({
  component: ApartadosPage,
});

function statusBadge(apartado: Apartado) {
  const isOverdue =
    apartado.status === "activo" &&
    apartado.dueDate < new Date().toISOString().slice(0, 10);
  if (isOverdue) return <Badge variant="destructive">Vencido</Badge>;
  if (apartado.status === "completado")
    return <Badge variant="success">Completado</Badge>;
  if (apartado.status === "cancelado")
    return <Badge variant="secondary">Cancelado</Badge>;
  return <Badge variant="warm">Activo</Badge>;
}

function defaultDueDate() {
  const d = new Date();
  d.setDate(d.getDate() + 30);
  return d.toISOString().slice(0, 10);
}

interface ApartadoCartItem {
  productId: string;
  name: string;
  price: number;
  qty: number;
}

function ApartadosPage() {
  const { formatMoney, settings } = useBusinessSettings();
  const { session, isDemo } = useDemoSession();
  const { products, customers } = useCompanyCatalog();
  const { locations, currentLocationId, hasMultiple } = useCurrentLocation();

  const [apartados, setApartados] = useState<Apartado[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | ApartadoStatus>(
    "all",
  );

  const load = async () => {
    if (!session?.companyId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchApartados(session.companyId, {
        status: statusFilter === "all" ? undefined : statusFilter,
      });
      setApartados(data);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.companyId, statusFilter]);

  // --- Formulario de nuevo apartado ---
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [locationId, setLocationId] = useState("");
  const [dueDate, setDueDate] = useState(defaultDueDate());
  const [depositAmount, setDepositAmount] = useState("0");
  const [paymentMethod, setPaymentMethod] = useState("Efectivo");
  const [cart, setCart] = useState<ApartadoCartItem[]>([]);
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCustomerId(null);
    setLocationId(
      currentLocationId && currentLocationId !== ALL_LOCATIONS
        ? currentLocationId
        : (locations[0]?.id ?? ""),
    );
    setDueDate(defaultDueDate());
    setDepositAmount("0");
    setPaymentMethod("Efectivo");
    setCart([]);
  }, [open, currentLocationId, locations]);

  const selectedCustomer = customers.find((c) => c.id === customerId) ?? null;

  const addToCart = (product: Product) => {
    if (product.hasVariants) {
      toast.error(
        "Por ahora los apartados no admiten productos con variantes.",
      );
      return;
    }
    if (product.productType === "service") {
      toast.error("Por ahora los servicios no se pueden apartar.");
      return;
    }
    setCart((prev) => {
      const existing = prev.find((item) => item.productId === product.id);
      if (existing) {
        return prev.map((item) =>
          item.productId === product.id ? { ...item, qty: item.qty + 1 } : item,
        );
      }
      return [
        ...prev,
        {
          productId: product.id,
          name: product.name,
          price: product.price,
          qty: 1,
        },
      ];
    });
    setProductSearchOpen(false);
  };

  const cartTotal = useMemo(
    () => cart.reduce((sum, item) => sum + item.price * item.qty, 0),
    [cart],
  );
  const minDeposit = useMemo(
    () => Math.round(cartTotal * settings.apartadoMinDepositPct * 100) / 100,
    [cartTotal, settings.apartadoMinDepositPct],
  );

  const handleSave = async () => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    if (!customerId) {
      toast.error("Elige el cliente que aparta.");
      return;
    }
    if (cart.length === 0) {
      toast.error("Agrega al menos un producto.");
      return;
    }
    if (!locationId) {
      toast.error("Elige la sucursal donde se reserva el producto.");
      return;
    }
    setIsSaving(true);
    try {
      await createApartado({
        customerId,
        items: cart.map((item) => ({
          productId: item.productId,
          qty: item.qty,
        })),
        locationId,
        depositAmount: Number(depositAmount) || 0,
        dueDate,
        paymentMethod,
      });
      toast.success("Apartado creado.");
      setOpen(false);
      void load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AppShell>
      <PageHeader
        eyebrow="Operaciones"
        icon={PackageCheck}
        title="Apartados"
        description="El cliente reserva mercancía y la paga en abonos."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="brand">
                <Plus className="mr-1 h-4 w-4" /> Nuevo apartado
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Nuevo apartado</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>Cliente</Label>
                    <Popover
                      open={customerPickerOpen}
                      onOpenChange={setCustomerPickerOpen}
                    >
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          role="combobox"
                          className="w-full justify-between font-normal"
                        >
                          <span className="truncate">
                            {selectedCustomer
                              ? selectedCustomer.name
                              : "Selecciona un cliente"}
                          </span>
                          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent
                        className="w-[--radix-popover-trigger-width] p-0"
                        align="start"
                      >
                        <Command>
                          <CommandInput placeholder="Buscar cliente..." />
                          <CommandList>
                            <CommandEmpty>Sin resultados.</CommandEmpty>
                            <CommandGroup>
                              {customers.map((customer) => (
                                <CommandItem
                                  key={customer.id}
                                  value={customer.name}
                                  onSelect={() => {
                                    setCustomerId(customer.id);
                                    setCustomerPickerOpen(false);
                                  }}
                                >
                                  {customer.name}
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          </CommandList>
                        </Command>
                      </PopoverContent>
                    </Popover>
                    <p className="text-xs text-muted-foreground">
                      Se requiere un cliente registrado para poder apartar.
                    </p>
                  </div>
                  {hasMultiple && (
                    <div className="space-y-1">
                      <Label>Sucursal</Label>
                      <Select value={locationId} onValueChange={setLocationId}>
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
                  <div className="space-y-1">
                    <Label>Fecha límite</Label>
                    <Input
                      type="date"
                      value={dueDate}
                      onChange={(event) => setDueDate(event.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <Label>Productos</Label>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setProductSearchOpen(true)}
                    >
                      <Plus className="mr-1 h-4 w-4" /> Agregar producto
                    </Button>
                  </div>
                  <div className="max-h-64 overflow-y-auto rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Producto</TableHead>
                          <TableHead className="w-24 text-right">
                            Precio
                          </TableHead>
                          <TableHead className="w-24 text-right">
                            Cant.
                          </TableHead>
                          <TableHead className="w-28 text-right">
                            Total
                          </TableHead>
                          <TableHead className="w-10"></TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {cart.length === 0 && (
                          <TableRow>
                            <TableCell
                              colSpan={5}
                              className="py-6 text-center text-muted-foreground"
                            >
                              Sin productos todavía.
                            </TableCell>
                          </TableRow>
                        )}
                        {cart.map((item) => (
                          <TableRow key={item.productId}>
                            <TableCell className="font-medium">
                              {item.name}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatMoney(item.price)}
                            </TableCell>
                            <TableCell>
                              <Input
                                type="number"
                                min={1}
                                step="1"
                                className="text-right"
                                value={item.qty}
                                onChange={(event) => {
                                  const qty = Number(event.target.value);
                                  setCart((prev) =>
                                    prev.map((row) =>
                                      row.productId === item.productId
                                        ? { ...row, qty }
                                        : row,
                                    ),
                                  );
                                }}
                              />
                            </TableCell>
                            <TableCell className="text-right font-semibold">
                              {formatMoney(item.price * item.qty)}
                            </TableCell>
                            <TableCell>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                aria-label={`Quitar ${item.name}`}
                                onClick={() =>
                                  setCart((prev) =>
                                    prev.filter(
                                      (row) => row.productId !== item.productId,
                                    ),
                                  )
                                }
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                  <p className="pt-1 text-right text-sm text-muted-foreground">
                    Total: {formatMoney(cartTotal)}
                    {minDeposit > 0 && (
                      <>
                        {" "}
                        · Anticipo mínimo:{" "}
                        <span className="font-semibold text-foreground">
                          {formatMoney(minDeposit)}
                        </span>
                      </>
                    )}
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>Anticipo</Label>
                    <Input
                      type="number"
                      min={0}
                      step="0.01"
                      value={depositAmount}
                      onChange={(event) => setDepositAmount(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Método de pago del anticipo</Label>
                    <Select
                      value={paymentMethod}
                      onValueChange={setPaymentMethod}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Efectivo">Efectivo</SelectItem>
                        <SelectItem value="Tarjeta">Tarjeta</SelectItem>
                        <SelectItem value="Transferencia">
                          Transferencia
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="brand"
                  disabled={isSaving || cart.length === 0 || !customerId}
                  onClick={handleSave}
                >
                  {isSaving ? "Guardando..." : "Crear apartado"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <FallbackNotice show={!!error}>
        No se pudieron cargar los apartados. {error}
      </FallbackNotice>

      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Select
              value={statusFilter}
              onValueChange={(v) =>
                setStatusFilter(v as "all" | ApartadoStatus)
              }
            >
              <SelectTrigger className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los estados</SelectItem>
                <SelectItem value="activo">Activo</SelectItem>
                <SelectItem value="completado">Completado</SelectItem>
                <SelectItem value="cancelado">Cancelado</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Folio</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Fecha límite</TableHead>
                  <TableHead>Productos</TableHead>
                  <TableHead className="text-right">Pagado / Total</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="py-8 text-center text-muted-foreground"
                    >
                      Cargando apartados...
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && apartados.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8}>
                      <EmptyState
                        emoji="📦"
                        title="Sin apartados"
                        description="Crea tu primer apartado con el botón “Nuevo apartado”."
                      />
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  apartados.map((apartado) => (
                    <TableRow key={apartado.id}>
                      <TableCell className="font-mono text-xs">
                        {apartado.number}
                      </TableCell>
                      <TableCell>{apartado.date}</TableCell>
                      <TableCell>{apartado.customerName}</TableCell>
                      <TableCell>{apartado.dueDate}</TableCell>
                      <TableCell
                        className="max-w-xs truncate text-sm text-muted-foreground"
                        title={apartado.itemsLabel}
                      >
                        {apartado.itemsLabel}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatMoney(apartado.paidTotal)} /{" "}
                        {formatMoney(apartado.total)}
                      </TableCell>
                      <TableCell>{statusBadge(apartado)}</TableCell>
                      <TableCell className="text-right">
                        <Link to="/apartados/$id" params={{ id: apartado.id }}>
                          <Button variant="ghost" size="sm">
                            Ver
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <ProductSearchDialog
        open={productSearchOpen}
        onOpenChange={setProductSearchOpen}
        products={products}
        onSelect={addToCart}
      />
    </AppShell>
  );
}
