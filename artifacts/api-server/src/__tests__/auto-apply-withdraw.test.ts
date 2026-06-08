import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  vi,
} from "vitest";
import express from "express";
import http from "node:http";
import type { AddressInfo } from "node:net";

/**
 * End-to-end-ish unit coverage for the Auto-Apply withdraw flow and the
 * re-apply guard that must survive a withdrawal.
 *
 * Two invariants are pinned here:
 *
 *  1. **Re-apply guard** — after a candidate withdraws an auto-submitted
 *     application, a subsequent `attemptAutoApply` (driven via
 *     `runAutoApplyForJob`) must NOT create a new application for the same
 *     (candidate, job). The dedupe in `attemptAutoApply` matches on
 *     (candidate, job) *regardless of application status*, so a `withdrawn`
 *     row still short-circuits the submit. A regression here would silently
 *     re-apply candidates to jobs they explicitly opted out of.
 *
 *  2. **Withdraw endpoint** — idempotency (an already-withdrawn application
 *     returns the current row and writes nothing) and access control (only the
 *     owner candidate, or an admin holding `auto-apply:manage`, may withdraw).
 *
 * Both share one in-memory `@workspace/db` fake (Proxy-backed tables + a tiny
 * chainable query builder) so neither test needs a live Postgres.
 */

// ---------------------------------------------------------------------------
// Mutable test state shared with the hoisted vi.mock factories.
// ---------------------------------------------------------------------------
const h = vi.hoisted(() => {
  return {
    // What each table returns from a SELECT, keyed by export name (e.g.
    // "applicationsTable"). Defaults to [] for any unset table.
    selectResults: {} as Record<string, unknown[]>,
    // What a `.returning()` resolves to, keyed by table export name.
    returningResults: {} as Record<string, unknown[]>,
    // Captured writes for assertions.
    inserts: [] as Array<{ table: string | null; values: unknown }>,
    updates: [] as Array<{ table: string | null; set: unknown; where: unknown }>,
    // Captured eq() conditions so we can assert WHICH columns a query filtered.
    eqs: [] as Array<{ col: string | null; val: unknown }>,
    transactionRan: false,
    // Injected authenticated principal for the route handler.
    currentUser: null as Record<string, unknown> | null,
    // Permission helpers behaviour.
    implicitAll: false,
    perms: new Set<string>(),
  };
});

// ---------------------------------------------------------------------------
// @workspace/db — Proxy tables + a minimal chainable query builder.
// ---------------------------------------------------------------------------
vi.mock("@workspace/db", () => {
  const tableProxy = (name: string) =>
    new Proxy(
      {},
      {
        get(_t, prop: string | symbol) {
          if (prop === "__table") return name;
          if (typeof prop === "symbol") return undefined;
          // Any column access returns a descriptor carrying its table-qualified name.
          return { __col: `${name}.${String(prop)}`, __table: name };
        },
      },
    );

  const makeSelectChain = () => {
    const chain: Record<string, unknown> = { _table: null as string | null };
    chain.from = (t: { __table?: string }) => {
      chain._table = t?.__table ?? null;
      return chain;
    };
    chain.where = () => chain;
    chain.orderBy = () => chain;
    chain.leftJoin = () => chain;
    chain.for = () => chain;
    chain.limit = () => chain;
    chain.offset = () => chain;
    chain.then = (
      resolve: (rows: unknown[]) => unknown,
      reject?: (e: unknown) => unknown,
    ) =>
      Promise.resolve(
        h.selectResults[chain._table as string] ?? [],
      ).then(resolve, reject);
    return chain;
  };

  const makeInsertChain = (t: { __table?: string }) => {
    const tableName = t?.__table ?? null;
    const chain: Record<string, unknown> = {};
    chain.values = (v: unknown) => {
      h.inserts.push({ table: tableName, values: v });
      return chain;
    };
    chain.onConflictDoNothing = () => chain;
    chain.returning = () =>
      Promise.resolve(h.returningResults[tableName as string] ?? [{ id: 1 }]);
    chain.then = (
      resolve: (rows: unknown[]) => unknown,
      reject?: (e: unknown) => unknown,
    ) => Promise.resolve([]).then(resolve, reject);
    return chain;
  };

  const makeUpdateChain = (t: { __table?: string }) => {
    const tableName = t?.__table ?? null;
    const chain: Record<string, unknown> = { _set: null };
    chain.set = (s: unknown) => {
      chain._set = s;
      return chain;
    };
    chain.where = (w: unknown) => {
      h.updates.push({ table: tableName, set: chain._set, where: w });
      return chain;
    };
    chain.returning = () =>
      Promise.resolve(h.returningResults[tableName as string] ?? [{ id: 1 }]);
    chain.then = (
      resolve: (rows: unknown[]) => unknown,
      reject?: (e: unknown) => unknown,
    ) => Promise.resolve([]).then(resolve, reject);
    return chain;
  };

  const makeDb = () => ({
    select: () => makeSelectChain(),
    insert: (t: { __table?: string }) => makeInsertChain(t),
    update: (t: { __table?: string }) => makeUpdateChain(t),
    // The auto-apply write transaction takes a per-candidate advisory lock via
    // `tx.execute(sql\`select pg_advisory_xact_lock(...)\`)`. The mock just needs
    // to resolve so the transaction proceeds to the create/log path.
    execute: async () => ({ rows: [] }),
    transaction: async (cb: (tx: unknown) => unknown) => {
      h.transactionRan = true;
      return cb(makeDb());
    },
  });

  // Vitest validates that every named import exists on the mock, so each table
  // touched by the loaded modules (lib/auto-apply, routes/auto-apply, and their
  // transitive imports — payment-finalizers etc.) must be enumerated here.
  const tableNames = [
    "applicationsTable",
    "applicationStatusHistoryTable",
    "autoApplyLogTable",
    "autoApplySettingsTable",
    "autoApplySubscriptionsTable",
    "boostPaymentsTable",
    "candidatesTable",
    "cvPaymentsTable",
    "employerSubscriptionsTable",
    "institutionSubscriptionsTable",
    "jobChallengesTable",
    "jobsTable",
    "jobTierPaymentsTable",
    "paymentsTable",
    "usersTable",
  ] as const;

  const mod: Record<string, unknown> = { db: makeDb() };
  for (const name of tableNames) mod[name] = tableProxy(name);
  return mod;
});

// ---------------------------------------------------------------------------
// drizzle-orm — plain object operators; eq() records its column for assertions.
// ---------------------------------------------------------------------------
vi.mock("drizzle-orm", () => ({
  and: (...parts: unknown[]) => ({ type: "and", parts }),
  or: (...parts: unknown[]) => ({ type: "or", parts }),
  eq: (col: { __col?: string } | undefined, val: unknown) => {
    h.eqs.push({ col: col?.__col ?? null, val });
    return { type: "eq", col, val };
  },
  ne: (col: unknown, val: unknown) => ({ type: "ne", col, val }),
  gt: (col: unknown, val: unknown) => ({ type: "gt", col, val }),
  gte: (col: unknown, val: unknown) => ({ type: "gte", col, val }),
  lt: (col: unknown, val: unknown) => ({ type: "lt", col, val }),
  lte: (col: unknown, val: unknown) => ({ type: "lte", col, val }),
  isNull: (col: unknown) => ({ type: "isNull", col }),
  isNotNull: (col: unknown) => ({ type: "isNotNull", col }),
  inArray: (col: unknown, vals: unknown) => ({ type: "inArray", col, vals }),
  desc: (col: unknown) => ({ type: "desc", col }),
  asc: (col: unknown) => ({ type: "asc", col }),
  sql: (..._args: unknown[]) => ({ type: "sql" }),
}));

// ---------------------------------------------------------------------------
// Application creation + notifications are stubbed: createApplicationRecord
// being called IS the signal that "a new application was created".
// ---------------------------------------------------------------------------
const createApplicationRecordMock = vi.fn(
  async (
    _exec: unknown,
    _input: {
      jobId: number;
      candidateId: number;
      source: string;
      matchScore: number;
      changedBy: number | null;
    },
  ): Promise<number> => 999,
);
vi.mock("../lib/application-create", () => ({
  createApplicationRecord: createApplicationRecordMock,
}));

vi.mock("../lib/notifier", () => ({
  sendNotificationToCandidate: vi.fn(async () => {}),
  sendNotification: vi.fn(async () => {}),
}));

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Auth + permissions for the route handler.
vi.mock("../middleware/require-auth", () => ({
  requireAuth: (
    req: { currentUser?: unknown },
    res: { status: (n: number) => { json: (b: unknown) => void } },
    next: () => void,
  ) => {
    if (!h.currentUser) {
      res.status(401).json({ error: "Unauthenticated" });
      return;
    }
    req.currentUser = h.currentUser;
    next();
  },
  requireAdmin: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

vi.mock("../lib/permissions", () => ({
  isImplicitAllUser: () => h.implicitAll,
  getUserPermissions: async () => h.perms,
  requirePermission:
    () => (_req: unknown, _res: unknown, next: () => void) =>
      next(),
}));

const { runAutoApplyForJob } = await import("../lib/auto-apply");
const { default: autoApplyRouter } = await import("../routes/auto-apply");

// Shared fixtures.
const SETTINGS = {
  id: 1,
  isActive: true,
  priceCents: 150000,
  currency: "ngn",
  intervalDays: 30,
  matchThreshold: 10,
  dailyCap: 50,
};
const ACTIVE_SUB = {
  id: 1,
  candidateId: 1,
  status: "active",
  currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  createdAt: new Date(),
};
const CANDIDATE = {
  id: 1,
  skills: ["javascript", "typescript"],
  yearsExperience: 5,
  talentScore: 80,
};
const PUBLIC_JOB = {
  id: 1,
  title: "Frontend Engineer",
  skills: ["javascript", "typescript"],
  visibility: "public",
  deletedAt: null,
};

function resetState() {
  h.selectResults = {};
  h.returningResults = {};
  h.inserts = [];
  h.updates = [];
  h.eqs = [];
  h.transactionRan = false;
  h.currentUser = null;
  h.implicitAll = false;
  h.perms = new Set<string>();
  createApplicationRecordMock.mockClear();
}

// ===========================================================================
// 1. Re-apply guard: withdrawn application still blocks auto-apply.
// ===========================================================================
describe("attemptAutoApply re-apply guard (via runAutoApplyForJob)", () => {
  beforeEach(() => {
    resetState();
    h.selectResults.autoApplySettingsTable = [SETTINGS];
    h.selectResults.jobsTable = [PUBLIC_JOB];
    h.selectResults.jobChallengesTable = []; // not challenge-gated
    h.selectResults.candidatesTable = [CANDIDATE]; // one opted-in candidate
    h.selectResults.autoApplySubscriptionsTable = [ACTIVE_SUB];
    h.selectResults.autoApplyLogTable = [{ count: 0 }]; // rolling-24h count
  });

  it("does NOT create a new application when a WITHDRAWN one already exists for (candidate, job)", async () => {
    // The candidate previously had an auto-submitted application that they
    // withdrew. The row survives withdrawal — only its status changed.
    h.selectResults.applicationsTable = [{ id: 7, status: "withdrawn" }];

    await runAutoApplyForJob(PUBLIC_JOB.id);

    // The dedupe must short-circuit BEFORE the write transaction.
    expect(createApplicationRecordMock).not.toHaveBeenCalled();
    expect(h.transactionRan).toBe(false);
    expect(
      h.inserts.filter((i) => i.table === "applicationsTable"),
    ).toHaveLength(0);
    expect(
      h.inserts.filter((i) => i.table === "autoApplyLogTable"),
    ).toHaveLength(0);
  });

  it("dedupes by (candidate, job) only — it does NOT filter applications by status", async () => {
    // This is what makes the guard survive a withdrawal: the existence check
    // matches any status, so a `withdrawn` row counts as "already applied".
    h.selectResults.applicationsTable = [{ id: 7, status: "withdrawn" }];

    await runAutoApplyForJob(PUBLIC_JOB.id);

    const appCols = h.eqs
      .filter((e) => e.col?.startsWith("applicationsTable."))
      .map((e) => e.col);
    expect(appCols).toContain("applicationsTable.jobId");
    expect(appCols).toContain("applicationsTable.candidateId");
    expect(appCols).not.toContain("applicationsTable.status");
  });

  it("DOES create an application when none exists (proves the harness would otherwise submit)", async () => {
    // Control case: with no existing application, the same engine run reaches
    // the write path and creates one. This isolates the guard above as the
    // sole reason the withdrawn case is skipped.
    h.selectResults.applicationsTable = [];
    h.returningResults.autoApplyLogTable = [{ id: 1 }];

    await runAutoApplyForJob(PUBLIC_JOB.id);

    expect(createApplicationRecordMock).toHaveBeenCalledTimes(1);
    const arg = createApplicationRecordMock.mock.calls[0]![1] as {
      jobId: number;
      candidateId: number;
      source: string;
    };
    expect(arg.jobId).toBe(PUBLIC_JOB.id);
    expect(arg.candidateId).toBe(CANDIDATE.id);
    expect(arg.source).toBe("auto_apply");
  });
});

// ===========================================================================
// 2. Withdraw endpoint: idempotency + access control.
// ===========================================================================
describe("POST /candidates/:id/auto-apply/activity/:logId/withdraw", () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    const app = express();
    app.use(express.json());
    app.use(autoApplyRouter);
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
    resetState();
    // A log row owned by candidate 1, linked to application 50.
    h.selectResults.autoApplyLogTable = [
      {
        id: 5,
        jobId: 1,
        applicationId: 50,
        matchScore: 88,
        createdAt: new Date("2026-06-01T00:00:00Z"),
      },
    ];
    h.selectResults.jobsTable = [{ title: "Frontend Engineer" }];
  });

  const withdraw = (candidateId: number, logId: number) =>
    fetch(
      `${baseUrl}/candidates/${candidateId}/auto-apply/activity/${logId}/withdraw`,
      { method: "POST", headers: { "content-type": "application/json" } },
    );

  it("withdraws a still-open application: flips status and writes a history row", async () => {
    h.currentUser = { id: 100, role: "candidate", candidateId: 1 };
    h.selectResults.applicationsTable = [
      { id: 50, status: "submitted", candidateId: 1 },
    ];

    const res = await withdraw(1, 5);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { applicationStatus: string };
    expect(body.applicationStatus).toBe("withdrawn");

    expect(h.transactionRan).toBe(true);
    const appUpdate = h.updates.find((u) => u.table === "applicationsTable");
    expect(appUpdate).toBeDefined();
    expect(appUpdate!.set).toEqual({ status: "withdrawn" });
    expect(
      h.inserts.some((i) => i.table === "applicationStatusHistoryTable"),
    ).toBe(true);
  });

  it("is idempotent: an already-withdrawn application returns the current row and writes nothing", async () => {
    h.currentUser = { id: 100, role: "candidate", candidateId: 1 };
    h.selectResults.applicationsTable = [
      { id: 50, status: "withdrawn", candidateId: 1 },
    ];

    const res = await withdraw(1, 5);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { applicationStatus: string };
    expect(body.applicationStatus).toBe("withdrawn");

    // No second write — the early idempotent return fires before any tx.
    expect(h.transactionRan).toBe(false);
    expect(h.updates).toHaveLength(0);
    expect(
      h.inserts.some((i) => i.table === "applicationStatusHistoryTable"),
    ).toBe(false);
  });

  it("allows the owner candidate", async () => {
    h.currentUser = { id: 100, role: "candidate", candidateId: 1 };
    h.selectResults.applicationsTable = [
      { id: 50, status: "withdrawn", candidateId: 1 },
    ];
    const res = await withdraw(1, 5);
    expect(res.status).toBe(200);
  });

  it("denies a different candidate (403) and never touches the DB", async () => {
    h.currentUser = { id: 101, role: "candidate", candidateId: 2 };
    h.selectResults.applicationsTable = [
      { id: 50, status: "submitted", candidateId: 1 },
    ];

    const res = await withdraw(1, 5);
    expect(res.status).toBe(403);
    expect(h.transactionRan).toBe(false);
    expect(h.updates).toHaveLength(0);
  });

  it("denies an admin WITHOUT the auto-apply:manage permission (403)", async () => {
    h.currentUser = { id: 102, role: "admin" };
    h.implicitAll = false;
    h.perms = new Set<string>(); // no grants
    h.selectResults.applicationsTable = [
      { id: 50, status: "submitted", candidateId: 1 },
    ];

    const res = await withdraw(1, 5);
    expect(res.status).toBe(403);
    expect(h.transactionRan).toBe(false);
  });

  it("allows an admin WITH the auto-apply:manage permission", async () => {
    h.currentUser = { id: 103, role: "admin" };
    h.implicitAll = false;
    h.perms = new Set<string>(["auto-apply:manage"]);
    h.selectResults.applicationsTable = [
      { id: 50, status: "withdrawn", candidateId: 1 },
    ];

    const res = await withdraw(1, 5);
    expect(res.status).toBe(200);
  });

  it("denies a non-candidate, non-admin role (403)", async () => {
    h.currentUser = { id: 104, role: "employer", employerId: 9 };
    h.selectResults.applicationsTable = [
      { id: 50, status: "submitted", candidateId: 1 },
    ];

    const res = await withdraw(1, 5);
    expect(res.status).toBe(403);
    expect(h.transactionRan).toBe(false);
  });
});
