import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Shield, Store } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CountrySelect } from "@/components/settings/CountrySelect";
import { PUBLIC_REGISTRATION_ENABLED, SHOW_DEMO_ACCESS } from "@/config/access";
import { DEFAULT_MARKET_CODE, getMarketByCountryCode } from "@/data/markets";
import { login, loginAs } from "@/lib/demoAuth";
import { canAccessSaaS } from "@/lib/permissions";
import type { DemoSession } from "@/types";
import { getBusinessSettings } from "@/lib/businessSettings";
import { detectCountryCode } from "@/lib/detectCountry";

export const Route = createFileRoute("/login")({
  validateSearch: (s: Record<string, unknown>) => ({
    next: typeof s.next === "string" ? s.next : undefined,
  }),
  component: LoginPage,
});

function safeNext(next: string | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}

const demoOptions = [
  {
    role: "admin",
    label: "Super Admin Demo",
    description: "Recorre la plataforma en modo lectura",
    icon: Shield,
  },
] as const;

type DemoRole = (typeof demoOptions)[number]["role"];

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [demoDialogRole, setDemoDialogRole] = useState<DemoRole | null>(null);
  const [demoCountryCode, setDemoCountryCode] = useState(() => getBusinessSettings().countryCode);
  const selectedDemoMarket = getMarketByCountryCode(demoCountryCode);

  // Preselect the visitor's country (timezone + language) unless one was set.
  useEffect(() => {
    setDemoCountryCode((current) =>
      current === DEFAULT_MARKET_CODE ? detectCountryCode() : current,
    );
  }, []);
  const selectedDemoOption = demoOptions.find((option) => option.role === demoDialogRole);

  const { next } = Route.useSearch();
  const routeAfterLogin = (session: DemoSession) => {
    const target = safeNext(next);
    if (target) {
      window.location.href = target;
      return;
    }
    navigate({ to: canAccessSaaS(session) ? "/admin" : "/dashboard" });
  };

  const handle = async (event: React.FormEvent) => {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      const session = await login(email, password);
      if (!session) {
        toast.error("Correo o contraseña incorrectos. Revísalos e inténtalo de nuevo.");
        return;
      }

      toast.success(`Bienvenido, ${session.name}`);
      routeAfterLogin(session);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDemoAccess = async (role: DemoRole, countryCode: string) => {
    setIsSubmitting(true);

    try {
      const session = await loginAs(role, countryCode);
      const market = getMarketByCountryCode(countryCode);
      toast.success(`Bienvenido, ${session.name}. Modo de Prueba en ${market.countryName}.`);
      routeAfterLogin(session);
    } catch {
      toast.error("No se pudo iniciar el Modo de Prueba.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4 md:p-8">
      <div className="grid w-full max-w-6xl overflow-hidden rounded-[2rem] bg-card shadow-2xl shadow-emerald-950/10 ring-1 ring-border/70 lg:min-h-[680px] lg:grid-cols-[0.9fr_1fr]">
        <div className="hidden flex-col justify-between bg-primary p-8 text-primary-foreground lg:flex">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/15 text-white">
              <Store className="h-6 w-6" />
            </div>
            <span className="text-lg font-black text-white">Tienda Ágil</span>
          </div>

          <div>
            <div className="mb-5 inline-flex rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white">
              Plataforma POS
            </div>
            <h1 className="max-w-md text-4xl font-black leading-tight text-white">
              Gestiona tu tienda desde un solo lugar.
            </h1>
            <p className="mt-4 max-w-md text-sm leading-6 text-white/65">
              Puntos de venta, inventario, caja, ventas y reportes en una experiencia moderna y
              multiempresa.
            </p>
          </div>

          <div className="rounded-[1.5rem] bg-white/15 p-5 ring-1 ring-white/15">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-xl font-black text-white">POS</p>
                <p className="text-[11px] text-white/55">ventas</p>
              </div>
              <div>
                <p className="text-xl font-black text-white">Stock</p>
                <p className="text-[11px] text-white/55">control</p>
              </div>
              <div>
                <p className="text-xl font-black text-white">Caja</p>
                <p className="text-[11px] text-white/55">diaria</p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-center bg-background p-5 md:p-8">
          <div className="w-full max-w-md space-y-5">
            <div className="text-center lg:hidden">
              <div className="mb-2 inline-flex items-center gap-2">
                <Store className="h-5 w-5" />
                <span className="font-bold">Tienda Ágil</span>
              </div>
            </div>
            <Card className="border-0 bg-card shadow-xl shadow-emerald-950/10">
              <CardHeader className="space-y-2 p-7 pb-4">
                <CardTitle className="text-2xl font-black">Iniciar sesión</CardTitle>
                <CardDescription>
                  Ingresa con tu correo y contraseña, o crea una cuenta nueva.
                </CardDescription>
              </CardHeader>
              <CardContent className="p-7 pt-0">
                <form className="space-y-4" onSubmit={handle}>
                  <div className="space-y-2">
                    <Label htmlFor="email">Correo</Label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                      placeholder="correo@ejemplo.com"
                      autoComplete="email"
                      className="h-12 rounded-2xl bg-muted/45"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Contraseña</Label>
                    <Input
                      id="password"
                      type="password"
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      placeholder="••••••••"
                      autoComplete="current-password"
                      className="h-12 rounded-2xl bg-muted/45"
                    />
                  </div>
                  <Button type="submit" className="h-12 w-full rounded-2xl" disabled={isSubmitting}>
                    {isSubmitting ? "Entrando..." : "Entrar"}
                  </Button>
                  {SHOW_DEMO_ACCESS && (
                    <div className="rounded-2xl border border-border/70 bg-muted/45 p-2.5">
                      <div className="grid gap-2">
                        {demoOptions.map(({ role, label, description, icon: Icon }) => (
                          <Button
                            key={role}
                            type="button"
                            variant="outline"
                            className="h-auto justify-start gap-2 rounded-xl border-border/70 bg-card px-3 py-2 text-left shadow-sm shadow-emerald-950/5"
                            aria-label={`${label} en modo lectura`}
                            disabled={isSubmitting}
                            onClick={() => setDemoDialogRole(role)}
                          >
                            <Icon className="h-4 w-4 shrink-0" />
                            <span className="min-w-0">
                              <span className="block text-sm font-medium">{label}</span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {description}
                              </span>
                            </span>
                          </Button>
                        ))}
                      </div>
                      <p className="mt-2 text-center text-xs text-muted-foreground">
                        Vista de demostración (solo lectura).
                      </p>
                    </div>
                  )}
                  {PUBLIC_REGISTRATION_ENABLED && (
                    <p className="text-center text-xs text-muted-foreground">
                      ¿No tienes cuenta?{" "}
                      <Link to="/register" className="font-medium text-primary hover:underline">
                        Regístrate
                      </Link>
                    </p>
                  )}
                </form>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
      <Dialog
        open={Boolean(demoDialogRole)}
        onOpenChange={(open) => {
          if (!open) setDemoDialogRole(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Configura el Modo de Prueba</DialogTitle>
            <DialogDescription>
              Elige el país para ver la app con su moneda, impuestos y datos de ejemplo.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label>País operativo</Label>
              <CountrySelect
                value={demoCountryCode}
                onValueChange={setDemoCountryCode}
                disabled={isSubmitting}
              />
              <p className="text-sm text-muted-foreground">
                Moneda: {selectedDemoMarket.currencyName} ({selectedDemoMarket.currencyCode})
              </p>
            </div>

            {selectedDemoOption && (
              <div className="rounded-md border bg-muted/40 p-3 text-sm">
                <p className="font-medium">{selectedDemoOption.label}</p>
                <p className="mt-1 text-muted-foreground">{selectedDemoOption.description}</p>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={isSubmitting}
              onClick={() => setDemoDialogRole(null)}
            >
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={isSubmitting || !demoDialogRole}
              onClick={() => {
                if (demoDialogRole) void handleDemoAccess(demoDialogRole, demoCountryCode);
              }}
            >
              {isSubmitting
                ? "Entrando..."
                : `Entrar como ${selectedDemoOption?.label ?? "Modo de Prueba"}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
