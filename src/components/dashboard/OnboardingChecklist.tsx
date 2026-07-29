import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { Check, CreditCard, Package, ShoppingCart, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { fetchCompanyProfile } from "@/services/appData";

const DISMISS_KEY_PREFIX = "onboarding_dismissed_";

interface OnboardingChecklistProps {
  companyId?: string;
  productsCount: number;
  hasSales: boolean;
}

interface StepDef {
  key: string;
  label: string;
  hint: string;
  to: string;
  icon: typeof Package;
  done: boolean;
}

export function OnboardingChecklist({
  companyId,
  productsCount,
  hasSales,
}: OnboardingChecklistProps) {
  const [dismissed, setDismissed] = useState(true);
  const [hasBusinessInfo, setHasBusinessInfo] = useState(false);

  useEffect(() => {
    if (!companyId) return;
    setDismissed(localStorage.getItem(DISMISS_KEY_PREFIX + companyId) === "1");
  }, [companyId]);

  useEffect(() => {
    if (!companyId) return;
    let active = true;
    void fetchCompanyProfile(companyId)
      .then((profile) => {
        if (active) setHasBusinessInfo(Boolean(profile.fiscalId?.trim() || profile.address?.trim()));
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [companyId]);

  if (!companyId) return null;

  const steps: StepDef[] = [
    {
      key: "product",
      label: "Agrega tu primer producto",
      hint: "Con nombre, precio y stock inicial.",
      to: "/productos",
      icon: Package,
      done: productsCount > 0,
    },
    {
      key: "business",
      label: "Completa los datos de tu negocio",
      hint: "Dirección y datos fiscales, para tus comprobantes.",
      to: "/configuracion",
      icon: CreditCard,
      done: hasBusinessInfo,
    },
    {
      key: "sale",
      label: "Haz tu primera venta",
      hint: "Pruébalo en el Punto de venta.",
      to: "/pos",
      icon: ShoppingCart,
      done: hasSales,
    },
  ];

  const doneCount = steps.filter((step) => step.done).length;
  const allDone = doneCount === steps.length;

  if (allDone || dismissed) return null;

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY_PREFIX + companyId, "1");
    setDismissed(true);
  };

  return (
    <Card className="border-0 bg-card/95">
      <CardContent className="space-y-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-primary">Primeros pasos</p>
            <h2 className="mt-0.5 text-lg font-black text-foreground">
              Deja tu tienda lista en {steps.length} pasos
            </h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 text-muted-foreground"
            aria-label="Ocultar primeros pasos"
            onClick={handleDismiss}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-1">
          <Progress value={(doneCount / steps.length) * 100} />
          <p className="text-xs text-muted-foreground">
            {doneCount} de {steps.length} completados
          </p>
        </div>

        <div className="grid gap-2 sm:grid-cols-3">
          {steps.map((step) => (
            <Link
              key={step.key}
              to={step.to}
              className={`flex items-start gap-3 rounded-2xl border p-3 transition ${
                step.done
                  ? "border-primary/20 bg-primary/5"
                  : "border-border/70 bg-background/55 hover:border-primary/30 hover:bg-primary/5"
              }`}
            >
              <span
                className={`grid h-8 w-8 shrink-0 place-items-center rounded-xl ${
                  step.done ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                }`}
              >
                {step.done ? <Check className="h-4 w-4" /> : <step.icon className="h-4 w-4" />}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium">{step.label}</span>
                <span className="block text-xs text-muted-foreground">{step.hint}</span>
              </span>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
