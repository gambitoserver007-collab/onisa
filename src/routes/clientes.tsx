import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { Pencil, Plus, Trash2, Users, Wallet } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { FallbackNotice } from "@/components/layout/FallbackNotice";
import { EmptyState } from "@/components/layout/EmptyState";
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
import { useCompanyCatalog } from "@/hooks/useCompanyCatalog";
import { useDemoSession } from "@/hooks/useDemoSession";
import { blockDemoAction } from "@/lib/demoMode";
import {
  collectCustomerCredit,
  createCustomer,
  deleteCustomer,
  getCustomerAddress,
  updateCustomer,
  getErrorMessage,
} from "@/services/appData";
import type { Customer } from "@/types";

export const Route = createFileRoute("/clientes")({ component: Clientes });

const clean = (value: string) => (value === "-" ? "" : value);

function Clientes() {
  const { customers, error, source, isLoading, reload, session } =
    useCompanyCatalog();
  const { isDemo, role } = useDemoSession();
  const { formatMoney, settings } = useBusinessSettings();
  const isAdmin = role === "admin";
  const showLoyalty = settings.loyaltyEnabled;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [name, setName] = useState("");
  const [documentNumber, setDocumentNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [creditLimit, setCreditLimit] = useState("");
  const [collectTarget, setCollectTarget] = useState<Customer | null>(null);
  const [collectAmount, setCollectAmount] = useState("");
  const [collectMethod, setCollectMethod] = useState("Efectivo");
  const [isCollecting, setIsCollecting] = useState(false);
  // Cliente cuya dirección estamos cargando; evita que un fetch lento sobrescriba
  // la dirección de otro cliente si el usuario abre otro registro rápido.
  const editingIdRef = useRef<string | null>(null);
  const [addressLoading, setAddressLoading] = useState(false);
  const list = useMemo(
    () =>
      customers.filter((customer) =>
        customer.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [customers, query],
  );

  const openCreate = () => {
    editingIdRef.current = null;
    setAddressLoading(false);
    setEditing(null);
    setName("");
    setDocumentNumber("");
    setPhone("");
    setAddress("");
    setCreditLimit("");
    setOpen(true);
  };

  const openEdit = async (customer: Customer) => {
    editingIdRef.current = customer.id;
    setEditing(customer);
    setName(customer.name);
    setDocumentNumber(clean(customer.doc));
    setPhone(clean(customer.phone));
    setAddress("");
    setCreditLimit(customer.creditLimit ? String(customer.creditLimit) : "");
    setAddressLoading(true);
    setOpen(true);
    const addr = await getCustomerAddress(customer.id);
    // Solo aplica si seguimos editando a ese mismo cliente (descarta resultados obsoletos).
    if (editingIdRef.current === customer.id) {
      setAddress(addr);
      setAddressLoading(false);
    }
  };

  const handleSave = async () => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    if (!session) return;
    let creditLimitNum: number | undefined;
    if (isAdmin) {
      creditLimitNum = creditLimit.trim() ? Number(creditLimit) : 0;
      if (!Number.isFinite(creditLimitNum) || creditLimitNum < 0) {
        toast.error("El límite de crédito debe ser un número positivo.");
        return;
      }
    }
    setIsSaving(true);

    try {
      if (editing) {
        await updateCustomer(editing.id, {
          name,
          documentNumber,
          phone,
          address,
          creditLimit: creditLimitNum,
        });
        toast.success("Cliente actualizado.");
      } else {
        await createCustomer(session, {
          name,
          documentNumber,
          phone,
          address,
          creditLimit: creditLimitNum,
        });
        toast.success("Cliente creado.");
      }
      setOpen(false);
      await reload();
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo guardar el cliente."));
    } finally {
      setIsSaving(false);
    }
  };

  const handleCollectCredit = async () => {
    if (!collectTarget) return;
    if (isDemo) {
      blockDemoAction();
      return;
    }
    const amount = Number(collectAmount);
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error("Ingresa un monto válido.");
      return;
    }
    setIsCollecting(true);
    try {
      const result = await collectCustomerCredit(
        collectTarget.id,
        amount,
        collectMethod,
        collectMethod === "Efectivo" ? "cash" : "other",
      );
      toast.success(
        `Se registró ${formatMoney(result.applied)}. Saldo restante: ${formatMoney(result.remainingBalance)}.`,
      );
      setCollectTarget(null);
      setCollectAmount("");
      await reload();
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo registrar el pago."));
    } finally {
      setIsCollecting(false);
    }
  };

  const handleDelete = async (customer: Customer) => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    if (
      !window.confirm(
        `¿Eliminar al cliente "${customer.name}"? Esta acción no se puede deshacer.`,
      )
    ) {
      return;
    }
    try {
      await deleteCustomer(customer.id);
      toast.success("Cliente eliminado.");
      await reload();
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo eliminar el cliente."));
    }
  };

  return (
    <AppShell>
      <PageHeader
        title="Clientes"
        description="Base de clientes."
        eyebrow="Contactos"
        icon={Users}
        actions={
          <Button variant="brand" onClick={openCreate}>
            <Plus className="mr-1 h-4 w-4" /> Nuevo cliente
          </Button>
        }
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? "Editar cliente" : "Nuevo cliente"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Nombre</Label>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Documento</Label>
              <Input
                value={documentNumber}
                onChange={(event) => setDocumentNumber(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Teléfono</Label>
              <Input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Dirección</Label>
              <Input
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="Calle, número, distrito..."
              />
            </div>
            {isAdmin && (
              <div className="space-y-1">
                <Label>Límite de crédito ("fiado")</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={creditLimit}
                  onChange={(event) => setCreditLimit(event.target.value)}
                  placeholder="0 = sin crédito habilitado"
                />
                {editing && (editing.creditBalance ?? 0) > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Saldo pendiente actual:{" "}
                    {formatMoney(editing.creditBalance ?? 0)}
                  </p>
                )}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="brand"
              disabled={isSaving || !name.trim() || addressLoading}
              onClick={handleSave}
            >
              {isSaving ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <FallbackNotice show={!!error && source === "demo-fallback"}>
        No se pudo leer Supabase todavía. Mostrando clientes de prueba.
      </FallbackNotice>
      <Card>
        <CardContent className="p-4">
          <Input
            className="mb-3 max-w-sm"
            placeholder="Buscar..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Documento</TableHead>
                  <TableHead>Teléfono</TableHead>
                  <TableHead>Crédito</TableHead>
                  {showLoyalty && <TableHead>Puntos</TableHead>}
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell
                      colSpan={showLoyalty ? 6 : 5}
                      className="py-8 text-center text-muted-foreground"
                    >
                      Cargando clientes...
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && list.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={showLoyalty ? 6 : 5}>
                      <EmptyState
                        emoji="🧑‍🤝‍🧑"
                        title="Sin clientes"
                        description="Aún no hay clientes que coincidan con tu búsqueda."
                      />
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  list.map((customer) => (
                    <TableRow key={customer.id}>
                      <TableCell className="font-medium">
                        {customer.name}
                      </TableCell>
                      <TableCell>{customer.doc}</TableCell>
                      <TableCell>{customer.phone}</TableCell>
                      <TableCell>
                        {(customer.creditLimit ?? 0) > 0 ? (
                          <Badge
                            variant={
                              (customer.creditBalance ?? 0) > 0
                                ? "destructive"
                                : "secondary"
                            }
                          >
                            {formatMoney(customer.creditBalance ?? 0)} /{" "}
                            {formatMoney(customer.creditLimit ?? 0)}
                          </Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </TableCell>
                      {showLoyalty && (
                        <TableCell>
                          <span className="font-medium tabular-nums">
                            {customer.loyaltyPoints ?? 0}
                          </span>
                        </TableCell>
                      )}
                      <TableCell className="text-right">
                        {(customer.creditBalance ?? 0) > 0 && (
                          <Button
                            size="icon"
                            variant="ghost"
                            title="Registrar pago"
                            onClick={() => {
                              setCollectTarget(customer);
                              setCollectAmount("");
                              setCollectMethod("Efectivo");
                            }}
                          >
                            <Wallet className="h-4 w-4" />
                          </Button>
                        )}
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => void openEdit(customer)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => handleDelete(customer)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={!!collectTarget}
        onOpenChange={(isOpen) => !isOpen && setCollectTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Registrar pago de {collectTarget?.name}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Saldo pendiente:{" "}
              <span className="font-semibold text-foreground">
                {formatMoney(collectTarget?.creditBalance ?? 0)}
              </span>
            </p>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label>Monto</Label>
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={collectAmount}
                  onChange={(event) => setCollectAmount(event.target.value)}
                  autoFocus
                />
              </div>
              <div className="space-y-1">
                <Label>Método</Label>
                <Select value={collectMethod} onValueChange={setCollectMethod}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Efectivo">Efectivo</SelectItem>
                    <SelectItem value="Tarjeta de débito">
                      Tarjeta de débito
                    </SelectItem>
                    <SelectItem value="Transferencia bancaria">
                      Transferencia bancaria
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="brand"
              disabled={isCollecting || !collectAmount.trim()}
              onClick={handleCollectCredit}
            >
              {isCollecting ? "Guardando..." : "Registrar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
