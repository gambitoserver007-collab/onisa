import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  BarChart3,
  Boxes,
  Download,
  Printer,
  TrendingUp,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
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
import { DemoGuardedButton } from "@/components/demo/DemoGuardedButton";
import { AppShell } from "@/components/layout/AppShell";
import { FallbackNotice } from "@/components/layout/FallbackNotice";
import { ALL_LOCATIONS } from "@/lib/currentLocation";
import { useCurrentLocation } from "@/hooks/useCurrentLocation";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DateRangeSelect } from "@/components/reports/DateRangeSelect";
import { useBusinessSettings } from "@/hooks/useBusinessSettings";
import { useDashboardData } from "@/hooks/useDashboardData";

export const Route = createFileRoute("/reportes")({ component: Reportes });

function Kpi({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string | number;
  icon: LucideIcon;
}) {
  return (
    <Card className="shadow-card">
      <CardContent className="flex items-center gap-3 p-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary">
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="mt-0.5 text-2xl font-black tracking-tight">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function Reportes() {
  const { formatMoney } = useBusinessSettings();
  const { currentLocationId } = useCurrentLocation();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const range = useMemo(
    () => ({ from: from || undefined, to: to || undefined }),
    [from, to],
  );
  const hasRange = Boolean(from || to);
  const { data, error, source } = useDashboardData(
    currentLocationId === ALL_LOCATIONS
      ? undefined
      : (currentLocationId ?? undefined),
    range,
  );
  const lowStock = data.lowStockProducts;
  const rangeTotal = useMemo(
    () => data.salesByCategory.reduce((acc, row) => acc + (row.value || 0), 0),
    [data.salesByCategory],
  );
  const salesByCategory = data.salesByCategory.length
    ? data.salesByCategory
    : [{ name: "Sin datos", value: 0 }];
  const salesByMethod = data.salesByMethod.length
    ? data.salesByMethod
    : [{ name: "Sin datos", value: 0 }];
  const salesLast7Days = data.salesLast7Days.length
    ? data.salesLast7Days
    : [{ day: "Sin datos", total: 0 }];

  const exportCSV = () => {
    const rows: (string | number)[][] = [
      ["Reporte del negocio"],
      [],
      ["Indicador", "Valor"],
      ["Ventas del mes", data.totalMonth],
      ["Productos", data.productsCount],
      ["Clientes", data.customersCount],
      ["Stock bajo", data.lowStockCount],
      [],
      ["Top categorías", "Total"],
      ...data.salesByCategory.map((c) => [c.name, c.value]),
      [],
      ["Método de pago", "Total"],
      ...data.salesByMethod.map((m) => [m.name, m.value]),
      [],
      ["Ventas por día", "Total"],
      ...data.salesLast7Days.map((d) => [d.day, d.total]),
    ];
    const csv = rows
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "reporte.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppShell>
      <PageHeader
        icon={BarChart3}
        eyebrow="Análisis"
        title="Reportes"
        description="Análisis del negocio."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <DemoGuardedButton variant="brand" onAllowedClick={exportCSV}>
              <Download className="mr-1 h-4 w-4" /> Exportar
            </DemoGuardedButton>
            <DemoGuardedButton
              variant="outline"
              onAllowedClick={() => window.print()}
            >
              <Printer className="mr-1 h-4 w-4" /> Imprimir
            </DemoGuardedButton>
          </div>
        }
      />
      <FallbackNotice show={!!error && source === "demo-fallback"}>
        No se pudo leer Supabase todavía. Mostrando reportes de prueba.
      </FallbackNotice>

      <div className="mb-4">
        <DateRangeSelect
          onChange={(r) => {
            setFrom(r.from ?? "");
            setTo(r.to ?? "");
          }}
        />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label={hasRange ? "Ventas (rango)" : "Ventas mes"}
          value={formatMoney(hasRange ? rangeTotal : data.totalMonth)}
          icon={TrendingUp}
        />
        <Kpi label="Productos" value={data.productsCount} icon={Boxes} />
        <Kpi label="Clientes" value={data.customersCount} icon={Users} />
        <Kpi
          label="Stock bajo"
          value={data.lowStockCount}
          icon={AlertTriangle}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-base">Top categorías</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer
              width="100%"
              height="100%"
              initialDimension={CHART_INITIAL_DIMENSION}
            >
              <BarChart data={salesByCategory}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="name" {...AXIS_PROPS} />
                <YAxis {...AXIS_PROPS} />
                <Tooltip {...TOOLTIP_PROPS} />
                <Bar dataKey="value" radius={[8, 8, 0, 0]} maxBarSize={56}>
                  {salesByCategory.map((_, index) => (
                    <Cell
                      key={index}
                      fill={CHART_COLORS[index % CHART_COLORS.length]}
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-base">Método de pago</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer
              width="100%"
              height="100%"
              initialDimension={CHART_INITIAL_DIMENSION}
            >
              <PieChart>
                <Tooltip {...TOOLTIP_PROPS} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Pie
                  data={salesByMethod}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={48}
                  outerRadius={80}
                  paddingAngle={2}
                >
                  {salesByMethod.map((_, index) => (
                    <Cell
                      key={index}
                      fill={CHART_COLORS[index % CHART_COLORS.length]}
                    />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-base">Ventas por día</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer
              width="100%"
              height="100%"
              initialDimension={CHART_INITIAL_DIMENSION}
            >
              <BarChart data={salesLast7Days}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="day" {...AXIS_PROPS} />
                <YAxis {...AXIS_PROPS} />
                <Tooltip {...TOOLTIP_PROPS} />
                <Bar
                  dataKey="total"
                  fill="#22B86B"
                  radius={[8, 8, 0, 0]}
                  maxBarSize={48}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-base">Stock bajo</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {lowStock.map((product) => (
                <li
                  key={product.id}
                  className="flex justify-between border-b py-1 last:border-0"
                >
                  <span>{product.name}</span>
                  <span className="font-medium">{product.stock}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
