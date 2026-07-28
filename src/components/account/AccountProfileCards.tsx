import { useEffect, useState } from "react";
import { Lock, Save } from "lucide-react";
import { toast } from "sonner";
import { DemoGuardedButton } from "@/components/demo/DemoGuardedButton";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useDemoSession } from "@/hooks/useDemoSession";
import { initializeSession } from "@/lib/demoAuth";
import { updateAccountEmail, updateAccountPassword, updateProfileName } from "@/services/account";
import { getErrorMessage } from "@/services/appData";

interface AccountProfileCardsProps {
  roleLabel: string;
  showCompany?: boolean;
}

export function AccountProfileCards({ roleLabel, showCompany = false }: AccountProfileCardsProps) {
  const { session } = useDemoSession();
  const [fullName, setFullName] = useState("");
  const [nextEmail, setNextEmail] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isUpdatingEmail, setIsUpdatingEmail] = useState(false);
  const [isUpdatingPassword, setIsUpdatingPassword] = useState(false);

  useEffect(() => {
    setFullName(session?.name ?? "");
    setNextEmail("");
    setNextPassword("");
  }, [session?.email, session?.name]);

  const handleSaveProfile = async () => {
    if (!session) return;
    setIsSavingProfile(true);

    try {
      await updateProfileName(session, fullName);
      await initializeSession();
      toast.success("Perfil actualizado.");
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo actualizar el perfil."));
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleUpdateEmail = async () => {
    setIsUpdatingEmail(true);

    try {
      await updateAccountEmail(nextEmail);
      setNextEmail("");
      await initializeSession();
      toast.success("Correo actualizado o pendiente de confirmación.");
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo actualizar el correo."));
    } finally {
      setIsUpdatingEmail(false);
    }
  };

  const handleUpdatePassword = async () => {
    setIsUpdatingPassword(true);

    try {
      await updateAccountPassword(nextPassword);
      setNextPassword("");
      toast.success("Contraseña actualizada.");
    } catch (error) {
      toast.error(getErrorMessage(error, "No se pudo actualizar la contraseña."));
    } finally {
      setIsUpdatingPassword(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Datos personales</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>Nombre</Label>
            <Input value={fullName} onChange={(event) => setFullName(event.target.value)} />
          </div>
          {showCompany && (
            <div className="space-y-1">
              <Label>Empresa</Label>
              <Input value={session?.company ?? ""} disabled />
            </div>
          )}
          <div className="space-y-1">
            <Label>Rol</Label>
            <Input value={roleLabel} disabled />
          </div>
          <DemoGuardedButton
            disabled={isSavingProfile}
            onAllowedClick={() => void handleSaveProfile()}
          >
            <Save className="mr-1 h-3 w-3" /> {isSavingProfile ? "Guardando..." : "Guardar"}
          </DemoGuardedButton>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Seguridad</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1">
            <Label>Correo actual</Label>
            <Input value={session?.email ?? ""} disabled />
          </div>
          <div className="space-y-1">
            <Label>Nuevo correo</Label>
            <Input
              type="email"
              value={nextEmail}
              onChange={(event) => setNextEmail(event.target.value)}
              placeholder="nuevo@correo.com"
              autoComplete="email"
            />
          </div>
          <DemoGuardedButton
            variant="outline"
            disabled={isUpdatingEmail}
            onAllowedClick={() => void handleUpdateEmail()}
          >
            <Lock className="mr-1 h-3 w-3" />{" "}
            {isUpdatingEmail ? "Actualizando..." : "Cambiar correo"}
          </DemoGuardedButton>
          <div className="space-y-1 pt-2">
            <Label>Nueva contraseña</Label>
            <Input
              type="password"
              value={nextPassword}
              onChange={(event) => setNextPassword(event.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
            />
          </div>
          <DemoGuardedButton
            variant="outline"
            disabled={isUpdatingPassword}
            onAllowedClick={() => void handleUpdatePassword()}
          >
            <Lock className="mr-1 h-3 w-3" />{" "}
            {isUpdatingPassword ? "Actualizando..." : "Cambiar contraseña"}
          </DemoGuardedButton>
        </CardContent>
      </Card>
    </div>
  );
}
