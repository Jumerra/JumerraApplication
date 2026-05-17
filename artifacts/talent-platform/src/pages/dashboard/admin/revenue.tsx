import { useMemo, useState } from "react";
import {
  useAdminGetRevenueSummary,
  useAdminGetRevenueTimeseries,
  type RevenueCurrencyRollup,
  type RevenueTimeseriesPoint,
} from "@workspace/api-client-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
} from "recharts";
import {
  DollarSign,
  GraduationCap,
  Building2,
  Users,
  TrendingUp,
  CreditCard,
} from "lucide-react";

type Range = "7d" | "30d" | "90d" | "365d";

const RANGES: { key: Range; label: string; days: number; bucket: "day" | "week" | "month" }[] = [
  { key: "7d", label: "Last 7 days", days: 7, bucket: "day" },
  { key: "30d", label: "Last 30 days", days: 30, bucket: "day" },
  { key: "90d", label: "Last 90 days", days: 90, bucket: "day" },
  { key: "365d", label: "Last 12 months", days: 365, bucket: "month" },
];

const CATEGORY_COLORS: Record<string, string> = {
  candidate: "hsl(var(--chart-1, 173 80% 40%))",
  institution: "hsl(var(--chart-2, 200 90% 55%))",
  employer: "hsl(var(--chart-3, 142 71% 45%))",
  other: "hsl(var(--muted-foreground))",
};

const PROVIDER_COLORS: Record<string, string> = {
  stripe: "hsl(var(--chart-4, 262 83% 58%))",
  paystack: "hsl(var(--chart-5, 24 95% 53%))",
};

/**
 * Currency formatter — `amount` is always passed in subunits (cents
 * for USD, kobo for NGN). We divide by 100 for every rail we support
 * today; if we ever add JPY/IDR (zero-subunit currencies) this needs
 * a per-currency lookup table.
 */
function formatMoney(subunits: number, currency: string): string {
  const major = subunits / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
      maximumFractionDigits: 0,
    }).format(major);
  } catch {
    return `${currency.toUpperCase()} ${major.toLocaleString()}`;
  }
}

function CategoryIcon({ category }: { category: string }) {
  if (category === "candidate") return <Users className="w-4 h-4" />;
  if (category === "institution") return <GraduationCap className="w-4 h-4" />;
  if (category === "employer") return <Building2 className="w-4 h-4" />;
  return <DollarSign className="w-4 h-4" />;
}

function CurrencyCard({ rollup }: { rollup: RevenueCurrencyRollup }) {
  const categories = useMemo(
    () =>
      (["candidate", "institution", "employer"] as const)
        .map((k) => ({
          key: k,
          label: k.charAt(0).toUpperCase() + k.slice(1),
          ...rollup.byCategory[k],
        }))
        .filter((c) => c.grossSubunits > 0 || c.transactions > 0),
    [rollup.byCategory],
  );

  const pieData = categories.map((c) => ({
    name: c.label,
    value: c.grossSubunits,
    key: c.key,
  }));

  const providers = (["stripe", "paystack"] as const).map((p) => ({
    key: p,
    label: p === "stripe" ? "Stripe" : "Paystack",
    ...rollup.byProvider[p],
  }));

  return (
    <Card data-testid={`card-currency-${rollup.currency}`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-medium text-muted-foreground">
            {rollup.currency.toUpperCase()} revenue
          </CardTitle>
          <Badge variant="secondary" className="font-mono">
            {rollup.transactions.toLocaleString()} txn
          </Badge>
        </div>
        <div className="text-3xl font-bold tracking-tight pt-1">
          {formatMoney(rollup.grossSubunits, rollup.currency)}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Per-category breakdown */}
        <div className="space-y-1.5">
          {categories.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No revenue in this currency yet.
            </p>
          ) : (
            categories.map((c) => (
              <div
                key={c.key}
                className="flex items-center justify-between text-sm"
              >
                <span className="flex items-center gap-2 text-muted-foreground">
                  <CategoryIcon category={c.key} />
                  {c.label}
                </span>
                <span className="font-mono">
                  {formatMoney(c.grossSubunits, rollup.currency)}
                  <span className="text-muted-foreground ml-2">
                    ({c.transactions})
                  </span>
                </span>
              </div>
            ))
          )}
        </div>

        {/* Donut chart */}
        {pieData.length > 0 && (
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={40}
                  outerRadius={65}
                  paddingAngle={2}
                >
                  {pieData.map((d) => (
                    <Cell
                      key={d.key}
                      fill={CATEGORY_COLORS[d.key] ?? CATEGORY_COLORS.other}
                    />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value: number) =>
                    formatMoney(value, rollup.currency)
                  }
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Provider split */}
        <div className="pt-2 border-t border-border/40 space-y-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <CreditCard className="w-3 h-3" /> By provider
          </p>
          {providers.map((p) => (
            <div key={p.key} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{p.label}</span>
              <span className="font-mono">
                {formatMoney(p.grossSubunits, rollup.currency)}
                <span className="text-muted-foreground ml-2">
                  ({p.transactions})
                </span>
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Pivots the flat list of (bucketStart, currency, category, gross)
 * points into one row per bucketStart with one column per
 * (currency:category) series, suitable for Recharts.
 */
function buildChartRows(
  points: RevenueTimeseriesPoint[],
  currency: string,
): Array<Record<string, number | string>> {
  const filtered = points.filter((p) => p.currency === currency);
  const byBucket = new Map<string, Record<string, number | string>>();
  for (const p of filtered) {
    const dateLabel = p.bucketStart.slice(0, 10);
    let row = byBucket.get(dateLabel);
    if (!row) {
      row = {
        date: dateLabel,
        candidate: 0,
        institution: 0,
        employer: 0,
      };
      byBucket.set(dateLabel, row);
    }
    const cur = (row[p.category] as number) ?? 0;
    row[p.category] = cur + p.grossSubunits / 100;
  }
  return Array.from(byBucket.values()).sort((a, b) =>
    String(a.date).localeCompare(String(b.date)),
  );
}

export default function AdminRevenuePage() {
  const [range, setRange] = useState<Range>("90d");
  const selected = RANGES.find((r) => r.key === range) ?? RANGES[2];

  const fromIso = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - selected.days);
    return d.toISOString();
  }, [selected.days]);

  const { data: summary, isLoading: summaryLoading } =
    useAdminGetRevenueSummary({ from: fromIso });
  const { data: timeseries, isLoading: tsLoading } =
    useAdminGetRevenueTimeseries({
      from: fromIso,
      bucket: selected.bucket,
    });

  const tsPoints = timeseries?.points ?? [];

  const CURRENCY_ORDER = ["ghs", "ngn", "usd"];
  const currencies = [...(summary?.currencies ?? [])].sort((a, b) => {
    const ai = CURRENCY_ORDER.indexOf(a.currency.toLowerCase());
    const bi = CURRENCY_ORDER.indexOf(b.currency.toLowerCase());
    const aRank = ai === -1 ? CURRENCY_ORDER.length : ai;
    const bRank = bi === -1 ? CURRENCY_ORDER.length : bi;
    if (aRank !== bRank) return aRank - bRank;
    return b.grossSubunits - a.grossSubunits;
  });

  const primaryCurrency = currencies[0]?.currency ?? null;
  const chartRows = primaryCurrency
    ? buildChartRows(tsPoints, primaryCurrency)
    : [];

  // Cross-currency provider bar (counts only — gross would be wrong
  // to sum across currencies).
  const providerTxData = currencies.map((c) => ({
    name: c.currency.toUpperCase(),
    Stripe: c.byProvider.stripe.transactions,
    Paystack: c.byProvider.paystack.transactions,
  }));

  return (
    <div className="container px-4 py-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 border-2 border-primary/20 flex items-center justify-center shrink-0 text-primary">
          <TrendingUp className="w-7 h-7" />
        </div>
        <div className="flex-1 min-w-[200px]">
          <h1 className="text-3xl font-bold tracking-tight">
            Platform Revenue
          </h1>
          <p className="text-muted-foreground mt-1">
            Revenue across candidate (Boost + AI CV), institution
            (subscriptions), and employer (job tiers + subscriptions)
            services. Totals are per-currency — exchange rates are not
            applied.
          </p>
        </div>
        <div className="flex items-center gap-1 bg-muted rounded-lg p-1 shrink-0">
          {RANGES.map((r) => (
            <Button
              key={r.key}
              variant={range === r.key ? "default" : "ghost"}
              size="sm"
              onClick={() => setRange(r.key)}
              data-testid={`button-range-${r.key}`}
            >
              {r.label}
            </Button>
          ))}
        </div>
      </div>

      {summaryLoading ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            Loading revenue…
          </CardContent>
        </Card>
      ) : currencies.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            No paid transactions in this window yet.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Per-currency KPI cards with category + provider breakdown */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {currencies.map((c) => (
              <CurrencyCard key={c.currency} rollup={c} />
            ))}
          </div>

          {/* Time-series chart for the top currency */}
          {primaryCurrency && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  {primaryCurrency.toUpperCase()} revenue over time, by
                  service
                </CardTitle>
              </CardHeader>
              <CardContent>
                {tsLoading ? (
                  <div className="h-72 flex items-center justify-center text-muted-foreground">
                    Loading chart…
                  </div>
                ) : chartRows.length === 0 ? (
                  <div className="h-72 flex items-center justify-center text-muted-foreground">
                    No data points in this window.
                  </div>
                ) : (
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={chartRows}>
                        <CartesianGrid
                          strokeDasharray="3 3"
                          className="stroke-muted"
                        />
                        <XAxis dataKey="date" />
                        <YAxis
                          tickFormatter={(v: number) =>
                            v >= 1000 ? `${(v / 1000).toFixed(0)}k` : `${v}`
                          }
                        />
                        <Tooltip
                          formatter={(value: number) =>
                            formatMoney(value * 100, primaryCurrency)
                          }
                        />
                        <Legend />
                        <Line
                          type="monotone"
                          dataKey="candidate"
                          stroke={CATEGORY_COLORS.candidate}
                          strokeWidth={2}
                          dot={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="institution"
                          stroke={CATEGORY_COLORS.institution}
                          strokeWidth={2}
                          dot={false}
                        />
                        <Line
                          type="monotone"
                          dataKey="employer"
                          stroke={CATEGORY_COLORS.employer}
                          strokeWidth={2}
                          dot={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Provider transaction split */}
          {providerTxData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">
                  Transactions by payment provider
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  Transaction counts are safe to compare across
                  currencies; gross is not.
                </p>
              </CardHeader>
              <CardContent>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={providerTxData}>
                      <CartesianGrid
                        strokeDasharray="3 3"
                        className="stroke-muted"
                      />
                      <XAxis dataKey="name" />
                      <YAxis allowDecimals={false} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="Stripe" fill={PROVIDER_COLORS.stripe} />
                      <Bar dataKey="Paystack" fill={PROVIDER_COLORS.paystack} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
