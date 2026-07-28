import { createFileRoute, Link } from "@tanstack/react-router";
import { Printer } from "lucide-react";
import { DemoGuardedButton } from "@/components/demo/DemoGuardedButton";
import { AppShell } from "@/components/layout/AppShell";
import { FallbackNotice } from "@/components/layout/FallbackNotice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useBusinessSettings } from "@/hooks/useBusinessSettings";
import { useSales } from "@/hooks/useSales";

export const Route = createFileRoute("/ventas/$id")({ component: VentaDetail });

function VentaDetail() {
  const { id } = Route.useParams();
  const { formatMoney, settings } = useBusinessSettings();
  const { findSale, isLoading, error, source } = useSales();
  const sale = findSale(id);

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
              <p className="text-sm text-muted-foreground">No se encontró esta venta.</p>
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
                <p className="text-lg font-black tracking-tight">{settings.businessName}</p>
                <p className="text-xs opacity-90">
                  {settings.fiscalIdLabel} {settings.sampleFiscalId}
                </p>
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                  <Badge variant="soft" className="bg-white/20 text-primary-foreground">
                    {sale.type}
                  </Badge>
                  <Badge variant="soft" className="bg-white/20 text-primary-foreground">
                    {sale.method}
                  </Badge>
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
                    <span className="font-medium text-foreground">{sale.customer}</span>
                  </div>
                  <div className="mt-1 flex justify-between">
                    <span className="text-muted-foreground">Método</span>
                    <span className="font-medium text-foreground">{sale.method}</span>
                  </div>
                </div>
                <div className="space-y-2">
                  {sale.items.map((item) => (
                    <div
                      key={`${sale.id}-${item.productId}-${item.variantLabel ?? ""}-${item.name}`}
                      className="flex items-center justify-between gap-2 border-b border-dashed border-border/60 pb-2 last:border-0 last:pb-0"
                    >
                      <span className="text-foreground">
                        <span className="font-semibold text-primary">{item.qty}×</span> {item.name}
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
                  <div className="flex justify-between text-muted-foreground">
                    <span>Subtotal</span>
                    <span className="tabular-nums">{formatMoney(sale.subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>{settings.taxName}</span>
                    <span className="tabular-nums">{formatMoney(sale.igv)}</span>
                  </div>
                  <div className="mt-2 flex items-end justify-between border-t pt-3">
                    <span className="text-sm font-semibold text-foreground">Total</span>
                    <span className="text-gradient text-2xl font-black tabular-nums">
                      {formatMoney(sale.total)}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
            <div className="mt-4 flex gap-2">
              <Link to="/ventas" className="flex-1">
                <Button variant="outline" className="w-full">
                  Volver
                </Button>
              </Link>
              <DemoGuardedButton
                variant="brand"
                className="flex-1"
                onAllowedClick={() => window.print()}
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
