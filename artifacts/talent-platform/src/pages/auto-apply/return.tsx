import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useVerifyAutoApplyCheckout } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Wand2, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { sanitizeMobileRedirect } from "@/lib/mobile-redirect";

type Phase = "loading" | "active" | "pending" | "failed" | "missing";

export default function AutoApplyReturnPage() {
  const verify = useVerifyAutoApplyCheckout();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>("loading");
  const [periodEnd, setPeriodEnd] = useState<Date | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    // Paystack appends `?reference=...&trxref=...` to its callback URL.
    const reference = params.get("reference") ?? params.get("trxref");
    const mobileRedirect = params.get("mobile_redirect");
    const wasCancelled = params.get("cancelled") === "1";

    const safeMobileRedirect = sanitizeMobileRedirect(mobileRedirect);
    if (safeMobileRedirect) {
      const sep = safeMobileRedirect.includes("?") ? "&" : "?";
      const parts: string[] = [];
      if (wasCancelled) {
        parts.push("cancelled=1");
      } else if (sessionId) {
        parts.push(`session_id=${encodeURIComponent(sessionId)}`);
      } else if (reference) {
        parts.push(`reference=${encodeURIComponent(reference)}`);
      }
      const target = parts.length
        ? `${safeMobileRedirect}${sep}${parts.join("&")}`
        : safeMobileRedirect;
      window.location.replace(target);
      return;
    }

    if (!sessionId && !reference) {
      setPhase("missing");
      return;
    }
    let cancelled = false;
    const verifyArgs = sessionId
      ? { data: { sessionId } }
      : { data: { reference: reference! } };
    verify
      .mutateAsync(verifyArgs)
      .then(async (result) => {
        if (cancelled) return;
        setPeriodEnd(
          result.currentPeriodEnd ? new Date(result.currentPeriodEnd) : null,
        );
        setPhase(
          result.status === "active" || result.status === "trialing"
            ? "active"
            : result.status === "pending"
              ? "pending"
              : "failed",
        );
        await queryClient.invalidateQueries();
      })
      .catch((err) => {
        if (cancelled) return;
        setErrorMessage(
          err instanceof Error ? err.message : "Verification failed",
        );
        setPhase("failed");
      });
    return () => {
      cancelled = true;
    };
    // We only want this to run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="container mx-auto px-4 py-16 max-w-xl">
      <Card className="shadow-sm">
        <CardContent className="p-8 text-center space-y-4">
          {phase === "loading" && (
            <>
              <Loader2 className="w-12 h-12 mx-auto text-primary animate-spin" />
              <h1 className="text-2xl font-bold">Confirming your payment</h1>
              <p className="text-muted-foreground">
                Hang tight while we activate your AI Auto-Apply subscription.
              </p>
            </>
          )}
          {phase === "active" && (
            <>
              <div className="w-14 h-14 mx-auto rounded-full bg-green-500/10 text-green-600 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h1 className="text-2xl font-bold">Auto-Apply is live</h1>
              <p className="text-muted-foreground">
                Your subscription is active
                {periodEnd ? (
                  <>
                    {" "}
                    until{" "}
                    <span className="font-medium text-foreground">
                      {periodEnd.toLocaleDateString()}
                    </span>
                  </>
                ) : null}
                . Turn the switch on to start applying to strong matches.
              </p>
              <Button asChild>
                <Link href="/dashboard/candidate/auto-apply">
                  Manage Auto-Apply
                </Link>
              </Button>
            </>
          )}
          {phase === "pending" && (
            <>
              <div className="w-14 h-14 mx-auto rounded-full bg-yellow-500/10 text-yellow-600 flex items-center justify-center">
                <Wand2 className="w-8 h-8" />
              </div>
              <h1 className="text-2xl font-bold">Payment pending</h1>
              <p className="text-muted-foreground">
                We're still waiting on confirmation from the payment provider.
                This usually clears within a minute. Refresh this page or check
                back from your dashboard.
              </p>
              <Button asChild variant="outline">
                <Link href="/dashboard/candidate/auto-apply">
                  Back to Auto-Apply
                </Link>
              </Button>
            </>
          )}
          {phase === "failed" && (
            <>
              <div className="w-14 h-14 mx-auto rounded-full bg-destructive/10 text-destructive flex items-center justify-center">
                <AlertCircle className="w-8 h-8" />
              </div>
              <h1 className="text-2xl font-bold">
                We couldn't confirm the payment
              </h1>
              <p className="text-muted-foreground">
                {errorMessage ??
                  "If you completed checkout, please try again from your dashboard. You will not be charged twice."}
              </p>
              <Button asChild variant="outline">
                <Link href="/dashboard/candidate/auto-apply">
                  Back to Auto-Apply
                </Link>
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
                dashboard to subscribe to AI Auto-Apply.
              </p>
              <Button asChild variant="outline">
                <Link href="/dashboard/candidate/auto-apply">
                  Back to Auto-Apply
                </Link>
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
