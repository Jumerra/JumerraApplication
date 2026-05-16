import {
  useGetMyEmployerFastTrack,
  useSetMyEmployerFastTrack,
  getGetMyEmployerFastTrackQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Zap, AlertTriangle, Clock } from "lucide-react";
import { toast } from "sonner";

/**
 * Employer dashboard widget for the 48-hour Fast-Track pledge.
 * Shows current state, breach streak, and upcoming deadlines so the
 * employer can act before another breach is recorded.
 */
export function FastTrackPledgeCard() {
  const queryClient = useQueryClient();
  const { data: state, isLoading } = useGetMyEmployerFastTrack();
  const toggle = useSetMyEmployerFastTrack();

  const handleToggle = (enabled: boolean) => {
    toggle.mutate(
      { data: { enabled } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({
            queryKey: getGetMyEmployerFastTrackQueryKey(),
          });
          toast.success(
            enabled
              ? "Fast-Track pledge enabled"
              : "Fast-Track pledge disabled",
          );
        },
        onError: (err: unknown) => {
          const msg =
            err && typeof err === "object" && "message" in err
              ? String((err as { message: string }).message)
              : "Could not update Fast-Track state";
          toast.error(msg);
        },
      },
    );
  };

  if (isLoading || !state) {
    return (
      <Card className="shadow-sm">
        <CardContent className="p-6">
          <div className="h-24 animate-pulse bg-muted rounded" />
        </CardContent>
      </Card>
    );
  }

  const revokedActive =
    state.revokedUntil &&
    new Date(state.revokedUntil).getTime() > Date.now();

  return (
    <Card className="shadow-sm" data-testid="card-fast-track-pledge">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="w-4 h-4 text-amber-500" />
              48-hour Fast-Track pledge
            </CardTitle>
            <CardDescription className="mt-1">
              Promise candidates a first response within 48 hours.
            </CardDescription>
          </div>
          <Switch
            checked={state.enabled}
            disabled={Boolean(revokedActive) || toggle.isPending}
            onCheckedChange={handleToggle}
            data-testid="switch-fast-track-pledge"
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          {state.enabled ? (
            <Badge className="bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-200 border-emerald-300">
              Pledge active
            </Badge>
          ) : revokedActive ? (
            <Badge className="bg-rose-100 text-rose-900 dark:bg-rose-900/40 dark:text-rose-200 border-rose-300">
              Revoked until{" "}
              {new Date(state.revokedUntil as string).toLocaleDateString()}
            </Badge>
          ) : (
            <Badge variant="secondary">Pledge off</Badge>
          )}
          <Badge variant="outline">
            {state.breachesLast30Days} breach
            {state.breachesLast30Days === 1 ? "" : "es"} / 30d
          </Badge>
          {state.streakDays !== null ? (
            <Badge variant="outline">
              {state.streakDays}d clean streak
            </Badge>
          ) : null}
        </div>

        {state.breachesLast30Days === 1 && state.enabled ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm flex gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <p>
              You have one breach in the last 30 days. One more will
              auto-revoke your Fast-Track badge for 30 days.
            </p>
          </div>
        ) : null}

        {state.upcomingDeadlines.length > 0 ? (
          <div>
            <div className="text-xs font-semibold uppercase text-muted-foreground mb-2 flex items-center gap-1">
              <Clock className="w-3 h-3" /> Closing in soon
            </div>
            <ul className="space-y-2">
              {state.upcomingDeadlines.slice(0, 5).map((d) => (
                <li
                  key={d.applicationId}
                  className="flex items-center justify-between gap-3 text-sm rounded-md border bg-muted/30 p-2"
                  data-testid={`row-fast-track-deadline-${d.applicationId}`}
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">{d.candidateName}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {d.jobTitle}
                    </p>
                  </div>
                  <Badge
                    variant={d.hoursRemaining <= 2 ? "destructive" : "outline"}
                  >
                    {d.hoursRemaining}h left
                  </Badge>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
