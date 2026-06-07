import { useEffect, useState } from "react";
import { customFetch } from "@workspace/api-client-react";
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
import { Switch } from "@/components/ui/switch";
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
import { Landmark, Plus, KeyRound, Trash2 } from "lucide-react";

type MinistryType = "education" | "labour";

type ScopeDef = {
  key: string;
  label: string;
  description: string;
  type: MinistryType;
};

type MinistryUser = {
  id: number;
  email: string;
  fullName: string;
  status: string;
  orgRole?: string | null;
  mustChangePassword?: boolean;
  ministryId: number | null;
};

type Ministry = {
  id: number;
  name: string;
  type: MinistryType;
  dataAccess: string[];
  createdAt: string;
  users: MinistryUser[];
};

export default function AdminMinistriesPage() {
  const [ministries, setMinistries] = useState<Ministry[] | null>(null);
  const [scopes, setScopes] = useState<ScopeDef[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    try {
      const [list, cat] = await Promise.all([
        customFetch<{ ministries: Ministry[] }>("/api/admin/ministries"),
        customFetch<{ scopes: ScopeDef[] }>("/api/admin/ministry-scopes"),
      ]);
      setMinistries(list.ministries);
      setScopes(cat.scopes);
    } catch (err: unknown) {
      setError(
        (err as { data?: { error?: string } })?.data?.error ??
          "Failed to load ministries.",
      );
    }
  }

  useEffect(() => {
    reload();
  }, []);

  return (
    <div className="container py-8 space-y-6 max-w-5xl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Landmark className="h-6 w-6 text-primary" />
            Government ministries
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Oversight accounts that see aggregate statistics only — never
            individual student or candidate records.
          </p>
        </div>
        <CreateMinistryDialog scopes={scopes} onCreated={reload} />
      </div>

      {error && (
        <div className="p-4 rounded-md bg-destructive/10 text-destructive text-sm">
          {error}
        </div>
      )}

      {ministries === null ? (
        <p className="text-muted-foreground">Loading…</p>
      ) : ministries.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            No ministry accounts yet. Create one to grant aggregate oversight
            access.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {ministries.map((m) => (
            <MinistryCard
              key={m.id}
              ministry={m}
              scopes={scopes}
              onChanged={reload}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CreateMinistryDialog({
  scopes,
  onCreated,
}: {
  scopes: ScopeDef[];
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [type, setType] = useState<MinistryType>("education");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [defaultPassword, setDefaultPassword] = useState("");
  const [busy, setBusy] = useState(false);

  const typeScopes = scopes.filter((s) => s.type === type);

  function reset() {
    setName("");
    setType("education");
    setFullName("");
    setEmail("");
    setDefaultPassword("");
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (defaultPassword.length < 8) {
      toast.error("Default password must be at least 8 characters");
      return;
    }
    setBusy(true);
    try {
      await customFetch("/api/admin/ministries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, type, fullName, email, defaultPassword }),
      });
      toast.success("Ministry account created");
      onCreated();
      setOpen(false);
      reset();
    } catch (err: unknown) {
      toast.error(
        (err as { data?: { error?: string } })?.data?.error ??
          "Failed to create ministry",
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
        <Button data-testid="button-create-ministry">
          <Plus className="h-4 w-4 mr-1" />
          New ministry
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create ministry account</DialogTitle>
          <DialogDescription>
            Set a temporary password for the contact. They sign in with it and
            are required to choose their own password on first login. The
            account sees aggregate statistics only.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="m-name">Ministry name</Label>
            <Input
              id="m-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ministry of Education"
              required
            />
          </div>
          <div className="space-y-2">
            <Label>Type</Label>
            <Select
              value={type}
              onValueChange={(v) => setType(v as MinistryType)}
            >
              <SelectTrigger data-testid="select-ministry-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="education">
                  Education (student placement)
                </SelectItem>
                <SelectItem value="labour">
                  Labour (jobs, hiring, wages)
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="m-contact">Contact name</Label>
            <Input
              id="m-contact"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Jane Mensah"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="m-email">Contact email (used to sign in)</Label>
            <Input
              id="m-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="oversight@moe.gov.gh"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="m-password">Temporary password</Label>
            <PasswordInput
              id="m-password"
              value={defaultPassword}
              onChange={(e) => setDefaultPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
              data-testid="input-ministry-default-password"
            />
            <p className="text-xs text-muted-foreground">
              At least 8 characters. Share it with the contact securely — they
              must change it on first login.
            </p>
          </div>
          <p className="text-xs text-muted-foreground">
            All {typeScopes.length} data sections for this type are granted by
            default. You can restrict them after creation.
          </p>
          <DialogFooter>
            <Button type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordDialog({ ministry }: { ministry: Ministry }) {
  const [open, setOpen] = useState(false);
  const [defaultPassword, setDefaultPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (defaultPassword.length < 8) {
      toast.error("Default password must be at least 8 characters");
      return;
    }
    setBusy(true);
    try {
      await customFetch(`/api/admin/ministries/${ministry.id}/reset-password`, {
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
          data-testid={`button-reset-password-${ministry.id}`}
        >
          <KeyRound className="h-4 w-4 mr-1" />
          Reset password
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reset ministry password</DialogTitle>
          <DialogDescription>
            Sets a new temporary password for the {ministry.name} owner account.
            They must choose their own password again on next login.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor={`reset-pw-${ministry.id}`}>Temporary password</Label>
            <PasswordInput
              id={`reset-pw-${ministry.id}`}
              value={defaultPassword}
              onChange={(e) => setDefaultPassword(e.target.value)}
              required
              minLength={8}
              autoComplete="new-password"
            />
            <p className="text-xs text-muted-foreground">
              At least 8 characters. Share it with the contact securely.
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

function MinistryCard({
  ministry,
  scopes,
  onChanged,
}: {
  ministry: Ministry;
  scopes: ScopeDef[];
  onChanged: () => void;
}) {
  const [access, setAccess] = useState<string[]>(ministry.dataAccess);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const typeScopes = scopes.filter((s) => s.type === ministry.type);
  const user = ministry.users.find((u) => u.orgRole === "owner") ?? ministry.users[0];

  async function toggleScope(key: string, on: boolean) {
    const next = on ? [...access, key] : access.filter((k) => k !== key);
    setAccess(next);
    setSavingKey(key);
    try {
      await customFetch(`/api/admin/ministries/${ministry.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataAccess: next }),
      });
    } catch {
      // revert on failure
      setAccess(access);
      toast.error("Failed to update access");
    } finally {
      setSavingKey(null);
    }
  }

  async function remove() {
    try {
      await customFetch(`/api/admin/ministries/${ministry.id}`, {
        method: "DELETE",
      });
      toast.success("Ministry removed");
      onChanged();
    } catch (err: unknown) {
      toast.error(
        (err as { data?: { error?: string } })?.data?.error ??
          "Failed to remove ministry",
      );
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              {ministry.name}
              <Badge variant="secondary" className="capitalize">
                {ministry.type}
              </Badge>
            </CardTitle>
            <CardDescription className="mt-1">
              {user ? (
                <>
                  {user.fullName} · {user.email}{" "}
                  <Badge
                    variant={user.status === "active" ? "default" : "outline"}
                    className="ml-1"
                  >
                    {user.status}
                  </Badge>
                  {user.mustChangePassword && (
                    <Badge variant="outline" className="ml-1">
                      Temporary password
                    </Badge>
                  )}
                </>
              ) : (
                "No linked user account"
              )}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <ResetPasswordDialog ministry={ministry} />
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="text-destructive"
                  data-testid={`button-delete-ministry-${ministry.id}`}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove this ministry?</AlertDialogTitle>
                  <AlertDialogDescription>
                    The ministry account will be disabled and can no longer
                    sign in. This is reversible only by recreating the account.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={remove}>
                    Remove
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-sm font-medium mb-2">Data access</p>
          <div className="space-y-3">
            {typeScopes.map((s) => (
              <div
                key={s.key}
                className="flex items-start justify-between gap-4"
              >
                <div>
                  <Label className="text-sm">{s.label}</Label>
                  <p className="text-xs text-muted-foreground">
                    {s.description}
                  </p>
                </div>
                <Switch
                  checked={access.includes(s.key)}
                  disabled={savingKey === s.key}
                  onCheckedChange={(on) => toggleScope(s.key, on)}
                  data-testid={`switch-scope-${ministry.id}-${s.key}`}
                />
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
