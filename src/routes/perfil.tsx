import { createFileRoute } from "@tanstack/react-router";
import { Store, User } from "lucide-react";
import { toast } from "sonner";
import { AccountProfileCards } from "@/components/account/AccountProfileCards";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { LogoUploader } from "@/components/settings/LogoUploader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useBusinessSettings } from "@/hooks/useBusinessSettings";
import { useDemoSession } from "@/hooks/useDemoSession";
import { saveBusinessSettings } from "@/lib/businessSettings";
import { blockDemoAction } from "@/lib/demoMode";
import { STORE_ROLE_LABELS, normalizeStoreRole } from "@/lib/permissions";
import {
  mapCompanyToBusinessSettings,
  updateCompanyLogo,
  getErrorMessage,
} from "@/services/appData";

export const Route = createFileRoute("/perfil")({ component: Perfil });

function Perfil() {
  const { settings } = useBusinessSettings();
  const { session, isDemo } = useDemoSession();
  // Only the store owner (admin de tienda) manages the store photo.
  const isStoreAdmin = session?.role === "admin";
  const roleLabel = session?.isSuperAdmin
    ? "Super administrador"
    : STORE_ROLE_LABELS[normalizeStoreRole(session?.role)];

  const handleLogo = async (dataUrl: string | null) => {
    if (isDemo) {
      blockDemoAction();
      return;
    }
    if (!session) return;
    try {
      const company = await updateCompanyLogo(session, dataUrl);
      saveBusinessSettings(mapCompanyToBusinessSettings(company));
      toast.success(dataUrl ? "Logo de la tienda actualizado." : "Logo quitado.");
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo actualizar el logo."));
    }
  };

  return (
    <AppShell>
      <PageHeader
        icon={User}
        eyebrow="Cuenta"
        title="Mi Perfil"
        description="Información personal."
      />
      {isStoreAdmin && (
        <Card className="mb-4 shadow-card">
          <CardHeader>
            <CardTitle className="text-base">Foto de la tienda</CardTitle>
          </CardHeader>
          <CardContent>
            <LogoUploader
              value={settings.logoUrl}
              onChange={handleLogo}
              disabled={isDemo}
              fallback={<Store className="h-7 w-7 text-muted-foreground" />}
              hint="Aparece en el panel de tu tienda."
            />
          </CardContent>
        </Card>
      )}
      <AccountProfileCards roleLabel={roleLabel} showCompany />
    </AppShell>
  );
}
