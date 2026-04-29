import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useVerifyCvCheckout } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

type Phase = "loading" | "paid" | "pending" | "failed" | "missing";

// Only allow bouncing back to the mobile app via known native-app
// deep-link schemes. This blocks open-redirect / javascript: / data:
// abuse via a crafted ?mobile_redirect= query param.
const MOBILE_REDIRECT_SCHEMES = new Set([
  "talent-mobile:",
  "exp:",
  "exps:",
]);

function sanitizeMobileRedirect(raw: string | null): string | null {
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (!MOBILE_REDIRECT_SCHEMES.has(parsed.protocol)) return null;
  return raw;
}

export default function CvReturnPage() {
  const verify = useVerifyCvCheckout();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<Phase>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get("session_id");
    const mobileRedirect = params.get("mobile_redirect");
    const wasCancelled = params.get("cancelled") === "1";

    // When the mobile app started this checkout, bounce back into the
    // app via its deep link instead of rendering web confirmation UI.
    const safeMobileRedirect = sanitizeMobileRedirect(mobileRedirect);
    if (safeMobileRedirect) {
      const sep = safeMobileRedirect.includes("?") ? "&" : "?";
      const parts: string[] = [];
      if (wasCancelled) {
        parts.push("cancelled=1");
      } else if (sessionId) {
        parts.push(`session_id=${encodeURIComponent(sessionId)}`);
      }
      const target = parts.length
        ? `${safeMobileRedirect}${sep}${parts.join("&")}`
        : safeMobileRedirect;
      window.location.replace(target);
      return;
    }

    if (!sessionId) {
      setPhase("missing");
      return;
    }
    let cancelled = false;
    verify
      .mutateAsync({ data: { sessionId } })
      .then(async (result) => {
        if (cancelled) return;
        setPhase(
          result.status === "paid"
            ? "paid"
            : result.status === "pending"
              ? "pending"
              : "failed",
        );
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
              <h1 className="text-2xl font-bold">Confirming your unlock</h1>
            </>
          )}
          {phase === "paid" && (
            <>
              <div className="w-14 h-14 mx-auto rounded-full bg-green-500/10 text-green-600 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h1 className="text-2xl font-bold">AI CV Builder unlocked</h1>
              <p className="text-muted-foreground">
                You can now generate a polished AI-written CV from your profile.
              </p>
              <div className="flex flex-col sm:flex-row gap-2 justify-center">
                <Button asChild>
                  <Link href="/cv/builder">
                    <FileText className="w-4 h-4 mr-2" />
                    Open CV builder
                  </Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/dashboard/candidate">Back to dashboard</Link>
                </Button>
              </div>
            </>
          )}
          {phase === "pending" && (
            <>
              <div className="w-14 h-14 mx-auto rounded-full bg-yellow-500/10 text-yellow-600 flex items-center justify-center">
                <FileText className="w-8 h-8" />
              </div>
              <h1 className="text-2xl font-bold">Payment pending</h1>
              <p className="text-muted-foreground">
                We're still waiting on confirmation. This usually clears within
                a minute.
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
