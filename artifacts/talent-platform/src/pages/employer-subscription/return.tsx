import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useVerifyEmployerSubscriptionCheckout } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Crown, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

type Phase = "loading" | "active" | "trialing" | "pending" | "failed" | "missing";

export default function EmployerSubscriptionReturnPage() {
  const verify = useVerifyEmployerSubscriptionCheckout();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>("loading");
  const [trialEndsAt, setTrialEndsAt] = useState<Date | null>(null);
  const [periodEnd, setPeriodEnd] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");

    if (!sessionId) {
      setPhase("missing");
      return;
    }
    let cancelled = false;
    verify
      .mutateAsync({ data: { sessionId } })
      .then(async (result) => {
        if (cancelled) return;
        setTrialEndsAt(
          result.trialEndsAt ? new Date(result.trialEndsAt) : null,
        );
        setPeriodEnd(
          result.currentPeriodEnd ? new Date(result.currentPeriodEnd) : null,
        );
        if (result.status === "trialing") setPhase("trialing");
        else if (result.status === "active") setPhase("active");
        else if (result.status === "pending") setPhase("pending");
        else setPhase("failed");
        await queryClient.invalidateQueries();
      })
      .catch((err) => {
        if (cancelled) return;
        setErrorMessage(err instanceof Error ? err.message : "Verification failed");
        setPhase("failed");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="container mx-auto px-4 py-16 max-w-xl">
      <Card className="shadow-sm">
        <CardContent className="p-8 text-center space-y-4">
          {phase === "loading" && (
            <>
              <Loader2 className="w-12 h-12 mx-auto text-primary animate-spin" />
              <h1 className="text-2xl font-bold">Confirming your subscription</h1>
              <p className="text-muted-foreground">
                Hang tight while we verify your payment with Stripe.
              </p>
            </>
          )}
          {phase === "trialing" && (
            <>
              <div className="w-14 h-14 mx-auto rounded-full bg-green-500/10 text-green-600 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h1 className="text-2xl font-bold" data-testid="text-emp-sub-trialing-title">
                Free trial started
              </h1>
              <p className="text-muted-foreground">
                Unlimited job posting is unlocked
                {trialEndsAt ? (
                  <>
                    {" "}through your trial until{" "}
                    <span className="font-medium text-foreground">
                      {trialEndsAt.toLocaleDateString()}
                    </span>
                  </>
                ) : null}
                . You won't be charged until the trial ends.
              </p>
              <Button asChild data-testid="button-emp-sub-back-dashboard">
                <Link href="/dashboard/employer">Back to dashboard</Link>
              </Button>
            </>
          )}
          {phase === "active" && (
            <>
              <div className="w-14 h-14 mx-auto rounded-full bg-green-500/10 text-green-600 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h1 className="text-2xl font-bold" data-testid="text-emp-sub-active-title">
                Subscription active
              </h1>
              <p className="text-muted-foreground">
                Unlimited job posting is unlocked
                {periodEnd ? (
                  <>
                    {" "}until your next renewal on{" "}
                    <span className="font-medium text-foreground">
                      {periodEnd.toLocaleDateString()}
                    </span>
                  </>
                ) : null}
                .
              </p>
              <Button asChild data-testid="button-emp-sub-back-dashboard">
                <Link href="/dashboard/employer">Back to dashboard</Link>
              </Button>
            </>
          )}
          {phase === "pending" && (
            <>
              <div className="w-14 h-14 mx-auto rounded-full bg-yellow-500/10 text-yellow-600 flex items-center justify-center">
                <Crown className="w-8 h-8" />
              </div>
              <h1 className="text-2xl font-bold">Payment pending</h1>
              <p className="text-muted-foreground">
                We're still waiting on confirmation from Stripe. This usually
                clears within a minute. Refresh this page or check back from
                your dashboard.
              </p>
              <Button asChild variant="outline">
                <Link href="/dashboard/employer">Back to dashboard</Link>
              </Button>
            </>
          )}
          {phase === "failed" && (
            <>
              <div className="w-14 h-14 mx-auto rounded-full bg-destructive/10 text-destructive flex items-center justify-center">
                <AlertCircle className="w-8 h-8" />
              </div>
              <h1 className="text-2xl font-bold">We couldn't confirm the payment</h1>
              <p className="text-muted-foreground">
                {errorMessage ??
                  "If you completed checkout, please try again from the subscription page. You will not be charged twice."}
              </p>
              <Button asChild variant="outline">
                <Link href="/dashboard/employer/subscription">Back to subscription</Link>
              </Button>
            </>
          )}
          {phase === "missing" && (
            <>
              <div className="w-14 h-14 mx-auto rounded-full bg-muted text-muted-foreground flex items-center justify-center">
                <AlertCircle className="w-8 h-8" />
              </div>
              <h1 className="text-2xl font-bold">No payment to verify</h1>
              <p className="text-muted-foreground">
                This page expects a checkout session id. Head back to your
                dashboard to subscribe.
              </p>
              <Button asChild variant="outline">
                <Link href="/dashboard/employer/subscription">Subscribe</Link>
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
