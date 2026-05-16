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
  Sparkles,
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

function intervalLabel(intervalDays: number): "month" | "year" {
  return intervalDays >= 365 ? "year" : "month";
}

type TierFeature = {
  label: string;
  description?: string;
  starter: boolean | string;
  pro: boolean | string;
};

const TIER_FEATURES: TierFeature[] = [
  {
    label: "Verified students",
    description: "Affiliate your students so employers trust their credentials.",
    starter: "Up to 100",
    pro: "Unlimited",
  },
  {
    label: "Faculties & departments",
    starter: "1 faculty, 3 departments",
    pro: "Unlimited",
  },
  {
    label: "Staff seats",
    starter: "2 seats",
    pro: "Unlimited",
  },
  {
    label: "Basic placement counter",
    starter: true,
    pro: true,
  },
  {
    label: "Full placement pipeline & employer leaderboard",
    description: "See exactly where your students are in every hiring funnel.",
    starter: false,
    pro: true,
  },
  {
    label: "Bulk roster verification",
    description: "Upload a CSV of your student list and verify in one go.",
    starter: false,
    pro: true,
  },
  {
    label: "Advanced placement analytics",
    description:
      "Time-to-hire, salary bands, year-over-year trends, employer mix by department.",
    starter: false,
    pro: true,
  },
  {
    label: "Exportable PDF reports",
    description: "Polished placement reports for your board and accreditation.",
    starter: false,
    pro: true,
  },
  {
    label: "Branded institution profile",
    description:
      "Public page with your logo, banner, programs and featured students.",
    starter: false,
    pro: true,
  },
  {
    label: "Priority placement in employer search",
    description:
      "Your verified students surface higher in employer search and Daily Picks.",
    starter: false,
    pro: true,
  },
  {
    label: "Email & in-app hire alerts",
    starter: false,
    pro: true,
  },
  {
    label: "SSO (Google Workspace, Microsoft)",
    starter: false,
    pro: true,
  },
  {
    label: "API access for SIS sync",
    starter: false,
    pro: true,
  },
];

function CheckMark() {
  return <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />;
}

function Dash() {
  return (
    <span
      className="inline-block w-4 h-4 text-center text-muted-foreground"
      aria-label="not included"
    >
      —
    </span>
  );
}

function FeatureCell({ value }: { value: boolean | string }) {
  if (value === true) return <CheckMark />;
  if (value === false) return <Dash />;
  return <span className="text-sm font-medium">{value}</span>;
}

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
      <div className="container mx-auto px-4 py-16 max-w-5xl">
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
  const cycle = settings ? intervalLabel(settings.intervalDays) : "month";

  return (
    <div className="container mx-auto px-4 py-10 max-w-5xl space-y-8">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10 text-primary">
          <Crown className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">
            Plans for your institution
          </h1>
          <p className="text-muted-foreground mt-1">
            Start free, upgrade when you want more reach and the full
            placement intelligence suite.
          </p>
        </div>
      </div>

      {featureDisabled && (
        <Card data-testid="card-sub-disabled" className="border-amber-300/60">
          <CardContent className="p-6 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 mt-0.5 text-amber-600 shrink-0" />
            <div>
              <h2 className="font-semibold">
                Institution Pro isn't available right now
              </h2>
              <p className="text-sm text-muted-foreground mt-1">
                The platform admin has not enabled paid subscriptions yet.
                While that's the case, your institution has full access to
                every Institution Pro feature for free.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {!featureDisabled && subscribed && status && (
        <Card data-testid="card-sub-active" className="border-green-500/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="w-5 h-5 text-green-600" />
              {status.status === "trialing"
                ? "Free trial active"
                : "Institution Pro active"}
            </CardTitle>
            <CardDescription>
              Every Institution Pro feature is unlocked for your team.
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
                / {status.intervalDaysSnapshot && status.intervalDaysSnapshot >= 365 ? "year" : "month"}
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

      {/* Tier comparison — always visible (even on Pro) so owners can see what they're getting */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Starter */}
        <Card data-testid="card-tier-starter">
          <CardHeader>
            <CardDescription className="uppercase text-xs tracking-wide">
              Starter
            </CardDescription>
            <CardTitle className="text-2xl">Free forever</CardTitle>
            <p className="text-sm text-muted-foreground">
              Everything you need to get on the platform and start verifying
              your first students.
            </p>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2 mb-6">
              <span className="text-4xl font-bold">$0</span>
              <span className="text-muted-foreground">/ {cycle}</span>
            </div>
            <ul className="space-y-2">
              {TIER_FEATURES.map((f) => (
                <li key={f.label} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5 shrink-0">
                    <FeatureCell value={f.starter} />
                  </span>
                  <span
                    className={
                      f.starter === false
                        ? "text-muted-foreground line-through"
                        : ""
                    }
                  >
                    {f.label}
                  </span>
                </li>
              ))}
            </ul>
            <Button
              variant="outline"
              className="w-full mt-6"
              disabled
              data-testid="button-starter-current"
            >
              {subscribed ? "Downgraded" : "Your current plan"}
            </Button>
          </CardContent>
        </Card>

        {/* Pro */}
        <Card
          data-testid="card-tier-pro"
          className="border-2 border-primary shadow-lg relative"
        >
          <div className="absolute -top-3 left-1/2 -translate-x-1/2">
            <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-amber-400 to-amber-600 px-3 py-1 text-xs font-bold uppercase tracking-wide text-white shadow">
              <Sparkles className="w-3 h-3" />
              Recommended
            </span>
          </div>
          <CardHeader>
            <CardDescription className="uppercase text-xs tracking-wide text-primary">
              Institution Pro
            </CardDescription>
            <CardTitle className="text-2xl">
              The full placement intelligence suite
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              For institutions that care about real placement outcomes,
              employer relationships, and reporting that actually moves
              the needle.
            </p>
          </CardHeader>
          <CardContent>
            <div className="flex items-baseline gap-2 mb-1">
              <span
                className="text-4xl font-bold"
                data-testid="text-sub-price"
              >
                {settings
                  ? formatPrice(settings.priceCents, settings.currency)
                  : "—"}
              </span>
              <span className="text-muted-foreground">/ {cycle}</span>
            </div>
            {settings && settings.trialDays > 0 && (
              <p
                className="text-sm text-muted-foreground mb-5"
                data-testid="text-sub-trial-line"
              >
                Start with a {settings.trialDays}-day free trial. You can
                cancel any time.
              </p>
            )}
            {settings && settings.trialDays === 0 && (
              <p className="text-sm text-muted-foreground mb-5">
                Cancel any time.
              </p>
            )}
            <ul className="space-y-2">
              {TIER_FEATURES.map((f) => (
                <li key={f.label} className="flex items-start gap-2 text-sm">
                  <span className="mt-0.5 shrink-0">
                    <FeatureCell value={f.pro} />
                  </span>
                  <div>
                    <div>{f.label}</div>
                    {f.description && (
                      <div className="text-xs text-muted-foreground">
                        {f.description}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {checkoutError && (
              <div
                className="mt-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
                data-testid="text-sub-checkout-error"
              >
                <AlertCircle className="w-4 h-4 mt-0.5" />
                <span>{checkoutError}</span>
              </div>
            )}

            {!isOwner && !subscribed && !featureDisabled && (
              <div className="mt-4 flex items-start gap-2 rounded-md border bg-muted/40 p-3 text-sm">
                <Lock className="w-4 h-4 mt-0.5 text-muted-foreground" />
                <span>
                  Only your institution owner can start a subscription. Ask
                  them to visit this page to subscribe.
                </span>
              </div>
            )}

            {subscribed ? (
              <Button
                className="w-full mt-6"
                disabled
                data-testid="button-pro-current"
              >
                <CheckCircle2 className="w-4 h-4 mr-2" />
                Your current plan
              </Button>
            ) : featureDisabled ? (
              <Button
                className="w-full mt-6"
                disabled
                data-testid="button-pro-disabled"
              >
                Unavailable — admin hasn't enabled paid plans
              </Button>
            ) : (
              <Button
                size="lg"
                className="w-full mt-6"
                disabled={!isOwner || !settings || checkout.isPending}
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
                    {settings && settings.trialDays > 0
                      ? `Start ${settings.trialDays}-day free trial`
                      : "Upgrade to Institution Pro"}
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </>
                )}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="text-xs text-muted-foreground text-center">
        Pricing and trial length are set by the platform admin and may
        change. Existing subscriptions keep their original price until
        renewal.
      </p>
    </div>
  );
}
