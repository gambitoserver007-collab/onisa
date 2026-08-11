import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Lock, Plus, Settings } from "lucide-react";
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
  fetchTeam,
  deleteTeamUser,
  resetCompanyData,
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
  // Se guarda como fracción (0.03) pero se captura/muestra como porcentaje
  // (3), igual que taxRatePct en admin.paises.tsx.
  const [cardCommissionPct, setCardCommissionPct] = useState(
    String(Math.round(settings.cardCommissionRate * 10000) / 100),
  );
  const [loyaltyEnabled, setLoyaltyEnabled] = useState(settings.loyaltyEnabled);
  const [loyaltyPointValue, setLoyaltyPointValue] = useState(
    String(settings.loyaltyPointValue || ""),
  );
  const [loyaltyEarnRate, setLoyaltyEarnRate] = useState(
    String(settings.loyaltyEarnRate || ""),
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

  useEffect(() => {
    setCardCommissionPct(
      String(Math.round(settings.cardCommissionRate * 10000) / 100),
    );
  }, [settings.cardCommissionRate]);

  useEffect(() => {
    setLoyaltyEnabled(settings.loyaltyEnabled);
    setLoyaltyPointValue(String(settings.loyaltyPointValue || ""));
    setLoyaltyEarnRate(String(settings.loyaltyEarnRate || ""));
  }, [
    settings.loyaltyEnabled,
    settings.loyaltyPointValue,
    settings.loyaltyEarnRate,
  ]);

  const handleSave = async () => {
    if (isDemo) {
      blockDemoAction();
      return;
    }

    if (!session) return;

    const cardCommissionRate = Number(cardCommissionPct) / 100;
    if (
      !Number.isFinite(cardCommissionRate) ||
      cardCommissionRate < 0 ||
      cardCommissionRate > 1
    ) {
      toast.error(
        "La comisión de tarjeta debe ser un porcentaje entre 0 y 100.",
      );
      return;
    }

    const loyaltyPointValueNum = loyaltyPointValue.trim()
      ? Number(loyaltyPointValue)
      : 0;
    const loyaltyEarnRateNum = loyaltyEarnRate.trim()
      ? Number(loyaltyEarnRate)
      : 0;
    if (
      !Number.isFinite(loyaltyPointValueNum) ||
      loyaltyPointValueNum < 0 ||
      !Number.isFinite(loyaltyEarnRateNum) ||
      loyaltyEarnRateNum < 0
    ) {
      toast.error(
        "Los valores de puntos de lealtad deben ser números positivos.",
      );
      return;
    }
    if (
      loyaltyEnabled &&
      (loyaltyPointValueNum <= 0 || loyaltyEarnRateNum <= 0)
    ) {
      toast.error(
        "Para activar los puntos de lealtad, define cuánto vale un punto y cuánto gasto equivale a 1 punto.",
      );
      return;
    }

    setIsSaving(true);

    try {
      const company = await updateCompanySettings(session, {
        businessName,
        fiscalId,
        address,
        phone,
        businessType,
        cardCommissionRate,
        loyaltyEnabled,
        loyaltyPointValue: loyaltyPointValueNum,
        loyaltyEarnRate: loyaltyEarnRateNum,
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

  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState("");
  const [isResetting, setIsResetting] = useState(false);
  const resetConfirmMatches =
    resetConfirmText.trim() === settings.businessName.trim() &&
    settings.businessName.trim().length > 0;

  const handleResetSystem = async () => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    if (!session || !resetConfirmMatches) return;

    setIsResetting(true);
    try {
      const team = await fetchTeam(session.companyId ?? undefined);
      for (const member of team) {
        if (member.id === session.userId) continue;
        await deleteTeamUser(session, member.id);
      }
      await resetCompanyData(settings.businessName.trim());
      toast.success("Sistema restablecido. Reiniciando sesión...");
      window.location.href = "/";
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo restablecer el sistema."));
      setIsResetting(false);
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
            <div className="space-y-1">
              <Label>% Comisión de pago con tarjeta</Label>
              <Input
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={cardCommissionPct}
                onChange={(event) => setCardCommissionPct(event.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Se usa en la calculadora de precio de productos, junto con el{" "}
                {selectedMarket.taxName ?? "IVA"}.
              </p>
            </div>
            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Puntos de lealtad</p>
                  <p className="text-xs text-muted-foreground">
                    Los clientes ganan puntos por venta y los canjean como
                    descuento en el POS.
                  </p>
                </div>
                <Switch
                  checked={loyaltyEnabled}
                  onCheckedChange={setLoyaltyEnabled}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label>Valor de 1 punto ($)</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={loyaltyPointValue}
                    onChange={(event) =>
                      setLoyaltyPointValue(event.target.value)
                    }
                  />
                </div>
                <div className="space-y-1">
                  <Label>$ gastados = 1 punto</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={loyaltyEarnRate}
                    onChange={(event) => setLoyaltyEarnRate(event.target.value)}
                  />
                </div>
              </div>
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
        <Card className="shadow-card border-destructive/40 lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base text-destructive">
              <AlertTriangle className="h-4 w-4" /> Zona de peligro
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-sm font-medium">Restablecer sistema</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Borra absolutamente todo lo registrado en esta cuenta: ventas,
                productos, clientes, proveedores, compras, devoluciones,
                promociones, caja, empleados y puntos de lealtad. También
                elimina a todo el equipo excepto tu propia cuenta. La empresa
                queda como recién creada, con una sola sucursal “Principal” y su
                “Caja 1”. Esta acción no se puede deshacer.
              </p>
              <DemoGuardedButton
                variant="destructive"
                size="sm"
                className="mt-3"
                onAllowedClick={() => {
                  setResetConfirmText("");
                  setResetDialogOpen(true);
                }}
              >
                Restablecer sistema
              </DemoGuardedButton>
            </div>
          </CardContent>
        </Card>
      </div>

      <AlertDialog
        open={resetDialogOpen}
        onOpenChange={(value) => !isResetting && setResetDialogOpen(value)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Restablecer todo el sistema?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                <p>
                  Se borrará permanentemente toda la información de{" "}
                  <strong>{settings.businessName}</strong> (ventas, productos,
                  clientes, empleados, caja, todo) y se eliminará a los demás
                  miembros del equipo. Tu cuenta se mantiene, pero se
                  restablecen tu sucursal, PIN y horario.
                </p>
                <div className="space-y-1">
                  <Label htmlFor="reset-confirm-name">
                    Escribe <strong>{settings.businessName}</strong> para
                    confirmar
                  </Label>
                  <Input
                    id="reset-confirm-name"
                    value={resetConfirmText}
                    onChange={(event) =>
                      setResetConfirmText(event.target.value)
                    }
                    autoComplete="off"
                  />
                </div>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isResetting}>
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void handleResetSystem();
              }}
              disabled={!resetConfirmMatches || isResetting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isResetting ? "Restableciendo..." : "Restablecer todo"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
