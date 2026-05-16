import {
  useGetApplicationTimeline,
  getGetApplicationTimelineQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { CheckCircle2, Circle, Clock, XCircle } from "lucide-react";
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
