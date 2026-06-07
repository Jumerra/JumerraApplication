import type { Request, Response, NextFunction } from "express";
import { db, ministriesTable, type Ministry } from "@workspace/db";
import { eq, and, isNull } from "drizzle-orm";
import { requireAuth } from "../middleware/require-auth";

/**
 * The two ministry account types. Extensible: adding a new ministry
 * (e.g. "youth") is a matter of adding its scopes below + a dashboard
 * branch — the role, account-creation, and data-access plumbing are
 * type-agnostic.
 */
export type MinistryType = "education" | "labour";

export const MINISTRY_TYPES: ReadonlyArray<MinistryType> = [
  "education",
  "labour",
];

export function isMinistryType(v: unknown): v is MinistryType {
  return v === "education" || v === "labour";
}

/**
 * A data-scope is a single slice of the ministry dashboard the
 * super-admin can grant or revoke. Each belongs to exactly one
 * ministry type. The ministry's `dataAccess` array is an allowlist of
 * these keys; the dashboard only returns sections whose key is granted.
 */
export type MinistryScopeDef = {
  key: string;
  label: string;
  description: string;
  type: MinistryType;
};

export const MINISTRY_SCOPES: ReadonlyArray<MinistryScopeDef> = [
  // ---- Ministry of Education ----
  {
    key: "edu:overview",
    label: "National education overview",
    description:
      "Headline totals: institutions tracked, students tracked, overall placement rate.",
    type: "education",
  },
  {
    key: "edu:institutions",
    label: "Institution placement performance",
    description:
      "Per-university/college/school placement rates and readiness — the institution leaderboard.",
    type: "education",
  },
  {
    key: "edu:trends",
    label: "Placement trends over time",
    description: "Monthly hires across all tracked institutions.",
    type: "education",
  },
  {
    key: "edu:skills",
    label: "Graduate skills profile",
    description: "Most common skills among tracked students.",
    type: "education",
  },

  // ---- Ministry of Labour ----
  {
    key: "lab:overview",
    label: "National labour-market overview",
    description:
      "Headline totals: jobs posted, hires, active employers, candidates in the market.",
    type: "labour",
  },
  {
    key: "lab:jobs",
    label: "Jobs & hiring activity",
    description: "Job postings over time and by employment type.",
    type: "labour",
  },
  {
    key: "lab:salary",
    label: "Salary & wage insights",
    description: "Aggregated reported-salary bands by employment type.",
    type: "labour",
  },
  {
    key: "lab:employers",
    label: "Employer activity",
    description: "Hiring activity by industry and the most active employers.",
    type: "labour",
  },
  {
    key: "lab:skills",
    label: "Skills demand",
    description: "Most in-demand skills across open jobs.",
    type: "labour",
  },
];

export function scopesForType(
  type: MinistryType,
): ReadonlyArray<MinistryScopeDef> {
  return MINISTRY_SCOPES.filter((s) => s.type === type);
}

export function scopeKeysForType(type: MinistryType): string[] {
  return scopesForType(type).map((s) => s.key);
}

/**
 * Sensible defaults applied when a ministry is first created: every
 * scope for its type is granted. The super-admin can then restrict.
 */
export function defaultDataAccessFor(type: MinistryType): string[] {
  return scopeKeysForType(type);
}

/**
 * Sanitises a requested data-access array down to the keys that are
 * actually valid for the given ministry type (drops unknown/foreign
 * keys, de-dupes, preserves catalog order).
 */
export function sanitizeDataAccess(
  type: MinistryType,
  requested: ReadonlyArray<string> | null | undefined,
): string[] {
  const valid = new Set(scopeKeysForType(type));
  const want = new Set(requested ?? []);
  return scopeKeysForType(type).filter((k) => valid.has(k) && want.has(k));
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      ministry?: Ministry;
    }
  }
}

/**
 * Loads the active ministry for the current user (role='ministry') and
 * attaches it to `req.ministry`. Rejects non-ministry users (403) and
 * users whose ministry was soft-deleted (403).
 */
export async function requireMinistry(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  await requireAuth(req, res, async () => {
    const user = req.currentUser;
    if (!user || user.role !== "ministry" || !user.ministryId) {
      res.status(403).json({ error: "Ministry access required" });
      return;
    }
    const rows = await db
      .select()
      .from(ministriesTable)
      .where(
        and(
          eq(ministriesTable.id, user.ministryId),
          isNull(ministriesTable.deletedAt),
        ),
      )
      .limit(1);
    const ministry = rows[0];
    if (!ministry) {
      res.status(403).json({ error: "Ministry account is not active" });
      return;
    }
    req.ministry = ministry;
    next();
  });
}

export function ministryHasScope(ministry: Ministry, key: string): boolean {
  return ministry.dataAccess.includes(key);
}
