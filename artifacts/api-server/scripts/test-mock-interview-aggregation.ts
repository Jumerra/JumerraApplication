/**
 * Unit-style smoke test for `aggregateScores` from
 * routes/mock-interviews.ts. Runs without the Express app or DB.
 * Invoked via `pnpm --filter @workspace/api-server exec tsx
 * ./scripts/test-mock-interview-aggregation.ts`.
 */
import { aggregateScores } from "../src/routes/mock-interviews.js";
import type { MockInterviewTranscriptEntry } from "@workspace/db";

let failed = 0;
function expect(label: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`  ok  ${label}`);
  } else {
    failed += 1;
    console.error(`  FAIL ${label}`, detail ?? "");
  }
}

function entry(
  focus: "technical" | "communication" | "culture",
  scores: { technical: number; communication: number; culture: number },
): MockInterviewTranscriptEntry {
  return {
    questionIndex: 0,
    question: "q",
    answer: "a",
    focus,
    scores,
    feedback: "",
    answeredAt: new Date().toISOString(),
  };
}

console.log("aggregateScores");

// 1. Empty transcript -> null
expect("returns null for empty transcript", aggregateScores([]) === null);

// 2. Perfect 100 across all axes -> 100 overall
const perfect = aggregateScores([
  entry("technical", { technical: 100, communication: 100, culture: 100 }),
  entry("communication", { technical: 100, communication: 100, culture: 100 }),
  entry("culture", { technical: 100, communication: 100, culture: 100 }),
]);
expect("perfect transcript -> 100", perfect?.scoreOverall === 100, perfect);

// 3. Per-axis weighting: a tech question should pull tech up more than the
//    other axes when the underlying scores diverge.
const weighted = aggregateScores([
  entry("technical", { technical: 100, communication: 0, culture: 0 }),
  entry("technical", { technical: 100, communication: 0, culture: 0 }),
])!;
expect(
  "focus weighting tilts toward technical",
  weighted.scoreTechnical > weighted.scoreCommunication &&
    weighted.scoreTechnical > weighted.scoreCulture,
  weighted,
);

// 4. Overall weighting is 50/30/20
const mixed = aggregateScores([
  entry("technical", { technical: 80, communication: 60, culture: 40 }),
])!;
const expectedOverall = Math.round(80 * 0.5 + 60 * 0.3 + 40 * 0.2);
const actualOverall = Math.round(mixed.scoreOverall);
expect(
  `overall ~= 50/30/20 weighted (got ${actualOverall}, want ${expectedOverall})`,
  Math.abs(actualOverall - expectedOverall) <= 1,
  mixed,
);

// 5. Clamping: scores outside 0..100 are clamped
const clamped = aggregateScores([
  entry("technical", { technical: 200, communication: -10, culture: 50 }),
])!;
expect(
  "clamps to [0, 100]",
  clamped.scoreTechnical <= 100 && clamped.scoreCommunication >= 0,
  clamped,
);

// 6. Unknown focus axis is treated as unweighted (no crash)
const unknown = aggregateScores([
  // @ts-expect-error -- intentionally invalid focus
  entry("unknown", { technical: 50, communication: 50, culture: 50 }),
]);
expect("tolerates unknown focus", unknown != null && unknown.scoreOverall === 50);

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nall assertions passed");
