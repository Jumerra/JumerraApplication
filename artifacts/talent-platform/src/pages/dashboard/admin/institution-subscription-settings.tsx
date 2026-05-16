import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetInstitutionSubscriptionSettings,
  useUpdateInstitutionSubscriptionSettings,
  getGetInstitutionSubscriptionSettingsQueryKey,
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
import { Crown, Save, AlertCircle, CheckCircle2 } from "lucide-react";

const CURRENCY_OPTIONS = [
  { value: "usd", label: "USD" },
  { value: "eur", label: "EUR" },
  { value: "gbp", label: "GBP" },
  { value: "ngn", label: "NGN" },
  { value: "ghs", label: "GHS" },
  { value: "kes", label: "KES" },
  { value: "zar", label: "ZAR" },
];

export default function AdminInstitutionSubscriptionSettingsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useGetInstitutionSubscriptionSettings();
  const update = useUpdateInstitutionSubscriptionSettings();

  const [isActive, setIsActive] = useState(false);
  const [priceMajor, setPriceMajor] = useState("");
  const [currency, setCurrency] = useState("usd");
  const [intervalDays, setIntervalDays] = useState<30 | 365>(30);
  const [trialDays, setTrialDays] = useState("14");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!data || hydrated) return;
    setIsActive(data.isActive);
    setPriceMajor((data.priceCents / 100).toFixed(2));
    setCurrency(data.currency);
    setIntervalDays((data.intervalDays === 365 ? 365 : 30) as 30 | 365);
    setTrialDays(String(data.trialDays));
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
          priceCents,
          currency,
          intervalDays,
          trialDays: parsedTrial,
        },
      });
      await queryClient.invalidateQueries({
        queryKey: getGetInstitutionSubscriptionSettingsQueryKey(),
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
          <Crown className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Institution Pro Subscription
          </h1>
          <p className="text-muted-foreground mt-1">
            Premium plan that unlocks the full Institution Pro feature
            set — placements, bulk verification, advanced analytics,
            branded profile, priority placement and more. Set the
            price, billing cycle and free-trial length below.
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
                  <Label htmlFor="sub-active" className="text-base">
                    Feature enabled
                  </Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    When off, all institutions get every premium feature
                    for free and the subscribe page is hidden.
                  </p>
                </div>
                <Switch
                  id="sub-active"
                  checked={isActive}
                  onCheckedChange={setIsActive}
                  data-testid="switch-sub-active"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="sub-interval">Billing cycle</Label>
                  <select
                    id="sub-interval"
                    value={intervalDays}
                    onChange={(e) =>
                      setIntervalDays(Number(e.target.value) as 30 | 365)
                    }
                    data-testid="select-sub-interval"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    <option value={30}>Monthly</option>
                    <option value={365}>Yearly</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sub-trial">Free trial (days)</Label>
                  <Input
                    id="sub-trial"
                    type="number"
                    min="0"
                    max="365"
                    step="1"
                    value={trialDays}
                    onChange={(e) => setTrialDays(e.target.value)}
                    data-testid="input-sub-trial"
                    required
                  />
                  <p className="text-xs text-muted-foreground">
                    Set to 0 to disable the trial.
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="sub-price">
                    Price per {intervalDays === 365 ? "year" : "month"}
                  </Label>
                  <Input
                    id="sub-price"
                    type="number"
                    step="0.01"
                    min="0.50"
                    value={priceMajor}
                    onChange={(e) => setPriceMajor(e.target.value)}
                    data-testid="input-sub-price"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sub-currency">Currency</Label>
                  <select
                    id="sub-currency"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    data-testid="select-sub-currency"
                    className="h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  >
                    {CURRENCY_OPTIONS.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {error && (
                <div
                  className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                  data-testid="text-sub-settings-error"
                >
                  <AlertCircle className="w-4 h-4 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}
              {savedAt && !error && (
                <div
                  className="flex items-start gap-2 rounded-md border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-400"
                  data-testid="text-sub-settings-saved"
                >
                  <CheckCircle2 className="w-4 h-4 mt-0.5" />
                  <span>Saved at {savedAt.toLocaleTimeString()}</span>
                </div>
              )}

              <div className="flex justify-end">
                <Button
                  type="submit"
                  disabled={update.isPending}
                  data-testid="button-save-sub-settings"
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
