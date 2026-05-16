import {
  useListCandidates,
  useListTalentPools,
  useAddTalentPoolMembers,
  getGetTalentPoolQueryKey,
  getListTalentPoolsQueryKey,
} from "@workspace/api-client-react";
import { Link } from "wouter";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Search,
  MapPin,
  Star,
  Sparkles,
  BadgeCheck,
  ShieldCheck,
  Users2,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

export default function CandidatesList() {
  const { sessionUser, role } = useAuth();
  const isEmployer = role === "employer";
  const employerId = sessionUser?.employerId ?? 0;
  const qc = useQueryClient();

  const [search, setSearch] = useState("");
  const [verifiedSkill, setVerifiedSkill] = useState("");
  const [openToOffers, setOpenToOffers] = useState(false);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [poolDialogOpen, setPoolDialogOpen] = useState(false);
  const [chosenPoolId, setChosenPoolId] = useState<string>("");

  const { data: candidates, isLoading } = useListCandidates({
    search: search || undefined,
    verifiedSkill: verifiedSkill || undefined,
    openToOffers: openToOffers ? "1" : undefined,
  });
  const { data: pools } = useListTalentPools(employerId, {
    query: {
      enabled: isEmployer && employerId > 0,
      queryKey: getListTalentPoolsQueryKey(employerId),
    },
  });
  const addMembers = useAddTalentPoolMembers();

  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  const toggle = (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const onAddToPool = () => {
    if (!chosenPoolId || selectedIds.length === 0) return;
    const poolId = Number(chosenPoolId);
    addMembers.mutate(
      { id: employerId, poolId, data: { candidateIds: selectedIds } },
      {
        onSuccess: () => {
          toast.success(
            `Added ${selectedIds.length} candidate${
              selectedIds.length === 1 ? "" : "s"
            } to pool`,
          );
          qc.invalidateQueries({
            queryKey: getGetTalentPoolQueryKey(employerId, poolId),
          });
          qc.invalidateQueries({
            queryKey: getListTalentPoolsQueryKey(employerId),
          });
          setSelected(new Set());
          setPoolDialogOpen(false);
          setChosenPoolId("");
        },
        onError: () => toast.error("Could not add to pool"),
      },
    );
  };

  return (
    <div className="container px-4 py-8 max-w-6xl mx-auto">
      <div className="mb-10 space-y-4">
        <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">Talent Directory</h1>
        <p className="text-xl text-muted-foreground">Discover verified professionals and rising stars.</p>
      </div>

      <div className="max-w-2xl mb-6 grid sm:grid-cols-[1fr_220px] gap-3">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <Input
            placeholder="Search by role, skills, or institution..."
            className="pl-12 h-14 text-lg bg-background shadow-sm rounded-xl border-muted-foreground/20"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="relative">
          <BadgeCheck className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-600" />
          <Input
            placeholder="Verified skill (e.g. Python)"
            className="pl-9 h-14 bg-background shadow-sm rounded-xl border-muted-foreground/20"
            value={verifiedSkill}
            onChange={(e) => setVerifiedSkill(e.target.value)}
          />
        </div>
      </div>

      {isEmployer ? (
        <div className="flex items-center gap-3 mb-6">
          <Switch
            id="filter-open-to-offers"
            checked={openToOffers}
            onCheckedChange={setOpenToOffers}
            data-testid="switch-open-to-offers"
          />
          <label
            htmlFor="filter-open-to-offers"
            className="text-sm font-medium cursor-pointer"
          >
            Open to offers only
          </label>
        </div>
      ) : null}

      {isEmployer && selectedIds.length > 0 ? (
        <div className="sticky top-20 z-20 mb-6 flex items-center justify-between gap-3 rounded-xl border bg-card/95 backdrop-blur px-4 py-3 shadow-sm">
          <div className="text-sm font-medium">
            {selectedIds.length} selected
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelected(new Set())}
            >
              <X className="w-4 h-4 mr-1" /> Clear
            </Button>
            <Button
              size="sm"
              onClick={() => setPoolDialogOpen(true)}
              data-testid="button-add-to-pool"
            >
              <Users2 className="w-4 h-4 mr-2" /> Add to pool
            </Button>
          </div>
        </div>
      ) : null}

      {isLoading ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1,2,3,4,5,6].map(i => (
            <Card key={i} className="h-64 animate-pulse bg-muted/50 rounded-2xl" />
          ))}
        </div>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {candidates?.map((candidate) => {
            const isSelected = selected.has(candidate.id);
            return (
            <Card
              key={candidate.id}
              className={`group overflow-hidden rounded-2xl hover:shadow-lg transition-all cursor-pointer relative bg-card ${
                isSelected
                  ? "border-primary ring-2 ring-primary/30"
                  : "border-transparent hover:border-border"
              }`}
              onClick={() => (window.location.href = `/candidates/${candidate.id}`)}
            >
              {candidate.isBoosted && (
                <div className="absolute top-4 right-4 z-10 bg-gradient-to-r from-amber-400 to-orange-500 text-white text-xs font-bold px-2 py-1 rounded-md flex items-center gap-1 shadow-sm">
                  <Sparkles className="w-3 h-3" /> Promoted
                </div>
              )}
              {isEmployer ? (
                <div
                  className="absolute top-3 left-3 z-10"
                  onClick={(e) => toggle(candidate.id, e)}
                >
                  <Checkbox
                    checked={isSelected}
                    aria-label="Select candidate"
                    data-testid={`checkbox-candidate-${candidate.id}`}
                    className="bg-background"
                  />
                </div>
              ) : null}
              <CardContent className="p-6">
                <div className="flex gap-4 items-start mb-4">
                  <img 
                    src={candidate.avatarUrl} 
                    alt={candidate.fullName} 
                    className="w-16 h-16 rounded-full object-cover bg-muted border-2 border-background shadow-sm" 
                  />
                  <div className="flex-1 min-w-0 pt-1">
                    <h3 className="text-lg font-bold truncate group-hover:text-primary transition-colors">{candidate.fullName}</h3>
                    <p className="text-sm font-medium text-muted-foreground truncate">{candidate.headline}</p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 mb-4">
                  <Badge variant="outline" className="flex items-center gap-1 font-normal bg-background">
                    <MapPin className="w-3 h-3" />
                    {candidate.location}
                  </Badge>
                  <Badge variant="secondary" className="flex items-center gap-1 font-semibold text-primary bg-primary/10 border-transparent">
                    <Star className="w-3 h-3 fill-primary text-primary" />
                    {candidate.talentScore} Score
                  </Badge>
                  {candidate.openToOffers ? (
                    <Badge className="text-xs bg-emerald-600 hover:bg-emerald-600">
                      Open to offers
                    </Badge>
                  ) : null}
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between flex-wrap gap-2">
                    <div className="text-sm">
                      <span className="text-muted-foreground font-medium">Availability:</span>{" "}
                      <span className="capitalize text-foreground font-medium">{candidate.availability.replace('_', ' ')}</span>
                    </div>
                    {candidate.backgroundCheck?.status === "passed" ? (
                      <Badge className="gap-1 bg-emerald-600 hover:bg-emerald-600 text-white">
                        <ShieldCheck className="w-3 h-3" /> BG check
                      </Badge>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {candidate.skills.slice(0, 4).map(skill => {
                      const verified = candidate.verifiedSkills?.some(
                        (v) => v.skill.toLowerCase() === skill.toLowerCase(),
                      );
                      return (
                        <span
                          key={skill}
                          className={`px-2 py-1 rounded-md text-xs font-medium inline-flex items-center gap-1 ${
                            verified
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-900"
                              : "bg-muted/50 text-muted-foreground"
                          }`}
                        >
                          {verified ? <BadgeCheck className="w-3 h-3" /> : null}
                          {skill}
                        </span>
                      );
                    })}
                    {candidate.skills.length > 4 && (
                      <span className="px-2 py-1 bg-muted/50 rounded-md text-xs font-medium text-muted-foreground">
                        +{candidate.skills.length - 4}
                      </span>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
            );
          })}
        </div>
      )}

      <Dialog open={poolDialogOpen} onOpenChange={setPoolDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Add {selectedIds.length} candidate
              {selectedIds.length === 1 ? "" : "s"} to a pool
            </DialogTitle>
          </DialogHeader>
          {pools && pools.length > 0 ? (
            <Select value={chosenPoolId} onValueChange={setChosenPoolId}>
              <SelectTrigger data-testid="select-pool">
                <SelectValue placeholder="Pick a pool…" />
              </SelectTrigger>
              <SelectContent>
                {pools.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name} ({p.memberCount})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <p className="text-sm text-muted-foreground">
              You have no talent pools yet.{" "}
              <Link
                href="/dashboard/employer/talent-pools"
                className="underline"
              >
                Create one
              </Link>
              .
            </p>
          )}
          <DialogFooter>
            <Button
              onClick={onAddToPool}
              disabled={!chosenPoolId || addMembers.isPending}
              data-testid="button-confirm-add-to-pool"
            >
              Add to pool
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
