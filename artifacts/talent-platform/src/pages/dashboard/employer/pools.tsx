import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListTalentPools,
  useCreateTalentPool,
  useDeleteTalentPool,
  getListTalentPoolsQueryKey,
} from "@workspace/api-client-react";

import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Users2, Plus, Trash2, ArrowRight } from "lucide-react";

export default function TalentPoolsPage() {
  const { sessionUser } = useAuth();
  const employerId = sessionUser?.employerId ?? 0;
  const qc = useQueryClient();
  const { data: pools, isLoading } = useListTalentPools(employerId, {
    query: {
      enabled: employerId > 0,
      queryKey: getListTalentPoolsQueryKey(employerId),
    },
  });
  const create = useCreateTalentPool();
  const remove = useDeleteTalentPool();

  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const onCreate = () => {
    if (!name.trim()) {
      toast.error("Pool name is required");
      return;
    }
    create.mutate(
      { id: employerId, data: { name: name.trim(), description } },
      {
        onSuccess: () => {
          toast.success("Talent pool created");
          qc.invalidateQueries({
            queryKey: getListTalentPoolsQueryKey(employerId),
          });
          setOpen(false);
          setName("");
          setDescription("");
        },
        onError: () => toast.error("Could not create pool"),
      },
    );
  };

  const onDelete = (poolId: number) => {
    if (!confirm("Delete this pool? Members are removed but candidates stay."))
      return;
    remove.mutate(
      { id: employerId, poolId },
      {
        onSuccess: () => {
          toast.success("Pool deleted");
          qc.invalidateQueries({
            queryKey: getListTalentPoolsQueryKey(employerId),
          });
        },
        onError: () => toast.error("Could not delete pool"),
      },
    );
  };

  return (
    <div className="container px-4 py-8 max-w-5xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Talent Pools</h1>
          <p className="text-muted-foreground mt-1">
            Save shortlists of candidates and tag them for follow-up.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-new-pool">
              <Plus className="w-4 h-4 mr-2" /> New pool
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create a talent pool</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <label className="text-sm font-medium">Name</label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Frontend grads — 2026"
                  data-testid="input-pool-name"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Description</label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional notes about why you grouped these candidates."
                  data-testid="input-pool-description"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                onClick={onCreate}
                disabled={create.isPending}
                data-testid="button-create-pool"
              >
                Create pool
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="grid sm:grid-cols-2 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="h-32 animate-pulse bg-muted/50" />
          ))}
        </div>
      ) : pools && pools.length > 0 ? (
        <div className="grid sm:grid-cols-2 gap-4">
          {pools.map((pool) => (
            <Card key={pool.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-5 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold truncate">{pool.name}</h3>
                    {pool.description ? (
                      <p className="text-sm text-muted-foreground line-clamp-2 mt-1">
                        {pool.description}
                      </p>
                    ) : null}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onDelete(pool.id)}
                    aria-label="Delete pool"
                    data-testid={`button-delete-pool-${pool.id}`}
                  >
                    <Trash2 className="w-4 h-4 text-muted-foreground" />
                  </Button>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground inline-flex items-center gap-1">
                    <Users2 className="w-4 h-4" /> {pool.memberCount} members
                  </span>
                  <Button asChild variant="ghost" size="sm">
                    <Link
                      href={`/dashboard/employer/talent-pools/${pool.id}`}
                      data-testid={`link-open-pool-${pool.id}`}
                    >
                      Open <ArrowRight className="w-4 h-4 ml-1" />
                    </Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            <Users2 className="w-10 h-10 mx-auto mb-3 opacity-50" />
            <p className="font-medium">No talent pools yet</p>
            <p className="text-sm mt-1">
              Create one to save shortlists from your candidate searches.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
