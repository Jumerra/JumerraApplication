import { Router } from "express";
import { db, notificationsTable } from "@workspace/db";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { requireAuth } from "../middleware/require-auth";

const router: Router = Router();

router.use("/notifications", requireAuth);

function serialize(n: typeof notificationsTable.$inferSelect) {
  return {
    id: n.id,
    kind: n.kind,
    title: n.title,
    body: n.body,
    link: n.link,
    readAt: n.readAt ? n.readAt.toISOString() : null,
    createdAt: n.createdAt.toISOString(),
  };
}

/**
 * GET /api/notifications?limit=20
 * Most recent notifications for the current user, newest first.
 */
router.get("/notifications", async (req, res) => {
  const me = req.currentUser!;
  const limit = Math.min(
    Math.max(Number(req.query.limit) || 20, 1),
    100,
  );
  const rows = await db
    .select()
    .from(notificationsTable)
    .where(eq(notificationsTable.userId, me.id))
    .orderBy(desc(notificationsTable.createdAt))
    .limit(limit);
  res.json({ notifications: rows.map(serialize) });
});

/**
 * GET /api/notifications/unread-count
 * Cheap polling endpoint for the bell badge.
 */
router.get("/notifications/unread-count", async (req, res) => {
  const me = req.currentUser!;
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(notificationsTable)
    .where(
      and(
        eq(notificationsTable.userId, me.id),
        isNull(notificationsTable.readAt),
      ),
    );
  res.json({ unread: Number(row?.count ?? 0) });
});

/**
 * POST /api/notifications/:id/read
 * Idempotent. Refuses to read someone else's notification.
 */
router.post("/notifications/:id/read", async (req, res) => {
  const me = req.currentUser!;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const updated = await db
    .update(notificationsTable)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notificationsTable.id, id),
        eq(notificationsTable.userId, me.id),
        isNull(notificationsTable.readAt),
      ),
    )
    .returning();
  res.json({ ok: true, updated: updated.length });
});

/**
 * POST /api/notifications/mark-all-read
 */
router.post("/notifications/mark-all-read", async (req, res) => {
  const me = req.currentUser!;
  const updated = await db
    .update(notificationsTable)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notificationsTable.userId, me.id),
        isNull(notificationsTable.readAt),
      ),
    )
    .returning({ id: notificationsTable.id });
  res.json({ ok: true, updated: updated.length });
});

export default router;
