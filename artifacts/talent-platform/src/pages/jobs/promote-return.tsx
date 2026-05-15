import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useVerifyJobTierCheckout } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  AlertCircle,
  Loader2,
  Sparkles,
} from "lucide-react";

type State =
  | { kind: "loading" }
  | {
      kind: "ok";
      tier: string;
      tierExpiresAt: string | null;
      jobId: number;
    }
  | { kind: "error"; message: string };

export default function JobsPromoteReturnPage() {
  const [, setLocation] = useLocation();
  const [state, setState] = useState<State>({ kind: "loading" });
  const verify = useVerifyJobTierCheckout();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    if (!sessionId) {
      setState({ kind: "error", message: "Missing checkout session id." });
      return;
    }
    verify
      .mutateAsync({ data: { sessionId } })
      .then((res) => {
        if (res.status === "paid") {
          setState({
            kind: "ok",
            tier: res.tier,
            tierExpiresAt: res.tierExpiresAt,
            jobId: res.jobId,
          });
        } else if (res.status === "pending") {
          setState({
            kind: "error",
            message:
              "Payment is still pending with Stripe. Please wait a moment and refresh, or check your dashboard.",
          });
        } else {
          setState({
            kind: "error",
            message:
              res.status === "expired"
                ? "Your checkout session expired. You can try again from the dashboard."
                : "Payment did not complete. You can try again from the dashboard.",
          });
        }
      })
      .catch((err) => {
        const message =
          err instanceof Error ? err.message : "Verification failed.";
        setState({ kind: "error", message });
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="container mx-auto px-4 py-16 max-w-2xl">
      <Card>
        <CardContent className="p-8 text-center space-y-4">
          {state.kind === "loading" && (
            <>
              <Loader2 className="w-10 h-10 mx-auto animate-spin text-muted-foreground" />
              <h1 className="text-xl font-semibold">Confirming payment…</h1>
              <p className="text-muted-foreground text-sm">
                We're verifying your checkout with Stripe. This usually takes
                a couple of seconds.
              </p>
            </>
          )}
          {state.kind === "ok" && (
            <>
              <Sparkles className="w-10 h-10 mx-auto text-primary" />
              <h1 className="text-xl font-semibold flex items-center gap-2 justify-center">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
                Your job is now {state.tier}
              </h1>
              {state.tierExpiresAt && (
                <p className="text-muted-foreground text-sm">
                  Boost runs until{" "}
                  <span className="font-medium text-foreground">
                    {new Date(state.tierExpiresAt).toLocaleString()}
                  </span>
                  .
                </p>
              )}
              <div className="flex gap-2 justify-center pt-2">
                <Button asChild>
                  <Link href={`/jobs/${state.jobId}`}>View job</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/dashboard/employer">Back to dashboard</Link>
                </Button>
              </div>
            </>
          )}
          {state.kind === "error" && (
            <>
              <AlertCircle className="w-10 h-10 mx-auto text-destructive" />
              <h1 className="text-xl font-semibold">Payment not confirmed</h1>
              <p className="text-muted-foreground text-sm">{state.message}</p>
              <div className="pt-2">
                <Button
                  variant="outline"
                  onClick={() => setLocation("/dashboard/employer")}
                >
                  Back to dashboard
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
