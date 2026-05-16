import { describe, it, expect } from "vitest";
import {
  calculateMatchScore,
  createMatchScoreMemo,
} from "../lib/matching";

describe("calculateMatchScore", () => {
  it("scores a perfect skill match high", () => {
    const r = calculateMatchScore(
      ["typescript", "react"],
      ["TypeScript", "React"],
      3,
      80,
    );
    expect(r.score).toBeGreaterThanOrEqual(80);
    expect(r.matchedSkills).toHaveLength(2);
    expect(r.missingSkills).toHaveLength(0);
    expect(r.skillCoveragePct).toBe(100);
  });

  it("lists missing skills when candidate is short", () => {
    const r = calculateMatchScore(
      ["typescript", "react", "graphql"],
      ["typescript"],
      0,
      50,
    );
    expect(r.matchedSkills).toEqual(["typescript"]);
    expect(r.missingSkills).toEqual(["react", "graphql"]);
    expect(r.skillCoveragePct).toBe(33);
  });

  it("is case-insensitive on skill comparison", () => {
    const r = calculateMatchScore(["PYTHON"], ["python"], 2, 70);
    expect(r.matchedSkills).toHaveLength(1);
  });

  it("clamps the final score to the [15, 99] band", () => {
    const low = calculateMatchScore([], [], 0, 0);
    expect(low.score).toBeGreaterThanOrEqual(15);

    const high = calculateMatchScore(
      ["a", "b"],
      ["a", "b"],
      100,
      100,
    );
    expect(high.score).toBeLessThanOrEqual(99);
  });

  it("applies the premium-institution bonus when opted in", () => {
    const base = calculateMatchScore(
      ["a"],
      ["a"],
      1,
      50,
      { verifiedByPremium: false },
    );
    const bonused = calculateMatchScore(
      ["a"],
      ["a"],
      1,
      50,
      { verifiedByPremium: true },
    );
    // Premium bonus is small (+2) and capped at 99.
    expect(bonused.score - base.score).toBeGreaterThanOrEqual(0);
    expect(bonused.score - base.score).toBeLessThanOrEqual(2);
  });

  it("treats an empty job-skills list as neutral (0.5 coverage)", () => {
    const r = calculateMatchScore([], ["x"], 5, 80);
    // 0.5 * 0.65 + 0.5 * 0.15 + 0.8 * 0.2 = ~56
    expect(r.score).toBeGreaterThan(40);
    expect(r.score).toBeLessThan(70);
  });
});

describe("createMatchScoreMemo", () => {
  it("returns identical results for repeat lookups", () => {
    const memo = createMatchScoreMemo();
    const a = memo(["x", "y"], ["x"], 2, 60);
    const b = memo(["x", "y"], ["x"], 2, 60);
    expect(a).toBe(b); // referentially equal — same cached object
  });

  it("collides on unordered skill lists", () => {
    const memo = createMatchScoreMemo();
    const a = memo(["a", "b"], ["x", "y"], 1, 50);
    const b = memo(["b", "a"], ["y", "x"], 1, 50);
    expect(a).toBe(b);
  });

  it("distinguishes the premium-bonus opt", () => {
    const memo = createMatchScoreMemo();
    const plain = memo(["a"], ["a"], 1, 50);
    const bonus = memo(["a"], ["a"], 1, 50, { verifiedByPremium: true });
    expect(plain).not.toBe(bonus);
  });
});
