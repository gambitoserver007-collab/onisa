import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Building2,
  Globe,
  Layers,
  User,
  LogOut,
  Store,
  CreditCard,
} from "lucide-react";
import { logout } from "@/lib/demoAuth";
import { fetchPlatformBranding } from "@/services/appData";
import { canAccessSaaS } from "@/lib/permissions";
import { useDemoSession } from "@/hooks/useDemoSession";
import { DemoBanner } from "./DemoBanner";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

type Item = {
  to: string;
  label: string;
  short: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
};

const items: Item[] = [
  {
    to: "/admin",
    label: "Dashboard",
    short: "Inicio",
    icon: LayoutDashboard,
    exact: true,
  },
  {
    to: "/admin/empresas",
    label: "Empresas",
    short: "Empresas",
    icon: Building2,
  },
  {
    to: "/admin/paises",
    label: "Países / Impuestos",
    short: "Países",
    icon: Globe,
  },
  { to: "/admin/planes", label: "Planes", short: "Planes", icon: Layers },
  {
    to: "/admin/metodos-pago",
    label: "Métodos de pago",
    short: "Pagos",
    icon: CreditCard,
  },
  { to: "/admin/perfil", label: "Mi Perfil", short: "Perfil", icon: User },
];

function isActive(pathname: string, item: Item) {
  return item.exact ? pathname === item.to : pathname.startsWith(item.to);
}

function NavList({ pathname }: { pathname: string }) {
  return (
    <nav className="flex flex-col gap-0.5 px-3 py-4">
      {items.map((it) => {
        const active = isActive(pathname, it);
        return (
          <Link
            key={it.to}
            to={it.to}
            className={cn(
              "relative flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition",
              active
                ? "bg-brand-gradient font-medium text-sidebar-primary-foreground shadow-glow"
                : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground",
            )}
          >
            <it.icon className="h-4 w-4" />
            <span>{it.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { isReady, session } = useDemoSession();
  const allowed = canAccessSaaS(session);
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [platformLogo, setPlatformLogo] = useState<string | null>(null);
  const [platformName, setPlatformName] = useState("Onisa");

  useEffect(() => {
    if (!isReady) return;
    if (!session) navigate({ to: "/login" });
    else if (!allowed) navigate({ to: "/dashboard" });
  }, [isReady, session, allowed, navigate]);

  useEffect(() => {
    if (!allowed) return;
    void fetchPlatformBranding()
      .then((branding) => {
        setPlatformLogo(branding.logoUrl);
        setPlatformName(branding.name);
      })
      .catch(() => undefined);
  }, [allowed]);
  if (!isReady || !session || !allowed) return null;

  return (
    <div className="flex min-h-screen bg-background">
      <aside className="hidden w-64 shrink-0 border-r border-sidebar-border bg-sidebar text-sidebar-foreground lg:flex lg:flex-col">
        <div className="flex items-center gap-3 border-b border-sidebar-border px-4 py-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-2xl bg-brand-gradient text-primary-foreground shadow-glow">
            {platformLogo ? (
              <img
                src={platformLogo}
                alt={platformName}
                className="h-full w-full object-cover"
              />
            ) : (
              <Store className="h-5 w-5" />
            )}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-sidebar-foreground">
              {platformName}
            </p>
            <p className="truncate text-xs text-muted-foreground">
              Plataforma SaaS
            </p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto nice-scroll">
          <NavList pathname={pathname} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b border-border/60 bg-card/80 px-4 backdrop-blur-xl">
          <p className="text-sm font-semibold">Panel de Plataforma</p>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            <Button
              variant="secondary"
              size="sm"
              className="gap-2 rounded-full border border-border/60 font-semibold shadow-sm"
              onClick={() => navigate({ to: "/dashboard" })}
            >
              <Store className="h-4 w-4" />
              <span className="hidden sm:inline">Panel de tienda</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-full transition active:scale-95">
                  <Avatar className="h-9 w-9 border-2 border-primary/30">
                    <AvatarFallback className="bg-brand-gradient text-xs font-bold text-primary-foreground">
                      {session.name.slice(0, 1).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="text-sm font-semibold">{session.name}</div>
                  <div className="text-xs font-normal text-muted-foreground">
                    {session.email}
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => navigate({ to: "/admin/perfil" })}
                >
                  <User className="mr-2 h-4 w-4" /> Mi Perfil
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={async () => {
                    await logout();
                    navigate({ to: "/login" });
                  }}
                >
                  <LogOut className="mr-2 h-4 w-4" /> Cerrar sesión
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        <DemoBanner />
        <main className="flex-1 p-4 pb-[calc(5rem+env(safe-area-inset-bottom))] md:p-6 lg:pb-6">
          {children}
        </main>
      </div>

      {/* Mobile bottom navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-card/90 pb-safe backdrop-blur-xl lg:hidden">
        <div className="mx-auto grid max-w-md grid-cols-6 items-end px-2 pt-1.5">
          {items.map((it) => {
            const active = isActive(pathname, it);
            return (
              <Link
                key={it.to}
                to={it.to}
                className={cn(
                  "relative flex flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-[10px] font-semibold transition",
                  active ? "text-primary" : "text-muted-foreground",
                )}
              >
                {active && (
                  <span className="absolute -top-1.5 h-1 w-7 rounded-full bg-brand-gradient" />
                )}
                <it.icon className="h-[22px] w-[22px]" />
                <span className="truncate">{it.short}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
