import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Store } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { updateAccountPassword } from "@/services/account";
import { fetchPlatformBranding } from "@/services/appData";

export const Route = createFileRoute("/restablecer-password")({
  component: ResetPasswordPage,
});

type LinkStatus = "checking" | "ready" | "invalid";

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [status, setStatus] = useState<LinkStatus>("checking");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [platformName, setPlatformName] = useState("Onisa");

  useEffect(() => {
    void fetchPlatformBranding()
      .then((branding) => setPlatformName(branding.name))
      .catch(() => undefined);
  }, []);

  // El enlace del correo trae el token en la URL -- el cliente de Supabase
  // lo detecta solo y dispara el evento PASSWORD_RECOVERY con una sesión
  // temporal activa. Si por una carrera ese evento ya pasó antes de que este
  // listener se montara, una sesión activa aquí ya es indicio suficiente de
  // que el enlace era válido. Sin ninguna de las dos señales en unos
  // segundos, se asume que el enlace es inválido o ya expiró.
  useEffect(() => {
    let mounted = true;

    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (mounted && event === "PASSWORD_RECOVERY") setStatus("ready");
    });

    void supabase.auth.getSession().then(({ data }) => {
      if (mounted && data.session) setStatus("ready");
    });

    const timeout = setTimeout(() => {
      if (mounted)
        setStatus((current) => (current === "checking" ? "invalid" : current));
    }, 4000);

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();

    if (password.trim().length < 6) {
      toast.error("La contraseña debe tener al menos 6 caracteres.");

      return;
    }

    if (password !== confirmPassword) {
      toast.error("Las contraseñas no coinciden.");

      return;
    }

    setIsSubmitting(true);

    try {
      await updateAccountPassword(password);
      toast.success("Tu contraseña se actualizó. Inicia sesión de nuevo.");
      await supabase.auth.signOut();
      navigate({ to: "/login" });
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "No se pudo actualizar la contraseña.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-radial p-4 md:p-8">
      <Card className="w-full max-w-md rounded-3xl border-0 shadow-soft">
        <CardHeader className="space-y-2 p-7 pb-4">
          <div className="mb-1 inline-flex items-center gap-2">
            <span className="grid h-9 w-9 place-items-center rounded-2xl bg-brand-gradient text-primary-foreground shadow-glow">
              <Store className="h-5 w-5" />
            </span>
            <span className="font-black">{platformName}</span>
          </div>
          <CardTitle className="text-2xl font-black">
            {status === "invalid"
              ? "Enlace inválido"
              : "Crea una contraseña nueva"}
          </CardTitle>
          <CardDescription>
            {status === "invalid"
              ? "Este enlace ya no es válido o expiró. Solicita uno nuevo."
              : "Elige una contraseña que no hayas usado antes."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 p-7 pt-0">
          {status === "invalid" ? (
            <Button asChild className="h-12 w-full rounded-2xl">
              <Link to="/olvide-password">Solicitar un enlace nuevo</Link>
            </Button>
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="password">Contraseña nueva</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  required
                  className="h-12 rounded-2xl bg-muted/45"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirma la contraseña</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  placeholder="••••••••"
                  autoComplete="new-password"
                  required
                  className="h-12 rounded-2xl bg-muted/45"
                />
              </div>
              <Button
                type="submit"
                className="h-12 w-full rounded-2xl"
                disabled={isSubmitting || status === "checking"}
              >
                {status === "checking"
                  ? "Validando enlace..."
                  : isSubmitting
                    ? "Guardando..."
                    : "Guardar contraseña"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
