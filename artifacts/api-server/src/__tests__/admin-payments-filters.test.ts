import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * Pins case-handling on `GET /admin/payments` query filters.
 *
 * The unified `payments` ledger stores currency in upstream ISO 4217
 * uppercase ("NGN", "USD"), so the route normalizes the user-supplied
 * `?currency=` to uppercase before comparing. `?provider=` and
 * `?status=` use case-sensitive equality on enum-like text columns and
 * are pinned here as well so a future refactor can't quietly start
 * lowercasing them and returning empty results.
 */

interface CapturedCall {
  col: string;
  val: unknown;
}
const captured: CapturedCall[] = [];

let selectRows: unknown[] = [];

vi.mock("@workspace/db", () => {
  const col = (name: string) => ({ __col: name });
  const paymentsTable = {
    id: col("payments.id"),
    provider: col("payments.provider"),
    externalRef: col("payments.externalRef"),
    purposeType: col("payments.purposeType"),
    purposeId: col("payments.purposeId"),
    amountSubunits: col("payments.amountSubunits"),
    currency: col("payments.currency"),
    status: col("payments.status"),
    createdAt: col("payments.createdAt"),
    finalizedAt: col("payments.finalizedAt"),
  };
  const empty = {} as Record<string, unknown>;

  const makeChain = () => {
    const chain: Record<string, unknown> = {};
    chain.from = () => chain;
    chain.where = () => chain;
    chain.orderBy = () => chain;
    chain.groupBy = () => chain;
    chain.limit = () => chain;
    chain.offset = () => Promise.resolve(selectRows);
    // Some code paths (like resolveCustomers) await directly after .where()
    // without limit/offset — make the chain thenable for those.
    (chain as { then?: unknown }).then = (
      resolve: (rows: unknown[]) => void,
    ) => resolve(selectRows);
    return chain;
  };

  const db = {
    select: () => makeChain(),
  };

  return {
    db,
    paymentsTable,
    boostPaymentsTable: empty,
    cvPaymentsTable: empty,
    jobTierPaymentsTable: empty,
    institutionSubscriptionsTable: empty,
    employerSubscriptionsTable: empty,
    candidatesTable: empty,
    employersTable: empty,
    institutionsTable: empty,
  };
});

vi.mock("drizzle-orm", () => {
  const sqlFn = (..._args: unknown[]) => ({ type: "sql" });
  return {
    and: (...parts: unknown[]) => ({ type: "and", parts }),
    eq: (col: { __col?: string } | undefined, val: unknown) => {
      captured.push({ col: col?.__col ?? "?", val });
      return { type: "eq", col, val };
    },
    gte: (col: unknown, val: unknown) => ({ type: "gte", col, val }),
    lte: (col: unknown, val: unknown) => ({ type: "lte", col, val }),
    inArray: (col: unknown, vals: unknown) => ({ type: "inArray", col, vals }),
    desc: (col: unknown) => ({ type: "desc", col }),
    sql: sqlFn,
  };
});

vi.mock("../middleware/require-auth", () => ({
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/permissions", () => ({
  requirePermission:
    () => (_req: unknown, _res: unknown, next: () => void) =>
      next(),
}));

vi.mock("../lib/payment-finalizers", () => ({
  finalizeFromStripeSessionId: vi.fn(),
  finalizeFromPaystackReference: vi.fn(),
}));

const { default: router } = await import("../routes/admin-revenue");

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(router);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve())),
  );
});

beforeEach(() => {
  captured.length = 0;
  selectRows = [];
});

function currencyFilterValues(): unknown[] {
  return captured
    .filter((c) => c.col === "payments.currency")
    .map((c) => c.val);
}

function providerFilterValues(): unknown[] {
  return captured
    .filter((c) => c.col === "payments.provider")
    .map((c) => c.val);
}

function statusFilterValues(): unknown[] {
  return captured
    .filter((c) => c.col === "payments.status")
    .map((c) => c.val);
}

describe("GET /admin/payments — currency filter is case-insensitive", () => {
  it.each(["ngn", "NGN", "Ngn", "nGn"])(
    "normalizes ?currency=%s to uppercase NGN before comparing",
    async (input) => {
      const res = await fetch(
        `${baseUrl}/admin/payments?currency=${encodeURIComponent(input)}`,
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { payments: unknown[] };
      expect(body.payments).toEqual([]);
      expect(currencyFilterValues()).toEqual(["NGN"]);
    },
  );

  it("does NOT add a currency filter when the param is omitted", async () => {
    const res = await fetch(`${baseUrl}/admin/payments`);
    expect(res.status).toBe(200);
    expect(currencyFilterValues()).toEqual([]);
  });

  it("does NOT add a currency filter when the param is empty", async () => {
    const res = await fetch(`${baseUrl}/admin/payments?currency=`);
    expect(res.status).toBe(200);
    expect(currencyFilterValues()).toEqual([]);
  });
});

describe("GET /admin/payments — provider/status filters pass through verbatim", () => {
  // The unified `payments` table stores these as lowercase enum-ish text:
  //   provider: 'stripe' | 'paystack'
  //   status:   'pending' | 'paid' | 'failed' | 'active' | 'trialing' | ...
  // The console only ever sends the canonical lowercase form, so the
  // route uses a plain eq() with no case-folding. Pinning the pass-through
  // here so a future refactor doesn't start helpfully lowercasing
  // (which would still work) or uppercasing (which would silently break).
  it("passes ?provider=paystack through unchanged", async () => {
    const res = await fetch(`${baseUrl}/admin/payments?provider=paystack`);
    expect(res.status).toBe(200);
    expect(providerFilterValues()).toEqual(["paystack"]);
  });

  it("passes ?status=paid through unchanged", async () => {
    const res = await fetch(`${baseUrl}/admin/payments?status=paid`);
    expect(res.status).toBe(200);
    expect(statusFilterValues()).toEqual(["paid"]);
  });

  it("combines currency (normalized) + provider + status filters", async () => {
    const res = await fetch(
      `${baseUrl}/admin/payments?currency=ngn&provider=paystack&status=paid`,
    );
    expect(res.status).toBe(200);
    expect(currencyFilterValues()).toEqual(["NGN"]);
    expect(providerFilterValues()).toEqual(["paystack"]);
    expect(statusFilterValues()).toEqual(["paid"]);
  });
});
