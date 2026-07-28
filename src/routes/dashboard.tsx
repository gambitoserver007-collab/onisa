import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  BarChart3,
  Boxes,
  CreditCard,
  Package,
  Receipt,
  ShoppingCart,
  Sparkles,
  TrendingUp,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AXIS_PROPS,
  CHART_COLORS,
  CHART_INITIAL_DIMENSION,
  GRID_PROPS,
  TOOLTIP_PROPS,
} from "@/lib/chartTheme";
import { AppShell } from "@/components/layout/AppShell";
import { ALL_LOCATIONS } from "@/lib/currentLocation";
import { useCurrentLocation } from "@/hooks/useCurrentLocation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useBusinessSettings } from "@/hooks/useBusinessSettings";
import { useDashboardData } from "@/hooks/useDashboardData";
import { DateRangeSelect } from "@/components/reports/DateRangeSelect";

export const Route = createFileRoute("/dashboard")({ component: Dashboard });

const COLORS = CHART_COLORS;
const EMPTY_CHART = [{ name: "Sin datos", value: 0 }];
const EMPTY_TIMELINE = [{ day: "Sin datos", total: 0 }];

function clampPercent(value: number, total: number) {
  if (!total) return 0;
  return Math.min(100, Math.max(0, Math.round((value / total) * 100)));
}

function formatDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("es", {
    day: "2-digit",
    month: "short",
  });
}

function MetricCard({
  icon: Icon,
  label,
  value,
  hint,
  tone = "bg-primary/10 text-primary",
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  hint?: string;
  tone?: string;
}) {
  return (
    <Card className="border-0 bg-card/95">
      <CardContent className="flex min-h-28 flex-col justify-between p-4">
        <div className="flex items-start justify-between gap-3">
          <div className={`grid h-11 w-11 place-items-center rounded-2xl ${tone}`}>
            <Icon className="h-5 w-5" />
          </div>
          <ArrowUpRight className="h-4 w-4 text-muted-foreground" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-1 truncate text-xl font-black">{value}</p>
          {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
        </div>
      </CardContent>
    </Card>
  );
}

function ProgressRow({
  label,
  value,
  total,
  amount,
}: {
  label: string;
  value: number;
  total: number;
  amount: string;
}) {
  const width = clampPercent(value, total);

  return (
    <div className="rounded-2xl border border-border/70 bg-card/80 p-3">
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{amount}</span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function Dashboard() {
  const { formatMoney, settings } = useBusinessSettings();
  const { currentLocationId } = useCurrentLocation();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const range = useMemo(() => ({ from: from || undefined, to: to || undefined }), [from, to]);
  const { data, error, isLoading, source } = useDashboardData(
    currentLocationId === ALL_LOCATIONS ? undefined : (currentLocationId ?? undefined),
    range,
  );
  const timeline = data.salesLast7Days.length ? data.salesLast7Days : EMPTY_TIMELINE;
  const byCategory = data.salesByCategory.length ? data.salesByCategory : EMPTY_CHART;
  const byMethod = data.salesByMethod.length ? data.salesByMethod : EMPTY_CHART;
  const totalByCategory = byCategory.reduce((sum, item) => sum + item.value, 0);
  const totalByMethod = byMethod.reduce((sum, item) => sum + item.value, 0);
  const bestCategory = byCategory.slice().sort((a, b) => b.value - a.value)[0];
  const bestMethod = byMethod.slice().sort((a, b) => b.value - a.value)[0];
  const monthGoal = data.totalMonth > 0 ? data.totalMonth * 1.25 : 100;
  const monthProgress = clampPercent(data.totalMonth, monthGoal);

  return (
    <AppShell>
      <div className="space-y-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-primary">Centro de control</p>
            <h1 className="mt-1 text-3xl font-black text-foreground">Dashboard</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {isLoading ? "Cargando datos de la tienda..." : "Resumen operativo de la tienda."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button asChild>
              <Link to="/pos">
                <ShoppingCart className="h-4 w-4" />
                Nueva venta
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/reportes">
                <BarChart3 className="h-4 w-4" />
                Reportes
              </Link>
            </Button>
          </div>
        </div>

        <DateRangeSelect
          onChange={(r) => {
            setFrom(r.from ?? "");
            setTo(r.to ?? "");
          }}
        />

        {error && source === "demo-fallback" && (
          <div className="rounded-2xl border border-primary/20 bg-card/70 px-3 py-2 text-sm text-foreground">
            No se pudo leer Supabase todavía. Mostrando datos de prueba.
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-5">
            <Card className="overflow-hidden border-0 bg-primary text-primary-foreground">
              <CardContent className="relative grid gap-5 p-5 md:grid-cols-[minmax(0,1fr)_260px] md:p-6">
                <div className="relative z-10">
                  <div className="mb-5 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold text-white">
                    <Sparkles className="h-3.5 w-3.5" />
                    Operación de hoy
                  </div>
                  <h2 className="max-w-xl text-3xl font-black leading-tight text-white md:text-4xl">
                    Hola, {settings.businessName}
                  </h2>
                  <p className="mt-3 max-w-xl text-sm leading-6 text-white/68">
                    Controla ventas, stock y clientes desde una vista rápida pensada para operar sin
                    perder tiempo.
                  </p>
                  <div className="mt-6 flex flex-wrap gap-2">
                    <Button asChild className="bg-white text-primary hover:bg-white/90">
                      <Link to="/pos">Abrir Punto de venta</Link>
                    </Button>
                    <Button
                      asChild
                      variant="outline"
                      className="border-white/15 bg-white/10 text-white hover:bg-white/15 hover:text-white"
                    >
                      <Link to="/productos">Ver inventario</Link>
                    </Button>
                  </div>
                </div>

                <div className="relative z-10 grid content-end gap-3">
                  <div className="rounded-[1.5rem] bg-white/10 p-4 ring-1 ring-white/10">
                    <p className="text-xs text-white/55">Ventas del mes</p>
                    <p className="mt-1 text-2xl font-black text-white">
                      {formatMoney(data.totalMonth)}
                    </p>
                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/15">
                      <div
                        className="h-full rounded-full bg-white"
                        style={{ width: `${monthProgress}%` }}
                      />
                    </div>
                    <p className="mt-2 text-xs text-white/55">
                      {monthProgress}% de la meta mensual
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-2xl bg-white/10 p-3 ring-1 ring-white/10">
                      <p className="text-xs text-white/55">Comprobantes</p>
                      <p className="mt-1 text-xl font-black text-white">{data.salesTodayCount}</p>
                    </div>
                    <div className="rounded-2xl bg-white/10 p-3 ring-1 ring-white/10">
                      <p className="text-xs text-white/55">Stock bajo</p>
                      <p className="mt-1 text-xl font-black text-white">{data.lowStockCount}</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <MetricCard
                icon={Receipt}
                label="Ventas hoy"
                value={formatMoney(data.totalToday)}
                hint={`${data.salesTodayCount} comprobantes`}
              />
              <MetricCard
                icon={Wallet}
                label="Ventas mes"
                value={formatMoney(data.totalMonth)}
                tone="bg-emerald-100/70 text-emerald-700"
              />
              <MetricCard
                icon={Package}
                label="Productos"
                value={data.productsCount}
                tone="bg-sky-100/70 text-sky-700"
              />
              <MetricCard
                icon={Users}
                label="Clientes"
                value={data.customersCount}
                tone="bg-violet-100/70 text-violet-700"
              />
              <MetricCard
                icon={AlertTriangle}
                label="Stock bajo"
                value={data.lowStockCount}
                tone="bg-rose-100/70 text-rose-700"
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
              <Card className="border-0 bg-card/95">
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <div>
                    <CardTitle className="text-base">Ventas recientes</CardTitle>
                    <p className="mt-1 text-xs text-muted-foreground">Últimos días registrados</p>
                  </div>
                  <TrendingUp className="h-5 w-5 text-primary" />
                </CardHeader>
                <CardContent className="h-72">
                  <ResponsiveContainer
                    width="100%"
                    height="100%"
                    initialDimension={CHART_INITIAL_DIMENSION}
                  >
                    <AreaChart data={timeline}>
                      <defs>
                        <linearGradient id="ventasFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#149457" stopOpacity={0.3} />
                          <stop offset="100%" stopColor="#149457" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid {...GRID_PROPS} />
                      <XAxis dataKey="day" {...AXIS_PROPS} />
                      <YAxis {...AXIS_PROPS} />
                      <Tooltip {...TOOLTIP_PROPS} />
                      <Area
                        dataKey="total"
                        fill="url(#ventasFill)"
                        stroke="#149457"
                        strokeWidth={3}
                        type="monotone"
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card className="border-0 bg-card/95">
                <CardHeader>
                  <CardTitle className="text-base">Ventas por categoría</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    {bestCategory ? `Mejor categoría: ${bestCategory.name}` : "Sin datos"}
                  </p>
                </CardHeader>
                <CardContent className="h-72">
                  <ResponsiveContainer
                    width="100%"
                    height="100%"
                    initialDimension={CHART_INITIAL_DIMENSION}
                  >
                    <BarChart data={byCategory}>
                      <CartesianGrid {...GRID_PROPS} />
                      <XAxis dataKey="name" {...AXIS_PROPS} />
                      <YAxis {...AXIS_PROPS} />
                      <Tooltip {...TOOLTIP_PROPS} />
                      <Bar dataKey="value" radius={[10, 10, 0, 0]} maxBarSize={56}>
                        {byCategory.map((_, index) => (
                          <Cell key={index} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            <Card className="border-0 bg-card/95">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">Últimas ventas</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">Comprobantes recientes</p>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link to="/ventas">Ver todo</Link>
                </Button>
              </CardHeader>
              <CardContent>
                <div className="grid gap-2 md:grid-cols-2">
                  {data.recentSales.map((sale) => (
                    <Link
                      key={sale.id}
                      to="/ventas/$id"
                      params={{ id: sale.id }}
                      className="rounded-2xl border border-border/70 bg-background/55 p-3 transition hover:border-primary/30 hover:bg-primary/5"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold">{sale.customer}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {sale.id} · {formatDate(sale.date)}
                          </p>
                        </div>
                        <p className="shrink-0 text-sm font-black">{formatMoney(sale.total)}</p>
                      </div>
                      <div className="mt-3 inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 text-[11px] text-muted-foreground">
                        <CreditCard className="h-3 w-3" />
                        {sale.method}
                      </div>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>

          <aside className="space-y-4">
            <Card className="border-0 bg-secondary">
              <CardHeader>
                <CardTitle className="text-base">Rendimiento</CardTitle>
                <p className="text-xs text-muted-foreground">Lectura rápida del negocio</p>
              </CardHeader>
              <CardContent className="space-y-3">
                <ProgressRow
                  label={bestCategory?.name ?? "Categoría"}
                  value={bestCategory?.value ?? 0}
                  total={totalByCategory}
                  amount={formatMoney(bestCategory?.value ?? 0)}
                />
                <ProgressRow
                  label={bestMethod?.name ?? "Método de pago"}
                  value={bestMethod?.value ?? 0}
                  total={totalByMethod}
                  amount={formatMoney(bestMethod?.value ?? 0)}
                />
                <div className="rounded-2xl border border-border/70 bg-card/80 p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">Clientes registrados</span>
                    <Users className="h-4 w-4 text-primary" />
                  </div>
                  <p className="mt-2 text-2xl font-black">{data.customersCount}</p>
                </div>
              </CardContent>
            </Card>

            <Card className="border-0 bg-card/95">
              <CardHeader className="flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="text-base">Alertas de stock</CardTitle>
                  <p className="mt-1 text-xs text-muted-foreground">Productos por reponer</p>
                </div>
                <Boxes className="h-5 w-5 text-primary" />
              </CardHeader>
              <CardContent className="space-y-2">
                {data.lowStockProducts.length ? (
                  data.lowStockProducts.map((product) => (
                    <div
                      key={product.id}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-border/70 bg-background/55 p-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{product.name}</p>
                        <p className="text-xs text-muted-foreground">Stock mínimo sugerido</p>
                      </div>
                      <span className="rounded-full bg-rose-100 px-2 py-1 text-xs font-semibold text-rose-700">
                        {product.stock} {product.unit}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="rounded-2xl border border-border/70 bg-background/55 p-3 text-sm text-muted-foreground">
                    Sin productos críticos por ahora.
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-0 bg-card/95">
              <CardHeader>
                <CardTitle className="text-base">Acciones rápidas</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-2">
                <Button asChild variant="outline" className="justify-between">
                  <Link to="/pos">
                    Punto de venta
                    <ArrowUpRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" className="justify-between">
                  <Link to="/productos">
                    Productos
                    <ArrowUpRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="outline" className="justify-between">
                  <Link to="/reportes">
                    Reportes
                    <ArrowUpRight className="h-4 w-4" />
                  </Link>
                </Button>
              </CardContent>
            </Card>

            <Card className="border-0 bg-card/95">
              <CardHeader>
                <CardTitle className="text-base">Forma de pago</CardTitle>
              </CardHeader>
              <CardContent className="h-56">
                <ResponsiveContainer
                  width="100%"
                  height="100%"
                  initialDimension={CHART_INITIAL_DIMENSION}
                >
                  <PieChart>
                    <Tooltip {...TOOLTIP_PROPS} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                    <Pie
                      data={byMethod}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={46}
                      outerRadius={78}
                      paddingAngle={2}
                    >
                      {byMethod.map((_, index) => (
                        <Cell key={index} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </aside>
        </div>
      </div>
    </AppShell>
  );
}
