import { useEffect, useMemo, useState } from "react";
import {
  useAdminListPayments,
  adminRefinalizePayment,
  type AdminPaymentLedgerRow,
  type AdminRefinalizePaymentResponse,
} from "@workspace/api-client-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CreditCard, RotateCcw, Loader2, Download } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";

const PAGE_SIZE = 50;

const CATEGORY_OPTIONS = [
  { value: "all", label: "All categories" },
  { value: "candidate", label: "Candidate (Boost + AI CV)" },
  { value: "institution", label: "Institution (Subscriptions)" },
  { value: "employer", label: "Employer (Job tiers + Subscriptions)" },
];

const PROVIDER_OPTIONS = [
  { value: "all", label: "All providers" },
  { value: "stripe", label: "Stripe" },
  { value: "paystack", label: "Paystack" },
];

const STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "paid", label: "paid" },
  { value: "pending", label: "pending" },
  { value: "failed", label: "failed" },
  { value: "active", label: "active" },
  { value: "trialing", label: "trialing" },
  { value: "canceled", label: "canceled" },
];

function formatMoney(subunits: number, currency: string): string {
  const major = subunits / 100;
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
      maximumFractionDigits: 2,
    }).format(major);
  } catch {
    return `${currency.toUpperCase()} ${major.toLocaleString()}`;
  }
}

function StatusBadge({ status }: { status: string }) {
  const good = status === "paid" || status === "active" || status === "trialing";
  const bad = status === "failed" || status === "canceled";
  return (
    <Badge
      variant={good ? "default" : bad ? "destructive" : "secondary"}
      className="font-mono text-xs"
    >
      {status}
    </Badge>
  );
}

function toIsoOrUndef(yyyyMmDd: string, endOfDay = false): string | undefined {
  if (!yyyyMmDd) return undefined;
  const suffix = endOfDay ? "T23:59:59.999Z" : "T00:00:00.000Z";
  const d = new Date(yyyyMmDd + suffix);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export default function AdminPaymentsPage() {
  const [category, setCategory] = useState("all");
  const [provider, setProvider] = useState("all");
  const [status, setStatus] = useState("all");
  const [currency, setCurrency] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  const [refinalizingId, setRefinalizingId] = useState<number | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [lastOutcome, setLastOutcome] = useState<
    (AdminRefinalizePaymentResponse & { paymentId: number }) | null
  >(null);

  const params = useMemo(
    () => ({
      ...(category !== "all" ? { category } : {}),
      ...(provider !== "all" ? { provider } : {}),
      ...(status !== "all" ? { status } : {}),
      ...(currency.trim().length > 0
        ? { currency: currency.trim().toLowerCase() }
        : {}),
      ...(from ? { from: toIsoOrUndef(from) } : {}),
      ...(to ? { to: toIsoOrUndef(to, true) } : {}),
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [category, provider, status, currency, from, to, page],
  );

  const { data, isLoading, refetch, isFetching } = useAdminListPayments(
    params as Parameters<typeof useAdminListPayments>[0],
  );
  const payments: AdminPaymentLedgerRow[] = data?.payments ?? [];

  function resetFilters() {
    setCategory("all");
    setProvider("all");
    setStatus("all");
    setCurrency("");
    setFrom("");
    setTo("");
    setPage(0);
  }

  async function handleRefinalize(row: AdminPaymentLedgerRow) {
    setRefinalizingId(row.id);
    try {
      const result = await adminRefinalizePayment(row.id);
      setLastOutcome({ ...result, paymentId: row.id });
      toast.success(
        result.alreadyFinalized
          ? `Already finalized (${result.flow ?? "no-op"})`
          : `Re-finalized (${result.flow ?? "no-op"})`,
        {
          description: `${result.provider} · ${result.externalRef}`,
        },
      );
      await refetch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error("Re-finalize failed", { description: msg });
    } finally {
      setRefinalizingId(null);
    }
  }

  function buildFilterQuery(): string {
    const qs = new URLSearchParams();
    if (category !== "all") qs.set("category", category);
    if (provider !== "all") qs.set("provider", provider);
    if (status !== "all") qs.set("status", status);
    if (currency.trim().length > 0)
      qs.set("currency", currency.trim().toLowerCase());
    const fromIso = from ? toIsoOrUndef(from) : undefined;
    const toIso = to ? toIsoOrUndef(to, true) : undefined;
    if (fromIso) qs.set("from", fromIso);
    if (toIso) qs.set("to", toIso);
    return qs.toString();
  }

  async function handleExportCsv() {
    setIsExporting(true);
    try {
      const qs = buildFilterQuery();
      const url = `/api/admin/payments.csv${qs ? `?${qs}` : ""}`;
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        throw new Error(`Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="?([^";]+)"?/i);
      const filename = match?.[1] ?? "payments.csv";
      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(objectUrl);
      toast.success("CSV downloaded", { description: filename });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      toast.error("CSV export failed", { description: msg });
    } finally {
      setIsExporting(false);
    }
  }

  // Reset to page 0 whenever any filter changes so we don't land on
  // an empty later page after narrowing the result set.
  useEffect(() => {
    setPage(0);
  }, [category, provider, status, currency, from, to]);

  return (
    <div className="container px-4 py-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 border-2 border-primary/20 flex items-center justify-center shrink-0 text-primary">
          <CreditCard className="w-7 h-7" />
        </div>
        <div className="flex-1 min-w-[200px]">
          <h1 className="text-3xl font-bold tracking-tight">Payments</h1>
          <p className="text-muted-foreground mt-1">
            Reconcile individual rows from the unified payments ledger
            across Stripe and Paystack. Use re-finalize when a webhook
            never arrived — it's idempotent and safe to retry.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Category</Label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger data-testid="select-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Provider</Label>
              <Select value={provider} onValueChange={setProvider}>
                <SelectTrigger data-testid="select-provider">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROVIDER_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger data-testid="select-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Currency</Label>
              <Input
                placeholder="usd, ngn, ghs…"
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                data-testid="input-currency"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">From (finalized)</Label>
              <Input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                data-testid="input-from"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">To (finalized)</Label>
              <Input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                data-testid="input-to"
              />
            </div>
          </div>
          <div className="flex items-center gap-2 mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={resetFilters}
              data-testid="button-reset-filters"
            >
              Reset
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refetch()}
              disabled={isFetching}
              data-testid="button-refresh"
            >
              {isFetching ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : null}
              Refresh
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCsv}
              disabled={isExporting}
              data-testid="button-export-csv"
            >
              {isExporting ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <Download className="w-4 h-4 mr-1" />
              )}
              Download CSV
            </Button>
          </div>
        </CardContent>
      </Card>

      {lastOutcome && (
        <Card data-testid="card-last-outcome">
          <CardContent className="p-4 text-sm">
            <span className="font-medium">
              Last re-finalize for payment #{lastOutcome.paymentId}:
            </span>{" "}
            <span className="font-mono text-muted-foreground">
              {JSON.stringify({
                provider: lastOutcome.provider,
                externalRef: lastOutcome.externalRef,
                flow: lastOutcome.flow,
                alreadyFinalized: lastOutcome.alreadyFinalized,
                reconciled: lastOutcome.reconciled,
              })}
            </span>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Flow</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>External ref</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Finalized</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell
                      colSpan={9}
                      className="text-center text-muted-foreground py-12"
                    >
                      Loading payments…
                    </TableCell>
                  </TableRow>
                ) : payments.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={9}
                      className="text-center text-muted-foreground py-12"
                    >
                      No payments match these filters.
                    </TableCell>
                  </TableRow>
                ) : (
                  payments.map((p) => (
                    <TableRow
                      key={p.id}
                      data-testid={`row-payment-${p.id}`}
                    >
                      <TableCell className="font-mono text-xs">
                        {p.id}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize">
                          {p.provider}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs">
                        {p.purposeType}
                      </TableCell>
                      <TableCell
                        className="text-xs max-w-[220px]"
                        data-testid={`cell-customer-${p.id}`}
                      >
                        {p.customerName && p.customerDeepLink ? (
                          <Link
                            href={p.customerDeepLink}
                            className="text-primary hover:underline truncate block"
                            title={`${p.customerName} (${p.customerType})`}
                            data-testid={`link-customer-${p.id}`}
                          >
                            {p.customerName}
                          </Link>
                        ) : (
                          <span
                            className="text-muted-foreground"
                            title={
                              p.purposeId != null
                                ? `${p.purposeType} #${p.purposeId}`
                                : undefined
                            }
                          >
                            {p.purposeId != null
                              ? `${p.purposeType} #${p.purposeId}`
                              : "—"}
                          </span>
                        )}
                      </TableCell>
                      <TableCell
                        className="font-mono text-xs max-w-[280px] truncate"
                        title={p.externalRef}
                      >
                        {p.externalRef}
                      </TableCell>
                      <TableCell className="text-right font-mono">
                        {formatMoney(p.amountSubunits, p.currency)}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={p.status} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {p.finalizedAt
                          ? new Date(p.finalizedAt).toLocaleString()
                          : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRefinalize(p)}
                          disabled={refinalizingId === p.id}
                          data-testid={`button-refinalize-${p.id}`}
                        >
                          {refinalizingId === p.id ? (
                            <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                          ) : (
                            <RotateCcw className="w-3.5 h-3.5 mr-1" />
                          )}
                          Re-finalize
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          Page {page + 1} · showing up to {PAGE_SIZE} rows. Ordered by
          most recent first.
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0 || isFetching}
            data-testid="button-prev-page"
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((p) => p + 1)}
            disabled={payments.length < PAGE_SIZE || isFetching}
            data-testid="button-next-page"
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
