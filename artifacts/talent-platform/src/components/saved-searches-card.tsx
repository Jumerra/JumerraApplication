import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListSavedSearches,
  useCreateSavedSearch,
  useUpdateSavedSearch,
  useDeleteSavedSearch,
  getListSavedSearchesQueryKey,
  type SavedSearch,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Bookmark, Bell, BellOff, Trash2, Plus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export function SavedSearchesCard({
  candidateId,
  currentFilters,
}: {
  candidateId: number;
  currentFilters: { searchText?: string; jobType?: string };
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const queryKey = getListSavedSearchesQueryKey(candidateId);
  const { data: searches } = useListSavedSearches(candidateId, {
    query: { queryKey, enabled: candidateId > 0 },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey });

  const createMut = useCreateSavedSearch({
    mutation: {
      onSuccess: () => {
        invalidate();
        toast({ title: "Search saved" });
        setName("");
      },
      onError: () => toast({ title: "Could not save search", variant: "destructive" }),
    },
  });
  const updateMut = useUpdateSavedSearch({
    mutation: { onSuccess: invalidate },
  });
  const deleteMut = useDeleteSavedSearch({
    mutation: { onSuccess: invalidate },
  });

  const [name, setName] = useState("");

  const onSave = () => {
    if (!name.trim() || candidateId <= 0) return;
    createMut.mutate({
      id: candidateId,
      data: {
        name: name.trim(),
        searchText: currentFilters.searchText ?? null,
        jobType: (currentFilters.jobType as never) ?? null,
        alertsEnabled: true,
      },
    });
  };

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Bookmark className="w-4 h-4 text-primary" /> Saved searches
        </CardTitle>
        <CardDescription>
          Save your current filters and we'll alert you when fresh roles match.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {candidateId > 0 ? (
          <div className="flex gap-2">
            <Input
              placeholder='Name this search (e.g. "Remote frontend")'
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="flex-1"
            />
            <Button onClick={onSave} disabled={!name.trim() || createMut.isPending}>
              <Plus className="w-4 h-4 mr-1" /> Save
            </Button>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">Sign in as a candidate to save searches.</p>
        )}

        {searches && searches.length > 0 ? (
          <ul className="divide-y">
            {searches.map((s: SavedSearch) => (
              <li key={s.id} className="flex items-center gap-3 py-3">
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm truncate">{s.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {[s.searchText, s.jobType?.replace("_", " ")].filter(Boolean).join(" · ") || "All jobs"}
                  </p>
                </div>
                {s.newMatchCount > 0 ? (
                  <Badge variant="secondary" className="bg-primary/10 text-primary whitespace-nowrap">
                    {s.newMatchCount} new
                  </Badge>
                ) : null}
                <button
                  type="button"
                  onClick={() =>
                    updateMut.mutate({
                      id: candidateId,
                      searchId: s.id,
                      data: { alertsEnabled: !s.alertsEnabled },
                    })
                  }
                  className="text-muted-foreground hover:text-primary"
                  aria-label={s.alertsEnabled ? "Mute alerts" : "Enable alerts"}
                >
                  {s.alertsEnabled ? <Bell className="w-4 h-4" /> : <BellOff className="w-4 h-4" />}
                </button>
                <Switch
                  checked={s.alertsEnabled}
                  onCheckedChange={(checked) =>
                    updateMut.mutate({
                      id: candidateId,
                      searchId: s.id,
                      data: { alertsEnabled: checked },
                    })
                  }
                  aria-label="Toggle alerts"
                />
                <button
                  type="button"
                  onClick={() =>
                    deleteMut.mutate({ id: candidateId, searchId: s.id })
                  }
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="Delete saved search"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground text-center py-4">
            No saved searches yet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
