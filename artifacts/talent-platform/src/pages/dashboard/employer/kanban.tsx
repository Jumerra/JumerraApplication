import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListJobs,
  useListApplications,
  useUpdateApplicationStatus,
  getListApplicationsQueryKey,
  getListJobsQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

const STAGES = [
  { id: "applied", label: "Applied" },
  { id: "screening", label: "Screening" },
  { id: "interview", label: "Interview" },
  { id: "offer", label: "Offer" },
  { id: "hired", label: "Hired" },
  { id: "rejected", label: "Rejected" },
] as const;

type StageId = (typeof STAGES)[number]["id"];

export default function PipelineKanbanPage() {
  const { sessionUser } = useAuth();
  const employerId = sessionUser?.employerId ?? 0;
  const qc = useQueryClient();

  const { data: jobs } = useListJobs(
    { employerId },
    {
      query: {
        enabled: employerId > 0,
        queryKey: getListJobsQueryKey({ employerId }),
      },
    },
  );
  const [jobId, setJobId] = useState<string>("");
  // Sort applies within each Kanban column. "boardOrder" is the
  // legacy manual ordering; the others surface the strongest
  // signals at the top so screening is faster.
  const [sortBy, setSortBy] = useState<
    "boardOrder" | "challengeScore" | "matchScore"
  >("boardOrder");
  // Filter to applicants who have submitted a challenge. Useful
  // when a job has a challenge attached and the employer only
  // wants to look at candidates who actually completed it.
  const [challengeFilter, setChallengeFilter] = useState<
    "all" | "with_challenge"
  >("all");

  const numericJobId = jobId ? Number(jobId) : undefined;
  const { data: apps, isLoading } = useListApplications(
    {},
    {
      query: {
        enabled: employerId > 0,
        queryKey: getListApplicationsQueryKey({}),
      },
    },
  );
  const updateStatus = useUpdateApplicationStatus();

  // Server returns all applications visible to this employer; filter
  // to the chosen job (or first job by default) client-side.
  const effectiveJobId = useMemo(() => {
    if (numericJobId) return numericJobId;
    return jobs && jobs.length > 0 ? jobs[0]!.id : undefined;
  }, [jobs, numericJobId]);

  const filtered = useMemo(() => {
    if (!apps || !effectiveJobId) return [];
    let rows = apps.filter((a) => a.jobId === effectiveJobId);
    if (challengeFilter === "with_challenge") {
      rows = rows.filter((a) => typeof a.challengeScore === "number");
    }
    return rows;
  }, [apps, effectiveJobId, challengeFilter]);

  const byStage = useMemo(() => {
    const map: Record<StageId, typeof filtered> = {
      applied: [],
      screening: [],
      interview: [],
      offer: [],
      hired: [],
      rejected: [],
    };
    for (const a of filtered) {
      if ((STAGES as readonly { id: string }[]).some((s) => s.id === a.status)) {
        map[a.status as StageId].push(a);
      }
    }
    for (const s of STAGES) {
      map[s.id].sort((x, y) => {
        if (sortBy === "challengeScore") {
          // Highest score first; nulls sink to the bottom.
          const xs = typeof x.challengeScore === "number" ? x.challengeScore : -1;
          const ys = typeof y.challengeScore === "number" ? y.challengeScore : -1;
          if (ys !== xs) return ys - xs;
        } else if (sortBy === "matchScore") {
          if ((y.matchScore ?? 0) !== (x.matchScore ?? 0)) {
            return (y.matchScore ?? 0) - (x.matchScore ?? 0);
          }
        }
        return (x.boardOrder ?? 0) - (y.boardOrder ?? 0);
      });
    }
    return map;
  }, [filtered, sortBy]);

  const onDrop = (e: React.DragEvent, stage: StageId, position: number) => {
    e.preventDefault();
    const idStr = e.dataTransfer.getData("text/application-id");
    if (!idStr) return;
    const appId = Number(idStr);
    const app = filtered.find((a) => a.id === appId);
    if (!app) return;

    // Compute a new boardOrder slotting between neighbors. Using
    // simple integer gaps (default 0); cards in this column ordered
    // by boardOrder so we recompute as (prev+next)/2 when possible.
    const colCards = byStage[stage].filter((c) => c.id !== appId);
    const prev = colCards[position - 1]?.boardOrder ?? 0;
    const next = colCards[position]?.boardOrder ?? prev + 1024;
    const newOrder = Math.floor((prev + next) / 2) || prev + 1;

    updateStatus.mutate(
      {
        id: appId,
        data: { status: stage, boardOrder: newOrder },
      },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListApplicationsQueryKey() });
        },
        onError: () => toast.error("Could not move card"),
      },
    );
  };

  return (
    <div className="container px-4 py-8 max-w-7xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pipeline</h1>
          <p className="text-muted-foreground mt-1">
            Drag and drop applicants between stages.
          </p>
        </div>
        <div className="w-full sm:w-auto flex flex-col sm:flex-row gap-2">
          <Select
            value={jobId || (effectiveJobId ? String(effectiveJobId) : "")}
            onValueChange={setJobId}
          >
            <SelectTrigger data-testid="select-kanban-job" className="sm:w-60">
              <SelectValue placeholder="Pick a job…" />
            </SelectTrigger>
            <SelectContent>
              {jobs?.map((j) => (
                <SelectItem key={j.id} value={String(j.id)}>
                  {j.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={sortBy}
            onValueChange={(v) =>
              setSortBy(v as "boardOrder" | "challengeScore" | "matchScore")
            }
          >
            <SelectTrigger data-testid="select-kanban-sort" className="sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="boardOrder">Manual order</SelectItem>
              <SelectItem value="challengeScore">Challenge score</SelectItem>
              <SelectItem value="matchScore">Match score</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={challengeFilter}
            onValueChange={(v) =>
              setChallengeFilter(v as "all" | "with_challenge")
            }
          >
            <SelectTrigger data-testid="select-kanban-filter" className="sm:w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All applicants</SelectItem>
              <SelectItem value="with_challenge">Took challenge</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {!effectiveJobId ? (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            Post a job to start tracking your pipeline.
          </CardContent>
        </Card>
      ) : isLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {STAGES.map((s) => (
            <div
              key={s.id}
              className="h-96 rounded-xl bg-muted/30 animate-pulse"
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 min-h-[420px]">
          {STAGES.map((stage) => {
            const cards = byStage[stage.id];
            return (
              <div
                key={stage.id}
                className="rounded-xl bg-muted/30 border border-border/40 flex flex-col"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => onDrop(e, stage.id, cards.length)}
                data-testid={`kanban-column-${stage.id}`}
              >
                <div className="px-3 py-2 border-b border-border/40 flex items-center justify-between">
                  <span className="font-semibold text-sm">{stage.label}</span>
                  <Badge variant="secondary" className="text-xs">
                    {cards.length}
                  </Badge>
                </div>
                <div className="p-2 space-y-2 flex-1">
                  {cards.map((app, idx) => (
                    <div
                      key={app.id}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(
                          "text/application-id",
                          String(app.id),
                        );
                        e.dataTransfer.effectAllowed = "move";
                      }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => {
                        e.stopPropagation();
                        onDrop(e, stage.id, idx);
                      }}
                      data-testid={`kanban-card-${app.id}`}
                    >
                      <Card className="cursor-grab active:cursor-grabbing hover:shadow-sm">
                        <CardContent className="p-3 space-y-1">
                          <div className="flex items-center gap-1.5">
                            <Link
                              href={`/candidates/${app.candidateId}`}
                              className="font-medium text-sm hover:underline block truncate flex-1 min-w-0"
                            >
                              {app.candidateName}
                            </Link>
                            {app.source === "for_you" ? (
                              <Badge
                                variant="default"
                                className="text-[10px] px-1.5 py-0 shrink-0"
                                title="Swipe-right from the For You stack — high intent"
                                data-testid={`badge-source-for-you-${app.id}`}
                              >
                                For You
                              </Badge>
                            ) : null}
                          </div>
                          <div className="text-xs text-muted-foreground truncate flex items-center gap-1.5 flex-wrap">
                            <span>Match {app.matchScore}%</span>
                            {typeof app.mockInterviewScore === "number" ? (
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0 border-primary/40 text-primary"
                                title={
                                  app.mockInterviewBreakdown
                                    ? `Tech ${app.mockInterviewBreakdown.technical} · Comm ${app.mockInterviewBreakdown.communication} · Culture ${app.mockInterviewBreakdown.culture}`
                                    : undefined
                                }
                                data-testid={`badge-mock-interview-${app.id}`}
                              >
                                AI {app.mockInterviewScore}
                              </Badge>
                            ) : null}
                            {typeof app.challengeScore === "number" ? (
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0 border-amber-500/50 text-amber-700 dark:text-amber-400"
                                title={
                                  // Per-question breakdown tooltip
                                  // ("Q1 ✓ · Q2 ✗ · ..."). Lets the
                                  // reviewer see WHICH questions the
                                  // candidate got right at a glance.
                                  Array.isArray(app.challengeBreakdown) &&
                                  app.challengeBreakdown.length > 0
                                    ? app.challengeBreakdown
                                        .map(
                                          (b) =>
                                            `Q${b.index + 1} ${b.isCorrect ? "✓" : "✗"}`,
                                        )
                                        .join(" · ")
                                    : "Skill-challenge score (0–100)"
                                }
                                data-testid={`badge-challenge-${app.id}`}
                              >
                                Challenge {app.challengeScore}
                                {Array.isArray(app.challengeBreakdown) &&
                                app.challengeBreakdown.length > 0
                                  ? ` (${app.challengeBreakdown.filter((b) => b.isCorrect).length}/${app.challengeBreakdown.length})`
                                  : ""}
                              </Badge>
                            ) : null}
                            {app.endorsement ? (
                              <Badge
                                variant="outline"
                                className="text-[10px] px-1.5 py-0 border-emerald-500/50 text-emerald-700 dark:text-emerald-400"
                                title={
                                  app.endorsement.note
                                    ? `${app.endorsement.institutionName}: ${app.endorsement.note}`
                                    : `Endorsed by ${app.endorsement.institutionName}`
                                }
                                data-testid={`badge-endorsement-${app.id}`}
                              >
                                Verified by {app.endorsement.institutionName}
                              </Badge>
                            ) : null}
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  ))}
                  {cards.length === 0 ? (
                    <div className="text-center text-xs text-muted-foreground py-6">
                      Drop here
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
