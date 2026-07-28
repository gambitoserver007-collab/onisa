import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { Pencil, Plus, Trash2, Users } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { FallbackNotice } from "@/components/layout/FallbackNotice";
import { EmptyState } from "@/components/layout/EmptyState";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useCompanyCatalog } from "@/hooks/useCompanyCatalog";
import { useDemoSession } from "@/hooks/useDemoSession";
import { blockDemoAction } from "@/lib/demoMode";
import {
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
  const { customers, error, source, isLoading, reload, session } = useCompanyCatalog();
  const { isDemo } = useDemoSession();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [name, setName] = useState("");
  const [documentNumber, setDocumentNumber] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  // Cliente cuya dirección estamos cargando; evita que un fetch lento sobrescriba
  // la dirección de otro cliente si el usuario abre otro registro rápido.
  const editingIdRef = useRef<string | null>(null);
  const [addressLoading, setAddressLoading] = useState(false);
  const list = useMemo(
    () => customers.filter((customer) => customer.name.toLowerCase().includes(query.toLowerCase())),
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
    setOpen(true);
  };

  const openEdit = async (customer: Customer) => {
    editingIdRef.current = customer.id;
    setEditing(customer);
    setName(customer.name);
    setDocumentNumber(clean(customer.doc));
    setPhone(clean(customer.phone));
    setAddress("");
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
    setIsSaving(true);

    try {
      if (editing) {
        await updateCustomer(editing.id, { name, documentNumber, phone, address });
        toast.success("Cliente actualizado.");
      } else {
        await createCustomer(session, { name, documentNumber, phone, address });
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

  const handleDelete = async (customer: Customer) => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    if (
      !window.confirm(`¿Eliminar al cliente "${customer.name}"? Esta acción no se puede deshacer.`)
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
            <DialogTitle>{editing ? "Editar cliente" : "Nuevo cliente"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Nombre</Label>
              <Input value={name} onChange={(event) => setName(event.target.value)} />
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
              <Input value={phone} onChange={(event) => setPhone(event.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Dirección</Label>
              <Input
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="Calle, número, distrito..."
              />
            </div>
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
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      Cargando clientes...
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && list.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4}>
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
                      <TableCell className="font-medium">{customer.name}</TableCell>
                      <TableCell>{customer.doc}</TableCell>
                      <TableCell>{customer.phone}</TableCell>
                      <TableCell className="text-right">
                        <Button size="icon" variant="ghost" onClick={() => void openEdit(customer)}>
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
    </AppShell>
  );
}
