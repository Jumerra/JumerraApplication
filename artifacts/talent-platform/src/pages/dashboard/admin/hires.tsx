import { useEffect, useMemo, useRef, useState } from "react";
import { useAdminGetHiresAnalytics } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ResponsiveContainer,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Area,
  AreaChart,
} from "recharts";
import {
  Trophy,
  TrendingUp,
  Calendar,
  Download,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
} from "lucide-react";

type Bucket = "day" | "week" | "month" | "year";

const BUCKETS: { value: Bucket; label: string }[] = [
  { value: "day", label: "Daily" },
  { value: "week", label: "Weekly" },
  { value: "month", label: "Monthly" },
  { value: "year", label: "Yearly" },
];

function defaultRange(bucket: Bucket): { from: string; to: string } {
  const to = new Date();
  const from = new Date();
  if (bucket === "day") from.setDate(from.getDate() - 29);
  else if (bucket === "week") from.setDate(from.getDate() - 7 * 11);
  else if (bucket === "month") from.setMonth(from.getMonth() - 11);
  else from.setFullYear(from.getFullYear() - 4);
  return {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };
}

function periodEndIso(bucket: Bucket, dateOnly: string): string {
  // Convert "YYYY-MM-DD" → end-of-day ISO so the inclusive upper bound
  // captures all hires recorded on the chosen end date.
  const d = new Date(`${dateOnly}T23:59:59.999Z`);
  return d.toISOString();
}

function periodStartIso(_bucket: Bucket, dateOnly: string): string {
  const d = new Date(`${dateOnly}T00:00:00.000Z`);
  return d.toISOString();
}

export default function AdminHiresPage() {
  const [bucket, setBucket] = useState<Bucket>("day");
  const initial = useMemo(() => defaultRange(bucket), [bucket]);
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);

  // When the bucket changes the user expects a sensible default range,
  // so reset both endpoints. We skip the very first render so the user's
  // initial defaults aren't overwritten.
  const isFirstBucket = useRef(true);
  useEffect(() => {
    if (isFirstBucket.current) {
      isFirstBucket.current = false;
      return;
    }
    const next = defaultRange(bucket);
    setFrom(next.from);
    setTo(next.to);
  }, [bucket]);

  const queryParams = {
    bucket,
    from: periodStartIso(bucket, from),
    to: periodEndIso(bucket, to),
  };

  const { data, isLoading } = useAdminGetHiresAnalytics(queryParams);

  const points = data?.points ?? [];
  const total = data?.total ?? 0;

  const stats = useMemo(() => {
    if (points.length === 0) {
      return { current: 0, previous: 0, peak: 0, average: 0 };
    }
    const half = Math.floor(points.length / 2);
    const previous = points.slice(0, half).reduce((s, p) => s + p.count, 0);
    const current = points.slice(half).reduce((s, p) => s + p.count, 0);
    const peak = Math.max(...points.map((p) => p.count));
    const average = points.reduce((s, p) => s + p.count, 0) / points.length;
    return { current, previous, peak, average };
  }, [points]);

  const trendPct =
    stats.previous === 0
      ? stats.current === 0
        ? 0
        : 100
      : ((stats.current - stats.previous) / stats.previous) * 100;

  function downloadCsv() {
    const url =
      `/api/admin/hires/export.csv?bucket=${bucket}` +
      `&from=${encodeURIComponent(queryParams.from)}` +
      `&to=${encodeURIComponent(queryParams.to)}`;
    // Direct navigation triggers Content-Disposition download; cookies on
    // same-origin go along, so admin auth is preserved.
    window.location.href = url;
  }

  return (
    <div className="container px-4 py-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 border-2 border-primary/20 flex items-center justify-center shrink-0 text-primary">
          <Trophy className="w-7 h-7" />
        </div>
        <div className="flex-1">
          <h1 className="text-3xl font-bold tracking-tight">Hires Analytics</h1>
          <p className="text-muted-foreground mt-1">
            Track total hires by day, week, month, or year and download the
            data as CSV.
          </p>
        </div>
        <Badge variant="secondary" className="text-sm">
          {total} hires in range
        </Badge>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <Tabs
              value={bucket}
              onValueChange={(v) => setBucket(v as Bucket)}
              className="w-full lg:w-auto"
            >
              <TabsList>
                {BUCKETS.map((b) => (
                  <TabsTrigger key={b.value} value={b.value}>
                    {b.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>

            <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
              <div className="space-y-1">
                <Label htmlFor="from" className="text-xs">From</Label>
                <Input
                  id="from"
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="to" className="text-xs">To</Label>
                <Input
                  id="to"
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                />
              </div>
              <div className="self-end">
                <Button onClick={downloadCsv} className="w-full sm:w-auto">
                  <Download className="w-4 h-4 mr-2" />
                  Download CSV
                </Button>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryCard
              icon={<Trophy className="w-4 h-4" />}
              label="Total hires"
              value={total.toLocaleString()}
            />
            <SummaryCard
              icon={<TrendingUp className="w-4 h-4" />}
              label="Recent vs earlier"
              value={`${trendPct >= 0 ? "+" : ""}${trendPct.toFixed(1)}%`}
              trend={trendPct}
            />
            <SummaryCard
              icon={<Calendar className="w-4 h-4" />}
              label="Peak per period"
              value={stats.peak.toString()}
            />
            <SummaryCard
              icon={<Calendar className="w-4 h-4" />}
              label={`Average per ${bucket}`}
              value={stats.average.toFixed(1)}
            />
          </div>

          <div className="h-[320px] rounded-lg border bg-card/40 p-3">
            {isLoading ? (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                Loading…
              </div>
            ) : points.length === 0 ? (
              <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
                No hires recorded in the selected window.
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={points}>
                  <defs>
                    <linearGradient id="hiresGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop
                        offset="0%"
                        stopColor="hsl(var(--primary))"
                        stopOpacity={0.4}
                      />
                      <stop
                        offset="100%"
                        stopColor="hsl(var(--primary))"
                        stopOpacity={0}
                      />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 11 }}
                    interval="preserveStartEnd"
                  />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                  <Tooltip
                    contentStyle={{
                      background: "hsl(var(--background))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(v: number) => [`${v} hires`, ""]}
                  />
                  <Area
                    type="monotone"
                    dataKey="count"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    fill="url(#hiresGradient)"
                    name="Hires"
                  />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Period breakdown</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 text-center text-muted-foreground">Loading…</div>
          ) : points.length === 0 ? (
            <div className="p-6 text-center text-muted-foreground">
              Nothing to show.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-muted-foreground">
                  <tr>
                    <th className="text-left font-medium px-6 py-2">Period</th>
                    <th className="text-right font-medium px-6 py-2">Hires</th>
                    <th className="text-left font-medium px-6 py-2 hidden sm:table-cell">
                      Bar
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {[...points].reverse().map((p) => {
                    const pct = stats.peak > 0 ? (p.count / stats.peak) * 100 : 0;
                    return (
                      <tr key={p.periodStart}>
                        <td className="px-6 py-2 font-mono text-xs">{p.label}</td>
                        <td className="px-6 py-2 text-right tabular-nums">
                          {p.count}
                        </td>
                        <td className="px-6 py-2 hidden sm:table-cell">
                          <div className="h-2 w-full max-w-xs rounded bg-muted overflow-hidden">
                            <div
                              className="h-full bg-primary"
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  trend,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  trend?: number;
}) {
  const TrendIcon =
    trend === undefined
      ? null
      : trend > 0
        ? ArrowUpRight
        : trend < 0
          ? ArrowDownRight
          : Minus;
  const trendColor =
    trend === undefined
      ? ""
      : trend > 0
        ? "text-emerald-600"
        : trend < 0
          ? "text-rose-600"
          : "text-muted-foreground";
  return (
    <div className="rounded-lg border p-4 bg-card">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className={`mt-2 text-2xl font-bold tracking-tight flex items-center gap-1 ${trendColor}`}>
        {value}
        {TrendIcon ? <TrendIcon className="w-5 h-5" /> : null}
      </div>
    </div>
  );
}
