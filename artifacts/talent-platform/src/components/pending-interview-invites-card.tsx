import {
  useListInterviewInvitesForCandidate,
  getListInterviewInvitesForCandidateQueryKey,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, ChevronRight } from "lucide-react";

function formatSlotShort(startsAtIso: string, endsAtIso: string): string {
  const start = new Date(startsAtIso);
  const end = new Date(endsAtIso);
  return `${start.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })} · ${start.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })}–${end.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

/**
 * Surfaces pending + recently accepted interview invites at the top of
 * the candidate dashboard. Hidden when the candidate has no invites at
 * all — we don't want to add an empty card to the dashboard.
 */
export function PendingInterviewInvitesCard({
  candidateId,
}: {
  candidateId: number;
}) {
  const { data, isLoading } = useListInterviewInvitesForCandidate(
    candidateId,
    undefined,
    {
      query: {
        enabled: candidateId > 0,
        queryKey: getListInterviewInvitesForCandidateQueryKey(candidateId),
      },
    },
  );

  if (isLoading) {
    return (
      <Card className="shadow-sm">
        <CardContent className="p-6">
          <div className="animate-pulse h-16 bg-muted rounded" />
        </CardContent>
      </Card>
    );
  }
  const invites = (data ?? []).filter(
    (i) => i.status === "proposed" || i.status === "accepted",
  );
  if (invites.length === 0) return null;

  return (
    <Card className="shadow-sm border-primary/30 bg-primary/5">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Calendar className="w-5 h-5 text-primary" />
          Interview invitations
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {invites.map((invite) => {
          const selectedSlot =
            invite.status === "accepted"
              ? invite.timeSlots.find((s) => s.id === invite.selectedSlotId)
              : null;
          return (
            <Link
              key={invite.id}
              href={`/interviews/${invite.id}`}
              className="flex items-center justify-between gap-3 rounded-lg p-3 -mx-1 hover:bg-background transition-colors group"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge
                    variant="secondary"
                    className={
                      invite.status === "accepted"
                        ? "bg-green-100 text-green-700 hover:bg-green-100"
                        : "bg-amber-100 text-amber-700 hover:bg-amber-100"
                    }
                  >
                    {invite.status === "proposed" ? "New" : "Confirmed"}
                  </Badge>
                  <span className="font-medium truncate">
                    {invite.jobTitle}
                  </span>
                  <span className="text-sm text-muted-foreground truncate">
                    · {invite.employerName}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {invite.status === "accepted" && selectedSlot
                    ? formatSlotShort(
                        selectedSlot.startsAt,
                        selectedSlot.endsAt,
                      )
                    : `${invite.timeSlots.length} time slot${
                        invite.timeSlots.length === 1 ? "" : "s"
                      } proposed — pick one to confirm`}
                </p>
              </div>
              <ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-primary shrink-0" />
            </Link>
          );
        })}
      </CardContent>
    </Card>
  );
}
