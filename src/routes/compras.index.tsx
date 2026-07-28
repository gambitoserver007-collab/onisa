import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { Plus, Truck } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useBusinessSettings } from "@/hooks/useBusinessSettings";
import { useDemoSession } from "@/hooks/useDemoSession";
import { fetchPurchases, type Purchase, getErrorMessage } from "@/services/appData";

export const Route = createFileRoute("/compras/")({ component: Compras });

function Compras() {
  const { formatMoney } = useBusinessSettings();
  const { session, isReady } = useDemoSession();
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      setPurchases(await fetchPurchases(session?.companyId));
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudieron cargar las compras."));
    } finally {
      setIsLoading(false);
    }
  }, [session?.companyId]);

  useEffect(() => {
    if (!isReady) return;
    void reload();
  }, [isReady, reload]);

  return (
    <AppShell>
      <PageHeader
        eyebrow="Abastecimiento"
        icon={Truck}
        title="Compras"
        description="Registro de compras a proveedores."
        actions={
          <Link to="/compras/nueva">
            <Button variant="brand">
              <Plus className="mr-1 h-4 w-4" /> Nueva Compra
            </Button>
          </Link>
        }
      />
      <Card>
        <CardContent className="p-4">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>N°</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Proveedor</TableHead>
                  <TableHead>Documento</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                      Cargando compras...
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && purchases.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <EmptyState
                        emoji="📦"
                        title="Sin compras"
                        description="Aún no hay compras registradas a proveedores."
                      />
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  purchases.map((purchase) => (
                    <TableRow key={purchase.id}>
                      <TableCell className="font-mono">{purchase.number}</TableCell>
                      <TableCell>{purchase.date}</TableCell>
                      <TableCell>{purchase.supplier}</TableCell>
                      <TableCell>
                        {purchase.document ? (
                          <Badge variant="soft">{purchase.document}</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums">
                        {formatMoney(purchase.total)}
                      </TableCell>
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
