import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  useListMyInstitutionFacilities,
  useCreateMyInstitutionFacility,
  useUpdateMyInstitutionFacility,
  useDeleteMyInstitutionFacility,
  getListMyInstitutionFacilitiesQueryKey,
  type InstitutionFacility,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ArrowLeft,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  Building,
} from "lucide-react";

interface FormState {
  name: string;
  kind: string;
  location: string;
  description: string;
  capacity: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  kind: "",
  location: "",
  description: "",
  capacity: "",
};

export default function InstitutionFacilitiesPage() {
  const { sessionUser } = useAuth();
  const queryClient = useQueryClient();
  const isOwner =
    sessionUser?.role === "institution" && sessionUser.orgRole === "owner";

  const { data: facilities = [], isLoading } = useListMyInstitutionFacilities({
    query: {
      queryKey: getListMyInstitutionFacilitiesQueryKey(),
      enabled: sessionUser?.role === "institution",
    },
  });

  const [editTarget, setEditTarget] = useState<InstitutionFacility | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] =
    useState<InstitutionFacility | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: getListMyInstitutionFacilitiesQueryKey(),
    });

  const create = useCreateMyInstitutionFacility({
    mutation: {
      onSuccess: () => {
        toast.success("Facility created");
        invalidate();
        setCreateOpen(false);
        setForm(EMPTY_FORM);
      },
      onError: (err) =>
        toast.error("Could not create facility", {
          description: err instanceof Error ? err.message : undefined,
        }),
    },
  });

  const update = useUpdateMyInstitutionFacility({
    mutation: {
      onSuccess: () => {
        toast.success("Facility updated");
        invalidate();
        setEditTarget(null);
      },
      onError: (err) =>
        toast.error("Could not update facility", {
          description: err instanceof Error ? err.message : undefined,
        }),
    },
  });

  const remove = useDeleteMyInstitutionFacility({
    mutation: {
      onSuccess: () => {
        toast.success("Facility removed");
        invalidate();
        setDeleteTarget(null);
      },
      onError: () => toast.error("Could not delete facility"),
    },
  });

  if (sessionUser && sessionUser.role !== "institution") {
    return (
      <div className="container py-12 px-4 text-center">
        <p className="text-muted-foreground">
          This page is for institution accounts only.
        </p>
      </div>
    );
  }

  function openCreate() {
    setForm(EMPTY_FORM);
    setCreateOpen(true);
  }

  function openEdit(f: InstitutionFacility) {
    setForm({
      name: f.name,
      kind: f.kind,
      location: f.location ?? "",
      description: f.description ?? "",
      capacity: f.capacity != null ? String(f.capacity) : "",
    });
    setEditTarget(f);
  }

  function buildPayload() {
    // Capacity is optional; convert blank → null. Anything non-numeric is
    // rejected client-side so the server doesn't 400 unnecessarily.
    let capacity: number | null = null;
    if (form.capacity.trim() !== "") {
      const n = Number(form.capacity);
      if (!Number.isInteger(n) || n < 0) {
        return null;
      }
      capacity = n;
    }
    return {
      name: form.name.trim(),
      kind: form.kind.trim(),
      location: form.location.trim() || null,
      description: form.description.trim() || null,
      capacity,
    };
  }

  function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim() || !form.kind.trim()) {
      toast.error("Name and kind are required");
      return;
    }
    const payload = buildPayload();
    if (!payload) {
      toast.error("Capacity must be a non-negative whole number");
      return;
    }
    create.mutate({ data: payload });
  }

  function handleUpdateSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editTarget) return;
    if (!form.name.trim() || !form.kind.trim()) {
      toast.error("Name and kind are required");
      return;
    }
    const payload = buildPayload();
    if (!payload) {
      toast.error("Capacity must be a non-negative whole number");
      return;
    }
    update.mutate({ id: editTarget.id, data: payload });
  }

  return (
    <div className="container px-4 py-8 max-w-5xl mx-auto space-y-6">
      <div>
        <Button asChild variant="ghost" size="sm" className="gap-2 -ml-2">
          <Link href="/dashboard/institution">
            <ArrowLeft className="w-4 h-4" /> Back to dashboard
          </Link>
        </Button>
      </div>

      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-muted border flex items-center justify-center text-muted-foreground">
            <Building className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Facilities</h1>
            <p className="text-muted-foreground">
              Labs, libraries, halls, and other spaces operated by your
              institution.
            </p>
          </div>
        </div>
        {isOwner ? (
          <Button onClick={openCreate} className="gap-2">
            <Plus className="w-4 h-4" /> Add facility
          </Button>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All facilities</CardTitle>
          <CardDescription>
            {facilities.length} facilit{facilities.length === 1 ? "y" : "ies"}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Name</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Location</TableHead>
                <TableHead>Capacity</TableHead>
                {isOwner ? (
                  <TableHead className="pr-6 text-right">Actions</TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell
                    colSpan={isOwner ? 5 : 4}
                    className="text-center py-8 text-muted-foreground"
                  >
                    Loading facilities…
                  </TableCell>
                </TableRow>
              ) : facilities.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={isOwner ? 5 : 4}
                    className="text-center py-12 text-muted-foreground"
                  >
                    No facilities yet.
                    {isOwner ? " Click \"Add facility\" to create one." : ""}
                  </TableCell>
                </TableRow>
              ) : (
                facilities.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="pl-6 font-medium">{f.name}</TableCell>
                    <TableCell className="text-sm capitalize">
                      {f.kind}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {f.location ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {f.capacity != null ? f.capacity : "—"}
                    </TableCell>
                    {isOwner ? (
                      <TableCell className="pr-6 text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEdit(f)}
                            aria-label={`Edit ${f.name}`}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteTarget(f)}
                            aria-label={`Delete ${f.name}`}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Create dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <form onSubmit={handleCreateSubmit}>
            <DialogHeader>
              <DialogTitle>Add facility</DialogTitle>
              <DialogDescription>
                Create a new facility. Names must be unique within your
                institution.
              </DialogDescription>
            </DialogHeader>
            <FacilityFormFields form={form} setForm={setForm} />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending} className="gap-2">
                {create.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Plus className="w-4 h-4" />
                )}
                Create
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit dialog */}
      <Dialog
        open={editTarget != null}
        onOpenChange={(open) => !open && setEditTarget(null)}
      >
        <DialogContent>
          <form onSubmit={handleUpdateSubmit}>
            <DialogHeader>
              <DialogTitle>Edit facility</DialogTitle>
              <DialogDescription>
                Update the facility details.
              </DialogDescription>
            </DialogHeader>
            <FacilityFormFields form={form} setForm={setForm} />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setEditTarget(null)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={update.isPending} className="gap-2">
                {update.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Pencil className="w-4 h-4" />
                )}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog
        open={deleteTarget != null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete facility?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove "{deleteTarget?.name}" from your institution.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={remove.isPending}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={remove.isPending}
              onClick={(e) => {
                e.preventDefault();
                if (deleteTarget) remove.mutate({ id: deleteTarget.id });
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {remove.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                "Delete"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function FacilityFormFields({
  form,
  setForm,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
}) {
  return (
    <div className="grid gap-4 py-4">
      <div className="grid gap-2">
        <Label htmlFor="fac-name">Name</Label>
        <Input
          id="fac-name"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          required
          maxLength={200}
          placeholder="Main library"
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="fac-kind">Kind</Label>
          <Input
            id="fac-kind"
            value={form.kind}
            onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}
            required
            maxLength={80}
            placeholder="library, lab, dorm…"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="fac-capacity">Capacity (optional)</Label>
          <Input
            id="fac-capacity"
            type="number"
            inputMode="numeric"
            min={0}
            value={form.capacity}
            onChange={(e) =>
              setForm((f) => ({ ...f, capacity: e.target.value }))
            }
          />
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="fac-location">Location (optional)</Label>
        <Input
          id="fac-location"
          value={form.location}
          onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
          maxLength={200}
          placeholder="Block A, 2nd floor"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="fac-description">Description (optional)</Label>
        <Textarea
          id="fac-description"
          value={form.description}
          onChange={(e) =>
            setForm((f) => ({ ...f, description: e.target.value }))
          }
          rows={3}
          maxLength={2000}
        />
      </div>
    </div>
  );
}
