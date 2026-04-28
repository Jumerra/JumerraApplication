import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListStaff,
  useInviteStaff,
  useRemoveStaff,
  getListStaffQueryKey,
  type InviteStaffResponse,
  type StaffMember,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Users,
  ShieldAlert,
  UserPlus,
  Mail,
  Copy,
  CheckCircle2,
  AlertCircle,
  Trash2,
  Crown,
} from "lucide-react";

const ROLE_OPTIONS: Record<string, { value: string; label: string; desc: string }[]> = {
  admin: [
    { value: "super_admin", label: "Super Admin", desc: "Full access to everything." },
    { value: "support", label: "Support", desc: "Read-only support access." },
  ],
  employer: [
    { value: "owner", label: "Owner", desc: "Can invite/remove teammates and manage everything." },
    { value: "recruiter", label: "Recruiter", desc: "Can post jobs and review applications." },
    { value: "viewer", label: "Viewer", desc: "Read-only access to dashboards." },
  ],
  institution: [
    { value: "owner", label: "Owner", desc: "Can invite/remove teammates and manage everything." },
    { value: "coordinator", label: "Coordinator", desc: "Manage students and placements." },
    { value: "viewer", label: "Viewer", desc: "Read-only access to dashboards." },
  ],
};

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin",
  support: "Support",
  owner: "Owner",
  recruiter: "Recruiter",
  viewer: "Viewer",
  coordinator: "Coordinator",
};

export default function StaffPage() {
  const { sessionUser } = useAuth();
  const queryClient = useQueryClient();

  const enabled = !!sessionUser && sessionUser.orgRole !== null;
  const { data, isLoading } = useListStaff({ query: { enabled } });
  const invite = useInviteStaff();
  const remove = useRemoveStaff();

  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [orgRole, setOrgRole] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<InviteStaffResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [removing, setRemoving] = useState<number | null>(null);

  if (!sessionUser || sessionUser.role === "candidate" || sessionUser.orgRole === null) {
    return (
      <div className="container max-w-md py-16">
        <Card>
          <CardContent className="p-8 text-center">
            <ShieldAlert className="w-10 h-10 mx-auto mb-3 text-destructive" />
            <p className="font-medium">Organization member access required</p>
            <Button asChild className="mt-4">
              <Link href="/login">Sign in</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isOwner =
    sessionUser.orgRole === "owner" || sessionUser.orgRole === "super_admin";
  const roleOptions = ROLE_OPTIONS[sessionUser.role] ?? [];

  async function onInvite(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setCopied(false);
    if (!orgRole) {
      setError("Please pick a role");
      return;
    }
    try {
      const res = await invite.mutateAsync({
        data: { email, fullName, orgRole },
      });
      setResult(res);
      await queryClient.invalidateQueries({ queryKey: getListStaffQueryKey() });
      setEmail("");
      setFullName("");
      setOrgRole("");
    } catch (err: any) {
      setError(err?.data?.error ?? "Invite failed");
    }
  }

  async function onRemove(member: StaffMember) {
    if (!confirm(`Remove ${member.fullName} from this organization?`)) return;
    setRemoving(member.id);
    setError(null);
    try {
      await remove.mutateAsync({ id: member.id });
      await queryClient.invalidateQueries({ queryKey: getListStaffQueryKey() });
    } catch (err: any) {
      setError(err?.data?.error ?? "Remove failed");
    } finally {
      setRemoving(null);
    }
  }

  function copyLink(url: string) {
    const absolute = `${window.location.origin}${url}`;
    navigator.clipboard.writeText(absolute);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const members = data?.members ?? [];

  return (
    <div className="container px-4 py-8 max-w-3xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 border-2 border-primary/20 flex items-center justify-center text-primary">
          <Users className="w-7 h-7" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Team</h1>
          <p className="text-muted-foreground text-sm">
            {isOwner
              ? "Invite teammates and manage their roles."
              : "View teammates of your organization."}
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {isOwner && (
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle>Invite a teammate</CardTitle>
            <CardDescription>
              They will receive a one-time link to set their password.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onInvite} className="space-y-4">
              <div className="grid sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="staff-fullName">Full name</Label>
                  <Input
                    id="staff-fullName"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="staff-email">Email</Label>
                  <Input
                    id="staff-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="staff-role">Role</Label>
                <Select value={orgRole} onValueChange={setOrgRole}>
                  <SelectTrigger id="staff-role">
                    <SelectValue placeholder="Pick a role" />
                  </SelectTrigger>
                  <SelectContent>
                    {roleOptions.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        <div className="flex flex-col">
                          <span className="font-medium">{opt.label}</span>
                          <span className="text-xs text-muted-foreground">
                            {opt.desc}
                          </span>
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" disabled={invite.isPending}>
                <UserPlus className="w-4 h-4 mr-2" />
                {invite.isPending ? "Inviting…" : "Send invite"}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {result && (
        <Card className="shadow-sm border-emerald-200 bg-emerald-50/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-emerald-900">
              <CheckCircle2 className="w-5 h-5" /> Invite created
            </CardTitle>
            <CardDescription className="text-emerald-900/80">
              {result.emailSent ? (
                <>
                  We emailed the setup link to{" "}
                  <span className="font-semibold">{result.member.fullName}</span>{" "}
                  ({result.member.email}). Link expires{" "}
                  {new Date(result.expiresAt).toLocaleString()}.
                </>
              ) : (
                <>
                  Email is not yet configured. Share this one-time setup link
                  with{" "}
                  <span className="font-semibold">{result.member.fullName}</span>{" "}
                  ({result.member.email}). Link expires{" "}
                  {new Date(result.expiresAt).toLocaleString()}.
                </>
              )}
            </CardDescription>
          </CardHeader>
          {/* SECURITY: only render the copyable setup link when the API
              returned one (it omits the URL once email delivery is wired
              up so the inviter can no longer read someone else's token). */}
          {result.setupUrl && (
            <CardContent>
              <div className="flex gap-2">
                <Input
                  readOnly
                  value={`${window.location.origin}${result.setupUrl}`}
                  className="font-mono text-xs bg-white"
                />
                <Button
                  variant="outline"
                  onClick={() => copyLink(result.setupUrl!)}
                  className="shrink-0"
                >
                  <Copy className="w-4 h-4 mr-1" />
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
            </CardContent>
          )}
        </Card>
      )}

      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base">Members</CardTitle>
          <CardDescription>
            {isLoading ? "Loading…" : `${members.length} member${members.length === 1 ? "" : "s"}`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {members.length === 0 && !isLoading ? (
            <p className="text-sm text-muted-foreground">No members yet.</p>
          ) : (
            <ul className="divide-y">
              {members.map((m) => (
                <li key={m.id} className="py-3 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-bold">
                    {m.fullName.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">{m.fullName}</p>
                      {m.id === sessionUser.id && (
                        <Badge variant="outline" className="text-[10px] py-0 px-1.5">
                          You
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{m.email}</p>
                  </div>
                  <Badge
                    variant={m.orgRole === "owner" || m.orgRole === "super_admin" ? "default" : "secondary"}
                    className="gap-1"
                  >
                    {(m.orgRole === "owner" || m.orgRole === "super_admin") && (
                      <Crown className="w-3 h-3" />
                    )}
                    {m.orgRole ? ROLE_LABELS[m.orgRole] ?? m.orgRole : "—"}
                  </Badge>
                  {m.status === "invited" && (
                    <Badge variant="outline" className="gap-1">
                      <Mail className="w-3 h-3" /> Invited
                    </Badge>
                  )}
                  {isOwner && m.id !== sessionUser.id && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onRemove(m)}
                      disabled={removing === m.id}
                      title="Remove"
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
