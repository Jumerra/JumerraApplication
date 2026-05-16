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
    return apps.filter((a) => a.jobId === effectiveJobId);
  }, [apps, effectiveJobId]);

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
      map[s.id].sort((x, y) => (x.boardOrder ?? 0) - (y.boardOrder ?? 0));
    }
    return map;
  }, [filtered]);

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
        <div className="w-full sm:w-72">
          <Select
            value={jobId || (effectiveJobId ? String(effectiveJobId) : "")}
            onValueChange={setJobId}
          >
            <SelectTrigger data-testid="select-kanban-job">
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
                          <Link
                            href={`/candidates/${app.candidateId}`}
                            className="font-medium text-sm hover:underline block truncate"
                          >
                            {app.candidateName}
                          </Link>
                          <div className="text-xs text-muted-foreground truncate">
                            Match {app.matchScore}%
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
