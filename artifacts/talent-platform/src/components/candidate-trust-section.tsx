import { useState } from "react";
import {
  useGetCandidate,
  useListOwnReferenceRequests,
  useRequestReference,
  useHideReference,
  getGetCandidateQueryKey,
  getListOwnReferenceRequestsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { BadgeCheck, ShieldCheck, Mail, Copy, EyeOff, Quote } from "lucide-react";
import { toast } from "sonner";

const RELATIONSHIP_LABEL: Record<string, string> = {
  lecturer: "Lecturer",
  past_employer: "Past employer",
  colleague: "Colleague",
  other: "Other",
};

export function CandidateTrustSection({ candidateId }: { candidateId: number }) {
  const { data: candidate } = useGetCandidate(candidateId, {
    query: {
      queryKey: getGetCandidateQueryKey(candidateId),
      enabled: candidateId > 0,
    },
  });
  const { data: refs = [] } = useListOwnReferenceRequests(candidateId, {
    query: {
      queryKey: getListOwnReferenceRequestsQueryKey(candidateId),
      enabled: candidateId > 0,
    },
  });
  const queryClient = useQueryClient();
  const requestReference = useRequestReference();
  const hideReference = useHideReference();
  const [refereeEmail, setRefereeEmail] = useState("");
  const [relationship, setRelationship] = useState("lecturer");
  const [lastShareUrl, setLastShareUrl] = useState<string | null>(null);

  if (!candidate) return null;

  const verified = candidate.verifiedSkills ?? [];
  const bg = candidate.backgroundCheck?.status ?? "not_started";

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!refereeEmail.includes("@")) {
      toast.error("Please enter a valid email.");
      return;
    }
    try {
      const created = await requestReference.mutateAsync({
        id: candidateId,
        data: {
          refereeEmail: refereeEmail.trim(),
          relationship: relationship as
            | "lecturer"
            | "past_employer"
            | "colleague"
            | "other",
        },
      });
      setLastShareUrl(created.shareUrl ?? null);
      setRefereeEmail("");
      await queryClient.invalidateQueries({
        queryKey: getListOwnReferenceRequestsQueryKey(candidateId),
      });
      toast.success("Reference request created. Share the link with your referee.");
    } catch (err: any) {
      toast.error(err?.data?.error ?? "Could not create reference request.");
    }
  }

  async function onHide(refId: number) {
    try {
      await hideReference.mutateAsync({ id: candidateId, refId });
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: getListOwnReferenceRequestsQueryKey(candidateId),
        }),
        queryClient.invalidateQueries({
          queryKey: getGetCandidateQueryKey(candidateId),
        }),
      ]);
      toast.success("Reference hidden from your public profile.");
    } catch (err: any) {
      toast.error(err?.data?.error ?? "Could not hide reference.");
    }
  }

  function copy(url: string) {
    navigator.clipboard.writeText(url).then(
      () => toast.success("Link copied"),
      () => toast.error("Couldn't copy"),
    );
  }

  return (
    <>
      <Card className="shadow-md">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
              <BadgeCheck className="w-5 h-5" />
            </div>
            <div>
              <CardTitle className="text-lg">Trust signals</CardTitle>
              <CardDescription>
                Verified skills, references, and background-check status that
                employers see on your profile.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
              Background check
            </p>
            <Badge
              variant="secondary"
              className={`gap-1 ${
                bg === "passed"
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
                  : bg === "failed"
                    ? "bg-destructive/15 text-destructive"
                    : bg === "in_progress"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-muted"
              }`}
            >
              <ShieldCheck className="w-3 h-3" />
              {bg.replace("_", " ")}
            </Badge>
            <p className="text-xs text-muted-foreground mt-2">
              Updated by Jumerra admins after verifying any documents you submit.
            </p>
          </div>

          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">
              Verified skills ({verified.length})
            </p>
            {verified.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Ask your institution to verify the skills they've taught you.
                Verified skills appear with a green check on your profile and
                in employer search.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {verified.map((v) => (
                  <Badge
                    key={v.id}
                    className="gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-50 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-900"
                  >
                    <BadgeCheck className="w-3 h-3" /> {v.skill}
                    <span className="text-[10px] opacity-70">· {v.institutionName}</span>
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-md">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-primary/10 flex items-center justify-center text-primary">
              <Quote className="w-5 h-5" />
            </div>
            <div>
              <CardTitle className="text-lg">Reference requests</CardTitle>
              <CardDescription>
                Send a private link to a lecturer or past employer. They submit
                a structured reference that we display on your profile.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          <form
            onSubmit={onCreate}
            className="grid sm:grid-cols-[1fr_180px_auto] gap-2 items-end"
          >
            <div className="space-y-1">
              <Label htmlFor="ref-email">Referee email</Label>
              <Input
                id="ref-email"
                type="email"
                placeholder="lecturer@university.edu"
                value={refereeEmail}
                onChange={(e) => setRefereeEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ref-rel">Relationship</Label>
              <Select value={relationship} onValueChange={setRelationship}>
                <SelectTrigger id="ref-rel">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="lecturer">Lecturer</SelectItem>
                  <SelectItem value="past_employer">Past employer</SelectItem>
                  <SelectItem value="colleague">Colleague</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="submit" disabled={requestReference.isPending}>
              <Mail className="w-4 h-4 mr-1" />
              {requestReference.isPending ? "Creating…" : "Send"}
            </Button>
          </form>

          {lastShareUrl ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 dark:bg-emerald-900/10 dark:border-emerald-900/40 p-3 flex items-center gap-2">
              <input
                readOnly
                value={lastShareUrl}
                className="flex-1 bg-transparent text-xs"
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => copy(lastShareUrl)}
              >
                <Copy className="w-3 h-3 mr-1" /> Copy
              </Button>
            </div>
          ) : null}

          {refs.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              You haven't requested any references yet.
            </p>
          ) : (
            <div className="space-y-2">
              {refs.map((r) => (
                <div
                  key={r.id}
                  className="flex flex-wrap items-center gap-3 rounded-lg border p-3"
                >
                  <Badge variant="outline" className="text-[10px]">
                    {RELATIONSHIP_LABEL[r.relationship] ?? r.relationship}
                  </Badge>
                  <span className="text-sm font-medium">{r.refereeEmailMasked}</span>
                  {r.submittedAt ? (
                    <Badge className="bg-emerald-600 text-white hover:bg-emerald-600 text-[10px]">
                      Submitted{r.submittedRefereeName ? ` by ${r.submittedRefereeName}` : ""}
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px]">
                      Pending
                    </Badge>
                  )}
                  {r.hiddenAt ? (
                    <Badge variant="outline" className="text-[10px]">
                      Hidden from profile
                    </Badge>
                  ) : null}
                  <div className="ml-auto">
                    {r.submittedAt && !r.hiddenAt ? (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => onHide(r.id)}
                      >
                        <EyeOff className="w-3 h-3 mr-1" /> Hide
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
