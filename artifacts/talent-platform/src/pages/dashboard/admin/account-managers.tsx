import { Link } from "wouter";
import { useAdminListAccountManagers } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  UserCog,
  ShieldAlert,
  Building2,
  GraduationCap,
  Mail,
  UserPlus,
  ArrowRight,
} from "lucide-react";

/**
 * Admin > Account Managers
 *
 * Lists all admins flagged with the account_manager org role, plus how
 * many employers/institutions each one currently owns. Visible to any
 * admin (so account_manager admins can see their peers); reassignment
 * still happens on the per-row select on the employers/institutions
 * pages and is enforced server-side as super-admin only.
 */
export default function AdminAccountManagersPage() {
  const { sessionUser } = useAuth();
  const { data, isLoading } = useAdminListAccountManagers();

  if (!sessionUser || sessionUser.role !== "admin") {
    return (
      <div className="container max-w-md py-16">
        <Card>
          <CardContent className="p-8 text-center">
            <ShieldAlert className="w-10 h-10 mx-auto mb-3 text-destructive" />
            <p className="font-medium">Admin access required</p>
            <Button asChild className="mt-4">
              <Link href="/login">Sign in</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isSuperAdmin =
    sessionUser.orgRole === "super_admin" || sessionUser.orgRole === null;
  const managers = data?.accountManagers ?? [];

  return (
    <div className="container px-4 py-8 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 border-2 border-primary/20 flex items-center justify-center shrink-0 text-primary">
          <UserCog className="w-7 h-7" />
        </div>
        <div className="flex-1">
          <h1 className="text-3xl font-bold tracking-tight">Account Managers</h1>
          <p className="text-muted-foreground mt-1">
            Admins responsible for onboarding and supporting employer and
            institution accounts.
          </p>
        </div>
        <Badge variant="secondary" className="text-sm">
          {managers.length} total
        </Badge>
      </div>

      <Card>
        <CardHeader className="pb-4 flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Roster</CardTitle>
            <CardDescription>
              {isSuperAdmin
                ? "Use the Team page to invite a new admin and pick the Account Manager role. Reassign their book of accounts on the Employers or Institutions pages."
                : "Only super admins can invite or reassign account managers."}
            </CardDescription>
          </div>
          {isSuperAdmin && (
            <Button asChild size="sm" variant="outline">
              <Link href="/dashboard/admin/staff">
                <UserPlus className="w-4 h-4 mr-1" /> Invite admin
              </Link>
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading…</div>
          ) : managers.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No account managers yet.
              {isSuperAdmin && (
                <>
                  {" "}
                  <Link
                    href="/dashboard/admin/staff"
                    className="text-primary underline"
                  >
                    Invite one from the Team page
                  </Link>
                  .
                </>
              )}
            </div>
          ) : (
            <div className="divide-y">
              {managers.map((m) => (
                <div
                  key={m.id}
                  className="flex items-center gap-4 px-6 py-4 hover:bg-muted/40 transition-colors"
                >
                  <div className="w-11 h-11 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-bold shrink-0">
                    {m.fullName.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold truncate">{m.fullName}</h3>
                      {m.status !== "active" && (
                        <Badge
                          variant="outline"
                          className="text-[10px] py-0 px-1.5"
                        >
                          {m.status}
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate flex items-center gap-1">
                      <Mail className="w-3 h-3" /> {m.email}
                    </p>
                  </div>
                  <div className="hidden sm:flex items-center gap-3 text-xs shrink-0">
                    <Badge variant="secondary" className="gap-1">
                      <Building2 className="w-3 h-3" />
                      {m.assignedEmployerCount} employers
                    </Badge>
                    <Badge variant="secondary" className="gap-1">
                      <GraduationCap className="w-3 h-3" />
                      {m.assignedInstitutionCount} institutions
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {isSuperAdmin && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Reassign accounts</CardTitle>
            <CardDescription>
              Account ownership lives on each employer / institution row. Use
              the Account Manager selector on those pages to move a book of
              business from one manager to another.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard/admin/employers">
                <Building2 className="w-4 h-4 mr-1" /> Employers{" "}
                <ArrowRight className="w-3 h-3 ml-1" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard/admin/institutions">
                <GraduationCap className="w-4 h-4 mr-1" /> Institutions{" "}
                <ArrowRight className="w-3 h-3 ml-1" />
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
