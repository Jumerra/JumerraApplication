import { useState } from "react";
import { Link } from "wouter";
import {
  useListCandidates,
  useAdminDeleteCandidate,
  getListCandidatesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Search, Trash2, ExternalLink, Users, Star } from "lucide-react";

export default function AdminCandidatesPage() {
  const [search, setSearch] = useState("");
  const { data: candidates, isLoading } = useListCandidates({
    search: search || undefined,
  });
  const deleteCandidate = useAdminDeleteCandidate();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  async function handleDelete(id: number, name: string) {
    try {
      await deleteCandidate.mutateAsync({ id });
      await queryClient.invalidateQueries({ queryKey: getListCandidatesQueryKey() });
      toast({
        title: "Candidate removed",
        description: `${name} and all related data have been deleted.`,
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
          <Users className="w-7 h-7" />
        </div>
        <div className="flex-1">
          <h1 className="text-3xl font-bold tracking-tight">Manage Candidates</h1>
          <p className="text-muted-foreground mt-1">
            View, audit, and remove candidate profiles on the platform.
          </p>
        </div>
        <Badge variant="secondary" className="text-sm">
          {candidates?.length ?? 0} total
        </Badge>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search by name, headline, or skill…"
              className="pl-10"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 text-center text-muted-foreground">Loading…</div>
          ) : !candidates || candidates.length === 0 ? (
            <div className="p-8 text-center text-muted-foreground">
              No candidates match your search.
            </div>
          ) : (
            <div className="divide-y">
              {candidates.map((c) => (
                <div
                  key={c.id}
                  className="flex items-center gap-4 px-6 py-4 hover:bg-muted/40 transition-colors"
                >
                  <img
                    src={c.avatarUrl}
                    alt={c.fullName}
                    className="w-12 h-12 rounded-full object-cover bg-muted shrink-0"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold truncate">{c.fullName}</h3>
                      {c.isBoosted && (
                        <Badge variant="default" className="gap-1 h-5">
                          <Star className="w-3 h-3" />
                          Boosted
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground truncate">
                      {c.headline} · {c.location}
                    </p>
                  </div>
                  <div className="hidden md:flex flex-wrap gap-1 max-w-[260px] justify-end">
                    {c.skills?.slice(0, 3).map((s) => (
                      <Badge key={s} variant="outline" className="text-xs">
                        {s}
                      </Badge>
                    ))}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button asChild variant="ghost" size="sm">
                      <Link href={`/candidates/${c.id}`}>
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
                          <AlertDialogTitle>Remove candidate?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This permanently deletes {c.fullName} along with their
                            applications and institution affiliations. The linked
                            user account will remain but lose its candidate profile.
                            This cannot be undone.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction
                            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            onClick={() => handleDelete(c.id, c.fullName)}
                          >
                            Delete
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
