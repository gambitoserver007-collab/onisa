import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { Store } from "lucide-react";
import { useDemoSession } from "@/hooks/useDemoSession";
import { canAccessSaaS } from "@/lib/permissions";
import { LandingPage } from "@/components/landing/LandingPage";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      {
        title: "Onisa — El sistema para vender, controlar y hacer crecer tu tienda",
      },
      {
        name: "description",
        content:
          "Onisa es el punto de venta que conecta tus ventas, tu inventario y tus ganancias en un solo lugar. Empieza gratis.",
      },
    ],
  }),
  component: Index,
});

function Index() {
  const navigate = useNavigate();
  const { isReady, session } = useDemoSession();

  // Si ya hay sesión iniciada, la página de inicio no muestra la landing:
  // manda al panel que corresponda (Super Admin → /admin; dueño de tienda → /dashboard).
  useEffect(() => {
    if (!isReady) return;
    if (session) {
      navigate({ to: canAccessSaaS(session) ? "/admin" : "/dashboard" });
    }
  }, [isReady, session, navigate]);

  // Usuario con sesión: pantalla de transición mientras redirige.
  if (isReady && session) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-brand-radial text-center">
        <span className="grid h-16 w-16 animate-fade-up place-items-center rounded-3xl bg-brand-gradient text-primary-foreground shadow-glow">
          <Store className="h-8 w-8" />
        </span>
        <div className="animate-fade-up">
          <p className="text-lg font-black tracking-tight text-foreground">Onisa</p>
          <p className="text-sm text-muted-foreground">Cargando…</p>
        </div>
      </div>
    );
  }

  // Visitante sin sesión (o aún cargando): la página de ventas.
  return <LandingPage />;
}
