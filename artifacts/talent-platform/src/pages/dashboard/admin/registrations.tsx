import { useState } from "react";
import {
  useListRegistrations,
  useApproveRegistration,
  useRejectRegistration,
  getListRegistrationsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Link } from "wouter";
import {
  CheckCircle2,
  XCircle,
  ShieldAlert,
  UserCircle2,
  Briefcase,
  GraduationCap,
  Mail,
  Clock,
} from "lucide-react";

const ROLE_ICON: Record<string, typeof UserCircle2> = {
  candidate: UserCircle2,
  employer: Briefcase,
  institution: GraduationCap,
};

export default function AdminRegistrationsPage() {
  const { sessionUser, isLoading } = useAuth();
  const [statusFilter, setStatusFilter] = useState<"pending" | "active" | "rejected" | "all">(
    "pending",
  );
  const queryClient = useQueryClient();
  const { data, isLoading: isLoadingList } = useListRegistrations(
    { status: statusFilter },
    {
      query: {
        queryKey: getListRegistrationsQueryKey({ status: statusFilter }),
        enabled: sessionUser?.role === "admin",
      },
    },
  );
  const approve = useApproveRegistration();
  const reject = useRejectRegistration();

  if (isLoading) return <div className="container py-12">Loading…</div>;
  if (!sessionUser || sessionUser.role !== "admin") {
    return (
      <div className="container max-w-md py-16">
        <Card>
          <CardContent className="p-8 text-center">
            <ShieldAlert className="w-10 h-10 mx-auto mb-3 text-destructive" />
            <p className="font-medium">Admin access required</p>
            <p className="text-sm text-muted-foreground mt-2">
              Sign in with an administrator account to review registrations.
            </p>
            <Button asChild className="mt-4">
              <Link href="/login">Sign in</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const registrations = data?.registrations ?? [];

  async function handleApprove(id: number) {
    await approve.mutateAsync({ id, data: {} });
    await queryClient.invalidateQueries({
      queryKey: getListRegistrationsQueryKey({ status: statusFilter }),
    });
  }
  async function handleReject(id: number) {
    if (!confirm("Reject this application? The user will not be able to log in.")) return;
    await reject.mutateAsync({ id, data: {} });
    await queryClient.invalidateQueries({
      queryKey: getListRegistrationsQueryKey({ status: statusFilter }),
    });
  }

  return (
    <div className="container px-4 py-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-4 mb-2">
        <div className="w-14 h-14 rounded-2xl bg-destructive/10 border-2 border-destructive/20 flex items-center justify-center text-destructive">
          <ShieldAlert className="w-7 h-7" />
        </div>
        <div className="flex-1">
          <h1 className="text-2xl font-bold tracking-tight">Account Applications</h1>
          <p className="text-muted-foreground text-sm">
            Review sign-ups from candidates, employers, and institutions.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link href="/dashboard/admin/onboard">Onboard manually</Link>
        </Button>
      </div>

      <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
        <TabsList>
          <TabsTrigger value="pending">Pending</TabsTrigger>
          <TabsTrigger value="active">Approved</TabsTrigger>
          <TabsTrigger value="rejected">Rejected</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>

      {isLoadingList ? (
        <div className="text-muted-foreground">Loading applications…</div>
      ) : registrations.length === 0 ? (
        <Card>
          <CardContent className="p-12 text-center text-muted-foreground">
            No {statusFilter === "all" ? "" : statusFilter} applications.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {registrations.map((r) => {
            const Icon = ROLE_ICON[r.role] ?? UserCircle2;
            const data = (r.submittedData ?? {}) as Record<string, unknown>;
            return (
              <Card key={r.registrationId} className="shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <Icon className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <CardTitle className="text-base">{r.fullName}</CardTitle>
                        <Badge variant="outline" className="capitalize">
                          {r.role}
                        </Badge>
                        <Badge
                          className={
                            r.userStatus === "pending"
                              ? "bg-amber-100 text-amber-800 hover:bg-amber-100"
                              : r.userStatus === "active"
                              ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-100"
                              : "bg-rose-100 text-rose-800 hover:bg-rose-100"
                          }
                        >
                          {r.userStatus}
                        </Badge>
                      </div>
                      <CardDescription className="mt-1 flex items-center gap-3 text-xs">
                        <span className="inline-flex items-center gap-1">
                          <Mail className="w-3 h-3" /> {r.email}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(r.registrationCreatedAt).toLocaleString()}
                        </span>
                      </CardDescription>
                    </div>
                    {r.userStatus === "pending" && (
                      <div className="flex gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleReject(r.registrationId)}
                          disabled={reject.isPending}
                        >
                          <XCircle className="w-4 h-4 mr-1" /> Reject
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => handleApprove(r.registrationId)}
                          disabled={approve.isPending}
                        >
                          <CheckCircle2 className="w-4 h-4 mr-1" /> Approve
                        </Button>
                      </div>
                    )}
                  </div>
                </CardHeader>
                {Object.keys(data).length > 0 && (
                  <CardContent className="pt-0">
                    <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
                      {Object.entries(data).map(([k, v]) =>
                        v ? (
                          <div key={k} className="flex gap-2">
                            <dt className="text-muted-foreground capitalize min-w-[110px]">
                              {k.replace(/([A-Z])/g, " $1").trim()}
                            </dt>
                            <dd className="font-medium">{String(v)}</dd>
                          </div>
                        ) : null,
                      )}
                    </dl>
                  </CardContent>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
