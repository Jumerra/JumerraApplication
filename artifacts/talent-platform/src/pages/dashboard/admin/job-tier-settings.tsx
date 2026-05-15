import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetJobTierSettings,
  useUpdateJobTierSettings,
  getGetJobTierSettingsQueryKey,
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
import { Megaphone, Star, Save, AlertCircle, CheckCircle2 } from "lucide-react";

const CURRENCY_OPTIONS = [
  { value: "usd", label: "USD" },
  { value: "eur", label: "EUR" },
  { value: "gbp", label: "GBP" },
  { value: "ngn", label: "NGN" },
  { value: "ghs", label: "GHS" },
  { value: "kes", label: "KES" },
  { value: "zar", label: "ZAR" },
];

export default function AdminJobTierSettingsPage() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useGetJobTierSettings();
  const update = useUpdateJobTierSettings();

  const [promotedActive, setPromotedActive] = useState(true);
  const [promotedPriceMajor, setPromotedPriceMajor] = useState("29.00");
  const [promotedCurrency, setPromotedCurrency] = useState("usd");
  const [promotedDuration, setPromotedDuration] = useState("30");
  const [sponsoredActive, setSponsoredActive] = useState(true);
  const [sponsoredPriceMajor, setSponsoredPriceMajor] = useState("99.00");
  const [sponsoredCurrency, setSponsoredCurrency] = useState("usd");
  const [sponsoredDuration, setSponsoredDuration] = useState("30");
  const [pushCap, setPushCap] = useState("200");
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  useEffect(() => {
    if (!data || hydrated) return;
    setPromotedActive(data.promotedActive);
    setPromotedPriceMajor((data.promotedPriceCents / 100).toFixed(2));
    setPromotedCurrency(data.promotedCurrency);
    setPromotedDuration(String(data.promotedDurationDays));
    setSponsoredActive(data.sponsoredActive);
    setSponsoredPriceMajor((data.sponsoredPriceCents / 100).toFixed(2));
    setSponsoredCurrency(data.sponsoredCurrency);
    setSponsoredDuration(String(data.sponsoredDurationDays));
    setPushCap(String(data.sponsoredPushCap));
    setHydrated(true);
  }, [data, hydrated]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSavedAt(null);

    const promotedCents = Math.round(Number(promotedPriceMajor) * 100);
    const sponsoredCents = Math.round(Number(sponsoredPriceMajor) * 100);
    const promotedDays = Number(promotedDuration);
    const sponsoredDays = Number(sponsoredDuration);
    const cap = Number(pushCap);

    if (
      !Number.isFinite(promotedCents) ||
      promotedCents < 50 ||
      !Number.isFinite(sponsoredCents) ||
      sponsoredCents < 50
    ) {
      setError("Prices must be at least 0.50.");
      return;
    }
    if (
      !Number.isInteger(promotedDays) ||
      promotedDays < 1 ||
      promotedDays > 365 ||
      !Number.isInteger(sponsoredDays) ||
      sponsoredDays < 1 ||
      sponsoredDays > 365
    ) {
      setError("Duration must be between 1 and 365 days.");
      return;
    }
    if (!Number.isInteger(cap) || cap < 0 || cap > 100000) {
      setError("Push cap must be between 0 and 100000.");
      return;
    }

    try {
      await update.mutateAsync({
        data: {
          promotedActive,
          promotedPriceCents: promotedCents,
          promotedCurrency,
          promotedDurationDays: promotedDays,
          sponsoredActive,
          sponsoredPriceCents: sponsoredCents,
          sponsoredCurrency,
          sponsoredDurationDays: sponsoredDays,
          sponsoredPushCap: cap,
        },
      });
      await queryClient.invalidateQueries({
        queryKey: getGetJobTierSettingsQueryKey(),
      });
      setSavedAt(new Date());
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to save";
      setError(msg);
    }
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Per-Job Pricing Tiers
        </h1>
        <p className="text-muted-foreground mt-1">
          All job postings are free by default. Employers can pay one-shot to
          upgrade individual jobs to Promoted (better ranking) or Sponsored
          (top ranking + active push to candidates).
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Configuration</CardTitle>
          <CardDescription>
            Changes apply to new checkouts immediately. Existing paid tiers
            keep their original duration and price.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="animate-pulse h-48 bg-muted rounded-lg" />
          ) : (
            <form onSubmit={onSubmit} className="space-y-8">
              <section className="space-y-4">
                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div className="flex items-center gap-3">
                    <Megaphone className="w-5 h-5 text-primary" />
                    <div>
                      <Label className="text-base">Promoted tier</Label>
                      <p className="text-sm text-muted-foreground mt-1">
                        Ranks above Free in the candidate feed.
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={promotedActive}
                    onCheckedChange={setPromotedActive}
                    data-testid="switch-promoted-active"
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="prom-price">Price</Label>
                    <Input
                      id="prom-price"
                      type="number"
                      step="0.01"
                      min="0.50"
                      value={promotedPriceMajor}
                      onChange={(e) => setPromotedPriceMajor(e.target.value)}
                      data-testid="input-promoted-price"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="prom-currency">Currency</Label>
                    <select
                      id="prom-currency"
                      value={promotedCurrency}
                      onChange={(e) => setPromotedCurrency(e.target.value)}
                      data-testid="select-promoted-currency"
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
                    <Label htmlFor="prom-duration">Duration (days)</Label>
                    <Input
                      id="prom-duration"
                      type="number"
                      min="1"
                      max="365"
                      step="1"
                      value={promotedDuration}
                      onChange={(e) => setPromotedDuration(e.target.value)}
                      data-testid="input-promoted-duration"
                    />
                  </div>
                </div>
              </section>

              <section className="space-y-4">
                <div className="flex items-center justify-between rounded-lg border p-4">
                  <div className="flex items-center gap-3">
                    <Star className="w-5 h-5 text-primary" />
                    <div>
                      <Label className="text-base">Sponsored tier</Label>
                      <p className="text-sm text-muted-foreground mt-1">
                        Top placement and an in-app notification push to
                        matching candidates.
                      </p>
                    </div>
                  </div>
                  <Switch
                    checked={sponsoredActive}
                    onCheckedChange={setSponsoredActive}
                    data-testid="switch-sponsored-active"
                  />
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="sp-price">Price</Label>
                    <Input
                      id="sp-price"
                      type="number"
                      step="0.01"
                      min="0.50"
                      value={sponsoredPriceMajor}
                      onChange={(e) => setSponsoredPriceMajor(e.target.value)}
                      data-testid="input-sponsored-price"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="sp-currency">Currency</Label>
                    <select
                      id="sp-currency"
                      value={sponsoredCurrency}
                      onChange={(e) => setSponsoredCurrency(e.target.value)}
                      data-testid="select-sponsored-currency"
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
                    <Label htmlFor="sp-duration">Duration (days)</Label>
                    <Input
                      id="sp-duration"
                      type="number"
                      min="1"
                      max="365"
                      step="1"
                      value={sponsoredDuration}
                      onChange={(e) => setSponsoredDuration(e.target.value)}
                      data-testid="input-sponsored-duration"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="sp-cap">Push cap (per job, max)</Label>
                  <Input
                    id="sp-cap"
                    type="number"
                    min="0"
                    max="100000"
                    step="1"
                    value={pushCap}
                    onChange={(e) => setPushCap(e.target.value)}
                    data-testid="input-sponsored-push-cap"
                  />
                  <p className="text-xs text-muted-foreground">
                    Maximum number of unique candidates a single Sponsored
                    job will be pushed to over its lifetime. Per-candidate
                    daily cap is hard-coded to 3 to prevent inbox spam.
                  </p>
                </div>
              </section>

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
                  data-testid="button-save-job-tier-settings"
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
