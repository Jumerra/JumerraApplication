import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetEmployerSubscriptionSettings,
  useUpdateEmployerSubscriptionSettings,
  getGetEmployerSubscriptionSettingsQueryKey,
} from "@workspace/api-client-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Briefcase, Save, AlertCircle, CheckCircle2 } from "lucide-react";

const CURRENCY_OPTIONS = [
  { value: "usd", label: "USD" },
  { value: "eur", label: "EUR" },
  { value: "gbp", label: "GBP" },
  { value: "ngn", label: "NGN" },
  { value: "ghs", label: "GHS" },
  { value: "kes", label: "KES" },
  { value: "zar", label: "ZAR" },
];

const INTERVAL_OPTIONS = [
  { value: 7, label: "Weekly (7 days)" },
  { value: 30, label: "Monthly (30 days)" },
  { value: 90, label: "Quarterly (90 days)" },
  { value: 180, label: "Half-yearly (180 days)" },
  { value: 365, label: "Yearly (365 days)" },
];

export default function AdminEmployerSubscriptionSettingsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useGetEmployerSubscriptionSettings();
  const update = useUpdateEmployerSubscriptionSettings();

  const [isActive, setIsActive] = useState(false);
  const [freeJobPostLimit, setFreeJobPostLimit] = useState("3");
  const [priceMajor, setPriceMajor] = useState("");
  const [currency, setCurrency] = useState("usd");
  const [intervalDays, setIntervalDays] = useState(30);
  const [trialDays, setTrialDays] = useState("0");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!data || hydrated) return;
    setIsActive(data.isActive);
    setFreeJobPostLimit(String(data.freeJobPostLimit));
    setPriceMajor((data.priceCents / 100).toFixed(2));
    setCurrency(data.currency);
    setIntervalDays(data.intervalDays);
    setTrialDays(String(data.trialDays));
    setHydrated(true);
  }, [data, hydrated]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSavedAt(null);

    const parsedFree = Number(freeJobPostLimit);
    if (
      !Number.isInteger(parsedFree) ||
      parsedFree < 0 ||
      parsedFree > 1000
    ) {
      setError("Free job-post limit must be between 0 and 1000.");
      return;
    }
    const parsedPrice = Number(priceMajor);
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0.5) {
      setError("Price must be at least 0.50.");
      return;
    }
    const priceCents = Math.round(parsedPrice * 100);
    const parsedTrial = Number(trialDays);
    if (
      !Number.isInteger(parsedTrial) ||
      parsedTrial < 0 ||
      parsedTrial > 365
    ) {
      setError("Trial length must be between 0 and 365 days.");
      return;
    }

    try {
      await update.mutateAsync({
        data: {
          isActive,
          freeJobPostLimit: parsedFree,
          priceCents,
          currency,
          intervalDays,
          trialDays: parsedTrial,
        },
      });
      await queryClient.invalidateQueries({
        queryKey: getGetEmployerSubscriptionSettingsQueryKey(),
      });
      setSavedAt(new Date());
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save";
      setError(msg);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10 text-primary">
          <Briefcase className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Employer Job Posting Premium
          </h1>
          <p className="text-muted-foreground mt-1">
            Employers post a configurable number of jobs for free, then are
            prompted to subscribe to keep posting. Set the free quota,
            price, billing interval, and free-trial length.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
          <CardDescription>
            Changes take effect immediately for any new checkout. Existing
            paid subscriptions keep their current price until renewal.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="animate-pulse h-48 bg-muted rounded-lg" />
          ) : (
            <form onSubmit={onSubmit} className="space-y-6">
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <Label htmlFor="emp-sub-active" className="text-base">
                    Feature enabled
                  </Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    When off, all employers can post unlimited jobs for free
                    and the subscribe page is hidden.
                  </p>
                </div>
                <Switch
                  id="emp-sub-active"
                  checked={isActive}
                  onCheckedChange={setIsActive}
                  data-testid="switch-emp-sub-active"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="emp-free-limit">
                  Free job-post limit per employer
                </Label>
                <Input
                  id="emp-free-limit"
                  type="number"
                  min="0"
                  max="1000"
                  step="1"
                  value={freeJobPostLimit}
                  onChange={(e) => setFreeJobPostLimit(e.target.value)}
                  data-testid="input-emp-free-limit"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Number of jobs an employer can post before the paywall
                  kicks in. Set to 0 to require a subscription for the
                  very first post.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="emp-sub-price">Price per period</Label>
                  <Input
                    id="emp-sub-price"
                    type="number"
                    step="0.01"
                    min="0.50"
                    value={priceMajor}
                    onChange={(e) => setPriceMajor(e.target.value)}
                    data-testid="input-emp-sub-price"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="emp-sub-currency">Currency</Label>
                  <select
                    id="emp-sub-currency"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    data-testid="select-emp-sub-currency"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    {CURRENCY_OPTIONS.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="emp-sub-interval">Billing interval</Label>
                  <select
                    id="emp-sub-interval"
                    value={intervalDays}
                    onChange={(e) => setIntervalDays(Number(e.target.value))}
                    data-testid="select-emp-sub-interval"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    {INTERVAL_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="emp-sub-trial">Free trial (days)</Label>
                <Input
                  id="emp-sub-trial"
                  type="number"
                  min="0"
                  max="365"
                  step="1"
                  value={trialDays}
                  onChange={(e) => setTrialDays(e.target.value)}
                  data-testid="input-emp-sub-trial"
                  required
                />
                <p className="text-xs text-muted-foreground">
                  Set to 0 to disable the trial. When greater than 0, the
                  employer can start without entering a credit card.
                </p>
              </div>

              {error && (
                <div
                  className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                  data-testid="text-emp-sub-settings-error"
                >
                  <AlertCircle className="w-4 h-4 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
              {savedAt && !error && (
                <div
                  className="flex items-start gap-2 rounded-md border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-400"
                  data-testid="text-emp-sub-settings-saved"
                >
                  <CheckCircle2 className="w-4 h-4 mt-0.5" />
                  <span>Saved at {savedAt.toLocaleTimeString()}</span>
                </div>
              )}

              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={update.isPending}
                  data-testid="button-save-emp-sub-settings"
                >
                  <Save className="w-4 h-4 mr-2" />
                  {update.isPending ? "Saving..." : "Save changes"}
                </Button>
              </div>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
