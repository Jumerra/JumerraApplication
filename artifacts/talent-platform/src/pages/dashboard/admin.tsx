import { useGetPlatformStats, useGetRecentActivity } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, Building2, GraduationCap, Briefcase, MailOpen, UserCheck, ShieldAlert } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, PieChart, Pie, Legend, LineChart, Line, CartesianGrid } from "recharts";

export default function AdminDashboard() {
  const { data: stats, isLoading: isLoadingStats } = useGetPlatformStats();
  const { data: activity, isLoading: isLoadingActivity } = useGetRecentActivity();

  if (isLoadingStats || isLoadingActivity) {
    return <div className="container py-12 px-4"><div className="animate-pulse h-[800px] bg-muted rounded-2xl" /></div>;
  }

  if (!stats || !activity) return null;

  const COLORS = ['hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))', 'hsl(var(--chart-5))'];

  return (
    <div className="container px-4 py-8 max-w-7xl mx-auto space-y-8">
      <div className="flex items-center gap-4 mb-8">
        <div className="w-16 h-16 rounded-2xl bg-destructive/10 border-2 border-destructive/20 flex items-center justify-center shrink-0 text-destructive">
          <ShieldAlert className="w-8 h-8" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Platform Admin</h1>
          <p className="text-muted-foreground mt-1">Global ecosystem statistics and activity.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card className="shadow-sm">
          <CardContent className="p-4 sm:p-6 text-center sm:text-left">
            <Users className="w-5 h-5 text-muted-foreground mb-2 mx-auto sm:mx-0" />
            <p className="text-2xl font-bold">{stats.totalCandidates.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">Candidates</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-4 sm:p-6 text-center sm:text-left">
            <Building2 className="w-5 h-5 text-muted-foreground mb-2 mx-auto sm:mx-0" />
            <p className="text-2xl font-bold">{stats.totalEmployers.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">Employers</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-4 sm:p-6 text-center sm:text-left">
            <GraduationCap className="w-5 h-5 text-muted-foreground mb-2 mx-auto sm:mx-0" />
            <p className="text-2xl font-bold">{stats.totalInstitutions.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">Institutions</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-4 sm:p-6 text-center sm:text-left">
            <Briefcase className="w-5 h-5 text-muted-foreground mb-2 mx-auto sm:mx-0" />
            <p className="text-2xl font-bold">{stats.totalJobs.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">Jobs Posted</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm">
          <CardContent className="p-4 sm:p-6 text-center sm:text-left">
            <MailOpen className="w-5 h-5 text-muted-foreground mb-2 mx-auto sm:mx-0" />
            <p className="text-2xl font-bold">{stats.totalApplications.toLocaleString()}</p>
            <p className="text-xs text-muted-foreground mt-1">Applications</p>
          </CardContent>
        </Card>
        <Card className="shadow-sm bg-primary/5 border-primary/20">
          <CardContent className="p-4 sm:p-6 text-center sm:text-left">
            <UserCheck className="w-5 h-5 text-primary mb-2 mx-auto sm:mx-0" />
            <p className="text-2xl font-bold text-primary">{stats.totalHires.toLocaleString()}</p>
            <p className="text-xs text-primary/80 mt-1">Total Hires</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid lg:grid-cols-2 gap-8">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Signups Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={stats.signupsTrend} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--muted))" />
                  <XAxis dataKey="date" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(val) => new Date(val).toLocaleDateString(undefined, {month:'short', day:'numeric'})} />
                  <YAxis fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                  <Legend />
                  <Line type="monotone" dataKey="candidates" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="employers" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Applications by Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={stats.applicationsByStatus} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <XAxis dataKey="status" fontSize={12} tickLine={false} axisLine={false} className="capitalize" />
                  <YAxis fontSize={12} tickLine={false} axisLine={false} />
                  <Tooltip cursor={{fill: 'var(--color-muted)', opacity: 0.4}} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {stats.applicationsByStatus.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-8">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Jobs by Type</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={stats.jobsByType}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={5}
                    dataKey="count"
                    nameKey="type"
                  >
                    {stats.jobsByType.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                  <Legend formatter={(value) => <span className="capitalize">{value.replace('_', ' ')}</span>} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="lg:col-span-2 shadow-sm">
          <CardHeader>
            <CardTitle>Global Activity Feed</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {activity.map((item) => (
                <div key={item.id} className="flex gap-4 items-center p-3 rounded-lg hover:bg-muted/50 transition-colors">
                  <img src={item.avatarUrl} alt="" className="w-10 h-10 rounded-full object-cover bg-muted shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-foreground">{item.title}</p>
                    <p className="text-xs text-muted-foreground truncate">{item.subtitle}</p>
                  </div>
                  <div className="text-xs text-muted-foreground whitespace-nowrap">
                    {new Date(item.timestamp).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
