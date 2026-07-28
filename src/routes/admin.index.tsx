import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AdminShell } from "@/components/layout/AdminShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Building2,
  CheckCircle2,
  Clock,
  XCircle,
  Users,
  DollarSign,
  LayoutDashboard,
  type LucideIcon,
} from "lucide-react";
import { useBusinessSettings } from "@/hooks/useBusinessSettings";
import {
  fetchAdminCompanies,
  fetchAdminStats,
  type AdminCompany,
  type AdminStats,
} from "@/services/appData";
import {
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  ResponsiveContainer,
  Tooltip,
  LineChart,
  Line,
  Legend,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  AXIS_PROPS,
  CHART_COLORS,
  CHART_INITIAL_DIMENSION,
  GRID_PROPS,
  TOOLTIP_PROPS,
} from "@/lib/chartTheme";

export const Route = createFileRoute("/admin/")({ component: AdminDashboard });

const COLORS = CHART_COLORS;

const STATUS_LABELS: Record<string, string> = {
  active: "Activa",
  trial: "Prueba",
  expired: "Vencida",
  suspended: "Suspendida",
};

function statusVariant(status: string) {
  if (status === "active") return "success" as const;
  if (status === "trial") return "warm" as const;
  return "destructive" as const;
}

function Kpi({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
}) {
  return (
    <Card className="shadow-card">
      <CardContent className="flex items-center gap-3 p-4">
        <div className="grid h-10 w-10 place-items-center rounded-2xl bg-brand-gradient text-primary-foreground shadow-glow">
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-black">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function AdminDashboard() {
  const { formatMoney } = useBusinessSettings();
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [companies, setCompanies] = useState<AdminCompany[]>([]);

  useEffect(() => {
    void Promise.all([fetchAdminStats(), fetchAdminCompanies()])
      .then(([statsData, companiesData]) => {
        setStats(statsData);
        setCompanies(companiesData);
      })
      .catch(() => {
        /* admin RLS may block; leave empty */
      });
  }, []);

  const byPlan = stats?.byPlan.length ? stats.byPlan : [{ name: "Sin datos", value: 0 }];
  const byStatus = stats?.byStatus.length ? stats.byStatus : [{ name: "Sin datos", value: 0 }];
  const growth = stats?.growth ?? [];

  return (
    <AdminShell>
      <PageHeader
        eyebrow="Administración"
        icon={LayoutDashboard}
        title="Dashboard Plataforma"
        description="Métricas globales del SaaS."
      />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Kpi icon={Building2} label="Empresas" value={stats?.totalCompanies ?? 0} />
        <Kpi icon={CheckCircle2} label="Activas" value={stats?.active ?? 0} />
        <Kpi icon={Clock} label="En prueba" value={stats?.trial ?? 0} />
        <Kpi icon={XCircle} label="Vencidas" value={stats?.expired ?? 0} />
        <Kpi icon={Users} label="Usuarios" value={stats?.users ?? 0} />
        <Kpi icon={DollarSign} label="MRR" value={formatMoney(stats?.mrr ?? 0)} />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Crecimiento de empresas</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer
              width="100%"
              height="100%"
              initialDimension={CHART_INITIAL_DIMENSION}
            >
              <LineChart data={growth}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="m" {...AXIS_PROPS} />
                <YAxis allowDecimals={false} {...AXIS_PROPS} />
                <Tooltip {...TOOLTIP_PROPS} />
                <Line
                  dataKey="v"
                  stroke="#149457"
                  strokeWidth={3}
                  type="monotone"
                  dot={{ r: 3, fill: "#149457" }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Empresas por plan</CardTitle>
          </CardHeader>
          <CardContent className="h-64">
            <ResponsiveContainer
              width="100%"
              height="100%"
              initialDimension={CHART_INITIAL_DIMENSION}
            >
              <BarChart data={byPlan}>
                <CartesianGrid {...GRID_PROPS} />
                <XAxis dataKey="name" {...AXIS_PROPS} />
                <YAxis allowDecimals={false} {...AXIS_PROPS} />
                <Tooltip {...TOOLTIP_PROPS} />
                <Bar dataKey="value" radius={[8, 8, 0, 0]} maxBarSize={56}>
                  {byPlan.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Estado de suscripciones</CardTitle>
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
                  data={byStatus}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={50}
                  outerRadius={82}
                  paddingAngle={2}
                >
                  {byStatus.map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Empresas recientes</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Usuarios</TableHead>
                  <TableHead>Estado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {companies.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4}>
                      <EmptyState
                        title="Aún no hay empresas"
                        description="Las empresas registradas aparecerán aquí."
                      />
                    </TableCell>
                  </TableRow>
                ) : (
                  companies.slice(0, 6).map((company) => (
                    <TableRow key={company.id}>
                      <TableCell className="font-medium">{company.name}</TableCell>
                      <TableCell>{company.planName}</TableCell>
                      <TableCell>{company.usersCount}</TableCell>
                      <TableCell>
                        <Badge variant={statusVariant(company.status)}>
                          {STATUS_LABELS[company.status] ?? company.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </AdminShell>
  );
}
