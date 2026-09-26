import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Inbox, Plus, Trash2 } from "lucide-react";
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
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
import { useDemoSession } from "@/hooks/useDemoSession";
import { blockDemoAction } from "@/lib/demoMode";
import {
  createQuote,
  discardQuoteRequest,
  fetchQuoteRequests,
  resolveQuoteRequest,
  getErrorMessage,
  type QuoteRequest,
  type QuoteRequestItem,
} from "@/services/appData";
import type { Product } from "@/types";

export const Route = createFileRoute("/cotizaciones_/solicitudes")({
  component: SolicitudesPage,
});

interface CartItem {
  productId: string;
  name: string;
  price: number;
  qty: number;
}

function defaultValidUntil() {
  const d = new Date();
  d.setDate(d.getDate() + 15);

  return d.toISOString().slice(0, 10);
}

function statusBadge(status: QuoteRequest["status"]) {
  if (status === "atendida") return <Badge variant="success">Atendida</Badge>;

  if (status === "descartada")
    return <Badge variant="secondary">Descartada</Badge>;

  return <Badge variant="warm">Nueva</Badge>;
}

function SolicitudesPage() {
  const { formatMoney } = useBusinessSettings();
  const { session, isDemo } = useDemoSession();
  const { products } = useCompanyCatalog();

  const [requests, setRequests] = useState<QuoteRequest[]>([]);
  const [itemsByRequest, setItemsByRequest] = useState<
    Map<string, QuoteRequestItem[]>
  >(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    if (!session?.companyId) return;
    setIsLoading(true);
    setError(null);

    try {
      const data = await fetchQuoteRequests(session.companyId);

      setRequests(data.requests);
      setItemsByRequest(data.itemsByRequest);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.companyId]);

  const sorted = useMemo(
    () =>
      requests.slice().sort((a, b) => {
        if (a.status === b.status) return b.date.localeCompare(a.date);

        return a.status === "nueva" ? -1 : b.status === "nueva" ? 1 : 0;
      }),
    [requests],
  );

  // --- Convertir a cotización ---
  const [converting, setConverting] = useState<QuoteRequest | null>(null);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [customerName, setCustomerName] = useState("");
  const [validUntil, setValidUntil] = useState(defaultValidUntil());
  const [notes, setNotes] = useState("");
  const [productSearchOpen, setProductSearchOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [skippedCount, setSkippedCount] = useState(0);

  const openConvert = (request: QuoteRequest) => {
    const items = itemsByRequest.get(request.id) ?? [];
    const productById = new Map(products.map((p) => [p.id, p]));
    const resolved: CartItem[] = [];
    let skipped = 0;

    items.forEach((item) => {
      const product = item.productId ? productById.get(item.productId) : null;

      if (!product) {
        skipped += 1;

        return;
      }

      resolved.push({
        productId: product.id,
        name: product.name,
        price: product.price,
        qty: item.qty,
      });
    });

    setConverting(request);
    setCart(resolved);
    setSkippedCount(skipped);
    setCustomerName(request.customerName);
    setValidUntil(defaultValidUntil());
    setNotes(request.notes ?? "");
  };

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

  const handleConvert = async () => {
    if (!converting) return;

    if (isDemo) {
      blockDemoAction();

      return;
    }

    if (cart.length === 0) {
      toast.error("Agrega al menos un producto.");

      return;
    }

    setIsSaving(true);

    try {
      const quote = await createQuote({
        items: cart.map((item) => ({
          productId: item.productId,
          qty: item.qty,
        })),
        customerName: customerName || undefined,
        validUntil,
        notes: notes.trim() || undefined,
      });
      await resolveQuoteRequest(converting.id, quote.quoteId);
      toast.success(`Cotización ${quote.quoteNumber} creada.`);
      setConverting(null);
      void load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDiscard = async (request: QuoteRequest) => {
    if (isDemo) {
      blockDemoAction();

      return;
    }

    if (!window.confirm(`¿Descartar la solicitud de ${request.customerName}?`))
      return;

    try {
      await discardQuoteRequest(request.id);
      toast.success("Solicitud descartada.");
      void load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  return (
    <AppShell>
      <PageHeader
        eyebrow="Operaciones"
        icon={Inbox}
        title="Solicitudes en línea"
        description="Listas que los clientes arman en tu catálogo público, pendientes de revisar."
        actions={
          <Link to="/cotizaciones">
            <Button variant="outline">Ver cotizaciones</Button>
          </Link>
        }
      />

      <FallbackNotice show={!!error}>
        No se pudieron cargar las solicitudes. {error}
      </FallbackNotice>

      <Card>
        <CardContent className="p-4">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Contacto</TableHead>
                  <TableHead>Productos</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-8 text-center text-muted-foreground"
                    >
                      Cargando solicitudes...
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && sorted.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6}>
                      <EmptyState
                        emoji="📭"
                        title="Sin solicitudes"
                        description="Aquí aparecerán las listas que los clientes armen en tu catálogo en línea."
                      />
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  sorted.map((request) => (
                    <TableRow key={request.id}>
                      <TableCell>{request.date}</TableCell>
                      <TableCell className="font-medium">
                        {request.customerName}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {[request.phone, request.email]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </TableCell>
                      <TableCell
                        className="max-w-xs truncate text-sm text-muted-foreground"
                        title={request.itemsLabel}
                      >
                        {request.itemsLabel}
                      </TableCell>
                      <TableCell>{statusBadge(request.status)}</TableCell>
                      <TableCell className="text-right">
                        {request.status === "nueva" && (
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="brand"
                              size="sm"
                              onClick={() => openConvert(request)}
                            >
                              Convertir
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => void handleDiscard(request)}
                            >
                              Descartar
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={!!converting}
        onOpenChange={(next) => !next && setConverting(null)}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Convertir a cotización</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {skippedCount > 0 && (
              <p className="rounded-md bg-warm/10 p-2 text-sm text-warm-foreground">
                {skippedCount} producto(s) de la solicitud ya no están
                disponibles y no se incluyeron.
              </p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Cliente</Label>
                <Input
                  value={customerName}
                  onChange={(event) => setCustomerName(event.target.value)}
                  placeholder="Cliente"
                />
              </div>
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
                <Label>Productos (precios y stock de hoy)</Label>
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
                      <TableHead className="w-24 text-right">Precio</TableHead>
                      <TableHead className="w-24 text-right">Cant.</TableHead>
                      <TableHead className="w-28 text-right">Total</TableHead>
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
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="brand"
              disabled={isSaving || cart.length === 0}
              onClick={() => void handleConvert()}
            >
              {isSaving ? "Guardando..." : "Crear cotización"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
