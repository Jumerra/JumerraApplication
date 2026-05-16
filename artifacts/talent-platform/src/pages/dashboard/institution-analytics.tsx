import { useState } from "react";
import {
  useGetInstitutionPlacementAnalytics,
  useListMyInstitutionDepartments,
  useListMyInstitutionFaculties,
  getGetInstitutionPlacementAnalyticsQueryKey,
  getListMyInstitutionDepartmentsQueryKey,
  getListMyInstitutionFacultiesQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import {
  Building2,
  Users,
  Banknote,
  Clock,
  Lock,
  TrendingUp,
} from "lucide-react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip as RechartsTooltip,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Legend,
} from "recharts";

const PIE_COLORS = ["hsl(var(--primary))", "hsl(var(--muted))"];

export default function InstitutionAnalyticsPage() {
  const { sessionUser } = useAuth();
  const institutionId =
    sessionUser?.role === "institution" ? sessionUser.institutionId : null;
  const id = institutionId ?? 0;
  const enabled = institutionId != null;

  const isOwnerOrRegistrar =
    sessionUser?.orgRole === "owner" || sessionUser?.orgRole === "registrar";

  const [facultyId, setFacultyId] = useState<string>("all");
  const [departmentId, setDepartmentId] = useState<string>("all");

  const { data: faculties = [] } = useListMyInstitutionFaculties({
    query: {
      queryKey: getListMyInstitutionFacultiesQueryKey(),
      enabled,
    },
  });
  const { data: departments = [] } = useListMyInstitutionDepartments({
    query: {
      queryKey: getListMyInstitutionDepartmentsQueryKey(),
      enabled,
    },
  });

  const filter = {
    facultyId: facultyId === "all" ? undefined : Number(facultyId),
    departmentId: departmentId === "all" ? undefined : Number(departmentId),
  };

  const { data: analytics, isLoading } = useGetInstitutionPlacementAnalytics(
    id,
    filter,
    {
      query: {
        queryKey: getGetInstitutionPlacementAnalyticsQueryKey(id, filter),
        enabled,
      },
    },
  );

  const filteredDepartments =
    facultyId === "all"
      ? departments
      : departments.filter((d) => d.facultyId === Number(facultyId));

  if (!enabled) {
    return (
      <div className="container max-w-md py-16">
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Sign in with an institution account to view analytics.
          </CardContent>
        </Card>
      </div>
    );
  }

  if (isLoading || !analytics) {
    return (
      <div className="container max-w-6xl py-8">
        <div className="h-64 animate-pulse rounded-2xl bg-muted" />
      </div>
    );
  }

  if (analytics.placementsLocked) {
    return (
      <div className="container max-w-3xl py-12">
        <Card className="border-amber-200 bg-amber-50/50 dark:bg-amber-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-amber-600" />
              Placement analytics is a premium feature
            </CardTitle>
            <CardDescription>
              Activate your institution subscription to unlock placement
              analytics, cohort tracking, and the public top-employers
              leaderboard.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild>
              <Link href="/dashboard/institution/subscription">
                View subscription
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const placedShare = Math.round(analytics.placementRate * 100);
  const pieData = [
    { name: "Placed", value: analytics.placedStudents },
    {
      name: "Not yet placed",
      value: Math.max(0, analytics.totalStudents - analytics.placedStudents),
    },
  ];

  return (
    <div className="container max-w-6xl space-y-6 py-8">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Placement analytics
          </h1>
          <p className="text-sm text-muted-foreground">
            Real-time view of where your tracked students are landing.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isOwnerOrRegistrar && (
            <>
              <Select
                value={facultyId}
                onValueChange={(v) => {
                  setFacultyId(v);
                  setDepartmentId("all");
                }}
              >
                <SelectTrigger className="w-44" data-testid="select-faculty">
                  <SelectValue placeholder="Faculty" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All faculties</SelectItem>
                  {faculties.map((f) => (
                    <SelectItem key={f.id} value={String(f.id)}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={departmentId} onValueChange={setDepartmentId}>
                <SelectTrigger
                  className="w-48"
                  data-testid="select-department"
                >
                  <SelectValue placeholder="Department" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All departments</SelectItem>
                  {filteredDepartments.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
          <Button variant="outline" asChild>
            <Link href="/dashboard/institution/cohorts">Cohorts</Link>
          </Button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <KpiCard
          icon={<Users className="h-5 w-5" />}
          label="Tracked students"
          value={analytics.totalStudents.toLocaleString()}
        />
        <KpiCard
          icon={<TrendingUp className="h-5 w-5" />}
          label="Placement rate"
          value={`${placedShare}%`}
          sub={`${analytics.placedStudents} placed`}
        />
        <KpiCard
          icon={<Clock className="h-5 w-5" />}
          label="Median time-to-first-job"
          value={
            analytics.medianTimeToFirstJobDays > 0
              ? `${analytics.medianTimeToFirstJobDays} days`
              : "—"
          }
        />
        <KpiCard
          icon={<Building2 className="h-5 w-5" />}
          label="Top employers"
          value={String(analytics.topEmployers.length)}
        />
      </div>

      {/* Donut + top employers bar */}
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>% placed</CardTitle>
            <CardDescription>
              Verified students with at least one hired application.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-56">
              <ResponsiveContainer>
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={50}
                    outerRadius={80}
                  >
                    {pieData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Legend />
                  <RechartsTooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Top 10 employers hiring our students</CardTitle>
            <CardDescription>By first-job hires.</CardDescription>
          </CardHeader>
          <CardContent>
            {analytics.topEmployers.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No hires yet for the current scope.
              </p>
            ) : (
              <div className="h-56">
                <ResponsiveContainer>
                  <BarChart
                    data={analytics.topEmployers}
                    layout="vertical"
                    margin={{ left: 20, right: 16 }}
                  >
                    <XAxis type="number" allowDecimals={false} />
                    <YAxis
                      type="category"
                      dataKey="employerName"
                      width={140}
                      tick={{ fontSize: 12 }}
                    />
                    <RechartsTooltip />
                    <Bar
                      dataKey="hires"
                      fill="hsl(var(--primary))"
                      radius={[0, 6, 6, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Salary medians table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Banknote className="h-5 w-5" /> Salary medians by department
          </CardTitle>
          <CardDescription>
            Calculated from job salary midpoints across first hires.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {analytics.salaryMediansByDepartment.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No salary data yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Department</TableHead>
                  <TableHead className="text-right">Hires</TableHead>
                  <TableHead className="text-right">Median salary</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {analytics.salaryMediansByDepartment.map((row) => (
                  <TableRow
                    key={`${row.departmentId ?? "null"}-${row.departmentName}`}
                  >
                    <TableCell className="font-medium">
                      {row.departmentName}
                      {row.departmentId == null && (
                        <Badge variant="outline" className="ml-2">
                          Unassigned
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">{row.hires}</TableCell>
                    <TableCell className="text-right font-semibold">
                      {row.medianSalary.toLocaleString(undefined, {
                        style: "currency",
                        currency: "USD",
                        maximumFractionDigits: 0,
                      })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <Card>
      <CardContent className="flex items-center gap-4 p-5">
        <div className="rounded-lg bg-primary/10 p-2 text-primary">{icon}</div>
        <div className="min-w-0 flex-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="truncate text-2xl font-bold">{value}</p>
          {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  );
}
