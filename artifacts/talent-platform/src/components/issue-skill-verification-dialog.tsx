import { useState } from "react";
import {
  useGetCandidate,
  useIssueSkillVerification,
  useRevokeSkillVerification,
  useHideReference,
  getGetCandidateQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { BadgeCheck, X, EyeOff, Quote } from "lucide-react";
import { toast } from "sonner";

export function IssueSkillVerificationDialog({
  institutionId,
  candidateId,
  candidateName,
}: {
  institutionId: number;
  candidateId: number;
  candidateName: string;
}) {
  const [open, setOpen] = useState(false);
  const [skill, setSkill] = useState("");
  const queryClient = useQueryClient();
  const { data: candidate } = useGetCandidate(candidateId, {
    query: {
      queryKey: getGetCandidateQueryKey(candidateId),
      enabled: open,
    },
  });
  const issue = useIssueSkillVerification();
  const revoke = useRevokeSkillVerification();
  const hideRef = useHideReference();
  const visibleRefs = candidate?.references ?? [];

  const ours =
    candidate?.verifiedSkills?.filter(
      (v) => v.institutionId === institutionId,
    ) ?? [];

  async function refresh() {
    await queryClient.invalidateQueries({
      queryKey: getGetCandidateQueryKey(candidateId),
    });
  }

  async function onIssue(e: React.FormEvent) {
    e.preventDefault();
    const s = skill.trim();
    if (s.length < 1) return;
    try {
      await issue.mutateAsync({
        id: institutionId,
        candidateId,
        data: { skill: s },
      });
      setSkill("");
      await refresh();
      toast.success(`Verified "${s}" for ${candidateName}.`);
    } catch (err: any) {
      toast.error(err?.data?.error ?? "Could not issue verification.");
    }
  }

  async function onRevoke(verifId: number, label: string) {
    try {
      await revoke.mutateAsync({ id: institutionId, candidateId, verificationId: verifId });
      await refresh();
      toast.success(`Revoked "${label}".`);
    } catch (err: any) {
      toast.error(err?.data?.error ?? "Could not revoke verification.");
    }
  }

  async function onHideRef(refId: number, who: string) {
    try {
      await hideRef.mutateAsync({ id: candidateId, refId });
      await refresh();
      toast.success(`Hid reference from ${who}.`);
    } catch (err: any) {
      toast.error(err?.data?.error ?? "Could not hide reference.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" className="h-7 px-2 text-xs">
          <BadgeCheck className="w-3 h-3 mr-1" /> Verify skill
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Verify a skill for {candidateName}</DialogTitle>
          <DialogDescription>
            Verifications are public on the candidate's profile and tagged to
            your institution.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onIssue} className="flex gap-2">
          <Input
            placeholder="e.g. Python, AutoCAD, SQL"
            value={skill}
            onChange={(e) => setSkill(e.target.value)}
            maxLength={120}
          />
          <Button type="submit" disabled={issue.isPending}>
            {issue.isPending ? "Adding…" : "Verify"}
          </Button>
        </form>
        {visibleRefs.length > 0 ? (
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2 flex items-center gap-1">
              <Quote className="w-3 h-3" /> References on profile ({visibleRefs.length})
            </p>
            <div className="space-y-2">
              {visibleRefs.map((r) => (
                <div
                  key={r.id}
                  className="flex items-center gap-2 rounded-md border p-2"
                >
                  <div className="text-xs flex-1 min-w-0">
                    <p className="font-medium truncate">{r.submittedRefereeName}</p>
                    <p className="text-muted-foreground truncate">
                      {r.submittedRefereeRole ?? r.relationship}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => onHideRef(r.id, r.submittedRefereeName)}
                  >
                    <EyeOff className="w-3 h-3 mr-1" /> Hide
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div>
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
            Already verified by your institution ({ours.length})
          </p>
          {ours.length === 0 ? (
            <p className="text-sm text-muted-foreground">None yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {ours.map((v) => (
                <Badge
                  key={v.id}
                  variant="secondary"
                  className="gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300"
                >
                  <BadgeCheck className="w-3 h-3" /> {v.skill}
                  <span className="text-[10px] opacity-70">
                    · {new Date(v.issuedAt).toLocaleDateString(undefined, { month: "short", year: "numeric" })}
                  </span>
                  <button
                    type="button"
                    onClick={() => onRevoke(v.id, v.skill)}
                    className="ml-1 opacity-70 hover:opacity-100"
                    aria-label={`Revoke ${v.skill}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
