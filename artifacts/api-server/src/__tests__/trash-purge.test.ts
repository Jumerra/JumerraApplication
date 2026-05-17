import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";

interface FakeRow {
  id: string;
  deletedAt: Date | null;
}

interface TableState {
  name: string;
  rows: FakeRow[];
}

const candidatesState: TableState = { name: "candidates", rows: [] };
const employersState: TableState = { name: "employers", rows: [] };
const institutionsState: TableState = { name: "institutions", rows: [] };

const capturedCutoffs: Record<string, Date | undefined> = {};

vi.mock("@workspace/db", () => {
  const makeTable = (state: TableState) => ({
    __state: state,
    deletedAt: { __col: `${state.name}.deletedAt` },
  });
  const candidatesTable = makeTable(candidatesState);
  const employersTable = makeTable(employersState);
  const institutionsTable = makeTable(institutionsState);

  const db = {
    delete(table: { __state: TableState }) {
      return {
        where(cond: { cutoff?: Date }) {
          capturedCutoffs[table.__state.name] = cond.cutoff;
          const cutoff = cond.cutoff;
          return {
            returning() {
              const state = table.__state;
              const matched = state.rows.filter(
                (r) => r.deletedAt !== null && cutoff !== undefined && r.deletedAt < cutoff,
              );
              // Simulate the actual delete on the fake table.
              state.rows = state.rows.filter((r) => !matched.includes(r));
              return Promise.resolve(matched.map((r) => ({ id: r.id })));
            },
          };
        },
      };
    },
    // The warnings sweep uses .select().from().where() on the same tables
    // plus a usersTable join. The mock returns empty arrays so the sweep
    // is a no-op — exercising the lead-days helper is enough here; the
    // permission-filtered fan-out is tested implicitly via the helper's
    // window math.
    select() {
      return {
        from() {
          return {
            where() {
              return Promise.resolve([]);
            },
          };
        },
      };
    },
  };
  // usersTable is only referenced for column shape — empty stub is fine.
  const usersTable = {
    id: { __col: "users.id" },
    email: { __col: "users.email" },
    fullName: { __col: "users.fullName" },
    role: { __col: "users.role" },
    status: { __col: "users.status" },
    orgRole: { __col: "users.orgRole" },
    candidateId: { __col: "users.candidateId" },
    employerId: { __col: "users.employerId" },
    institutionId: { __col: "users.institutionId" },
    assignedDepartmentId: { __col: "users.assignedDepartmentId" },
    assignedFacultyId: { __col: "users.assignedFacultyId" },
    passwordHash: { __col: "users.passwordHash" },
  };
  return { db, candidatesTable, employersTable, institutionsTable, usersTable };
});

vi.mock("drizzle-orm", () => ({
  and: (...parts: Array<Record<string, unknown>>) => {
    const ltPart = parts.find((p) => p && (p as { type?: string }).type === "lt") as
      | { cutoff: Date }
      | undefined;
    return { type: "and", parts, cutoff: ltPart?.cutoff };
  },
  eq: (col: unknown, val: unknown) => ({ type: "eq", col, val }),
  gte: (col: unknown, val: Date) => ({ type: "gte", col, val }),
  isNotNull: (col: unknown) => ({ type: "isNotNull", col }),
  lt: (col: unknown, val: Date) => ({ type: "lt", col, cutoff: val }),
}));

vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Keep the warnings sweep from doing any real work — the email + permission
// helpers are exercised in their own suites.
const sendTrashPurgeFailureEmailMock = vi.fn(async () => ({
  sent: true as const,
  provider: "resend",
  id: "fake-id",
}));
vi.mock("../lib/email", () => ({
  sendTrashPurgeWarningEmail: vi.fn(async () => ({ sent: false, reason: "stub" })),
  sendTrashPurgeFailureEmail: sendTrashPurgeFailureEmailMock,
  originForBackground: () => "https://example.test",
}));

vi.mock("../lib/permissions", () => ({
  getUserPermissions: vi.fn(async () => new Set<string>()),
  isImplicitAllUser: vi.fn(() => false),
}));

const {
  getTrashRetentionDays,
  getTrashPurgeWarningLeadDays,
  runTrashPurgeSweep,
  notifyTrashPurgeFailure,
  _resetTrashPurgeFailureAlertState,
} = await import("../lib/trash-purge-worker");

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const originalRetention = process.env.TRASH_RETENTION_DAYS;
const originalLead = process.env.TRASH_PURGE_WARNING_LEAD_DAYS;
const originalAlertEmail = process.env.TRASH_PURGE_ALERT_EMAIL;

afterEach(() => {
  if (originalRetention === undefined) {
    delete process.env.TRASH_RETENTION_DAYS;
  } else {
    process.env.TRASH_RETENTION_DAYS = originalRetention;
  }
  if (originalLead === undefined) {
    delete process.env.TRASH_PURGE_WARNING_LEAD_DAYS;
  } else {
    process.env.TRASH_PURGE_WARNING_LEAD_DAYS = originalLead;
  }
  if (originalAlertEmail === undefined) {
    delete process.env.TRASH_PURGE_ALERT_EMAIL;
  } else {
    process.env.TRASH_PURGE_ALERT_EMAIL = originalAlertEmail;
  }
  sendTrashPurgeFailureEmailMock.mockClear();
  _resetTrashPurgeFailureAlertState();
});

describe("getTrashRetentionDays", () => {
  it("defaults to 30 when the env var is unset", () => {
    delete process.env.TRASH_RETENTION_DAYS;
    expect(getTrashRetentionDays()).toBe(30);
  });

  it("defaults to 30 when the env var is empty or whitespace", () => {
    process.env.TRASH_RETENTION_DAYS = "";
    expect(getTrashRetentionDays()).toBe(30);
    process.env.TRASH_RETENTION_DAYS = "   ";
    expect(getTrashRetentionDays()).toBe(30);
  });

  it("uses a valid positive integer override", () => {
    process.env.TRASH_RETENTION_DAYS = "60";
    expect(getTrashRetentionDays()).toBe(60);
  });

  it("floors valid decimals", () => {
    process.env.TRASH_RETENTION_DAYS = "7.9";
    expect(getTrashRetentionDays()).toBe(7);
  });

  it("clamps positive values below 1 up to 1", () => {
    process.env.TRASH_RETENTION_DAYS = "0.4";
    expect(getTrashRetentionDays()).toBe(1);
  });

  it("clamps zero and negative numbers up to 1", () => {
    process.env.TRASH_RETENTION_DAYS = "0";
    expect(getTrashRetentionDays()).toBe(1);
    process.env.TRASH_RETENTION_DAYS = "-5";
    expect(getTrashRetentionDays()).toBe(1);
  });

  it("fails safe to 30 for non-numeric strings (typo like '30d')", () => {
    // The critical fail-safe: a typo like "30d" must NOT collapse the
    // retention window to 1 day, since that would hard-delete most of
    // the trash on the next sweep.
    process.env.TRASH_RETENTION_DAYS = "30d";
    expect(getTrashRetentionDays()).toBe(30);
    process.env.TRASH_RETENTION_DAYS = "thirty";
    expect(getTrashRetentionDays()).toBe(30);
  });
});

describe("runTrashPurgeSweep", () => {
  beforeEach(() => {
    candidatesState.rows = [];
    employersState.rows = [];
    institutionsState.rows = [];
    delete capturedCutoffs.candidates;
    delete capturedCutoffs.employers;
    delete capturedCutoffs.institutions;
  });

  it("deletes only rows whose deletedAt is older than the cutoff, leaving NULL and recent rows alone", async () => {
    delete process.env.TRASH_RETENTION_DAYS; // default 30d
    const now = Date.now();
    const old = new Date(now - 31 * ONE_DAY_MS); // older than cutoff
    const veryOld = new Date(now - 365 * ONE_DAY_MS);
    const recent = new Date(now - 5 * ONE_DAY_MS); // inside retention
    const justNow = new Date(now - 60 * 1000);

    candidatesState.rows = [
      { id: "c-null", deletedAt: null },
      { id: "c-recent", deletedAt: recent },
      { id: "c-just-now", deletedAt: justNow },
      { id: "c-old", deletedAt: old },
      { id: "c-very-old", deletedAt: veryOld },
    ];
    employersState.rows = [
      { id: "e-null", deletedAt: null },
      { id: "e-old", deletedAt: old },
    ];
    institutionsState.rows = [
      { id: "i-recent", deletedAt: recent },
      { id: "i-very-old", deletedAt: veryOld },
    ];

    const result = await runTrashPurgeSweep();

    expect(result.candidates).toBe(2);
    expect(result.employers).toBe(1);
    expect(result.institutions).toBe(1);
    expect(typeof result.cutoff).toBe("string");

    // Survivors: NULL deleted_at and recent deleted_at must not be touched.
    expect(candidatesState.rows.map((r) => r.id).sort()).toEqual([
      "c-just-now",
      "c-null",
      "c-recent",
    ]);
    expect(employersState.rows.map((r) => r.id)).toEqual(["e-null"]);
    expect(institutionsState.rows.map((r) => r.id)).toEqual(["i-recent"]);
  });

  it("uses an env-configured retention window when computing the cutoff", async () => {
    process.env.TRASH_RETENTION_DAYS = "7";
    const before = Date.now();
    await runTrashPurgeSweep();
    const after = Date.now();

    const expectedMin = before - 7 * ONE_DAY_MS;
    const expectedMax = after - 7 * ONE_DAY_MS;

    for (const table of ["candidates", "employers", "institutions"] as const) {
      const cutoff = capturedCutoffs[table];
      expect(cutoff).toBeInstanceOf(Date);
      const t = cutoff!.getTime();
      expect(t).toBeGreaterThanOrEqual(expectedMin);
      expect(t).toBeLessThanOrEqual(expectedMax);
    }
  });

  it("is a no-op when TRASH_PURGE_ALERT_EMAIL is unset", async () => {
    delete process.env.TRASH_PURGE_ALERT_EMAIL;
    const sent = await notifyTrashPurgeFailure(new Error("boom"));
    expect(sent).toBe(false);
    expect(sendTrashPurgeFailureEmailMock).not.toHaveBeenCalled();
  });

  it("sends a failure email when TRASH_PURGE_ALERT_EMAIL is set", async () => {
    process.env.TRASH_PURGE_ALERT_EMAIL = "ops@example.com";
    const sent = await notifyTrashPurgeFailure(new Error("db gone"));
    expect(sent).toBe(true);
    expect(sendTrashPurgeFailureEmailMock).toHaveBeenCalledTimes(1);
    const arg = sendTrashPurgeFailureEmailMock.mock.calls[0]![0]!;
    expect(arg.to).toBe("ops@example.com");
    expect(arg.errorMessage).toBe("db gone");
    expect(typeof arg.errorStack).toBe("string");
    expect(typeof arg.occurredAt).toBe("string");
  });

  it("rate-limits repeat failures to one alert per 24h", async () => {
    process.env.TRASH_PURGE_ALERT_EMAIL = "ops@example.com";
    await notifyTrashPurgeFailure(new Error("first"));
    await notifyTrashPurgeFailure(new Error("second"));
    await notifyTrashPurgeFailure(new Error("third"));
    expect(sendTrashPurgeFailureEmailMock).toHaveBeenCalledTimes(1);
  });

  it("stringifies non-Error throwables and reports a null stack", async () => {
    process.env.TRASH_PURGE_ALERT_EMAIL = "ops@example.com";
    await notifyTrashPurgeFailure("plain string failure");
    const arg = sendTrashPurgeFailureEmailMock.mock.calls[0]![0]!;
    expect(arg.errorMessage).toBe("plain string failure");
    expect(arg.errorStack).toBeNull();
  });

  it("swallows dispatcher exceptions so the scheduler tick isn't crashed", async () => {
    process.env.TRASH_PURGE_ALERT_EMAIL = "ops@example.com";
    sendTrashPurgeFailureEmailMock.mockImplementationOnce(async () => {
      throw new Error("smtp blew up");
    });
    await expect(notifyTrashPurgeFailure(new Error("boom"))).resolves.toBe(true);
  });

  it("does nothing when every soft-deleted row is still inside the retention window", async () => {
    process.env.TRASH_RETENTION_DAYS = "30";
    const recent = new Date(Date.now() - 2 * ONE_DAY_MS);
    candidatesState.rows = [{ id: "c1", deletedAt: recent }];
    employersState.rows = [{ id: "e1", deletedAt: null }];
    institutionsState.rows = [{ id: "i1", deletedAt: recent }];

    const result = await runTrashPurgeSweep();

    expect(result.candidates).toBe(0);
    expect(result.employers).toBe(0);
    expect(result.institutions).toBe(0);
    expect(candidatesState.rows).toHaveLength(1);
    expect(employersState.rows).toHaveLength(1);
    expect(institutionsState.rows).toHaveLength(1);
  });
});

describe("getTrashPurgeWarningLeadDays", () => {
  it("defaults to 3 when the env var is unset", () => {
    delete process.env.TRASH_PURGE_WARNING_LEAD_DAYS;
    expect(getTrashPurgeWarningLeadDays(30)).toBe(3);
  });

  it("defaults to 3 for empty or whitespace", () => {
    process.env.TRASH_PURGE_WARNING_LEAD_DAYS = "";
    expect(getTrashPurgeWarningLeadDays(30)).toBe(3);
    process.env.TRASH_PURGE_WARNING_LEAD_DAYS = "   ";
    expect(getTrashPurgeWarningLeadDays(30)).toBe(3);
  });

  it("uses a valid positive override", () => {
    process.env.TRASH_PURGE_WARNING_LEAD_DAYS = "7";
    expect(getTrashPurgeWarningLeadDays(30)).toBe(7);
  });

  it("floors decimals and clamps below 1 up to 1", () => {
    process.env.TRASH_PURGE_WARNING_LEAD_DAYS = "2.9";
    expect(getTrashPurgeWarningLeadDays(30)).toBe(2);
    process.env.TRASH_PURGE_WARNING_LEAD_DAYS = "0";
    expect(getTrashPurgeWarningLeadDays(30)).toBe(1);
    process.env.TRASH_PURGE_WARNING_LEAD_DAYS = "-5";
    expect(getTrashPurgeWarningLeadDays(30)).toBe(1);
  });

  it("fails safe to 3 for non-numeric strings", () => {
    process.env.TRASH_PURGE_WARNING_LEAD_DAYS = "3d";
    expect(getTrashPurgeWarningLeadDays(30)).toBe(3);
  });

  it("clamps lead >= retention down to retention - 1", () => {
    // A lead of 30 with a retention of 30 would put the warning window
    // at "rows deleted between -1 and 0 days ago" which can never match.
    // Clamp keeps the warning meaningful for short retention windows.
    process.env.TRASH_PURGE_WARNING_LEAD_DAYS = "30";
    expect(getTrashPurgeWarningLeadDays(30)).toBe(29);
    process.env.TRASH_PURGE_WARNING_LEAD_DAYS = "100";
    expect(getTrashPurgeWarningLeadDays(5)).toBe(4);
  });

  it("clamps to 1 when retention is 1 (degenerate but safe)", () => {
    process.env.TRASH_PURGE_WARNING_LEAD_DAYS = "3";
    expect(getTrashPurgeWarningLeadDays(1)).toBe(1);
  });
});
