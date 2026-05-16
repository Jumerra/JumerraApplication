import type { MatchBreakdown } from "@workspace/api-client-react";
import { CheckCircle2, AlertCircle, TrendingUp, Sparkles } from "lucide-react";

/**
 * Plain-English explainer for the deterministic match algorithm
 * (see lib/matching.ts). Renders a candidate-friendly breakdown of
 * the three weighted components — skills (65%), experience (15%),
 * talent score (20%) — plus the matched/missing skill lists. Pure
 * client-side; no AI call required.
 */
export function WhyMatched({
  breakdown,
}: {
  breakdown: MatchBreakdown;
}) {
  const matched = breakdown.matchedSkills ?? [];
  const missing = breakdown.missingSkills ?? [];
  return (
    <div className="space-y-3 text-sm" data-testid="why-matched">
      <p className="font-medium leading-relaxed">{breakdown.summary}</p>
      <Bar
        label="Skills coverage"
        value={breakdown.skillCoveragePct}
        weight="65%"
      />
      <Bar
        label="Experience"
        value={breakdown.experiencePct}
        weight="15%"
      />
      <Bar
        label="Talent score"
        value={breakdown.talentPct}
        weight="20%"
      />
      {matched.length > 0 && (
        <div className="pt-1">
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5">
            Skills you bring
          </p>
          <div className="flex flex-wrap gap-1.5">
            {matched.map((s) => (
              <span
                key={s}
                className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
              >
                <CheckCircle2 className="w-3 h-3" /> {s}
              </span>
            ))}
          </div>
        </div>
      )}
      {missing.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1.5">
            Worth adding
          </p>
          <div className="flex flex-wrap gap-1.5">
            {missing.slice(0, 8).map((s) => (
              <span
                key={s}
                className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-300"
              >
                <AlertCircle className="w-3 h-3" /> {s}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Bar({
  label,
  value,
  weight,
}: {
  label: string;
  value: number;
  weight: string;
}) {
  const safe = Math.max(0, Math.min(100, value || 0));
  return (
    <div>
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-muted-foreground inline-flex items-center gap-1">
          <TrendingUp className="w-3 h-3" /> {label}
          <span className="text-[10px] text-muted-foreground/70">
            · {weight}
          </span>
        </span>
        <span className="font-semibold tabular-nums">{safe}%</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden">
        <div
          className="h-full bg-primary transition-all"
          style={{ width: `${safe}%` }}
        />
      </div>
    </div>
  );
}

export const SparklesIcon = Sparkles;
