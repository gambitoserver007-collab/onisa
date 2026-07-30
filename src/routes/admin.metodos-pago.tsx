import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Check, CreditCard, Plus, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { DemoGuardedButton } from "@/components/demo/DemoGuardedButton";
import { AdminShell } from "@/components/layout/AdminShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { CountrySelect } from "@/components/settings/CountrySelect";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getErrorMessage } from "@/services/appData";
import { Switch } from "@/components/ui/switch";
import { getMarketByCountryCode } from "@/data/markets";
import {
  PAYMENT_METHOD_KIND_LABELS,
  PAYMENT_METHOD_KINDS,
  type PaymentMethodKind,
} from "@/data/paymentMethods";
import { useBusinessSettings } from "@/hooks/useBusinessSettings";
import { useDemoSession } from "@/hooks/useDemoSession";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import { blockDemoAction } from "@/lib/demoMode";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/metodos-pago")({
  component: AdminPaymentMethods,
});

function AdminPaymentMethods() {
  const { settings } = useBusinessSettings();
  const { isDemo } = useDemoSession();
  const [countryCode, setCountryCode] = useState(settings.countryCode);
  const [customLabel, setCustomLabel] = useState("");
  const [customKind, setCustomKind] = useState<PaymentMethodKind>("other");
  const market = getMarketByCountryCode(countryCode);
  const { addCustom, adminCatalog, activeMethods, resetCountry, setAvailable } =
    usePaymentMethods(countryCode);
  const availableCount = adminCatalog.filter(
    (method) => method.available,
  ).length;

  useEffect(() => {
    setCountryCode(settings.countryCode);
  }, [settings.countryCode]);

  const handleAvailabilityChange = (methodId: string, available: boolean) => {
    if (isDemo) {
      blockDemoAction();
      return;
    }

    setAvailable(methodId, available);
    toast.success("Catálogo de métodos actualizado.");
  };

  const handleAddCustomMethod = () => {
    if (isDemo) {
      blockDemoAction();
      return;
    }

    try {
      const method = addCustom(customLabel, customKind);
      setCustomLabel("");
      setCustomKind("other");
      toast.success(
        `${method.label} agregado al catálogo de ${market.countryName}.`,
      );
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo agregar el método."));
    }
  };

  const handleResetCountry = () => {
    if (isDemo) {
      blockDemoAction();
      return;
    }

    resetCountry();
    toast.success(`Catálogo de ${market.countryName} restaurado.`);
  };

  return (
    <AdminShell>
      <PageHeader
        eyebrow="Administración"
        icon={CreditCard}
        title="Métodos de pago"
        description="Catálogo disponible por país para las tiendas."
      />

      <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">País</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <CountrySelect
                value={countryCode}
                onValueChange={setCountryCode}
              />
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <p className="font-medium">{market.countryName}</p>
                <p className="text-muted-foreground">
                  Moneda: {market.currencyName} ({market.currencyCode})
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                <div className="rounded-2xl border border-primary/15 bg-primary/5 p-3">
                  <p className="text-muted-foreground">Disponibles</p>
                  <p className="text-xl font-black text-primary">
                    {availableCount}
                  </p>
                </div>
                <div className="rounded-2xl border p-3">
                  <p className="text-muted-foreground">Activos tienda</p>
                  <p className="text-xl font-black">{activeMethods.length}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Agregar método</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label>Nombre</Label>
                <Input
                  value={customLabel}
                  onChange={(event) => setCustomLabel(event.target.value)}
                  placeholder="Ej. billetera local"
                />
              </div>
              <div className="space-y-1">
                <Label>Tipo</Label>
                <Select
                  value={customKind}
                  onValueChange={(value) =>
                    setCustomKind(value as PaymentMethodKind)
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PAYMENT_METHOD_KINDS.map((kind) => (
                      <SelectItem key={kind} value={kind}>
                        {PAYMENT_METHOD_KIND_LABELS[kind]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <DemoGuardedButton
                className="w-full"
                variant="brand"
                onAllowedClick={handleAddCustomMethod}
              >
                <Plus className="mr-1 h-4 w-4" /> Agregar al país
              </DemoGuardedButton>
              <DemoGuardedButton
                className="w-full"
                variant="outline"
                onAllowedClick={handleResetCountry}
              >
                <RotateCcw className="mr-1 h-4 w-4" /> Restaurar país
              </DemoGuardedButton>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Catálogo de {market.countryName}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 xl:grid-cols-2">
              {adminCatalog.map((method) => (
                <div
                  key={method.id}
                  className={cn(
                    "flex items-start justify-between gap-3 rounded-2xl border p-3 transition",
                    method.available
                      ? "border-primary/20 bg-primary/5 shadow-card"
                      : "border-border",
                  )}
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{method.label}</p>
                      <Badge variant={method.available ? "success" : "outline"}>
                        {method.available && <Check className="h-3 w-3" />}
                        {method.available ? "Disponible" : "Oculto"}
                      </Badge>
                      <Badge variant="outline">
                        {method.isCustom ? "Personalizado" : "Base"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {PAYMENT_METHOD_KIND_LABELS[method.kind]}
                    </p>
                    {method.description && (
                      <p className="text-xs text-muted-foreground">
                        {method.description}
                      </p>
                    )}
                  </div>
                  <Switch
                    checked={method.available}
                    onCheckedChange={(checked) =>
                      handleAvailabilityChange(method.id, checked)
                    }
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </AdminShell>
  );
}
