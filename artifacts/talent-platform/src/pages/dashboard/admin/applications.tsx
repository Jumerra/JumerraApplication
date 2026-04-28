import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  useAdminListApplications,
  useAdminDeleteApplication,
  useUpdateApplicationStatus,
  getAdminListApplicationsQueryKey,
  type Application,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { Search, Trash2, ExternalLink, Briefcase, Filter } from "lucide-react";

const STATUSES = [
  "all",
  "applied",
  "screening",
  "interview",
  "offer",
  "hired",
  "rejected",
  "withdrawn",
] as const;

type StatusFilter = (typeof STATUSES)[number];
type AppStatus = Exclude<StatusFilter, "all">;

const STATUS_VALUES: AppStatus[] = [
  "applied",
  "screening",
  "interview",
  "offer",
  "hired",
  "rejected",
  "withdrawn",
];

const STATUS_BADGE: Record<string, string> = {
  applied: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200",
  screening: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  interview: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  offer: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  hired: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  rejected: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  withdrawn: "bg-zinc-100 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400",
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function AdminApplicationsPage() {
  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  // Debounce text search to avoid hammering the server.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(t);
  }, [search]);

  const params = {
    status,
    q: debouncedSearch || undefined,
    limit: 200,
  } as const;

  const { data, isLoading } = useAdminListApplications(params);
  const updateStatus = useUpdateApplicationStatus();
  const deleteApplication = useAdminDeleteApplication();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const applications: Application[] = data?.applications ?? [];

  async function refresh() {
    await queryClient.invalidateQueries({
      queryKey: getAdminListApplicationsQueryKey(),
    });
  }

  async function handleStatusChange(app: Application, next: AppStatus) {
    if (app.status === next) return;
    try {
      await updateStatus.mutateAsync({ id: app.id, data: { status: next } });
      await refresh();
      toast({
        title: "Status updated",
        description: `${app.candidateName} → ${next}`,
      });
    } catch (err) {
      toast({
        title: "Update failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  async function handleDelete(app: Application) {
    try {
      await deleteApplication.mutateAsync({ id: app.id });
      await refresh();
      toast({
        title: "Application removed",
        description: `${app.candidateName}'s application to ${app.jobTitle}.`,
      });
    } catch (err) {
      toast({
        title: "Delete failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  const totalForStatus = applications.length;

  return (
    <div className="container px-4 py-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 border-2 border-primary/20 flex items-center justify-center shrink-0 text-primary">
          <Briefcase className="w-7 h-7" />
        </div>
        <div className="flex-1">
          <h1 className="text-3xl font-bold tracking-tight">Manage Applications</h1>
          <p className="text-muted-foreground mt-1">
            Triage applications across every employer. Change pipeline status or
            remove spam in bulk.
          </p>
        </div>
        <Badge variant="secondary" className="text-sm">
          {totalForStatus} shown
        </Badge>
      </div>

      <Card>
        <CardHeader className="pb-4 space-y-3">
          <div className="grid gap-3 md:grid-cols-[1fr_220px]">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search candidate, employer, or job…"
                className="pl-10"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="relative">
              <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Select
                value={status}
                onValueChange={(v) => setStatus(v as StatusFilter)}
              >
                <SelectTrigger className="pl-10 capitalize">
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  {STATUSES.map((s) => (
                    <SelectItem key={s} value={s} className="capitalize">
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading…</div>
          ) : applications.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">
              No applications match the current filters.
            </div>
          ) : (
            <div className="divide-y">
              {applications.map((app) => (
                <div
                  key={app.id}
                  className="grid gap-3 px-6 py-4 hover:bg-muted/40 transition-colors items-center md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_180px_auto]"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <img
                      src={app.candidateAvatarUrl || "/avatar-placeholder.svg"}
                      alt={app.candidateName}
                      className="w-10 h-10 rounded-full object-cover bg-muted shrink-0"
                      onError={(e) => {
                        (e.currentTarget as HTMLImageElement).style.visibility =
                          "hidden";
                      }}
                    />
                    <div className="min-w-0">
                      <div className="font-medium truncate">{app.candidateName}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        Match {app.matchScore}% · {formatDate(app.appliedAt)}
                      </div>
                    </div>
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium truncate">{app.jobTitle}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {app.employerName}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge
                      variant="secondary"
                      className={`shrink-0 capitalize ${STATUS_BADGE[app.status] ?? ""}`}
                    >
                      {app.status}
                    </Badge>
                    <Select
                      value={app.status}
                      onValueChange={(v) =>
                        handleStatusChange(app, v as AppStatus)
                      }
                    >
                      <SelectTrigger className="h-8 text-xs capitalize w-[120px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STATUS_VALUES.map((s) => (
                          <SelectItem key={s} value={s} className="capitalize">
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center justify-end gap-1 shrink-0">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/jobs/${app.jobId}`}>
                        <ExternalLink className="w-4 h-4" />
                        <span className="sr-only">View job</span>
                      </Link>
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="w-4 h-4" />
                          <span className="sr-only">Delete</span>
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove application?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This permanently deletes {app.candidateName}'s
                            application to "{app.jobTitle}" at {app.employerName}.
                            This cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => handleDelete(app)}
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
