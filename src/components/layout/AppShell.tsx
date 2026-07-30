import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  ShoppingCart,
  Receipt,
  RotateCcw,
  Wallet,
  Package,
  Boxes,
  Scale,
  Tags,
  BadgePercent,
  Users,
  UserRound,
  BarChart3,
  TrendingUp,
  User,
  Shield,
  CreditCard,
  Settings,
  Database,
  LogOut,
  Search,
  Store,
  LayoutGrid,
  Sparkles,
  ChevronRight,
  ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";
import { logout } from "@/lib/demoAuth";
import { canAccessPath, canAccessSaaS } from "@/lib/permissions";
import { useDemoSession } from "@/hooks/useDemoSession";
import { useAccessControl } from "@/hooks/useAccessControl";
import { useBusinessSettings } from "@/hooks/useBusinessSettings";
import { DemoBanner } from "./DemoBanner";
import { LocationSwitcher } from "./LocationSwitcher";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from "@/components/ui/sheet";
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
  icon: React.ComponentType<{ className?: string }>;
};

const sections: { title: string; items: Item[] }[] = [
  {
    title: "Principal",
    items: [
      { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { to: "/pos", label: "Punto de venta", icon: ShoppingCart },
    ],
  },
  {
    title: "Operaciones",
    items: [
      { to: "/ventas", label: "Ventas", icon: Receipt },
      { to: "/caja", label: "Caja", icon: Wallet },
      { to: "/promociones", label: "Promociones", icon: BadgePercent },
      { to: "/devoluciones", label: "Devoluciones", icon: RotateCcw },
    ],
  },
  {
    title: "Inventario",
    items: [
      { to: "/productos", label: "Productos", icon: Package },
      { to: "/inventario", label: "Control de Stock", icon: Boxes },
      { to: "/categorias", label: "Categorías", icon: Tags },
      { to: "/etiquetas", label: "Unidades", icon: Scale },
    ],
  },
  {
    title: "Contactos",
    items: [
      { to: "/clientes", label: "Clientes", icon: Users },
      { to: "/proveedores", label: "Proveedores", icon: UserRound },
    ],
  },
  {
    title: "Análisis",
    items: [
      { to: "/reportes", label: "Reportes", icon: BarChart3 },
      { to: "/ganancias", label: "Ganancias", icon: TrendingUp },
    ],
  },
  {
    title: "Ajustes",
    items: [
      { to: "/perfil", label: "Mi Perfil", icon: User },
      { to: "/puntos-de-venta", label: "Sucursales", icon: Store },
      { to: "/usuarios", label: "Usuarios", icon: Shield },
      { to: "/suscripcion", label: "Mi Suscripción", icon: CreditCard },
      { to: "/configuracion", label: "Configuración", icon: Settings },
      { to: "/backup", label: "Respaldo", icon: Database },
    ],
  },
];

// Primary tabs for the mobile bottom navigation bar.
const bottomNav: Item[] = [
  { to: "/dashboard", label: "Inicio", icon: LayoutDashboard },
  { to: "/ventas", label: "Ventas", icon: Receipt },
  { to: "/productos", label: "Productos", icon: Package },
];

function isActive(pathname: string, to: string) {
  return pathname === to || pathname.startsWith(to + "/");
}

let desktopSidebarScrollTop = 0;

function NavList({
  pathname,
  role,
  allowedSections,
  onClick,
}: {
  pathname: string;
  role?: string | null;
  allowedSections?: string[] | null;
  onClick?: () => void;
}) {
  const visibleSections = sections
    .map((s) => ({
      ...s,
      items: s.items.filter((it) =>
        canAccessPath(role, it.to, allowedSections),
      ),
    }))
    .filter((s) => s.items.length > 0);
  return (
    <nav className="flex flex-col gap-5 px-3 py-4">
      {visibleSections.map((s) => (
        <div key={s.title}>
          <p className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-sidebar-foreground/45">
            {s.title}
          </p>
          <div className="flex flex-col gap-1">
            {s.items.map((it) => {
              const active = isActive(pathname, it.to);
              return (
                <Link
                  key={it.to}
                  to={it.to}
                  onClick={onClick}
                  className={cn(
                    "group relative flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
                    active
                      ? "bg-brand-gradient text-sidebar-primary-foreground shadow-glow"
                      : "text-sidebar-foreground/65 hover:bg-sidebar-accent hover:text-sidebar-foreground",
                  )}
                >
                  <it.icon className="h-[18px] w-[18px] shrink-0" />
                  <span className="truncate">{it.label}</span>
                  {active && (
                    <span className="ml-auto h-1.5 w-1.5 rounded-full bg-sidebar-primary-foreground/80" />
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

function Brand({
  businessName,
  subtitle,
  logoUrl,
}: {
  businessName: string;
  subtitle: string;
  logoUrl?: string;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-2xl bg-brand-gradient text-primary-foreground shadow-glow">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={businessName}
            className="h-full w-full object-cover"
          />
        ) : (
          <Store className="h-5 w-5" />
        )}
      </div>
      <div className="min-w-0">
        <p className="truncate text-base font-extrabold leading-tight text-sidebar-foreground">
          {businessName}
        </p>
        <p className="truncate text-xs text-sidebar-foreground/55">
          {subtitle}
        </p>
      </div>
    </div>
  );
}

function UpgradeCard({
  onClick,
  className,
}: {
  onClick?: () => void;
  className?: string;
}) {
  return (
    <Link
      to="/suscripcion"
      onClick={onClick}
      className={cn(
        "mx-3 mb-4 mt-4 block shrink-0 overflow-hidden rounded-2xl bg-brand-gradient p-4 text-primary-foreground shadow-glow transition active:scale-[0.98]",
        className,
      )}
    >
      <Sparkles className="h-5 w-5" />
      <p className="mt-2 text-sm font-bold leading-tight">Mejora tu plan</p>
      <p className="mt-0.5 text-xs text-primary-foreground/80">
        Desbloquea reportes, usuarios y más.
      </p>
      <span className="mt-3 inline-flex items-center gap-1 rounded-full bg-white/20 px-3 py-1 text-xs font-semibold backdrop-blur">
        Ver planes <ChevronRight className="h-3.5 w-3.5" />
      </span>
    </Link>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { isReady, session } = useDemoSession();
  const { settings } = useBusinessSettings();
  const { allowedSections, ready: accessReady } = useAccessControl();
  const role = session?.role;
  const hasAppAccess =
    role === "user" ||
    role === "admin" ||
    role === "finanzas" ||
    role === "operador";
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [open, setOpen] = useState(false);
  const desktopSidebarRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isReady) return;
    if (!role) navigate({ to: "/login" });
  }, [isReady, role, navigate]);

  // Redirect away from screens the current role cannot access. Espera a conocer
  // los accesos (accessReady) para no redirigir/parpadear al navegar.
  useEffect(() => {
    if (!isReady || !role || !accessReady) return;
    if (!canAccessPath(role, pathname, allowedSections)) {
      toast.error("No tienes acceso a esta sección.");
      navigate({ to: "/dashboard" });
    }
  }, [isReady, role, accessReady, pathname, allowedSections, navigate]);

  useLayoutEffect(() => {
    if (desktopSidebarRef.current) {
      desktopSidebarRef.current.scrollTop = desktopSidebarScrollTop;
    }
  }, [pathname]);

  if (!isReady || !session || !hasAppAccess) return null;
  const today = new Date().toLocaleDateString(settings.locale, {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
  const subtitle = `${settings.countryName} · ${settings.currencyCode}`;
  const initials = session.name.slice(0, 1).toUpperCase();
  // POS is a focused "task" flow with its own bottom cart bar — hide the tab bar there.
  const showBottomNav = !pathname.startsWith("/pos");
  const canSell = canAccessPath(role, "/pos", allowedSections);
  const canManagePlan = role === "admin";
  const showSaaS = canAccessSaaS(session);
  const visibleBottomNav = bottomNav.filter((it) =>
    canAccessPath(role, it.to, allowedSections),
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      {/* Desktop sidebar */}
      <aside className="relative hidden h-full w-64 shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground lg:flex">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-brand-radial opacity-[0.18] [mask-image:linear-gradient(to_bottom,black,transparent)]" />
        <div className="relative px-5 py-5">
          <Brand
            businessName={settings.businessName}
            subtitle={subtitle}
            logoUrl={settings.logoUrl}
          />
        </div>
        <div
          ref={desktopSidebarRef}
          className="relative flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain nice-scroll"
          onScroll={(event) => {
            desktopSidebarScrollTop = event.currentTarget.scrollTop;
          }}
        >
          <NavList
            pathname={pathname}
            role={role}
            allowedSections={allowedSections}
          />
          {canManagePlan && <UpgradeCard className="mt-auto" />}
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Top app bar */}
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b border-border/60 bg-card/80 px-4 backdrop-blur-xl">
          {/* Back button on focused flows (e.g. POS) where the tab bar is hidden */}
          {!showBottomNav && (
            <Button
              variant="ghost"
              size="icon"
              className="-ml-1 shrink-0 rounded-full lg:hidden"
              aria-label="Volver al inicio"
              onClick={() => navigate({ to: "/dashboard" })}
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>
          )}

          {/* Mobile brand */}
          <div className="flex items-center gap-2.5 lg:hidden">
            <div className="grid h-9 w-9 place-items-center overflow-hidden rounded-xl bg-brand-gradient text-primary-foreground shadow-glow">
              {settings.logoUrl ? (
                <img
                  src={settings.logoUrl}
                  alt={settings.businessName}
                  className="h-full w-full object-cover"
                />
              ) : (
                <Store className="h-4.5 w-4.5" />
              )}
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-extrabold leading-tight">
                {showBottomNav ? settings.businessName : "Punto de venta"}
              </p>
              <p className="truncate text-[11px] text-muted-foreground">
                {showBottomNav ? subtitle : "Modo venta"}
              </p>
            </div>
          </div>

          {/* Desktop search */}
          <div className="relative hidden max-w-sm flex-1 md:block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar productos, ventas, clientes..."
              className="h-11 rounded-2xl pl-9"
            />
          </div>

          <div className="ml-auto flex items-center gap-1.5 sm:gap-3">
            <LocationSwitcher />
            <span className="hidden text-xs font-medium text-muted-foreground lg:inline">
              {today}
            </span>
            {showSaaS && (
              <Button
                variant="secondary"
                size="sm"
                className="gap-2 rounded-full border border-border/60 font-semibold shadow-sm"
                onClick={() => navigate({ to: "/admin" })}
              >
                <Shield className="h-4 w-4" />
                <span className="hidden sm:inline">Panel SaaS</span>
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-full transition active:scale-95">
                  <Avatar className="h-9 w-9 border-2 border-primary/30">
                    <AvatarFallback className="bg-brand-gradient text-xs font-bold text-primary-foreground">
                      {initials}
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
                <DropdownMenuItem onClick={() => navigate({ to: "/perfil" })}>
                  <User className="mr-2 h-4 w-4" /> Mi Perfil
                </DropdownMenuItem>
                {canAccessPath(role, "/configuracion", allowedSections) && (
                  <DropdownMenuItem
                    onClick={() => navigate({ to: "/configuracion" })}
                  >
                    <Settings className="mr-2 h-4 w-4" /> Configuración
                  </DropdownMenuItem>
                )}
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

        {!session.isDemo && role === "admin" && !session.fiscalId && (
          <div className="border-b border-warm/30 bg-warm/10 px-4 py-2.5">
            <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-foreground">
                Completa los datos de tu negocio (nombre,{" "}
                {session.fiscalIdLabel ?? "ID fiscal"}, dirección) para que tus
                comprobantes salgan correctos.
              </p>
              <Button
                size="sm"
                variant="brand"
                className="shrink-0"
                onClick={() => navigate({ to: "/configuracion" })}
              >
                Completar datos
              </Button>
            </div>
          </div>
        )}

        <main
          className={cn(
            "flex-1 overflow-y-auto bg-background p-4 md:p-6 lg:pb-6",
            showBottomNav
              ? "pb-[calc(5.5rem+env(safe-area-inset-bottom))]"
              : "pb-4",
          )}
        >
          {/* El contenido aparece al instante al navegar. Antes iba envuelto en un
              `<div key={pathname} className="animate-fade-up">`: como el AppShell se
              re-monta en cada navegación, esa animación de 0.5s (que arranca en
              opacity:0) hacía que la sección nueva entrara invisible mientras la
              anterior seguía pintada → se veía "reaparecer" la sección previa. */}
          {children}
        </main>
      </div>

      {/* Mobile bottom navigation */}
      {showBottomNav && (
        <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-border/60 bg-card/90 pb-safe backdrop-blur-xl lg:hidden">
          <div className="mx-auto grid max-w-md grid-cols-5 items-end px-2 pt-1.5">
            {visibleBottomNav.slice(0, 2).map((it) => (
              <BottomTab
                key={it.to}
                item={it}
                active={isActive(pathname, it.to)}
              />
            ))}

            {/* Center elevated "Vender" FAB (hidden for roles that can't sell) */}
            <div className="flex justify-center">
              {canSell ? (
                <Link
                  to="/pos"
                  aria-label="Punto de venta"
                  className="-mt-7 grid h-16 w-16 place-items-center rounded-[1.4rem] bg-brand-gradient text-primary-foreground shadow-glow ring-4 ring-card transition active:scale-95"
                >
                  <ShoppingCart className="h-6 w-6" />
                </Link>
              ) : (
                <span className="h-9 w-9" aria-hidden />
              )}
            </div>

            {visibleBottomNav.slice(2).map((it) => (
              <BottomTab
                key={it.to}
                item={it}
                active={isActive(pathname, it.to)}
              />
            ))}

            {/* "Más" opens the full navigation sheet */}
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <button
                  className={cn(
                    "flex flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-[10px] font-semibold transition",
                    open ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  <LayoutGrid className="h-[22px] w-[22px]" />
                  <span>Más</span>
                </button>
              </SheetTrigger>
              <SheetContent
                side="left"
                className="w-80 max-w-[85vw] overflow-y-auto border-0 bg-sidebar p-0 text-sidebar-foreground nice-scroll"
              >
                <SheetTitle className="sr-only">Menú de navegación</SheetTitle>
                <div className="relative">
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-brand-radial opacity-20 [mask-image:linear-gradient(to_bottom,black,transparent)]" />
                  <div className="relative px-5 py-5">
                    <Brand
                      businessName={settings.businessName}
                      subtitle={subtitle}
                      logoUrl={settings.logoUrl}
                    />
                  </div>
                </div>
                <NavList
                  pathname={pathname}
                  role={role}
                  allowedSections={allowedSections}
                  onClick={() => setOpen(false)}
                />
                {canManagePlan && (
                  <UpgradeCard onClick={() => setOpen(false)} />
                )}
              </SheetContent>
            </Sheet>
          </div>
        </nav>
      )}
    </div>
  );
}

function BottomTab({ item, active }: { item: Item; active: boolean }) {
  return (
    <Link
      to={item.to}
      className={cn(
        "relative flex flex-col items-center gap-0.5 rounded-xl px-1 py-1.5 text-[10px] font-semibold transition",
        active ? "text-primary" : "text-muted-foreground",
      )}
    >
      {active && (
        <span className="absolute -top-1.5 h-1 w-7 rounded-full bg-brand-gradient" />
      )}
      <item.icon className="h-[22px] w-[22px]" />
      <span className="truncate">{item.label}</span>
    </Link>
  );
}
