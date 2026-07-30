import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { ChevronsUpDown, Plus, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Checkbox } from "@/components/ui/checkbox";
import { useBusinessSettings } from "@/hooks/useBusinessSettings";
import { useDemoSession } from "@/hooks/useDemoSession";
import { useCompanyCatalog } from "@/hooks/useCompanyCatalog";
import { blockDemoAction } from "@/lib/demoMode";
import {
  createReturn,
  fetchReturns,
  fetchSales,
  fetchSaleItemsForReturn,
  type ReturnDoc,
  type SaleItemForReturn,
  getErrorMessage,
} from "@/services/appData";
import type { Sale } from "@/types";

export const Route = createFileRoute("/devoluciones")({
  component: Devoluciones,
});

const NO_SALE = "__none__";

function Devoluciones() {
  const { formatMoney } = useBusinessSettings();
  const { isDemo, session, isReady } = useDemoSession();
  const [returns, setReturns] = useState<ReturnDoc[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saleId, setSaleId] = useState<string>(NO_SALE);
  const [reason, setReason] = useState("");
  const [refundCash, setRefundCash] = useState(true);
  const [saleItems, setSaleItems] = useState<SaleItemForReturn[]>([]);
  const [itemQtys, setItemQtys] = useState<Record<string, string>>({});
  const [loadingItems, setLoadingItems] = useState(false);
  const [salePickerOpen, setSalePickerOpen] = useState(false);
  const { customers } = useCompanyCatalog();
  // Documento/cédula por id de cliente, para buscar la venta por cédula.
  const docByCustomerId = new Map(customers.map((c) => [c.id, c.doc]));
  const selectedSale =
    sales.find((s) => (s.databaseId ?? s.id) === saleId) ?? null;

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      const [returnsData, salesData] = await Promise.all([
        fetchReturns(session?.companyId),
        fetchSales(session?.companyId),
      ]);
      setReturns(returnsData);
      setSales(salesData);
    } catch (error) {
      toast.error(
        getErrorMessage(error, "No se pudieron cargar las devoluciones."),
      );
    } finally {
      setIsLoading(false);
    }
  }, [session?.companyId]);

  useEffect(() => {
    if (!isReady) return;
    void reload();
  }, [isReady, reload]);

  useEffect(() => {
    if (saleId === NO_SALE) {
      setSaleItems([]);
      setItemQtys({});
      return;
    }
    setLoadingItems(true);
    fetchSaleItemsForReturn(saleId)
      .then((items) => {
        setSaleItems(items);
        setItemQtys({});
      })
      .catch((err) =>
        toast.error(
          getErrorMessage(err, "No se pudieron cargar los renglones."),
        ),
      )
      .finally(() => setLoadingItems(false));
  }, [saleId]);

  const computedTotal = saleItems.reduce((sum, item) => {
    const qty = Number(itemQtys[item.id] ?? 0);
    if (!qty || qty <= 0) return sum;
    return sum + qty * item.unitPrice;
  }, 0);
  const computedUnits = saleItems.reduce((sum, item) => {
    const qty = Number(itemQtys[item.id] ?? 0);
    return sum + (qty > 0 ? qty : 0);
  }, 0);

  const handleCreate = async () => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    if (!session) return;
    if (saleId === NO_SALE) {
      toast.error("Selecciona la venta asociada a la nota de crédito.");
      return;
    }
    let overError: string | null = null;
    const items = saleItems
      .map((item) => {
        const qty = Number(itemQtys[item.id] ?? 0);
        if (!qty || qty <= 0) return null;
        const max = item.qty - item.alreadyReturned;
        if (qty > max + 0.0005) {
          overError = `No puedes devolver más de ${max} unidades de ${item.productName}.`;
          return null;
        }
        return {
          saleItemId: item.id,
          productId: item.productId ?? "",
          variantId: item.variantId,
          qty,
          unitPrice: item.unitPrice,
        };
      })
      .filter(
        (it): it is NonNullable<typeof it> =>
          it !== null && Boolean(it.productId),
      );
    if (overError) {
      toast.error(overError);
      return;
    }
    if (items.length === 0) {
      toast.error("Indica la cantidad a devolver en al menos un renglón.");
      return;
    }
    setIsSaving(true);
    try {
      await createReturn(session, {
        saleId,
        reason,
        items,
        refundCash,
      });
      toast.success("Devolución registrada.");
      setSaleId(NO_SALE);
      setReason("");
      setRefundCash(true);
      setItemQtys({});
      setOpen(false);
      await reload();
    } catch (error) {
      toast.error(
        getErrorMessage(error, "No se pudo registrar la devolución."),
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <AppShell>
      <PageHeader
        eyebrow="Operaciones"
        icon={Undo2}
        title="Devoluciones"
        description="Notas de crédito y reembolsos."
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="brand">
                <Plus className="mr-1 h-4 w-4" /> Nueva devolución
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Registrar devolución</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div className="space-y-1">
                  <Label>Venta</Label>
                  <Popover
                    open={salePickerOpen}
                    onOpenChange={setSalePickerOpen}
                  >
                    <PopoverTrigger asChild>
                      <Button
                        type="button"
                        variant="outline"
                        role="combobox"
                        className="w-full justify-between font-normal"
                      >
                        <span className="truncate">
                          {selectedSale
                            ? `${selectedSale.id} — ${selectedSale.customer}`
                            : "Selecciona una venta"}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent
                      className="w-[--radix-popover-trigger-width] p-0"
                      align="start"
                    >
                      <Command>
                        <CommandInput placeholder="Buscar por venta, cliente o cédula..." />
                        <CommandList>
                          <CommandEmpty>Sin resultados.</CommandEmpty>
                          <CommandGroup>
                            {sales.map((sale) => {
                              const doc = sale.customerId
                                ? (docByCustomerId.get(sale.customerId) ?? "")
                                : "";
                              return (
                                <CommandItem
                                  key={sale.databaseId ?? sale.id}
                                  value={`${sale.id} ${sale.customer} ${doc}`}
                                  onSelect={() => {
                                    setSaleId(sale.databaseId ?? sale.id);
                                    setSalePickerOpen(false);
                                  }}
                                >
                                  <span className="truncate">
                                    {sale.id} — {sale.customer}
                                    {doc ? ` · ${doc}` : ""}
                                  </span>
                                </CommandItem>
                              );
                            })}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </div>

                {saleId !== NO_SALE && (
                  <div className="space-y-1">
                    <Label>Renglones a devolver</Label>
                    <div className="max-h-64 overflow-auto rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Producto</TableHead>
                            <TableHead className="text-right">Precio</TableHead>
                            <TableHead className="text-right">
                              Vendidos
                            </TableHead>
                            <TableHead className="text-right">
                              Máx. a devolver
                            </TableHead>
                            <TableHead className="w-28 text-right">
                              Devolver (uds.)
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {loadingItems && (
                            <TableRow>
                              <TableCell
                                colSpan={5}
                                className="text-center text-muted-foreground"
                              >
                                Cargando renglones...
                              </TableCell>
                            </TableRow>
                          )}
                          {!loadingItems &&
                            saleItems.map((item) => {
                              const max = item.qty - item.alreadyReturned;
                              return (
                                <TableRow key={item.id}>
                                  <TableCell>
                                    <div className="font-medium">
                                      {item.productName}
                                    </div>
                                    {item.variantLabel && (
                                      <div className="text-xs text-muted-foreground">
                                        {item.variantLabel}
                                      </div>
                                    )}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {formatMoney(item.unitPrice)}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {item.qty}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    {max}
                                  </TableCell>
                                  <TableCell className="text-right">
                                    <Input
                                      type="number"
                                      min={0}
                                      max={max}
                                      step="0.001"
                                      disabled={max <= 0}
                                      value={itemQtys[item.id] ?? ""}
                                      onChange={(e) => {
                                        const v = e.target.value;
                                        const n = Number(v);
                                        // Limita a [0, disponible]: no se puede devolver/reembolsar
                                        // más unidades de las que se vendieron.
                                        const clamped =
                                          v === ""
                                            ? ""
                                            : !Number.isFinite(n) || n < 0
                                              ? "0"
                                              : n > max
                                                ? String(max)
                                                : v;
                                        setItemQtys((prev) => ({
                                          ...prev,
                                          [item.id]: clamped,
                                        }));
                                      }}
                                      placeholder="0"
                                    />
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                        </TableBody>
                      </Table>
                    </div>
                    <div className="pt-1 text-right text-sm text-muted-foreground">
                      Recibes de vuelta{" "}
                      <span className="font-semibold text-foreground">
                        {computedUnits}
                      </span>{" "}
                      unidad(es) · Reembolsas{" "}
                      <span className="font-semibold text-foreground">
                        {formatMoney(computedTotal)}
                      </span>
                    </div>
                  </div>
                )}

                <div className="space-y-1">
                  <Label>Motivo</Label>
                  <Textarea
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    placeholder="Describe el motivo..."
                  />
                </div>

                <label className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={refundCash}
                    onCheckedChange={(v) => setRefundCash(v === true)}
                  />
                  Reembolsar en efectivo (si hay caja abierta en la sucursal)
                </label>
              </div>
              <DialogFooter>
                <Button
                  variant="brand"
                  disabled={isSaving || !reason.trim() || saleId === NO_SALE}
                  onClick={handleCreate}
                >
                  {isSaving ? "Guardando..." : "Guardar"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
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
                  <TableHead>Venta</TableHead>
                  <TableHead>Motivo</TableHead>
                  <TableHead>Devuelto</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-8 text-center text-muted-foreground"
                    >
                      Cargando devoluciones...
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && returns.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <EmptyState
                        emoji="↩️"
                        title="Sin devoluciones"
                        description="Aún no has registrado notas de crédito o reembolsos."
                      />
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  returns.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-mono">{item.number}</TableCell>
                      <TableCell>{item.date}</TableCell>
                      <TableCell className="font-mono">
                        {item.saleNumber}
                      </TableCell>
                      <TableCell>{item.reason}</TableCell>
                      <TableCell className="text-sm">
                        {item.itemsLabel}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatMoney(item.total)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="success">Procesada</Badge>
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
