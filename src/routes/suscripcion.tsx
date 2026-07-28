import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, CreditCard } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useBusinessSettings } from "@/hooks/useBusinessSettings";
import { useDemoSession } from "@/hooks/useDemoSession";
import { blockDemoAction } from "@/lib/demoMode";
import {
  fetchPlans,
  fetchPlanUsage,
  setCompanyPlan,
  type PlanUsage,
  type SubscriptionPlan,
  getErrorMessage,
} from "@/services/appData";

export const Route = createFileRoute("/suscripcion")({ component: Suscripcion });

const UNLIMITED = 1_000_000;

const formatLimit = (limit: number) => (limit >= UNLIMITED ? "Ilimitado" : limit.toLocaleString());
const pct = (value: number, limit: number) =>
  limit >= UNLIMITED || limit <= 0 ? (value > 0 ? 8 : 0) : Math.min(100, (value / limit) * 100);

function Suscripcion() {
  const { formatMoney } = useBusinessSettings();
  const { isDemo, session, isReady } = useDemoSession();
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [usage, setUsage] = useState<PlanUsage | null>(null);
  const [changingId, setChangingId] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [plansData, usageData] = await Promise.all([
        fetchPlans(),
        fetchPlanUsage(session?.companyId),
      ]);
      setPlans(plansData);
      setUsage(usageData);
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo cargar la suscripción."));
    }
  }, [session?.companyId]);

  useEffect(() => {
    if (!isReady) return;
    void reload();
  }, [isReady, reload]);

  // Current plan: the company's plan, or the cheapest (free) plan when on trial.
  const currentPlan = useMemo(() => {
    if (usage?.plan) return usage.plan;
    return plans.slice().sort((a, b) => a.price - b.price)[0] ?? null;
  }, [plans, usage]);

  const handleChange = async (plan: SubscriptionPlan) => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    if (!session?.companyId) return;
    setChangingId(plan.id);
    try {
      await setCompanyPlan(session.companyId, plan.id);
      toast.success(`Plan cambiado a ${plan.name}.`);
      await reload();
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo cambiar el plan."));
    } finally {
      setChangingId(null);
    }
  };

  const productsCount = usage?.productsCount ?? 0;
  const salesThisMonth = usage?.salesThisMonth ?? 0;
  const usersCount = usage?.usersCount ?? 0;
  const productLimit = currentPlan?.productLimit ?? 0;
  const salesLimit = currentPlan?.salesLimit ?? 0;
  const userLimit = currentPlan?.userLimit ?? 0;

  // Estado de la suscripción (no todo lo que no es "active" es "prueba").
  const subStatus = ((status?: string) => {
    switch (status) {
      case "active":
        return { label: "Suscripción activa", badge: "Activa", variant: "success" as const };
      case "expired":
        return { label: "Suscripción vencida", badge: "Vencida", variant: "destructive" as const };
      case "suspended":
        return {
          label: "Suscripción suspendida",
          badge: "Suspendida",
          variant: "destructive" as const,
        };
      case "cancelled":
      case "canceled":
        return {
          label: "Suscripción cancelada",
          badge: "Cancelada",
          variant: "destructive" as const,
        };
      default:
        return { label: "Periodo de prueba", badge: "Prueba", variant: "warm" as const };
    }
  })(usage?.status);

  return (
    <AppShell>
      <PageHeader
        icon={CreditCard}
        eyebrow="Cuenta"
        title="Mi Suscripción"
        description="Plan, uso y opciones."
      />
      <Card className="shadow-card">
        <CardContent className="grid gap-4 p-4 md:grid-cols-2">
          <div>
            <p className="text-xs text-muted-foreground">Plan actual</p>
            <p className="text-2xl font-black tracking-tight text-gradient">
              {currentPlan?.name ?? "—"}
            </p>
            <p className="text-sm text-muted-foreground">{subStatus.label}</p>
            <Badge variant={subStatus.variant} className="mt-2">
              {subStatus.badge}
            </Badge>
          </div>
          <div className="space-y-3">
            <div>
              <div className="mb-1 flex justify-between text-xs">
                <span>Productos</span>
                <span>
                  {productsCount} / {formatLimit(productLimit)}
                </span>
              </div>
              <Progress value={pct(productsCount, productLimit)} />
            </div>
            <div>
              <div className="mb-1 flex justify-between text-xs">
                <span>Usuarios</span>
                <span>
                  {usersCount} / {formatLimit(userLimit)}
                </span>
              </div>
              <Progress value={pct(usersCount, userLimit)} />
            </div>
            <div>
              <div className="mb-1 flex justify-between text-xs">
                <span>Ventas/mes</span>
                <span>
                  {salesThisMonth} / {formatLimit(salesLimit)}
                </span>
              </div>
              <Progress value={pct(salesThisMonth, salesLimit)} />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="mt-6 grid gap-4 md:grid-cols-3">
        {plans.map((plan) => {
          const isCurrent = plan.id === currentPlan?.id;
          return (
            <Card
              key={plan.id}
              className={
                isCurrent
                  ? "relative border-primary shadow-glow"
                  : "shadow-card transition-shadow hover:shadow-soft"
              }
            >
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-base">
                  {plan.name}
                  {isCurrent && <Badge variant="success">Actual</Badge>}
                </CardTitle>
                <p className="text-3xl font-black tracking-tight">
                  {formatMoney(plan.price)}
                  <span className="text-sm font-normal text-muted-foreground">/mes</span>
                </p>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-primary" /> {formatLimit(plan.productLimit)}{" "}
                  productos
                </p>
                <p className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-primary" />{" "}
                  {plan.userLimit >= UNLIMITED
                    ? "Usuarios ilimitados"
                    : `${plan.userLimit} ${plan.userLimit === 1 ? "usuario" : "usuarios"}`}
                </p>
                <p className="flex items-center gap-2">
                  <Check className="h-4 w-4 text-primary" /> {formatLimit(plan.salesLimit)}{" "}
                  ventas/mes
                </p>
                <Button
                  className="mt-3 w-full"
                  variant={isCurrent ? "secondary" : "brand"}
                  disabled={isCurrent || changingId === plan.id}
                  onClick={() => handleChange(plan)}
                >
                  {isCurrent
                    ? "Plan actual"
                    : changingId === plan.id
                      ? "Cambiando..."
                      : "Cambiar a este plan"}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </AppShell>
  );
}
