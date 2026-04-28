import { useGetCandidateDashboard } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Briefcase, CheckCircle2, Clock, MailOpen, TrendingUp, Sparkles, Star } from "lucide-react";
import { Link } from "wouter";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";

export default function CandidateDashboard() {
  const { userId } = useAuth();
  const id = userId || 1;
  const { data: dashboard, isLoading } = useGetCandidateDashboard(id);

  if (isLoading) {
    return <div className="container py-12 px-4"><div className="animate-pulse h-[800px] bg-muted rounded-2xl" /></div>;
  }

  if (!dashboard) return null;

  return (
    <div className="container px-4 py-8 max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-end gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Welcome back, {dashboard.fullName.split(' ')[0]}</h1>
          <p className="text-muted-foreground mt-1">Here's what's happening with your career journey.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-right">
            <p className="text-sm font-medium text-muted-foreground">Profile Completeness</p>
            <div className="flex items-center gap-2">
              <Progress value={dashboard.profileCompleteness} className="w-32 h-2" />
              <span className="text-sm font-bold">{dashboard.profileCompleteness}%</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-primary/5 border-primary/20 shadow-sm relative overflow-hidden">
          <div className="absolute -right-4 -top-4 w-24 h-24 bg-primary/10 rounded-full blur-2xl" />
          <CardContent className="p-6">
            <div className="flex justify-between items-start">
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Talent Score</p>
                <p className="text-4xl font-extrabold text-primary flex items-center gap-2">
                  {dashboard.talentScore} <Star className="w-6 h-6 fill-primary opacity-50" />
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <Card className="shadow-sm">
          <CardContent className="p-6">
            <div className="flex justify-between items-start">
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Active Applications</p>
                <p className="text-3xl font-bold">{dashboard.applicationsCount}</p>
              </div>
              <div className="p-2 bg-blue-50 text-blue-600 rounded-lg dark:bg-blue-500/10 dark:text-blue-400">
                <Briefcase className="w-5 h-5" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardContent className="p-6">
            <div className="flex justify-between items-start">
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Interviews</p>
                <p className="text-3xl font-bold">{dashboard.interviewsCount}</p>
              </div>
              <div className="p-2 bg-purple-50 text-purple-600 rounded-lg dark:bg-purple-500/10 dark:text-purple-400">
                <Clock className="w-5 h-5" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardContent className="p-6">
            <div className="flex justify-between items-start">
              <div className="space-y-2">
                <p className="text-sm font-medium text-muted-foreground">Offers</p>
                <p className="text-3xl font-bold">{dashboard.offersCount}</p>
              </div>
              <div className="p-2 bg-green-50 text-green-600 rounded-lg dark:bg-green-500/10 dark:text-green-400">
                <MailOpen className="w-5 h-5" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Application Pipeline</CardTitle>
              <CardDescription>Where your applications currently stand</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[250px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dashboard.statusBreakdown} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <XAxis dataKey="status" fontSize={12} tickLine={false} axisLine={false} className="capitalize" />
                    <YAxis fontSize={12} tickLine={false} axisLine={false} />
                    <Tooltip cursor={{fill: 'var(--color-muted)', opacity: 0.4}} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {dashboard.statusBreakdown.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={
                          entry.status === 'offer' || entry.status === 'hired' ? 'hsl(var(--chart-2))' :
                          entry.status === 'rejected' ? 'hsl(var(--destructive))' :
                          'hsl(var(--primary))'
                        } />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card className="shadow-sm">
            <CardHeader>
              <CardTitle>Recent Applications</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-6">Role</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right pr-6">Applied</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dashboard.recentApplications.length === 0 ? (
                    <TableRow><TableCell colSpan={4} className="text-center py-8 text-muted-foreground">No applications yet.</TableCell></TableRow>
                  ) : dashboard.recentApplications.map(app => (
                    <TableRow key={app.id}>
                      <TableCell className="pl-6 font-medium">
                        <Link href={`/jobs/${app.jobId}`} className="hover:text-primary hover:underline">{app.jobTitle}</Link>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <img src={app.employerLogoUrl} className="w-6 h-6 rounded bg-muted border" alt="" />
                          <span className="text-sm">{app.employerName}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="capitalize">
                          {app.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right pr-6 text-sm text-muted-foreground">
                        {new Date(app.appliedAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card className="bg-primary/5 border-primary/10 shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-primary" /> Recommended Matches
              </CardTitle>
              <CardDescription>Roles that fit your skills</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {dashboard.recommendedJobs.length === 0 ? (
                <p className="text-sm text-muted-foreground">Add more skills to get recommendations.</p>
              ) : dashboard.recommendedJobs.map(job => (
                <div key={job.jobId} className="group bg-card rounded-xl p-4 shadow-sm border border-border/50 hover:border-primary/50 transition-all cursor-pointer" onClick={() => window.location.href = `/jobs/${job.jobId}`}>
                  <div className="flex gap-3">
                    <img src={job.employerLogoUrl} alt="" className="w-10 h-10 rounded-lg bg-muted object-cover border" />
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm truncate group-hover:text-primary transition-colors">{job.title}</p>
                      <p className="text-xs text-muted-foreground">{job.employerName}</p>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-xs font-medium text-green-600 dark:text-green-400">
                          {job.salaryMin ? `${job.currency} ${(job.salaryMin/1000).toFixed(0)}k+` : job.location}
                        </span>
                        <Badge variant="secondary" className="bg-primary/10 text-primary text-[10px] px-1.5 py-0 h-5">
                          {job.matchScore}% Match
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
