import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, PackageX, Store, Users } from "lucide-react";
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
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { FallbackNotice } from "@/components/layout/FallbackNotice";
import { ALL_LOCATIONS } from "@/lib/currentLocation";
import { useCurrentLocation } from "@/hooks/useCurrentLocation";
import { useDemoSession } from "@/hooks/useDemoSession";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DateRangeSelect } from "@/components/reports/DateRangeSelect";
import { useBusinessSettings } from "@/hooks/useBusinessSettings";
import {
  fetchMermaSummary,
  getErrorMessage,
  type MermaSummary,
} from "@/services/appData";

export const Route = createFileRoute("/mermas_/monitor")({
  component: MermasMonitor,
});

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

const EMPTY_SUMMARY: MermaSummary = {
  totalLoss: 0,
  totalCount: 0,
  byEmployee: [],
  byLocation: [],
  byReason: [],
};

function MermasMonitor() {
  const { formatMoney } = useBusinessSettings();
  const { session } = useDemoSession();
  const { currentLocationId, hasMultiple } = useCurrentLocation();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [summary, setSummary] = useState<MermaSummary>(EMPTY_SUMMARY);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session?.companyId) return;
    let active = true;
    setIsLoading(true);
    setError(null);
    const locationId =
      currentLocationId === ALL_LOCATIONS
        ? undefined
        : (currentLocationId ?? undefined);
    void fetchMermaSummary(session.companyId, {
      from: from || undefined,
      to: to || undefined,
      locationId,
    })
      .then((data) => {
        if (active) setSummary(data);
      })
      .catch((err) => {
        if (!active) return;
        setSummary(EMPTY_SUMMARY);
        setError(getErrorMessage(err));
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [session?.companyId, currentLocationId, from, to]);

  const employeeChart = useMemo(
    () =>
      summary.byEmployee.length
        ? summary.byEmployee
            .slice(0, 10)
            .map((row) => ({ name: row.label, value: row.totalLoss }))
        : [{ name: "Sin datos", value: 0 }],
    [summary.byEmployee],
  );
  const reasonChart = useMemo(
    () =>
      summary.byReason.length
        ? summary.byReason.map((row) => ({
            name: row.label,
            value: row.totalLoss,
          }))
        : [{ name: "Sin datos", value: 0 }],
    [summary.byReason],
  );
  const topEmployee = summary.byEmployee[0];
  const topLocation = summary.byLocation[0];

  return (
    <AppShell>
      <PageHeader
        icon={PackageX}
        eyebrow="Análisis"
        title="Monitor de mermas"
        description="Quién comete más fallas y qué sucursal pierde más."
      />
      <FallbackNotice show={!!error}>
        No se pudieron cargar las mermas. {error}
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
          label="Pérdida total"
          value={formatMoney(summary.totalLoss)}
          icon={AlertTriangle}
        />
        <Kpi
          label="Mermas registradas"
          value={summary.totalCount}
          icon={PackageX}
        />
        <Kpi
          label="Empleado con más pérdida"
          value={topEmployee ? topEmployee.label : "—"}
          icon={Users}
        />
        <Kpi
          label="Sucursal con más pérdida"
          value={topLocation ? topLocation.label : "—"}
          icon={Store}
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="text-base">Pérdida por cajero</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer
              width="100%"
              height="100%"
              initialDimension={CHART_INITIAL_DIMENSION}
            >
              <BarChart data={employeeChart}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="name" {...AXIS_PROPS} />
                <YAxis {...AXIS_PROPS} />
                <Tooltip
                  {...TOOLTIP_PROPS}
                  formatter={(v: number) => formatMoney(v)}
                />
                <Bar dataKey="value" radius={[8, 8, 0, 0]} maxBarSize={56}>
                  {employeeChart.map((_, index) => (
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
            <CardTitle className="text-base">Pérdida por motivo</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer
              width="100%"
              height="100%"
              initialDimension={CHART_INITIAL_DIMENSION}
            >
              <PieChart>
                <Tooltip
                  {...TOOLTIP_PROPS}
                  formatter={(v: number) => formatMoney(v)}
                />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Pie
                  data={reasonChart}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={48}
                  outerRadius={80}
                  paddingAngle={2}
                >
                  {reasonChart.map((_, index) => (
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
            <CardTitle className="text-base">Por empleado</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Empleado</TableHead>
                    <TableHead className="text-right">Mermas</TableHead>
                    <TableHead className="text-right">Pérdida</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {isLoading && (
                    <TableRow>
                      <TableCell
                        colSpan={3}
                        className="py-6 text-center text-muted-foreground"
                      >
                        Cargando...
                      </TableCell>
                    </TableRow>
                  )}
                  {!isLoading && summary.byEmployee.length === 0 && (
                    <TableRow>
                      <TableCell
                        colSpan={3}
                        className="py-6 text-center text-muted-foreground"
                      >
                        Sin mermas en este periodo.
                      </TableCell>
                    </TableRow>
                  )}
                  {!isLoading &&
                    summary.byEmployee.map((row) => (
                      <TableRow key={row.key}>
                        <TableCell className="font-medium">
                          {row.label}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.count}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatMoney(row.totalLoss)}
                        </TableCell>
                      </TableRow>
                    ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        {hasMultiple && (
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="text-base">Por sucursal</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Sucursal</TableHead>
                      <TableHead className="text-right">Mermas</TableHead>
                      <TableHead className="text-right">Pérdida</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {isLoading && (
                      <TableRow>
                        <TableCell
                          colSpan={3}
                          className="py-6 text-center text-muted-foreground"
                        >
                          Cargando...
                        </TableCell>
                      </TableRow>
                    )}
                    {!isLoading && summary.byLocation.length === 0 && (
                      <TableRow>
                        <TableCell
                          colSpan={3}
                          className="py-6 text-center text-muted-foreground"
                        >
                          Sin mermas en este periodo.
                        </TableCell>
                      </TableRow>
                    )}
                    {!isLoading &&
                      summary.byLocation.map((row) => (
                        <TableRow key={row.key}>
                          <TableCell className="font-medium">
                            {row.label}
                          </TableCell>
                          <TableCell className="text-right">
                            {row.count}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatMoney(row.totalLoss)}
                          </TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
