import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Lock, Plus, Settings } from "lucide-react";
import { toast } from "sonner";
import { DemoGuardedButton } from "@/components/demo/DemoGuardedButton";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getMarketByCountryCode } from "@/data/markets";
import { PAYMENT_METHOD_KIND_LABELS } from "@/data/paymentMethods";
import { useBusinessSettings } from "@/hooks/useBusinessSettings";
import { useDemoSession } from "@/hooks/useDemoSession";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import { blockDemoAction } from "@/lib/demoMode";
import { initializeSession } from "@/lib/demoAuth";
import { saveBusinessSettings } from "@/lib/businessSettings";
import {
  getAllBusinessProfiles,
  DEFAULT_BUSINESS_TYPE,
} from "@/lib/businessProfiles";
import {
  fetchCompanyProfile,
  mapCompanyToBusinessSettings,
  updateCompanySettings,
  getErrorMessage,
} from "@/services/appData";

export const Route = createFileRoute("/configuracion")({
  component: Configuracion,
});

function Configuracion() {
  const { settings } = useBusinessSettings();
  const { isDemo, session, isReady } = useDemoSession();
  const [businessName, setBusinessName] = useState(settings.businessName);
  const [countryCode, setCountryCode] = useState(settings.countryCode);
  const [fiscalId, setFiscalId] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState(session?.phone ?? "");
  const [businessType, setBusinessType] = useState(
    settings.businessType ?? DEFAULT_BUSINESS_TYPE,
  );
  const [customPaymentMethod, setCustomPaymentMethod] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const selectedMarket = getMarketByCountryCode(countryCode);
  const { activeMethods, addCustom, catalog, setStoreActive } =
    usePaymentMethods(countryCode);
  const activePaymentMethodIds = useMemo(
    () => new Set(activeMethods.map((method) => method.id)),
    [activeMethods],
  );

  // Load the company's real profile (empty fields stay empty; market samples are
  // only used as input placeholders, never as fake values).
  useEffect(() => {
    if (!isReady || !session?.companyId) return;
    let active = true;
    void fetchCompanyProfile(session.companyId)
      .then((profile) => {
        if (!active) return;
        setBusinessName(profile.name || settings.businessName);
        if (profile.countryCode) setCountryCode(profile.countryCode);
        setFiscalId(profile.fiscalId);
        setAddress(profile.address);
        setPhone(profile.phone || session?.phone || "");
      })
      .catch(() => {
        /* keep defaults on error */
      });
    return () => {
      active = false;
    };
  }, [isReady, session?.companyId, session?.phone, settings.businessName]);

  useEffect(() => {
    if (settings.businessType) setBusinessType(settings.businessType);
  }, [settings.businessType]);

  const handleSave = async () => {
    if (isDemo) {
      blockDemoAction();
      return;
    }

    if (!session) return;
    setIsSaving(true);

    try {
      const company = await updateCompanySettings(session, {
        businessName,
        fiscalId,
        address,
        phone,
        businessType,
      });
      saveBusinessSettings(mapCompanyToBusinessSettings(company));
      // Refresh the session so the "complete your data" reminder updates immediately.
      await initializeSession();
      toast.success("Datos del negocio guardados.");
    } catch (error) {
      toast.error(
        getErrorMessage(error, "No se pudo guardar la configuración."),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handlePaymentMethodToggle = (methodId: string, active: boolean) => {
    if (isDemo) {
      blockDemoAction();
      return;
    }

    const updated = setStoreActive(methodId, active);
    if (!updated) toast.error("Mantén al menos un método de cobro activo.");
  };

  const handleAddCustomPaymentMethod = () => {
    if (isDemo) {
      blockDemoAction();
      return;
    }

    try {
      const method = addCustom(customPaymentMethod);
      setCustomPaymentMethod("");
      toast.success(`${method.label} agregado a métodos de cobro.`);
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo agregar el método."));
    }
  };

  return (
    <AppShell>
      <PageHeader
        icon={Settings}
        eyebrow="Sistema"
        title="Configuración"
        description="Ajustes del negocio."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-base">Datos del negocio</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1">
              <Label>Nombre comercial</Label>
              <Input
                value={businessName}
                onChange={(event) => setBusinessName(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Tipo de negocio</Label>
              <Select value={businessType} onValueChange={setBusinessType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Array.from(
                    new Set(getAllBusinessProfiles().map((p) => p.group)),
                  ).map((group) => (
                    <SelectGroup key={group}>
                      <SelectLabel>{group}</SelectLabel>
                      {getAllBusinessProfiles()
                        .filter((p) => p.group === group)
                        .map((profile) => (
                          <SelectItem key={profile.id} value={profile.id}>
                            {profile.label}
                          </SelectItem>
                        ))}
                    </SelectGroup>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Elige tu rubro. Los del grupo “Con variantes” activan
                tallas/colores en el editor.
              </p>
            </div>
            <div className="space-y-1">
              <Label>{selectedMarket.fiscalIdLabel}</Label>
              <Input
                value={fiscalId}
                placeholder={`Ej. ${selectedMarket.sampleFiscalId}`}
                onChange={(event) => setFiscalId(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Dirección</Label>
              <Input
                value={address}
                placeholder={`Ej. ${selectedMarket.sampleAddress}`}
                onChange={(event) => setAddress(event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>País operativo</Label>
              <div className="flex h-10 items-center rounded-md border bg-muted/40 px-3 text-sm">
                {selectedMarket.countryName} · {selectedMarket.currencyName} (
                {selectedMarket.currencyCode})
              </div>
              <p className="text-xs text-muted-foreground">
                Lo define el administrador de la plataforma.
              </p>
            </div>
            <div className="space-y-1">
              <Label>Teléfono</Label>
              <Input
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            </div>
            <DemoGuardedButton
              variant="brand"
              disabled={isSaving}
              onAllowedClick={handleSave}
            >
              {isSaving ? "Guardando..." : "Guardar cambios"}
            </DemoGuardedButton>
          </CardContent>
        </Card>
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-base">Configuración crítica</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-3 rounded border p-3">
              <div>
                <p className="text-sm font-medium">{settings.taxName}</p>
                <p className="text-xs text-muted-foreground">
                  Tasa configurada: {(settings.taxRate * 100).toFixed(2)}%
                </p>
              </div>
              <Switch defaultChecked disabled />
            </div>
            <div className="flex items-center justify-between gap-3 rounded border p-3">
              <div>
                <p className="text-sm font-medium">Serie de comprobantes</p>
                <p className="text-xs text-muted-foreground">B001 / F001</p>
              </div>
              <DemoGuardedButton size="sm" variant="outline">
                <Lock className="mr-1 h-3 w-3" /> Bloqueado
              </DemoGuardedButton>
            </div>
            <div className="flex items-center justify-between gap-3 rounded border p-3">
              <div>
                <p className="text-sm font-medium">Moneda</p>
                <p className="text-xs text-muted-foreground">
                  {selectedMarket.currencyName} ({selectedMarket.currencyCode})
                </p>
              </div>
              <DemoGuardedButton size="sm" variant="outline">
                <Lock className="mr-1 h-3 w-3" /> Bloqueado
              </DemoGuardedButton>
            </div>
          </CardContent>
        </Card>
        <Card className="shadow-card lg:col-span-2">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle className="text-base">
                  Métodos de cobro de la tienda
                </CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Elige qué métodos verá el cajero en el punto de venta.
                </p>
              </div>
              <Badge variant="soft">{activeMethods.length} activos</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 md:grid-cols-2">
              {catalog.map((method) => (
                <div
                  key={method.id}
                  className="flex items-start justify-between gap-3 rounded-md border p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {method.label}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {PAYMENT_METHOD_KIND_LABELS[method.kind]}
                    </p>
                    {method.description && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {method.description}
                      </p>
                    )}
                  </div>
                  <Switch
                    checked={activePaymentMethodIds.has(method.id)}
                    onCheckedChange={(checked) =>
                      handlePaymentMethodToggle(method.id, checked)
                    }
                  />
                </div>
              ))}
            </div>

            <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-3 sm:flex-row">
              <Input
                value={customPaymentMethod}
                onChange={(event) => setCustomPaymentMethod(event.target.value)}
                placeholder="Agregar otro método de cobro"
              />
              <DemoGuardedButton
                type="button"
                className="shrink-0"
                onAllowedClick={handleAddCustomPaymentMethod}
              >
                <Plus className="mr-1 h-4 w-4" /> Agregar
              </DemoGuardedButton>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
