import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Building2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AdminShell } from "@/components/layout/AdminShell";
import { EmptyState } from "@/components/layout/EmptyState";
import { PageHeader } from "@/components/layout/PageHeader";
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
import { useDemoSession } from "@/hooks/useDemoSession";
import { blockDemoAction } from "@/lib/demoMode";
import {
  adminDeleteCompany,
  adminUpdateCompany,
  createCompany,
  fetchAdminCompanies,
  fetchPlans,
  type AdminCompany,
  type SubscriptionPlan,
  getErrorMessage,
} from "@/services/appData";

export const Route = createFileRoute("/admin/empresas")({
  component: Empresas,
});

const NO_PLAN = "__none__";

const STATUS_LABELS: Record<string, string> = {
  active: "Activa",
  trial: "Prueba",
  expired: "Vencida",
  suspended: "Suspendida",
};

function statusVariant(status: string) {
  if (status === "active") return "success" as const;
  if (status === "trial") return "warm" as const;
  return "destructive" as const;
}

function Empresas() {
  const { isDemo } = useDemoSession();
  const [companies, setCompanies] = useState<AdminCompany[]>([]);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [query, setQuery] = useState("");

  // Create / edit dialog state (editing = null means "create").
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<AdminCompany | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [name, setName] = useState("");
  const [fiscalId, setFiscalId] = useState("");
  const [address, setAddress] = useState("");
  const [planId, setPlanId] = useState<string>(NO_PLAN);
  const [status, setStatus] = useState("active");
  const [expiresAt, setExpiresAt] = useState<string>("");
  const [ownerEmail, setOwnerEmail] = useState("");
  const [ownerPassword, setOwnerPassword] = useState("");
  const [ownerFullName, setOwnerFullName] = useState("");

  // Delete confirm state.
  const [deleting, setDeleting] = useState<AdminCompany | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadCompanies = () =>
    fetchAdminCompanies()
      .then(setCompanies)
      .catch((error) =>
        toast.error(
          getErrorMessage(error, "No se pudieron cargar las empresas."),
        ),
      )
      .finally(() => setIsLoading(false));

  useEffect(() => {
    void loadCompanies();
    void fetchPlans()
      .then(setPlans)
      .catch(() => setPlans([]));
  }, []);

  const list = useMemo(
    () =>
      companies.filter((company) =>
        company.name.toLowerCase().includes(query.toLowerCase()),
      ),
    [companies, query],
  );

  const resetForm = () => {
    setName("");
    setFiscalId("");
    setAddress("");
    setPlanId(NO_PLAN);
    setStatus("active");
    setExpiresAt("");
    setOwnerEmail("");
    setOwnerPassword("");
    setOwnerFullName("");
  };

  const openCreate = () => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    setEditing(null);
    resetForm();
    setOpen(true);
  };

  const openEdit = (company: AdminCompany) => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    setEditing(company);
    setName(company.name);
    setFiscalId(company.fiscalId ?? "");
    setAddress(company.address ?? "");
    setPlanId(company.planId ?? NO_PLAN);
    setStatus(company.status);
    setExpiresAt(company.expiresAt ? company.expiresAt.slice(0, 10) : "");
    setOwnerEmail("");
    setOwnerPassword("");
    setOwnerFullName("");
    setOpen(true);
  };

  const handleSave = async () => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    setIsSaving(true);
    try {
      if (editing) {
        await adminUpdateCompany(editing.id, {
          name,
          fiscalId,
          address,
          planId: planId === NO_PLAN ? null : planId,
          status,
          expiresAt: expiresAt ? expiresAt : null,
        });
        toast.success("Empresa actualizada.");
      } else {
        await createCompany({
          name,
          fiscalId,
          address,
          planId: planId === NO_PLAN ? undefined : planId,
          status,
          ownerEmail,
          ownerPassword,
          ownerFullName,
        });
        toast.success("Tienda creada.");
      }
      setOpen(false);
      setEditing(null);
      resetForm();
      await loadCompanies();
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo guardar la empresa."));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setIsDeleting(true);
    try {
      await adminDeleteCompany(deleting.id);
      toast.success("Empresa eliminada.");
      setDeleting(null);
      await loadCompanies();
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo eliminar la empresa."));
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <AdminShell>
      <PageHeader
        eyebrow="Administración"
        icon={Building2}
        title="Empresas"
        description="Clientes del SaaS."
        actions={
          <Button variant="brand" onClick={openCreate}>
            <Plus className="mr-1 h-4 w-4" /> Nueva empresa
          </Button>
        }
      />

      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) {
            setEditing(null);
            resetForm();
          }
        }}
      >
        <DialogContent className="max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Editar empresa" : "Nueva empresa"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Nombre de la tienda</Label>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>ID fiscal (opcional)</Label>
              <Input
                value={fiscalId}
                onChange={(event) => setFiscalId(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Dirección (opcional)</Label>
              <Input
                value={address}
                onChange={(event) => setAddress(event.target.value)}
                placeholder="Calle, número, ciudad..."
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Plan</Label>
                <Select value={planId} onValueChange={setPlanId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Sin plan" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_PLAN}>Sin plan</SelectItem>
                    {plans.map((plan) => (
                      <SelectItem key={plan.id} value={plan.id}>
                        {plan.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label>Estado</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Activa</SelectItem>
                    <SelectItem value="trial">Prueba</SelectItem>
                    <SelectItem value="suspended">Suspendida</SelectItem>
                    <SelectItem value="expired">Vencida</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {editing && (
              <div className="space-y-1">
                <Label>Vence el</Label>
                <Input
                  type="date"
                  value={expiresAt}
                  onChange={(event) => setExpiresAt(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  Déjalo vacío para quitar la fecha de vencimiento.
                </p>
              </div>
            )}

            {!editing && (
              <div className="rounded-lg border p-3">
                <p className="text-sm font-semibold">
                  Administrador inicial (opcional)
                </p>
                <p className="mb-3 text-xs text-muted-foreground">
                  Crea el primer acceso de la tienda. Si lo dejas vacío, la
                  tienda se crea sin usuarios y podrás agregarlos después.
                </p>
                <div className="space-y-3">
                  <div className="space-y-1">
                    <Label>Nombre del administrador</Label>
                    <Input
                      value={ownerFullName}
                      onChange={(event) => setOwnerFullName(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Correo</Label>
                    <Input
                      type="email"
                      value={ownerEmail}
                      onChange={(event) => setOwnerEmail(event.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <Label>Contraseña</Label>
                    <Input
                      type="password"
                      value={ownerPassword}
                      onChange={(event) => setOwnerPassword(event.target.value)}
                      placeholder="Mínimo 6 caracteres"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="brand"
              disabled={isSaving || !name.trim()}
              onClick={handleSave}
            >
              {isSaving
                ? "Guardando..."
                : editing
                  ? "Guardar cambios"
                  : "Crear empresa"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Card>
        <CardContent className="p-4">
          <Input
            className="mb-3 max-w-sm"
            placeholder="Buscar empresa..."
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empresa</TableHead>
                  <TableHead>RUC</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Usuarios</TableHead>
                  <TableHead>Vencimiento</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading && (
                  <TableRow>
                    <TableCell
                      colSpan={7}
                      className="py-8 text-center text-muted-foreground"
                    >
                      Cargando empresas...
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading && list.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7}>
                      <EmptyState
                        title="Sin empresas registradas"
                        description="Crea la primera tienda con el botón “Nueva empresa”."
                      />
                    </TableCell>
                  </TableRow>
                )}
                {!isLoading &&
                  list.map((company) => (
                    <TableRow key={company.id}>
                      <TableCell className="font-medium">
                        {company.name}
                        {company.isDemo && (
                          <Badge variant="soft" className="ml-2">
                            Demo
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{company.fiscalId ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{company.planName}</Badge>
                      </TableCell>
                      <TableCell>{company.usersCount}</TableCell>
                      <TableCell>
                        {company.expiresAt?.slice(0, 10) ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(company.status)}>
                          {STATUS_LABELS[company.status] ?? company.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label="Editar empresa"
                            onClick={() => openEdit(company)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-destructive hover:text-destructive"
                            aria-label="Eliminar empresa"
                            onClick={() => {
                              if (isDemo) {
                                blockDemoAction();
                                return;
                              }
                              setDeleting(company);
                            }}
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

      <AlertDialog
        open={!!deleting}
        onOpenChange={(value) => !value && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminar empresa</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará <strong>{deleting?.name}</strong> y se desactivarán
              sus usuarios. Esta acción no se puede deshacer desde el panel.
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
    </AdminShell>
  );
}
