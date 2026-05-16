import { useEffect, useMemo, useState } from "react";
import {
  customFetch,
  type CareerConstellation,
  type ConstellationRole,
} from "@workspace/api-client-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sparkles, Plus, X, Network } from "lucide-react";
import { Link } from "wouter";
import { toast } from "sonner";

const RING_LABELS: Record<number, string> = {
  0: "You qualify",
  1: "1 skill away",
  2: "2 skills away",
};
const RING_COLORS: Record<number, string> = {
  0: "fill-emerald-500/15 stroke-emerald-500/40",
  1: "fill-primary/10 stroke-primary/30",
  2: "fill-muted-foreground/10 stroke-muted-foreground/30",
};
const NODE_COLORS: Record<number, string> = {
  0: "fill-emerald-500",
  1: "fill-primary",
  2: "fill-muted-foreground",
};

function layoutRoles(roles: ConstellationRole[]) {
  const byDistance: Record<number, ConstellationRole[]> = { 0: [], 1: [], 2: [] };
  for (const r of roles) {
    const d = Math.max(0, Math.min(2, r.distance));
    byDistance[d].push(r);
  }
  const radii = { 0: 95, 1: 165, 2: 235 };
  const placements: {
    role: ConstellationRole;
    x: number;
    y: number;
    distance: number;
  }[] = [];
  for (const d of [0, 1, 2] as const) {
    const items = byDistance[d];
    if (items.length === 0) continue;
    const r = radii[d];
    const startOffset = -Math.PI / 2;
    items.forEach((role, i) => {
      const theta = startOffset + (i * 2 * Math.PI) / items.length;
      placements.push({
        role,
        x: 280 + r * Math.cos(theta),
        y: 220 + r * Math.sin(theta),
        distance: d,
      });
    });
  }
  return placements;
}

export function CareerConstellationCard() {
  const [data, setData] = useState<CareerConstellation | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ConstellationRole | null>(null);
  const [addingSkill, setAddingSkill] = useState<string | null>(null);
  const [addedSkills, setAddedSkills] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    customFetch<CareerConstellation>("/api/me/career-constellation")
      .then((d) => {
        if (cancelled) return;
        setData(d);
      })
      .catch(() => {
        if (cancelled) return;
        setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const placements = useMemo(
    () => (data ? layoutRoles(data.roles) : []),
    [data],
  );

  async function addToGrowthPlan(skill: string) {
    const lower = skill.toLowerCase();
    setAddingSkill(lower);
    try {
      await customFetch(
        `/api/me/growth-plan/${encodeURIComponent(lower)}/add`,
        { method: "POST" },
      );
      setAddedSkills((s) => new Set(s).add(lower));
      toast.success(`${skill} added to your growth plan`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setAddingSkill(null);
    }
  }

  if (loading) {
    return (
      <Card className="shadow-sm">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Network className="w-5 h-5 text-primary" /> Career constellation
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="animate-pulse h-[440px] bg-muted rounded-xl" />
        </CardContent>
      </Card>
    );
  }
  if (!data || data.roles.length === 0) {
    return (
      <Card className="shadow-sm" data-testid="card-career-constellation">
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Network className="w-5 h-5 text-primary" /> Career constellation
          </CardTitle>
          <CardDescription>
            Add more skills to your profile to see roles you're close to.
          </CardDescription>
        </CardHeader>
      </Card>
    );
  }

  const grouped: Record<0 | 1 | 2, ConstellationRole[]> = { 0: [], 1: [], 2: [] };
  for (const r of data.roles) {
    const d = Math.max(0, Math.min(2, r.distance)) as 0 | 1 | 2;
    grouped[d].push(r);
  }

  return (
    <Card className="shadow-sm" data-testid="card-career-constellation">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Network className="w-5 h-5 text-primary" /> Career constellation
        </CardTitle>
        <CardDescription>
          Roles you qualify for and ones you're 1–2 skills away from. Click a
          node to see jobs and the missing skills.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid lg:grid-cols-[2fr,1fr] gap-6">
        <div className="relative w-full aspect-[7/5] min-h-[360px] rounded-xl border bg-gradient-to-br from-primary/5 to-transparent overflow-hidden">
          <svg
            viewBox="0 0 560 440"
            className="w-full h-full"
            role="img"
            aria-label="Career constellation graph"
          >
            {[2, 1, 0].map((d) => (
              <circle
                key={d}
                cx={280}
                cy={220}
                r={[95, 165, 235][d]}
                className={RING_COLORS[d]}
                strokeDasharray="4 4"
                strokeWidth={1}
              />
            ))}
            {placements.map((p) => (
              <line
                key={`l-${p.role.title}`}
                x1={280}
                y1={220}
                x2={p.x}
                y2={p.y}
                className="stroke-muted-foreground/20"
                strokeWidth={1}
              />
            ))}
            <circle cx={280} cy={220} r={28} className="fill-primary" />
            <text
              x={280}
              y={224}
              textAnchor="middle"
              className="fill-primary-foreground text-[11px] font-semibold"
            >
              You
            </text>
            {placements.map((p) => {
              const isSelected = selected?.title === p.role.title;
              return (
                <g
                  key={p.role.title}
                  onClick={() => setSelected(p.role)}
                  style={{ cursor: "pointer" }}
                  data-testid={`constellation-node-${p.role.title}`}
                >
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={isSelected ? 16 : 12}
                    className={`${NODE_COLORS[p.distance]} transition-all`}
                    stroke={isSelected ? "white" : "transparent"}
                    strokeWidth={isSelected ? 3 : 0}
                  />
                  <text
                    x={p.x}
                    y={p.y - 18}
                    textAnchor="middle"
                    className="fill-foreground text-[10px] font-semibold"
                  >
                    {p.role.title.length > 22
                      ? `${p.role.title.slice(0, 22)}…`
                      : p.role.title}
                  </text>
                  {p.distance > 0 && p.role.missingSkills.length > 0 ? (
                    <text
                      x={p.x}
                      y={p.y + 28}
                      textAnchor="middle"
                      className="fill-muted-foreground text-[9px]"
                    >
                      missing: {p.role.missingSkills.slice(0, 1).join(", ")}
                      {p.role.missingSkills.length > 1
                        ? ` +${p.role.missingSkills.length - 1}`
                        : ""}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
          <div className="absolute bottom-2 left-2 flex gap-2 text-[10px]">
            {(Object.keys(RING_LABELS) as unknown as number[]).map((dStr) => {
              const d = Number(dStr) as 0 | 1 | 2;
              return (
                <span
                  key={d}
                  className="bg-background/80 border rounded-full px-2 py-0.5"
                >
                  <span
                    className={`inline-block w-2 h-2 rounded-full mr-1 align-middle ${NODE_COLORS[d].replace("fill-", "bg-")}`}
                  />
                  {RING_LABELS[d]}
                </span>
              );
            })}
          </div>
        </div>

        <div className="space-y-3">
          {selected ? (
            <div
              className="border rounded-xl p-4 space-y-3"
              data-testid="constellation-detail"
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-semibold">{selected.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {selected.jobCount} open job
                    {selected.jobCount === 1 ? "" : "s"}
                    {" · "}
                    {selected.distance === 0
                      ? "You qualify"
                      : `${selected.distance} skill${selected.distance === 1 ? "" : "s"} away`}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setSelected(null)}
                  aria-label="Close"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
              {selected.missingSkills.length > 0 ? (
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5">
                    Missing skills
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {selected.missingSkills.map((s) => {
                      const isAdded = addedSkills.has(s.toLowerCase());
                      return (
                        <Button
                          key={s}
                          size="sm"
                          variant={isAdded ? "secondary" : "outline"}
                          className="h-7 text-xs"
                          disabled={
                            isAdded || addingSkill === s.toLowerCase()
                          }
                          onClick={() => addToGrowthPlan(s)}
                          data-testid={`add-growth-${s}`}
                        >
                          {isAdded ? (
                            <Sparkles className="w-3 h-3 mr-1" />
                          ) : (
                            <Plus className="w-3 h-3 mr-1" />
                          )}
                          {s}
                        </Button>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-emerald-700 dark:text-emerald-400">
                  You meet every required skill for this role.
                </p>
              )}
              {selected.sampleJobs.length > 0 ? (
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5">
                    Example openings
                  </p>
                  <ul className="space-y-1">
                    {selected.sampleJobs.map((j) => (
                      <li key={j.jobId}>
                        <Link
                          href={`/jobs/${j.jobId}`}
                          className="text-sm text-primary hover:underline"
                        >
                          {j.title} · {j.employerName}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="border border-dashed rounded-xl p-4 text-sm text-muted-foreground">
              Click a role on the graph to see example jobs and which skills
              are still missing.
            </div>
          )}

          <div className="space-y-2">
            {([0, 1, 2] as const).map((d) => {
              if (grouped[d].length === 0) return null;
              return (
                <div key={d}>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
                    {RING_LABELS[d]} · {grouped[d].length}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {grouped[d].slice(0, 6).map((r) => (
                      <Badge
                        key={r.title}
                        variant="outline"
                        className="cursor-pointer hover:bg-accent"
                        onClick={() => setSelected(r)}
                      >
                        {r.title}
                      </Badge>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
