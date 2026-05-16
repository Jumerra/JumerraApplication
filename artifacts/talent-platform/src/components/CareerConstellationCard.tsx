import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  Sparkles,
  Plus,
  X,
  Network,
  ZoomIn,
  ZoomOut,
  Maximize2,
} from "lucide-react";
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

const VIEW_W = 560;
const VIEW_H = 440;
const CENTER_X = VIEW_W / 2;
const CENTER_Y = VIEW_H / 2;
const RING_RADII = [95, 165, 235] as const;

function layoutRoles(roles: ConstellationRole[]) {
  const byDistance: Record<number, ConstellationRole[]> = { 0: [], 1: [], 2: [] };
  for (const r of roles) {
    const d = Math.max(0, Math.min(2, r.distance));
    byDistance[d].push(r);
  }
  const placements: {
    role: ConstellationRole;
    x: number;
    y: number;
    distance: number;
  }[] = [];
  for (const d of [0, 1, 2] as const) {
    const items = byDistance[d];
    if (items.length === 0) continue;
    const r = RING_RADII[d];
    const startOffset = -Math.PI / 2;
    items.forEach((role, i) => {
      const theta = startOffset + (i * 2 * Math.PI) / items.length;
      placements.push({
        role,
        x: CENTER_X + r * Math.cos(theta),
        y: CENTER_Y + r * Math.sin(theta),
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

  // Pan/zoom state — applied as a single <g transform> on the SVG.
  const [scale, setScale] = useState(1);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const dragRef = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);

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

  function resetView() {
    setScale(1);
    setTx(0);
    setTy(0);
  }
  function zoomBy(delta: number) {
    setScale((s) => Math.max(0.5, Math.min(3, s * delta)));
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
          Click a node to see jobs and the missing skills. Drag the graph to
          pan, scroll to zoom.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid lg:grid-cols-[2fr,1fr] gap-6">
        <div className="relative w-full aspect-[7/5] min-h-[360px] rounded-xl border bg-gradient-to-br from-primary/5 to-transparent overflow-hidden">
          <div className="absolute top-2 right-2 z-10 flex gap-1">
            <Button
              size="icon"
              variant="outline"
              className="h-7 w-7"
              onClick={() => zoomBy(1.2)}
              aria-label="Zoom in"
              data-testid="constellation-zoom-in"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              className="h-7 w-7"
              onClick={() => zoomBy(1 / 1.2)}
              aria-label="Zoom out"
              data-testid="constellation-zoom-out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </Button>
            <Button
              size="icon"
              variant="outline"
              className="h-7 w-7"
              onClick={resetView}
              aria-label="Reset view"
              data-testid="constellation-reset"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </Button>
          </div>
          <svg
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            className="w-full h-full select-none touch-none"
            role="img"
            aria-label="Career constellation graph"
            style={{
              cursor: dragRef.current ? "grabbing" : "grab",
            }}
            onPointerDown={(e) => {
              (e.target as Element).setPointerCapture(e.pointerId);
              dragRef.current = { x: e.clientX, y: e.clientY, tx, ty };
            }}
            onPointerMove={(e) => {
              if (!dragRef.current) return;
              const dx = e.clientX - dragRef.current.x;
              const dy = e.clientY - dragRef.current.y;
              setTx(dragRef.current.tx + dx);
              setTy(dragRef.current.ty + dy);
            }}
            onPointerUp={() => {
              dragRef.current = null;
            }}
            onWheel={(e) => {
              e.preventDefault();
              zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
            }}
          >
            <g
              transform={`translate(${tx} ${ty}) scale(${scale}) translate(${(1 - scale) * 0} ${(1 - scale) * 0})`}
              transform-origin={`${CENTER_X} ${CENTER_Y}`}
            >
              {[2, 1, 0].map((d) => (
                <circle
                  key={d}
                  cx={CENTER_X}
                  cy={CENTER_Y}
                  r={RING_RADII[d]}
                  className={RING_COLORS[d]}
                  strokeDasharray="4 4"
                  strokeWidth={1}
                />
              ))}
              {placements.map((p) => {
                // Edge from center to node, labeled with the first
                // missing skill (the gap the candidate must close).
                const midX = (CENTER_X + p.x) / 2;
                const midY = (CENTER_Y + p.y) / 2;
                const label =
                  p.distance === 0
                    ? "qualified"
                    : p.role.missingSkills[0] ?? "";
                return (
                  <g key={`edge-${p.role.title}`}>
                    <line
                      x1={CENTER_X}
                      y1={CENTER_Y}
                      x2={p.x}
                      y2={p.y}
                      className="stroke-muted-foreground/30"
                      strokeWidth={1}
                    />
                    {label ? (
                      <g>
                        <rect
                          x={midX - label.length * 3.2 - 4}
                          y={midY - 8}
                          width={label.length * 6.4 + 8}
                          height={14}
                          rx={6}
                          className="fill-background"
                          opacity={0.92}
                        />
                        <text
                          x={midX}
                          y={midY + 2}
                          textAnchor="middle"
                          className="fill-muted-foreground text-[9px]"
                        >
                          {label}
                        </text>
                      </g>
                    ) : null}
                  </g>
                );
              })}
              <circle cx={CENTER_X} cy={CENTER_Y} r={28} className="fill-primary" />
              <text
                x={CENTER_X}
                y={CENTER_Y + 4}
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
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelected(p.role);
                    }}
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
                  </g>
                );
              })}
            </g>
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
