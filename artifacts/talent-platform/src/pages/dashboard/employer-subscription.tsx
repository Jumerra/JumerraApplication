import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import {
  useGetEmployerSubscriptionSettings,
  useGetEmployerSubscription,
  useCreateEmployerSubscriptionCheckout,
  getGetEmployerSubscriptionSettingsQueryKey,
  getGetEmployerSubscriptionQueryKey,
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
  Briefcase,
  GraduationCap,
  Sparkles,
} from "lucide-react";
import { useGetEmployerSubscriptionLegacyStatus } from "@workspace/api-client-react";

/**
 * Banner is conditional on persisted migration state from the server:
 *   - hasLegacySubscription:false → no banner. Brand new employers
 *     who never subscribed don't get a misleading "we're cancelling
 *     your subscription" warning.
 *   - hasLegacySubscription:true && migratedAt:null → "we're going to
 *     cancel" pre-migration messaging.
 *   - hasLegacySubscription:true && migratedAt:not-null → "your sub
 *     has been cancelled at period end" post-migration messaging,
 *     with the actual end date if known.
 */
function LegacyDeprecationBannerGate() {
  const { data, isLoading } = useGetEmployerSubscriptionLegacyStatus();
  if (isLoading || !data || !data.hasLegacySubscription) return null;
  const migrated = !!data.migratedAt;
  const periodEnd = data.currentPeriodEnd
    ? new Date(data.currentPeriodEnd).toLocaleDateString()
    : null;
  return (
    <div
      className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
      data-testid="banner-employer-subscription-deprecated"
    >
      <div className="flex items-start gap-3">
        <Sparkles className="w-5 h-5 mt-0.5 shrink-0" />
        <div className="space-y-1 text-sm">
          <p className="font-semibold">
            Subscriptions are going away — all job posts are now free.
          </p>
          <p className="opacity-90">
            We've replaced the recurring subscription with one-shot per-job
            tiers. Free posts go live immediately. Pay only when you want
            to upgrade an individual job to{" "}
            <span className="font-medium">Promoted</span> or{" "}
            <span className="font-medium">Sponsored</span>.{" "}
            {migrated ? (
              <>
                Your recurring subscription has been set to cancel at the
                end of its current period
                {periodEnd ? ` (${periodEnd})` : ""} and will not
                auto-renew. You keep all your existing perks until then.
              </>
            ) : (
              <>
                Your active subscription will be cancelled at the end of
                its current period
                {periodEnd ? ` (${periodEnd})` : ""} and won't auto-renew.
              </>
            )}
          </p>
          <p>
            <Link
              href="/post-job"
              className="font-semibold underline underline-offset-2"
            >
              Post a job for free →
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

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

function intervalLabel(days: number): string {
  if (days === 7) return "week";
  if (days === 30) return "month";
  if (days === 90) return "quarter";
  if (days === 180) return "half-year";
  if (days === 365) return "year";
  return `${days} days`;
}

const FEATURES = [
  "Unlimited paid job postings (full-time, part-time, contract, remote)",
  "Reach the entire candidate pool",
  "Featured placement for premium employers",
  "Cancel any time from your dashboard",
];

export default function EmployerSubscriptionPage() {
  const { sessionUser, role, isLoading: authLoading } = useAuth();
  const employerId = sessionUser?.employerId ?? null;
  const isOwner = sessionUser?.orgRole === "owner";

  const { data: settings, isLoading: settingsLoading } =
    useGetEmployerSubscriptionSettings({
      query: {
        queryKey: getGetEmployerSubscriptionSettingsQueryKey(),
        enabled: !!sessionUser,
      },
    });
  const { data: status, isLoading: statusLoading } =
    useGetEmployerSubscription(employerId ?? 0, {
      query: {
        queryKey: getGetEmployerSubscriptionQueryKey(employerId ?? 0),
        enabled: !!employerId,
      },
    });
  const checkout = useCreateEmployerSubscriptionCheckout();
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const isEmployer = role === "employer";

  const subscribed = useMemo(
    () =>
      !!status &&
      (status.status === "trialing" || status.status === "active") &&
      status.hasActiveSubscription,
    [status],
  );

  const handleSubscribe = async () => {
    if (!employerId) return;
    setCheckoutError(null);
    const successUrl = `${window.location.origin}/employer-subscription/return?session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${window.location.origin}/dashboard/employer/subscription?cancelled=1`;
    try {
      const res = await checkout.mutateAsync({
        id: employerId,
        data: { successUrl, cancelUrl },
      });
      window.location.href = res.checkoutUrl;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Checkout failed";
      setCheckoutError(msg);
    }
  };

  if (authLoading || settingsLoading || (employerId && statusLoading)) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-3xl">
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (!isEmployer || !employerId) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-2xl">
        <Card>
          <CardContent className="p-8 text-center space-y-3">
            <Lock className="w-10 h-10 mx-auto text-muted-foreground" />
            <h1 className="text-xl font-semibold">Employer access required</h1>
            <p className="text-muted-foreground">
              This page is only available to employer staff signed in to
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
  const interval = settings ? intervalLabel(settings.intervalDays) : "month";
  const freeRemaining = status?.freeJobsRemaining ?? 0;
  const jobsPosted = status?.jobsPostedCount ?? 0;
  const freeQuota = status?.freeJobPostLimit ?? settings?.freeJobPostLimit ?? 0;

  return (
    <div className="container mx-auto px-4 py-10 max-w-3xl space-y-6">
      <LegacyDeprecationBannerGate />

      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10 text-primary">
          <Crown className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Job Posting Premium
          </h1>
          <p className="text-muted-foreground mt-1">
            Subscribe to keep posting jobs after your free quota.
          </p>
        </div>
      </div>

      {featureDisabled && (
        <Card data-testid="card-emp-sub-disabled">
          <CardContent className="p-6 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 mt-0.5 text-muted-foreground shrink-0" />
            <div>
              <h2 className="font-semibold">Subscriptions are currently unavailable</h2>
              <p className="text-sm text-muted-foreground mt-1">
                The platform admin has not enabled the premium subscription.
                You can post unlimited jobs at no cost while this is the case.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {!featureDisabled && (
        <Card data-testid="card-emp-quota">
          <CardContent className="p-6 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Briefcase className="w-4 h-4 text-muted-foreground" />
              <span>Your job posting quota</span>
            </div>
            <div className="text-2xl font-bold" data-testid="text-emp-quota">
              {jobsPosted} / {freeQuota} free paid posts used
            </div>
            <p className="text-sm text-muted-foreground">
              {subscribed
                ? "You currently have an active subscription — post as many jobs as you like."
                : freeRemaining > 0
                  ? `You can still post ${freeRemaining} more paid job${freeRemaining === 1 ? "" : "s"} before subscribing.`
                  : "You have used your free quota for paid postings. Subscribe to keep posting paid roles."}
            </p>
            <div
              className="mt-2 flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-200"
              data-testid="text-internship-free-note"
            >
              <GraduationCap className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>
                Internships are always free to post — they don't count
                against this quota and don't require a subscription.
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {!featureDisabled && subscribed && status && (
        <Card data-testid="card-emp-sub-active">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              {status.status === "trialing"
                ? "Free trial active"
                : "Subscription active"}
            </CardTitle>
            <CardDescription>
              You have unlimited job posting access.
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
                / {interval}
              </div>
            )}
            <div className="pt-2">
              <Button asChild>
                <Link href="/dashboard/employer">
                  Open dashboard
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {!featureDisabled && !subscribed && settings && (
        <Card data-testid="card-emp-sub-paywall">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Crown className="w-5 h-5 text-primary" />
              Upgrade to keep posting
            </CardTitle>
            <CardDescription>
              {settings.trialDays > 0
                ? `${interval[0].toUpperCase()}${interval.slice(1)}ly subscription with a ${settings.trialDays}-day free trial.`
                : `${interval[0].toUpperCase()}${interval.slice(1)}ly subscription.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="flex items-baseline gap-2">
              <span
                className="text-4xl font-bold"
                data-testid="text-emp-sub-price"
              >
                {formatPrice(settings.priceCents, settings.currency)}
              </span>
              <span className="text-muted-foreground">/ {interval}</span>
            </div>
            {settings.trialDays > 0 && (
              <p
                className="text-sm text-muted-foreground"
                data-testid="text-emp-sub-trial-line"
              >
                Start with a {settings.trialDays}-day free trial — no credit
                card required to begin. You can cancel any time.
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
                data-testid="text-emp-sub-checkout-error"
              >
                <AlertCircle className="w-4 h-4 mt-0.5" />
                <span>{checkoutError}</span>
              </div>
            )}

            {!isOwner && (
              <div className="flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm">
                <Lock className="w-4 h-4 mt-0.5 text-muted-foreground" />
                <span>
                  Only your employer owner can start a subscription. Ask
                  them to visit this page to subscribe.
                </span>
              </div>
            )}

            <Button
              size="lg"
              disabled={!isOwner || checkout.isPending}
              onClick={handleSubscribe}
              data-testid="button-emp-sub-subscribe"
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
