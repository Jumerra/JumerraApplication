import { useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetInterviewInvite,
  useAcceptInterviewInvite,
  useDeclineInterviewInvite,
  getGetInterviewInviteQueryKey,
  getListInterviewInvitesForApplicationQueryKey,
  getListInterviewInvitesForCandidateQueryKey,
  getGetCandidateDashboardQueryKey,
  getListApplicationsQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  RadioGroup,
  RadioGroupItem,
} from "@/components/ui/radio-group";
import {
  Building2,
  Calendar,
  CheckCircle2,
  Link as LinkIcon,
  MapPin,
  StickyNote,
  XCircle,
  ArrowLeft,
  Ban,
} from "lucide-react";
import { toast } from "sonner";

/**
 * Defense-in-depth: only render meeting links when they parse to an
 * http(s) URL. The backend rejects unsafe protocols on write, but
 * legacy rows (or future unforeseen sources) might still contain
 * `javascript:` style payloads.
 */
function isSafeWebUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function formatSlotRange(startsAtIso: string, endsAtIso: string): string {
  const start = new Date(startsAtIso);
  const end = new Date(endsAtIso);
  const dateStr = start.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  const startTime = start.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  const endTime = end.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${dateStr} · ${startTime}–${endTime}`;
}

function statusBadgeClass(status: string): string {
  switch (status) {
    case "accepted":
      return "bg-green-100 text-green-700 hover:bg-green-100";
    case "declined":
      return "bg-red-100 text-red-700 hover:bg-red-100";
    case "cancelled":
      return "bg-muted text-muted-foreground hover:bg-muted";
    default:
      return "bg-amber-100 text-amber-700 hover:bg-amber-100";
  }
}

export default function InterviewInvitePage() {
  const params = useParams<{ id: string }>();
  const inviteId = Number(params.id);
  const [, navigate] = useLocation();
  const { sessionUser, isLoading: isAuthLoading } = useAuth();
  const candidateId = sessionUser?.candidateId ?? null;
  const isAuthenticated = sessionUser !== null;
  const queryClient = useQueryClient();

  const inviteQuery = useGetInterviewInvite(inviteId, {
    query: {
      enabled: Number.isFinite(inviteId) && inviteId > 0,
      queryKey: getGetInterviewInviteQueryKey(inviteId),
    },
  });
  const acceptInvite = useAcceptInterviewInvite();
  const declineInvite = useDeclineInterviewInvite();

  const [selectedSlotId, setSelectedSlotId] = useState<number | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [showDecline, setShowDecline] = useState(false);

  const invalidateAll = () => {
    queryClient.invalidateQueries({
      queryKey: getGetInterviewInviteQueryKey(inviteId),
    });
    if (inviteQuery.data) {
      queryClient.invalidateQueries({
        queryKey: getListInterviewInvitesForApplicationQueryKey(
          inviteQuery.data.applicationId,
        ),
      });
      queryClient.invalidateQueries({
        queryKey: getListInterviewInvitesForCandidateQueryKey(
          inviteQuery.data.candidateId,
        ),
      });
    }
    if (candidateId) {
      // Refresh the candidate dashboard so the pending-invites card updates.
      queryClient.invalidateQueries({
        queryKey: getGetCandidateDashboardQueryKey(candidateId),
      });
    }
    // Accepting/declining flips applications.status server-side, so any
    // applications list (employer or candidate) needs to refetch.
    queryClient.invalidateQueries({ queryKey: getListApplicationsQueryKey() });
  };

  if (isAuthLoading) {
    return (
      <div className="container max-w-2xl px-4 py-12">
        <div className="animate-pulse h-[400px] bg-muted rounded-2xl" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="container max-w-2xl px-4 py-12">
        <Card>
          <CardContent className="p-8 text-center space-y-4">
            <p>Please sign in to view this interview invitation.</p>
            <Button onClick={() => navigate("/login")}>Sign in</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (inviteQuery.isLoading) {
    return (
      <div className="container max-w-2xl px-4 py-12">
        <div className="animate-pulse h-[400px] bg-muted rounded-2xl" />
      </div>
    );
  }

  if (inviteQuery.isError || !inviteQuery.data) {
    return (
      <div className="container max-w-2xl px-4 py-12">
        <Card>
          <CardContent className="p-8 text-center space-y-4">
            <p className="text-muted-foreground">
              Couldn't load this interview invitation.
            </p>
            <Button variant="outline" onClick={() => navigate("/dashboard/candidate")}>
              Back to dashboard
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const invite = inviteQuery.data;
  const isCandidate =
    candidateId !== null && candidateId === invite.candidateId;
  const selectedSlot = invite.timeSlots.find(
    (s) => s.id === invite.selectedSlotId,
  );

  const onAccept = () => {
    if (!selectedSlotId) {
      toast.error("Pick a time slot first");
      return;
    }
    acceptInvite.mutate(
      { id: invite.id, data: { slotId: selectedSlotId } },
      {
        onSuccess: () => {
          toast.success("Interview accepted");
          invalidateAll();
        },
        onError: () => toast.error("Failed to accept interview"),
      },
    );
  };

  const onDecline = () => {
    declineInvite.mutate(
      {
        id: invite.id,
        data: { reason: declineReason.trim() || undefined },
      },
      {
        onSuccess: () => {
          toast.success("Interview declined");
          setShowDecline(false);
          invalidateAll();
        },
        onError: () => toast.error("Failed to decline interview"),
      },
    );
  };

  return (
    <div className="container max-w-2xl px-4 py-8 space-y-6">
      <Link
        href="/dashboard/candidate"
        className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
      >
        <ArrowLeft className="w-4 h-4" /> Back to dashboard
      </Link>

      <Card className="shadow-sm">
        <CardHeader>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <CardTitle className="text-2xl">Interview invitation</CardTitle>
              <p className="text-muted-foreground mt-1 text-sm">
                For{" "}
                <span className="font-medium text-foreground">
                  {invite.jobTitle}
                </span>{" "}
                at{" "}
                <span className="font-medium text-foreground">
                  {invite.employerName}
                </span>
              </p>
            </div>
            <Badge
              variant="secondary"
              className={statusBadgeClass(invite.status)}
            >
              {invite.status}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Meta block */}
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Building2 className="w-4 h-4 shrink-0" />
              <span className="text-foreground">{invite.employerName}</span>
            </div>
            {invite.location && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <MapPin className="w-4 h-4 shrink-0" />
                <span className="text-foreground">{invite.location}</span>
              </div>
            )}
            {invite.meetingLink && isSafeWebUrl(invite.meetingLink) && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <LinkIcon className="w-4 h-4 shrink-0" />
                <a
                  href={invite.meetingLink}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="text-primary hover:underline break-all"
                >
                  {invite.meetingLink}
                </a>
              </div>
            )}
            {invite.notes && (
              <div className="flex items-start gap-2 text-muted-foreground">
                <StickyNote className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="text-foreground whitespace-pre-wrap">
                  {invite.notes}
                </span>
              </div>
            )}
          </div>

          {/* Status-specific body */}
          {invite.status === "accepted" && selectedSlot && (
            <div className="rounded-lg border border-green-200 bg-green-50 p-4 flex gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-green-900">
                  You confirmed this interview.
                </p>
                <p className="text-sm text-green-800 mt-1">
                  {formatSlotRange(selectedSlot.startsAt, selectedSlot.endsAt)}
                </p>
              </div>
            </div>
          )}

          {invite.status === "declined" && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 flex gap-3">
              <XCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-red-900">
                  You declined this interview.
                </p>
                {invite.declineReason && (
                  <p className="text-sm text-red-800 mt-1 italic">
                    "{invite.declineReason}"
                  </p>
                )}
              </div>
            </div>
          )}

          {invite.status === "cancelled" && (
            <div className="rounded-lg border bg-muted/40 p-4 flex gap-3">
              <Ban className="w-5 h-5 text-muted-foreground shrink-0 mt-0.5" />
              <p className="text-sm">
                The employer cancelled this interview invitation.
              </p>
            </div>
          )}

          {invite.status === "proposed" && isCandidate && (
            <>
              <div className="space-y-3">
                <Label className="text-base">Pick a time that works</Label>
                <RadioGroup
                  value={selectedSlotId ? String(selectedSlotId) : ""}
                  onValueChange={(val) => setSelectedSlotId(Number(val))}
                  className="space-y-2"
                >
                  {invite.timeSlots.map((slot) => (
                    <label
                      key={slot.id}
                      htmlFor={`slot-${slot.id}`}
                      className="flex items-center gap-3 rounded-lg border p-3 cursor-pointer hover:bg-muted/50 has-[:checked]:border-primary has-[:checked]:bg-primary/5 transition-colors"
                    >
                      <RadioGroupItem
                        id={`slot-${slot.id}`}
                        value={String(slot.id)}
                      />
                      <Calendar className="w-4 h-4 text-muted-foreground" />
                      <span className="text-sm font-medium">
                        {formatSlotRange(slot.startsAt, slot.endsAt)}
                      </span>
                    </label>
                  ))}
                </RadioGroup>
              </div>

              {showDecline ? (
                <div className="space-y-2 rounded-lg border p-3 bg-muted/20">
                  <Label htmlFor="declineReason">
                    Reason (optional, shared with the employer)
                  </Label>
                  <Textarea
                    id="declineReason"
                    rows={3}
                    placeholder="e.g. The proposed times don't work for me — I'm free next week."
                    value={declineReason}
                    onChange={(e) => setDeclineReason(e.target.value)}
                  />
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setShowDecline(false);
                        setDeclineReason("");
                      }}
                    >
                      Back
                    </Button>
                    <Button
                      variant="destructive"
                      onClick={onDecline}
                      disabled={declineInvite.isPending}
                    >
                      {declineInvite.isPending
                        ? "Declining..."
                        : "Confirm decline"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    onClick={() => setShowDecline(true)}
                    disabled={acceptInvite.isPending}
                  >
                    Decline
                  </Button>
                  <Button
                    onClick={onAccept}
                    disabled={!selectedSlotId || acceptInvite.isPending}
                  >
                    {acceptInvite.isPending ? "Accepting..." : "Accept"}
                  </Button>
                </div>
              )}
            </>
          )}

          {invite.status === "proposed" && !isCandidate && (
            <div className="rounded-lg border bg-muted/40 p-4 text-sm">
              <p className="font-medium">Awaiting candidate response</p>
              <p className="text-muted-foreground mt-1">
                {invite.timeSlots.length} time slot
                {invite.timeSlots.length === 1 ? "" : "s"} have been proposed.
              </p>
              <ul className="mt-2 space-y-1 text-foreground">
                {invite.timeSlots.map((s) => (
                  <li key={s.id}>{formatSlotRange(s.startsAt, s.endsAt)}</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
