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
import { useSales } from "@/hooks/useSales";
import {
  fetchCompanyProfile,
  fetchProfileNames,
  fetchSaleLoyaltySummary,
  type CompanyProfile,
} from "@/services/appData";

export const Route = createFileRoute("/ventas/$id")({
  // "from=pos": se llegó aquí recién cobrando en el POS -- Volver/Imprimir
  // regresan ahí para seguir vendiendo, en vez de ir a la lista de ventas.
  validateSearch: (s: Record<string, unknown>): { from?: "pos" } =>
    s.from === "pos" ? { from: "pos" } : {},
  component: VentaDetail,
});

function VentaDetail() {
  const { id } = Route.useParams();
  const { from } = Route.useSearch();
  const navigate = useNavigate();
  const { formatMoney, settings } = useBusinessSettings();
  const { session } = useDemoSession();
  const { locations } = useCurrentLocation();
  const { findSale, isLoading, error, source } = useSales();
  const sale = findSale(id);

  const [companyProfile, setCompanyProfile] = useState<CompanyProfile | null>(
    null,
  );
  const [cashierName, setCashierName] = useState<string | null>(null);
  const [loyalty, setLoyalty] = useState({ earned: 0, redeemed: 0 });

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

  const ticketLocation = sale?.locationId
    ? (locations.find((loc) => loc.id === sale.locationId) ?? null)
    : null;
  const showLogo = ticketLocation?.ticketShowLogo ?? true;
  const showFiscalInfo = ticketLocation?.ticketShowFiscalInfo ?? true;
  const showCashierName = ticketLocation?.ticketShowCashierName ?? false;
  const showTaxBreakdown = ticketLocation?.ticketShowTaxBreakdown ?? true;
  const showLoyaltyPoints = ticketLocation?.ticketShowLoyaltyPoints ?? true;
  const showPaymentMethod = ticketLocation?.ticketShowPaymentMethod ?? true;
  const footerText = ticketLocation?.ticketFooterText ?? null;

  return (
    <AppShell>
      <div className="mx-auto max-w-md">
        <FallbackNotice show={!!error && source === "demo-fallback"}>
          No se pudo leer Supabase todavía. Mostrando ventas de prueba.
        </FallbackNotice>
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
            <Card
              id="receipt-print"
              className="animate-fade-up overflow-hidden rounded-2xl shadow-card"
            >
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
