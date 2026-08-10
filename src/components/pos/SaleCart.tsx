import { useState } from "react";
import {
  Minus,
  Plus,
  Search,
  ShoppingBag,
  ShoppingCart,
  Trash2,
  UserPlus,
  UserRound,
  X,
} from "lucide-react";
import type { CartItem, Customer, DocumentType, Sale } from "@/types";
import {
  PAYMENT_METHOD_KIND_LABELS,
  type PaymentMethodDefinition,
} from "@/data/paymentMethods";
import { useBusinessSettings } from "@/hooks/useBusinessSettings";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { getProductVisual } from "@/lib/productVisuals";
import { cn } from "@/lib/utils";

type SaleDocumentType = Sale["type"];
type PaymentMethod = Sale["method"];

export interface SaleCartProps {
  cart: CartItem[];
  customers: Customer[];
  customer: string;
  docType: SaleDocumentType;
  documentTypes: DocumentType[];
  method: PaymentMethod;
  paymentMethods: PaymentMethodDefinition[];
  subtotal: number;
  igv: number;
  total: number;
  isCheckingOut?: boolean;
  onCustomerChange: (value: string) => void;
  onDocTypeChange: (value: SaleDocumentType) => void;
  onMethodChange: (value: PaymentMethod) => void;
  onIncrement: (productId: string) => void;
  onDecrement: (productId: string) => void;
  onRemove: (productId: string) => void;
  onCheckout: () => void;
  onCreateCustomer?: (input: {
    name: string;
    documentNumber?: string;
    phone?: string;
    address?: string;
  }) => Promise<void>;
  /** Si el programa de puntos de lealtad está activo para esta empresa. */
  loyaltyEnabled?: boolean;
  /** Puntos que se van a canjear en esta venta (ya topados al saldo/total). */
  pointsToRedeem?: number;
  /** Descuento resultante de canjear `pointsToRedeem` (en moneda). */
  loyaltyDiscount?: number;
  /** Máximo de puntos canjeables en esta venta (saldo del cliente y total, lo que sea menor). */
  maxRedeemablePoints?: number;
  onPointsToRedeemChange?: (value: number) => void;
}

function SaleCartContent({
  cart,
  customers,
  customer,
  docType,
  documentTypes,
  method,
  paymentMethods,
  subtotal,
  igv,
  total,
  isCheckingOut = false,
  onCustomerChange,
  onDocTypeChange,
  onMethodChange,
  onIncrement,
  onDecrement,
  onRemove,
  onCheckout,
  onCreateCustomer,
  loyaltyEnabled = false,
  pointsToRedeem = 0,
  loyaltyDiscount = 0,
  maxRedeemablePoints = 0,
  onPointsToRedeemChange,
}: SaleCartProps) {
  const { formatMoney, settings } = useBusinessSettings();
  const itemCount = cart.reduce((sum, item) => sum + item.qty, 0);
  const finalTotal = Math.max(0, total - loyaltyDiscount);

  const [newOpen, setNewOpen] = useState(false);
  const [ncName, setNcName] = useState("");
  const [ncDoc, setNcDoc] = useState("");
  const [ncPhone, setNcPhone] = useState("");
  const [ncAddress, setNcAddress] = useState("");
  const [ncSaving, setNcSaving] = useState(false);
  const [customerQuery, setCustomerQuery] = useState("");
  const selectedCustomer = customers.find((item) => item.id === customer);

  // Buscador del carrito: para encontrar y quitar un producto entre muchos.
  // Aparece solo cuando hay varios ítems (no estorba en ventas pequeñas).
  const [itemFilter, setItemFilter] = useState("");
  const showItemFilter = cart.length > 5;
  const visibleCart =
    showItemFilter && itemFilter.trim()
      ? cart.filter((item) => {
          const q = itemFilter.trim().toLowerCase();
          return (
            item.name.toLowerCase().includes(q) ||
            (item.barcode ?? "").toLowerCase().includes(q)
          );
        })
      : cart;

  const submitNewCustomer = async () => {
    if (!onCreateCustomer || !ncName.trim()) return;
    setNcSaving(true);
    try {
      await onCreateCustomer({
        name: ncName.trim(),
        documentNumber: ncDoc.trim() || undefined,
        phone: ncPhone.trim() || undefined,
        address: ncAddress.trim() || undefined,
      });
      setNewOpen(false);
      setNcName("");
      setNcDoc("");
      setNcPhone("");
      setNcAddress("");
    } finally {
      setNcSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex shrink-0 items-center justify-between">
        <div className="flex items-center gap-2 text-base font-extrabold">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary">
            <ShoppingCart className="h-4.5 w-4.5" />
          </span>
          Carrito
        </div>
        <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-bold text-primary">
          {itemCount} {itemCount === 1 ? "ítem" : "ítems"}
        </span>
      </div>

      <div className="shrink-0 space-y-2.5">
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Cliente</Label>
            {onCreateCustomer && (
              <button
                type="button"
                onClick={() => setNewOpen(true)}
                className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-semibold text-primary transition hover:bg-primary/10"
              >
                <UserPlus className="h-3.5 w-3.5" /> Nuevo
              </button>
            )}
          </div>
          {selectedCustomer ? (
            // Cliente elegido: se muestra con opción de quitar (vuelve a Público general).
            <div className="flex h-11 items-center justify-between gap-2 rounded-xl border border-input bg-background px-3">
              <span className="flex min-w-0 items-center gap-2">
                <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="flex min-w-0 flex-col leading-tight">
                  <span className="truncate text-sm">
                    {selectedCustomer.name}
                  </span>
                  {selectedCustomer.doc && selectedCustomer.doc !== "-" && (
                    <span className="truncate text-xs text-muted-foreground">
                      {selectedCustomer.doc}
                    </span>
                  )}
                </span>
              </span>
              <button
                type="button"
                aria-label="Quitar cliente"
                onClick={() => {
                  onCustomerChange("");
                  setCustomerQuery("");
                }}
                className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ) : null}
          {selectedCustomer && loyaltyEnabled && (
            <div className="space-y-1.5 rounded-xl border border-dashed border-primary/30 bg-primary/5 p-2.5">
              <p className="text-xs text-muted-foreground">
                Saldo de puntos:{" "}
                <span className="font-semibold text-foreground">
                  {selectedCustomer.loyaltyPoints ?? 0}
                </span>
              </p>
              {maxRedeemablePoints > 0 && (
                <div className="flex items-center gap-2">
                  <Label className="shrink-0 text-xs">Canjear puntos</Label>
                  <Input
                    type="number"
                    min={0}
                    max={maxRedeemablePoints}
                    step={1}
                    value={pointsToRedeem || ""}
                    placeholder="0"
                    onChange={(event) => {
                      const raw = Number(event.target.value);
                      const clamped = Number.isFinite(raw)
                        ? Math.max(
                            0,
                            Math.min(maxRedeemablePoints, Math.floor(raw)),
                          )
                        : 0;
                      onPointsToRedeemChange?.(clamped);
                    }}
                    className="h-8 rounded-lg text-sm"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      onPointsToRedeemChange?.(maxRedeemablePoints)
                    }
                    className="shrink-0 text-xs font-semibold text-primary hover:underline"
                  >
                    Máx.
                  </button>
                </div>
              )}
            </div>
          )}
          {!selectedCustomer && (
            // Sin cliente (Público general): buscador visible; la lista aparece al escribir.
            <Command className="overflow-visible rounded-xl border border-input bg-background">
              <CommandInput
                placeholder="Buscar cliente por nombre o documento..."
                value={customerQuery}
                onValueChange={setCustomerQuery}
              />
              {customerQuery.trim() !== "" && (
                <CommandList className="max-h-44">
                  <CommandEmpty>Sin resultados.</CommandEmpty>
                  <CommandGroup>
                    {customers.map((item) => (
                      <CommandItem
                        key={item.id}
                        value={`${item.name} ${item.doc} ${item.id}`}
                        onSelect={() => {
                          onCustomerChange(item.id);
                          setCustomerQuery("");
                        }}
                      >
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate">{item.name}</span>
                          {item.doc && item.doc !== "-" && (
                            <span className="truncate text-xs text-muted-foreground">
                              {item.doc}
                            </span>
                          )}
                        </span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              )}
            </Command>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Comprobante</Label>
            <Select
              value={docType}
              onValueChange={(value) =>
                onDocTypeChange(value as SaleDocumentType)
              }
            >
              <SelectTrigger className="h-11 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {documentTypes.map((doc) => (
                  <SelectItem key={doc.name} value={doc.name}>
                    {doc.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Pago</Label>
            <Select
              value={method}
              onValueChange={(value) => onMethodChange(value as PaymentMethod)}
            >
              <SelectTrigger className="h-11 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {paymentMethods.map((item) => (
                  <SelectItem key={item.id} value={item.label}>
                    <span className="flex flex-col">
                      <span>{item.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {PAYMENT_METHOD_KIND_LABELS[item.kind]}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

      {showItemFilter && (
        <div className="relative shrink-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={itemFilter}
            onChange={(event) => setItemFilter(event.target.value)}
            placeholder="Buscar producto o código en el carrito..."
            className="h-9 rounded-xl pl-9 text-sm"
          />
        </div>
      )}

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1 nice-scroll">
        {cart.length === 0 && (
          <div className="grid place-items-center gap-2 rounded-2xl border border-dashed border-border bg-muted/40 py-10 text-center">
            <span className="grid h-12 w-12 place-items-center rounded-2xl bg-card text-2xl shadow-card">
              🛒
            </span>
            <p className="text-sm text-muted-foreground">
              Agrega productos para empezar.
            </p>
          </div>
        )}
        {cart.length > 0 && visibleCart.length === 0 && (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Ningún producto coincide con “{itemFilter}”.
          </p>
        )}
        {visibleCart.map((item) => {
          const visual = getProductVisual({ name: item.name, category: "" });
          const lineId = item.variantId
            ? `${item.productId}::${item.variantId}`
            : item.productId;
          return (
            <div
              key={lineId}
              className="flex animate-pop-in items-center gap-2.5 rounded-2xl border border-border/70 bg-card p-2 text-sm"
            >
              {item.image ? (
                <img
                  src={item.image}
                  alt={item.name}
                  loading="lazy"
                  className="h-11 w-11 shrink-0 rounded-xl object-cover"
                />
              ) : (
                <span
                  className={cn(
                    "grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-gradient-to-br text-xl",
                    visual.gradient,
                  )}
                >
                  {visual.emoji}
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold leading-tight">
                  {item.name}
                </p>
                {item.variantLabel && (
                  <p className="truncate text-xs font-medium text-primary">
                    {item.variantLabel}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  {formatMoney(item.price)} ·{" "}
                  {formatMoney(item.price * item.qty)}
                </p>
              </div>
              <div className="flex items-center gap-1 rounded-full bg-muted p-0.5">
                <button
                  type="button"
                  onClick={() => onDecrement(lineId)}
                  className="grid h-7 w-7 place-items-center rounded-full bg-card text-foreground shadow-sm transition active:scale-90"
                >
                  {item.qty <= 1 ? (
                    <Trash2 className="h-3.5 w-3.5" />
                  ) : (
                    <Minus className="h-3.5 w-3.5" />
                  )}
                </button>
                <span className="w-6 text-center text-sm font-bold tabular-nums">
                  {item.qty}
                </span>
                <button
                  type="button"
                  onClick={() => onIncrement(lineId)}
                  className="grid h-7 w-7 place-items-center rounded-full bg-primary text-primary-foreground shadow-sm transition active:scale-90"
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="shrink-0 space-y-2.5 rounded-2xl bg-muted/50 p-3.5 text-sm">
        <div className="flex justify-between text-muted-foreground">
          <span>Subtotal</span>
          <span className="font-medium text-foreground">
            {formatMoney(subtotal)}
          </span>
        </div>
        <div className="flex justify-between text-muted-foreground">
          <span>{settings.taxName}</span>
          <span className="font-medium text-foreground">
            {formatMoney(igv)}
          </span>
        </div>
        {loyaltyDiscount > 0 && (
          <div className="flex justify-between text-primary">
            <span>Descuento por {pointsToRedeem} puntos</span>
            <span className="font-medium">-{formatMoney(loyaltyDiscount)}</span>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-border/60 pt-2.5">
          <span className="font-semibold">Total</span>
          <span className="text-2xl font-black text-gradient">
            {formatMoney(finalTotal)}
          </span>
        </div>
      </div>

      <Button
        variant="brand"
        className="w-full shrink-0"
        size="lg"
        disabled={isCheckingOut || cart.length === 0}
        onClick={onCheckout}
      >
        {isCheckingOut ? (
          "Cobrando..."
        ) : (
          <>
            <ShoppingBag className="h-5 w-5" /> Cobrar {formatMoney(finalTotal)}
          </>
        )}
      </Button>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nuevo cliente</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Nombre *</Label>
              <Input
                autoFocus
                value={ncName}
                onChange={(event) => setNcName(event.target.value)}
                placeholder="Ej. María López"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Documento</Label>
                <Input
                  value={ncDoc}
                  onChange={(event) => setNcDoc(event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>Teléfono</Label>
                <Input
                  value={ncPhone}
                  onChange={(event) => setNcPhone(event.target.value)}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Dirección</Label>
              <Input
                value={ncAddress}
                onChange={(event) => setNcAddress(event.target.value)}
                placeholder="Calle, número, distrito..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="brand"
              disabled={ncSaving || !ncName.trim()}
              onClick={submitNewCustomer}
            >
              {ncSaving ? "Guardando..." : "Crear y seleccionar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function SaleCart({
  className,
  ...props
}: SaleCartProps & { className?: string }) {
  return (
    <Card className={cn("flex flex-col overflow-hidden", className)}>
      <CardContent className="flex min-h-0 flex-1 flex-col p-4">
        <SaleCartContent {...props} />
      </CardContent>
    </Card>
  );
}

export function MobileSaleCart(props: SaleCartProps) {
  const { formatMoney } = useBusinessSettings();
  const itemCount = props.cart.reduce((sum, item) => sum + item.qty, 0);

  return (
    <Sheet>
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-card/95 p-3 pb-safe shadow-soft backdrop-blur-xl lg:hidden">
        <div className="mx-auto flex max-w-md items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">
              Carrito · {itemCount} ítems
            </p>
            <p className="truncate text-xl font-black">
              {formatMoney(
                Math.max(0, props.total - (props.loyaltyDiscount ?? 0)),
              )}
            </p>
          </div>
          <SheetTrigger asChild>
            <Button
              variant="brand"
              className="h-12 shrink-0"
              disabled={props.cart.length === 0}
            >
              <ShoppingCart className="h-4 w-4" />
              Ver carrito
            </Button>
          </SheetTrigger>
        </div>
      </div>
      <SheetContent
        side="bottom"
        className="max-h-[90vh] overflow-y-auto rounded-t-3xl p-4 pb-6 nice-scroll"
      >
        <SheetHeader className="mb-4 text-left">
          <SheetTitle>Carrito de venta</SheetTitle>
        </SheetHeader>
        <SaleCartContent {...props} />
      </SheetContent>
    </Sheet>
  );
}
