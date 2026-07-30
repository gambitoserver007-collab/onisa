import { createFileRoute } from "@tanstack/react-router";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Pencil,
  Plus,
  ShoppingCart,
  Trash2,
  Truck,
} from "lucide-react";
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
import { PurchaseFormSheet } from "@/components/compras/PurchaseFormSheet";
import { useBusinessSettings } from "@/hooks/useBusinessSettings";
import { useCompanyCatalog } from "@/hooks/useCompanyCatalog";
import { useDemoSession } from "@/hooks/useDemoSession";
import { blockDemoAction } from "@/lib/demoMode";
import {
  createSupplier,
  deleteSupplier,
  fetchPurchases,
  updateSupplier,
  getErrorMessage,
  type Purchase,
} from "@/services/appData";
import type { Supplier } from "@/types";

export const Route = createFileRoute("/proveedores")({
  component: Proveedores,
});

const clean = (value: string) => (value === "-" ? "" : value);

function Proveedores() {
  const { suppliers, error, source, isLoading, reload, session } =
    useCompanyCatalog();
  const { isDemo } = useDemoSession();
  const { formatMoney } = useBusinessSettings();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editing, setEditing] = useState<Supplier | null>(null);
  const [name, setName] = useState("");
  const [documentNumber, setDocumentNumber] = useState("");
  const [phone, setPhone] = useState("");
  // Expandir proveedor para ver/crear sus compras.
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [purchasesLoading, setPurchasesLoading] = useState(false);
  const [purchaseSupplierId, setPurchaseSupplierId] = useState<string | null>(
    null,
  );

  const list = useMemo(
    () =>
      suppliers.filter((supplier) =>
        supplier.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [query, suppliers],
  );

  const reloadPurchases = useCallback(async () => {
    if (!session?.companyId) return;
    setPurchasesLoading(true);
    try {
      setPurchases(await fetchPurchases(session.companyId));
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudieron cargar las compras."));
    } finally {
      setPurchasesLoading(false);
    }
  }, [session?.companyId]);

  useEffect(() => {
    void reloadPurchases();
  }, [reloadPurchases]);

  const purchasesBySupplier = useMemo(() => {
    const map = new Map<string, Purchase[]>();
    for (const purchase of purchases) {
      if (!purchase.supplierId) continue;
      const arr = map.get(purchase.supplierId) ?? [];
      arr.push(purchase);
      map.set(purchase.supplierId, arr);
    }
    return map;
  }, [purchases]);

  const openCreate = () => {
    setEditing(null);
    setName("");
    setDocumentNumber("");
    setPhone("");
    setOpen(true);
  };

  const openEdit = (supplier: Supplier) => {
    setEditing(supplier);
    setName(supplier.name);
    setDocumentNumber(clean(supplier.ruc));
    setPhone(clean(supplier.phone));
    setOpen(true);
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
        await updateSupplier(editing.id, { name, documentNumber, phone });
        toast.success("Proveedor actualizado.");
      } else {
        await createSupplier(session, { name, documentNumber, phone });
        toast.success("Proveedor creado.");
      }
      setOpen(false);
      await reload();
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo guardar el proveedor."));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (supplier: Supplier) => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    if (
      !window.confirm(
        `¿Eliminar al proveedor "${supplier.name}"? Esta acción no se puede deshacer.`,
      )
    ) {
      return;
    }
    try {
      await deleteSupplier(supplier.id);
      toast.success("Proveedor eliminado.");
      await reload();
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo eliminar el proveedor."));
    }
  };

  return (
    <AppShell>
      <PageHeader
        title="Proveedores"
        description="Tus proveedores y lo que les compras."
        eyebrow="Contactos"
        icon={Truck}
        actions={
          <Button variant="brand" onClick={openCreate}>
            <Plus className="mr-1 h-4 w-4" /> Nuevo proveedor
          </Button>
        }
      />
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing ? "Editar proveedor" : "Nuevo proveedor"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Razón social</Label>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Documento fiscal</Label>
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
          </div>
          <DialogFooter>
            <Button
              variant="brand"
              disabled={isSaving || !name.trim()}
              onClick={handleSave}
            >
              {isSaving ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <FallbackNotice show={!!error && source === "demo-fallback"}>
        No se pudo leer Supabase todavía. Mostrando proveedores de prueba.
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
                  <TableHead className="w-10"></TableHead>
                  <TableHead>Razón social</TableHead>
                  <TableHead>Documento</TableHead>
                  <TableHead>Teléfono</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell
                      colSpan={5}
                      className="py-8 text-center text-muted-foreground"
                    >
                      Cargando proveedores...
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && list.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5}>
                      <EmptyState
                        emoji="🚚"
                        title="Sin proveedores"
                        description="Aún no hay proveedores que coincidan con tu búsqueda."
                      />
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  list.map((supplier) => {
                    const expanded = expandedId === supplier.id;
                    const supplierPurchases =
                      purchasesBySupplier.get(supplier.id) ?? [];
                    return (
                      <Fragment key={supplier.id}>
                        <TableRow
                          className="cursor-pointer"
                          onClick={() =>
                            setExpandedId(expanded ? null : supplier.id)
                          }
                        >
                          <TableCell>
                            {expanded ? (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            )}
                          </TableCell>
                          <TableCell className="font-medium">
                            {supplier.name}
                          </TableCell>
                          <TableCell>{supplier.ruc}</TableCell>
                          <TableCell>{supplier.phone}</TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`Editar ${supplier.name}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                openEdit(supplier);
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              aria-label={`Eliminar ${supplier.name}`}
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={(event) => {
                                event.stopPropagation();
                                void handleDelete(supplier);
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                        {expanded && (
                          <TableRow className="bg-muted/30">
                            <TableCell colSpan={5} className="p-4">
                              <div className="mb-3 flex items-center justify-between">
                                <p className="text-sm font-semibold">
                                  Lo que le has comprado
                                </p>
                                <Button
                                  size="sm"
                                  variant="brand"
                                  onClick={() =>
                                    setPurchaseSupplierId(supplier.id)
                                  }
                                >
                                  <ShoppingCart className="mr-1 h-4 w-4" />{" "}
                                  Nueva compra
                                </Button>
                              </div>
                              {purchasesLoading ? (
                                <p className="text-sm text-muted-foreground">
                                  Cargando compras...
                                </p>
                              ) : supplierPurchases.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                  Aún no le has comprado nada. Usa “Nueva
                                  compra” para registrar la primera.
                                </p>
                              ) : (
                                <div className="overflow-x-auto rounded-md border bg-background">
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead>N°</TableHead>
                                        <TableHead>Fecha</TableHead>
                                        <TableHead>N° factura</TableHead>
                                        <TableHead className="text-right">
                                          Total
                                        </TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {supplierPurchases.map((purchase) => (
                                        <TableRow key={purchase.id}>
                                          <TableCell className="font-mono text-xs">
                                            {purchase.number}
                                          </TableCell>
                                          <TableCell>{purchase.date}</TableCell>
                                          <TableCell>
                                            {purchase.document || "—"}
                                          </TableCell>
                                          <TableCell className="text-right font-medium">
                                            {formatMoney(purchase.total)}
                                          </TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Registrar una compra al proveedor (panel encima). */}
      <PurchaseFormSheet
        open={!!purchaseSupplierId}
        onOpenChange={(value) => !value && setPurchaseSupplierId(null)}
        supplierId={purchaseSupplierId ?? ""}
        onSaved={reloadPurchases}
      />
    </AppShell>
  );
}
