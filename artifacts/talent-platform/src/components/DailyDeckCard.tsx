import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sparkles,
  Heart,
  X,
  RotateCcw,
  Briefcase,
  MapPin,
  GraduationCap,
} from "lucide-react";
import { toast } from "sonner";
import {
  useListTalentPools,
  getListTalentPoolsQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";

type DeckItem = {
  candidate: {
    id: number;
    fullName: string;
    headline: string;
    location: string;
    avatarUrl: string;
    bio: string;
    skills: string[];
    talentScore: number;
    yearsExperience: number;
    openToOffers: boolean;
  };
  bestJobId: number | null;
  bestJobTitle: string | null;
  matchScore: number;
  matchedSkills: string[];
  missingSkills: string[];
  summary: string;
};

type DeckResponse = {
  deckDate: string;
  openJobsCount: number;
  items: DeckItem[];
};

const SWIPE_THRESHOLD = 120;

export function DailyDeckCard() {
  const { sessionUser } = useAuth();
  const employerId = sessionUser?.employerId ?? 0;
  const [data, setData] = useState<DeckResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<
    { item: DeckItem; action: "shortlist" | "dismiss" }[]
  >([]);
  const poolPrefKey =
    employerId > 0 ? `jumerra:dailyDeck:poolId:${employerId}` : null;
  const [selectedPoolId, setSelectedPoolId] = useState<string>(() => {
    if (typeof window === "undefined" || !poolPrefKey) return "default";
    try {
      return window.localStorage.getItem(poolPrefKey) ?? "default";
    } catch {
      return "default";
    }
  });

  const { data: pools } = useListTalentPools(employerId, {
    query: {
      enabled: employerId > 0,
      queryKey: getListTalentPoolsQueryKey(employerId),
    },
  });

  useEffect(() => {
    if (typeof window === "undefined" || !poolPrefKey) return;
    try {
      const stored = window.localStorage.getItem(poolPrefKey) ?? "default";
      if (stored !== selectedPoolId) setSelectedPoolId(stored);
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [poolPrefKey]);

  useEffect(() => {
    if (selectedPoolId === "default") return;
    if (!pools) return;
    const stillExists = pools.some((p) => String(p.id) === selectedPoolId);
    if (!stillExists) {
      setSelectedPoolId("default");
      if (typeof window !== "undefined" && poolPrefKey) {
        try {
          window.localStorage.removeItem(poolPrefKey);
        } catch {
          // ignore
        }
      }
    }
  }, [pools, selectedPoolId, poolPrefKey]);

  const handlePoolChange = (next: string) => {
    setSelectedPoolId(next);
    if (typeof window === "undefined" || !poolPrefKey) return;
    try {
      if (next === "default") {
        window.localStorage.removeItem(poolPrefKey);
      } else {
        window.localStorage.setItem(poolPrefKey, next);
      }
    } catch {
      // ignore
    }
  };
  const selectedPoolName =
    selectedPoolId === "default"
      ? "Daily picks"
      : (pools?.find((p) => String(p.id) === selectedPoolId)?.name ??
        "Daily picks");

  const loadDeck = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/me/daily-deck", {
        credentials: "include",
      });
      if (res.status === 403) {
        setError("Daily picks are only available on employer accounts.");
        setData(null);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as DeckResponse;
      setData(json);
      setIndex(0);
      setHistory([]);
    } catch (e) {
      setError("Could not load today's deck. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadDeck();
  }, []);

  const current = data?.items[index];
  const remaining = useMemo(
    () => (data ? data.items.length - index : 0),
    [data, index],
  );

  const shortlist = async () => {
    if (!current || busy) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/me/daily-deck/${current.candidate.id}/shortlist`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jobId: current.bestJobId ?? undefined,
            poolId:
              selectedPoolId === "default"
                ? undefined
                : Number(selectedPoolId),
          }),
        },
      );
      if (!res.ok) throw new Error("shortlist failed");
      toast.success(
        `${current.candidate.fullName} added to ${selectedPoolName}`,
      );
      setHistory((h) => [...h, { item: current, action: "shortlist" }]);
      setIndex((i) => i + 1);
    } catch {
      toast.error("Could not add to talent pool");
    } finally {
      setBusy(false);
    }
  };

  const dismiss = async () => {
    if (!current || busy) return;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/me/daily-deck/${current.candidate.id}/dismiss`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        },
      );
      if (!res.ok) throw new Error("dismiss failed");
      setHistory((h) => [...h, { item: current, action: "dismiss" }]);
      setIndex((i) => i + 1);
    } catch {
      toast.error("Could not dismiss candidate");
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <Card className="shadow-sm">
        <CardContent className="p-6">
          <div className="h-[420px] animate-pulse bg-muted/40 rounded-xl" />
        </CardContent>
      </Card>
    );
  }
  if (error) {
    return (
      <Card className="shadow-sm">
        <CardContent className="p-6 text-sm text-muted-foreground">
          {error}
        </CardContent>
      </Card>
    );
  }
  if (!data) return null;

  return (
    <Card className="shadow-sm overflow-hidden" data-testid="card-daily-deck">
      <CardContent className="p-6 space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              Daily picks
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {data.openJobsCount > 0
                ? `Top candidates across your ${data.openJobsCount} open ${data.openJobsCount === 1 ? "role" : "roles"} — refreshed daily.`
                : "Post a role to see candidates matched to your hiring needs."}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1 shrink-0">
            <Select
              value={selectedPoolId}
              onValueChange={handlePoolChange}
            >
              <SelectTrigger
                className="h-8 w-[180px] text-xs"
                data-testid="select-deck-pool"
              >
                <SelectValue placeholder="Save to pool" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">Daily picks</SelectItem>
                {pools?.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="text-xs text-muted-foreground">
              {remaining > 0 ? `${remaining} left today` : "Done for today"}
            </div>
          </div>
        </div>

        {current ? (
          <div className="relative">
            <AnimatePresence mode="wait">
              <motion.div
                key={current.candidate.id}
                initial={{ opacity: 0, scale: 0.96, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.2 } }}
                drag="x"
                dragConstraints={{ left: 0, right: 0 }}
                dragElastic={0.6}
                onDragEnd={(_, info) => {
                  if (info.offset.x > SWIPE_THRESHOLD) void shortlist();
                  else if (info.offset.x < -SWIPE_THRESHOLD) void dismiss();
                }}
                whileDrag={{ rotate: 0, cursor: "grabbing" }}
                className="cursor-grab active:cursor-grabbing"
                data-testid={`deck-card-${current.candidate.id}`}
              >
                <div className="rounded-2xl border bg-card shadow-sm overflow-hidden">
                  <div className="p-5 flex items-start gap-4">
                    <img
                      src={current.candidate.avatarUrl}
                      alt=""
                      className="w-16 h-16 rounded-xl object-cover bg-muted shrink-0"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h3 className="font-semibold truncate">
                            {current.candidate.fullName}
                          </h3>
                          <p className="text-sm text-muted-foreground truncate">
                            {current.candidate.headline}
                          </p>
                        </div>
                        <Badge className="bg-primary/10 text-primary border-primary/20 shrink-0">
                          {current.matchScore}% match
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-muted-foreground">
                        {current.candidate.location ? (
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="w-3 h-3" />
                            {current.candidate.location}
                          </span>
                        ) : null}
                        <span className="inline-flex items-center gap-1">
                          <GraduationCap className="w-3 h-3" />
                          {current.candidate.yearsExperience}y exp
                        </span>
                        {current.bestJobTitle ? (
                          <span className="inline-flex items-center gap-1">
                            <Briefcase className="w-3 h-3" />
                            Best fit: {current.bestJobTitle}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  {current.candidate.bio ? (
                    <p className="px-5 text-sm text-muted-foreground line-clamp-3">
                      {current.candidate.bio}
                    </p>
                  ) : null}

                  <div className="px-5 pt-3">
                    <p className="text-xs font-medium text-muted-foreground mb-1.5">
                      Why this match
                    </p>
                    <p className="text-sm">{current.summary}</p>
                  </div>

                  <div className="px-5 pt-3 pb-5 flex flex-wrap gap-1.5">
                    {current.matchedSkills.slice(0, 6).map((s) => (
                      <Badge
                        key={s}
                        variant="secondary"
                        className="bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200"
                      >
                        {s}
                      </Badge>
                    ))}
                    {current.missingSkills.slice(0, 4).map((s) => (
                      <Badge
                        key={s}
                        variant="outline"
                        className="text-muted-foreground"
                      >
                        {s}
                      </Badge>
                    ))}
                  </div>
                </div>
              </motion.div>
            </AnimatePresence>

            <div className="flex items-center justify-center gap-3 mt-4">
              <Button
                variant="outline"
                size="lg"
                onClick={dismiss}
                disabled={busy}
                aria-label="Skip"
                className="rounded-full h-12 w-12 p-0"
                data-testid="button-deck-dismiss"
              >
                <X className="w-5 h-5" />
              </Button>
              <Button
                size="lg"
                onClick={shortlist}
                disabled={busy}
                aria-label="Add to talent pool"
                className="rounded-full h-12 w-12 p-0 bg-primary"
                data-testid="button-deck-shortlist"
              >
                <Heart className="w-5 h-5" />
              </Button>
            </div>
            <p className="text-center text-xs text-muted-foreground mt-2">
              Swipe right to shortlist, left to skip. Skipped candidates won't
              show up again.
            </p>
          </div>
        ) : (
          <div className="py-10 text-center space-y-3">
            <div className="mx-auto w-12 h-12 rounded-full bg-muted flex items-center justify-center">
              <Sparkles className="w-6 h-6 text-muted-foreground" />
            </div>
            <div>
              <p className="font-medium">You're all caught up</p>
              <p className="text-sm text-muted-foreground mt-1">
                {history.length > 0
                  ? `You reviewed ${history.length} ${history.length === 1 ? "candidate" : "candidates"} today. Come back tomorrow for a fresh deck.`
                  : "No new candidates today — check back tomorrow."}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void loadDeck()}
              data-testid="button-deck-refresh"
            >
              <RotateCcw className="w-4 h-4 mr-1.5" /> Refresh
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
