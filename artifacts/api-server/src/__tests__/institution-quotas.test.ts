import { describe, it, expect } from "vitest";
import {
  STARTER_LIMITS,
  evaluateStarterQuota,
} from "../lib/institution-quotas";

describe("evaluateStarterQuota", () => {
  it("returns null when the quota has room", () => {
    expect(
      evaluateStarterQuota({
        premium: false,
        kind: "verifiedStudents",
        current: STARTER_LIMITS.verifiedStudents - 1,
      }),
    ).toBeNull();
  });

  it("returns a 402 payload at the cap", () => {
    const out = evaluateStarterQuota({
      premium: false,
      kind: "faculties",
      current: STARTER_LIMITS.faculties,
    });
    expect(out).not.toBeNull();
    expect(out!.status).toBe(402);
    expect(out!.body.requiresUpgrade).toBe(true);
    expect(out!.body.kind).toBe("faculties");
    expect(out!.body.limit).toBe(STARTER_LIMITS.faculties);
    expect(out!.body.current).toBe(STARTER_LIMITS.faculties);
  });

  it("returns null for premium institutions regardless of count", () => {
    expect(
      evaluateStarterQuota({
        premium: true,
        kind: "verifiedStudents",
        current: 10_000,
      }),
    ).toBeNull();
  });

  it("blocks at-cap for each quota kind", () => {
    const kinds: Array<keyof typeof STARTER_LIMITS> = [
      "verifiedStudents",
      "faculties",
      "departments",
      "staffSeats",
    ];
    for (const kind of kinds) {
      const r = evaluateStarterQuota({
        premium: false,
        kind,
        current: STARTER_LIMITS[kind],
      });
      expect(r).not.toBeNull();
      expect(r!.body.kind).toBe(kind);
    }
  });
});
