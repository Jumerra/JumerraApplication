/**
 * Pure-logic test for the career constellation distance calculator.
 * Runs with `tsx scripts/test-career-constellation.ts`.
 */
import { computeConstellation } from "../src/lib/career-constellation";

let passed = 0;
let failed = 0;
function eq<T>(actual: T, expected: T, label: string) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a === b) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}\n     expected ${b}\n     got      ${a}`);
  }
}

function group(label: string, fn: () => void) {
  console.log(`\n${label}`);
  fn();
}

group("Distance computation", () => {
  const jobs = [
    {
      id: 1,
      title: "Software Engineer",
      employerName: "Acme",
      skills: ["React", "TypeScript", "Node.js"],
    },
    {
      id: 2,
      title: "Senior Software Engineer",
      employerName: "Beta",
      skills: ["React", "TypeScript", "GraphQL"],
    },
    {
      id: 3,
      title: "Data Scientist",
      employerName: "Gamma",
      skills: ["Python", "Pandas", "SQL"],
    },
  ];

  const c = computeConstellation(jobs, ["react", "typescript", "node.js"]);
  const se = c.roles.find((r) => r.title === "Software Engineer");
  eq(!!se, true, "Software Engineer role is present");
  eq(se?.jobCount, 2, "groups SE + Senior SE into one role");
  eq(
    se?.missingSkills.map((s) => s.toLowerCase()).sort(),
    ["graphql"],
    "missing only graphql (frequency-tied skills picked once)",
  );
  eq(se?.distance, 1, "distance is 1");

  const ds = c.roles.find((r) => r.title === "Data Scientist");
  eq(ds, undefined, "data scientist (distance 3) is filtered out");
});

group("Distance 0 fully-qualified role", () => {
  const jobs = [
    {
      id: 1,
      title: "Frontend Engineer",
      employerName: "Acme",
      skills: ["html", "css"],
    },
  ];
  const c = computeConstellation(jobs, ["HTML", "CSS"]);
  eq(c.roles[0]?.distance, 0, "case-insensitive match → distance 0");
  eq(c.roles[0]?.missingSkills, [], "no missing skills");
});

group("Empty inputs", () => {
  eq(computeConstellation([], []).roles, [], "empty jobs → empty roles");
  const c = computeConstellation(
    [{ id: 1, title: "Role", skills: [], employerName: "X" }],
    ["a"],
  );
  eq(c.roles, [], "job with no skills → role excluded");
});

group("Sample jobs are populated", () => {
  const jobs = [
    {
      id: 10,
      title: "Backend Engineer",
      employerName: "Co",
      skills: ["Go", "Postgres"],
    },
    {
      id: 11,
      title: "Backend Engineer",
      employerName: "Co2",
      skills: ["Go", "Postgres", "Kafka"],
    },
  ];
  const c = computeConstellation(jobs, ["go"]);
  const role = c.roles[0]!;
  eq(role.distance <= 2, true, "distance within threshold");
  eq(role.sampleJobs.length > 0, true, "has at least one sample job");
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
