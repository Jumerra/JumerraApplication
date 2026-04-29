import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useVerifyBoostCheckout } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Rocket, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

type Phase = "loading" | "paid" | "pending" | "failed" | "missing";

export default function BoostReturnPage() {
  const verify = useVerifyBoostCheckout();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>("loading");
  const [boostUntil, setBoostUntil] = useState<Date | null>(null);
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
        setBoostUntil(
          result.boostExpiresAt ? new Date(result.boostExpiresAt) : null,
        );
        setPhase(
          result.status === "paid"
            ? "paid"
            : result.status === "pending"
              ? "pending"
              : "failed",
        );
        // Refresh any candidate-scoped caches so the dashboard CTA updates.
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
                Hang tight while we verify your Profile Boost.
              </p>
            </>
          )}
          {phase === "paid" && (
            <>
              <div className="w-14 h-14 mx-auto rounded-full bg-green-500/10 text-green-600 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h1 className="text-2xl font-bold">Profile boosted</h1>
              <p className="text-muted-foreground">
                Your profile will be shown to top employers
                {boostUntil ? (
                  <>
                    {" "}until {" "}
                    <span className="font-medium text-foreground">
                      {boostUntil.toLocaleDateString()}
                    </span>
                  </>
                ) : null}
                .
              </p>
              <Button asChild>
                <Link href="/dashboard/candidate">Back to dashboard</Link>
              </Button>
            </>
          )}
          {phase === "pending" && (
            <>
              <div className="w-14 h-14 mx-auto rounded-full bg-yellow-500/10 text-yellow-600 flex items-center justify-center">
                <Rocket className="w-8 h-8" />
              </div>
              <h1 className="text-2xl font-bold">Payment pending</h1>
              <p className="text-muted-foreground">
                We're still waiting on confirmation from the payment provider.
                This usually clears within a minute. Refresh this page or check
                back from your dashboard.
              </p>
              <Button asChild variant="outline">
                <Link href="/dashboard/candidate">Back to dashboard</Link>
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
                  "If you completed checkout, please try again from your dashboard. You will not be charged twice."}
              </p>
              <Button asChild variant="outline">
                <Link href="/dashboard/candidate">Back to dashboard</Link>
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
                dashboard to start a Profile Boost.
              </p>
              <Button asChild variant="outline">
                <Link href="/dashboard/candidate">Back to dashboard</Link>
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
