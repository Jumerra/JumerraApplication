export function calculateMatchScore(
  jobSkills: string[],
  candidateSkills: string[],
  yearsExperience: number,
  talentScore: number,
): { score: number; matchedSkills: string[] } {
  const jobSet = new Set(jobSkills.map((s) => s.toLowerCase()));
  const candidateSet = new Set(candidateSkills.map((s) => s.toLowerCase()));
  const matched: string[] = [];

  for (const skill of candidateSkills) {
    if (jobSet.has(skill.toLowerCase())) {
      matched.push(skill);
    }
  }

  const skillCoverage =
    jobSkills.length === 0 ? 0.5 : matched.length / jobSkills.length;

  const experienceBoost = Math.min(yearsExperience / 10, 1) * 0.15;
  const talentBoost = (talentScore / 100) * 0.2;
  const skillContribution = skillCoverage * 0.65;

  const raw = (skillContribution + experienceBoost + talentBoost) * 100;
  const score = Math.min(99, Math.max(15, Math.round(raw)));

  return { score, matchedSkills: matched };
}
