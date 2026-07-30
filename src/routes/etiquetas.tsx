import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Scale, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
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
} from "@/components/ui/dialog";
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
import { useDemoSession } from "@/hooks/useDemoSession";
import { blockDemoAction } from "@/lib/demoMode";
import {
  createUnit,
  deleteUnit,
  fetchUnits,
  updateUnit,
  type Unit,
  getErrorMessage,
} from "@/services/appData";

export const Route = createFileRoute("/etiquetas")({ component: Etiquetas });

function Etiquetas() {
  const { isDemo, session, isReady } = useDemoSession();
  const [units, setUnits] = useState<Unit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState("");

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const [editing, setEditing] = useState<Unit | null>(null);
  const [editName, setEditName] = useState("");
  const [isEditSaving, setIsEditSaving] = useState(false);

  const [deleting, setDeleting] = useState<Unit | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      setUnits(await fetchUnits(session?.companyId));
    } catch (error) {
      toast.error(
        getErrorMessage(error, "No se pudieron cargar las unidades."),
      );
    } finally {
      setIsLoading(false);
    }
  }, [session?.companyId]);

  useEffect(() => {
    if (!isReady) return;
    void reload();
  }, [isReady, reload]);

  const list = useMemo(
    () =>
      units.filter((unit) =>
        unit.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [units, query],
  );

  const handleCreate = async () => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    if (!session) return;
    setIsSaving(true);
    try {
      await createUnit(session, name);
      toast.success("Unidad creada.");
      setName("");
      setOpen(false);
      await reload();
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo crear la unidad."));
    } finally {
      setIsSaving(false);
    }
  };

  const openEdit = (unit: Unit) => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    setEditing(unit);
    setEditName(unit.name);
  };

  const handleUpdate = async () => {
    if (!session || !editing) return;
    setIsEditSaving(true);
    try {
      await updateUnit(session, editing.id, editName, editing.name);
      toast.success("Unidad actualizada.");
      setEditing(null);
      await reload();
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo actualizar la unidad."));
    } finally {
      setIsEditSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    if (isDemo) {
      blockDemoAction();
      setDeleting(null);
      return;
    }
    setIsDeleting(true);
    try {
      await deleteUnit(deleting.id);
      toast.success("Unidad eliminada.");
      setDeleting(null);
      await reload();
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo eliminar la unidad."));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <AppShell>
      <PageHeader
        title="Unidades"
        description="Unidades de medida de tus productos (Unidad, Kg, Pernos…)."
        eyebrow="Catálogo"
        icon={Scale}
        actions={
          <Button
            variant="brand"
            onClick={() => {
              setName("");
              setOpen(true);
            }}
          >
            <Plus className="mr-1 h-4 w-4" /> Nueva unidad
          </Button>
        }
      />
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
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell
                      colSpan={3}
                      className="py-8 text-center text-muted-foreground"
                    >
                      Cargando unidades...
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && list.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={3}>
                      <EmptyState
                        emoji="📏"
                        title="Sin unidades"
                        description="Crea tu primera unidad de medida para tus productos."
                      />
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  list.map((unit) => (
                    <TableRow key={unit.id}>
                      <TableCell className="font-medium">{unit.name}</TableCell>
                      <TableCell>
                        <Badge variant={unit.active ? "success" : "outline"}>
                          {unit.active ? "Activa" : "Inactiva"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Editar ${unit.name}`}
                            onClick={() => openEdit(unit)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Eliminar ${unit.name}`}
                            className="text-destructive hover:text-destructive"
                            onClick={() => setDeleting(unit)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Crear unidad */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nueva unidad</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Nombre</Label>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Ej. Unidad, Caja, Paquete"
            />
          </div>
          <DialogFooter>
            <Button
              variant="brand"
              disabled={isSaving || !name.trim()}
              onClick={handleCreate}
            >
              {isSaving ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Editar unidad */}
      <Dialog
        open={!!editing}
        onOpenChange={(value) => !value && setEditing(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar unidad</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label>Nombre</Label>
            <Input
              value={editName}
              onChange={(event) => setEditName(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              Al renombrarla, se actualiza en los productos que la usan.
            </p>
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

      {/* Eliminar unidad */}
      <AlertDialog
        open={!!deleting}
        onOpenChange={(value) => !value && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar unidad?</AlertDialogTitle>
            <AlertDialogDescription>
              Se quitará <strong>{deleting?.name}</strong> de la lista. Los
              productos que ya la usan conservan su valor.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeleting}
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
            >
              {isDeleting ? "Eliminando..." : "Eliminar"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
