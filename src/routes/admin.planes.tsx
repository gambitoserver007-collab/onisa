import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check, Layers, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { DemoGuardedButton } from "@/components/demo/DemoGuardedButton";
import { AdminShell } from "@/components/layout/AdminShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { FallbackNotice } from "@/components/layout/FallbackNotice";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { plans as demoPlans } from "@/data/demo";
import { useBusinessSettings } from "@/hooks/useBusinessSettings";
import { useDemoSession } from "@/hooks/useDemoSession";
import { blockDemoAction } from "@/lib/demoMode";
import {
  createPlan,
  deletePlan,
  fetchPlans,
  updatePlan,
  type SubscriptionPlan,
  getErrorMessage,
} from "@/services/appData";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/planes")({ component: Planes });

const UNLIMITED = 1_000_000;

const FALLBACK_PLANS: SubscriptionPlan[] = demoPlans.map((plan) => ({
  id: plan.id,
  name: plan.name,
  price: plan.price,
  productLimit: plan.products,
  userLimit: plan.users,
  salesLimit: plan.sales,
  isActive: true,
}));

interface PlanForm {
  name: string;
  price: string;
  productLimit: string;
  userLimit: string;
  salesLimit: string;
}

const EMPTY_FORM: PlanForm = {
  name: "",
  price: "",
  productLimit: "",
  userLimit: "",
  salesLimit: "",
};

function Planes() {
  const { formatMoney } = useBusinessSettings();
  const { isDemo } = useDemoSession();
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [usingFallback, setUsingFallback] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<PlanForm>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SubscriptionPlan | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const load = async () => {
    setIsLoading(true);
    try {
      const data = await fetchPlans();
      setPlans(data);
      setUsingFallback(false);
    } catch {
      setPlans(FALLBACK_PLANS);
      setUsingFallback(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const setField = (key: keyof PlanForm, value: string) =>
    setForm((current) => ({ ...current, [key]: value }));

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEdit = (plan: SubscriptionPlan) => {
    setEditingId(plan.id);
    setForm({
      name: plan.name,
      price: String(plan.price),
      productLimit: String(plan.productLimit),
      userLimit: String(plan.userLimit),
      salesLimit: String(plan.salesLimit),
    });
    setFormOpen(true);
  };

  const handleSave = async () => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    setIsSaving(true);
    const input = {
      name: form.name,
      price: Number(form.price) || 0,
      productLimit: Number(form.productLimit) || 0,
      userLimit: Number(form.userLimit) || 0,
      salesLimit: Number(form.salesLimit) || 0,
    };
    try {
      if (editingId) {
        await updatePlan(editingId, input);
        toast.success("Plan actualizado.");
      } else {
        await createPlan(input);
        toast.success("Plan creado.");
      }
      setFormOpen(false);
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo guardar el plan."));
    } finally {
      setIsSaving(false);
    }
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
      await deletePlan(deleteTarget.id);
      toast.success("Plan eliminado.");
      setDeleteTarget(null);
      await load();
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo eliminar el plan."));
    } finally {
      setIsDeleting(false);
    }
  };

  const maxPrice = Math.max(0, ...plans.map((plan) => plan.price));

  return (
    <AdminShell>
      <PageHeader
        eyebrow="Administración"
        icon={Layers}
        title="Planes"
        description="Catálogo de planes de la plataforma."
        actions={
          <DemoGuardedButton variant="brand" onAllowedClick={openCreate}>
            <Plus className="mr-1 h-4 w-4" /> Nuevo plan
          </DemoGuardedButton>
        }
      />

      <FallbackNotice show={usingFallback}>
        Mostrando planes de ejemplo: no se pudo leer la tabla de planes (revisa permisos/RLS en
        Supabase). Los cambios no se guardarán hasta resolverlo.
      </FallbackNotice>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <div
              key={index}
              className="h-72 animate-pulse rounded-2xl border border-border/60 bg-card"
            />
          ))}
        </div>
      ) : plans.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              emoji="🗂️"
              title="Aún no hay planes"
              description="Crea tu primer plan con el botón “Nuevo plan”."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {plans.map((plan) => {
            const featured = plans.length > 1 && plan.price === maxPrice;
            const productLine =
              plan.productLimit >= UNLIMITED
                ? "Productos ilimitados"
                : `${plan.productLimit.toLocaleString()} productos`;
            const salesLine =
              plan.salesLimit >= UNLIMITED
                ? "Ventas ilimitadas"
                : `${plan.salesLimit.toLocaleString()} ventas/mes`;
            const userLine =
              plan.userLimit >= UNLIMITED
                ? "Usuarios ilimitados"
                : `${plan.userLimit} ${plan.userLimit === 1 ? "usuario" : "usuarios"}`;
            return (
              <Card
                key={plan.id}
                className={cn(
                  "relative shadow-card transition",
                  featured && "border-primary shadow-glow",
                )}
              >
                {featured && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand-gradient px-3 py-1 text-xs font-bold uppercase tracking-[0.12em] text-primary-foreground shadow-glow">
                    Destacado
                  </span>
                )}
                <CardHeader>
                  <CardTitle className="flex items-center justify-between text-base">
                    {plan.name}
                    <Badge variant="success">Activo</Badge>
                  </CardTitle>
                  <p className="text-3xl font-black">
                    {formatMoney(plan.price)}
                    <span className="text-sm font-normal text-muted-foreground">/mes</span>
                  </p>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <p className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary" /> {productLine}
                  </p>
                  <p className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary" /> {userLine}
                  </p>
                  <p className="flex items-center gap-2">
                    <Check className="h-4 w-4 text-primary" /> {salesLine}
                  </p>
                  <div className="flex gap-2 pt-3">
                    <DemoGuardedButton
                      size="sm"
                      variant={featured ? "brand" : "outline"}
                      className="flex-1"
                      onAllowedClick={() => openEdit(plan)}
                    >
                      <Pencil className="mr-1 h-3.5 w-3.5" /> Editar
                    </DemoGuardedButton>
                    <DemoGuardedButton
                      size="sm"
                      variant="ghost"
                      className="flex-1 text-destructive hover:text-destructive"
                      onAllowedClick={() => setDeleteTarget(plan)}
                    >
                      <Trash2 className="mr-1 h-3.5 w-3.5" /> Eliminar
                    </DemoGuardedButton>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create / edit dialog */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingId ? "Editar plan" : "Nuevo plan"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Nombre</Label>
              <Input
                value={form.name}
                onChange={(event) => setField("name", event.target.value)}
                placeholder="Ej. Básico"
              />
            </div>
            <div className="space-y-1">
              <Label>Precio mensual</Label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.price}
                onChange={(event) => setField("price", event.target.value)}
              />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Productos</Label>
                <Input
                  type="number"
                  min="0"
                  value={form.productLimit}
                  onChange={(event) => setField("productLimit", event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Usuarios</Label>
                <Input
                  type="number"
                  min="0"
                  value={form.userLimit}
                  onChange={(event) => setField("userLimit", event.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Ventas/mes</Label>
                <Input
                  type="number"
                  min="0"
                  value={form.salesLimit}
                  onChange={(event) => setField("salesLimit", event.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="brand" disabled={isSaving || !form.name.trim()} onClick={handleSave}>
              {isSaving ? "Guardando..." : editingId ? "Guardar cambios" : "Crear plan"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(value) => !value && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar plan?</AlertDialogTitle>
            <AlertDialogDescription>
              Se archivará el plan <strong>{deleteTarget?.name}</strong>. Las empresas que ya lo
              tengan asignado no se ven afectadas.
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
    </AdminShell>
  );
}
