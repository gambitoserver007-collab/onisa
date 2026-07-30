import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Pencil, Plus, Tags, Trash2 } from "lucide-react";
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DemoGuardedButton } from "@/components/demo/DemoGuardedButton";
import { useCompanyCatalog } from "@/hooks/useCompanyCatalog";
import { useDemoSession } from "@/hooks/useDemoSession";
import { blockDemoAction } from "@/lib/demoMode";
import {
  createCategory,
  deleteCategory,
  updateCategory,
  getErrorMessage,
} from "@/services/appData";

export const Route = createFileRoute("/categorias")({ component: Categorias });

function Categorias() {
  const { categories, products, error, source, isLoading, reload, session } =
    useCompanyCatalog();
  const { isDemo } = useDemoSession();
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(
    null,
  );
  const [editName, setEditName] = useState("");
  const [isEditSaving, setIsEditSaving] = useState(false);
  const list = useMemo(
    () =>
      categories.filter((category) =>
        category.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [categories, query],
  );

  const handleCreate = async () => {
    if (isDemo) {
      blockDemoAction();
      return;
    }

    if (!session) return;
    setIsSaving(true);

    try {
      await createCategory(session, name);
      toast.success("Categoría creada.");
      setName("");
      setOpen(false);
      await reload();
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo crear la categoría."));
    } finally {
      setIsSaving(false);
    }
  };

  const openEdit = (category: { id: string; name: string }) => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    setEditing(category);
    setEditName(category.name);
  };

  const handleUpdate = async () => {
    if (!editing) return;
    setIsEditSaving(true);
    try {
      await updateCategory(editing.id, editName);
      toast.success("Categoría actualizada.");
      setEditing(null);
      await reload();
    } catch (error) {
      toast.error(
        getErrorMessage(error, "No se pudo actualizar la categoría."),
      );
    } finally {
      setIsEditSaving(false);
    }
  };

  const handleDelete = async (categoryId: string) => {
    if (isDemo) {
      blockDemoAction();
      return;
    }

    // No dejar productos huérfanos: si la categoría está en uso, bloquear el borrado.
    const cat = categories.find((c) => c.id === categoryId);
    const enUso = cat
      ? products.filter((p) => p.category === cat.name).length
      : 0;
    if (enUso > 0) {
      toast.error(
        `No puedes eliminar "${cat?.name}": ${enUso} producto(s) la usan. Reasígnalos a otra categoría primero.`,
      );
      return;
    }

    try {
      await deleteCategory(categoryId);
      toast.success("Categoría eliminada.");
      await reload();
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo eliminar la categoría."));
    }
  };

  return (
    <AppShell>
      <PageHeader
        title="Categorías"
        description="Organiza tus productos."
        eyebrow="Catálogo"
        icon={Tags}
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="brand">
                <Plus className="mr-1 h-4 w-4" /> Nueva categoría
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nueva categoría</DialogTitle>
              </DialogHeader>
              <div className="space-y-2">
                <Label>Nombre</Label>
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
              <DialogFooter>
                <Button
                  variant="brand"
                  disabled={isSaving}
                  onClick={handleCreate}
                >
                  {isSaving ? "Guardando..." : "Guardar"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        }
      />
      <FallbackNotice show={!!error && source === "demo-fallback"}>
        No se pudo leer Supabase todavía. Mostrando categorías de prueba.
      </FallbackNotice>
      <Card>
        <CardContent className="p-4">
          <Input
            placeholder="Buscar..."
            className="mb-3 max-w-sm"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell
                      colSpan={3}
                      className="py-8 text-center text-muted-foreground"
                    >
                      Cargando categorías...
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && list.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3}>
                      <EmptyState
                        emoji="🏷️"
                        title="Sin categorías"
                        description="Crea tu primera categoría para organizar el catálogo."
                      />
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  list.map((category) => (
                    <TableRow key={category.id}>
                      <TableCell className="font-medium">
                        {category.name}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={category.active ? "success" : "outline"}
                        >
                          {category.active ? "Activa" : "Inactiva"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <DemoGuardedButton
                            size="icon"
                            variant="ghost"
                            aria-label={`Editar ${category.name}`}
                            onAllowedClick={() => openEdit(category)}
                          >
                            <Pencil className="h-4 w-4" />
                          </DemoGuardedButton>
                          <DemoGuardedButton
                            size="icon"
                            variant="ghost"
                            aria-label={`Eliminar ${category.name}`}
                            className="text-destructive hover:text-destructive"
                            onAllowedClick={() => handleDelete(category.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </DemoGuardedButton>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog
        open={!!editing}
        onOpenChange={(value) => !value && setEditing(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar categoría</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Nombre</Label>
            <Input
              value={editName}
              onChange={(event) => setEditName(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button
              variant="brand"
              disabled={isEditSaving || !editName.trim()}
              onClick={handleUpdate}
            >
              {isEditSaving ? "Guardando..." : "Guardar cambios"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
