import { useState } from "react";
import { Link } from "wouter";
import {
  useListEmployers,
  useGetEmployer,
  getGetEmployerQueryKey,
  useAdminDeleteEmployer,
  useAdminSetEmployerVerified,
  getListEmployersQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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
import { useToast } from "@/hooks/use-toast";
import { useFocusId, useFocusRow } from "@/hooks/use-focus-row";
import { AdminAccountActions } from "@/components/admin-account-actions";
import { AccountManagerSelect } from "@/components/account-manager-select";
import { useAuth } from "@/lib/auth";
import {
  Search,
  Trash2,
  ExternalLink,
  Building2,
  CheckCircle2,
  ShieldCheck,
  ShieldOff,
  MapPin,
} from "lucide-react";

export default function AdminEmployersPage() {
  const { sessionUser } = useAuth();
  const isAccountManager =
    sessionUser?.role === "admin" &&
    sessionUser.orgRole === "account_manager";
  const [mineOnly, setMineOnly] = useState(isAccountManager);
  const [search, setSearch] = useState("");
  const { data: employers, isLoading } = useListEmployers({
    search: search || undefined,
    ...(mineOnly && isAccountManager ? { mine: "1" as const } : {}),
  });
  const focusId = useFocusId();
  const focusedEmployer = useGetEmployer(focusId ?? 0, {
    query: {
      enabled: !!focusId,
      queryKey: getGetEmployerQueryKey(focusId ?? 0),
    },
  });
  const { notVisibleButExists, rowProps } = useFocusRow(employers, {
    existsById: !!focusedEmployer.data,
  });
  const deleteEmployer = useAdminDeleteEmployer();
  const setVerified = useAdminSetEmployerVerified();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  async function handleDelete(id: number, name: string) {
    try {
      await deleteEmployer.mutateAsync({ id });
      await queryClient.invalidateQueries({ queryKey: getListEmployersQueryKey() });
      toast({
        title: "Employer removed",
        description: `${name}, all their jobs, and their applications have been deleted.`,
      });
    } catch (err) {
      toast({
        title: "Delete failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  async function handleToggleVerified(id: number, currentlyVerified: boolean) {
    try {
      await setVerified.mutateAsync({
        id,
        data: { verified: !currentlyVerified },
      });
      await queryClient.invalidateQueries({ queryKey: getListEmployersQueryKey() });
      toast({
        title: currentlyVerified ? "Verification removed" : "Employer verified",
      });
    } catch (err) {
      toast({
        title: "Update failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  return (
    <div className="container px-4 py-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 border-2 border-primary/20 flex items-center justify-center shrink-0 text-primary">
          <Building2 className="w-7 h-7" />
        </div>
        <div className="flex-1">
          <h1 className="text-3xl font-bold tracking-tight">Manage Employers</h1>
          <p className="text-muted-foreground mt-1">
            Verify, audit, and remove employer accounts on the platform.
          </p>
        </div>
        <Badge variant="secondary" className="text-sm">
          {employers?.length ?? 0} total
        </Badge>
      </div>

      <Card>
        <CardHeader className="pb-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by name or industry…"
              className="pl-10"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {isAccountManager && (
            <div className="flex gap-2">
              <Button
                variant={mineOnly ? "default" : "outline"}
                size="sm"
                onClick={() => setMineOnly(true)}
              >
                My accounts
              </Button>
              <Button
                variant={!mineOnly ? "default" : "outline"}
                size="sm"
                onClick={() => setMineOnly(false)}
              >
                All employers
              </Button>
            </div>
          )}
          {notVisibleButExists && (() => {
            const hasFilters = !!search || (mineOnly && isAccountManager);
            return (
              <div className="flex items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
                <span className="text-muted-foreground">
                  {hasFilters
                    ? "The employer you're looking for is hidden by your current filters."
                    : "The employer you're looking for isn't on the currently loaded page. Try searching by name to bring them into view."}
                </span>
                {hasFilters && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setSearch("");
                      if (isAccountManager) setMineOnly(false);
                    }}
                  >
                    Clear filters
                  </Button>
                )}
              </div>
            );
          })()}
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading…</div>
          ) : !employers || employers.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No employers match your search.
            </div>
          ) : (
            <div className="divide-y">
              {employers.map((e) => {
                const fp = rowProps(e.id);
                return (
                <div
                  key={e.id}
                  ref={fp.ref}
                  data-focused={fp["data-focused"]}
                  className={`flex items-center gap-4 px-6 py-4 hover:bg-muted/40 transition-colors ${fp.className}`}
                >
                  <img
                    src={e.logoUrl}
                    alt={e.name}
                    className="w-12 h-12 rounded-xl object-cover bg-muted shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold truncate">{e.name}</h3>
                      {e.verified && (
                        <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground truncate">
                      {e.tagline}
                    </p>
                  </div>
                  <div className="hidden md:flex flex-col items-end text-xs text-muted-foreground gap-1 shrink-0">
                    <Badge variant="secondary" className="bg-muted">
                      {e.industry}
                    </Badge>
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {e.location}
                    </span>
                  </div>
                  <div className="hidden lg:flex flex-col items-end text-xs shrink-0 min-w-[80px]">
                    <span className="font-semibold text-primary">
                      {e.openJobs}
                    </span>
                    <span className="text-muted-foreground">open jobs</span>
                  </div>
                  <div className="hidden xl:block shrink-0">
                    <AccountManagerSelect
                      entityKind="employer"
                      entityId={e.id}
                      currentManagerId={e.accountManagerId ?? null}
                      currentManagerName={e.accountManagerName ?? null}
                    />
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggleVerified(e.id, e.verified)}
                      disabled={setVerified.isPending}
                      title={e.verified ? "Remove verified badge" : "Mark as verified"}
                    >
                      {e.verified ? (
                        <ShieldOff className="w-4 h-4" />
                      ) : (
                        <ShieldCheck className="w-4 h-4" />
                      )}
                      <span className="sr-only">
                        {e.verified ? "Unverify" : "Verify"}
                      </span>
                    </Button>
                    <AdminAccountActions
                      entityKind="employer"
                      entityId={e.id}
                      entityLabel="Employer"
                    />
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/employers/${e.id}`}>
                        <ExternalLink className="w-4 h-4" />
                        <span className="sr-only">View</span>
                      </Link>
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive hover:bg-destructive/10"
                        >
                          <Trash2 className="w-4 h-4" />
                          <span className="sr-only">Delete</span>
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Remove employer?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This permanently deletes {e.name}, all of their job
                            postings, and every application submitted to those
                            jobs. Linked user accounts will lose their employer
                            association. This cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => handleDelete(e.id, e.name)}
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
