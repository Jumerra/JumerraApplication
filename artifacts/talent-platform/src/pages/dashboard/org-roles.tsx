import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
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
import { ShieldCheck, Lock, Pencil, Trash2, Plus, Users, Crown } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";

type PermissionDef = {
  key: string;
  label: string;
  category: string;
  description: string;
};

type OrgRole = {
  id: number;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: string;
  permissions: string[];
  memberCount: number;
};

type OrgRolesResponse = { scope: string; roles: OrgRole[] };
type PermissionsResponse = { scope: string; permissions: PermissionDef[] };

async function fetchJSON<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, {
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!r.ok) {
    const body = (await r.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `${r.status} ${url}`);
  }
  return r.json();
}

function humanize(name: string): string {
  return name
    .split("_")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join(" ");
}

export default function OrgRolesPage() {
  const { sessionUser } = useAuth();
  const isEmployerOwner =
    sessionUser?.role === "employer" && sessionUser.orgRole === "owner";
  const isInstitutionOwner =
    sessionUser?.role === "institution" && sessionUser.orgRole === "owner";
  const isOwner = isEmployerOwner || isInstitutionOwner;
  const scopeLabel = isEmployerOwner
    ? "employer"
    : isInstitutionOwner
      ? "institution"
      : "organization";

  const qc = useQueryClient();
  const { data: permData } = useQuery({
    queryKey: ["org-roles", "permissions"],
    queryFn: () =>
      fetchJSON<PermissionsResponse>("/api/org-roles/permissions"),
    enabled: isOwner,
  });
  const { data: roleData, isLoading } = useQuery({
    queryKey: ["org-roles"],
    queryFn: () => fetchJSON<OrgRolesResponse>("/api/org-roles"),
    enabled: isOwner,
  });

  const [editing, setEditing] = useState<OrgRole | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<OrgRole | null>(null);

  const createMut = useMutation({
    mutationFn: (body: {
      name: string;
      description: string | null;
      permissions: string[];
    }) =>
      fetchJSON("/api/org-roles", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      toast.success("Role created");
      setCreating(false);
      qc.invalidateQueries({ queryKey: ["org-roles"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const updateMut = useMutation({
    mutationFn: (body: {
      id: number;
      description: string | null;
      permissions: string[];
    }) =>
      fetchJSON(`/api/org-roles/${body.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          description: body.description,
          permissions: body.permissions,
        }),
      }),
    onSuccess: () => {
      toast.success("Role updated");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["org-roles"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) =>
      fetchJSON(`/api/org-roles/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      toast.success("Role deleted");
      setDeleting(null);
      qc.invalidateQueries({ queryKey: ["org-roles"] });
    },
    onError: (err: Error) => toast.error(err.message),
  });

  if (!isOwner) {
    return (
      <div className="container max-w-md py-16">
        <Card>
          <CardContent className="p-8 text-center">
            <Lock className="w-10 h-10 mx-auto mb-3 text-destructive" />
            <p className="font-medium">Owner access required</p>
            <p className="text-sm text-muted-foreground mt-2">
              Only the {scopeLabel} owner can edit which permissions each role grants.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const permissions = permData?.permissions ?? [];
  const roles = roleData?.roles ?? [];

  return (
    <div className="container max-w-6xl py-8 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-primary" /> Roles &amp; permissions
          </h1>
          <p className="text-muted-foreground mt-1">
            Decide exactly which dashboard sections each {scopeLabel} role can
            access. The Owner role always has every permission.
          </p>
        </div>
        <Button onClick={() => setCreating(true)} className="gap-2">
          <Plus className="w-4 h-4" /> New role
        </Button>
      </div>

      {isLoading && <p className="text-muted-foreground">Loading…</p>}

      <div className="grid gap-4 md:grid-cols-2">
        {roles.map((role) => (
          <Card key={role.id}>
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    {humanize(role.name)}
                    {role.isSystem && (
                      <Badge variant="secondary" className="text-[10px]">
                        System
                      </Badge>
                    )}
                    {role.name === "owner" && (
                      <Badge className="text-[10px] gap-1">
                        <Crown className="w-3 h-3" /> All access
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription className="mt-1">
                    {role.description || "No description."}
                  </CardDescription>
                </div>
                <div className="flex gap-1 shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setEditing(role)}
                    disabled={role.name === "owner"}
                    aria-label="Edit"
                  >
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setDeleting(role)}
                    disabled={role.isSystem}
                    aria-label="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
                <span className="inline-flex items-center gap-1">
                  <Users className="w-3.5 h-3.5" /> {role.memberCount} member
                  {role.memberCount === 1 ? "" : "s"}
                </span>
                <span>·</span>
                <span>
                  {role.name === "owner" ? `All ${permissions.length}` : role.permissions.length}{" "}
                  permission{role.permissions.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(role.name === "owner"
                  ? permissions.map((p) => p.key)
                  : role.permissions
                )
                  .slice(0, 8)
                  .map((key) => {
                    const p = permissions.find((x) => x.key === key);
                    return (
                      <Badge key={key} variant="outline" className="text-[10px]">
                        {p?.label ?? key}
                      </Badge>
                    );
                  })}
                {role.permissions.length > 8 && role.name !== "owner" && (
                  <Badge variant="outline" className="text-[10px]">
                    +{role.permissions.length - 8} more
                  </Badge>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {editing && (
        <RoleEditor
          role={editing}
          permissions={permissions}
          isPending={updateMut.isPending}
          onClose={() => setEditing(null)}
          onSave={(body) =>
            updateMut.mutate({
              id: editing.id,
              description: body.description,
              permissions: body.permissions,
            })
          }
        />
      )}

      {creating && (
        <RoleEditor
          role={null}
          permissions={permissions}
          isPending={createMut.isPending}
          onClose={() => setCreating(false)}
          onSave={(body) => createMut.mutate(body)}
        />
      )}

      <AlertDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete role "{deleting ? humanize(deleting.name) : ""}"?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. If any teammate still holds this role
              you'll need to move them to another role first.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && deleteMut.mutate(deleting.id)}
              disabled={deleteMut.isPending}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function RoleEditor({
  role,
  permissions,
  isPending,
  onClose,
  onSave,
}: {
  role: OrgRole | null;
  permissions: PermissionDef[];
  isPending: boolean;
  onClose: () => void;
  onSave: (body: {
    name: string;
    description: string | null;
    permissions: string[];
  }) => void;
}) {
  const [name, setName] = useState(role?.name ?? "");
  const [description, setDescription] = useState(role?.description ?? "");
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(role?.permissions ?? []),
  );

  useEffect(() => {
    setName(role?.name ?? "");
    setDescription(role?.description ?? "");
    setSelected(new Set(role?.permissions ?? []));
  }, [role]);

  const grouped = useMemo(() => {
    const out = new Map<string, PermissionDef[]>();
    for (const p of permissions) {
      const arr = out.get(p.category) ?? [];
      arr.push(p);
      out.set(p.category, arr);
    }
    return Array.from(out.entries());
  }, [permissions]);

  const isEdit = !!role;

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function submit() {
    if (!isEdit) {
      if (!/^[a-z][a-z0-9_]{1,30}$/.test(name)) {
        toast.error(
          "Name must be lowercase letters, digits, or underscores (2-31 chars)",
        );
        return;
      }
    }
    onSave({
      name,
      description: description.trim() ? description.trim() : null,
      permissions: Array.from(selected),
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit role" : "Create role"}</DialogTitle>
          <DialogDescription>
            Toggle which dashboard sections this role can access.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor="role-name">Name</Label>
            <Input
              id="role-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isEdit}
              placeholder="e.g. sourcer"
              className="mt-1.5"
            />
            {isEdit && (
              <p className="text-xs text-muted-foreground mt-1">
                Names cannot be changed after creation.
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="role-desc">Description</Label>
            <Textarea
              id="role-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short summary of what this role does"
              className="mt-1.5"
              rows={2}
            />
          </div>
          <div>
            <Label>Permissions</Label>
            <div className="mt-2 space-y-4 border rounded-md p-4 bg-muted/30">
              {grouped.map(([cat, perms]) => (
                <div key={cat}>
                  <p className="text-xs uppercase tracking-wider font-semibold text-muted-foreground mb-2">
                    {cat}
                  </p>
                  <div className="space-y-1.5">
                    {perms.map((p) => (
                      <label
                        key={p.key}
                        className="flex items-start gap-2 cursor-pointer"
                      >
                        <Checkbox
                          checked={selected.has(p.key)}
                          onCheckedChange={() => toggle(p.key)}
                          className="mt-0.5"
                        />
                        <div className="flex-1">
                          <p className="text-sm font-medium">{p.label}</p>
                          <p className="text-xs text-muted-foreground">
                            {p.description}
                          </p>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={isPending}>
            {isPending ? "Saving…" : isEdit ? "Save changes" : "Create role"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
