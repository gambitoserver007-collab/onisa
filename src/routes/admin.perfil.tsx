import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Store, UserCog } from "lucide-react";
import { toast } from "sonner";
import { AccountProfileCards } from "@/components/account/AccountProfileCards";
import { AdminShell } from "@/components/layout/AdminShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { LogoUploader } from "@/components/settings/LogoUploader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDemoSession } from "@/hooks/useDemoSession";
import { blockDemoAction } from "@/lib/demoMode";
import {
  fetchPlatformBranding,
  updatePlatformLogo,
  updatePlatformBrandName,
  getErrorMessage,
} from "@/services/appData";

export const Route = createFileRoute("/admin/perfil")({
  component: AdminPerfil,
});

function AdminPerfil() {
  const { isDemo, isReady } = useDemoSession();
  const [logo, setLogo] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [savingName, setSavingName] = useState(false);

  useEffect(() => {
    if (!isReady) return;
    void fetchPlatformBranding()
      .then((branding) => {
        setLogo(branding.logoUrl);
        setName(branding.name);
      })
      .catch(() => undefined);
  }, [isReady]);

  const handleLogo = async (dataUrl: string | null) => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    try {
      await updatePlatformLogo(dataUrl);
      setLogo(dataUrl);
      toast.success(
        dataUrl ? "Logo de la plataforma actualizado." : "Logo quitado.",
      );
    } catch (error) {
      toast.error(
        getErrorMessage(
          error,
          "No se pudo actualizar el logo de la plataforma.",
        ),
      );
    }
  };

  const handleSaveName = async () => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    setSavingName(true);
    try {
      await updatePlatformBrandName(name);
      toast.success("Nombre de la plataforma actualizado.");
    } catch (error) {
      toast.error(
        getErrorMessage(
          error,
          "No se pudo actualizar el nombre de la plataforma.",
        ),
      );
    } finally {
      setSavingName(false);
    }
  };

  return (
    <AdminShell>
      <PageHeader
        eyebrow="Administración"
        icon={UserCog}
        title="Mi Perfil"
        description="Cuenta de administrador de plataforma."
      />
      <Card className="mb-4 shadow-card">
        <CardHeader>
          <CardTitle className="text-base">Marca de la plataforma</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <LogoUploader
            value={logo}
            onChange={handleLogo}
            disabled={isDemo}
            fallback={<Store className="h-7 w-7 text-muted-foreground" />}
            hint="Logo del SaaS. Aparece en el panel de plataforma."
          />
          <div className="space-y-2">
            <Label htmlFor="platform-brand-name">Nombre de la plataforma</Label>
            <div className="flex flex-wrap gap-2">
              <Input
                id="platform-brand-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={isDemo}
                className="max-w-xs"
                placeholder="Onisa"
              />
              <Button
                type="button"
                size="sm"
                disabled={isDemo || savingName || !name.trim()}
                onClick={handleSaveName}
              >
                {savingName ? "Guardando..." : "Guardar"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Aparece en el panel de plataforma, el login y el registro.
            </p>
          </div>
        </CardContent>
      </Card>
      <AccountProfileCards roleLabel="Super Admin" />
    </AdminShell>
  );
}
