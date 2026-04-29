import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  useListMyInstitutionDepartments,
  useCreateMyInstitutionDepartment,
  useUpdateMyInstitutionDepartment,
  useDeleteMyInstitutionDepartment,
  getListMyInstitutionDepartmentsQueryKey,
  type InstitutionDepartment,
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
  BookOpen,
} from "lucide-react";

interface FormState {
  name: string;
  code: string;
  headName: string;
  description: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  code: "",
  headName: "",
  description: "",
};

export default function InstitutionDepartmentsPage() {
  const { sessionUser } = useAuth();
  const queryClient = useQueryClient();
  const isOwner =
    sessionUser?.role === "institution" && sessionUser.orgRole === "owner";

  const { data: departments = [], isLoading } =
    useListMyInstitutionDepartments({
      query: {
        queryKey: getListMyInstitutionDepartmentsQueryKey(),
        enabled: sessionUser?.role === "institution",
      },
    });

  const [editTarget, setEditTarget] = useState<InstitutionDepartment | null>(
    null,
  );
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] =
    useState<InstitutionDepartment | null>(null);

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: getListMyInstitutionDepartmentsQueryKey(),
    });

  const create = useCreateMyInstitutionDepartment({
    mutation: {
      onSuccess: () => {
        toast.success("Department created");
        invalidate();
        setCreateOpen(false);
        setForm(EMPTY_FORM);
      },
      onError: (err) =>
        toast.error("Could not create department", {
          description: err instanceof Error ? err.message : undefined,
        }),
    },
  });

  const update = useUpdateMyInstitutionDepartment({
    mutation: {
      onSuccess: () => {
        toast.success("Department updated");
        invalidate();
        setEditTarget(null);
      },
      onError: (err) =>
        toast.error("Could not update department", {
          description: err instanceof Error ? err.message : undefined,
        }),
    },
  });

  const remove = useDeleteMyInstitutionDepartment({
    mutation: {
      onSuccess: () => {
        toast.success("Department removed");
        invalidate();
        setDeleteTarget(null);
      },
      onError: () => toast.error("Could not delete department"),
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

  function openEdit(dept: InstitutionDepartment) {
    setForm({
      name: dept.name,
      code: dept.code ?? "",
      headName: dept.headName ?? "",
      description: dept.description ?? "",
    });
    setEditTarget(dept);
  }

  function buildPayload() {
    return {
      name: form.name.trim(),
      code: form.code.trim() || null,
      headName: form.headName.trim() || null,
      description: form.description.trim() || null,
    };
  }

  function handleCreateSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    create.mutate({ data: buildPayload() });
  }

  function handleUpdateSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!editTarget) return;
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    update.mutate({ id: editTarget.id, data: buildPayload() });
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
            <BookOpen className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Departments</h1>
            <p className="text-muted-foreground">
              Academic departments and programmes offered by your institution.
            </p>
          </div>
        </div>
        {isOwner ? (
          <Button onClick={openCreate} className="gap-2">
            <Plus className="w-4 h-4" /> Add department
          </Button>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All departments</CardTitle>
          <CardDescription>
            {departments.length} department{departments.length === 1 ? "" : "s"}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Head</TableHead>
                <TableHead className="hidden md:table-cell">Description</TableHead>
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
                    Loading departments…
                  </TableCell>
                </TableRow>
              ) : departments.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={isOwner ? 5 : 4}
                    className="text-center py-12 text-muted-foreground"
                  >
                    No departments yet.
                    {isOwner ? " Click \"Add department\" to create one." : ""}
                  </TableCell>
                </TableRow>
              ) : (
                departments.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="pl-6 font-medium">{d.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {d.code ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {d.headName ?? "—"}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground max-w-md truncate">
                      {d.description ?? "—"}
                    </TableCell>
                    {isOwner ? (
                      <TableCell className="pr-6 text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEdit(d)}
                            aria-label={`Edit ${d.name}`}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setDeleteTarget(d)}
                            aria-label={`Delete ${d.name}`}
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
              <DialogTitle>Add department</DialogTitle>
              <DialogDescription>
                Create a new department. Names must be unique within your
                institution.
              </DialogDescription>
            </DialogHeader>
            <DepartmentFormFields form={form} setForm={setForm} />
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
              <DialogTitle>Edit department</DialogTitle>
              <DialogDescription>
                Update the department details.
              </DialogDescription>
            </DialogHeader>
            <DepartmentFormFields form={form} setForm={setForm} />
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
            <AlertDialogTitle>Delete department?</AlertDialogTitle>
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

function DepartmentFormFields({
  form,
  setForm,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
}) {
  return (
    <div className="grid gap-4 py-4">
      <div className="grid gap-2">
        <Label htmlFor="dept-name">Name</Label>
        <Input
          id="dept-name"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          required
          maxLength={200}
          placeholder="Computer Science"
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="dept-code">Code (optional)</Label>
          <Input
            id="dept-code"
            value={form.code}
            onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
            maxLength={30}
            placeholder="CS"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="dept-head">Head (optional)</Label>
          <Input
            id="dept-head"
            value={form.headName}
            onChange={(e) => setForm((f) => ({ ...f, headName: e.target.value }))}
            maxLength={200}
            placeholder="Dr. Jane Doe"
          />
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="dept-description">Description (optional)</Label>
        <Textarea
          id="dept-description"
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
