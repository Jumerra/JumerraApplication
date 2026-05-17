import { useState } from "react";
import { Link } from "wouter";
import {
  useListInstitutions,
  useGetInstitution,
  getGetInstitutionQueryKey,
  useAdminDeleteInstitution,
  getListInstitutionsQueryKey,
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
  GraduationCap,
  MapPin,
} from "lucide-react";

export default function AdminInstitutionsPage() {
  const { sessionUser } = useAuth();
  const isAccountManager =
    sessionUser?.role === "admin" &&
    sessionUser.orgRole === "account_manager";
  const [mineOnly, setMineOnly] = useState(isAccountManager);
  const [search, setSearch] = useState("");
  const { data: institutions, isLoading } = useListInstitutions(
    mineOnly && isAccountManager ? { mine: "1" as const } : undefined,
  );
  const deleteInstitution = useAdminDeleteInstitution();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const filtered = (institutions ?? []).filter((i) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      i.name.toLowerCase().includes(q) ||
      i.type.toLowerCase().includes(q) ||
      i.location.toLowerCase().includes(q)
    );
  });

  const focusId = useFocusId();
  const focusedInstitution = useGetInstitution(focusId ?? 0, {
    query: {
      enabled: !!focusId,
      queryKey: getGetInstitutionQueryKey(focusId ?? 0),
    },
  });
  const { notVisibleButExists, rowProps } = useFocusRow(filtered, {
    existsById: !!focusedInstitution.data,
  });

  async function handleDelete(id: number, name: string) {
    try {
      await deleteInstitution.mutateAsync({ id });
      await queryClient.invalidateQueries({ queryKey: getListInstitutionsQueryKey() });
      toast({
        title: "Institution removed",
        description: `${name} and all candidate affiliations have been deleted.`,
      });
    } catch (err) {
      toast({
        title: "Delete failed",
        description: err instanceof Error ? err.message : "Please try again.",
        variant: "destructive",
      });
    }
  }

  return (
    <div className="container px-4 py-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-primary/10 border-2 border-primary/20 flex items-center justify-center shrink-0 text-primary">
          <GraduationCap className="w-7 h-7" />
        </div>
        <div className="flex-1">
          <h1 className="text-3xl font-bold tracking-tight">Manage Institutions</h1>
          <p className="text-muted-foreground mt-1">
            Audit, view, and remove institution accounts on the platform.
          </p>
        </div>
        <Badge variant="secondary" className="text-sm">
          {institutions?.length ?? 0} total
        </Badge>
      </div>

      <Card>
        <CardHeader className="pb-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, type, or location…"
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
                All institutions
              </Button>
            </div>
          )}
          {notVisibleButExists && (() => {
            const hasFilters = !!search || (mineOnly && isAccountManager);
            return (
              <div className="flex items-center justify-between gap-3 rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-sm">
                <span className="text-muted-foreground">
                  {hasFilters
                    ? "The institution you're looking for is hidden by your current filters."
                    : "The institution you're looking for isn't on the currently loaded page. Try searching by name to bring it into view."}
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
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No institutions match your search.
            </div>
          ) : (
            <div className="divide-y">
              {filtered.map((i) => {
                const fp = rowProps(i.id);
                return (
                <div
                  key={i.id}
                  ref={fp.ref}
                  data-focused={fp["data-focused"]}
                  className={`flex items-center gap-4 px-6 py-4 hover:bg-muted/40 transition-colors ${fp.className}`}
                >
                  <img
                    src={i.logoUrl}
                    alt={i.name}
                    className="w-12 h-12 rounded-xl object-cover bg-muted shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-semibold truncate">{i.name}</h3>
                    <p className="text-sm text-muted-foreground truncate">
                      {i.studentCount.toLocaleString()} students ·{" "}
                      {Math.round(i.placementRate * 100)}% placement
                    </p>
                  </div>
                  <div className="hidden md:flex flex-col items-end text-xs text-muted-foreground gap-1 shrink-0">
                    <Badge variant="secondary" className="bg-muted">
                      {i.type}
                    </Badge>
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {i.location}
                    </span>
                  </div>
                  <div className="hidden xl:block shrink-0">
                    <AccountManagerSelect
                      entityKind="institution"
                      entityId={i.id}
                      currentManagerId={i.accountManagerId ?? null}
                      currentManagerName={i.accountManagerName ?? null}
                    />
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <AdminAccountActions
                      entityKind="institution"
                      entityId={i.id}
                      entityLabel="Institution"
                    />
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/institutions/${i.id}`}>
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
                          <AlertDialogTitle>Remove institution?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This permanently deletes {i.name} and removes all
                            candidate-institution affiliations. Linked user
                            accounts will lose their institution association.
                            This cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => handleDelete(i.id, i.name)}
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
