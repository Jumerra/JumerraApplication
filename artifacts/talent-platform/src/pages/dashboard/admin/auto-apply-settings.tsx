import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAutoApplySettings,
  useUpdateAutoApplySettings,
  getGetAutoApplySettingsQueryKey,
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
import { Wand2, Save, AlertCircle, CheckCircle2 } from "lucide-react";

const CURRENCY_OPTIONS = [
  { value: "usd", label: "USD" },
  { value: "eur", label: "EUR" },
  { value: "gbp", label: "GBP" },
  { value: "ngn", label: "NGN" },
  { value: "ghs", label: "GHS" },
  { value: "kes", label: "KES" },
  { value: "zar", label: "ZAR" },
];

export default function AdminAutoApplySettingsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useGetAutoApplySettings();
  const update = useUpdateAutoApplySettings();

  const [isActive, setIsActive] = useState(false);
  const [priceMajor, setPriceMajor] = useState("");
  const [currency, setCurrency] = useState("ngn");
  const [intervalDays, setIntervalDays] = useState("30");
  const [matchThreshold, setMatchThreshold] = useState("80");
  const [dailyCap, setDailyCap] = useState("10");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!data || hydrated) return;
    setIsActive(data.isActive);
    setPriceMajor((data.priceCents / 100).toFixed(2));
    setCurrency(data.currency);
    setIntervalDays(String(data.intervalDays));
    setMatchThreshold(String(data.matchThreshold));
    setDailyCap(String(data.dailyCap));
    setHydrated(true);
  }, [data, hydrated]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSavedAt(null);

    const parsedPrice = Number(priceMajor);
    if (!Number.isFinite(parsedPrice) || parsedPrice < 0.5) {
      setError("Price must be at least 0.50.");
      return;
    }
    const priceCents = Math.round(parsedPrice * 100);
    const parsedInterval = Number(intervalDays);
    if (
      !Number.isInteger(parsedInterval) ||
      parsedInterval < 1 ||
      parsedInterval > 365
    ) {
      setError("Billing interval must be between 1 and 365 days.");
      return;
    }
    const parsedThreshold = Number(matchThreshold);
    if (
      !Number.isInteger(parsedThreshold) ||
      parsedThreshold < 1 ||
      parsedThreshold > 100
    ) {
      setError("Match threshold must be between 1 and 100.");
      return;
    }
    const parsedCap = Number(dailyCap);
    if (!Number.isInteger(parsedCap) || parsedCap < 1 || parsedCap > 100) {
      setError("Daily cap must be between 1 and 100.");
      return;
    }

    try {
      await update.mutateAsync({
        data: {
          isActive,
          priceCents,
          currency,
          intervalDays: parsedInterval,
          matchThreshold: parsedThreshold,
          dailyCap: parsedCap,
        },
      });
      await queryClient.invalidateQueries({
        queryKey: getGetAutoApplySettingsQueryKey(),
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
          <Wand2 className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">AI Auto-Apply</h1>
          <p className="text-muted-foreground mt-1">
            Set the subscription price, billing cycle, and the matching rules
            that decide when the platform applies to jobs on a candidate's
            behalf. The global switch turns the entire feature on or off.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
          <CardDescription>
            Changes take effect immediately. When the feature is off, no
            candidate can subscribe and the engine submits nothing — even for
            candidates who already paid.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="animate-pulse h-48 bg-muted rounded-lg" />
          ) : (
            <form onSubmit={onSubmit} className="space-y-6">
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <Label htmlFor="aa-active" className="text-base">
                    Feature enabled
                  </Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    Master switch. When off, Auto-Apply is hidden from
                    candidates and the engine never runs.
                  </p>
                </div>
                <Switch
                  id="aa-active"
                  checked={isActive}
                  onCheckedChange={setIsActive}
                  data-testid="switch-auto-apply-active"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="aa-price">Price</Label>
                  <Input
                    id="aa-price"
                    type="number"
                    step="0.01"
                    min="0.50"
                    value={priceMajor}
                    onChange={(e) => setPriceMajor(e.target.value)}
                    data-testid="input-auto-apply-price"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="aa-currency">Currency</Label>
                  <select
                    id="aa-currency"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    data-testid="select-auto-apply-currency"
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
                  <Label htmlFor="aa-interval">Billing cycle (days)</Label>
                  <Input
                    id="aa-interval"
                    type="number"
                    min="1"
                    max="365"
                    step="1"
                    value={intervalDays}
                    onChange={(e) => setIntervalDays(e.target.value)}
                    data-testid="input-auto-apply-interval"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="aa-threshold">Match threshold (1–100)</Label>
                  <Input
                    id="aa-threshold"
                    type="number"
                    min="1"
                    max="100"
                    step="1"
                    value={matchThreshold}
                    onChange={(e) => setMatchThreshold(e.target.value)}
                    data-testid="input-auto-apply-threshold"
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Only jobs scoring at or above this match auto-apply.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="aa-cap">Daily cap per candidate</Label>
                  <Input
                    id="aa-cap"
                    type="number"
                    min="1"
                    max="100"
                    step="1"
                    value={dailyCap}
                    onChange={(e) => setDailyCap(e.target.value)}
                    data-testid="input-auto-apply-cap"
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Max auto-submissions per candidate in any rolling 24 hours.
                  </p>
                </div>
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  <AlertCircle className="w-4 h-4 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
              {savedAt && !error && (
                <div className="flex items-start gap-2 rounded-md border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-400">
                  <CheckCircle2 className="w-4 h-4 mt-0.5" />
                  <span>Saved at {savedAt.toLocaleTimeString()}</span>
                </div>
              )}

              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={update.isPending}
                  data-testid="button-save-auto-apply-settings"
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
