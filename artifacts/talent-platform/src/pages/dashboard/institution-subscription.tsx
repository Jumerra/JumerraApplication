import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import {
  useGetInstitutionSubscriptionSettings,
  useGetInstitutionSubscription,
  useCreateInstitutionSubscriptionCheckout,
  getGetInstitutionSubscriptionSettingsQueryKey,
  getGetInstitutionSubscriptionQueryKey,
} from "@workspace/api-client-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Crown,
  CheckCircle2,
  Lock,
  AlertCircle,
  Loader2,
  ArrowRight,
  Calendar,
} from "lucide-react";

function formatPrice(cents: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: currency.toUpperCase(),
      maximumFractionDigits: 2,
    }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

const FEATURES = [
  "Full visibility into every student placement",
  "Live employer hiring leaderboard for your institution",
  "Status breakdown across the placement pipeline",
  "Recent hires feed with employer + match data",
  "All future placement analytics included at no extra cost",
];

export default function InstitutionSubscriptionPage() {
  const { sessionUser, role, isLoading: authLoading } = useAuth();
  const institutionId = sessionUser?.institutionId ?? null;
  const isOwner = sessionUser?.orgRole === "owner";

  const { data: settings, isLoading: settingsLoading } =
    useGetInstitutionSubscriptionSettings({
      query: {
        queryKey: getGetInstitutionSubscriptionSettingsQueryKey(),
        enabled: !!sessionUser,
      },
    });
  const { data: status, isLoading: statusLoading } =
    useGetInstitutionSubscription(institutionId ?? 0, {
      query: {
        queryKey: getGetInstitutionSubscriptionQueryKey(institutionId ?? 0),
        enabled: !!institutionId,
      },
    });
  const checkout = useCreateInstitutionSubscriptionCheckout();
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const isInstitution = role === "institution";

  const subscribed = useMemo(
    () =>
      !!status &&
      (status.status === "trialing" || status.status === "active") &&
      status.unlocksPlacements,
    [status],
  );

  const handleSubscribe = async () => {
    if (!institutionId) return;
    setCheckoutError(null);
    const successUrl = `${window.location.origin}/institution-subscription/return?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${window.location.origin}/dashboard/institution/subscription?cancelled=1`;
    try {
      const res = await checkout.mutateAsync({
        id: institutionId,
        data: { successUrl, cancelUrl },
      });
      window.location.href = res.checkoutUrl;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Checkout failed";
      setCheckoutError(msg);
    }
  };

  if (authLoading || settingsLoading || (institutionId && statusLoading)) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-3xl">
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!isInstitution || !institutionId) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-2xl">
        <Card>
          <CardContent className="p-8 text-center space-y-3">
            <Lock className="w-10 h-10 mx-auto text-muted-foreground" />
            <h1 className="text-xl font-semibold">Institution access required</h1>
            <p className="text-muted-foreground">
              This page is only available to institution staff signed in to
              their organisation.
            </p>
            <Button asChild variant="outline">
              <Link href="/dashboard">Back to dashboard</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const featureDisabled = !settings?.isActive;

  return (
    <div className="container mx-auto px-4 py-10 max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10 text-primary">
          <Crown className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Premium Institution Subscription
          </h1>
          <p className="text-muted-foreground mt-1">
            Unlock full candidate placement access for your institution.
          </p>
        </div>
      </div>

      {featureDisabled && (
        <Card data-testid="card-sub-disabled">
          <CardContent className="p-6 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 mt-0.5 text-muted-foreground shrink-0" />
            <div>
              <h2 className="font-semibold">Subscriptions are currently unavailable</h2>
              <p className="text-sm text-muted-foreground mt-1">
                The platform admin has not enabled the premium subscription.
                Placement data is fully accessible without a subscription
                while this is the case.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {!featureDisabled && subscribed && status && (
        <Card data-testid="card-sub-active">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              {status.status === "trialing"
                ? "Free trial active"
                : "Subscription active"}
            </CardTitle>
            <CardDescription>
              Your institution has full access to candidate placement data.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {status.isInTrial && status.trialEndsAt && (
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                <span>
                  Trial ends on{" "}
                  <span className="font-medium">
                    {new Date(status.trialEndsAt).toLocaleDateString()}
                  </span>
                  . You won't be charged until then.
                </span>
              </div>
            )}
            {status.currentPeriodEnd && (
              <div className="flex items-center gap-2 text-sm">
                <Calendar className="w-4 h-4 text-muted-foreground" />
                <span>
                  Renews on{" "}
                  <span className="font-medium">
                    {new Date(status.currentPeriodEnd).toLocaleDateString()}
                  </span>
                  .
                </span>
              </div>
            )}
            {status.priceCentsSnapshot != null && status.currencySnapshot && (
              <div className="text-sm text-muted-foreground">
                Plan price:{" "}
                <span className="font-medium text-foreground">
                  {formatPrice(
                    status.priceCentsSnapshot,
                    status.currencySnapshot,
                  )}
                </span>{" "}
                / year
              </div>
            )}
            <div className="pt-2">
              <Button asChild>
                <Link href="/dashboard/institution">
                  Open dashboard
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!featureDisabled && !subscribed && settings && (
        <Card data-testid="card-sub-paywall">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Crown className="w-5 h-5 text-primary" />
              Upgrade to access placements
            </CardTitle>
            <CardDescription>
              Yearly subscription{settings.trialDays > 0 ? ` with a ${settings.trialDays}-day free trial` : ""}.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-baseline gap-2">
              <span
                className="text-4xl font-bold"
                data-testid="text-sub-price"
              >
                {formatPrice(settings.priceCents, settings.currency)}
              </span>
              <span className="text-muted-foreground">/ year</span>
            </div>
            {settings.trialDays > 0 && (
              <p className="text-sm text-muted-foreground" data-testid="text-sub-trial-line">
                Start with a {settings.trialDays}-day free trial. You won't be
                charged until the trial ends, and you can cancel any time.
              </p>
            )}
            <ul className="space-y-2">
              {FEATURES.map((f) => (
                <li
                  key={f}
                  className="flex items-start gap-2 text-sm"
                >
                  <CheckCircle2 className="w-4 h-4 mt-0.5 text-green-600 shrink-0" />
                  <span>{f}</span>
                </li>
              ))}
            </ul>

            {checkoutError && (
              <div
                className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                data-testid="text-sub-checkout-error"
              >
                <AlertCircle className="w-4 h-4 mt-0.5" />
                <span>{checkoutError}</span>
              </div>
            )}

            {!isOwner && (
              <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm">
                <Lock className="w-4 h-4 mt-0.5 text-muted-foreground" />
                <span>
                  Only your institution owner can start a subscription. Ask
                  them to visit this page to subscribe.
                </span>
              </div>
            )}

            <Button
              size="lg"
              disabled={!isOwner || checkout.isPending}
              onClick={handleSubscribe}
              data-testid="button-sub-subscribe"
            >
              {checkout.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Redirecting to Stripe...
                </>
              ) : (
                <>
                  {settings.trialDays > 0
                    ? "Start free trial"
                    : "Subscribe now"}
                  <ArrowRight className="w-4 h-4 ml-2" />
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
