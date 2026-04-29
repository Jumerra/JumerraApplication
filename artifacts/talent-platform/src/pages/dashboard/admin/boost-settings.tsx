import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetBoostSettings,
  useUpdateBoostSettings,
  getGetBoostSettingsQueryKey,
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
import { Rocket, Save, AlertCircle, CheckCircle2 } from "lucide-react";

const CURRENCY_OPTIONS = [
  { value: "usd", label: "USD" },
  { value: "eur", label: "EUR" },
  { value: "gbp", label: "GBP" },
  { value: "ngn", label: "NGN" },
  { value: "ghs", label: "GHS" },
  { value: "kes", label: "KES" },
  { value: "zar", label: "ZAR" },
];

export default function AdminBoostSettingsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useGetBoostSettings();
  const update = useUpdateBoostSettings();

  const [isActive, setIsActive] = useState(false);
  const [priceMajor, setPriceMajor] = useState("");
  const [currency, setCurrency] = useState("usd");
  const [durationDays, setDurationDays] = useState("7");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (!data || hydrated) return;
    setIsActive(data.isActive);
    setPriceMajor((data.priceCents / 100).toFixed(2));
    setCurrency(data.currency);
    setDurationDays(String(data.durationDays));
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
    const parsedDuration = Number(durationDays);
    if (
      !Number.isInteger(parsedDuration) ||
      parsedDuration < 1 ||
      parsedDuration > 365
    ) {
      setError("Duration must be between 1 and 365 days.");
      return;
    }

    try {
      await update.mutateAsync({
        data: {
          isActive,
          priceCents,
          currency,
          durationDays: parsedDuration,
        },
      });
      await queryClient.invalidateQueries({
        queryKey: getGetBoostSettingsQueryKey(),
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
          <Rocket className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Profile Boost</h1>
          <p className="text-muted-foreground mt-1">
            Set the price candidates pay to surface their profile to top
            employers, the boost duration, and whether the feature is offered.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
          <CardDescription>
            Changes take effect immediately for any new checkout. Active boosts
            already paid for keep their original duration.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="animate-pulse h-48 bg-muted rounded-lg" />
          ) : (
            <form onSubmit={onSubmit} className="space-y-6">
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <Label htmlFor="boost-active" className="text-base">
                    Feature enabled
                  </Label>
                  <p className="text-sm text-muted-foreground mt-1">
                    When off, candidates do not see the Boost option anywhere.
                  </p>
                </div>
                <Switch
                  id="boost-active"
                  checked={isActive}
                  onCheckedChange={setIsActive}
                  data-testid="switch-boost-active"
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="boost-price">Price</Label>
                  <Input
                    id="boost-price"
                    type="number"
                    step="0.01"
                    min="0.50"
                    value={priceMajor}
                    onChange={(e) => setPriceMajor(e.target.value)}
                    data-testid="input-boost-price"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="boost-currency">Currency</Label>
                  <select
                    id="boost-currency"
                    value={currency}
                    onChange={(e) => setCurrency(e.target.value)}
                    data-testid="select-boost-currency"
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
                  <Label htmlFor="boost-duration">Duration (days)</Label>
                  <Input
                    id="boost-duration"
                    type="number"
                    min="1"
                    max="365"
                    step="1"
                    value={durationDays}
                    onChange={(e) => setDurationDays(e.target.value)}
                    data-testid="input-boost-duration"
                    required
                  />
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
                  data-testid="button-save-boost-settings"
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
