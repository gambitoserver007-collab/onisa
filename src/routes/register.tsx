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
import { PUBLIC_REGISTRATION_ENABLED } from "@/config/access";
import { DEFAULT_MARKET_CODE } from "@/data/markets";
import { detectCountryCode } from "@/lib/detectCountry";
import { registerLocalAccount } from "@/lib/demoAuth";
import { translateAuthError } from "@/lib/authMessages";
import { fetchPlatformBranding } from "@/services/appData";

export const Route = createFileRoute("/register")({ component: RegisterPage });

function RegisterPage() {
  const navigate = useNavigate();
  const [company, setCompany] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [countryCode, setCountryCode] = useState(DEFAULT_MARKET_CODE);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [platformName, setPlatformName] = useState("Onisa");

  // Auto-detect the visitor's country (timezone + language). No picker: the
  // platform admin adjusts country/currency/tax per store if ever needed.
  useEffect(() => {
    setCountryCode(detectCountryCode());
  }, []);

  useEffect(() => {
    void fetchPlatformBranding()
      .then((branding) => setPlatformName(branding.name))
      .catch(() => undefined);
  }, []);

  if (!PUBLIC_REGISTRATION_ENABLED) {
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
              Registro público deshabilitado
            </CardTitle>
            <CardDescription>
              El registro publico no esta disponible. Usa los accesos de prueba
              o solicita acceso al administrador del sistema.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4 p-7 pt-0">
            <Button asChild variant="brand" className="h-12 w-full rounded-2xl">
              <Link to="/login">Volver a iniciar sesión</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      const result = await registerLocalAccount({
        company,
        email,
        password,
        countryCode,
      });

      if (!result.ok) {
        if (result.error === "invalid-input") {
          toast.error(
            "Completa la empresa, el correo y una contraseña de al menos 6 caracteres.",
          );
          return;
        }

        // El resto (correo existente, contraseña débil, etc.) viene de Supabase:
        // lo traducimos a español con una recomendación de qué hacer.
        toast.error(translateAuthError(result.message));
        return;
      }

      if (result.needsEmailConfirmation) {
        toast.success(
          "Cuenta creada. Revisa tu correo para confirmar el acceso (mira también la carpeta de spam).",
        );
        navigate({ to: "/login" });
        return;
      }

      toast.success(
        "Cuenta creada. Completa los datos de tu negocio para empezar.",
      );
      navigate({ to: "/configuracion" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 md:p-8">
      <div className="grid w-full max-w-6xl overflow-hidden rounded-[2rem] bg-card shadow-2xl shadow-emerald-950/10 ring-1 ring-border/70 lg:min-h-[680px] lg:grid-cols-[0.9fr_1fr]">
        <div className="hidden flex-col justify-between bg-brand-gradient p-8 text-primary-foreground lg:flex">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/15 text-white">
              <Store className="h-6 w-6" />
            </div>
            <span className="text-lg font-black text-white">
              {platformName}
            </span>
          </div>

          <div>
            <div className="mb-5 inline-flex rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white">
              Crea tu tienda
            </div>
            <h1 className="max-w-md text-4xl font-black leading-tight text-white">
              Empieza a vender en minutos.
            </h1>
            <p className="mt-4 max-w-md text-sm leading-6 text-white/70">
              Registra tu empresa, elige tu país y accede a puntos de venta,
              inventario, caja y reportes desde el primer día.
            </p>
          </div>

          <div className="rounded-[1.5rem] bg-white/15 p-5 ring-1 ring-white/15">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-xl font-black text-white">POS</p>
                <p className="text-[11px] text-white/60">ventas</p>
              </div>
              <div>
                <p className="text-xl font-black text-white">Stock</p>
                <p className="text-[11px] text-white/60">control</p>
              </div>
              <div>
                <p className="text-xl font-black text-white">Caja</p>
                <p className="text-[11px] text-white/60">diaria</p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-center bg-background p-5 md:p-8">
          <div className="w-full max-w-md space-y-5">
            <div className="text-center lg:hidden">
              <div className="mb-2 inline-flex items-center gap-2">
                <Store className="h-5 w-5" />
                <span className="font-bold">{platformName}</span>
              </div>
            </div>
            <Card className="border-0 bg-card shadow-xl shadow-emerald-950/10">
              <CardHeader className="space-y-2 p-7 pb-4">
                <CardTitle className="text-2xl font-black">
                  Crear cuenta
                </CardTitle>
                <CardDescription>
                  Empieza con lo básico. Luego completas los datos de tu
                  negocio.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-7 pt-0">
                <form className="space-y-4" onSubmit={handleSubmit}>
                  <div className="space-y-2">
                    <Label>Empresa</Label>
                    <Input
                      value={company}
                      onChange={(event) => setCompany(event.target.value)}
                      placeholder="Ej. Bodega Don José"
                      className="h-12 rounded-2xl bg-muted/45"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Correo</Label>
                    <Input
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="correo@ejemplo.com"
                      autoComplete="email"
                      className="h-12 rounded-2xl bg-muted/45"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Contraseña</Label>
                    <Input
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="••••••••"
                      autoComplete="new-password"
                      className="h-12 rounded-2xl bg-muted/45"
                    />
                    <p className="text-xs text-muted-foreground">
                      Usa al menos 8 caracteres, combinando letras y números.
                    </p>
                  </div>
                  <Button
                    type="submit"
                    variant="brand"
                    className="h-12 w-full rounded-2xl"
                    disabled={isSubmitting}
                  >
                    {isSubmitting ? "Creando..." : "Registrarme"}
                  </Button>
                  <p className="text-center text-xs text-muted-foreground">
                    ¿Ya tienes cuenta?{" "}
                    <Link
                      to="/login"
                      className="font-medium text-primary hover:underline"
                    >
                      Inicia sesión
                    </Link>
                  </p>
                </form>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
