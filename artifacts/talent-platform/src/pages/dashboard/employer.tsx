import { useGetEmployerDashboard, useUpdateApplicationStatus, getGetEmployerDashboardQueryKey, getListApplicationsQueryKey, useGetEmployerSubscriptionLegacyStatus } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Briefcase, CheckCircle2, Clock, Users, Users2, Sparkles, Building2, Eye, Megaphone, Star, AlertTriangle } from "lucide-react";
import { Link } from "wouter";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { toast } from "sonner";
import { InterviewScheduleDialog } from "@/components/interview-schedule-dialog";
import { SalaryBand } from "@/components/SalaryBand";
import { FastTrackPledgeCard } from "@/components/FastTrackPledgeCard";
import { DailyDeckCard } from "@/components/DailyDeckCard";

export default function EmployerDashboard() {
  const { userId } = useAuth();
  const id = userId || 1;
  const queryClient = useQueryClient();
  const { data: dashboard, isLoading } = useGetEmployerDashboard(id);
  const updateStatus = useUpdateApplicationStatus();

  const handleStatusChange = (appId: number, newStatus: any) => {
    updateStatus.mutate(
      { id: appId, data: { status: newStatus } },
      {
        onSuccess: () => {
          toast.success("Application status updated");
          queryClient.invalidateQueries({ queryKey: getGetEmployerDashboardQueryKey(id) });
          queryClient.invalidateQueries({ queryKey: getListApplicationsQueryKey() });
        },
        onError: () => {
          toast.error("Failed to update status");
        }
      }
    );
  };

  if (isLoading) {
    return <div className="container py-12 px-4"><div className="animate-pulse h-[800px] bg-muted rounded-2xl" /></div>;
  }

  if (!dashboard) return null;

  return (
    <div className="container px-4 py-8 max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div className="flex items-center gap-4">
          <div className="w-16 h-16 rounded-2xl bg-muted border-2 shadow-sm flex items-center justify-center shrink-0">
            <Building2 className="w-8 h-8 text-muted-foreground" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{dashboard.employerName} Dashboard</h1>
            <p className="text-muted-foreground mt-1">Manage your open roles and talent pipeline.</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card className="shadow-sm">
          <CardContent className="p-6">
            <p className="text-sm font-medium text-muted-foreground mb-2">Open Jobs</p>
            <p className="text-3xl font-bold">{dashboard.openJobs}</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-6">
            <p className="text-sm font-medium text-muted-foreground mb-2">Total Applicants</p>
            <p className="text-3xl font-bold">{dashboard.totalApplications}</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-6">
            <p className="text-sm font-medium text-muted-foreground mb-2">Interviews</p>
            <p className="text-3xl font-bold">{dashboard.interviewsScheduled}</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-6">
            <p className="text-sm font-medium text-muted-foreground mb-2">Total Hires</p>
            <p className="text-3xl font-bold">{dashboard.hires}</p>
          </CardContent>
        </Card>
        <Card className="bg-primary/5 border-primary/20 shadow-sm relative overflow-hidden col-span-2 md:col-span-1">
          <div className="absolute right-0 top-0 w-16 h-16 bg-primary/10 rounded-bl-full" />
          <CardContent className="p-6 relative z-10">
            <p className="text-sm font-medium text-primary mb-2 flex items-center gap-1">
              <Sparkles className="w-4 h-4" /> Avg Match
            </p>
            <p className="text-3xl font-extrabold text-primary">{dashboard.averageMatchScore}%</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList>
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="daily-picks" data-testid="tab-daily-picks">Daily picks</TabsTrigger>
        </TabsList>
        <TabsContent value="daily-picks">
          <div className="max-w-2xl mx-auto">
            <DailyDeckCard />
          </div>
        </TabsContent>
        <TabsContent value="overview" className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <Card className="shadow-sm">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Recent Applications</CardTitle>
                  <CardDescription>Manage candidate progression</CardDescription>
                </div>
                <Link href="/post-job" className="text-sm font-medium text-primary hover:underline">Post new job</Link>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Candidate</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead className="w-32">Match</TableHead>
                    <TableHead className="w-[160px]">Status</TableHead>
                    <TableHead className="w-[140px] pr-6">Interview</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dashboard.recentApplications.length === 0 ? (
                    <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">No applications yet.</TableCell></TableRow>
                  ) : dashboard.recentApplications.map(app => (
                    <TableRow key={app.id}>
                      <TableCell className="pl-6">
                        <div className="flex items-center gap-3">
                          <img src={app.candidateAvatarUrl} className="w-8 h-8 rounded-full object-cover bg-muted" alt="" />
                          <div>
                            <Link href={`/candidates/${app.candidateId}`} className="font-medium hover:text-primary transition-colors block">
                              {app.candidateName}
                            </Link>
                            <span className="text-xs text-muted-foreground">{new Date(app.appliedAt).toLocaleDateString()}</span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <span className="text-sm">{app.jobTitle}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="bg-primary/10 text-primary">
                          {app.matchScore}% Match
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Select 
                          value={app.status} 
                          onValueChange={(val) => handleStatusChange(app.id, val)}
                          disabled={updateStatus.isPending}
                        >
                          <SelectTrigger className="h-8 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="applied">Applied</SelectItem>
                            <SelectItem value="screening">Screening</SelectItem>
                            <SelectItem value="interview">Interview</SelectItem>
                            <SelectItem value="offer">Offer</SelectItem>
                            <SelectItem value="hired">Hired</SelectItem>
                            <SelectItem value="rejected">Rejected</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="pr-6">
                        <InterviewScheduleDialog
                          applicationId={app.id}
                          employerUserId={id}
                          candidateName={app.candidateName}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Pipeline Overview</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[250px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dashboard.pipelineByStage} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <XAxis dataKey="status" fontSize={12} tickLine={false} axisLine={false} className="capitalize" />
                    <YAxis fontSize={12} tickLine={false} axisLine={false} />
                    <Tooltip cursor={{fill: 'var(--color-muted)', opacity: 0.4}} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]} fill="hsl(var(--primary))" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <FastTrackPledgeCard />
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Active Job Postings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {dashboard.topJobs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No active jobs.</p>
              ) : dashboard.topJobs.map(job => {
                const tier = job.tier ?? "free";
                const expires = job.tierExpiresAt
                  ? new Date(job.tierExpiresAt).toLocaleDateString()
                  : null;
                return (
                  <div
                    key={job.id}
                    className="flex justify-between items-center gap-3 p-3 -mx-3 rounded-lg hover:bg-muted/50 transition-colors"
                    data-testid={`row-employer-job-${job.id}`}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Link href={`/jobs/${job.id}`} className="font-semibold text-sm hover:text-primary transition-colors truncate">
                          {job.title}
                        </Link>
                        {tier === "sponsored" && (
                          <Badge className="gap-1 bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-100 dark:bg-amber-900/40 dark:text-amber-200">
                            <Star className="w-3 h-3" /> Sponsored
                          </Badge>
                        )}
                        {tier === "promoted" && (
                          <Badge className="gap-1 bg-sky-100 text-sky-900 border-sky-300 hover:bg-sky-100 dark:bg-sky-900/40 dark:text-sky-200">
                            <Megaphone className="w-3 h-3" /> Promoted
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {job.applicationsCount} applicants • {job.location}
                        {tier !== "free" && expires ? ` • Tier ends ${expires}` : ""}
                      </p>
                      <div className="mt-2">
                        <SalaryBand
                          jobId={job.id}
                          label="Market rate (real hires)"
                        />
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {tier === "free" && (
                        <Button
                          variant="outline"
                          size="sm"
                          asChild
                          data-testid={`button-boost-job-${job.id}`}
                        >
                          <Link href={`/jobs/${job.id}/boost`}>
                            <Star className="w-3.5 h-3.5 mr-1.5" /> Boost
                          </Link>
                        </Button>
                      )}
                      <Button variant="ghost" size="icon" asChild>
                        <Link href={`/jobs/${job.id}`}><Eye className="w-4 h-4" /></Link>
                      </Button>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
