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

export function calculateMatchScore(
  jobSkills: string[],
  candidateSkills: string[],
  yearsExperience: number,
  talentScore: number,
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
  const score = Math.min(99, Math.max(15, Math.round(raw)));

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
