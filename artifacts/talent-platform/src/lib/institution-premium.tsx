import { ReactNode } from "react";
import { Link } from "wouter";
import {
  useGetInstitutionSubscriptionSettings,
  useGetInstitutionSubscription,
  getGetInstitutionSubscriptionSettingsQueryKey,
  getGetInstitutionSubscriptionQueryKey,
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
import { Crown, Lock, ArrowRight } from "lucide-react";

export type InstitutionPremiumState = {
  /** Auth + status are still resolving. UI should render a skeleton. */
  isLoading: boolean;
  /** The signed-in user belongs to an institution. */
  isInstitutionUser: boolean;
  /** Resolved institution id (or null when not an institution user). */
  institutionId: number | null;
  /**
   * The admin global toggle. When false the feature is dormant — every
   * institution has full access regardless of subscription status, so
   * `isPremium` is true.
   */
  featureEnabled: boolean;
  /** True iff the institution currently has access to Pro features. */
  isPremium: boolean;
  /** True if the signed-in user is the institution's commercial owner. */
  isOwner: boolean;
};

/**
 * Resolves whether the current institution user has access to
 * Institution Pro features. Mirrors the server-side
 * `isInstitutionPremium` helper so server and client stay in lockstep.
 *
 * Behaviour:
 *   - When the global feature flag is OFF (admin hasn't turned the
 *     plan on), `isPremium` is always true. The platform doesn't
 *     silently degrade for existing institutions.
 *   - When the flag is ON, `isPremium` is true only when the current
 *     subscription is `trialing` or `active`.
 *   - For non-institution users (admins, employers, candidates,
 *     anonymous) `isPremium` is false and `isInstitutionUser` is false
 *     — callers should usually treat it as "n/a" rather than gated.
 */
export function useInstitutionPremium(): InstitutionPremiumState {
  const { sessionUser, role, isLoading: authLoading } = useAuth();
  const institutionId =
    role === "institution" && sessionUser?.institutionId
      ? sessionUser.institutionId
      : null;
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

  const featureEnabled = settings?.isActive === true;
  let isPremium = false;
  if (institutionId) {
    if (!featureEnabled) {
      isPremium = true;
    } else if (status) {
      isPremium = status.unlocksPlacements === true;
    }
  }

  return {
    isLoading:
      authLoading ||
      settingsLoading ||
      (!!institutionId && statusLoading),
    isInstitutionUser: !!institutionId,
    institutionId,
    featureEnabled,
    isPremium,
    isOwner,
  };
}

/**
 * Wrap any premium-only UI in <PremiumGate>. Renders the children when
 * the institution is on Pro; otherwise renders an inline upgrade card
 * that links to the subscription page. Pass `fallback` to override the
 * default upgrade card with your own empty-state.
 */
export function PremiumGate({
  feature,
  children,
  fallback,
  loadingFallback,
}: {
  /** Short label of the gated feature, shown in the upgrade card. */
  feature: string;
  children: ReactNode;
  fallback?: ReactNode;
  loadingFallback?: ReactNode;
}) {
  const state = useInstitutionPremium();

  if (state.isLoading) {
    return (
      <>
        {loadingFallback ?? (
          <div className="animate-pulse h-32 rounded-lg bg-muted" />
        )}
      </>
    );
  }

  if (state.isPremium) return <>{children}</>;

  if (fallback) return <>{fallback}</>;

  return (
    <Card
      data-testid={`premium-gate-${feature.toLowerCase().replace(/\s+/g, "-")}`}
      className="border-primary/40"
    >
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Lock className="w-5 h-5 text-primary" />
          {feature} is part of Institution Pro
        </CardTitle>
        <CardDescription>
          Upgrade your institution to unlock {feature.toLowerCase()} along
          with bulk verification, advanced placement analytics, a branded
          profile, priority placement for your students, and more.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {state.isOwner ? (
          <Button asChild data-testid="button-premium-gate-upgrade">
            <Link href="/dashboard/institution/subscription">
              <Crown className="w-4 h-4 mr-2" />
              Upgrade to Institution Pro
              <ArrowRight className="w-4 h-4 ml-2" />
            </Link>
          </Button>
        ) : (
          <p className="text-sm text-muted-foreground">
            Ask your institution owner to upgrade from the Subscription
            page in the dashboard.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Small inline "Pro" badge for UI labels (sidebar items, headings, etc).
 */
export function ProBadge({ className }: { className?: string }) {
  return (
    <span
      data-testid="badge-pro"
      className={
        "inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-amber-400 to-amber-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm " +
        (className ?? "")
      }
    >
      <Crown className="w-2.5 h-2.5" />
      Pro
    </span>
  );
}
