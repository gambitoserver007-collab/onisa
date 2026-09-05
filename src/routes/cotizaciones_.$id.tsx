import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Printer, XCircle } from "lucide-react";
import { toast } from "sonner";
import { DemoGuardedButton } from "@/components/demo/DemoGuardedButton";
import { AppShell } from "@/components/layout/AppShell";
import { FallbackNotice } from "@/components/layout/FallbackNotice";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useBusinessSettings } from "@/hooks/useBusinessSettings";
import { useCompanyCatalog } from "@/hooks/useCompanyCatalog";
import { useCurrentLocation } from "@/hooks/useCurrentLocation";
import { useDemoSession } from "@/hooks/useDemoSession";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import { ALL_LOCATIONS } from "@/lib/currentLocation";
import { blockDemoAction } from "@/lib/demoMode";
import {
  convertQuoteToSale,
  fetchQuote,
  getErrorMessage,
  rejectQuote,
  type Quote,
  type QuoteItem,
} from "@/services/appData";

export const Route = createFileRoute("/cotizaciones_/$id")({
  component: CotizacionDetail,
});

function isExpired(quote: Quote) {
  return (
    quote.status === "pendiente" &&
    quote.validUntil < new Date().toISOString().slice(0, 10)
  );
}

function CotizacionDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { formatMoney, settings } = useBusinessSettings();
  const { isDemo } = useDemoSession();
  const { customers } = useCompanyCatalog();
  const { locations, currentLocationId, hasMultiple } = useCurrentLocation();
  const { activeMethods } = usePaymentMethods(settings.countryCode);

  const [quote, setQuote] = useState<Quote | null>(null);
  const [items, setItems] = useState<QuoteItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await fetchQuote(id);
      setQuote(result?.quote ?? null);
      setItems(result?.items ?? []);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const handleReject = async () => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    if (!window.confirm("¿Marcar esta cotización como rechazada?")) return;
    try {
      await rejectQuote(id);
      toast.success("Cotización rechazada.");
      void load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  // --- Convertir a venta ---
  const [convertOpen, setConvertOpen] = useState(false);
  const [convertLocationId, setConvertLocationId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Efectivo");
  const [pointsToRedeem, setPointsToRedeem] = useState("0");
  const [isConverting, setIsConverting] = useState(false);

  useEffect(() => {
    if (!convertOpen || !quote) return;
    setConvertLocationId(
      quote.locationId ||
        (currentLocationId && currentLocationId !== ALL_LOCATIONS
          ? currentLocationId
          : (locations[0]?.id ?? "")),
    );
    setPaymentMethod(activeMethods[0]?.label ?? "Efectivo");
    setPointsToRedeem("0");
  }, [convertOpen, quote, currentLocationId, locations, activeMethods]);

  const quoteCustomer = quote?.customerId
    ? (customers.find((c) => c.id === quote.customerId) ?? null)
    : null;
  const canRedeemPoints =
    settings.loyaltyEnabled && (quoteCustomer?.loyaltyPoints ?? 0) > 0;
  const maxRedeemablePoints = quote
    ? Math.max(
        0,
        Math.min(
          quoteCustomer?.loyaltyPoints ?? 0,
          settings.loyaltyPointValue > 0
            ? Math.floor(quote.total / settings.loyaltyPointValue)
            : 0,
        ),
      )
    : 0;

  const handleConvert = async () => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    if (!quote) return;
    if (!convertLocationId) {
      toast.error("Elige la sucursal donde se entrega esta venta.");
      return;
    }
    setIsConverting(true);
    try {
      const result = await convertQuoteToSale({
        quoteId: quote.id,
        locationId: convertLocationId,
        paymentMethod,
        pointsRedeemed: Number(pointsToRedeem) || 0,
      });
      toast.success(`Venta ${result.saleNumber} creada.`);
      setConvertOpen(false);
      navigate({ to: "/ventas/$id", params: { id: result.saleId } });
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setIsConverting(false);
    }
  };

  const expired = quote ? isExpired(quote) : false;

  return (
    <AppShell>
      <div className="mx-auto max-w-md">
        <FallbackNotice show={!!error}>
          No se pudo cargar la cotización. {error}
        </FallbackNotice>
        {isLoading && (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              Cargando cotización...
            </CardContent>
          </Card>
        )}
        {!isLoading && !quote && (
          <Card>
            <CardContent className="space-y-4 p-6 text-center">
              <p className="text-sm text-muted-foreground">
                No se encontró esta cotización.
              </p>
              <Link to="/cotizaciones">
                <Button variant="outline">Volver</Button>
              </Link>
            </CardContent>
          </Card>
        )}
        {!isLoading && quote && (
          <>
            <Card
              id="cotizacion-print"
              className="animate-fade-up overflow-hidden rounded-2xl shadow-card"
            >
              <div className="bg-brand-gradient px-6 py-5 text-center text-primary-foreground">
                {settings.logoUrl && (
                  <img
                    src={settings.logoUrl}
                    alt=""
                    className="mx-auto mb-2 h-12 w-12 rounded-full object-cover"
                  />
                )}
                <p className="text-lg font-black tracking-tight">
                  {settings.businessName}
                </p>
                <p className="text-xs opacity-90">Cotización</p>
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                  <Badge
                    variant="soft"
                    className="bg-white/20 text-primary-foreground"
                  >
                    {quote.number}
                  </Badge>
                </div>
              </div>
              <CardContent className="space-y-4 p-6 text-sm">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{quote.date}</span>
                  <span>
                    Válida hasta{" "}
                    <strong className={expired ? "text-destructive" : ""}>
                      {quote.validUntil}
                    </strong>
                  </span>
                </div>
                <div className="rounded-xl bg-muted/50 p-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Cliente</span>
                    <span className="font-medium text-foreground">
                      {quote.customerName}
                    </span>
                  </div>
                </div>
                <div className="space-y-2">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className="flex items-center justify-between gap-2 border-b border-dashed border-border/60 pb-2 last:border-0 last:pb-0"
                    >
                      <span className="text-foreground">
                        <span className="font-semibold text-primary">
                          {item.qty}×
                        </span>{" "}
                        {item.productName}
                        {item.variantLabel && (
                          <span className="block text-xs text-muted-foreground">
                            {item.variantLabel}
                          </span>
                        )}
                      </span>
                      <span className="font-medium tabular-nums">
                        {formatMoney(item.total)}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="space-y-1 border-t pt-3 text-sm">
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal</span>
                    <span className="tabular-nums">
                      {formatMoney(quote.subtotal)}
                    </span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>{settings.taxName}</span>
                    <span className="tabular-nums">
                      {formatMoney(quote.tax)}
                    </span>
                  </div>
                  <div className="mt-2 flex items-end justify-between border-t pt-3">
                    <span className="text-sm font-semibold text-foreground">
                      Total
                    </span>
                    <span className="text-gradient text-2xl font-black tabular-nums">
                      {formatMoney(quote.total)}
                    </span>
                  </div>
                </div>
                {quote.notes && (
                  <p className="border-t pt-3 text-xs text-muted-foreground">
                    {quote.notes}
                  </p>
                )}
                <p className="border-t pt-3 text-center text-xs text-muted-foreground">
                  Precios sujetos a cambio después de la fecha de vigencia.
                </p>
              </CardContent>
            </Card>

            <div className="mt-4 flex gap-2">
              <Link to="/cotizaciones" className="flex-1">
                <Button variant="outline" className="w-full">
                  Volver
                </Button>
              </Link>
              <DemoGuardedButton
                variant="outline"
                className="flex-1"
                onAllowedClick={() => window.print()}
              >
                <Printer className="mr-1 h-4 w-4" /> Imprimir
              </DemoGuardedButton>
            </div>

            {quote.status === "pendiente" && (
              <div className="mt-2 flex gap-2">
                <Button
                  variant="outline"
                  className="flex-1 text-destructive hover:text-destructive"
                  onClick={handleReject}
                >
                  <XCircle className="mr-1 h-4 w-4" /> Rechazar
                </Button>
                <Dialog open={convertOpen} onOpenChange={setConvertOpen}>
                  <DialogTrigger asChild>
                    <Button
                      variant="brand"
                      className="flex-1"
                      disabled={expired}
                    >
                      Convertir a venta
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Convertir a venta</DialogTitle>
                    </DialogHeader>
                    <div className="space-y-3">
                      <p className="text-sm text-muted-foreground">
                        Se cobrará al precio congelado de esta cotización:{" "}
                        <span className="font-semibold text-foreground">
                          {formatMoney(quote.total)}
                        </span>
                        . Se pagará en una sola forma de pago (sin dividir el
                        pago entre varios métodos).
                      </p>
                      {hasMultiple && (
                        <div className="space-y-1">
                          <Label>Sucursal</Label>
                          <Select
                            value={convertLocationId}
                            onValueChange={setConvertLocationId}
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
                      <div className="space-y-1">
                        <Label>Método de pago</Label>
                        <Select
                          value={paymentMethod}
                          onValueChange={setPaymentMethod}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {activeMethods.map((method) => (
                              <SelectItem key={method.id} value={method.label}>
                                {method.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      {canRedeemPoints && (
                        <div className="space-y-1">
                          <Label>
                            Puntos a canjear (máx. {maxRedeemablePoints})
                          </Label>
                          <Input
                            type="number"
                            min={0}
                            max={maxRedeemablePoints}
                            value={pointsToRedeem}
                            onChange={(event) =>
                              setPointsToRedeem(event.target.value)
                            }
                          />
                        </div>
                      )}
                    </div>
                    <DialogFooter>
                      <Button
                        variant="brand"
                        disabled={isConverting}
                        onClick={handleConvert}
                      >
                        {isConverting ? "Convirtiendo..." : "Confirmar venta"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            )}

            {quote.status === "convertida" && quote.convertedSaleId && (
              <div className="mt-2">
                <Link
                  to="/ventas/$id"
                  params={{ id: quote.convertedSaleId }}
                  className="block"
                >
                  <Button variant="outline" className="w-full">
                    Ver venta generada
                  </Button>
                </Link>
              </div>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
