import { useState } from "react";
import { Link, Redirect } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  useListMyInstitutionFaculties,
  useCreateMyInstitutionFaculty,
  useUpdateMyInstitutionFaculty,
  useDeleteMyInstitutionFaculty,
  useGetInstitution,
  getListMyInstitutionFacultiesQueryKey,
  getGetInstitutionQueryKey,
  type InstitutionFaculty,
} from "@workspace/api-client-react";
import { academicUnitTerms } from "@/lib/institution-kinds";
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
  Building2,
} from "lucide-react";

interface FormState {
  name: string;
  code: string;
  deanName: string;
  description: string;
}

const EMPTY_FORM: FormState = {
  name: "",
  code: "",
  deanName: "",
  description: "",
};

export default function InstitutionFacultiesPage() {
  const { sessionUser } = useAuth();
  const queryClient = useQueryClient();
  // Owner OR registrar can manage faculties (registrar is owner-equivalent
  // for academic ops).
  const canManage =
    sessionUser?.role === "institution" &&
    (sessionUser.orgRole === "owner" || sessionUser.orgRole === "registrar");

  const institutionId =
    sessionUser?.role === "institution" ? sessionUser.institutionId : null;
  const { data: institution } = useGetInstitution(institutionId ?? 0, {
    query: {
      queryKey: getGetInstitutionQueryKey(institutionId ?? 0),
      enabled: institutionId != null,
    },
  });
  const terms = academicUnitTerms(institution?.type);

  const { data: faculties = [], isLoading } = useListMyInstitutionFaculties({
    query: {
      queryKey: getListMyInstitutionFacultiesQueryKey(),
      enabled:
        sessionUser?.role === "institution" && institution != null
          ? terms.hasFaculties
          : false,
    },
  });

  const [editTarget, setEditTarget] = useState<InstitutionFaculty | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<InstitutionFaculty | null>(
    null,
  );

  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: getListMyInstitutionFacultiesQueryKey(),
    });

  const create = useCreateMyInstitutionFaculty({
    mutation: {
      onSuccess: () => {
        toast.success("Faculty created");
        invalidate();
        setCreateOpen(false);
        setForm(EMPTY_FORM);
      },
      onError: (err) =>
        toast.error("Could not create faculty", {
          description: err instanceof Error ? err.message : undefined,
        }),
    },
  });

  const update = useUpdateMyInstitutionFaculty({
    mutation: {
      onSuccess: () => {
        toast.success("Faculty updated");
        invalidate();
        setEditTarget(null);
      },
      onError: (err) =>
        toast.error("Could not update faculty", {
          description: err instanceof Error ? err.message : undefined,
        }),
    },
  });

  const remove = useDeleteMyInstitutionFaculty({
    mutation: {
      onSuccess: () => {
        toast.success("Faculty removed");
        invalidate();
        setDeleteTarget(null);
      },
      onError: () => toast.error("Could not delete faculty"),
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
  // SHS-style schools don't have faculties — bounce back to Departments.
  if (institution && !terms.hasFaculties) {
    return <Redirect to="/dashboard/institution/departments" />;
  }

  function openCreate() {
    setForm(EMPTY_FORM);
    setCreateOpen(true);
  }

  function openEdit(f: InstitutionFaculty) {
    setForm({
      name: f.name,
      code: f.code ?? "",
      deanName: f.deanName ?? "",
      description: f.description ?? "",
    });
    setEditTarget(f);
  }

  function buildPayload() {
    return {
      name: form.name.trim(),
      code: form.code.trim() || null,
      deanName: form.deanName.trim() || null,
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
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">
              {terms.facultyPlural}
            </h1>
            <p className="text-muted-foreground">
              Top-level academic units that group your departments.
            </p>
          </div>
        </div>
        {canManage ? (
          <Button onClick={openCreate} className="gap-2">
            <Plus className="w-4 h-4" /> Add faculty
          </Button>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>All faculties</CardTitle>
          <CardDescription>
            {faculties.length} {faculties.length === 1 ? "faculty" : "faculties"}
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Name</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Dean</TableHead>
                <TableHead className="hidden md:table-cell">
                  Description
                </TableHead>
                {canManage ? (
                  <TableHead className="pr-6 text-right">Actions</TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell
                    colSpan={canManage ? 5 : 4}
                    className="text-center py-8 text-muted-foreground"
                  >
                    Loading faculties…
                  </TableCell>
                </TableRow>
              ) : faculties.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={canManage ? 5 : 4}
                    className="text-center py-12 text-muted-foreground"
                  >
                    No faculties yet.
                    {canManage ? ' Click "Add faculty" to create one.' : ""}
                  </TableCell>
                </TableRow>
              ) : (
                faculties.map((f) => (
                  <TableRow key={f.id}>
                    <TableCell className="pl-6 font-medium">{f.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {f.code ?? "—"}
                    </TableCell>
                    <TableCell className="text-sm">
                      {f.deanName ?? "—"}
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground max-w-md truncate">
                      {f.description ?? "—"}
                    </TableCell>
                    {canManage ? (
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
              <DialogTitle>Add faculty</DialogTitle>
              <DialogDescription>
                Create a new faculty. Departments can later be grouped under
                it.
              </DialogDescription>
            </DialogHeader>
            <FacultyFormFields form={form} setForm={setForm} />
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
              <DialogTitle>Edit faculty</DialogTitle>
              <DialogDescription>Update the faculty details.</DialogDescription>
            </DialogHeader>
            <FacultyFormFields form={form} setForm={setForm} />
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

      <AlertDialog
        open={deleteTarget != null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete faculty?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove "{deleteTarget?.name}" from your institution.
              Departments and staff currently assigned to this faculty will
              become unassigned. This action cannot be undone.
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

function FacultyFormFields({
  form,
  setForm,
}: {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
}) {
  return (
    <div className="grid gap-4 py-4">
      <div className="grid gap-2">
        <Label htmlFor="faculty-name">Name</Label>
        <Input
          id="faculty-name"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          required
          maxLength={200}
          placeholder="Faculty of Engineering"
        />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="grid gap-2">
          <Label htmlFor="faculty-code">Code (optional)</Label>
          <Input
            id="faculty-code"
            value={form.code}
            onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
            maxLength={30}
            placeholder="ENG"
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="faculty-dean">Dean (optional)</Label>
          <Input
            id="faculty-dean"
            value={form.deanName}
            onChange={(e) =>
              setForm((f) => ({ ...f, deanName: e.target.value }))
            }
            maxLength={200}
            placeholder="Prof. Jane Doe"
          />
        </div>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="faculty-description">Description (optional)</Label>
        <Textarea
          id="faculty-description"
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
