import { useState } from "react";
import {
  useGetCandidate,
  getGetCandidateQueryKey,
} from "@workspace/api-client-react";
import {
  useGetBoostSettings,
  useCreateBoostCheckout,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Rocket, AlertCircle, CheckCircle2 } from "lucide-react";

function formatPrice(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

function formatDate(d: Date) {
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function BoostCard({ candidateId }: { candidateId: number }) {
  const { data: settings, isLoading: settingsLoading } = useGetBoostSettings();
  const { data: candidate } = useGetCandidate(candidateId, {
    query: {
      enabled: candidateId > 0,
      queryKey: getGetCandidateQueryKey(candidateId),
    },
  });
  const createCheckout = useCreateBoostCheckout();
  const [error, setError] = useState<string | null>(null);

  if (settingsLoading || !settings) return null;

  const expiresAtRaw = (candidate as { boostExpiresAt?: string | null } | undefined)
    ?.boostExpiresAt;
  const expiresAt = expiresAtRaw ? new Date(expiresAtRaw) : null;
  const isCurrentlyBoosted = expiresAt ? expiresAt.getTime() > Date.now() : false;

  // Hide the card when the feature is disabled AND the candidate has no
  // active boost. If they're still inside a boost they paid for earlier,
  // keep showing the entitlement so they can see when it ends.
  if (!settings.isActive && !isCurrentlyBoosted) return null;

  const onBoost = async () => {
    setError(null);
    try {
      const origin = window.location.origin;
      const result = await createCheckout.mutateAsync({
        id: candidateId,
        data: {
          successUrl: `${origin}/boost/return?session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${origin}/dashboard/candidate`,
        },
      });
      window.location.href = result.checkoutUrl;
    } catch (err) {
      const raw =
        err instanceof Error ? err.message : "Failed to start checkout";
      setError(raw.replace(/^HTTP \d+ [^:]+: /, ""));
    }
  };

  return (
    <Card className="shadow-sm border-primary/30 bg-gradient-to-r from-primary/5 to-transparent">
      <CardContent className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-lg bg-primary/10 text-primary shrink-0">
            <Rocket className="w-6 h-6" />
          </div>
          <div>
            {isCurrentlyBoosted ? (
              <>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold">Profile boosted</h3>
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Your profile is being shown to top employers until {" "}
                  <span className="font-medium text-foreground">
                    {formatDate(expiresAt!)}
                  </span>
                  .
                </p>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold">Boost your profile</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Surface your profile to top employers for {settings.durationDays} days for {" "}
                  <span className="font-semibold text-foreground">
                    {formatPrice(settings.priceCents, settings.currency)}
                  </span>
                  .
                </p>
              </>
            )}
            {error && (
              <div className="flex items-start gap-2 mt-3 text-sm text-destructive">
                <AlertCircle className="w-4 h-4 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
          </div>
        </div>
        {settings.isActive && (
          <div className="flex md:justify-end">
            <Button
              onClick={onBoost}
              disabled={createCheckout.isPending}
              data-testid="button-boost-profile"
            >
              <Rocket className="w-4 h-4 mr-2" />
              {createCheckout.isPending
                ? "Redirecting..."
                : isCurrentlyBoosted
                  ? "Extend boost"
                  : "Boost now"}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
