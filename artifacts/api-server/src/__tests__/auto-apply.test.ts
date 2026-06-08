import { describe, it, expect } from "vitest";
import {
  candidateEligibleForAutoApply,
  decideAutoApplySubmit,
  subscriptionUnlocksAutoApply,
  type AutoApplySubscriptionRow,
} from "../lib/auto-apply";

const NOW = Date.UTC(2026, 5, 8, 12, 0, 0); // fixed clock for deterministic gates

/**
 * Build a minimally-shaped subscription row. Only the fields the gate reads
 * (`status`, `currentPeriodEnd`) matter; the rest are filled with inert
 * defaults and cast to the row type so we don't need a live DB.
 */
function makeSubscription(
  overrides: Partial<AutoApplySubscriptionRow> = {},
): AutoApplySubscriptionRow {
  return {
    id: 1,
    candidateId: 1,
    stripeCheckoutSessionId: "cs_test",
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    provider: "stripe",
    paystackReference: null,
    status: "active",
    priceCentsSnapshot: 150000,
    currencySnapshot: "ngn",
    intervalDaysSnapshot: 30,
    currentPeriodEnd: new Date(NOW + 24 * 60 * 60 * 1000),
    startedAt: new Date(NOW - 24 * 60 * 60 * 1000),
    canceledAt: null,
    createdAt: new Date(NOW - 24 * 60 * 60 * 1000),
    updatedAt: new Date(NOW),
    ...overrides,
  } as AutoApplySubscriptionRow;
}

describe("subscriptionUnlocksAutoApply", () => {
  it("unlocks for an active subscription whose period has not lapsed", () => {
    expect(subscriptionUnlocksAutoApply(makeSubscription(), NOW)).toBe(true);
  });

  it("unlocks while trialing", () => {
    expect(
      subscriptionUnlocksAutoApply(makeSubscription({ status: "trialing" }), NOW),
    ).toBe(true);
  });

  it("does not unlock when there is no subscription", () => {
    expect(subscriptionUnlocksAutoApply(null, NOW)).toBe(false);
  });

  it.each(["pending", "expired", "canceled", "failed"] as const)(
    "does not unlock for status %s",
    (status) => {
      expect(
        subscriptionUnlocksAutoApply(makeSubscription({ status }), NOW),
      ).toBe(false);
    },
  );

  it("does not unlock once the paid period has lapsed", () => {
    expect(
      subscriptionUnlocksAutoApply(
        makeSubscription({ currentPeriodEnd: new Date(NOW - 1) }),
        NOW,
      ),
    ).toBe(false);
  });

  it("does not unlock when currentPeriodEnd is null", () => {
    expect(
      subscriptionUnlocksAutoApply(
        makeSubscription({ currentPeriodEnd: null }),
        NOW,
      ),
    ).toBe(false);
  });

  it("treats the period boundary as expired (strictly greater than now)", () => {
    expect(
      subscriptionUnlocksAutoApply(
        makeSubscription({ currentPeriodEnd: new Date(NOW) }),
        NOW,
      ),
    ).toBe(false);
  });
});

describe("candidateEligibleForAutoApply — the three eligibility gates", () => {
  const unlocking = () => makeSubscription();

  it("is eligible only when all three gates pass", () => {
    expect(
      candidateEligibleForAutoApply({
        globalActive: true,
        candidateEnabled: true,
        subscription: unlocking(),
        now: NOW,
      }),
    ).toBe(true);
  });

  it("blocks when the global admin switch is off", () => {
    expect(
      candidateEligibleForAutoApply({
        globalActive: false,
        candidateEnabled: true,
        subscription: unlocking(),
        now: NOW,
      }),
    ).toBe(false);
  });

  it("blocks when the candidate has not opted in", () => {
    expect(
      candidateEligibleForAutoApply({
        globalActive: true,
        candidateEnabled: false,
        subscription: unlocking(),
        now: NOW,
      }),
    ).toBe(false);
  });

  it("blocks when there is no active subscription", () => {
    expect(
      candidateEligibleForAutoApply({
        globalActive: true,
        candidateEnabled: true,
        subscription: makeSubscription({ status: "expired" }),
        now: NOW,
      }),
    ).toBe(false);
    expect(
      candidateEligibleForAutoApply({
        globalActive: true,
        candidateEnabled: true,
        subscription: null,
        now: NOW,
      }),
    ).toBe(false);
  });
});

describe("decideAutoApplySubmit — per-job submit gates", () => {
  const base = {
    score: 90,
    matchThreshold: 75,
    hasExistingApplication: false,
    dailyCapUsed: 0,
    dailyCap: 10,
  };

  it("proceeds when every gate passes", () => {
    expect(decideAutoApplySubmit(base)).toEqual({ proceed: true });
  });

  describe("match threshold boundary", () => {
    it("proceeds exactly at the threshold", () => {
      expect(
        decideAutoApplySubmit({ ...base, score: 75, matchThreshold: 75 }),
      ).toEqual({ proceed: true });
    });

    it("blocks one point below the threshold", () => {
      expect(
        decideAutoApplySubmit({ ...base, score: 74, matchThreshold: 75 }),
      ).toEqual({ proceed: false, reason: "below-threshold" });
    });
  });

  describe("rolling-24h daily cap", () => {
    it("proceeds with one slot of headroom left", () => {
      expect(
        decideAutoApplySubmit({ ...base, dailyCapUsed: 9, dailyCap: 10 }),
      ).toEqual({ proceed: true });
    });

    it("blocks exactly at the cap", () => {
      expect(
        decideAutoApplySubmit({ ...base, dailyCapUsed: 10, dailyCap: 10 }),
      ).toEqual({ proceed: false, reason: "daily-cap-reached" });
    });

    it("blocks over the cap", () => {
      expect(
        decideAutoApplySubmit({ ...base, dailyCapUsed: 11, dailyCap: 10 }),
      ).toEqual({ proceed: false, reason: "daily-cap-reached" });
    });
  });

  describe("dedupe against an existing application", () => {
    it("blocks when an application (manual or auto) already exists", () => {
      expect(
        decideAutoApplySubmit({ ...base, hasExistingApplication: true }),
      ).toEqual({ proceed: false, reason: "already-applied" });
    });

    it("reports already-applied BEFORE the daily cap so a pre-existing application never consumes the cap (no auto_apply_log row written)", () => {
      // At-cap AND already applied: the engine writes the log row only on the
      // `proceed: true` path, so getting `already-applied` here (not
      // `daily-cap-reached`) is what guarantees a pre-existing application is
      // not logged as an auto-apply nor counted against the cap.
      const decision = decideAutoApplySubmit({
        ...base,
        hasExistingApplication: true,
        dailyCapUsed: 10,
        dailyCap: 10,
      });
      expect(decision).toEqual({ proceed: false, reason: "already-applied" });
    });

    it("reports below-threshold BEFORE dedupe and cap", () => {
      expect(
        decideAutoApplySubmit({
          ...base,
          score: 10,
          hasExistingApplication: true,
          dailyCapUsed: 10,
          dailyCap: 10,
        }),
      ).toEqual({ proceed: false, reason: "below-threshold" });
    });
  });
});
