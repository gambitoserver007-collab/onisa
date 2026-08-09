import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Package, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DemoGuardedButton } from "@/components/demo/DemoGuardedButton";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { FallbackNotice } from "@/components/layout/FallbackNotice";
import { EmptyState } from "@/components/layout/EmptyState";
import { ProductFormSheet } from "@/components/productos/ProductFormSheet";
import { useBusinessSettings } from "@/hooks/useBusinessSettings";
import { useCompanyCatalog } from "@/hooks/useCompanyCatalog";
import { useDemoSession } from "@/hooks/useDemoSession";
import { blockDemoAction } from "@/lib/demoMode";
import { canManageCatalog } from "@/lib/permissions";
import { getProductImage, getProductVisual } from "@/lib/productVisuals";
import { cn } from "@/lib/utils";
import { deleteProduct, getErrorMessage } from "@/services/appData";
import type { Product } from "@/types";

export const Route = createFileRoute("/productos")({
  component: ProductosPage,
});

function ProductosPage() {
  const { formatMoney } = useBusinessSettings();
  const { products, suppliers, error, source, isLoading, reload, session } =
    useCompanyCatalog();
  const { isDemo } = useDemoSession();
  const canManage = canManageCatalog(session?.role);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Product | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const list = useMemo(
    () =>
      products.filter(
        (product) =>
          product.name.toLowerCase().includes(query.toLowerCase()) ||
          product.barcode.includes(query) ||
          (product.sku?.toLowerCase().includes(query.toLowerCase()) ?? false),
      ),
    [products, query],
  );

  const supplierName = useMemo(
    () => new Map(suppliers.map((supplier) => [supplier.id, supplier.name])),
    [suppliers],
  );

  const openCreate = () => {
    setEditingProduct(null);
    setOpen(true);
  };

  const openEdit = (product: Product) => {
    setEditingProduct(product);
    setOpen(true);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    if (isDemo) {
      blockDemoAction();
      setDeleteTarget(null);
      return;
    }
    setIsDeleting(true);
    try {
      await deleteProduct(deleteTarget.id);
      toast.success("Producto eliminado.");
      setDeleteTarget(null);
      await reload();
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo eliminar el producto."));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <AppShell>
      <PageHeader
        eyebrow="Inventario"
        icon={Package}
        title="Productos"
        description="Catálogo de la tienda."
        actions={
          canManage ? (
            <Button variant="brand" onClick={openCreate}>
              <Plus className="mr-1 h-4 w-4" /> Nuevo producto
            </Button>
          ) : undefined
        }
      />

      <FallbackNotice show={!!error && source === "demo-fallback"}>
        No se pudo leer Supabase todavía. Mostrando productos de prueba.
      </FallbackNotice>

      <Card>
        <CardContent className="p-4">
          <div className="relative mb-3 max-w-sm">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-10"
              placeholder="Buscar por nombre o código..."
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead>Categoría</TableHead>
                  <TableHead>Proveedor</TableHead>
                  <TableHead>Código</TableHead>
                  <TableHead className="text-right">Costo</TableHead>
                  <TableHead className="text-right">Precio</TableHead>
                  <TableHead>Stock</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell
                      colSpan={8}
                      className="py-8 text-center text-muted-foreground"
                    >
                      Cargando productos...
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && list.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8}>
                      <EmptyState
                        emoji="📦"
                        title="Sin productos"
                        description="Crea tu primer producto con el botón “Nuevo producto”."
                      />
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  list.map((product) => {
                    const image = getProductImage(product);
                    const visual = getProductVisual(product);
                    return (
                      <TableRow key={product.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <span
                              className={cn(
                                "grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-xl bg-gradient-to-br text-lg",
                                visual.gradient,
                              )}
                            >
                              {image ? (
                                <img
                                  src={image}
                                  alt={product.name}
                                  loading="lazy"
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                visual.emoji
                              )}
                            </span>
                            <span className="font-semibold">
                              {product.name}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell>{product.category}</TableCell>
                        <TableCell>
                          {product.supplierId ? (
                            (supplierName.get(product.supplierId) ?? "—")
                          ) : (
                            <span className="text-muted-foreground">
                              Sin proveedor
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          <div>{product.barcode}</div>
                          {product.sku && (
                            <div className="text-muted-foreground">
                              SKU: {product.sku}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatMoney(product.cost)}
                        </TableCell>
                        <TableCell className="text-right font-semibold">
                          {formatMoney(product.price)}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              product.stock === 0
                                ? "destructive"
                                : product.stock < 10
                                  ? "warm"
                                  : "success"
                            }
                          >
                            {product.stock} {product.unit}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          {canManage ? (
                            <>
                              <DemoGuardedButton
                                size="icon"
                                variant="ghost"
                                aria-label={`Editar ${product.name}`}
                                onAllowedClick={() => openEdit(product)}
                              >
                                <Pencil className="h-4 w-4" />
                              </DemoGuardedButton>
                              <DemoGuardedButton
                                size="icon"
                                variant="ghost"
                                aria-label={`Eliminar ${product.name}`}
                                className="text-destructive hover:text-destructive"
                                onAllowedClick={() => setDeleteTarget(product)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </DemoGuardedButton>
                            </>
                          ) : (
                            <span className="text-xs text-muted-foreground">
                              Solo lectura
                            </span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Create / edit sheet (componente reutilizable) */}
      <ProductFormSheet
        open={open}
        onOpenChange={setOpen}
        editingProduct={editingProduct}
        onSaved={() => reload()}
      />

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(value) => !value && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar producto?</AlertDialogTitle>
            <AlertDialogDescription>
              Se quitará <strong>{deleteTarget?.name}</strong> del catálogo.
              Podrás recuperarlo desde la base de datos si lo necesitas.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isDeleting ? "Eliminando..." : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
