export type MatchBreakdown = {
  score: number;
  matchedSkills: string[];
  missingSkills: string[];
  skillCoveragePct: number;
  experiencePct: number;
  talentPct: number;
  skillContribution: number;
  experienceContribution: number;
  talentContribution: number;
  summary: string;
};

function pickSummary(
  matched: number,
  required: number,
  experiencePct: number,
  talentPct: number,
): string {
  if (required > 0 && matched / required >= 0.8) {
    return "Strong skill overlap with this role.";
  }
  if (required > 0 && matched / required >= 0.5) {
    return "You cover most of the core skills — close a small gap to be a top match.";
  }
  if (talentPct >= 80 || experiencePct >= 80) {
    return "Lighter on listed skills, but your overall profile is strong.";
  }
  return "A few skills line up — adding the missing ones will lift your match.";
}

/**
 * Optional tie-breaker bonus added to the final score when the
 * candidate has at least one verified affiliation with an Institution
 * Pro school (T5). Small enough (+2) that it never overrides skill or
 * experience signal — it only nudges otherwise-identical scores up so
 * Pro-verified candidates surface slightly earlier in employer search
 * and Daily Picks results.
 */
const PREMIUM_INSTITUTION_BONUS = 2;

/**
 * Per-request memo wrapper around `calculateMatchScore`.
 *
 * Many list/analytics paths score every candidate in the DB against
 * a single job (or every job against a single candidate) inside one
 * request. Two callers hitting the same skill-set + experience +
 * talent-score tuple would otherwise repeat the Set construction +
 * loop work. Memoising keyed on the input tuple lets the loop in
 * `/jobs/:id/matches`, `/dashboard/candidate/:id` recommendedJobs,
 * and the daily-deck builder reuse the same breakdown.
 *
 * NB: do NOT memoise globally — match outputs are sensitive to the
 * caller's `verifiedByPremium` opt, which is part of the key. A
 * cross-request cache would also be a memory leak: callers create
 * a fresh memo per request and discard it when the handler returns.
 */
export function createMatchScoreMemo(): (
  jobSkills: string[],
  candidateSkills: string[],
  yearsExperience: number,
  talentScore: number,
  opts?: { verifiedByPremium?: boolean },
) => MatchBreakdown {
  const cache = new Map<string, MatchBreakdown>();
  // Sort each side once so equivalent unordered skill lists collide
  // on the same cache key. Job skills usually come from the same row
  // for many calls, but we still normalise both for safety.
  function makeKey(
    jobSkills: string[],
    candidateSkills: string[],
    yearsExperience: number,
    talentScore: number,
    verifiedByPremium: boolean,
  ): string {
    const j = jobSkills.map((s) => s.toLowerCase()).sort().join(",");
    const c = candidateSkills.map((s) => s.toLowerCase()).sort().join(",");
    return `${j}||${c}|${yearsExperience}|${talentScore}|${verifiedByPremium ? 1 : 0}`;
  }
  return (jobSkills, candidateSkills, yearsExperience, talentScore, opts = {}) => {
    const verified = Boolean(opts.verifiedByPremium);
    const key = makeKey(
      jobSkills,
      candidateSkills,
      yearsExperience,
      talentScore,
      verified,
    );
    const hit = cache.get(key);
    if (hit) return hit;
    const out = calculateMatchScore(
      jobSkills,
      candidateSkills,
      yearsExperience,
      talentScore,
      { verifiedByPremium: verified },
    );
    cache.set(key, out);
    return out;
  };
}

export function calculateMatchScore(
  jobSkills: string[],
  candidateSkills: string[],
  yearsExperience: number,
  talentScore: number,
  opts: { verifiedByPremium?: boolean } = {},
): MatchBreakdown {
  const candidateSet = new Set(candidateSkills.map((s) => s.toLowerCase()));
  const matched: string[] = [];
  const missing: string[] = [];

  for (const skill of jobSkills) {
    if (candidateSet.has(skill.toLowerCase())) {
      matched.push(skill);
    } else {
      missing.push(skill);
    }
  }

  const skillCoverage =
    jobSkills.length === 0 ? 0.5 : matched.length / jobSkills.length;
  const experienceFactor = Math.min(yearsExperience / 10, 1);
  const talentFactor = Math.max(0, Math.min(1, talentScore / 100));

  const skillContribution = skillCoverage * 0.65;
  const experienceContribution = experienceFactor * 0.15;
  const talentContribution = talentFactor * 0.2;

  const raw = (skillContribution + experienceContribution + talentContribution) * 100;
  const bonus = opts.verifiedByPremium ? PREMIUM_INSTITUTION_BONUS : 0;
  const score = Math.min(99, Math.max(15, Math.round(raw) + bonus));

  const skillCoveragePct = Math.round(skillCoverage * 100);
  const experiencePct = Math.round(experienceFactor * 100);
  const talentPct = Math.round(talentFactor * 100);

  return {
    score,
    matchedSkills: matched,
    missingSkills: missing,
    skillCoveragePct,
    experiencePct,
    talentPct,
    skillContribution: Math.round(skillContribution * 100),
    experienceContribution: Math.round(experienceContribution * 100),
    talentContribution: Math.round(talentContribution * 100),
    summary: pickSummary(matched.length, jobSkills.length, talentPct, experiencePct),
  };
}
