import { useState } from "react";
import { Link } from "wouter";
import {
  useGetCvSettings,
  useGetCandidateCv,
  useCreateCvCheckout,
  getGetCandidateCvQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { FileText, AlertCircle, CheckCircle2 } from "lucide-react";

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

export function CvCard({ candidateId }: { candidateId: number }) {
  const { data: settings, isLoading: settingsLoading } = useGetCvSettings();
  const { data: cv } = useGetCandidateCv(candidateId, {
    query: {
      enabled: candidateId > 0,
      queryKey: getGetCandidateCvQueryKey(candidateId),
    },
  });
  const createCheckout = useCreateCvCheckout();
  const [error, setError] = useState<string | null>(null);

  if (settingsLoading || !settings) return null;
  if (!settings.isActive && !cv?.unlocked) return null;

  const unlocked = cv?.unlocked ?? false;

  const onUnlock = async () => {
    setError(null);
    try {
      const origin = window.location.origin;
      const result = await createCheckout.mutateAsync({
        id: candidateId,
        data: {
          successUrl: `${origin}/cv/return?session_id={CHECKOUT_SESSION_ID}`,
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
    <Card className="shadow-sm border-blue-500/30 bg-gradient-to-r from-blue-500/5 to-transparent">
      <CardContent className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400 shrink-0">
            <FileText className="w-6 h-6" />
          </div>
          <div>
            {unlocked ? (
              <>
                <div className="flex items-center gap-2">
                  <h3 className="text-lg font-semibold">AI CV Builder unlocked</h3>
                  <CheckCircle2 className="w-4 h-4 text-green-600" />
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  Generate a polished, ATS-friendly CV from your profile in
                  seconds. You can regenerate any time.
                </p>
              </>
            ) : (
              <>
                <h3 className="text-lg font-semibold">AI CV Builder</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Unlock our AI to write a polished, ATS-friendly CV from your
                  profile for {" "}
                  <span className="font-semibold text-foreground">
                    {formatPrice(settings.priceCents, settings.currency)}
                  </span>
                  {" "}— a one-time payment.
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
        <div className="flex md:justify-end">
          {unlocked ? (
            <Button asChild data-testid="button-open-cv-builder">
              <Link href="/cv/builder">
                <FileText className="w-4 h-4 mr-2" />
                Open CV builder
              </Link>
            </Button>
          ) : (
            <Button
              onClick={onUnlock}
              disabled={createCheckout.isPending}
              data-testid="button-unlock-cv"
            >
              <FileText className="w-4 h-4 mr-2" />
              {createCheckout.isPending ? "Redirecting..." : "Unlock now"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
