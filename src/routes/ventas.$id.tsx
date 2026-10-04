import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Printer } from "lucide-react";
import { useEffect, useState } from "react";
import { DemoGuardedButton } from "@/components/demo/DemoGuardedButton";
import { AppShell } from "@/components/layout/AppShell";
import { FallbackNotice } from "@/components/layout/FallbackNotice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useBusinessSettings } from "@/hooks/useBusinessSettings";
import { useCurrentLocation } from "@/hooks/useCurrentLocation";
import { useDemoSession } from "@/hooks/useDemoSession";
import {
  fetchCompanyProfile,
  fetchProfileNames,
  fetchSaleById,
  fetchSaleLoyaltySummary,
  fetchTills,
  getErrorMessage,
  type CompanyProfile,
} from "@/services/appData";
import type { Sale } from "@/types";

export const Route = createFileRoute("/ventas/$id")({
  // "from=pos": se llegó aquí recién cobrando en el POS -- Volver/Imprimir
  // regresan ahí para seguir vendiendo, en vez de ir a la lista de ventas.
  validateSearch: (s: Record<string, unknown>): { from?: "pos" } =>
    s.from === "pos" ? { from: "pos" } : {},
  component: VentaDetail,
});

// Fila "etiqueta: valor" del ticket impreso -- texto plano, sin fondos ni
// bordes de color (ver nota junto a #receipt-print en ventas.$id.tsx).
function PrintRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span>{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function PrintDivider() {
  return <div className="my-1 border-t border-dashed border-black" />;
}

function VentaDetail() {
  const { id } = Route.useParams();
  const { from } = Route.useSearch();
  const navigate = useNavigate();
  const { formatMoney, settings } = useBusinessSettings();
  const { session, isReady } = useDemoSession();
  const { locations } = useCurrentLocation();

  const [sale, setSale] = useState<Sale | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(
    null,
  );

  const [cashierName, setCashierName] = useState<string | null>(null);
  const [tillName, setTillName] = useState<string | null>(null);
  const [loyalty, setLoyalty] = useState({ earned: 0, redeemed: 0 });

  // Antes se cargaban TODAS las ventas de la empresa (useSales()) solo
  // para encontrar esta una con .find() -- ahora se pide directo por
  // folio/uuid (ver fetchSaleById).
  useEffect(() => {
    if (!isReady) return;
    let active = true;
    setIsLoading(true);

    void fetchSaleById(id, session?.companyId)
      .then((result) => {
        if (!active) return;
        setSale(result);
        setError(null);
      })
      .catch((err) => {
        if (!active) return;
        setSale(null);
        setError(getErrorMessage(err, "No se pudo cargar la venta."));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [isReady, id, session?.companyId]);

  useEffect(() => {
    if (!session?.companyId) return;
    void fetchCompanyProfile(session.companyId)
      .then(setCompanyProfile)
      .catch(() => undefined);
  }, [session?.companyId]);

  useEffect(() => {
    if (!sale?.createdBy || !session?.companyId) {
      setCashierName(null);

      return;
    }

    void fetchProfileNames(session.companyId)
      .then((names) => setCashierName(names[sale.createdBy!] ?? null))
      .catch(() => setCashierName(null));
  }, [sale?.createdBy, session?.companyId]);

  useEffect(() => {
    if (!sale?.databaseId) return;
    void fetchSaleLoyaltySummary(sale.databaseId)
      .then(setLoyalty)
      .catch(() => setLoyalty({ earned: 0, redeemed: 0 }));
  }, [sale?.databaseId]);

  useEffect(() => {
    if (!sale?.tillId || !sale.locationId) {
      setTillName(null);

      return;
    }

    void fetchTills(sale.locationId)
      .then((tills) => {
        setTillName(tills.find((t) => t.id === sale.tillId)?.name ?? null);
      })
      .catch(() => setTillName(null));
  }, [sale?.tillId, sale?.locationId]);

  const ticketLocation = sale?.locationId
    ? (locations.find((loc) => loc.id === sale.locationId) ?? null)
    : null;

  const showLogo = ticketLocation?.ticketShowLogo ?? true;
  const showFiscalInfo = ticketLocation?.ticketShowFiscalInfo ?? true;
  const showCashierName = ticketLocation?.ticketShowCashierName ?? false;
  const showTaxBreakdown = ticketLocation?.ticketShowTaxBreakdown ?? true;
  const showLoyaltyPoints = ticketLocation?.ticketShowLoyaltyPoints ?? true;
  const showPaymentMethod = ticketLocation?.ticketShowPaymentMethod ?? true;
  const showTill = ticketLocation?.ticketShowTill ?? true;
  const footerText = ticketLocation?.ticketFooterText ?? null;
  const widthMm = ticketLocation?.ticketWidthMm ?? 80;

  const printDate = sale?.createdAt
    ? new Date(sale.createdAt).toLocaleDateString(settings.locale, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      })
    : (sale?.date ?? "");
  const printTime = sale?.createdAt
    ? new Date(sale.createdAt).toLocaleTimeString(settings.locale, {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";

  return (
    <AppShell>
      <div className="mx-auto max-w-md">
        <FallbackNotice show={!!error}>{error}</FallbackNotice>
        {isLoading && (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              Cargando comprobante...
            </CardContent>
          </Card>
        )}
        {!isLoading && !sale && (
          <Card>
            <CardContent className="space-y-4 p-6 text-center">
              <p className="text-sm text-muted-foreground">
                No se encontró esta venta.
              </p>
              <Link to="/ventas">
                <Button variant="outline">Volver</Button>
              </Link>
            </CardContent>
          </Card>
        )}
        {!isLoading && sale && (
          <>
            <div id="receipt-print">
              <Card className="print:hidden animate-fade-up overflow-hidden rounded-2xl shadow-card">
                <div className="bg-brand-gradient px-6 py-5 text-center text-primary-foreground">
                  {showLogo && settings.logoUrl && (
                    <img
                      src={settings.logoUrl}
                      alt=""
                      className="mx-auto mb-2 h-12 w-12 rounded-full object-cover"
                    />
                  )}
                  <p className="text-lg font-black tracking-tight">
                    {settings.businessName}
                  </p>
                  {showFiscalInfo && (
                    <>
                      <p className="text-xs opacity-90">
                        {settings.fiscalIdLabel} {settings.sampleFiscalId}
                      </p>
                      {companyProfile?.address && (
                        <p className="text-xs opacity-90">
                          {companyProfile.address}
                        </p>
                      )}
                      {companyProfile?.phone && (
                        <p className="text-xs opacity-90">
                          {companyProfile.phone}
                        </p>
                      )}
                    </>
                  )}
                  <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                    <Badge
                      variant="soft"
                      className="bg-white/20 text-primary-foreground"
                    >
                      {sale.type}
                    </Badge>
                    {showPaymentMethod && (
                      <Badge
                        variant="soft"
                        className="bg-white/20 text-primary-foreground"
                      >
                        {sale.method}
                      </Badge>
                    )}
                  </div>
                </div>
                <CardContent className="space-y-4 p-6 text-sm">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="font-mono">{sale.id}</span>
                    <span>{sale.date}</span>
                  </div>
                  <div className="rounded-xl bg-muted/50 p-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Cliente</span>
                      <span className="font-medium text-foreground">
                        {sale.customer}
                      </span>
                    </div>
                    {showPaymentMethod && (
                      <div className="mt-1 flex justify-between">
                        <span className="text-muted-foreground">Método</span>
                        <span className="font-medium text-foreground">
                          {sale.method}
                        </span>
                      </div>
                    )}
                    {showCashierName && cashierName && (
                      <div className="mt-1 flex justify-between">
                        <span className="text-muted-foreground">
                          Atendido por
                        </span>
                        <span className="font-medium text-foreground">
                          {cashierName}
                        </span>
                      </div>
                    )}
                  </div>
                  <div className="space-y-2">
                    {sale.items.map((item) => (
                      <div
                        key={`${sale.id}-${item.productId}-${item.variantLabel ?? ""}-${item.name}`}
                        className="flex items-center justify-between gap-2 border-b border-dashed border-border/60 pb-2 last:border-0 last:pb-0"
                      >
                        <span className="text-foreground">
                          <span className="font-semibold text-primary">
                            {item.qty}×
                          </span>{" "}
                          {item.name}
                          {item.variantLabel && (
                            <span className="block text-xs text-muted-foreground">
                              {item.variantLabel}
                            </span>
                          )}
                        </span>
                        <span className="font-medium tabular-nums">
                          {formatMoney(item.qty * item.price)}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-1 border-t pt-3 text-sm">
                    {showTaxBreakdown && (
                      <>
                        <div className="flex justify-between text-muted-foreground">
                          <span>Subtotal</span>
                          <span className="tabular-nums">
                            {formatMoney(sale.subtotal)}
                          </span>
                        </div>
                        <div className="flex justify-between text-muted-foreground">
                          <span>{settings.taxName}</span>
                          <span className="tabular-nums">
                            {formatMoney(sale.igv)}
                          </span>
                        </div>
                      </>
                    )}
                    {showLoyaltyPoints &&
                      (loyalty.earned > 0 || loyalty.redeemed > 0) && (
                        <>
                          {loyalty.earned > 0 && (
                            <div className="flex justify-between text-muted-foreground">
                              <span>Puntos ganados</span>
                              <span className="tabular-nums">
                                +{loyalty.earned}
                              </span>
                            </div>
                          )}
                          {loyalty.redeemed > 0 && (
                            <div className="flex justify-between text-muted-foreground">
                              <span>Puntos canjeados</span>
                              <span className="tabular-nums">
                                -{loyalty.redeemed}
                              </span>
                            </div>
                          )}
                        </>
                      )}
                    <div className="mt-2 flex items-end justify-between border-t pt-3">
                      <span className="text-sm font-semibold text-foreground">
                        Total
                      </span>
                      <span className="text-gradient text-2xl font-black tabular-nums">
                        {formatMoney(sale.total)}
                      </span>
                    </div>
                  </div>
                  {footerText && (
                    <p className="border-t pt-3 text-center text-xs text-muted-foreground">
                      {footerText}
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Versión impresa: texto plano, monoespaciado, negro sobre
                blanco -- sin gradientes ni fondos grises, que en una
                impresora térmica/de tickets salen como bloques oscuros
                tramados en vez de color plano (ver fotos del usuario,
                2026-10). La tarjeta de arriba es solo para verla en
                pantalla (print:hidden); esta es la que de verdad se manda
                a la impresora.

                @page fija el tamaño de página EXACTO al ancho real del
                papel (58/80mm, configurable por sucursal) con alto "auto"
                y sin margen del navegador -- sin esto, el navegador usa
                Carta/A4 por defecto: el contenido sale recortado de los
                lados (más ancho que el papel real) y la impresora, al
                creer que la página mide ~28cm de alto, sigue alimentando
                papel hasta "completarla" (de ahí el ~1 metro
                desperdiciado sin cortar). */}
              <style>{`@page { size: ${widthMm}mm auto; margin: 0; }`}</style>
              <div
                className="hidden print:block mx-auto font-mono text-[11px] leading-snug text-black"
                style={{ width: `${widthMm}mm`, padding: "0 2mm" }}
              >
                <div className="text-center">
                  {showLogo && settings.logoUrl && (
                    <img
                      src={settings.logoUrl}
                      alt=""
                      className="mx-auto mb-1 h-10 w-10 object-contain"
                    />
                  )}
                  <p className="text-sm font-bold">{settings.businessName}</p>
                  {showFiscalInfo && (
                    <>
                      <p>
                        {settings.fiscalIdLabel} {settings.sampleFiscalId}
                      </p>
                      {companyProfile?.address && (
                        <p>{companyProfile.address}</p>
                      )}
                      {companyProfile?.phone && (
                        <p>Tel. {companyProfile.phone}</p>
                      )}
                    </>
                  )}
                </div>

                <PrintDivider />

                <PrintRow label="Fecha" value={printDate} />
                <PrintRow label="Hora" value={printTime} />
                {showCashierName && cashierName && (
                  <PrintRow label="Cajero" value={cashierName} />
                )}
                {showTill && tillName && (
                  <PrintRow label="Caja" value={tillName} />
                )}
                <PrintRow label="Folio" value={sale.id} />

                <PrintDivider />

                <PrintRow label="Cliente" value={sale.customer} />
                <PrintRow label="Comprobante" value={sale.type} />
                {showPaymentMethod && (
                  <PrintRow label="Pago" value={sale.method} />
                )}

                <PrintDivider />

                <div className="flex justify-between font-bold">
                  <span>Cant. Descripción</span>
                  <span>Importe</span>
                </div>
                {sale.items.map((item) => (
                  <div
                    key={`print-${sale.id}-${item.productId}-${item.variantLabel ?? ""}-${item.name}`}
                    className="flex justify-between gap-2"
                  >
                    <span>
                      {item.qty} {item.name}
                      {item.variantLabel ? ` (${item.variantLabel})` : ""}
                    </span>
                    <span className="shrink-0 tabular-nums">
                      {formatMoney(item.qty * item.price)}
                    </span>
                  </div>
                ))}

                <PrintDivider />

                {showTaxBreakdown && (
                  <>
                    <PrintRow
                      label="Subtotal"
                      value={formatMoney(sale.subtotal)}
                    />
                    <PrintRow
                      label={settings.taxName}
                      value={formatMoney(sale.igv)}
                    />
                  </>
                )}
                {showLoyaltyPoints && loyalty.earned > 0 && (
                  <PrintRow
                    label="Puntos ganados"
                    value={`+${loyalty.earned}`}
                  />
                )}
                {showLoyaltyPoints && loyalty.redeemed > 0 && (
                  <PrintRow
                    label="Puntos canjeados"
                    value={`-${loyalty.redeemed}`}
                  />
                )}
                <div className="mt-1 flex justify-between text-sm font-bold">
                  <span>TOTAL</span>
                  <span>{formatMoney(sale.total)}</span>
                </div>

                <PrintDivider />

                <p className="text-center">
                  {footerText || "¡Gracias por su compra!"}
                </p>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              {from === "pos" ? (
                <Button
                  variant="outline"
                  className="flex-1"
                  onClick={() => navigate({ to: "/pos" })}
                >
                  Volver
                </Button>
              ) : (
                <Link to="/ventas" className="flex-1">
                  <Button variant="outline" className="w-full">
                    Volver
                  </Button>
                </Link>
              )}
              <DemoGuardedButton
                variant="brand"
                className="flex-1"
                onAllowedClick={() => {
                  window.print();

                  if (from === "pos") navigate({ to: "/pos" });
                }}
              >
                <Printer className="mr-1 h-4 w-4" /> Imprimir
              </DemoGuardedButton>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
