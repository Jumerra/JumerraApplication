import { useState } from "react";
import {
  useGetCandidate,
  useIssueSkillVerification,
  useRevokeSkillVerification,
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
import { BadgeCheck, X } from "lucide-react";
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
