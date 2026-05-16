import {
  useGetApplicationTimeline,
  getGetApplicationTimelineQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CheckCircle2, Circle, Clock, Stamp, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export function ApplicationTimeline({ applicationId }: { applicationId: number }) {
  const { data, isLoading } = useGetApplicationTimeline(applicationId, {
    query: {
      queryKey: getGetApplicationTimelineQueryKey(applicationId),
      enabled: applicationId > 0,
    },
  });

  if (isLoading || !data) {
    return (
      <Card className="shadow-sm">
        <CardContent className="p-6">
          <div className="h-32 animate-pulse bg-muted rounded" />
        </CardContent>
      </Card>
    );
  }

  const isClosed = data.currentStatus === "rejected" || data.currentStatus === "withdrawn";

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Clock className="w-4 h-4 text-primary" /> Application milestones
        </CardTitle>
        <CardDescription>{data.etaLabel}</CardDescription>
      </CardHeader>
      <CardContent>
        {data.endorsement ? (
          <div
            className="mb-4 flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900/60 dark:bg-emerald-950/30"
            data-testid={`timeline-endorsement-${data.applicationId}`}
          >
            <Stamp className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-emerald-900 dark:text-emerald-100">
                Verified by {data.endorsement.institutionName}
              </p>
              {data.endorsement.note ? (
                <p className="mt-0.5 text-xs italic text-emerald-800/90 dark:text-emerald-200/90">
                  "{data.endorsement.note}"
                </p>
              ) : null}
              <p className="mt-0.5 text-xs text-emerald-800/70 dark:text-emerald-200/70">
                Endorsed {new Date(data.endorsement.endorsedAt).toLocaleDateString()}
              </p>
            </div>
          </div>
        ) : null}
        <ol className="space-y-3">
          {data.milestones.map((m, idx) => {
            const isWithdrawn = m.key === "withdrawn";
            const Icon = isWithdrawn
              ? XCircle
              : m.isReached
                ? CheckCircle2
                : Circle;
            return (
              <li key={`${m.key}-${idx}`} className="flex items-start gap-3">
                <Icon
                  className={cn(
                    "w-5 h-5 mt-0.5 shrink-0",
                    isWithdrawn
                      ? "text-destructive"
                      : m.isCurrent
                        ? "text-primary"
                        : m.isReached
                          ? "text-emerald-600"
                          : "text-muted-foreground/40",
                  )}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p
                      className={cn(
                        "text-sm font-medium",
                        m.isCurrent && "text-primary",
                        !m.isReached && !isClosed && "text-muted-foreground",
                      )}
                    >
                      {m.label}
                    </p>
                    {m.reachedAt ? (
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {new Date(m.reachedAt).toLocaleDateString()}
                      </span>
                    ) : null}
                  </div>
                  {m.isCurrent && !isClosed ? (
                    <p className="text-xs text-muted-foreground mt-0.5">Current step</p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
