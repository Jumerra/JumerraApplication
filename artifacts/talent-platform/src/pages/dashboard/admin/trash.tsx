import { useState } from "react";
import {
  useAdminListTrashCandidates,
  useAdminListTrashEmployers,
  useAdminListTrashInstitutions,
  useAdminListTrashJobs,
  useAdminRestoreCandidate,
  useAdminRestoreEmployer,
  useAdminRestoreInstitution,
  useAdminRestoreJob,
  getAdminListTrashCandidatesQueryKey,
  getAdminListTrashEmployersQueryKey,
  getAdminListTrashInstitutionsQueryKey,
  getAdminListTrashJobsQueryKey,
  type TrashItem,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import {
  Trash2,
  Undo2,
  Users,
  Building2,
  GraduationCap,
  Briefcase,
} from "lucide-react";
import { useAuth } from "@/lib/auth";

type EntityKind = "candidates" | "employers" | "institutions" | "jobs";

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function TrashList({
  kind,
  items,
  isLoading,
  onRestore,
  restoring,
}: {
  kind: EntityKind;
  items: TrashItem[] | undefined;
  isLoading: boolean;
  onRestore: (id: number, label: string) => void;
  restoring: number | null;
}) {
  if (isLoading) {
    return (
      <div className="p-8 text-center text-muted-foreground">Loading…</div>
    );
  }
  if (!items || items.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground">
        Nothing in the {kind} trash. Soft-deleted records will appear here.
      </div>
    );
  }
  return (
    <div className="divide-y">
      {items.map((item) => {
        const deleter = item.deletedByName ?? "unknown admin";
        return (
          <div
            key={item.id}
            className="flex items-center gap-4 px-6 py-4 hover:bg-muted/40 transition-colors"
          >
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0 text-muted-foreground">
              <Trash2 className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold truncate">{item.label}</h3>
              <p className="text-sm text-muted-foreground truncate">
                {item.secondary ? `${item.secondary} · ` : ""}deleted{" "}
                {formatWhen(item.deletedAt)} by {deleter}
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => onRestore(item.id, item.label)}
              disabled={restoring === item.id}
            >
              <Undo2 className="w-4 h-4 mr-2" />
              {restoring === item.id ? "Restoring…" : "Restore"}
            </Button>
          </div>
        );
      })}
    </div>
  );
}

export default function AdminTrashPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { hasPermission } = useAuth();
  const [restoring, setRestoring] = useState<number | null>(null);

  // Each tab corresponds to a separate `*:manage` permission. Gate the
  // queries with `enabled` so an admin without `employers:manage` doesn't
  // generate 403 noise in the network log just by visiting the page.
  const canCandidates = hasPermission("candidates:manage");
  const canEmployers = hasPermission("employers:manage");
  const canInstitutions = hasPermission("institutions:manage");
  // Job soft-delete + restore is gated on employers:manage server-side
  // (a job's lifecycle is owned by the employer), so the UI gate matches.
  const canJobs = hasPermission("employers:manage");

  const candidates = useAdminListTrashCandidates({
    query: {
      queryKey: getAdminListTrashCandidatesQueryKey(),
      enabled: canCandidates,
    },
  });
  const employers = useAdminListTrashEmployers({
    query: {
      queryKey: getAdminListTrashEmployersQueryKey(),
      enabled: canEmployers,
    },
  });
  const institutions = useAdminListTrashInstitutions({
    query: {
      queryKey: getAdminListTrashInstitutionsQueryKey(),
      enabled: canInstitutions,
    },
  });
  const jobs = useAdminListTrashJobs({
    query: {
      queryKey: getAdminListTrashJobsQueryKey(),
      enabled: canJobs,
    },
  });

  const restoreCandidate = useAdminRestoreCandidate();
  const restoreEmployer = useAdminRestoreEmployer();
  const restoreInstitution = useAdminRestoreInstitution();
  const restoreJob = useAdminRestoreJob();

  async function handleRestore(kind: EntityKind, id: number, label: string) {
    setRestoring(id);
    try {
      if (kind === "candidates") {
        await restoreCandidate.mutateAsync({ id });
        await queryClient.invalidateQueries({
          queryKey: getAdminListTrashCandidatesQueryKey(),
        });
      } else if (kind === "employers") {
        await restoreEmployer.mutateAsync({ id });
        await queryClient.invalidateQueries({
          queryKey: getAdminListTrashEmployersQueryKey(),
        });
      } else if (kind === "institutions") {
        await restoreInstitution.mutateAsync({ id });
        await queryClient.invalidateQueries({
          queryKey: getAdminListTrashInstitutionsQueryKey(),
        });
      } else {
        await restoreJob.mutateAsync({ id });
        await queryClient.invalidateQueries({
          queryKey: getAdminListTrashJobsQueryKey(),
        });
      }
      toast({
        title: "Restored",
        description: `${label} is active again.`,
      });
    } catch (err) {
      toast({
        title: "Restore failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    } finally {
      setRestoring(null);
    }
  }

  const totalCount =
    (canCandidates ? candidates.data?.length ?? 0 : 0) +
    (canEmployers ? employers.data?.length ?? 0 : 0) +
    (canInstitutions ? institutions.data?.length ?? 0 : 0) +
    (canJobs ? jobs.data?.length ?? 0 : 0);

  // Pick the first visible tab as the default so we never land on a
  // hidden tab. If the admin has no trash permissions at all (which
  // shouldn't be reachable — the nav item is also gated), fall back to
  // candidates and show an empty state.
  const defaultTab: EntityKind = canCandidates
    ? "candidates"
    : canEmployers
      ? "employers"
      : canInstitutions
        ? "institutions"
        : canJobs
          ? "jobs"
          : "candidates";

  return (
    <div className="container px-4 py-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 border-2 border-primary/20 flex items-center justify-center shrink-0 text-primary">
          <Trash2 className="w-7 h-7" />
        </div>
        <div className="flex-1">
          <h1 className="text-3xl font-bold tracking-tight">Trash</h1>
          <p className="text-muted-foreground mt-1">
            Soft-deleted candidates, employers, jobs, and institutions.
            Restoring clears the deletion timestamp and brings the record
            back into product views. Restoring an employer also brings back
            any jobs that were cascade-deleted at the same moment.
          </p>
        </div>
        <Badge variant="secondary" className="text-sm">
          {totalCount} total
        </Badge>
      </div>

      <Card>
        <Tabs defaultValue={defaultTab}>
          <CardHeader className="pb-2">
            <TabsList>
              {canCandidates && (
                <TabsTrigger value="candidates" className="gap-2">
                  <Users className="w-4 h-4" />
                  Candidates
                  <Badge variant="outline" className="ml-1">
                    {candidates.data?.length ?? 0}
                  </Badge>
                </TabsTrigger>
              )}
              {canEmployers && (
                <TabsTrigger value="employers" className="gap-2">
                  <Building2 className="w-4 h-4" />
                  Employers
                  <Badge variant="outline" className="ml-1">
                    {employers.data?.length ?? 0}
                  </Badge>
                </TabsTrigger>
              )}
              {canJobs && (
                <TabsTrigger value="jobs" className="gap-2">
                  <Briefcase className="w-4 h-4" />
                  Jobs
                  <Badge variant="outline" className="ml-1">
                    {jobs.data?.length ?? 0}
                  </Badge>
                </TabsTrigger>
              )}
              {canInstitutions && (
                <TabsTrigger value="institutions" className="gap-2">
                  <GraduationCap className="w-4 h-4" />
                  Institutions
                  <Badge variant="outline" className="ml-1">
                    {institutions.data?.length ?? 0}
                  </Badge>
                </TabsTrigger>
              )}
            </TabsList>
            <CardTitle className="sr-only">Trash</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {canCandidates && (
              <TabsContent value="candidates" className="m-0">
                <TrashList
                  kind="candidates"
                  items={candidates.data}
                  isLoading={candidates.isLoading}
                  onRestore={(id, label) =>
                    handleRestore("candidates", id, label)
                  }
                  restoring={restoring}
                />
              </TabsContent>
            )}
            {canEmployers && (
              <TabsContent value="employers" className="m-0">
                <TrashList
                  kind="employers"
                  items={employers.data}
                  isLoading={employers.isLoading}
                  onRestore={(id, label) =>
                    handleRestore("employers", id, label)
                  }
                  restoring={restoring}
                />
              </TabsContent>
            )}
            {canJobs && (
              <TabsContent value="jobs" className="m-0">
                <TrashList
                  kind="jobs"
                  items={jobs.data}
                  isLoading={jobs.isLoading}
                  onRestore={(id, label) => handleRestore("jobs", id, label)}
                  restoring={restoring}
                />
              </TabsContent>
            )}
            {canInstitutions && (
              <TabsContent value="institutions" className="m-0">
                <TrashList
                  kind="institutions"
                  items={institutions.data}
                  isLoading={institutions.isLoading}
                  onRestore={(id, label) =>
                    handleRestore("institutions", id, label)
                  }
                  restoring={restoring}
                />
              </TabsContent>
            )}
          </CardContent>
        </Tabs>
      </Card>
    </div>
  );
}
