import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateInterviewInvite,
  useListInterviewInvitesForApplication,
  useCancelInterviewInvite,
  getListInterviewInvitesForApplicationQueryKey,
  getGetEmployerDashboardQueryKey,
  getListApplicationsQueryKey,
  type InterviewInvite,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Calendar, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";

type DraftSlot = {
  /** Local key — never sent to server, only used to render rows. */
  key: string;
  /** datetime-local value, e.g. "2026-05-04T10:00" */
  startsAt: string;
  /** Duration in minutes the candidate would be interviewed for. */
  durationMin: number;
};

function newDraftSlot(): DraftSlot {
  return {
    key: Math.random().toString(36).slice(2),
    startsAt: "",
    durationMin: 30,
  };
}

function formatSlotRange(startsAtIso: string, endsAtIso: string): string {
  const start = new Date(startsAtIso);
  const end = new Date(endsAtIso);
  const dateStr = start.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
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

function statusBadgeColor(status: string): string {
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

export function InterviewScheduleDialog({
  applicationId,
  employerUserId,
  candidateName,
  trigger,
}: {
  applicationId: number;
  /** Used to invalidate the employer dashboard cache after a write. */
  employerUserId: number;
  candidateName?: string;
  trigger?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [location, setLocation] = useState("");
  const [meetingLink, setMeetingLink] = useState("");
  const [notes, setNotes] = useState("");
  const [slots, setSlots] = useState<DraftSlot[]>([newDraftSlot()]);

  const queryClient = useQueryClient();
  const createInvite = useCreateInterviewInvite();
  const cancelInvite = useCancelInterviewInvite();
  // Always query so the table-row trigger can show "Accepted",
  // "Awaiting", etc. without the employer having to open the dialog.
  const invitesQuery = useListInterviewInvitesForApplication(applicationId, {
    query: {
      enabled: applicationId > 0,
      queryKey: getListInterviewInvitesForApplicationQueryKey(applicationId),
    },
  });

  const invalidateAll = () => {
    queryClient.invalidateQueries({
      queryKey: getListInterviewInvitesForApplicationQueryKey(applicationId),
    });
    queryClient.invalidateQueries({
      queryKey: getGetEmployerDashboardQueryKey(employerUserId),
    });
    queryClient.invalidateQueries({ queryKey: getListApplicationsQueryKey() });
  };

  const resetForm = () => {
    setLocation("");
    setMeetingLink("");
    setNotes("");
    setSlots([newDraftSlot()]);
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Build the API payload from the draft rows. We compute endsAt from
    // startsAt + duration so the candidate sees a clean range, and we
    // surface validation errors here rather than depending on the API.
    const parsed: { startsAt: string; endsAt: string }[] = [];
    for (const slot of slots) {
      if (!slot.startsAt) {
        toast.error("Every time slot needs a start time");
        return;
      }
      const start = new Date(slot.startsAt);
      if (Number.isNaN(start.getTime())) {
        toast.error("One of the time slots has an invalid start time");
        return;
      }
      if (slot.durationMin <= 0) {
        toast.error("Duration must be greater than 0 minutes");
        return;
      }
      const end = new Date(start.getTime() + slot.durationMin * 60_000);
      parsed.push({
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
      });
    }
    if (parsed.length === 0) {
      toast.error("Add at least one time slot");
      return;
    }

    createInvite.mutate(
      {
        id: applicationId,
        data: {
          location: location.trim() || undefined,
          meetingLink: meetingLink.trim() || undefined,
          notes: notes.trim() || undefined,
          slots: parsed,
        },
      },
      {
        onSuccess: () => {
          toast.success(
            candidateName
              ? `Interview proposed to ${candidateName}`
              : "Interview proposed",
          );
          invalidateAll();
          resetForm();
        },
        onError: () => toast.error("Failed to send interview invitation"),
      },
    );
  };

  const onCancelInvite = (invite: InterviewInvite) => {
    cancelInvite.mutate(
      { id: invite.id },
      {
        onSuccess: () => {
          toast.success("Interview invitation cancelled");
          invalidateAll();
        },
        onError: () => toast.error("Failed to cancel invitation"),
      },
    );
  };

  // Pick a "current" invite to surface in the trigger so the employer
  // can see at a glance whether the candidate has responded, without
  // having to open the dialog. Prefer an active (proposed/accepted)
  // invite; fall back to the most recently declined/cancelled one.
  const allInvites = invitesQuery.data ?? [];
  const currentInvite =
    allInvites.find(
      (i) => i.status === "proposed" || i.status === "accepted",
    ) ?? allInvites[0];
  const acceptedSlot =
    currentInvite?.status === "accepted" && currentInvite.selectedSlotId
      ? currentInvite.timeSlots.find(
          (s) => s.id === currentInvite.selectedSlotId,
        )
      : null;

  const renderDefaultTrigger = () => {
    if (!currentInvite) {
      return (
        <Button size="sm" variant="outline" className="gap-1.5">
          <Calendar className="w-3.5 h-3.5" />
          Schedule
        </Button>
      );
    }
    if (currentInvite.status === "accepted") {
      return (
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 border-green-300 bg-green-50 text-green-800 hover:bg-green-100 hover:text-green-900 dark:border-green-800 dark:bg-green-950 dark:text-green-200"
        >
          <Calendar className="w-3.5 h-3.5" />
          {acceptedSlot
            ? `Accepted · ${new Date(acceptedSlot.startsAt).toLocaleDateString(
                undefined,
                { month: "short", day: "numeric" },
              )}`
            : "Accepted"}
        </Button>
      );
    }
    if (currentInvite.status === "proposed") {
      return (
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 hover:text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
        >
          <Calendar className="w-3.5 h-3.5" />
          Awaiting · {currentInvite.timeSlots.length} slot
          {currentInvite.timeSlots.length === 1 ? "" : "s"}
        </Button>
      );
    }
    if (currentInvite.status === "declined") {
      return (
        <Button size="sm" variant="outline" className="gap-1.5">
          <Calendar className="w-3.5 h-3.5" />
          Declined · re-schedule
        </Button>
      );
    }
    return (
      <Button size="sm" variant="outline" className="gap-1.5">
        <Calendar className="w-3.5 h-3.5" />
        Schedule
      </Button>
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger ?? renderDefaultTrigger()}</DialogTrigger>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Schedule interview</DialogTitle>
          <DialogDescription>
            Propose up to 5 time slots
            {candidateName ? ` for ${candidateName}` : ""}. They'll be notified
            and can pick the one that works best.
          </DialogDescription>
        </DialogHeader>

        {/* Existing invites for this application */}
        {invitesQuery.data && invitesQuery.data.length > 0 && (
          <div className="border rounded-lg p-3 space-y-2 bg-muted/30">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Previous invitations
            </p>
            {invitesQuery.data.map((invite) => (
              <div
                key={invite.id}
                className="flex items-start justify-between gap-3 text-sm"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge
                      variant="secondary"
                      className={statusBadgeColor(invite.status)}
                    >
                      {invite.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      sent {new Date(invite.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  {invite.status === "accepted" && invite.selectedSlotId && (
                    <p className="text-xs text-foreground/80 mt-1">
                      Confirmed for{" "}
                      {(() => {
                        const slot = invite.timeSlots.find(
                          (s) => s.id === invite.selectedSlotId,
                        );
                        return slot
                          ? formatSlotRange(slot.startsAt, slot.endsAt)
                          : "—";
                      })()}
                    </p>
                  )}
                  {invite.status === "declined" && invite.declineReason && (
                    <p className="text-xs text-muted-foreground mt-1 italic">
                      "{invite.declineReason}"
                    </p>
                  )}
                  {invite.status === "proposed" && (
                    <p className="text-xs text-muted-foreground mt-1">
                      {invite.timeSlots.length} slot
                      {invite.timeSlots.length === 1 ? "" : "s"} awaiting
                      response
                    </p>
                  )}
                </div>
                {invite.status === "proposed" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                    onClick={() => onCancelInvite(invite)}
                    disabled={cancelInvite.isPending}
                  >
                    <X className="w-3 h-3 mr-1" />
                    Cancel
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="location">Location</Label>
              <Input
                id="location"
                placeholder="e.g. Lagos office or 'Remote'"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="meetingLink">Meeting link</Label>
              <Input
                id="meetingLink"
                placeholder="https://meet.google.com/..."
                value={meetingLink}
                onChange={(e) => setMeetingLink(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="notes">Notes for the candidate</Label>
            <Textarea
              id="notes"
              placeholder="Anything they should prepare? Format of the call?"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Proposed time slots</Label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() =>
                  setSlots((prev) =>
                    prev.length >= 5 ? prev : [...prev, newDraftSlot()],
                  )
                }
                disabled={slots.length >= 5}
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                Add slot
              </Button>
            </div>
            <div className="space-y-2">
              {slots.map((slot, idx) => (
                <div
                  key={slot.key}
                  className="flex items-end gap-2 p-2 border rounded-md bg-muted/20"
                >
                  <div className="flex-1 space-y-1">
                    <Label
                      htmlFor={`slot-start-${slot.key}`}
                      className="text-xs text-muted-foreground"
                    >
                      Start
                    </Label>
                    <Input
                      id={`slot-start-${slot.key}`}
                      type="datetime-local"
                      value={slot.startsAt}
                      onChange={(e) =>
                        setSlots((prev) =>
                          prev.map((s) =>
                            s.key === slot.key
                              ? { ...s, startsAt: e.target.value }
                              : s,
                          ),
                        )
                      }
                      required
                    />
                  </div>
                  <div className="w-28 space-y-1">
                    <Label
                      htmlFor={`slot-dur-${slot.key}`}
                      className="text-xs text-muted-foreground"
                    >
                      Duration (min)
                    </Label>
                    <Input
                      id={`slot-dur-${slot.key}`}
                      type="number"
                      min={5}
                      max={480}
                      step={5}
                      value={slot.durationMin}
                      onChange={(e) =>
                        setSlots((prev) =>
                          prev.map((s) =>
                            s.key === slot.key
                              ? {
                                  ...s,
                                  durationMin: Number(e.target.value) || 0,
                                }
                              : s,
                          ),
                        )
                      }
                    />
                  </div>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-9 w-9 text-muted-foreground hover:text-destructive"
                    onClick={() =>
                      setSlots((prev) =>
                        prev.length === 1
                          ? prev
                          : prev.filter((s) => s.key !== slot.key),
                      )
                    }
                    disabled={slots.length === 1}
                    aria-label={`Remove slot ${idx + 1}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setOpen(false)}
            >
              Close
            </Button>
            <Button type="submit" disabled={createInvite.isPending}>
              {createInvite.isPending ? "Sending..." : "Send invitation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
