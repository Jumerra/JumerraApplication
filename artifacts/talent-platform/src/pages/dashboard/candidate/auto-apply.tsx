import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetAutoApplyStatus,
  useToggleAutoApply,
  useCreateAutoApplyCheckout,
  useListAutoApplyActivity,
  getGetAutoApplyStatusQueryKey,
  getListAutoApplyActivityQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Wand2,
  AlertCircle,
  CheckCircle2,
  Clock,
  ArrowRight,
  Sparkles,
} from "lucide-react";

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

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function CandidateAutoApplyPage() {
  const { sessionUser } = useAuth();
  const candidateId = sessionUser?.candidateId ?? 0;
  const queryClient = useQueryClient();

  const { data: status, isLoading } = useGetAutoApplyStatus(candidateId, {
    query: {
      enabled: candidateId > 0,
      queryKey: getGetAutoApplyStatusQueryKey(candidateId),
    },
  });
  const { data: activity } = useListAutoApplyActivity(candidateId, {
    query: {
      enabled: candidateId > 0,
      queryKey: getListAutoApplyActivityQueryKey(candidateId),
    },
  });
  const toggle = useToggleAutoApply();
  const checkout = useCreateAutoApplyCheckout();
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    await queryClient.invalidateQueries({
      queryKey: getGetAutoApplyStatusQueryKey(candidateId),
    });
  };

  const onToggle = async (next: boolean) => {
    setError(null);
    try {
      await toggle.mutateAsync({ id: candidateId, data: { enabled: next } });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update setting");
    }
  };

  const onSubscribe = async () => {
    setError(null);
    try {
      const origin = window.location.origin;
      const result = await checkout.mutateAsync({
        id: candidateId,
        data: {
          successUrl: `${origin}/auto-apply/return?session_id={CHECKOUT_SESSION_ID}`,
          cancelUrl: `${origin}/dashboard/candidate/auto-apply`,
        },
      });
      window.location.href = result.checkoutUrl;
    } catch (err) {
      const raw =
        err instanceof Error ? err.message : "Failed to start checkout";
      setError(raw.replace(/^HTTP \d+ [^:]+: /, ""));
    }
  };

  if (candidateId <= 0) {
    return (
      <div className="container mx-auto px-4 py-16 max-w-xl text-center">
        <p className="text-muted-foreground">
          Sign in with a candidate account to manage AI Auto-Apply.
        </p>
      </div>
    );
  }

  const settings = status?.settings;
  const featureOff = !isLoading && settings && !settings.isActive;
  const subActive = status?.subscriptionActive ?? false;
  const enabled = status?.enabled ?? false;
  const periodEnd = status?.subscription?.currentPeriodEnd ?? null;

  return (
    <div className="container mx-auto px-4 py-8 max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10 text-primary">
          <Wand2 className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-3xl font-bold tracking-tight">AI Auto-Apply</h1>
          <p className="text-muted-foreground mt-1">
            Let Jumerra automatically submit your application to new jobs that
            strongly match your profile — so you never miss a great opening.
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="w-4 h-4 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {isLoading ? (
        <div className="animate-pulse h-48 bg-muted rounded-lg" />
      ) : featureOff ? (
        <Card>
          <CardContent className="p-8 text-center text-muted-foreground">
            AI Auto-Apply isn't available right now. Check back soon.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Subscription
                {subActive && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-xs font-medium text-green-700 dark:text-green-400">
                    <CheckCircle2 className="w-3 h-3" /> Active
                  </span>
                )}
              </CardTitle>
              <CardDescription>
                {settings &&
                  `${formatPrice(settings.priceCents, settings.currency)} every ${settings.intervalDays} days. Cancel anytime.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {subActive ? (
                <p className="text-sm text-muted-foreground">
                  Your subscription is active
                  {periodEnd ? (
                    <>
                      {" "}
                      until{" "}
                      <span className="font-medium text-foreground">
                        {formatDate(periodEnd)}
                      </span>
                    </>
                  ) : null}
                  .
                </p>
              ) : (
                <>
                  <ul className="space-y-2 text-sm text-muted-foreground">
                    <li className="flex items-start gap-2">
                      <Sparkles className="w-4 h-4 mt-0.5 text-primary" />
                      We apply for you the moment a strong match is posted.
                    </li>
                    <li className="flex items-start gap-2">
                      <Sparkles className="w-4 h-4 mt-0.5 text-primary" />
                      Only high-confidence matches
                      {settings ? ` (${settings.matchThreshold}+ score)` : ""} —
                      no spam.
                    </li>
                    <li className="flex items-start gap-2">
                      <Sparkles className="w-4 h-4 mt-0.5 text-primary" />
                      Capped at {settings?.dailyCap ?? 0} applications a day.
                    </li>
                  </ul>
                  <Button
                    onClick={onSubscribe}
                    disabled={checkout.isPending}
                    data-testid="button-auto-apply-subscribe"
                  >
                    {checkout.isPending ? "Redirecting..." : "Subscribe"}
                    <ArrowRight className="w-4 h-4 ml-2" />
                  </Button>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Auto-Apply switch</CardTitle>
              <CardDescription>
                Turn this on to let the engine apply on your behalf. It only
                runs while your subscription is active.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <p className="font-medium">
                    {enabled ? "Auto-Apply is on" : "Auto-Apply is off"}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {!subActive
                      ? "Subscribe first — the switch has no effect without an active subscription."
                      : enabled
                        ? "We'll apply to strong matches as they're posted."
                        : "Flip this on to start auto-applying."}
                  </p>
                </div>
                <Switch
                  checked={enabled}
                  disabled={toggle.isPending}
                  onCheckedChange={onToggle}
                  data-testid="switch-auto-apply-enabled"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent auto-applications</CardTitle>
              <CardDescription>
                Jobs we've applied to for you, newest first.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!activity || activity.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  No auto-applications yet. Once you're subscribed and switched
                  on, matching jobs will appear here.
                </p>
              ) : (
                <ul className="divide-y">
                  {activity.map((item) => (
                    <li
                      key={item.id}
                      className="flex items-center justify-between gap-4 py-3"
                      data-testid={`row-auto-apply-${item.id}`}
                    >
                      <div className="min-w-0">
                        <Link
                          href={`/jobs/${item.jobId}`}
                          className="font-medium hover:underline truncate block"
                        >
                          {item.jobTitle}
                        </Link>
                        <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                          <Clock className="w-3 h-3" />
                          {formatDateTime(item.createdAt)}
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                        {item.matchScore}% match
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
