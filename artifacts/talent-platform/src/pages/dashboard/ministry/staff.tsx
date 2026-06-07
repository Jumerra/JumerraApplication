import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
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
import { Badge } from "@/components/ui/badge";
import { PasswordInput } from "@/components/ui/password-input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { toast } from "sonner";
import { Users, Plus, KeyRound, Trash2 } from "lucide-react";

type StaffMember = {
  id: number;
  email: string;
  fullName: string;
  status: string;
  orgRole: string | null;
  mustChangePassword: boolean;
  createdAt: string;
};

type MinistryRole = {
  name: string;
  description: string | null;
  permissions: string[];
};

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  analyst: "Analyst",
};

function roleLabel(role: string | null): string {
  if (!role) return "—";
  return ROLE_LABELS[role] ?? role;
}

export default function MinistryStaffPage() {
  const { sessionUser, hasPermission } = useAuth();
  const canManage = hasPermission("ministry-staff:manage");
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [roles, setRoles] = useState<MinistryRole[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      const [list, roleList] = await Promise.all([
        customFetch<{ staff: StaffMember[] }>("/api/ministry/staff"),
        customFetch<{ roles: MinistryRole[] }>("/api/ministry/roles"),
      ]);
      setStaff(list.staff);
      setRoles(roleList.roles);
    } catch (err: unknown) {
      setError(
        (err as { data?: { error?: string } })?.data?.error ??
          "Failed to load team.",
      );
    }
  }

  useEffect(() => {
    reload();
  }, []);

  return (
    <div className="container py-8 space-y-6 max-w-4xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" />
            Team
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Invite teammates and control what they can see and do within your
            ministry.
          </p>
        </div>
        {canManage && roles.length > 0 && (
          <InviteStaffDialog roles={roles} onChanged={reload} />
        )}
      </div>

      {error && (
        <div className="p-4 rounded-md bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}

      {staff === null ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : staff.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            No teammates yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {staff.map((m) => (
            <StaffRow
              key={m.id}
              member={m}
              roles={roles}
              canManage={canManage}
              isSelf={m.id === sessionUser?.id}
              onChanged={reload}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function InviteStaffDialog({
  roles,
  onChanged,
}: {
  roles: MinistryRole[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>(roles[0]?.name ?? "analyst");
  const [defaultPassword, setDefaultPassword] = useState("");
  const [busy, setBusy] = useState(false);

  function reset() {
    setFullName("");
    setEmail("");
    setRole(roles[0]?.name ?? "analyst");
    setDefaultPassword("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (defaultPassword.length < 8) {
      toast.error("Temporary password must be at least 8 characters");
      return;
    }
    setBusy(true);
    try {
      await customFetch("/api/ministry/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, email, role, defaultPassword }),
      });
      toast.success("Teammate added");
      onChanged();
      setOpen(false);
      reset();
    } catch (err: unknown) {
      toast.error(
        (err as { data?: { error?: string } })?.data?.error ??
          "Failed to add teammate",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button data-testid="button-invite-staff">
          <Plus className="h-4 w-4 mr-1" />
          Add teammate
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a teammate</DialogTitle>
          <DialogDescription>
            Set a temporary password for them. They sign in with it and are
            required to choose their own password on first login.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="s-name">Full name</Label>
            <Input
              id="s-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Kofi Boateng"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="s-email">Email (used to sign in)</Label>
            <Input
              id="s-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@moe.gov.gh"
              required
            />
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger data-testid="select-staff-role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {roles.map((r) => (
                  <SelectItem key={r.name} value={r.name}>
                    {roleLabel(r.name)}
                    {r.description ? ` — ${r.description}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="s-password">Temporary password</Label>
            <PasswordInput
              id="s-password"
              value={defaultPassword}
              onChange={(e) => setDefaultPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              data-testid="input-staff-default-password"
            />
            <p className="text-xs text-muted-foreground">
              At least 8 characters. Share it with them securely.
            </p>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy ? "Adding…" : "Add teammate"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetStaffPasswordDialog({ member }: { member: StaffMember }) {
  const [open, setOpen] = useState(false);
  const [defaultPassword, setDefaultPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (defaultPassword.length < 8) {
      toast.error("Temporary password must be at least 8 characters");
      return;
    }
    setBusy(true);
    try {
      await customFetch(`/api/ministry/staff/${member.id}/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultPassword }),
      });
      toast.success("Temporary password set");
      setOpen(false);
      setDefaultPassword("");
    } catch (err: unknown) {
      toast.error(
        (err as { data?: { error?: string } })?.data?.error ??
          "Failed to reset password",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setDefaultPassword("");
      }}
    >
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          data-testid={`button-reset-staff-${member.id}`}
        >
          <KeyRound className="h-4 w-4 mr-1" />
          Reset password
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset password</DialogTitle>
          <DialogDescription>
            Sets a new temporary password for {member.fullName}. They must
            choose their own password again on next login.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`reset-staff-pw-${member.id}`}>
              Temporary password
            </Label>
            <PasswordInput
              id={`reset-staff-pw-${member.id}`}
              value={defaultPassword}
              onChange={(e) => setDefaultPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
            <p className="text-xs text-muted-foreground">
              At least 8 characters. Share it with them securely.
            </p>
          </div>
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Set password"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function StaffRow({
  member,
  roles,
  canManage,
  isSelf,
  onChanged,
}: {
  member: StaffMember;
  roles: MinistryRole[];
  canManage: boolean;
  isSelf: boolean;
  onChanged: () => void;
}) {
  const isOwner = member.orgRole === "owner";
  // The owner and your own row cannot be managed from here (mirrors the
  // server-side guards in routes/ministry-staff.ts).
  const manageable = canManage && !isOwner && !isSelf;

  async function patch(updates: { role?: string; status?: string }) {
    try {
      await customFetch(`/api/ministry/staff/${member.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      toast.success("Teammate updated");
      onChanged();
    } catch (err: unknown) {
      toast.error(
        (err as { data?: { error?: string } })?.data?.error ??
          "Failed to update teammate",
      );
    }
  }

  async function remove() {
    try {
      await customFetch(`/api/ministry/staff/${member.id}`, {
        method: "DELETE",
      });
      toast.success("Teammate removed");
      onChanged();
    } catch (err: unknown) {
      toast.error(
        (err as { data?: { error?: string } })?.data?.error ??
          "Failed to remove teammate",
      );
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <CardTitle className="text-base flex items-center gap-2 flex-wrap">
              {member.fullName}
              {isOwner && <Badge variant="secondary">Owner</Badge>}
              {isSelf && <Badge variant="outline">You</Badge>}
              <Badge
                variant={member.status === "active" ? "default" : "outline"}
              >
                {member.status}
              </Badge>
              {member.mustChangePassword && (
                <Badge variant="outline">Temporary password</Badge>
              )}
            </CardTitle>
            <CardDescription className="mt-1 truncate">
              {member.email} · {roleLabel(member.orgRole)}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      {manageable && (
        <CardContent>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Role</Label>
              <Select
                value={member.orgRole ?? undefined}
                onValueChange={(v) => patch({ role: v })}
              >
                <SelectTrigger
                  className="h-8 w-36"
                  data-testid={`select-role-${member.id}`}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {roles.map((r) => (
                    <SelectItem key={r.name} value={r.name}>
                      {roleLabel(r.name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                patch({
                  status: member.status === "active" ? "disabled" : "active",
                })
              }
              data-testid={`button-toggle-status-${member.id}`}
            >
              {member.status === "active" ? "Disable" : "Enable"}
            </Button>
            <ResetStaffPasswordDialog member={member} />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive"
                  data-testid={`button-remove-staff-${member.id}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove this teammate?</AlertDialogTitle>
                  <AlertDialogDescription>
                    {member.fullName} will be disabled and can no longer sign
                    in. You can re-enable them later.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={remove}>Remove</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
