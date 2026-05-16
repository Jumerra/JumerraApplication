import { useMemo, useState } from "react";
import {
  useListInstitutionCohorts,
  useCreateInstitutionCohort,
  useGetInstitutionCohortCurve,
  useAddInstitutionCohortMembers,
  useRemoveInstitutionCohortMember,
  useListInstitutionStudents,
  getListInstitutionCohortsQueryKey,
  getGetInstitutionCohortCurveQueryKey,
  getListInstitutionStudentsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Plus, Users, Trash2, Loader2 } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
} from "recharts";
import { toast } from "sonner";

export default function InstitutionCohortsPage() {
  const { sessionUser } = useAuth();
  const institutionId =
    sessionUser?.role === "institution" ? sessionUser.institutionId : null;
  const id = institutionId ?? 0;
  const enabled = institutionId != null;
  const isOwnerOrRegistrar =
    sessionUser?.orgRole === "owner" || sessionUser?.orgRole === "registrar";

  const queryClient = useQueryClient();
  const { data: cohorts = [], isLoading } = useListInstitutionCohorts(id, {
    query: {
      queryKey: getListInstitutionCohortsQueryKey(id),
      enabled,
    },
  });

  const [selectedCohortId, setSelectedCohortId] = useState<number | null>(null);
  const activeCohortId =
    selectedCohortId ?? (cohorts.length > 0 ? cohorts[cohorts.length - 1].id : null);

  const { data: curve } = useGetInstitutionCohortCurve(
    id,
    activeCohortId ?? 0,
    {
      query: {
        queryKey: getGetInstitutionCohortCurveQueryKey(id, activeCohortId ?? 0),
        enabled: enabled && activeCohortId != null,
      },
    },
  );

  const createMut = useCreateInstitutionCohort({
    mutation: {
      onSuccess: () => {
        toast.success("Cohort created");
        queryClient.invalidateQueries({
          queryKey: getListInstitutionCohortsQueryKey(id),
        });
      },
      onError: (e) => toast.error(e.message ?? "Could not create cohort"),
    },
  });

  if (!enabled) {
    return (
      <div className="container max-w-md py-16">
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            Sign in with an institution account to manage cohorts.
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-6xl space-y-6 py-8">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cohorts</h1>
          <p className="text-sm text-muted-foreground">
            Group students by graduating year and track placement curves.
          </p>
        </div>
        {isOwnerOrRegistrar && <CreateCohortDialog institutionId={id} createMut={createMut} />}
      </div>

      {isLoading ? (
        <div className="h-32 animate-pulse rounded-2xl bg-muted" />
      ) : cohorts.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted-foreground">
            No cohorts yet.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle>All cohorts</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {cohorts.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  data-testid={`button-cohort-${c.id}`}
                  onClick={() => setSelectedCohortId(c.id)}
                  className={`flex w-full items-center justify-between rounded-lg border p-3 text-left transition-colors ${
                    activeCohortId === c.id
                      ? "border-primary bg-primary/5"
                      : "hover:bg-muted/50"
                  }`}
                >
                  <div>
                    <p className="font-semibold">{c.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Year {c.year}
                    </p>
                  </div>
                  <Badge variant="outline" className="gap-1">
                    <Users className="h-3 w-3" /> {c.memberCount}
                  </Badge>
                </button>
              ))}
            </CardContent>
          </Card>

          <Card className="lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle>
                  {curve ? `${curve.cohortName} placement curve` : "Placement curve"}
                </CardTitle>
                <CardDescription>
                  {curve
                    ? `${curve.placedMembers} of ${curve.totalMembers} placed`
                    : "Pick a cohort to see its curve."}
                </CardDescription>
              </div>
              {activeCohortId != null && (
                <ManageMembersDialog
                  institutionId={id}
                  cohortId={activeCohortId}
                />
              )}
            </CardHeader>
            <CardContent>
              {!curve ? (
                <div className="h-64 animate-pulse rounded bg-muted" />
              ) : curve.placementsLocked ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Placement analytics is locked. Activate your subscription to
                  see the curve.
                </p>
              ) : curve.points.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  Add members to this cohort to see the placement curve.
                </p>
              ) : (
                <div className="h-64">
                  <ResponsiveContainer>
                    <LineChart data={curve.points}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                      <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} />
                      <RechartsTooltip />
                      <Line
                        type="monotone"
                        dataKey="cumulativePlacements"
                        stroke="hsl(var(--primary))"
                        strokeWidth={2}
                        dot={false}
                        name="Placed (cumulative)"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function CreateCohortDialog({
  institutionId,
  createMut,
}: {
  institutionId: number;
  createMut: ReturnType<typeof useCreateInstitutionCohort>;
}) {
  const [open, setOpen] = useState(false);
  const nextYear = new Date().getUTCFullYear() + 1;
  const [year, setYear] = useState<string>(String(nextYear));
  const [name, setName] = useState<string>(`Class of ${nextYear}`);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-testid="button-create-cohort">
          <Plus className="mr-2 h-4 w-4" /> New cohort
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create cohort</DialogTitle>
          <DialogDescription>
            Group students by graduating year. One cohort per year.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="cohort-year">Year</Label>
            <Input
              id="cohort-year"
              type="number"
              value={year}
              onChange={(e) => {
                setYear(e.target.value);
                if (Number(e.target.value)) {
                  setName(`Class of ${e.target.value}`);
                }
              }}
              data-testid="input-cohort-year"
            />
          </div>
          <div>
            <Label htmlFor="cohort-name">Name</Label>
            <Input
              id="cohort-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              data-testid="input-cohort-name"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={createMut.isPending || !year || !name}
            onClick={async () => {
              await createMut.mutateAsync({
                id: institutionId,
                data: { year: Number(year), name: name.trim() },
              });
              setOpen(false);
            }}
            data-testid="button-confirm-create-cohort"
          >
            {createMut.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ManageMembersDialog({
  institutionId,
  cohortId,
}: {
  institutionId: number;
  cohortId: number;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<number>>(new Set());

  const { data: students = [] } = useListInstitutionStudents(
    institutionId,
    undefined,
    {
      query: {
        queryKey: getListInstitutionStudentsQueryKey(institutionId),
        enabled: open,
      },
    },
  );

  const verifiedStudents = useMemo(
    () => students.filter((s) => s.isVerified),
    [students],
  );

  const addMut = useAddInstitutionCohortMembers({
    mutation: {
      onSuccess: (data) => {
        toast.success(
          `Added ${data.added} student${data.added === 1 ? "" : "s"}`,
        );
        queryClient.invalidateQueries({
          queryKey: getGetInstitutionCohortCurveQueryKey(
            institutionId,
            cohortId,
          ),
        });
        queryClient.invalidateQueries({
          queryKey: getListInstitutionCohortsQueryKey(institutionId),
        });
      },
      onError: (e) => toast.error(e.message ?? "Could not add members"),
    },
  });
  const removeMut = useRemoveInstitutionCohortMember({
    mutation: {
      onSuccess: () => {
        toast.success("Removed");
        queryClient.invalidateQueries({
          queryKey: getGetInstitutionCohortCurveQueryKey(
            institutionId,
            cohortId,
          ),
        });
        queryClient.invalidateQueries({
          queryKey: getListInstitutionCohortsQueryKey(institutionId),
        });
      },
      onError: () => toast.error("Could not remove member"),
    },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" data-testid="button-manage-members">
          Manage members
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] max-w-lg overflow-hidden">
        <DialogHeader>
          <DialogTitle>Add students to cohort</DialogTitle>
          <DialogDescription>
            Only verified students of this institution can be added.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-72 space-y-1 overflow-auto rounded border p-2">
          {verifiedStudents.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No verified students yet.
            </p>
          ) : (
            verifiedStudents.map((s) => {
              const checked = picked.has(s.candidateId);
              return (
                <label
                  key={s.candidateId}
                  className="flex items-center gap-3 rounded p-2 hover:bg-muted/50"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => {
                      setPicked((prev) => {
                        const next = new Set(prev);
                        if (next.has(s.candidateId)) next.delete(s.candidateId);
                        else next.add(s.candidateId);
                        return next;
                      });
                    }}
                    data-testid={`checkbox-cohort-member-${s.candidateId}`}
                  />
                  <img
                    src={s.avatarUrl}
                    alt=""
                    className="h-8 w-8 rounded-full object-cover"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{s.fullName}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {s.headline}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={async (e) => {
                      e.preventDefault();
                      await removeMut.mutateAsync({
                        id: institutionId,
                        cohortId,
                        candidateId: s.candidateId,
                      });
                    }}
                    title="Remove from cohort"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </label>
              );
            })
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Close
          </Button>
          <Button
            disabled={picked.size === 0 || addMut.isPending}
            onClick={async () => {
              await addMut.mutateAsync({
                id: institutionId,
                cohortId,
                data: { candidateIds: Array.from(picked) },
              });
              setPicked(new Set());
            }}
            data-testid="button-add-cohort-members"
          >
            {addMut.isPending && (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            )}
            Add {picked.size > 0 ? `(${picked.size})` : ""}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
