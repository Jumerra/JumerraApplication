import { useState } from "react";
import {
  useGetInstitutionDashboard,
  useListInstitutionStudents,
  useVerifyInstitutionStudent,
  useUnverifyInstitutionStudent,
  getListInstitutionStudentsQueryKey,
  getGetInstitutionDashboardQueryKey,
} from "@workspace/api-client-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Users, GraduationCap, Building2, Banknote, Briefcase, Link2, ShieldCheck, ShieldAlert, Loader2, BookOpen, Building, Pencil, ArrowRight, Crown, Lock, Stamp } from "lucide-react";
import { Link } from "wouter";
import { institutionKindLabel, academicUnitTerms } from "@/lib/institution-kinds";
import { IssueSkillVerificationDialog } from "@/components/issue-skill-verification-dialog";
import {
  useGetInstitution,
  useListMyInstitutionDepartments,
  useListMyInstitutionFacilities,
  getGetInstitutionQueryKey,
  getListMyInstitutionDepartmentsQueryKey,
  getListMyInstitutionFacilitiesQueryKey,
} from "@workspace/api-client-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, Legend } from "recharts";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export default function InstitutionDashboard() {
  const { sessionUser } = useAuth();
  // Resolve the actual institution this user manages. Falling back to the
  // user's own id (as we used to) caused /dashboard/institution/<userId>
  // requests that 401 because the user isn't a member of that institution.
  const institutionId =
    sessionUser?.role === "institution" ? sessionUser.institutionId : null;
  const id = institutionId ?? 0;
  const hasInstitution = institutionId != null;
  const { data: dashboard, isLoading } = useGetInstitutionDashboard(id, {
    query: {
      queryKey: getGetInstitutionDashboardQueryKey(id),
      enabled: hasInstitution,
    },
  });
  // Owner-only client-side filter. Coordinators are auto-scoped server-side
  // so the value here is ignored for them; we still send it because it's
  // harmless and keeps the cache key stable for owners.
  const [departmentFilter, setDepartmentFilter] = useState<string>("all");
  const { data: students = [], isLoading: studentsLoading } =
    useListInstitutionStudents(
      id,
      departmentFilter === "all"
        ? undefined
        : { departmentId: Number(departmentFilter) },
      {
        query: {
          queryKey: getListInstitutionStudentsQueryKey(
            id,
            departmentFilter === "all"
              ? undefined
              : { departmentId: Number(departmentFilter) },
          ),
          enabled: hasInstitution,
        },
      },
    );
  // Pull the institution record for the kind badge. Only fetch when we
  // have an actual institutionId, otherwise we'd hit /institutions/0.
  const { data: institution } = useGetInstitution(institutionId ?? 0, {
    query: {
      queryKey: getGetInstitutionQueryKey(institutionId ?? 0),
      enabled: hasInstitution,
    },
  });
  // Owners get the management cards. We also need the lists' counts to
  // make the cards informative; viewers can still navigate to read them.
  const isOwner =
    sessionUser?.role === "institution" && sessionUser.orgRole === "owner";
  const { data: departments = [] } = useListMyInstitutionDepartments({
    query: {
      queryKey: getListMyInstitutionDepartmentsQueryKey(),
      enabled: sessionUser?.role === "institution",
    },
  });
  const { data: facilities = [] } = useListMyInstitutionFacilities({
    query: {
      queryKey: getListMyInstitutionFacilitiesQueryKey(),
      enabled: sessionUser?.role === "institution",
    },
  });
  const academicTerms = academicUnitTerms(institution?.type);
  const queryClient = useQueryClient();

  // Only institution owners/coordinators (and platform admins) can change
  // verification. Viewers see the badges but no buttons.
  const canManage =
    sessionUser?.role === "admin" ||
    (sessionUser?.role === "institution" &&
      sessionUser.institutionId === id &&
      (sessionUser.orgRole === "owner" || sessionUser.orgRole === "coordinator"));

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListInstitutionStudentsQueryKey(id) });
    queryClient.invalidateQueries({ queryKey: getGetInstitutionDashboardQueryKey(id) });
  };
  const verifyMut = useVerifyInstitutionStudent({
    mutation: {
      onSuccess: () => { toast.success("Student verified"); invalidate(); },
      onError: () => toast.error("Could not verify student"),
    },
  });
  const unverifyMut = useUnverifyInstitutionStudent({
    mutation: {
      onSuccess: () => { toast.success("Student unverified"); invalidate(); },
      onError: () => toast.error("Could not unverify student"),
    },
  });
  const pendingId =
    verifyMut.isPending || unverifyMut.isPending
      ? Number((verifyMut.variables ?? unverifyMut.variables)?.candidateId)
      : null;

  if (!hasInstitution) {
    return (
      <div className="container px-4 py-12 max-w-3xl mx-auto">
        <Card>
          <CardHeader>
            <CardTitle>No institution assigned</CardTitle>
            <CardDescription>
              Your account isn't linked to an institution yet. Please ask a
              platform admin to assign you to one.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (isLoading) {
    return <div className="container py-12 px-4"><div className="animate-pulse h-[800px] bg-muted rounded-2xl" /></div>;
  }

  if (!dashboard) return null;

  const affiliatedCount = students.filter((s) => !s.isPrimaryAffiliation).length;
  const pendingCount = students.filter((s) => !s.isVerified).length;

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
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <p className="text-muted-foreground">Track your students' success in the job market.</p>
              {institution ? (
                <Badge variant="secondary" className="capitalize">
                  {institutionKindLabel(institution.type)}
                </Badge>
              ) : null}
            </div>
          </div>
        </div>
        {isOwner ? (
          <Button asChild variant="outline" size="sm" className="gap-2">
            <Link href="/dashboard/institution/edit">
              <Pencil className="w-4 h-4" /> Edit institution
            </Link>
          </Button>
        ) : null}
      </div>

      {sessionUser?.role === "institution" ? (
        <div className="grid sm:grid-cols-2 gap-4">
          <Card className="shadow-sm hover:shadow-md transition-shadow">
            <Link
              href="/dashboard/institution/departments"
              className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
            >
              <CardContent className="p-6 flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                    <BookOpen className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="font-semibold">{academicTerms.plural}</p>
                    <p className="text-sm text-muted-foreground">
                      {departments.length} listed
                      {isOwner ? " · manage" : ""}
                    </p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground" />
              </CardContent>
            </Link>
          </Card>
          <Card className="shadow-sm hover:shadow-md transition-shadow">
            <Link
              href="/dashboard/institution/endorsements"
              className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
            >
              <CardContent className="p-6 flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                    <Stamp className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="font-semibold">Pending endorsements</p>
                    <p className="text-sm text-muted-foreground">
                      Co-sign your students' active applications
                    </p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground" />
              </CardContent>
            </Link>
          </Card>
          <Card className="shadow-sm hover:shadow-md transition-shadow">
            <Link
              href="/dashboard/institution/facilities"
              className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl"
            >
              <CardContent className="p-6 flex items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="w-11 h-11 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                    <Building className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="font-semibold">Facilities</p>
                    <p className="text-sm text-muted-foreground">
                      {facilities.length} listed
                      {isOwner ? " · manage" : ""}
                    </p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground" />
              </CardContent>
            </Link>
          </Card>
        </div>
      ) : null}

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

      {dashboard.quotas && !dashboard.quotas.premium ? (
        <Card className="shadow-sm border-amber-200 dark:border-amber-900/40 bg-amber-50/40 dark:bg-amber-950/10">
          <CardHeader className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <Crown className="w-4 h-4 text-amber-600" /> Starter plan limits
              </CardTitle>
              <CardDescription>
                Upgrade to Institution Pro to lift these caps and unlock branded
                profile, bulk verification, analytics export, and the SIS API.
              </CardDescription>
            </div>
            <Button asChild size="sm" variant="default">
              <Link href="/dashboard/institution/subscription">Upgrade</Link>
            </Button>
          </CardHeader>
          <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {([
              ["Verified students", dashboard.quotas.counts.verifiedStudents, dashboard.quotas.limits.verifiedStudents],
              ["Faculties", dashboard.quotas.counts.faculties, dashboard.quotas.limits.faculties],
              ["Departments", dashboard.quotas.counts.departments, dashboard.quotas.limits.departments],
              ["Staff seats", dashboard.quotas.counts.staffSeats, dashboard.quotas.limits.staffSeats],
            ] as const).map(([label, used, limit]) => {
              const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
              const atCap = used >= limit;
              return (
                <div key={label} className="space-y-1.5">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs font-medium text-muted-foreground">{label}</span>
                    <span className={`text-sm font-semibold ${atCap ? "text-amber-700 dark:text-amber-400" : ""}`}>
                      {used}<span className="text-muted-foreground font-normal"> / {limit}</span>
                    </span>
                  </div>
                  <Progress value={pct} className="h-2" />
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      <Card className="shadow-sm">
        <CardHeader className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <div>
            <CardTitle>Student Roster</CardTitle>
            <CardDescription>
              Every candidate linked to {dashboard.institutionName} — including those whose
              primary affiliation is another institution.
            </CardDescription>
          </div>
          {isOwner ? (
            <div className="flex items-center gap-2 shrink-0">
              <span className="text-xs text-muted-foreground">
                Filter by {academicTerms.singular.toLowerCase()}
              </span>
              <Select
                value={departmentFilter}
                onValueChange={setDepartmentFilter}
              >
                <SelectTrigger className="w-[220px] h-8">
                  <SelectValue placeholder={`All ${academicTerms.plural.toLowerCase()}`} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    All {academicTerms.plural.toLowerCase()}
                  </SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={String(d.id)}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Student</TableHead>
                <TableHead>Affiliation</TableHead>
                <TableHead>{academicTerms.singular}</TableHead>
                <TableHead>Readiness</TableHead>
                <TableHead>Applications</TableHead>
                <TableHead className="pr-6 text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {studentsLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
                    Loading roster…
                  </TableCell>
                </TableRow>
              ) : students.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center py-8 text-muted-foreground">
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
                    <TableCell className="text-sm">
                      {s.departmentName ? (
                        <span>{s.departmentName}</span>
                      ) : (
                        <span className="text-muted-foreground italic">
                          Unassigned
                        </span>
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
                      <div className="flex items-center justify-end gap-2">
                        {hasInstitution ? (
                          <IssueSkillVerificationDialog
                            institutionId={id}
                            candidateId={s.candidateId}
                            candidateName={s.fullName}
                          />
                        ) : null}
                        <Badge variant="secondary" className="capitalize">{s.status}</Badge>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {dashboard.placementsLocked ? (
        <Card className="shadow-sm border-primary/30 bg-primary/5" data-testid="card-placements-locked">
          <CardContent className="p-8">
            <div className="flex flex-col md:flex-row md:items-center gap-6">
              <div className="w-14 h-14 shrink-0 rounded-full bg-primary/10 text-primary flex items-center justify-center">
                <Lock className="w-7 h-7" />
              </div>
              <div className="flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <Crown className="w-4 h-4 text-primary" />
                  <span className="text-xs font-semibold uppercase tracking-wide text-primary">
                    Premium feature
                  </span>
                </div>
                <h2 className="text-xl font-bold">
                  Placement insights are part of the premium subscription
                </h2>
                <p className="text-sm text-muted-foreground">
                  Subscribe to your institution's yearly plan to unlock recent
                  placements, top employer leaderboards, and the full status
                  pipeline. Roster and readiness signals stay free.
                </p>
              </div>
              <Button asChild data-testid="button-placements-subscribe">
                <Link href="/dashboard/institution/subscription">
                  View plan
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
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
      )}
    </div>
  );
}
