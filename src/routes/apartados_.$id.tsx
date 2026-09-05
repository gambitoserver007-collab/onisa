import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Ban, CircleCheck, Printer } from "lucide-react";
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
import { blockDemoAction } from "@/lib/demoMode";
import {
  addApartadoPayment,
  cancelApartado,
  completeApartado,
  fetchApartado,
  getErrorMessage,
  type Apartado,
  type ApartadoItem,
  type ApartadoPayment,
} from "@/services/appData";

export const Route = createFileRoute("/apartados_/$id")({
  component: ApartadoDetail,
});

function isOverdue(apartado: Apartado) {
  return (
    apartado.status === "activo" &&
    apartado.dueDate < new Date().toISOString().slice(0, 10)
  );
}

function ApartadoDetail() {
  const { id } = Route.useParams();
  const navigate = useNavigate();
  const { formatMoney, settings } = useBusinessSettings();
  const { isDemo, role } = useDemoSession();
  const canCancel = role === "admin" || role === "finanzas";

  const [apartado, setApartado] = useState<Apartado | null>(null);
  const [items, setItems] = useState<ApartadoItem[]>([]);
  const [payments, setPayments] = useState<ApartadoPayment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await fetchApartado(id);
      setApartado(result?.apartado ?? null);
      setItems(result?.items ?? []);
      setPayments(result?.payments ?? []);
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

  const remaining = apartado ? apartado.total - apartado.paidTotal : 0;
  const overdue = apartado ? isOverdue(apartado) : false;

  // --- Registrar abono ---
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("Efectivo");
  const [isPaying, setIsPaying] = useState(false);

  useEffect(() => {
    if (!paymentOpen || !apartado) return;
    setPaymentAmount(String(Math.max(0, apartado.total - apartado.paidTotal)));
    setPaymentMethod("Efectivo");
  }, [paymentOpen, apartado]);

  const handleAddPayment = async () => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    const amount = Number(paymentAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Ingresa un monto válido.");
      return;
    }
    setIsPaying(true);
    try {
      const result = await addApartadoPayment({
        apartadoId: id,
        amount,
        paymentMethod,
      });
      toast.success(`Abono de ${formatMoney(result.applied)} registrado.`);
      setPaymentOpen(false);
      void load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setIsPaying(false);
    }
  };

  // --- Completar apartado ---
  const [completeOpen, setCompleteOpen] = useState(false);
  const [finalAmount, setFinalAmount] = useState("");
  const [finalMethod, setFinalMethod] = useState("Efectivo");
  const [isCompleting, setIsCompleting] = useState(false);

  useEffect(() => {
    if (!completeOpen || !apartado) return;
    setFinalAmount(String(Math.max(0, apartado.total - apartado.paidTotal)));
    setFinalMethod("Efectivo");
  }, [completeOpen, apartado]);

  const handleComplete = async () => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    setIsCompleting(true);
    try {
      const result = await completeApartado({
        apartadoId: id,
        finalPaymentAmount: Number(finalAmount) || 0,
        paymentMethod: finalMethod,
      });
      toast.success(`Venta ${result.saleNumber} creada.`);
      setCompleteOpen(false);
      navigate({ to: "/ventas/$id", params: { id: result.saleId } });
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setIsCompleting(false);
    }
  };

  // --- Cancelar ---
  const [cancelOpen, setCancelOpen] = useState(false);
  const [refundDeposit, setRefundDeposit] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);

  const handleCancel = async () => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    setIsCancelling(true);
    try {
      await cancelApartado({ apartadoId: id, refundDeposit });
      toast.success(
        refundDeposit
          ? "Apartado cancelado y anticipo reembolsado."
          : "Apartado cancelado.",
      );
      setCancelOpen(false);
      void load();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setIsCancelling(false);
    }
  };

  return (
    <AppShell>
      <div className="mx-auto max-w-md">
        <FallbackNotice show={!!error}>
          No se pudo cargar el apartado. {error}
        </FallbackNotice>
        {isLoading && (
          <Card>
            <CardContent className="p-6 text-center text-sm text-muted-foreground">
              Cargando apartado...
            </CardContent>
          </Card>
        )}
        {!isLoading && !apartado && (
          <Card>
            <CardContent className="space-y-4 p-6 text-center">
              <p className="text-sm text-muted-foreground">
                No se encontró este apartado.
              </p>
              <Link to="/apartados">
                <Button variant="outline">Volver</Button>
              </Link>
            </CardContent>
          </Card>
        )}
        {!isLoading && apartado && (
          <>
            <Card
              id="apartado-print"
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
                <p className="text-xs opacity-90">Apartado</p>
                <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
                  <Badge
                    variant="soft"
                    className="bg-white/20 text-primary-foreground"
                  >
                    {apartado.number}
                  </Badge>
                </div>
              </div>
              <CardContent className="space-y-4 p-6 text-sm">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{apartado.date}</span>
                  <span>
                    Fecha límite{" "}
                    <strong className={overdue ? "text-destructive" : ""}>
                      {apartado.dueDate}
                    </strong>
                  </span>
                </div>
                <div className="rounded-xl bg-muted/50 p-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Cliente</span>
                    <span className="font-medium text-foreground">
                      {apartado.customerName}
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
                      {formatMoney(apartado.subtotal)}
                    </span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>{settings.taxName}</span>
                    <span className="tabular-nums">
                      {formatMoney(apartado.tax)}
                    </span>
                  </div>
                  <div className="mt-2 flex items-end justify-between border-t pt-3">
                    <span className="text-sm font-semibold text-foreground">
                      Total
                    </span>
                    <span className="text-gradient text-2xl font-black tabular-nums">
                      {formatMoney(apartado.total)}
                    </span>
                  </div>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Pagado</span>
                    <span className="tabular-nums text-foreground">
                      {formatMoney(apartado.paidTotal)}
                    </span>
                  </div>
                  <div className="flex justify-between font-semibold">
                    <span>Saldo pendiente</span>
                    <span className="tabular-nums">
                      {formatMoney(Math.max(0, remaining))}
                    </span>
                  </div>
                </div>

                <div className="border-t pt-3">
                  <p className="mb-2 text-xs font-semibold text-muted-foreground">
                    Historial de abonos
                  </p>
                  {payments.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      Sin abonos todavía.
                    </p>
                  )}
                  {payments.length > 0 && (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Fecha</TableHead>
                          <TableHead>Método</TableHead>
                          <TableHead className="text-right">Monto</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {payments.map((payment) => (
                          <TableRow key={payment.id}>
                            <TableCell>
                              {new Date(payment.createdAt).toLocaleDateString(
                                settings.locale,
                              )}
                            </TableCell>
                            <TableCell>{payment.method}</TableCell>
                            <TableCell className="text-right">
                              {formatMoney(payment.amount)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </div>

                {apartado.notes && (
                  <p className="border-t pt-3 text-xs text-muted-foreground">
                    {apartado.notes}
                  </p>
                )}
              </CardContent>
            </Card>

            <div className="mt-4 flex gap-2">
              <Link to="/apartados" className="flex-1">
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

            {apartado.status === "activo" && (
              <>
                <div className="mt-2 flex gap-2">
                  <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
                    <DialogTrigger asChild>
                      <Button variant="outline" className="flex-1">
                        Registrar abono
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Registrar abono</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-3">
                        <p className="text-sm text-muted-foreground">
                          Saldo pendiente:{" "}
                          <span className="font-semibold text-foreground">
                            {formatMoney(Math.max(0, remaining))}
                          </span>
                        </p>
                        <div className="space-y-1">
                          <Label>Monto</Label>
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={paymentAmount}
                            onChange={(event) =>
                              setPaymentAmount(event.target.value)
                            }
                          />
                        </div>
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
                              <SelectItem value="Efectivo">Efectivo</SelectItem>
                              <SelectItem value="Tarjeta">Tarjeta</SelectItem>
                              <SelectItem value="Transferencia">
                                Transferencia
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <DialogFooter>
                        <Button
                          variant="brand"
                          disabled={isPaying}
                          onClick={handleAddPayment}
                        >
                          {isPaying ? "Guardando..." : "Registrar abono"}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>

                  <Dialog open={completeOpen} onOpenChange={setCompleteOpen}>
                    <DialogTrigger asChild>
                      <Button variant="brand" className="flex-1">
                        <CircleCheck className="mr-1 h-4 w-4" /> Completar
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>Completar apartado</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-3">
                        <p className="text-sm text-muted-foreground">
                          Si todavía falta un saldo, se cobra aquí mismo antes
                          de entregar la mercancía.
                        </p>
                        <div className="space-y-1">
                          <Label>Pago final</Label>
                          <Input
                            type="number"
                            min={0}
                            step="0.01"
                            value={finalAmount}
                            onChange={(event) =>
                              setFinalAmount(event.target.value)
                            }
                          />
                        </div>
                        {Number(finalAmount) > 0 && (
                          <div className="space-y-1">
                            <Label>Método de pago</Label>
                            <Select
                              value={finalMethod}
                              onValueChange={setFinalMethod}
                            >
                              <SelectTrigger>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="Efectivo">
                                  Efectivo
                                </SelectItem>
                                <SelectItem value="Tarjeta">Tarjeta</SelectItem>
                                <SelectItem value="Transferencia">
                                  Transferencia
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </div>
                      <DialogFooter>
                        <Button
                          variant="brand"
                          disabled={isCompleting}
                          onClick={handleComplete}
                        >
                          {isCompleting
                            ? "Completando..."
                            : "Entregar y generar venta"}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>

                {canCancel && (
                  <div className="mt-2">
                    <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
                      <DialogTrigger asChild>
                        <Button
                          variant="outline"
                          className="w-full text-destructive hover:text-destructive"
                        >
                          <Ban className="mr-1 h-4 w-4" /> Cancelar apartado
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Cancelar apartado</DialogTitle>
                        </DialogHeader>
                        <div className="space-y-3">
                          <p className="text-sm text-muted-foreground">
                            Se repondrá el stock de cada producto. El cliente ya
                            pagó{" "}
                            <span className="font-semibold text-foreground">
                              {formatMoney(apartado.paidTotal)}
                            </span>{" "}
                            de anticipo/abonos.
                          </p>
                          <Select
                            value={refundDeposit ? "si" : "no"}
                            onValueChange={(v) => setRefundDeposit(v === "si")}
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="no">
                                No reembolsar (queda como penalización)
                              </SelectItem>
                              <SelectItem value="si">
                                Reembolsar el anticipo en efectivo
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <DialogFooter>
                          <Button
                            variant="brand"
                            disabled={isCancelling}
                            onClick={handleCancel}
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          >
                            {isCancelling
                              ? "Cancelando..."
                              : "Confirmar cancelación"}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </div>
                )}
              </>
            )}

            {apartado.status === "completado" && apartado.convertedSaleId && (
              <div className="mt-2">
                <Link
                  to="/ventas/$id"
                  params={{ id: apartado.convertedSaleId }}
                  className="block"
                >
                  <Button variant="outline" className="w-full">
                    Ver venta generada
                  </Button>
                </Link>
              </div>
            )}

            {apartado.status === "cancelado" && (
              <p className="mt-3 text-center text-xs text-muted-foreground">
                {apartado.cancelRefunded
                  ? "Este apartado fue cancelado y su anticipo fue reembolsado."
                  : "Este apartado fue cancelado; el anticipo no se reembolsó."}
              </p>
            )}
          </>
        )}
      </div>
    </AppShell>
  );
}
