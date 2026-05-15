import { Router, type IRouter } from "express";
import { and, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  candidatesTable,
  employersTable,
  notificationsTable,
  profileViewNotificationsTable,
  profileViewsTable,
  usersTable,
} from "@workspace/db/schema";
import { requireAuth } from "../middleware/require-auth";

const router: IRouter = Router();

const NOTIF_DEBOUNCE_MS = 24 * 60 * 60 * 1000;

/**
 * Best-effort recorder. Called from `GET /candidates/:id` when the
 * viewer is an employer user (not the candidate themselves, not an
 * admin doing platform review). Always swallows errors — a logging
 * failure must never break the profile read.
 *
 * Side effects:
 *   1. Inserts a row into `profile_views` (every view, no dedup at write).
 *   2. If the candidate is currently Boosted, sends an in-app
 *      notification to the candidate user — but at most once per
 *      24h per (candidate, viewer-employer) pair.
 */
export async function recordProfileView(opts: {
  candidateId: number;
  viewerUserId: number;
  employerId: number;
  candidateIsBoosted: boolean;
  candidateBoostExpiresAt: Date | null;
}): Promise<void> {
  const {
    candidateId,
    viewerUserId,
    employerId,
    candidateIsBoosted,
    candidateBoostExpiresAt,
  } = opts;

  try {
    await db.insert(profileViewsTable).values({
      candidateId,
      viewerUserId,
      employerId,
    });
  } catch {
    return;
  }

  // Boost gating: notification only fires while the candidate's boost
  // is active. Free candidates still get views recorded (so they see
  // them if they later upgrade), but no push.
  const boostActive =
    candidateIsBoosted &&
    (!candidateBoostExpiresAt || candidateBoostExpiresAt > new Date());
  if (!boostActive) return;

  // Look up the candidate's owning user (for notification fan-out).
  const [owner] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.candidateId, candidateId))
    .limit(1);
  const candidateUserId = owner?.id ?? null;
  if (candidateUserId == null) return;

  try {
    // Atomic debounce: insert (or update an expired row) the
    // notification marker first. The unique index on
    // (candidate_id, employer_id) plus the `setWhere` cutoff means
    // concurrent recruiters racing to view the same candidate will
    // produce at most one winning row inside the debounce window —
    // only the winner gets a non-empty `returning()` and proceeds to
    // create the notification.
    const now = new Date();
    const debounceCutoff = new Date(now.getTime() - NOTIF_DEBOUNCE_MS);
    const upserted = await db
      .insert(profileViewNotificationsTable)
      .values({ candidateId, employerId, notifiedAt: now })
      .onConflictDoUpdate({
        target: [
          profileViewNotificationsTable.candidateId,
          profileViewNotificationsTable.employerId,
        ],
        set: { notifiedAt: now },
        setWhere: lt(
          profileViewNotificationsTable.notifiedAt,
          debounceCutoff,
        ),
      })
      .returning({ id: profileViewNotificationsTable.id });

    if (upserted.length === 0) return;

    const [employer] = await db
      .select({ name: employersTable.name })
      .from(employersTable)
      .where(eq(employersTable.id, employerId));
    if (!employer) return;

    await db.insert(notificationsTable).values({
      userId: candidateUserId,
      kind: "profile_viewed",
      title: `${employer.name} viewed your profile`,
      body: "Open your dashboard to see who's checking you out.",
      link: "/account/profile-views",
    });
  } catch {
    // ignore — never break the profile read
  }
}

/**
 * GET /candidates/:id/profile-views
 *
 * Owner-only. Returns the list of distinct employers who recently
 * viewed this candidate's profile, with company details and the most
 * recent viewing user (best-effort name/title). Boost-gated: when the
 * candidate isn't boosted we return 403 with `{ boostRequired: true }`
 * so the UI can render an upgrade CTA instead of a generic error.
 */
router.get(
  "/candidates/:id/profile-views",
  requireAuth,
  async (req, res): Promise<void> => {
    const idParam = req.params.id;
    const candidateId = Number.parseInt(
      Array.isArray(idParam) ? (idParam[0] ?? "") : (idParam ?? ""),
      10,
    );
    if (!Number.isFinite(candidateId)) {
      res.status(400).json({ error: "Invalid candidate id" });
      return;
    }

    const me = req.currentUser!;
    const isAdmin = me.role === "admin";
    const isOwner = me.candidateId === candidateId;
    if (!isAdmin && !isOwner) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const [candidate] = await db
      .select({
        id: candidatesTable.id,
        isBoosted: candidatesTable.isBoosted,
        boostExpiresAt: candidatesTable.boostExpiresAt,
      })
      .from(candidatesTable)
      .where(eq(candidatesTable.id, candidateId));
    if (!candidate) {
      res.status(404).json({ error: "Candidate not found" });
      return;
    }

    const boostActive =
      candidate.isBoosted &&
      (!candidate.boostExpiresAt || candidate.boostExpiresAt > new Date());
    if (!boostActive && !isAdmin) {
      res.status(403).json({
        error: "Boost your profile to see who viewed it.",
        boostRequired: true,
      });
      return;
    }

    // Group views by viewer (one row per (employer, viewer)), keep the
    // most recent viewedAt and the count. We then collapse to one row
    // per employer in JS so the UI has a clean "Acme Corp — 3 views"
    // shape with the latest viewer's name/title.
    const rows = await db
      .select({
        employerId: profileViewsTable.employerId,
        viewerUserId: profileViewsTable.viewerUserId,
        lastViewedAt: sql<Date>`max(${profileViewsTable.viewedAt})`.as(
          "last_viewed_at",
        ),
        viewCount: sql<number>`count(*)::int`.as("view_count"),
      })
      .from(profileViewsTable)
      .where(
        and(
          eq(profileViewsTable.candidateId, candidateId),
          // Only show last 90 days
          gt(
            profileViewsTable.viewedAt,
            new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
          ),
        ),
      )
      .groupBy(profileViewsTable.employerId, profileViewsTable.viewerUserId)
      .orderBy(desc(sql`max(${profileViewsTable.viewedAt})`))
      .limit(500);

    if (rows.length === 0) {
      res.json({ items: [], totalViews: 0, uniqueEmployers: 0 });
      return;
    }

    const employerIds = Array.from(new Set(rows.map((r) => r.employerId)));
    const viewerIds = Array.from(new Set(rows.map((r) => r.viewerUserId)));

    const [employers, viewers] = await Promise.all([
      db
        .select()
        .from(employersTable)
        .where(inArray(employersTable.id, employerIds)),
      db
        .select({
          id: usersTable.id,
          fullName: usersTable.fullName,
          title: usersTable.title,
        })
        .from(usersTable)
        .where(inArray(usersTable.id, viewerIds)),
    ]);

    const empById = new Map(employers.map((e) => [e.id, e]));
    const viewerById = new Map(viewers.map((v) => [v.id, v]));

    // Collapse to one row per employer, taking the most-recent viewer
    // for the display name and summing view counts across all viewers
    // from that employer.
    const byEmployer = new Map<
      number,
      {
        employerId: number;
        latestViewerUserId: number;
        lastViewedAt: Date;
        viewCount: number;
      }
    >();
    for (const r of rows) {
      const existing = byEmployer.get(r.employerId);
      if (!existing) {
        byEmployer.set(r.employerId, {
          employerId: r.employerId,
          latestViewerUserId: r.viewerUserId,
          lastViewedAt: new Date(r.lastViewedAt),
          viewCount: r.viewCount,
        });
      } else {
        existing.viewCount += r.viewCount;
        const rDate = new Date(r.lastViewedAt);
        if (rDate > existing.lastViewedAt) {
          existing.lastViewedAt = rDate;
          existing.latestViewerUserId = r.viewerUserId;
        }
      }
    }

    const items = Array.from(byEmployer.values())
      .sort((a, b) => b.lastViewedAt.getTime() - a.lastViewedAt.getTime())
      .slice(0, 100)
      .map((row) => {
        const emp = empById.get(row.employerId);
        const viewer = viewerById.get(row.latestViewerUserId);
        return {
          employer: emp
            ? {
                id: emp.id,
                name: emp.name,
                tagline: emp.tagline,
                industry: emp.industry,
                location: emp.location,
                logoUrl: emp.logoUrl,
                websiteUrl: emp.websiteUrl,
                verified: emp.verified,
              }
            : {
                id: row.employerId,
                name: "Unknown company",
                tagline: "",
                industry: "",
                location: "",
                logoUrl: "",
                websiteUrl: "",
                verified: false,
              },
          viewerName: viewer?.fullName ?? null,
          viewerTitle: viewer?.title ?? null,
          lastViewedAt: row.lastViewedAt.toISOString(),
          viewCount: row.viewCount,
        };
      });

    const totalViews = items.reduce((s, i) => s + i.viewCount, 0);
    res.json({
      items,
      totalViews,
      uniqueEmployers: items.length,
    });
  },
);

export default router;
