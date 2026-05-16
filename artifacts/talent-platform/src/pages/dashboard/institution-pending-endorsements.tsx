import { useState } from "react";
import { Link } from "wouter";
import {
  useListPendingEndorsements,
  useEndorseApplication,
  getListPendingEndorsementsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Stamp, ArrowLeft, Briefcase, Inbox } from "lucide-react";
import { toast } from "sonner";

export default function InstitutionPendingEndorsementsPage() {
  const { sessionUser } = useAuth();
  const institutionId = sessionUser?.institutionId ?? 0;
  const queryClient = useQueryClient();
  const queryKey = getListPendingEndorsementsQueryKey(institutionId);
  const { data, isLoading } = useListPendingEndorsements(institutionId, {
    query: { queryKey, enabled: institutionId > 0 },
  });
  const endorseMutation = useEndorseApplication();

  const [target, setTarget] = useState<{ id: number; name: string } | null>(null);
  const [note, setNote] = useState("");

  function openSheet(id: number, name: string) {
    setTarget({ id, name });
    setNote("");
  }

  async function submit() {
    if (!target) return;
    try {
      await endorseMutation.mutateAsync({
        id: target.id,
        data: { note: note.trim() || undefined },
      });
      toast.success(`Endorsed ${target.name}`);
      setTarget(null);
      queryClient.invalidateQueries({ queryKey });
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not endorse application",
      );
    }
  }

  function skip(id: number) {
    // "Skip" is a UI-only dismissal — it just hides the row in this
    // session. The application stays pending until someone endorses
    // it (or the application reaches a terminal state). We don't
    // persist a "skipped" record because what feels skip-worthy to
    // one staff member may be exactly what another wants to endorse.
    queryClient.setQueryData(
      queryKey,
      (prev: typeof data | undefined) =>
        (prev ?? []).filter((row) => row.applicationId !== id),
    );
  }

  return (
    <div className="container max-w-4xl px-4 py-8 space-y-6">
      <Link
        to="/dashboard/institution"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-primary"
      >
        <ArrowLeft className="w-4 h-4" /> Back to dashboard
      </Link>

      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Stamp className="w-6 h-6 text-primary" /> Pending endorsements
        </h1>
        <p className="text-sm text-muted-foreground">
          Co-sign your students' active applications. Endorsed
          applications are flagged with a "Verified by{" "}
          {sessionUser?.role === "institution" ? "your institution" : "us"}"
          badge on the employer's pipeline.
        </p>
      </div>

      {isLoading ? (
        <Card>
          <CardContent className="p-8">
            <div className="h-32 animate-pulse bg-muted rounded" />
          </CardContent>
        </Card>
      ) : !data || data.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground space-y-2">
            <Inbox className="w-10 h-10 mx-auto text-muted-foreground/40" />
            <p className="font-medium">You're all caught up</p>
            <p className="text-sm">
              New applications from your verified students will appear
              here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {data.map((row) => (
            <Card
              key={row.applicationId}
              className="shadow-sm"
              data-testid={`endorsement-row-${row.applicationId}`}
            >
              <CardContent className="p-4 flex items-start gap-4">
                <Avatar className="h-12 w-12">
                  <AvatarImage src={row.candidateAvatarUrl} />
                  <AvatarFallback>
                    {row.candidateName.slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Link
                      href={`/candidates/${row.candidateId}`}
                      className="font-semibold hover:underline truncate"
                    >
                      {row.candidateName}
                    </Link>
                    {row.departmentName ? (
                      <Badge variant="outline" className="text-xs">
                        {row.departmentName}
                      </Badge>
                    ) : null}
                    <Badge variant="secondary" className="text-xs">
                      Match {row.matchScore}%
                    </Badge>
                  </div>
                  {row.candidateHeadline ? (
                    <p className="text-sm text-muted-foreground truncate">
                      {row.candidateHeadline}
                    </p>
                  ) : null}
                  <p className="text-sm flex items-center gap-1.5 text-muted-foreground">
                    <Briefcase className="w-3.5 h-3.5" />
                    Applied to{" "}
                    <span className="font-medium text-foreground">
                      {row.jobTitle}
                    </span>{" "}
                    at {row.employerName}
                  </p>
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  <Button
                    size="sm"
                    onClick={() => openSheet(row.applicationId, row.candidateName)}
                    data-testid={`button-endorse-${row.applicationId}`}
                  >
                    <Stamp className="w-4 h-4 mr-1.5" /> Endorse
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => skip(row.applicationId)}
                    data-testid={`button-skip-${row.applicationId}`}
                  >
                    Skip
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={target !== null} onOpenChange={(o) => !o && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Endorse {target?.name}</DialogTitle>
            <DialogDescription>
              The employer will see "Verified by your institution" on
              this application. Add an optional one-line note to give
              context (e.g. "Top of class — Year 3 Computer Science").
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional note (max 280 characters)"
            maxLength={280}
            rows={3}
            data-testid="textarea-endorsement-note"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setTarget(null)}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={endorseMutation.isPending}
              data-testid="button-confirm-endorse"
            >
              {endorseMutation.isPending ? "Endorsing…" : "Endorse"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
