import {
  useGetInstitutionDashboard,
  useListInstitutionStudents,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Users, GraduationCap, Building2, Banknote, Briefcase, Link2 } from "lucide-react";
import { Link } from "wouter";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend } from "recharts";

export default function InstitutionDashboard() {
  const { userId } = useAuth();
  const id = userId || 1;
  const { data: dashboard, isLoading } = useGetInstitutionDashboard(id);
  const { data: students = [], isLoading: studentsLoading } =
    useListInstitutionStudents(id);

  if (isLoading) {
    return <div className="container py-12 px-4"><div className="animate-pulse h-[800px] bg-muted rounded-2xl" /></div>;
  }

  if (!dashboard) return null;

  const affiliatedCount = students.filter((s) => !s.isPrimaryAffiliation).length;

  const COLORS = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))'];

  return (
    <div className="container px-4 py-8 max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-muted border-2 shadow-sm flex items-center justify-center shrink-0 text-muted-foreground">
            <GraduationCap className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{dashboard.institutionName} Dashboard</h1>
            <p className="text-muted-foreground mt-1">Track your students' success in the job market.</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card className="shadow-sm">
          <CardContent className="p-6">
            <p className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2"><Users className="w-4 h-4"/> Total Students</p>
            <p className="text-3xl font-bold">{dashboard.totalStudents}</p>
            {affiliatedCount > 0 ? (
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <Link2 className="w-3 h-3" />
                {affiliatedCount} cross-affiliated
              </p>
            ) : null}
          </CardContent>
        </Card>
        <Card className="shadow-sm bg-primary/5 border-primary/20">
          <CardContent className="p-6">
            <p className="text-sm font-medium text-primary mb-2 flex items-center gap-2"><Briefcase className="w-4 h-4"/> Placed</p>
            <p className="text-3xl font-bold text-primary">{dashboard.placedStudents}</p>
            <p className="text-xs text-primary/70 mt-1">{Math.round(dashboard.placementRate * 100)}% Placement Rate</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-6">
            <p className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2"><GraduationCap className="w-4 h-4"/> Avg Readiness</p>
            <p className="text-3xl font-bold">{dashboard.averageReadiness}</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm md:col-span-2">
          <CardContent className="p-6">
            <p className="text-sm font-medium text-muted-foreground mb-2 flex items-center gap-2"><Banknote className="w-4 h-4"/> Avg Starting Salary</p>
            <p className="text-3xl font-bold text-green-600 dark:text-green-500">${(dashboard.averageSalary / 1000).toFixed(1)}k</p>
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle>Student Roster</CardTitle>
          <CardDescription>
            Every candidate linked to {dashboard.institutionName} — including those whose
            primary affiliation is another institution.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Student</TableHead>
                <TableHead>Affiliation</TableHead>
                <TableHead>Readiness</TableHead>
                <TableHead>Applications</TableHead>
                <TableHead className="pr-6 text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {studentsLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    Loading roster…
                  </TableCell>
                </TableRow>
              ) : students.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    No students linked yet.
                  </TableCell>
                </TableRow>
              ) : (
                students.map((s) => (
                  <TableRow key={s.candidateId}>
                    <TableCell className="pl-6">
                      <div className="flex items-center gap-3">
                        <img src={s.avatarUrl} className="w-8 h-8 rounded-full object-cover bg-muted" alt="" />
                        <div>
                          <Link href={`/candidates/${s.candidateId}`} className="font-medium hover:text-primary transition-colors block">
                            {s.fullName}
                          </Link>
                          <span className="text-xs text-muted-foreground truncate max-w-[200px] inline-block">{s.headline}</span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      {s.isPrimaryAffiliation ? (
                        <Badge variant="default" className="text-xs">Primary</Badge>
                      ) : (
                        <Badge variant="outline" className="text-xs flex items-center gap-1 w-fit">
                          <Link2 className="w-3 h-3" /> Affiliated
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Progress value={s.readinessScore} className="h-2 w-16" />
                        <span className="text-xs">{s.readinessScore}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">{s.applicationsCount}</TableCell>
                    <TableCell className="pr-6 text-right">
                      <Badge variant="secondary" className="capitalize">{s.status}</Badge>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Recent Placements</CardTitle>
              <CardDescription>Latest students who landed roles</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Student</TableHead>
                    <TableHead>Employer</TableHead>
                    <TableHead>Readiness</TableHead>
                    <TableHead className="pr-6 text-right">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dashboard.recentHires.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No recent placements.</TableCell></TableRow>
                  ) : dashboard.recentHires.map(student => (
                    <TableRow key={student.candidateId}>
                      <TableCell className="pl-6">
                        <div className="flex items-center gap-3">
                          <img src={student.avatarUrl} className="w-8 h-8 rounded-full object-cover bg-muted" alt="" />
                          <div>
                            <Link href={`/candidates/${student.candidateId}`} className="font-medium hover:text-primary transition-colors block">
                              {student.fullName}
                            </Link>
                            <span className="text-xs text-muted-foreground truncate max-w-[150px] inline-block">{student.headline}</span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm font-medium flex items-center gap-1.5">
                          <Building2 className="w-3.5 h-3.5 text-muted-foreground"/>
                          {student.currentEmployerName || '-'}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Progress value={student.readinessScore} className="h-2 w-16" />
                          <span className="text-xs">{student.readinessScore}</span>
                        </div>
                      </TableCell>
                      <TableCell className="pr-6 text-right">
                        <Badge variant="secondary" className="capitalize bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400">
                          {student.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-8">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Status Breakdown</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[250px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={dashboard.statusBreakdown}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={80}
                      paddingAngle={5}
                      dataKey="count"
                      nameKey="status"
                    >
                      {dashboard.statusBreakdown.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <RechartsTooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Top Employers</CardTitle>
              <CardDescription>Where your students are hired</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {dashboard.topEmployers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No employer data yet.</p>
              ) : dashboard.topEmployers.map(emp => (
                <div key={emp.employerId} className="flex justify-between items-center p-3 -mx-3 rounded-lg hover:bg-muted/50 transition-colors">
                  <div className="flex items-center gap-3">
                    <img src={emp.employerLogoUrl} alt="" className="w-10 h-10 rounded object-cover border bg-muted" />
                    <Link href={`/employers/${emp.employerId}`} className="font-semibold text-sm hover:text-primary transition-colors block">
                      {emp.employerName}
                    </Link>
                  </div>
                  <Badge variant="secondary">{emp.hires} Hires</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
