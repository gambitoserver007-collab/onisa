import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ChevronsUpDown, FileText, Plus, Trash2 } from "lucide-react";
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
  createQuote,
  fetchQuotes,
  getErrorMessage,
  type Quote,
  type QuoteStatus,
} from "@/services/appData";
import type { Product } from "@/types";

export const Route = createFileRoute("/cotizaciones")({
  component: CotizacionesPage,
});

function statusBadge(quote: Quote) {
  const isExpired =
    quote.status === "pendiente" &&
    quote.validUntil < new Date().toISOString().slice(0, 10);
  if (isExpired) return <Badge variant="destructive">Vencida</Badge>;
  if (quote.status === "convertida")
    return <Badge variant="success">Convertida</Badge>;
  if (quote.status === "rechazada")
    return <Badge variant="secondary">Rechazada</Badge>;
  return <Badge variant="warm">Pendiente</Badge>;
}

function defaultValidUntil() {
  const d = new Date();
  d.setDate(d.getDate() + 15);
  return d.toISOString().slice(0, 10);
}

interface QuoteCartItem {
  productId: string;
  name: string;
  price: number;
  qty: number;
}

function CotizacionesPage() {
  const { formatMoney } = useBusinessSettings();
  const { session, isDemo } = useDemoSession();
  const { products, customers } = useCompanyCatalog();
  const { locations, currentLocationId, hasMultiple } = useCurrentLocation();

  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | QuoteStatus>("all");

  const load = async () => {
    if (!session?.companyId) return;
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchQuotes(session.companyId, {
        status: statusFilter === "all" ? undefined : statusFilter,
      });
      setQuotes(data);
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

  // --- Formulario de nueva cotización ---
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [customerPickerOpen, setCustomerPickerOpen] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [locationId, setLocationId] = useState("");
  const [validUntil, setValidUntil] = useState(defaultValidUntil());
  const [notes, setNotes] = useState("");
  const [cart, setCart] = useState<QuoteCartItem[]>([]);
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setCustomerId(null);
    setCustomerName("");
    setLocationId(
      currentLocationId && currentLocationId !== ALL_LOCATIONS
        ? currentLocationId
        : (locations[0]?.id ?? ""),
    );
    setValidUntil(defaultValidUntil());
    setNotes("");
    setCart([]);
  }, [open, currentLocationId, locations]);

  const selectedCustomer = customers.find((c) => c.id === customerId) ?? null;

  const addToCart = (product: Product) => {
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

  const handleSave = async () => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    if (cart.length === 0) {
      toast.error("Agrega al menos un producto.");
      return;
    }
    if (!validUntil) {
      toast.error("Elige hasta cuándo es válida la cotización.");
      return;
    }
    setIsSaving(true);
    try {
      await createQuote({
        items: cart.map((item) => ({
          productId: item.productId,
          qty: item.qty,
        })),
        customerId,
        customerName: customerId ? undefined : customerName || undefined,
        locationId: locationId || undefined,
        validUntil,
        notes: notes.trim() || undefined,
      });
      toast.success("Cotización creada.");
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
        icon={FileText}
        title="Cotizaciones"
        description="Presupuestos con precio congelado, convertibles en venta."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="brand">
                <Plus className="mr-1 h-4 w-4" /> Nueva cotización
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Nueva cotización</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label>Cliente (opcional)</Label>
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
                              : "Sin cliente registrado"}
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
                              <CommandItem
                                value="sin-cliente"
                                onSelect={() => {
                                  setCustomerId(null);
                                  setCustomerPickerOpen(false);
                                }}
                              >
                                Sin cliente registrado
                              </CommandItem>
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
                  </div>
                  {!customerId && (
                    <div className="space-y-1">
                      <Label>Nombre (si no está registrado)</Label>
                      <Input
                        value={customerName}
                        onChange={(event) =>
                          setCustomerName(event.target.value)
                        }
                        placeholder="Cliente"
                      />
                    </div>
                  )}
                  {hasMultiple && (
                    <div className="space-y-1">
                      <Label>Sucursal (opcional)</Label>
                      <Select value={locationId} onValueChange={setLocationId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Sin asignar" />
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
                    <Label>Válida hasta</Label>
                    <Input
                      type="date"
                      value={validUntil}
                      onChange={(event) => setValidUntil(event.target.value)}
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
                                min={0.001}
                                step="0.001"
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
                    Total estimado:{" "}
                    <span className="font-semibold text-foreground">
                      {formatMoney(cartTotal)}
                    </span>
                  </p>
                </div>

                <div className="space-y-1">
                  <Label>Notas (opcional)</Label>
                  <Textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    placeholder="Condiciones, tiempo de entrega, etc."
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="brand"
                  disabled={isSaving || cart.length === 0}
                  onClick={handleSave}
                >
                  {isSaving ? "Guardando..." : "Crear cotización"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />

      <FallbackNotice show={!!error}>
        No se pudieron cargar las cotizaciones. {error}
      </FallbackNotice>

      <Card>
        <CardContent className="p-4">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Select
              value={statusFilter}
              onValueChange={(v) => setStatusFilter(v as "all" | QuoteStatus)}
            >
              <SelectTrigger className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los estados</SelectItem>
                <SelectItem value="pendiente">Pendiente</SelectItem>
                <SelectItem value="convertida">Convertida</SelectItem>
                <SelectItem value="rechazada">Rechazada</SelectItem>
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
                  <TableHead>Válida hasta</TableHead>
                  <TableHead>Productos</TableHead>
                  <TableHead className="text-right">Total</TableHead>
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
                      Cargando cotizaciones...
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && quotes.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8}>
                      <EmptyState
                        emoji="🧾"
                        title="Sin cotizaciones"
                        description="Crea tu primera cotización con el botón “Nueva cotización”."
                      />
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  quotes.map((quote) => (
                    <TableRow key={quote.id}>
                      <TableCell className="font-mono text-xs">
                        {quote.number}
                      </TableCell>
                      <TableCell>{quote.date}</TableCell>
                      <TableCell>{quote.customerName}</TableCell>
                      <TableCell>{quote.validUntil}</TableCell>
                      <TableCell
                        className="max-w-xs truncate text-sm text-muted-foreground"
                        title={quote.itemsLabel}
                      >
                        {quote.itemsLabel}
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        {formatMoney(quote.total)}
                      </TableCell>
                      <TableCell>{statusBadge(quote)}</TableCell>
                      <TableCell className="text-right">
                        <Link to="/cotizaciones/$id" params={{ id: quote.id }}>
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
        allowOutOfStock
      />
    </AppShell>
  );
}
