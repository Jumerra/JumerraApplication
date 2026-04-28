import { useState } from "react";
import {
  useAdminGetInstitutionAnalytics,
  useAdminGetEmployerAnalytics,
  type InstitutionAnalyticsRow,
  type EmployerAnalyticsRow,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Cell,
  Legend,
} from "recharts";
import {
  GraduationCap,
  Building2,
  Download,
  Network,
  Users,
  Trophy,
  Briefcase,
} from "lucide-react";

type TopN = 10 | 20 | 50;

const PRIMARY = "hsl(var(--primary))";
const ACCENT = "hsl(var(--chart-2, 200 90% 55%))";
const HIRE = "hsl(var(--chart-3, 142 71% 45%))";

function downloadCsv(url: string) {
  // Same-origin: cookies travel with the navigation, preserving admin auth.
  window.location.href = url;
}

function clamp<T>(arr: T[], n: number): T[] {
  return arr.slice(0, n);
}

export default function AdminPartnerAnalyticsPage() {
  const [topN, setTopN] = useState<TopN>(10);

  const { data: institutionData, isLoading: institutionsLoading } =
    useAdminGetInstitutionAnalytics();
  const { data: employerData, isLoading: employersLoading } =
    useAdminGetEmployerAnalytics();

  const institutionRows: InstitutionAnalyticsRow[] = institutionData?.rows ?? [];
  const employerRows: EmployerAnalyticsRow[] = employerData?.rows ?? [];

  return (
    <div className="container px-4 py-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 border-2 border-primary/20 flex items-center justify-center shrink-0 text-primary">
          <Network className="w-7 h-7" />
        </div>
        <div className="flex-1">
          <h1 className="text-3xl font-bold tracking-tight">Partner Analytics</h1>
          <p className="text-muted-foreground mt-1">
            Compare institutions by candidate supply and employers by hires
            made on the platform. Each dataset is downloadable as CSV.
          </p>
        </div>
        <div className="flex items-center gap-1 bg-muted rounded-lg p-1 shrink-0">
          {([10, 20, 50] as TopN[]).map((n) => (
            <Button
              key={n}
              size="sm"
              variant={topN === n ? "default" : "ghost"}
              className="h-7 text-xs"
              onClick={() => setTopN(n)}
            >
              Top {n}
            </Button>
          ))}
        </div>
      </div>

      <Tabs defaultValue="institutions">
        <TabsList>
          <TabsTrigger value="institutions">
            <GraduationCap className="w-4 h-4 mr-2" />
            Institutions
          </TabsTrigger>
          <TabsTrigger value="employers">
            <Building2 className="w-4 h-4 mr-2" />
            Employers
          </TabsTrigger>
        </TabsList>

        <TabsContent value="institutions" className="space-y-6 mt-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <SummaryCard
              icon={<GraduationCap className="w-4 h-4" />}
              label="Institutions tracked"
              value={(institutionData?.rows.length ?? 0).toString()}
            />
            <SummaryCard
              icon={<Users className="w-4 h-4" />}
              label="Affiliated candidates"
              value={(institutionData?.totalCandidates ?? 0).toString()}
            />
            <SummaryCard
              icon={<Trophy className="w-4 h-4" />}
              label="Hires from institutions"
              value={(institutionData?.totalHires ?? 0).toString()}
            />
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-lg">
                Top {Math.min(topN, institutionRows.length)} institutions by
                candidate supply
              </CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  downloadCsv("/api/admin/analytics/institutions.csv")
                }
              >
                <Download className="w-4 h-4 mr-2" />
                Download CSV
              </Button>
            </CardHeader>
            <CardContent>
              <div className="h-[360px]">
                {institutionsLoading ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                    Loading…
                  </div>
                ) : institutionRows.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                    No institutions on the platform yet.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      layout="vertical"
                      data={clamp(institutionRows, topN)}
                      margin={{ top: 10, right: 24, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="hsl(var(--border))"
                        horizontal={false}
                      />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                      <YAxis
                        type="category"
                        dataKey="institutionName"
                        width={170}
                        tick={{ fontSize: 11 }}
                        interval={0}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--background))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar
                        dataKey="candidateCount"
                        name="Candidates"
                        fill={PRIMARY}
                        radius={[0, 4, 4, 0]}
                      />
                      <Bar
                        dataKey="hiredCount"
                        name="Hired"
                        fill={HIRE}
                        radius={[0, 4, 4, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">All institutions</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {institutionRows.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground">
                  Nothing to show.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-muted-foreground">
                      <tr>
                        <th className="text-left font-medium px-6 py-2">Institution</th>
                        <th className="text-left font-medium px-6 py-2 hidden sm:table-cell">
                          Location
                        </th>
                        <th className="text-right font-medium px-6 py-2">
                          Candidates
                        </th>
                        <th className="text-right font-medium px-6 py-2 hidden md:table-cell">
                          Applications
                        </th>
                        <th className="text-right font-medium px-6 py-2">Hires</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {institutionRows.map((r) => (
                        <tr key={r.institutionId}>
                          <td className="px-6 py-2 font-medium">
                            {r.institutionName}
                          </td>
                          <td className="px-6 py-2 text-muted-foreground hidden sm:table-cell">
                            {r.location}
                          </td>
                          <td className="px-6 py-2 text-right tabular-nums">
                            {r.candidateCount}
                          </td>
                          <td className="px-6 py-2 text-right tabular-nums hidden md:table-cell">
                            {r.applicationCount}
                          </td>
                          <td className="px-6 py-2 text-right tabular-nums">
                            <Badge
                              variant="secondary"
                              className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                            >
                              {r.hiredCount}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="employers" className="space-y-6 mt-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <SummaryCard
              icon={<Building2 className="w-4 h-4" />}
              label="Employers tracked"
              value={(employerData?.totalEmployers ?? 0).toString()}
            />
            <SummaryCard
              icon={<Trophy className="w-4 h-4" />}
              label="Total hires"
              value={(employerData?.totalHires ?? 0).toString()}
            />
            <SummaryCard
              icon={<Briefcase className="w-4 h-4" />}
              label="Active employers"
              value={employerRows
                .filter((r) => r.jobsCount > 0)
                .length.toString()}
            />
          </div>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2 flex-wrap">
              <CardTitle className="text-lg">
                Top {Math.min(topN, employerRows.length)} employers by hires
              </CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  downloadCsv("/api/admin/analytics/employers.csv")
                }
              >
                <Download className="w-4 h-4 mr-2" />
                Download CSV
              </Button>
            </CardHeader>
            <CardContent>
              <div className="h-[360px]">
                {employersLoading ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                    Loading…
                  </div>
                ) : employerRows.length === 0 ? (
                  <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                    No employers on the platform yet.
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      layout="vertical"
                      data={clamp(employerRows, topN)}
                      margin={{ top: 10, right: 24, left: 0, bottom: 0 }}
                    >
                      <CartesianGrid
                        strokeDasharray="3 3"
                        stroke="hsl(var(--border))"
                        horizontal={false}
                      />
                      <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                      <YAxis
                        type="category"
                        dataKey="employerName"
                        width={170}
                        tick={{ fontSize: 11 }}
                        interval={0}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "hsl(var(--background))",
                          border: "1px solid hsl(var(--border))",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar
                        dataKey="hiresCount"
                        name="Hires"
                        fill={HIRE}
                        radius={[0, 4, 4, 0]}
                      >
                        {clamp(employerRows, topN).map((_, i) => (
                          <Cell key={i} fill={HIRE} />
                        ))}
                      </Bar>
                      <Bar
                        dataKey="applicationsCount"
                        name="Applications"
                        fill={ACCENT}
                        radius={[0, 4, 4, 0]}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">All employers</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {employerRows.length === 0 ? (
                <div className="p-6 text-center text-muted-foreground">
                  Nothing to show.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/40 text-muted-foreground">
                      <tr>
                        <th className="text-left font-medium px-6 py-2">Employer</th>
                        <th className="text-left font-medium px-6 py-2 hidden sm:table-cell">
                          Industry
                        </th>
                        <th className="text-right font-medium px-6 py-2 hidden sm:table-cell">
                          Jobs
                        </th>
                        <th className="text-right font-medium px-6 py-2 hidden md:table-cell">
                          Applications
                        </th>
                        <th className="text-right font-medium px-6 py-2">Hires</th>
                        <th className="text-right font-medium px-6 py-2 hidden md:table-cell">
                          Unique candidates hired
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {employerRows.map((r) => (
                        <tr key={r.employerId}>
                          <td className="px-6 py-2 font-medium">
                            {r.employerName}
                          </td>
                          <td className="px-6 py-2 text-muted-foreground hidden sm:table-cell">
                            {r.industry}
                          </td>
                          <td className="px-6 py-2 text-right tabular-nums hidden sm:table-cell">
                            {r.jobsCount}
                          </td>
                          <td className="px-6 py-2 text-right tabular-nums hidden md:table-cell">
                            {r.applicationsCount}
                          </td>
                          <td className="px-6 py-2 text-right tabular-nums">
                            <Badge
                              variant="secondary"
                              className="bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
                            >
                              {r.hiresCount}
                            </Badge>
                          </td>
                          <td className="px-6 py-2 text-right tabular-nums hidden md:table-cell">
                            {r.uniqueCandidatesHired}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border p-4 bg-card">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 text-2xl font-bold tracking-tight">{value}</div>
    </div>
  );
}
