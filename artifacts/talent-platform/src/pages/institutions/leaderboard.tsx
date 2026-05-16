import { useEffect, useMemo } from "react";
import { useParams, useLocation, Link } from "wouter";
import {
  useGetInstitutionCohortLeaderboard,
  type InstitutionCohortLeaderboard,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ArrowLeft, Building2, GraduationCap, Trophy } from "lucide-react";

function setMeta(name: string, content: string, attr: "name" | "property" = "name") {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function formatCurrency(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${currency} ${n.toLocaleString()}`;
  }
}

const ALL_VALUE = "__all__";

export default function InstitutionLeaderboardPage() {
  const params = useParams<{ id: string }>();
  const institutionId = Number(params.id);
  const [location, navigate] = useLocation();

  // Read year / departmentId from the query string ourselves; wouter
  // doesn't surface them through useParams.
  const search = useMemo(() => {
    const idx = location.indexOf("?");
    return new URLSearchParams(idx >= 0 ? location.slice(idx) : "");
  }, [location]);
  const year = search.get("year") ? Number(search.get("year")) : undefined;
  const departmentId = search.get("departmentId")
    ? Number(search.get("departmentId"))
    : undefined;

  const { data, isLoading, error } = useGetInstitutionCohortLeaderboard(
    institutionId,
    {
      ...(year !== undefined ? { year } : {}),
      ...(departmentId !== undefined ? { departmentId } : {}),
    },
  );

  useEffect(() => {
    if (!data) return;
    const title = `${data.institutionName} — Placement Leaderboard | Jumerra`;
    const desc =
      `${data.totalPlaced} students placed from ${data.institutionName}. ` +
      `Median time to placement: ${data.medianTimeToPlacementDays} days. ` +
      `Top hiring partners and salary bands for graduates.`;
    document.title = title;
    setMeta("description", desc);
    setMeta("og:title", title, "property");
    setMeta("og:description", desc, "property");
    setMeta("og:type", "website", "property");
    const shareCardUrl = `/api/institutions/${institutionId}/leaderboard.png`;
    setMeta("og:image", shareCardUrl, "property");
    setMeta("og:image:width", "1200", "property");
    setMeta("og:image:height", "630", "property");
    setMeta("twitter:card", "summary_large_image");
    setMeta("twitter:image", shareCardUrl);
  }, [data]);

  function updateQuery(next: { year?: number | null; departmentId?: number | null }) {
    const sp = new URLSearchParams(search);
    if (next.year === null) sp.delete("year");
    else if (next.year !== undefined) sp.set("year", String(next.year));
    if (next.departmentId === null) sp.delete("departmentId");
    else if (next.departmentId !== undefined)
      sp.set("departmentId", String(next.departmentId));
    const qs = sp.toString();
    navigate(`/institutions/${institutionId}/leaderboard${qs ? `?${qs}` : ""}`);
  }

  if (!Number.isInteger(institutionId) || institutionId <= 0) {
    return (
      <div className="container py-12 px-4">Invalid institution.</div>
    );
  }

  if (isLoading) {
    return (
      <div className="container py-12 px-4">
        <div className="h-[400px] animate-pulse bg-muted rounded-2xl" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="container py-12 px-4 text-center space-y-3">
        <p className="text-muted-foreground">
          This institution hasn't published a public leaderboard.
        </p>
        <Button asChild variant="outline">
          <Link href="/institutions">Browse institutions</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="container px-4 py-8 max-w-6xl mx-auto space-y-8">
      <div>
        <Button asChild variant="ghost" size="sm" className="gap-2 -ml-2">
          <Link href={`/institutions/${institutionId}`}>
            <ArrowLeft className="w-4 h-4" /> Back to institution
          </Link>
        </Button>
      </div>

      <Header data={data} />

      <Filters
        data={data}
        year={year}
        departmentId={departmentId}
        onChange={updateQuery}
      />

      <Kpis data={data} />

      <Cohorts data={data} />

      <div className="grid gap-6 lg:grid-cols-2">
        <TopEmployers data={data} />
        <SalaryBands data={data} />
      </div>
    </div>
  );
}

function Header({ data }: { data: InstitutionCohortLeaderboard }) {
  return (
    <div className="flex items-center gap-4">
      {data.institutionLogoUrl ? (
        <img
          src={data.institutionLogoUrl}
          alt={data.institutionName}
          className="w-16 h-16 rounded-xl border object-cover bg-muted"
        />
      ) : (
        <div className="w-16 h-16 rounded-xl bg-muted border flex items-center justify-center text-muted-foreground">
          <GraduationCap className="w-7 h-7" />
        </div>
      )}
      <div>
        <p className="text-sm text-muted-foreground uppercase tracking-wide">
          Placement leaderboard
        </p>
        <h1 className="text-3xl font-bold tracking-tight">
          {data.institutionName}
        </h1>
        <p className="text-muted-foreground">{data.institutionLocation}</p>
      </div>
    </div>
  );
}

function Filters({
  data,
  year,
  departmentId,
  onChange,
}: {
  data: InstitutionCohortLeaderboard;
  year: number | undefined;
  departmentId: number | undefined;
  onChange: (next: {
    year?: number | null;
    departmentId?: number | null;
  }) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="grid gap-1.5">
        <label className="text-sm text-muted-foreground">Cohort year</label>
        <Select
          value={year !== undefined ? String(year) : ALL_VALUE}
          onValueChange={(v) =>
            onChange({ year: v === ALL_VALUE ? null : Number(v) })
          }
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>All cohorts</SelectItem>
            {data.availableYears
              .slice()
              .sort((a, b) => b - a)
              .map((y) => (
                <SelectItem key={y} value={String(y)}>
                  {y}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <label className="text-sm text-muted-foreground">Program</label>
        <Select
          value={
            departmentId !== undefined ? String(departmentId) : ALL_VALUE
          }
          onValueChange={(v) =>
            onChange({ departmentId: v === ALL_VALUE ? null : Number(v) })
          }
        >
          <SelectTrigger className="w-[240px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_VALUE}>All programs</SelectItem>
            {data.availableDepartments.map((d) => (
              <SelectItem key={d.id} value={String(d.id)}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

function Kpis({ data }: { data: InstitutionCohortLeaderboard }) {
  const rate =
    data.totalTracked > 0
      ? Math.round((data.totalPlaced / data.totalTracked) * 100)
      : 0;
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <Card>
        <CardContent className="p-5">
          <p className="text-sm text-muted-foreground">Total placed</p>
          <p className="text-3xl font-bold mt-1">{data.totalPlaced}</p>
          <p className="text-xs text-muted-foreground mt-1">
            of {data.totalTracked} verified students
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-5">
          <p className="text-sm text-muted-foreground">Placement rate</p>
          <p className="text-3xl font-bold mt-1">{rate}%</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-5">
          <p className="text-sm text-muted-foreground">
            Median time to placement
          </p>
          <p className="text-3xl font-bold mt-1">
            {data.medianTimeToPlacementDays}
            <span className="text-base font-normal text-muted-foreground ml-1">
              days
            </span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Cohorts({ data }: { data: InstitutionCohortLeaderboard }) {
  if (data.cohorts.length === 0) {
    return null;
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>Cohorts</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground border-b">
              <tr>
                <th className="py-2 pr-3 font-medium">Year</th>
                <th className="py-2 pr-3 font-medium">Students</th>
                <th className="py-2 pr-3 font-medium">Placed</th>
                <th className="py-2 pr-3 font-medium">Rate</th>
                <th className="py-2 pr-3 font-medium">Median TTP</th>
              </tr>
            </thead>
            <tbody>
              {data.cohorts.map((c) => {
                const rate =
                  c.totalStudents > 0
                    ? Math.round((c.placedStudents / c.totalStudents) * 100)
                    : 0;
                return (
                  <tr key={c.year} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium">{c.year}</td>
                    <td className="py-2 pr-3">{c.totalStudents}</td>
                    <td className="py-2 pr-3">{c.placedStudents}</td>
                    <td className="py-2 pr-3">{rate}%</td>
                    <td className="py-2 pr-3">
                      {c.medianTimeToPlacementDays} days
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function TopEmployers({ data }: { data: InstitutionCohortLeaderboard }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trophy className="w-5 h-5" /> Top hiring partners
        </CardTitle>
      </CardHeader>
      <CardContent>
        {data.topEmployers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hires yet.</p>
        ) : (
          <ul className="space-y-3">
            {data.topEmployers.map((e, i) => (
              <li key={e.employerId} className="flex items-center gap-3">
                <span className="w-5 text-sm text-muted-foreground">
                  {i + 1}
                </span>
                {e.employerLogoUrl ? (
                  <img
                    src={e.employerLogoUrl}
                    alt={e.employerName}
                    className="w-8 h-8 rounded border object-cover bg-muted"
                  />
                ) : (
                  <div className="w-8 h-8 rounded border bg-muted flex items-center justify-center">
                    <Building2 className="w-4 h-4 text-muted-foreground" />
                  </div>
                )}
                <Link
                  href={`/employers/${e.employerId}`}
                  className="flex-1 font-medium hover:underline"
                >
                  {e.employerName}
                </Link>
                <span className="text-sm text-muted-foreground">
                  {e.hires} hire{e.hires === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function SalaryBands({ data }: { data: InstitutionCohortLeaderboard }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Salary bands by role family</CardTitle>
      </CardHeader>
      <CardContent>
        {data.salaryBandsByRoleFamily.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Salary bands appear once a role family has at least 3 hires.
          </p>
        ) : (
          <div className="space-y-6">
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={data.salaryBandsByRoleFamily.map((b) => ({
                    name: b.roleFamily,
                    p25: b.p25,
                    p50: b.p50,
                    p75: b.p75,
                    currency: b.currency,
                  }))}
                  margin={{ left: 0, right: 16, top: 8, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip
                    formatter={(v: number, _k, item) => {
                      const cur =
                        (item?.payload?.currency as string | undefined) ?? "USD";
                      return formatCurrency(v, cur);
                    }}
                  />
                  <Bar dataKey="p50" radius={[6, 6, 0, 0]}>
                    {data.salaryBandsByRoleFamily.map((_, i) => (
                      <Cell key={i} fill="hsl(var(--primary))" />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <ul className="divide-y">
              {data.salaryBandsByRoleFamily.map((b) => (
                <li
                  key={`${b.roleFamily}-${b.currency}`}
                  className="py-2 flex items-center justify-between text-sm"
                >
                  <span className="font-medium">{b.roleFamily}</span>
                  <span className="text-muted-foreground">
                    {formatCurrency(b.p25, b.currency)} ·{" "}
                    <span className="text-foreground font-medium">
                      {formatCurrency(b.p50, b.currency)}
                    </span>{" "}
                    · {formatCurrency(b.p75, b.currency)}{" "}
                    <span className="ml-1 text-xs">({b.hires} hires)</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
