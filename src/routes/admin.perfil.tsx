import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Store, UserCog } from "lucide-react";
import { toast } from "sonner";
import { AccountProfileCards } from "@/components/account/AccountProfileCards";
import { AdminShell } from "@/components/layout/AdminShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { LogoUploader } from "@/components/settings/LogoUploader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDemoSession } from "@/hooks/useDemoSession";
import { blockDemoAction } from "@/lib/demoMode";
import { fetchPlatformBranding, updatePlatformLogo, getErrorMessage } from "@/services/appData";

export const Route = createFileRoute("/admin/perfil")({ component: AdminPerfil });

function AdminPerfil() {
  const { isDemo, isReady } = useDemoSession();
  const [logo, setLogo] = useState<string | null>(null);

  useEffect(() => {
    if (!isReady) return;
    void fetchPlatformBranding()
      .then((branding) => setLogo(branding.logoUrl))
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
      toast.success(dataUrl ? "Logo de la plataforma actualizado." : "Logo quitado.");
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo actualizar el logo de la plataforma."));
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
        <CardContent>
          <LogoUploader
            value={logo}
            onChange={handleLogo}
            disabled={isDemo}
            fallback={<Store className="h-7 w-7 text-muted-foreground" />}
            hint="Logo del SaaS. Aparece en el panel de plataforma."
          />
        </CardContent>
      </Card>
      <AccountProfileCards roleLabel="Super Admin" />
    </AdminShell>
  );
}
