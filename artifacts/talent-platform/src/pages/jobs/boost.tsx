import { useState } from "react";
import { useLocation, useRoute } from "wouter";
import {
  useGetJob,
  useGetJobTierSettings,
  useCreateJobTierCheckout,
  getGetJobQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Megaphone, Star, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

type Tier = "promoted" | "sponsored";

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

export default function JobBoostPage() {
  const [, params] = useRoute<{ id: string }>("/jobs/:id/boost");
  const [, setLocation] = useLocation();
  const { role, sessionUser } = useAuth();
  const employerId = sessionUser?.employerId ?? null;
  const orgRole = sessionUser?.orgRole ?? null;
  const jobId = Number(params?.id);
  const { data: job, isLoading: jobLoading } = useGetJob(jobId, {
    query: {
      queryKey: getGetJobQueryKey(jobId),
      enabled: Number.isFinite(jobId),
    },
  });
  const { data: settings, isLoading: settingsLoading } = useGetJobTierSettings();
  const checkout = useCreateJobTierCheckout();
  const [tier, setTier] = useState<Tier>("promoted");
  const [submitting, setSubmitting] = useState(false);

  if (jobLoading || settingsLoading) {
    return (
      <div className="container py-20 flex justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!job) {
    return (
      <div className="container py-20 text-center text-muted-foreground">
        Job not found.
      </div>
    );
  }
  const isOwner =
    role === "employer" &&
    employerId === job.employerId &&
    orgRole === "owner";
  const isAdmin = role === "admin";
  if (!isOwner && !isAdmin) {
    return (
      <div className="container py-20 text-center text-muted-foreground">
        Only the employer owner or a platform admin can boost this job.
      </div>
    );
  }
  if (job.tier && job.tier !== "free") {
    return (
      <div className="container max-w-2xl py-12 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>This job is already boosted</CardTitle>
            <CardDescription>
              Current tier: {job.tier}
              {job.tierExpiresAt
                ? ` (until ${new Date(job.tierExpiresAt).toLocaleDateString()})`
                : ""}
              . You can re-boost after the current tier ends.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => setLocation("/dashboard/employer")}>
              <ArrowLeft className="w-4 h-4 mr-2" /> Back to dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const promotedAvailable = settings?.promotedActive ?? false;
  const sponsoredAvailable = settings?.sponsoredActive ?? false;

  const onBoost = async () => {
    if (!settings) return;
    setSubmitting(true);
    try {
      const successUrl = `${window.location.origin}/jobs/promote/return?session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${window.location.origin}/dashboard/employer?cancelled=1`;
      const session = await checkout.mutateAsync({
        id: job.id,
        data: { tier, successUrl, cancelUrl },
      });
      if (session.checkoutUrl) {
        window.location.href = session.checkoutUrl;
      } else {
        toast.error("Could not start checkout. Please try again.");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Checkout failed";
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="container max-w-2xl py-10 space-y-6">
      <Button variant="ghost" size="sm" onClick={() => setLocation("/dashboard/employer")}>
        <ArrowLeft className="w-4 h-4 mr-2" /> Back
      </Button>
      <div>
        <h1 className="text-2xl font-bold">Boost "{job.title}"</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Pay once to upgrade this job's visibility. Free posts always stay live —
          boosts only change ranking and reach.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <button
          type="button"
          onClick={() => promotedAvailable && setTier("promoted")}
          disabled={!promotedAvailable}
          className={`text-left p-4 rounded-lg border transition-all ${
            tier === "promoted"
              ? "border-primary ring-2 ring-primary/20"
              : "border-border hover:border-primary/50"
          } ${!promotedAvailable ? "opacity-50 cursor-not-allowed" : ""}`}
          data-testid="tier-option-promoted"
        >
          <div className="flex items-center gap-2 mb-1">
            <Megaphone className="w-4 h-4 text-sky-600" />
            <span className="font-semibold">Promoted</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Higher placement in job lists for {settings?.promotedDurationDays ?? 30} days.
          </p>
          {settings && (
            <p className="text-sm font-semibold mt-2">
              {formatPrice(settings.promotedPriceCents, settings.promotedCurrency)}
            </p>
          )}
        </button>

        <button
          type="button"
          onClick={() => sponsoredAvailable && setTier("sponsored")}
          disabled={!sponsoredAvailable}
          className={`text-left p-4 rounded-lg border transition-all ${
            tier === "sponsored"
              ? "border-primary ring-2 ring-primary/20"
              : "border-border hover:border-primary/50"
          } ${!sponsoredAvailable ? "opacity-50 cursor-not-allowed" : ""}`}
          data-testid="tier-option-sponsored"
        >
          <div className="flex items-center gap-2 mb-1">
            <Star className="w-4 h-4 text-amber-600" />
            <span className="font-semibold">Sponsored</span>
          </div>
          <p className="text-sm text-muted-foreground">
            Top placement plus active push to matching candidates for{" "}
            {settings?.sponsoredDurationDays ?? 30} days.
          </p>
          {settings && (
            <p className="text-sm font-semibold mt-2">
              {formatPrice(settings.sponsoredPriceCents, settings.sponsoredCurrency)}
            </p>
          )}
        </button>
      </div>

      <Button
        onClick={onBoost}
        disabled={submitting || !settings}
        className="w-full"
        data-testid="button-boost-checkout"
      >
        {submitting ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Starting checkout...
          </>
        ) : (
          <>Pay and boost</>
        )}
      </Button>
    </div>
  );
}
