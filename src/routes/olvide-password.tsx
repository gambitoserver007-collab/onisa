import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { MailCheck, Store } from "lucide-react";
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
import { requestPasswordReset } from "@/services/account";
import { fetchPlatformBranding } from "@/services/appData";

export const Route = createFileRoute("/olvide-password")({
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [platformName, setPlatformName] = useState("Onisa");

  useEffect(() => {
    void fetchPlatformBranding()
      .then((branding) => setPlatformName(branding.name))
      .catch(() => undefined);
  }, []);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (error) {
      const message =
        error instanceof Error &&
        /rate limit|too many|seconds/i.test(error.message)
          ? "Hiciste varios intentos seguidos. Espera unos minutos y vuelve a intentarlo."
          : "No se pudo enviar el correo. Revisa que esté bien escrito e inténtalo de nuevo.";

      toast.error(message);
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
            {sent ? "Revisa tu correo" : "¿Olvidaste tu contraseña?"}
          </CardTitle>
          <CardDescription>
            {sent
              ? "Si el correo está registrado, te enviamos un enlace para crear una contraseña nueva."
              : "Ingresa el correo de tu cuenta y te enviaremos un enlace para restablecerla."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 p-7 pt-0">
          {sent ? (
            <>
              <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-muted/45 p-4">
                <MailCheck className="h-5 w-5 shrink-0 text-primary" />
                <p className="text-sm text-muted-foreground">
                  El enlace es válido por un tiempo limitado. Si no lo ves,
                  revisa la carpeta de spam.
                </p>
              </div>
              <Button asChild className="h-12 w-full rounded-2xl">
                <Link to="/login">Volver a iniciar sesión</Link>
              </Button>
            </>
          ) : (
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="email">Correo</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="correo@ejemplo.com"
                  autoComplete="email"
                  required
                  className="h-12 rounded-2xl bg-muted/45"
                />
              </div>
              <Button
                type="submit"
                className="h-12 w-full rounded-2xl"
                disabled={isSubmitting}
              >
                {isSubmitting ? "Enviando..." : "Enviar enlace"}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                <Link
                  to="/login"
                  className="font-medium text-primary hover:underline"
                >
                  Volver a iniciar sesión
                </Link>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
