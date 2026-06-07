import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Bar,
  BarChart,
  Line,
  LineChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertCircle, Info } from "lucide-react";
import { scopeAnchorId, type MinistryType } from "@/lib/ministry-scopes";

// ---------------------------------------------------------------------------
// Response shapes (mirrors artifacts/api-server/src/routes/ministry.ts).
// All values are aggregates — no per-person rows are ever returned.
// ---------------------------------------------------------------------------

type EduOverview = {
  totalInstitutions: number;
  trackedStudents: number;
  placedStudents: number;
  placementRate: number;
};
type EduInstitution = {
  institutionId: number;
  name: string;
  type: string;
  trackedStudents: number;
  placedStudents: number;
  placementRate: number;
  avgTalentScore: number | null;
};
type TrendPoint = { periodStart: string; label: string; hires: number };
type SkillPoint = { skill: string; count: number };

type LabOverview = {
  totalJobs: number;
  totalHires: number;
  activeEmployers: number;
  totalCandidates: number;
};
type LabJobs = {
  byMonth: { periodStart: string; label: string; count: number }[];
  byType: { type: string; count: number }[];
};
type SalaryBand = {
  currency: string;
  employmentType: string;
  count: number;
  avgSalary: number;
  minSalary: number;
  maxSalary: number;
};
type LabEmployers = {
  byIndustry: { industry: string; hires: number }[];
  topEmployers: { name: string; hires: number }[];
};

type DashboardResponse = {
  ministry: {
    id: number;
    name: string;
    type: MinistryType;
    dataAccess: string[];
  };
  sections: {
    "edu:overview"?: EduOverview;
    "edu:institutions"?: EduInstitution[];
    "edu:trends"?: TrendPoint[];
    "edu:skills"?: SkillPoint[];
    "lab:overview"?: LabOverview;
    "lab:jobs"?: LabJobs;
    "lab:salary"?: SalaryBand[];
    "lab:employers"?: LabEmployers;
    "lab:skills"?: SkillPoint[];
  };
};

const CHART_COLOR = "hsl(var(--primary))";

function formatMoney(subunits: number, currency: string): string {
  const code = (currency || "NGN").toUpperCase();
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: code,
      maximumFractionDigits: 0,
    }).format(subunits / 100);
  } catch {
    return `${code} ${(subunits / 100).toLocaleString()}`;
  }
}

function Kpi({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-3xl font-bold tracking-tight mt-1">{value}</p>
      </CardContent>
    </Card>
  );
}

function Section({
  scopeKey,
  title,
  description,
  children,
}: {
  scopeKey: string;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={scopeAnchorId(scopeKey)} className="scroll-mt-32 space-y-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{title}</h2>
        {description && (
          <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      {children}
    </section>
  );
}

export default function MinistryDashboard() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    customFetch<DashboardResponse>("/api/ministry/dashboard")
      .then((res) => {
        if (active) setData(res);
      })
      .catch((err: unknown) => {
        if (active)
          setError(
            (err as { data?: { error?: string } })?.data?.error ??
              "Failed to load the ministry dashboard.",
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="container py-10">
        <p className="text-muted-foreground">Loading dashboard…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="container py-10">
        <div className="flex items-start gap-2 p-4 rounded-md bg-destructive/10 text-destructive text-sm max-w-lg">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error ?? "No data available."}</span>
        </div>
      </div>
    );
  }

  const { ministry, sections } = data;
  const grantedCount = Object.keys(sections).length;

  return (
    <div className="container py-8 space-y-10 max-w-6xl">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">{ministry.name}</h1>
        <p className="text-sm text-muted-foreground">
          National{" "}
          {ministry.type === "labour" ? "labour-market" : "education"}{" "}
          statistics. All figures are aggregates — no individual records are
          shown.
        </p>
      </header>

      {grantedCount === 0 && (
        <div className="flex items-start gap-2 p-4 rounded-md bg-muted text-muted-foreground text-sm max-w-lg">
          <Info className="w-4 h-4 mt-0.5 shrink-0" />
          <span>
            No data sections have been granted to this account yet. Contact
            your platform administrator.
          </span>
        </div>
      )}

      {/* ---- Education ---- */}
      {sections["edu:overview"] && (
        <Section
          scopeKey="edu:overview"
          title="National overview"
          description="Tracked students are those with a verified institution affiliation."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              label="Institutions tracked"
              value={sections["edu:overview"].totalInstitutions.toLocaleString()}
            />
            <Kpi
              label="Students tracked"
              value={sections["edu:overview"].trackedStudents.toLocaleString()}
            />
            <Kpi
              label="Students placed"
              value={sections["edu:overview"].placedStudents.toLocaleString()}
            />
            <Kpi
              label="Placement rate"
              value={`${sections["edu:overview"].placementRate}%`}
            />
          </div>
        </Section>
      )}

      {sections["edu:institutions"] && (
        <Section
          scopeKey="edu:institutions"
          title="Institution placement performance"
          description="Top institutions by number of placed graduates."
        >
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Institution</TableHead>
                    <TableHead className="text-right">Tracked</TableHead>
                    <TableHead className="text-right">Placed</TableHead>
                    <TableHead className="text-right">Placement rate</TableHead>
                    <TableHead className="text-right">Avg talent</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sections["edu:institutions"].length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={5}
                        className="text-center text-muted-foreground py-8"
                      >
                        No tracked institutions yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    sections["edu:institutions"].map((i) => (
                      <TableRow key={i.institutionId}>
                        <TableCell className="font-medium">{i.name}</TableCell>
                        <TableCell className="text-right">
                          {i.trackedStudents.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          {i.placedStudents.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          {i.placementRate}%
                        </TableCell>
                        <TableCell className="text-right">
                          {i.avgTalentScore ?? "—"}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </Section>
      )}

      {sections["edu:trends"] && (
        <Section
          scopeKey="edu:trends"
          title="Placement trends"
          description="Monthly graduate hires over the last 12 months."
        >
          <Card>
            <CardContent className="p-4 h-72">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={sections["edu:trends"]}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="label" fontSize={12} />
                  <YAxis allowDecimals={false} fontSize={12} />
                  <Tooltip />
                  <Line
                    type="monotone"
                    dataKey="hires"
                    stroke={CHART_COLOR}
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </Section>
      )}

      {sections["edu:skills"] && (
        <SkillsSection
          scopeKey="edu:skills"
          title="Graduate skills"
          description="Most common skills among tracked students."
          skills={sections["edu:skills"]}
        />
      )}

      {/* ---- Labour ---- */}
      {sections["lab:overview"] && (
        <Section
          scopeKey="lab:overview"
          title="Labour-market overview"
          description="Headline activity across the national jobs market."
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Kpi
              label="Public jobs posted"
              value={sections["lab:overview"].totalJobs.toLocaleString()}
            />
            <Kpi
              label="Total hires"
              value={sections["lab:overview"].totalHires.toLocaleString()}
            />
            <Kpi
              label="Active employers"
              value={sections["lab:overview"].activeEmployers.toLocaleString()}
            />
            <Kpi
              label="Candidates in market"
              value={sections["lab:overview"].totalCandidates.toLocaleString()}
            />
          </div>
        </Section>
      )}

      {sections["lab:jobs"] && (
        <Section
          scopeKey="lab:jobs"
          title="Jobs & hiring activity"
          description="Job postings over the last 12 months and by employment type."
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Postings by month</CardTitle>
              </CardHeader>
              <CardContent className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={sections["lab:jobs"].byMonth}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      className="stroke-muted"
                    />
                    <XAxis dataKey="label" fontSize={12} />
                    <YAxis allowDecimals={false} fontSize={12} />
                    <Tooltip />
                    <Line
                      type="monotone"
                      dataKey="count"
                      stroke={CHART_COLOR}
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  By employment type
                </CardTitle>
              </CardHeader>
              <CardContent className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={sections["lab:jobs"].byType}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      className="stroke-muted"
                    />
                    <XAxis dataKey="type" fontSize={12} />
                    <YAxis allowDecimals={false} fontSize={12} />
                    <Tooltip />
                    <Bar dataKey="count" fill={CHART_COLOR} radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>
        </Section>
      )}

      {sections["lab:salary"] && (
        <Section
          scopeKey="lab:salary"
          title="Salary insights"
          description="Aggregated reported-salary bands. Bands with fewer than 3 reports are hidden to protect privacy."
        >
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Employment type</TableHead>
                    <TableHead>Currency</TableHead>
                    <TableHead className="text-right">Reports</TableHead>
                    <TableHead className="text-right">Average</TableHead>
                    <TableHead className="text-right">Min</TableHead>
                    <TableHead className="text-right">Max</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sections["lab:salary"].length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="text-center text-muted-foreground py-8"
                      >
                        Not enough salary reports to show bands yet.
                      </TableCell>
                    </TableRow>
                  ) : (
                    sections["lab:salary"].map((b, idx) => (
                      <TableRow key={`${b.employmentType}-${b.currency}-${idx}`}>
                        <TableCell className="font-medium capitalize">
                          {b.employmentType}
                        </TableCell>
                        <TableCell className="uppercase">{b.currency}</TableCell>
                        <TableCell className="text-right">
                          {b.count.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatMoney(b.avgSalary, b.currency)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatMoney(b.minSalary, b.currency)}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatMoney(b.maxSalary, b.currency)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </Section>
      )}

      {sections["lab:employers"] && (
        <Section
          scopeKey="lab:employers"
          title="Employer activity"
          description="Hiring activity by industry and the most active employers."
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Hires by industry</CardTitle>
              </CardHeader>
              <CardContent className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={sections["lab:employers"].byIndustry}
                    layout="vertical"
                    margin={{ left: 24 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      className="stroke-muted"
                    />
                    <XAxis type="number" allowDecimals={false} fontSize={12} />
                    <YAxis
                      type="category"
                      dataKey="industry"
                      width={110}
                      fontSize={12}
                    />
                    <Tooltip />
                    <Bar
                      dataKey="hires"
                      fill={CHART_COLOR}
                      radius={[0, 4, 4, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Most active employers</CardTitle>
                <CardDescription>By number of hires</CardDescription>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Employer</TableHead>
                      <TableHead className="text-right">Hires</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sections["lab:employers"].topEmployers.map((e, idx) => (
                      <TableRow key={`${e.name}-${idx}`}>
                        <TableCell className="font-medium">{e.name}</TableCell>
                        <TableCell className="text-right">
                          {e.hires.toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        </Section>
      )}

      {sections["lab:skills"] && (
        <SkillsSection
          scopeKey="lab:skills"
          title="Skills demand"
          description="Most in-demand skills across open jobs."
          skills={sections["lab:skills"]}
        />
      )}
    </div>
  );
}

function SkillsSection({
  scopeKey,
  title,
  description,
  skills,
}: {
  scopeKey: string;
  title: string;
  description: string;
  skills: SkillPoint[];
}) {
  return (
    <Section scopeKey={scopeKey} title={title} description={description}>
      <Card>
        <CardContent className="p-4 h-80">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={skills} layout="vertical" margin={{ left: 24 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis type="number" allowDecimals={false} fontSize={12} />
              <YAxis
                type="category"
                dataKey="skill"
                width={120}
                fontSize={12}
              />
              <Tooltip />
              <Bar dataKey="count" fill={CHART_COLOR} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </Section>
  );
}
